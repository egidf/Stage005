import React, { useState, useEffect, useRef } from 'react';
import { X, Server, Plus, Power, Trash2, RotateCcw } from 'lucide-react';
import { RackSettings, AudioPlugin, PluginType } from '../types';
import { cn } from '../utils';

interface RackProcessorProps {
  deckName: string;
  settings: RackSettings;
  onChange: (settings: RackSettings) => void;
  onClose: () => void;
  onSwitchDeck: (deck: 'A' | 'B') => void;
  analyser?: AnalyserNode | null;
  onReset: () => void;
}

interface PluginVisualizerProps {
  analyser: AnalyserNode | null | undefined;
  type: PluginType | string;
  isEnabled: boolean;
}

export function PluginVisualizer({ analyser, type, isEnabled }: PluginVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let bufferLength = analyser ? analyser.frequencyBinCount : 32;
    let dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationId = requestAnimationFrame(draw);

      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);

      if (analyser && isEnabled) {
        if (type === 'compressor' || type === 'limiter') {
          analyser.getByteTimeDomainData(dataArray);
        } else {
          analyser.getByteFrequencyData(dataArray);
        }
      } else {
        // Simulated glowing idle pattern
        for (let i = 0; i < bufferLength; i++) {
          dataArray[i] = 128 + Math.sin(i * 0.25 + Date.now() * 0.004) * 12;
        }
      }

      ctx.lineWidth = 1.5;

      if (type === 'eq16') {
        const barWidth = (width / bufferLength) * 2.5;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
          const val = analyser && isEnabled ? dataArray[i] : (15 + Math.sin(i * 0.4 + Date.now() * 0.003) * 6);
          const intensity = val / 255;
          const barHeight = intensity * height * 0.9;

          const gradient = ctx.createLinearGradient(0, height, 0, height - barHeight);
          gradient.addColorStop(0, '#064e3b');
          gradient.addColorStop(0.5, '#10b981');
          gradient.addColorStop(1, '#34d399');

          ctx.fillStyle = gradient;
          ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
          x += barWidth;
        }
      } else if (type === 'compressor') {
        ctx.strokeStyle = '#eab308';
        ctx.beginPath();
        const sliceWidth = width / bufferLength;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0;
          const y = (v * height) / 2;
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
          x += sliceWidth;
        }
        ctx.stroke();

        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.fillStyle = 'rgba(234, 179, 8, 0.05)';
        ctx.fill();
      } else if (type === 'limiter') {
        const barWidth = (width / bufferLength) * 2.5;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
          const val = analyser && isEnabled ? dataArray[i] : (15 + Math.cos(i * 0.3 + Date.now() * 0.004) * 8);
          const intensity = val / 255;
          const barHeight = intensity * height * 0.95;

          const gradient = ctx.createLinearGradient(0, height, 0, height - barHeight);
          gradient.addColorStop(0, '#7f1d1d');
          gradient.addColorStop(0.6, '#ef4444');
          gradient.addColorStop(1, '#f87171');

          ctx.fillStyle = gradient;
          ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
          x += barWidth;
        }
      } else if (type === 'reverb') {
        ctx.strokeStyle = '#3b82f6';
        ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
        ctx.beginPath();
        const sliceWidth = width / bufferLength;
        let x = 0;
        ctx.moveTo(0, height);
        for (let i = 0; i < bufferLength; i++) {
          const val = analyser && isEnabled ? dataArray[i] : (25 + Math.sin(i * 0.15 + Date.now() * 0.002) * 12);
          const intensity = val / 255;
          const y = height - intensity * height * 0.85;
          ctx.lineTo(x, y);
          x += sliceWidth;
        }
        ctx.lineTo(width, height);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (type === 'stereo') {
        ctx.strokeStyle = '#a855f7';
        ctx.fillStyle = 'rgba(168, 85, 247, 0.08)';
        ctx.beginPath();
        const sliceWidth = width / bufferLength;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
          const val = analyser && isEnabled ? dataArray[i] : (35 + Math.sin(i * 0.35 + Date.now() * 0.005) * 8);
          const intensity = val / 255;
          const y = height / 2 + Math.sin(i * 0.2) * intensity * height * 0.45;
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
          x += sliceWidth;
        }
        ctx.stroke();
      } else {
        const strokeColor = type.startsWith('calf_') ? '#F27D26' : '#10B981';
        ctx.strokeStyle = strokeColor;
        ctx.beginPath();
        const sliceWidth = width / bufferLength;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
          const val = analyser && isEnabled ? dataArray[i] : (20 + Math.cos(i * 0.25 + Date.now() * 0.003) * 10);
          const intensity = val / 255;
          const y = height - intensity * height * 0.8;
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
          x += sliceWidth;
        }
        ctx.stroke();
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [analyser, type, isEnabled]);

  return (
    <div className="w-full h-full relative bg-black/60 rounded border border-white/5 overflow-hidden shadow-inner flex items-center justify-center">
      <canvas ref={canvasRef} width={280} height={32} className="w-full h-full opacity-75" />
    </div>
  );
}

