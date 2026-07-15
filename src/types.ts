export interface AudioAnalysis {
  gainAdjustment: number;
  bassEQ: number;
  midEQ: number;
  trebleEQ: number;
  stereoWidth: number; // 0.0 to 2.0
  analyzed: boolean;
}

export type PluginType = 'eq16' | 'reverb' | 'compressor' | 'limiter' | 'stereo' | 'linux_wrapper';

export interface PluginBase {
  id: string;
  type: PluginType;
  enabled: boolean;
  name: string;
}

export interface EQ16Plugin extends PluginBase {
  type: 'eq16';
  params: { bands: number[] }; // 16 values
}

export interface ReverbPlugin extends PluginBase {
  type: 'reverb';
  params: { mix: number; decay: number; preDelay: number };
}

export interface CompressorPlugin extends PluginBase {
  type: 'compressor';
  params: { threshold: number; ratio: number; attack: number; release: number };
}

export interface LimiterPlugin extends PluginBase {
  type: 'limiter';
  params: { threshold: number; ratio: number; release?: number };
}

export interface StereoPlugin extends PluginBase {
  type: 'stereo';
  params: { pan: number; width: number };
}

export interface LinuxWrapperPlugin extends PluginBase {
  type: 'linux_wrapper';
  pluginId: string; // e.g. 'calf_delay', 'lsp_deesser', 'calf_exciter', 'calf_gate'
  params: { [key: string]: number };
  paramSpecs: {
    key: string;
    label: string;
    min: number;
    max: number;
    step: number;
    unit: string;
  }[];
}

export type AudioPlugin = EQ16Plugin | ReverbPlugin | CompressorPlugin | LimiterPlugin | StereoPlugin | LinuxWrapperPlugin;

export interface RackSettings {
  plugins: AudioPlugin[];
}

export interface AiLyricsChords {
  title: string;
  artist: string;
  key: string;
  tempo: string;
  strumming: string;
  difficulty: string;
  chordsSheet: string;
  originalChordsSheet?: string;
  history: string;
}

export interface Track {
  id: string;
  file: File;
  name: string;
  url: string;
  volume: number; // Individual volume adjustment from 0.0 to 1.0
  analysis?: AudioAnalysis;
  peaks?: number[];
  agendaTime?: string;
  agendaEndTime?: string;
  duration?: number;
  isRemote?: boolean;
  aiLyricsChords?: AiLyricsChords;
}

export interface Playlist {
  id: string;
  name: string;
  tracks: {
    id: string;
    file: File;
    name: string;
    volume: number;
    analysis?: AudioAnalysis;
    peaks?: number[];
    agendaTime?: string;
    agendaEndTime?: string;
    duration?: number;
    isRemote?: boolean;
    aiLyricsChords?: AiLyricsChords;
  }[];
}
