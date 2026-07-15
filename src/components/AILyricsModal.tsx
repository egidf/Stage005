import React from 'react';
import { X, Loader2, Music, Guitar } from 'lucide-react';
import { Track } from '../types';

interface AILyricsModalProps {
  track: Track;
  onClose: () => void;
}

export function AILyricsModal({ track, onClose }: AILyricsModalProps) {
  const data = track.aiLyricsChords;

  if (!data) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-[#111317] border border-white/10 rounded-xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col relative overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-[#1E2024]">
          <div className="flex items-center gap-3">
            <Guitar className="w-5 h-5 text-[#F27D26]" />
            <div>
              <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-widest">{data.title}</h3>
              <p className="text-xs text-zinc-400 font-mono">{data.artist}</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors border border-white/5"
          >
            <X className="w-4 h-4 text-zinc-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-custom">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            
            {/* Left Sidebar: Metadata */}
            <div className="md:col-span-1 flex flex-col gap-4">
              <div className="bg-black/40 border border-white/5 rounded-lg p-4 space-y-3">
                <div>
                  <span className="block text-[10px] text-zinc-500 font-mono tracking-widest uppercase mb-1">Key</span>
                  <span className="text-sm font-bold text-zinc-200">{data.key}</span>
                </div>
                <div>
                  <span className="block text-[10px] text-zinc-500 font-mono tracking-widest uppercase mb-1">Tempo</span>
                  <span className="text-sm font-bold text-zinc-200">{data.tempo}</span>
                </div>
                <div>
                  <span className="block text-[10px] text-zinc-500 font-mono tracking-widest uppercase mb-1">Strumming</span>
                  <span className="text-sm font-bold text-zinc-200">{data.strumming}</span>
                </div>
                <div>
                  <span className="block text-[10px] text-zinc-500 font-mono tracking-widest uppercase mb-1">Difficulty</span>
                  <span className="inline-flex items-center px-2 py-1 rounded bg-[#F27D26]/10 text-[#F27D26] text-xs font-bold border border-[#F27D26]/20 uppercase">
                    {data.difficulty}
                  </span>
                </div>
              </div>
              
              <div className="bg-[#1E2024]/50 border border-white/5 rounded-lg p-4">
                <span className="block text-[10px] text-[#34D399] font-mono tracking-widest uppercase mb-2">History & Context</span>
                <p className="text-xs text-zinc-400 leading-relaxed italic">
                  {data.history}
                </p>
              </div>
            </div>

            {/* Right Content: Chords Sheet */}
            <div className="md:col-span-3 bg-[#1A1C20] border border-white/5 rounded-lg p-6 shadow-inner overflow-x-auto">
              <pre className="text-sm md:text-base text-zinc-300 font-mono leading-relaxed whitespace-pre" style={{ tabSize: 4 }}>
                {data.chordsSheet}
              </pre>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