const Screw = () => (
  <div className="w-3 h-3 rounded-full bg-gradient-to-br from-[#64748B] via-[#475569] to-[#0F172A] border border-black shadow-[inset_1px_1px_1px_rgba(255,255,255,0.2)] flex items-center justify-center">
    <div className="w-2.5 h-[1.5px] bg-black/80 rotate-45" />
  </div>
);

// High-fidelity rotary knob with native drag-interaction
const RotaryKnob = ({ 
  label, value, min, max, step, onChange, unit = "", color = "#F59E0B"
}: { 
  label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void, unit?: string, color?: string, key?: string 
}) => {
  const percentage = (value - min) / (max - min);
  const angle = -135 + percentage * 270;

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startVal = value;
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY; // Drag up to increase, down to decrease
      const range = max - min;
      const sensitivity = 150; // pixels of drag to span the entire range
      const deltaVal = (deltaY / sensitivity) * range;
      let newVal = startVal + deltaVal;
      newVal = Math.min(max, Math.max(min, newVal));
      newVal = Math.round(newVal / step) * step;
      onChange(newVal);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className="flex flex-col items-center gap-2 select-none group">
      <span className="text-[9px] font-bold tracking-widest text-[#94A3B8] uppercase text-center">{label}</span>
      <div 
        onMouseDown={handleMouseDown}
        className="w-11 h-11 rounded-full bg-gradient-to-b from-[#3F3F46] to-[#18181B] border-2 border-[#27272A] shadow-md flex items-center justify-center cursor-ns-resize relative active:scale-95 transition-transform"
      >
        {/* Outer tick indicator */}
        <div className="absolute inset-0.5 rounded-full border border-black/40" />
        {/* Knob pointer line */}
        <div 
          className="w-0.5 h-4 absolute origin-bottom bottom-1/2 left-[20px] transition-transform duration-75"
          style={{ transform: `rotate(${angle}deg)` }}
        >
          <div className="w-0.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: color }} />
        </div>
        {/* Cap center */}
        <div className="w-5 h-5 rounded-full bg-gradient-to-t from-[#18181B] to-[#27272A] border border-black/30 flex items-center justify-center shadow-md">
          <div className="w-1 h-1 rounded-full bg-zinc-600" />
        </div>
      </div>
      <span className="text-[10px] font-mono font-bold text-zinc-300 bg-[#0B0F19] px-2 py-0.5 rounded border border-white/5 min-w-[50px] text-center shadow-inner">
        {value.toFixed(1)}{unit}
      </span>
    </div>
  );
};

