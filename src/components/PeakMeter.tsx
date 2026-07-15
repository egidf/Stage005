import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../utils';

interface PeakMeterProps {
  analyser?: AnalyserNode | null;
  analyserLeft?: AnalyserNode | null;
  analyserRight?: AnalyserNode | null;
  className?: string;
  isClipping?: boolean;
}

export function PeakMeter({ 
  analyser, 
  analyserLeft, 
  analyserRight, 
  className, 
  isClipping = false 
}: PeakMeterProps) {
  const maskLeftRef = useRef<HTMLDivElement>(null);
  const maskRightRef = useRef<HTMLDivElement>(null);
  const maskMonoRef = useRef<HTMLDivElement>(null);
  const [clip, setClip] = useState(false);

  useEffect(() => {
    if (isClipping) {
      setClip(true);
      const t = setTimeout(() => setClip(false), 500);
      return () => clearTimeout(t);
    }
  }, [isClipping]);

  useEffect(() => {
    const setupMeter = (maskElement: HTMLDivElement | null, node: AnalyserNode | null | undefined) => {
      if (!maskElement || !node) return;

      let animationFrameId: number;
      const dataArray = new Float32Array(node.fftSize);

      const draw = () => {
        animationFrameId = requestAnimationFrame(draw);

        try {
          node.getFloatTimeDomainData(dataArray);
        } catch (e) {
          // Fallback if some browsers have issues with getFloatTimeDomainData
          return;
        }

        let peak = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const val = Math.abs(dataArray[i]);
          if (val > peak) {
            peak = val;
          }
        }

        const level = Math.min(1, peak);
        const heightPercent = (1 - level) * 100;
        maskElement.style.height = `${heightPercent}%`;
      };

      draw();
      return () => cancelAnimationFrame(animationFrameId);
    };

    let cleanLeft: (() => void) | undefined;
    let cleanRight: (() => void) | undefined;
    let cleanMono: (() => void) | undefined;

    if (analyserLeft && analyserRight) {
      cleanLeft = setupMeter(maskLeftRef.current, analyserLeft);
      cleanRight = setupMeter(maskRightRef.current, analyserRight);
    } else if (analyser) {
      cleanMono = setupMeter(maskMonoRef.current, analyser);
    }

    return () => {
      if (cleanLeft) cleanLeft();
      if (cleanRight) cleanRight();
      if (cleanMono) cleanMono();
    };
  }, [analyser, analyserLeft, analyserRight]);

  const showStereo = !!(analyserLeft && analyserRight);

  return (
    <div className={cn("flex bg-[#111317] border border-white/5 rounded p-2 gap-3 select-none h-full w-full", className)}>
      {showStereo ? (
        <div className="flex gap-2.5 flex-1 items-stretch justify-center w-full h-full min-h-0">
          {/* L Channel */}
          <div className="flex flex-col items-center flex-1 h-full min-w-[8px] max-w-[20px] min-h-0">
            <span className="text-[9px] font-mono font-bold text-zinc-500 mb-0.5 select-none">L</span>
            <div className={cn("w-full h-1 mb-1 rounded-sm transition-colors duration-150 flex-shrink-0", clip ? "bg-red-500 shadow-[0_0_8px_#ef4444]" : "bg-red-950/65")} />
            <div className="w-full flex-1 min-h-0 relative">
              <div className="absolute inset-0 w-full h-full rounded bg-[#0b0d10] overflow-hidden">
                {/* Level Gradient */}
                <div className="absolute inset-0 bg-gradient-to-t from-emerald-500 via-amber-400 to-red-500" />
                {/* CSS Transitioned Covering Mask */}
                <div 
                  ref={maskLeftRef} 
                  className="absolute top-0 left-0 right-0 bg-[#0b0d10] transition-[height] duration-75 ease-out" 
                  style={{ height: '100%' }} 
                />
                {/* Segment Line Overlays (LED style blocks) */}
                <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                  {Array.from({ length: 20 }).map((_, idx) => (
                    <div key={idx} className="w-full h-[1.5px] bg-[#111317] opacity-80" />
                  ))}
                </div>
              </div>
            </div>
          </div>
          {/* R Channel */}
          <div className="flex flex-col items-center flex-1 h-full min-w-[8px] max-w-[20px] min-h-0">
            <span className="text-[9px] font-mono font-bold text-zinc-500 mb-0.5 select-none">R</span>
            <div className={cn("w-full h-1 mb-1 rounded-sm transition-colors duration-150 flex-shrink-0", clip ? "bg-red-500 shadow-[0_0_8px_#ef4444]" : "bg-red-950/65")} />
            <div className="w-full flex-1 min-h-0 relative">
              <div className="absolute inset-0 w-full h-full rounded bg-[#0b0d10] overflow-hidden">
                {/* Level Gradient */}
                <div className="absolute inset-0 bg-gradient-to-t from-emerald-500 via-amber-400 to-red-500" />
                {/* CSS Transitioned Covering Mask */}
                <div 
                  ref={maskRightRef} 
                  className="absolute top-0 left-0 right-0 bg-[#0b0d10] transition-[height] duration-75 ease-out" 
                  style={{ height: '100%' }} 
                />
                {/* Segment Line Overlays (LED style blocks) */}
                <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                  {Array.from({ length: 20 }).map((_, idx) => (
                    <div key={idx} className="w-full h-[1.5px] bg-[#111317] opacity-80" />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center flex-1 h-full min-w-[8px] max-w-[20px] min-h-0">
          <span className="text-[9px] font-mono font-bold text-zinc-500 mb-0.5 select-none">M</span>
          <div className={cn("w-full h-1 mb-1 rounded-sm transition-colors duration-150 flex-shrink-0", clip ? "bg-red-500 shadow-[0_0_8px_#ef4444]" : "bg-red-950/65")} />
          <div className="w-full flex-1 min-h-0 relative">
            <div className="absolute inset-0 w-full h-full rounded bg-[#0b0d10] overflow-hidden">
              {/* Level Gradient */}
              <div className="absolute inset-0 bg-gradient-to-t from-emerald-500 via-amber-400 to-red-500" />
              {/* CSS Transitioned Covering Mask */}
              <div 
                ref={maskMonoRef} 
                className="absolute top-0 left-0 right-0 bg-[#0b0d10] transition-[height] duration-75 ease-out" 
                style={{ height: '100%' }} 
              />
              {/* Segment Line Overlays (LED style blocks) */}
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                {Array.from({ length: 20 }).map((_, idx) => (
                  <div key={idx} className="w-full h-[1.5px] bg-[#111317] opacity-80" />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
