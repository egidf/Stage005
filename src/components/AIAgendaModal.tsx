import React, { useState } from 'react';
import { Sparkles, Loader2, X, Plus } from 'lucide-react';
import { Track } from '../types';

interface AgendaItem {
  name: string;
  startTime: string;
  endTime: string;
}

interface AIAgendaModalProps {
  onClose: () => void;
  onApply: (agenda: AgendaItem[]) => void;
}

export function AIAgendaModal({ onClose, onApply }: AIAgendaModalProps) {
  const [prompt, setPrompt] = useState('');
  const [rawData, setRawData] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [generatedAgenda, setGeneratedAgenda] = useState<AgendaItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim() && !rawData.trim()) {
      setError('Please provide a prompt or paste some data.');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/agenda/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, rawData })
      });
      
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to generate agenda');
      }
      
      const data = await response.json();
      setGeneratedAgenda(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApply = () => {
    if (generatedAgenda) {
      onApply(generatedAgenda);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[#1E2024] p-6 rounded-xl border border-white/10 w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-[#E2E8F0] font-semibold text-sm tracking-widest uppercase flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#F27D26]" />
            AI Agenda Manager
          </h3>
          <button onClick={onClose} className="text-[#94A3B8] hover:text-[#E2E8F0]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 space-y-6 min-h-0">
          
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold tracking-widest text-[#94A3B8] uppercase mb-2">
                Paste Excel/CSV Data
              </label>
              <textarea
                value={rawData}
                onChange={e => setRawData(e.target.value)}
                placeholder="Paste your event rundown here..."
                className="w-full bg-black/50 border border-white/10 rounded px-3 py-2 text-[#E2E8F0] focus:outline-none focus:border-[#F27D26] h-32 text-sm font-mono"
              />
            </div>
            
            <div>
              <label className="block text-xs font-semibold tracking-widest text-[#94A3B8] uppercase mb-2">
                Or Describe the Event
              </label>
              <input
                type="text"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="e.g., Create a 30 min farewell ceremony starting at 10:00"
                className="w-full bg-black/50 border border-white/10 rounded px-3 py-2 text-[#E2E8F0] focus:outline-none focus:border-[#F27D26]"
              />
            </div>

            <button
              onClick={handleGenerate}
              disabled={isLoading}
              className="w-full py-3 bg-black/50 border border-white/10 hover:border-[#F27D26] text-[#E2E8F0] rounded font-semibold tracking-widest uppercase text-xs transition-colors flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-[#F27D26]" /> : <Sparkles className="w-4 h-4 text-[#F27D26]" />}
              {isLoading ? 'Processing...' : 'Generate / Parse Agenda'}
            </button>

            {error && (
              <div className="text-red-400 text-xs text-center">{error}</div>
            )}
          </div>

          {generatedAgenda && (
            <div className="space-y-4 pt-4 border-t border-white/10">
              <h4 className="text-xs font-semibold tracking-widest text-[#94A3B8] uppercase">Generated Agenda</h4>
              <div className="bg-black/30 rounded border border-white/5 overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-black/50 text-[#94A3B8] text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-2 font-medium">Time</th>
                      <th className="px-4 py-2 font-medium">Segment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-[#E2E8F0]">
                    {generatedAgenda.map((item, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2 font-mono text-[#F27D26]">
                          {item.startTime} - {item.endTime}
                        </td>
                        <td className="px-4 py-2">{item.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3 pt-4 border-t border-white/10">
          <button 
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold tracking-widest uppercase text-[#94A3B8] hover:text-[#E2E8F0] transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleApply}
            disabled={!generatedAgenda || generatedAgenda.length === 0}
            className="px-6 py-2 text-xs font-semibold tracking-widest uppercase bg-[#F27D26] text-black rounded hover:bg-[#F27D26]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Apply to Playlist
          </button>
        </div>
      </div>
    </div>
  );
}
