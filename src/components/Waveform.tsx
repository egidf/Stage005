import React, { useRef, useEffect } from 'react';

interface WaveformProps {
  peaks?: number[];
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
}

export function Waveform({ peaks, currentTime, duration, onSeek }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    if (!peaks || peaks.length === 0) {
      // Draw placeholder line if no peaks
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.strokeStyle = '#334155'; // slate-700
      ctx.lineWidth = 2;
      ctx.stroke();
      return;
    }

    const progress = duration > 0 ? currentTime / duration : 0;
    const progressX = progress * width;

    // Draw peaks
    const barWidth = width / peaks.length;
    
    peaks.forEach((peak, i) => {
      const x = i * barWidth;
      const barHeight = Math.max(2, peak * height * 0.9);
      const y = (height - barHeight) / 2;
      
      if (x < progressX) {
        ctx.fillStyle = '#F27D26'; // primary orange for played
      } else {
        ctx.fillStyle = '#475569'; // slate-600 for unplayed
      }
      
      // Add slight gap between bars
      ctx.fillRect(x, y, barWidth - 1, barHeight);
    });

    // Draw playhead
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(progressX, 0, 2, height);
    
  }, [peaks, currentTime, duration]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (duration <= 0) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    onSeek(percentage * duration);
  };

  return (
    <div className="relative w-full h-16 bg-black/40 rounded-md overflow-hidden cursor-pointer border border-white/5">
      <canvas
        ref={canvasRef}
        width={800}
        height={64}
        onClick={handleClick}
        className="w-full h-full"
      />
    </div>
  );
}