export function RackProcessor({ deckName, settings, onChange, onClose, onSwitchDeck, analyser, onReset }: RackProcessorProps) {
  const [showAddMenu, setShowAddMenu] = useState(false);

  const handleUpdatePlugin = (id: string, newParams: any) => {
    onChange({
      plugins: settings.plugins.map(p => p.id === id ? { ...p, params: newParams } : p)
    });
  };

  const handleTogglePlugin = (id: string) => {
    onChange({
      plugins: settings.plugins.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p)
    });
  };

  const handleRemovePlugin = (id: string) => {
    onChange({
      plugins: settings.plugins.filter(p => p.id !== id)
    });
  };

  const handleAddPlugin = (type: PluginType) => {
    const newPlugin: AudioPlugin = (() => {
      const id = type + '-' + Date.now();
      switch (type) {
        case 'eq16': return { id, type, name: 'LSP Parametric Equalizer', enabled: true, params: { bands: new Array(16).fill(0) } };
        case 'reverb': return { id, type, name: 'Calf Reverb', enabled: true, params: { mix: 0.1, decay: 2.0, preDelay: 0.02 } };
        case 'compressor': return { id, type, name: 'Calf Studio Compressor', enabled: true, params: { threshold: -24, ratio: 4, attack: 0.003, release: 0.25 } };
        case 'limiter': return { id, type, name: 'Calf Vintage Limiter', enabled: true, params: { threshold: -0.5, ratio: 20 } };
        case 'stereo': return { id, type, name: 'LSP Stereo Width', enabled: true, params: { pan: 0, width: 1.0 } };
        default: return { id, type: 'stereo', name: 'LSP Stereo Width', enabled: true, params: { pan: 0, width: 1.0 } };
      }
    })();
    onChange({ plugins: [...settings.plugins, newPlugin] });
    setShowAddMenu(false);
  };

  const handleAddLinuxPlugin = (pluginId: string, name: string, params: any, paramSpecs: any[]) => {
    const id = 'linux-' + pluginId + '-' + Date.now();
    const newPlugin: AudioPlugin = {
      id,
      type: 'linux_wrapper',
      name,
      enabled: true,
      pluginId,
      params,
      paramSpecs
    };
    onChange({ plugins: [...settings.plugins, newPlugin] });
    setShowAddMenu(false);
  };

  const getCurvePath = (bands: number[]) => {
    const points = bands.map((gain, idx) => {
      const x = (idx / 15) * 500; // Map across SVG width (500)
      // Gain range is -20 to +20. Map to 0 to 60 (center at 30)
      const y = 30 - (gain / 20) * 24;
      return { x, y };
    });
    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i+1];
      const cpX1 = p0.x + 15;
      const cpY1 = p0.y;
      const cpX2 = p1.x - 15;
      const cpY2 = p1.y;
      path += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${p1.x} ${p1.y}`;
    }
    return path;
  };

  return (
    <div className="h-full flex flex-col bg-[#111317] relative overflow-hidden select-none">
      {/* Header */}
      <div className="px-4 py-3 bg-[#15181C] border-b border-black flex items-center justify-between text-xs uppercase tracking-widest text-[#94A3B8] font-bold flex-shrink-0 shadow-lg">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-[#10B981]" />
            <span className="text-[#E2E8F0] tracking-widest font-mono">LSP/CALF ANALOG RACK</span>
          </div>
          <div className="w-[1.5px] h-3 bg-white/15"></div>
          <div className="flex items-center bg-black/60 rounded-md p-0.5 border border-white/5">
            <button 
              onClick={() => onSwitchDeck('A')}
              className={cn("px-3 py-1 rounded font-mono text-[11px] font-bold transition-all", deckName === 'A' ? "bg-[#10B981]/25 text-[#10B981] border border-[#10B981]/20 shadow-[0_0_8px_rgba(16,185,129,0.15)]" : "text-[#64748B] hover:text-[#94A3B8]")}
            >
              DECK A (MAIN)
            </button>
            <button 
              onClick={() => onSwitchDeck('B')}
              className={cn("px-3 py-1 rounded font-mono text-[11px] font-bold transition-all", deckName === 'B' ? "bg-[#10B981]/25 text-[#10B981] border border-[#10B981]/20 shadow-[0_0_8px_rgba(16,185,129,0.15)]" : "text-[#64748B] hover:text-[#94A3B8]")}
            >
              DECK B (BGM)
            </button>
          </div>
        </div>
        <button onClick={onClose} className="text-[#64748B] hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Rack Body */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-[#14171C]" style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 19px, rgba(0,0,0,0.15) 20px)' }}>
        
        {settings.plugins.map(plugin => {
          const isEnabled = plugin.enabled;
          const toggleOpacity = isEnabled ? 'opacity-100' : 'opacity-40 grayscale';
          
          if (plugin.type === 'eq16') {
            return (
              <div key={plugin.id} className={cn("border-2 border-[#1E293B] rounded-lg bg-[#1E2024] relative flex items-stretch transition-all shadow-[0_4px_15px_rgba(0,0,0,0.4)]", toggleOpacity)}>
                <div className="w-6 bg-gradient-to-r from-[#2A2E35] to-[#1E2024] border-r border-black/60 flex flex-col justify-between items-center py-3">
                  <Screw /><Screw />
                </div>
                <div className="flex-1 p-4 flex flex-col bg-gradient-to-b from-[#1C1E22] to-[#121316]">
                  {/* Module Title bar */}
                  <div className="flex items-center justify-between mb-3 border-b border-black/40 pb-2">
                    <span className="text-[#10B981] text-xs font-bold uppercase tracking-widest font-mono flex items-center gap-2">
                      <div className={cn("w-2 h-2 rounded-full transition-all duration-300", isEnabled ? "bg-[#10B981] shadow-[0_0_10px_#10B981]" : "bg-zinc-700 shadow-none")} />
                      LSP GRAPHIC EQUALIZER X16
                    </span>
                    <div className="flex items-center gap-3">
                      <button onClick={() => handleTogglePlugin(plugin.id)} className={cn("text-xs font-bold px-3 py-1 rounded flex items-center gap-1 border transition-all font-mono", isEnabled ? "bg-[#10B981]/15 text-[#10B981] border-[#10B981]/30 shadow-[0_0_8px_rgba(16,185,129,0.1)]" : "bg-zinc-800 text-zinc-500 border-zinc-700")}>
                        <Power className="w-3 h-3" />
                        {isEnabled ? "ACTIVE" : "BYPASS"}
                      </button>
                      <button onClick={() => handleRemovePlugin(plugin.id)} className="text-zinc-600 hover:text-red-400 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* High Fidelity Curve Display */}
                  <div className="h-16 bg-[#0B0F19] rounded-lg border border-zinc-800 relative overflow-hidden mb-4 shadow-inner flex items-center justify-center">
                    {/* Visualizer Background */}
                    <div className="absolute inset-0 opacity-30">
                      <PluginVisualizer analyser={analyser} type="eq16" isEnabled={isEnabled} />
                    </div>
                    {/* SVG Grid Lines */}
                    <div className="absolute inset-0 grid grid-cols-16 grid-rows-5 pointer-events-none opacity-10">
                      {Array.from({ length: 15 }).map((_, i) => (
                        <div key={i} className="border-r border-dashed border-zinc-400 h-full" />
                      ))}
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="border-b border-dashed border-zinc-400 w-full col-span-16" />
                      ))}
                    </div>
                    {/* Curve */}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox="0 0 500 60">
                      <path 
                        d={getCurvePath(plugin.params.bands)} 
                        fill="none" 
                        stroke="#10B981" 
                        strokeWidth="2" 
                        className="transition-all duration-150 drop-shadow-[0_0_4px_#10B981]"
                      />
                    </svg>
                    {/* Center neutral reference line */}
                    <div className="absolute left-0 right-0 h-px bg-[#10B981]/25 top-1/2 border-dashed" />
                  </div>

                  {/* Vertical Faders panel */}
                  <div className="flex items-center justify-between flex-1 bg-gradient-to-b from-[#111317] to-[#0A0B0D] rounded-lg border border-black p-3 gap-2 overflow-x-auto shadow-inner relative min-h-[140px]">
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(i => {
                      const dbValue = plugin.params.bands[i] || 0;
                      return (
                        <div key={i} className="flex flex-col items-center justify-between h-full min-w-[28px] relative group/fader">
                          <span className="text-[9px] font-mono font-bold text-zinc-400">
                            {dbValue > 0 ? `+${dbValue.toFixed(0)}` : dbValue.toFixed(0)}
                          </span>
                          <div className="h-20 flex items-center justify-center relative w-full my-2">
                            {/* Fader Track trackline */}
                            <div className="w-1 h-full bg-zinc-950 rounded border border-zinc-800 shadow-inner flex items-center justify-center relative">
                              <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-zinc-800" /> {/* 0dB marker */}
                              {/* LED level indicator */}
                              <div 
                                className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[#10B981]/40 to-[#10B981]/80 rounded"
                                style={{ height: `${((dbValue + 20) / 40) * 100}%` }}
                              />
                            </div>
                            {/* Fader Handle */}
                            <input
                              type="range"
                              min={-20} max={20} step={0.5}
                              value={dbValue}
                              onChange={(e) => {
                                const newBands = [...plugin.params.bands];
                                newBands[i] = Number(e.target.value);
                                handleUpdatePlugin(plugin.id, { bands: newBands });
                              }}
                              className="absolute w-6 h-20 opacity-0 cursor-ns-resize z-10"
                              style={{ WebkitAppearance: 'slider-vertical' } as any}
                            />
                            {/* Visual Fader Cap */}
                            <div 
                              className="absolute w-5 h-3 bg-gradient-to-b from-[#E2E8F0] via-[#94A3B8] to-[#475569] border border-black/80 rounded-md shadow-md pointer-events-none flex flex-col justify-center gap-0.5 items-center transition-all duration-75"
                              style={{ bottom: `calc(${((dbValue + 20) / 40) * 100}% - 6px)` }}
                            >
                              <div className="w-full h-0.5 bg-white/60" />
                              <div className="w-full h-0.5 bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.8)]" />
                              <div className="w-full h-0.5 bg-black/40" />
                            </div>
                          </div>
                          <span className="text-[8px] font-mono font-bold text-zinc-500 mt-1">
                            {i < 5 ? ['16','25','40','63','100'][i] : i < 10 ? ['160','250','400','630','1k'][i-5] : ['1.6k','2.5k','4k','6.3k','10k','16k'][i-10]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="w-6 bg-gradient-to-l from-[#2A2E35] to-[#1E2024] border-l border-black/60 flex flex-col justify-between items-center py-3">
                  <Screw /><Screw />
                </div>
              </div>
            );
          }
          
          if (plugin.type === 'compressor') {
            return (
              <div key={plugin.id} className={cn("border-2 border-[#1E293B] rounded-lg bg-[#1E2024] relative flex items-stretch transition-all shadow-[0_4px_15px_rgba(0,0,0,0.4)]", toggleOpacity)}>
                <div className="w-6 bg-gradient-to-r from-[#2A2E35] to-[#1E2024] border-r border-black/60 flex flex-col justify-between items-center py-3">
                  <Screw /><Screw />
                </div>
                <div className="flex-1 p-4 flex flex-col bg-gradient-to-b from-[#1C1E22] to-[#121316]">
                  <div className="flex items-center justify-between mb-4 border-b border-black/40 pb-2">
                    <span className="text-[#FBBF24] text-xs font-bold uppercase tracking-widest font-mono flex items-center gap-2">
                      <div className={cn("w-2 h-2 rounded-full transition-all duration-300", isEnabled ? "bg-[#FBBF24] shadow-[0_0_10px_#FBBF24]" : "bg-zinc-700 shadow-none")} />
                      CALF STUDIO COMPRESSOR
                    </span>
                    <div className="flex items-center gap-3">
                      <button onClick={() => handleTogglePlugin(plugin.id)} className={cn("text-xs font-bold px-3 py-1 rounded flex items-center gap-1 border transition-all font-mono", isEnabled ? "bg-[#FBBF24]/15 text-[#FBBF24] border-[#FBBF24]/30 shadow-[0_0_8px_rgba(251,191,36,0.1)]" : "bg-zinc-800 text-zinc-500 border-zinc-700")}>
                        <Power className="w-3 h-3" />
                        {isEnabled ? "ACTIVE" : "BYPASS"}
                      </button>
                      <button onClick={() => handleRemovePlugin(plugin.id)} className="text-zinc-600 hover:text-red-400 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="h-8 mb-3">
                    <PluginVisualizer analyser={analyser} type="compressor" isEnabled={isEnabled} />
                  </div>
                  <div className="flex items-center justify-around flex-1 bg-gradient-to-b from-[#111317] to-[#0A0B0D] rounded-lg border border-black p-4 gap-4 shadow-inner">
                    <RotaryKnob label="Threshold" value={plugin.params.threshold} min={-60} max={0} step={1} onChange={(v) => handleUpdatePlugin(plugin.id, { ...plugin.params, threshold: v })} unit=" dB" color="#FBBF24" />
                    <RotaryKnob label="Ratio" value={plugin.params.ratio} min={1} max={20} step={0.5} onChange={(v) => handleUpdatePlugin(plugin.id, { ...plugin.params, ratio: v })} unit=" :1" color="#FBBF24" />
                    <RotaryKnob label="Attack" value={plugin.params.attack * 1000} min={1} max={200} step={1} onChange={(v) => handleUpdatePlugin(plugin.id, { ...plugin.params, attack: v / 1000 })} unit=" ms" color="#FBBF24" />
                    <RotaryKnob label="Release" value={plugin.params.release * 1000} min={10} max={1000} step={10} onChange={(v) => handleUpdatePlugin(plugin.id, { ...plugin.params, release: v / 1000 })} unit=" ms" color="#FBBF24" />
                  </div>
                </div>
                <div className="w-6 bg-gradient-to-l from-[#2A2E35] to-[#1E2024] border-l border-black/60 flex flex-col justify-between items-center py-3">
                  <Screw /><Screw />
                </div>
              </div>
            );
          }

          if (plugin.type === 'limiter') {
            return (
              <div key={plugin.id} className={cn("border-2 border-[#1E293B] rounded-lg bg-[#1E2024] relative flex items-stretch transition-all shadow-[0_4px_15px_rgba(0,0,0,0.4)]", toggleOpacity)}>
                <div className="w-6 bg-gradient-to-r from-[#2A2E35] to-[#1E2024] border-r border-black/60 flex flex-col justify-between items-center py-3">
                  <Screw /><Screw />
                </div>
                <div className="flex-1 p-4 flex flex-col bg-gradient-to-b from-[#1C1E22] to-[#121316]">
                  <div className="flex items-center justify-between mb-4 border-b border-black/40 pb-2">
                    <span className="text-[#EF4444] text-xs font-bold uppercase tracking-widest font-mono flex items-center gap-2">
                      <div className={cn("w-2 h-2 rounded-full transition-all duration-300", isEnabled ? "bg-[#EF4444] shadow-[0_0_10px_#EF4444]" : "bg-zinc-700 shadow-none")} />
                      CALF VINTAGE LIMITER
                    </span>
                    <div className="flex items-center gap-3">
                      <button onClick={() => handleTogglePlugin(plugin.id)} className={cn("text-xs font-bold px-3 py-1 rounded flex items-center gap-1 border transition-all font-mono", isEnabled ? "bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30 shadow-[0_0_8px_rgba(239,68,68,0.1)]" : "bg-zinc-800 text-zinc-500 border-zinc-700")}>
                        <Power className="w-3 h-3" />
                        {isEnabled ? "ACTIVE" : "BYPASS"}
                      </button>
                      <button onClick={() => handleRemovePlugin(plugin.id)} className="text-zinc-600 hover:text-red-400 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="h-8 mb-3">
                    <PluginVisualizer analyser={analyser} type="limiter" isEnabled={isEnabled} />
                  </div>
                  <div className="flex items-center justify-around flex-1 bg-gradient-to-b from-[#111317] to-[#0A0B0D] rounded-lg border border-black p-4 gap-4 shadow-inner">
                    <RotaryKnob label="Limit Ceiling" value={plugin.params.threshold} min={-12} max={0} step={0.1} onChange={(v) => handleUpdatePlugin(plugin.id, { ...plugin.params, threshold: v })} unit=" dB" color="#EF4444" />
                    <RotaryKnob label="Release Time" value={plugin.params.release !== undefined ? plugin.params.release : 0.1} min={0.01} max={1.0} step={0.01} onChange={(v) => handleUpdatePlugin(plugin.id, { ...plugin.params, release: v })} unit=" s" color="#EF4444" />
                  </div>
                </div>
                <div className="w-6 bg-gradient-to-l from-[#2A2E35] to-[#1E2024] border-l border-black/60 flex flex-col justify-between items-center py-3">
                  <Screw /><Screw />
                </div>
              </div>
            );
          }

          if (plugin.type === 'reverb') {
            return (
              <div key={plugin.id} className={cn("border-2 border-[#1E293B] rounded-lg bg-[#1E2024] relative flex items-stretch transition-all shadow-[0_4px_15px_rgba(0,0,0,0.4)]", toggleOpacity)}>
                <div className="w-6 bg-gradient-to-r from-[#2A2E35] to-[#1E2024] border-r border-black/60 flex flex-col justify-between items-center py-3">
                  <Screw /><Screw />
                </div>
                <div className="flex-1 p-4 flex flex-col bg-gradient-to-b from-[#1C1E22] to-[#121316]">
                  <div className="flex items-center justify-between mb-4 border-b border-black/40 pb-2">
                    <span className="text-[#3B82F6] text-xs font-bold uppercase tracking-widest font-mono flex items-center gap-2">
                      <div className={cn("w-2 h-2 rounded-full transition-all duration-300", isEnabled ? "bg-[#3B82F6] shadow-[0_0_10px_#3B82F6]" : "bg-zinc-700 shadow-none")} />
                      CALF REVERB FX
                    </span>
                    <div className="flex items-center gap-3">
                      <button onClick={() => handleTogglePlugin(plugin.id)} className={cn("text-xs font-bold px-3 py-1 rounded flex items-center gap-1 border transition-all font-mono", isEnabled ? "bg-[#3B82F6]/15 text-[#3B82F6] border-[#3B82F6]/30 shadow-[0_0_8px_rgba(59,130,246,0.1)]" : "bg-zinc-800 text-zinc-500 border-zinc-700")}>
                        <Power className="w-3 h-3" />
                        {isEnabled ? "ACTIVE" : "BYPASS"}
                      </button>
                      <button onClick={() => handleRemovePlugin(plugin.id)} className="text-zinc-600 hover:text-red-400 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="h-8 mb-3">
                    <PluginVisualizer analyser={analyser} type="reverb" isEnabled={isEnabled} />
                  </div>
                  <div className="flex items-center justify-around flex-1 bg-gradient-to-b from-[#111317] to-[#0A0B0D] rounded-lg border border-black p-4 gap-4 shadow-inner">
                    <RotaryKnob label="Wet Mix" value={plugin.params.mix} min={0} max={1} step={0.01} onChange={(v) => handleUpdatePlugin(plugin.id, { ...plugin.params, mix: v })} unit="" color="#3B82F6" />
                    <RotaryKnob label="Room Decay" value={plugin.params.decay} min={0.1} max={10} step={0.1} onChange={(v) => handleUpdatePlugin(plugin.id, { ...plugin.params, decay: v })} unit=" s" color="#3B82F6" />
                    <RotaryKnob label="Pre-Delay" value={plugin.params.preDelay * 1000} min={0} max={100} step={1} onChange={(v) => handleUpdatePlugin(plugin.id, { ...plugin.params, preDelay: v / 1000 })} unit=" ms" color="#3B82F6" />
                  </div>
                </div>
                <div className="w-6 bg-gradient-to-l from-[#2A2E35] to-[#1E2024] border-l border-black/60 flex flex-col justify-between items-center py-3">
                  <Screw /><Screw />
                </div>
              </div>
            );
          }

          if (plugin.type === 'stereo') {
            return (
              <div key={plugin.id} className={cn("border-2 border-[#1E293B] rounded-lg bg-[#1E2024] relative flex items-stretch transition-all shadow-[0_4px_15px_rgba(0,0,0,0.4)]", toggleOpacity)}>
                <div className="w-6 bg-gradient-to-r from-[#2A2E35] to-[#1E2024] border-r border-black/60 flex flex-col justify-between items-center py-3">
                  <Screw /><Screw />
                </div>
                <div className="flex-1 p-4 flex flex-col bg-gradient-to-b from-[#1C1E22] to-[#121316]">
                  <div className="flex items-center justify-between mb-4 border-b border-black/40 pb-2">
                    <span className="text-[#A855F7] text-xs font-bold uppercase tracking-widest font-mono flex items-center gap-2">
                      <div className={cn("w-2 h-2 rounded-full transition-all duration-300", isEnabled ? "bg-[#A855F7] shadow-[0_0_10px_#A855F7]" : "bg-zinc-700 shadow-none")} />
                      LSP STEREO WIDTH CONTROL
                    </span>
                    <div className="flex items-center gap-3">
                      <button onClick={() => handleTogglePlugin(plugin.id)} className={cn("text-xs font-bold px-3 py-1 rounded flex items-center gap-1 border transition-all font-mono", isEnabled ? "bg-[#A855F7]/15 text-[#A855F7] border-[#A855F7]/30 shadow-[0_0_8px_rgba(168,85,247,0.1)]" : "bg-zinc-800 text-zinc-500 border-zinc-700")}>
                        <Power className="w-3 h-3" />
                        {isEnabled ? "ACTIVE" : "BYPASS"}
                      </button>
                      <button onClick={() => handleRemovePlugin(plugin.id)} className="text-zinc-600 hover:text-red-400 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="h-8 mb-3">
                    <PluginVisualizer analyser={analyser} type="stereo" isEnabled={isEnabled} />
                  </div>
                  <div className="flex items-center justify-around flex-1 bg-gradient-to-b from-[#111317] to-[#0A0B0D] rounded-lg border border-black p-4 gap-4 shadow-inner">
                    <RotaryKnob label="Balance Pan" value={plugin.params.pan} min={-1} max={1} step={0.01} onChange={(v) => handleUpdatePlugin(plugin.id, { ...plugin.params, pan: v })} unit="" color="#A855F7" />
                    <RotaryKnob label="Stereo Width" value={plugin.params.width} min={0} max={2} step={0.01} onChange={(v) => handleUpdatePlugin(plugin.id, { ...plugin.params, width: v })} unit="" color="#A855F7" />
                  </div>
                </div>
                <div className="w-6 bg-gradient-to-l from-[#2A2E35] to-[#1E2024] border-l border-black/60 flex flex-col justify-between items-center py-3">
                  <Screw /><Screw />
                </div>
              </div>
            );
          }

          if (plugin.type === 'linux_wrapper') {
            const isEnabled = plugin.enabled;
            const toggleOpacity = isEnabled ? 'opacity-100' : 'opacity-40 grayscale';
            const pluginColor = plugin.pluginId.startsWith('calf_') ? '#F27D26' : '#10B981';
            const badgeBg = plugin.pluginId.startsWith('calf_') ? 'bg-[#F27D26]/15 text-[#F27D26] border-[#F27D26]/30 shadow-[0_0_8px_rgba(242,125,38,0.1)]' : 'bg-[#10B981]/15 text-[#10B981] border-[#10B981]/30 shadow-[0_0_8px_rgba(16,185,129,0.1)]';

            return (
              <div key={plugin.id} className={cn("border-2 border-[#1E293B] rounded-lg bg-[#1E2024] relative flex items-stretch transition-all shadow-[0_4px_15px_rgba(0,0,0,0.4)]", toggleOpacity)}>
                <div className="w-6 bg-gradient-to-r from-[#2A2E35] to-[#1E2024] border-r border-black/60 flex flex-col justify-between items-center py-3">
                  <Screw /><Screw />
                </div>
                <div className="flex-1 p-4 flex flex-col bg-gradient-to-b from-[#1C1E22] to-[#121316]">
                  <div className="flex items-center justify-between mb-4 border-b border-black/40 pb-2">
                    <span className="text-xs font-bold uppercase tracking-widest font-mono flex items-center gap-2" style={{ color: pluginColor }}>
                      <div className={cn("w-2 h-2 rounded-full transition-all duration-300")} style={{ backgroundColor: isEnabled ? pluginColor : '#3F3F46', boxShadow: isEnabled ? `0 0 10px ${pluginColor}` : 'none' }} />
                      {plugin.name}
                    </span>
                    <div className="flex items-center gap-3">
                      <button onClick={() => handleTogglePlugin(plugin.id)} className={cn("text-xs font-bold px-3 py-1 rounded flex items-center gap-1 border transition-all font-mono", isEnabled ? badgeBg : "bg-zinc-800 text-zinc-500 border-zinc-700")}>
                        <Power className="w-3 h-3" />
                        {isEnabled ? "ACTIVE" : "BYPASS"}
                      </button>
                      <button onClick={() => handleRemovePlugin(plugin.id)} className="text-zinc-600 hover:text-red-400 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="h-8 mb-3">
                    <PluginVisualizer analyser={analyser} type={plugin.pluginId} isEnabled={isEnabled} />
                  </div>
                  <div className="flex items-center justify-around flex-1 bg-gradient-to-b from-[#111317] to-[#0A0B0D] rounded-lg border border-black p-4 gap-4 shadow-inner">
                    {plugin.paramSpecs.map(spec => (
                      <RotaryKnob 
                        key={spec.key}
                        label={spec.label}
                        value={plugin.params[spec.key]}
                        min={spec.min}
                        max={spec.max}
                        step={spec.step}
                        onChange={(v) => {
                          const newParams = { ...plugin.params, [spec.key]: v };
                          handleUpdatePlugin(plugin.id, newParams);
                        }}
                        unit={spec.unit}
                        color={pluginColor}
                      />
                    ))}
                  </div>
                </div>
                <div className="w-6 bg-gradient-to-l from-[#2A2E35] to-[#1E2024] border-l border-black/60 flex flex-col justify-between items-center py-3">
                  <Screw /><Screw />
                </div>
              </div>
            );
          }

          return null;
        })}

        {/* Add Plugin & Reset Buttons */}
        <div className="flex items-center gap-3 relative mt-2 self-center z-20">
          <button 
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="flex items-center gap-2 bg-gradient-to-r from-zinc-700 to-zinc-800 hover:from-zinc-600 hover:to-zinc-700 text-zinc-100 border border-zinc-600 px-5 py-2.5 rounded-full font-bold font-mono text-xs tracking-widest uppercase transition-all duration-150 active:scale-95 shadow-xl hover:shadow-[0_0_15px_rgba(255,255,255,0.05)]"
          >
            <Plus className="w-4 h-4 text-[#10B981]" />
            INSERT PROCESSOR
          </button>

          <button 
            onClick={onReset}
            className="flex items-center gap-2 bg-gradient-to-r from-red-950/20 to-red-900/20 hover:from-red-900/30 hover:to-red-800/30 text-red-400 border border-red-900/40 px-5 py-2.5 rounded-full font-bold font-mono text-xs tracking-widest uppercase transition-all duration-150 active:scale-95 shadow-xl hover:shadow-[0_0_15px_rgba(239,68,68,0.05)]"
          >
            <RotateCcw className="w-4 h-4" />
            RESET PLUGINS
          </button>
          
          {showAddMenu && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 bg-[#111317] border border-zinc-800 rounded-lg shadow-[0_10px_30px_rgba(0,0,0,0.8)] p-1 min-w-[240px] flex flex-col gap-0.5 z-30">
              <div className="px-3 py-1.5 text-[9px] font-bold font-mono text-zinc-500 uppercase tracking-wider border-b border-zinc-800/60">Choose DSP Module</div>
              <button onClick={() => handleAddPlugin('eq16')} className="text-left px-3 py-2 text-xs font-bold font-mono text-[#E2E8F0] hover:bg-[#10B981]/15 hover:text-[#10B981] rounded transition-colors">16-BAND EQUALIZER</button>
              <button onClick={() => handleAddPlugin('compressor')} className="text-left px-3 py-2 text-xs font-bold font-mono text-[#E2E8F0] hover:bg-[#FBBF24]/15 hover:text-[#FBBF24] rounded transition-colors">STUDIO COMPRESSOR</button>
              <button onClick={() => handleAddPlugin('limiter')} className="text-left px-3 py-2 text-xs font-bold font-mono text-[#E2E8F0] hover:bg-[#EF4444]/15 hover:text-[#EF4444] rounded transition-colors">VINTAGE LIMITER</button>
              <button onClick={() => handleAddPlugin('reverb')} className="text-left px-3 py-2 text-xs font-bold font-mono text-[#E2E8F0] hover:bg-[#3B82F6]/15 hover:text-[#3B82F6] rounded transition-colors">REVERB ROOM FX</button>
              <button onClick={() => handleAddPlugin('stereo')} className="text-left px-3 py-2 text-xs font-bold font-mono text-[#E2E8F0] hover:bg-[#A855F7]/15 hover:text-[#A855F7] rounded transition-colors">STEREO WIDTH CONTROL</button>
              
              <div className="px-3 py-1.5 text-[9px] font-bold font-mono text-zinc-500 uppercase tracking-wider border-t border-b border-zinc-800/60 mt-1">Linux Plugin Wrappers</div>
              <button 
                onClick={() => handleAddLinuxPlugin(
                  'calf_delay', 
                  'Calf Vintage Delay', 
                  { delayTime: 0.3, feedback: 0.5, mix: 0.3 },
                  [
                    { key: 'delayTime', label: 'Delay Time', min: 0.1, max: 2.0, step: 0.05, unit: ' s' },
                    { key: 'feedback', label: 'Feedback', min: 0.0, max: 0.95, step: 0.01, unit: '' },
                    { key: 'mix', label: 'Wet Mix', min: 0.0, max: 1.0, step: 0.01, unit: '' }
                  ]
                )} 
                className="text-left px-3 py-2 text-xs font-bold font-mono text-[#E2E8F0] hover:bg-[#F27D26]/15 hover:text-[#F27D26] rounded transition-colors"
              >
                CALF VINTAGE DELAY
              </button>
              <button 
                onClick={() => handleAddLinuxPlugin(
                  'calf_exciter', 
                  'Calf Exciter', 
                  { frequency: 4000, amount: 3.0 },
                  [
                    { key: 'frequency', label: 'Harmonic Freq', min: 2000, max: 8000, step: 100, unit: ' Hz' },
                    { key: 'amount', label: 'Harmonics', min: 0.1, max: 10, step: 0.1, unit: ' dB' }
                  ]
                )} 
                className="text-left px-3 py-2 text-xs font-bold font-mono text-[#E2E8F0] hover:bg-[#F27D26]/15 hover:text-[#F27D26] rounded transition-colors"
              >
                CALF EXCITER
              </button>
              <button 
                onClick={() => handleAddLinuxPlugin(
                  'lsp_deesser', 
                  'LSP De-Esser', 
                  { frequency: 6000, intensity: 3.0 },
                  [
                    { key: 'frequency', label: 'Sibilant Freq', min: 3000, max: 10000, step: 100, unit: ' Hz' },
                    { key: 'intensity', label: 'De-ess Amount', min: 0.1, max: 12, step: 0.1, unit: ' dB' }
                  ]
                )} 
                className="text-left px-3 py-2 text-xs font-bold font-mono text-[#E2E8F0] hover:bg-[#10B981]/15 hover:text-[#10B981] rounded transition-colors"
              >
                LSP DE-ESSER
              </button>
              <button 
                onClick={() => handleAddLinuxPlugin(
                  'calf_gate', 
                  'Calf Noise Gate', 
                  { threshold: -40, range: -60, attack: 10, release: 100 },
                  [
                    { key: 'threshold', label: 'Threshold', min: -60, max: -10, step: 0.5, unit: ' dB' },
                    { key: 'range', label: 'Gate Range', min: -80, max: -20, step: 1.0, unit: ' dB' },
                    { key: 'attack', label: 'Attack Time', min: 1, max: 100, step: 1, unit: ' ms' },
                    { key: 'release', label: 'Release Time', min: 10, max: 1000, step: 10, unit: ' ms' }
                  ]
                )} 
                className="text-left px-3 py-2 text-xs font-bold font-mono text-[#E2E8F0] hover:bg-[#F27D26]/15 hover:text-[#F27D26] rounded transition-colors"
              >
                CALF NOISE GATE
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
