import React, { useRef, useEffect } from 'react';

interface SpectrumVisualizerProps {
  analyser: AnalyserNode | null;
}

export function SpectrumVisualizer({ analyser }: SpectrumVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const peaksRef = useRef<number[]>([]);
  const peakHoldFramesRef = useRef<number[]>([]);

  useEffect(() => {
    if (!analyser) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas dimensions to match display size for sharp rendering
    const updateSize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let animationId: number;

    const draw = () => {
      animationId = requestAnimationFrame(draw);

      analyser.getByteFrequencyData(dataArray);
      
      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);

      const numBars = Math.min(64, Math.floor(width / 10)); // Adaptive columns
      if (numBars <= 0) return;
      
      const barWidth = width / numBars;
      // Keep blocks square-ish by setting blockHeight close to barWidth
      const blockHeight = Math.max(3, Math.min(12, barWidth - 2)); 
      const blockGap = 2; // Vertical gap between LED segments
      const totalBlockHeight = blockHeight + blockGap;
      const maxBlocks = Math.floor(height / totalBlockHeight);

      // Initialize peak arrays if dimensions changed
      if (peaksRef.current.length !== numBars) {
        peaksRef.current = new Array(numBars).fill(0);
        peakHoldFramesRef.current = new Array(numBars).fill(0);
      }

      // Average values or read logarithmic frequencies
      for (let i = 0; i < numBars; i++) {
        const ratio = i / numBars;
        // Focus on mid-low range where audio amplitude is strongest
        const binIndex = Math.min(
          bufferLength - 1,
          Math.floor(Math.pow(ratio, 1.4) * (bufferLength * 0.75))
        );
        
        const value = dataArray[binIndex];
        const intensity = value / 255;
        const blocksToDraw = Math.round(intensity * maxBlocks);

        // Update peak levels with hold and decay
        if (blocksToDraw >= peaksRef.current[i]) {
          peaksRef.current[i] = blocksToDraw;
          peakHoldFramesRef.current[i] = 30; // Hold peak for 30 frames
        } else {
          if (peakHoldFramesRef.current[i] > 0) {
            peakHoldFramesRef.current[i]--;
          } else {
            peaksRef.current[i] = Math.max(0, peaksRef.current[i] - 0.4); // Decay
          }
        }

        const x = i * barWidth;

        // Draw stacked blocks
        for (let b = 0; b < maxBlocks; b++) {
          const y = height - (b + 1) * totalBlockHeight;
          const isActive = b < blocksToDraw;
          const isPeak = b === Math.floor(peaksRef.current[i]) && b > 0;

          if (isActive || isPeak) {
            const blockRatio = b / maxBlocks;
            let fillStyle = '';
            
            // Warm glowing orange/amber theme matching the VFD panel
            if (blockRatio < 0.4) {
              fillStyle = '#ff921e';
            } else if (blockRatio < 0.7) {
              fillStyle = '#fd992f';
            } else {
              fillStyle = '#ffae42';
            }
            
            // Apply bloom effect
            ctx.shadowBlur = isPeak ? 12 : 6;
            ctx.shadowColor = fillStyle;
            ctx.fillStyle = fillStyle;
            
            ctx.fillRect(x + 1, y, barWidth - 4, blockHeight);
          } else {
            // Draw placeholder backgrounds without shadows for better performance
            ctx.shadowBlur = 0;
            ctx.fillStyle = 'rgba(255, 146, 30, 0.02)';
            ctx.fillRect(x + 1, y, barWidth - 4, blockHeight);
          }
        }
      }
      
      // Reset shadow settings for safety
      ctx.shadowBlur = 0;
    };

    draw();

    return () => {
      window.removeEventListener('resize', updateSize);
      cancelAnimationFrame(animationId);
    };
  }, [analyser]);

  return (
    <div className="w-full h-full">
      <canvas 
        ref={canvasRef} 
        className="block w-full h-full"
      />
    </div>
  );
}
