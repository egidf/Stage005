/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, ChangeEvent } from 'react';
import { motion } from 'motion/react';
import { 
  Play, 
  Pause, 
  Square, 
  SkipBack, 
  SkipForward, 
  Volume2, 
  Upload, 
  ChevronUp, 
  ChevronDown, 
  Trash2,
  Settings2,
  ListMusic,
  Power,
  Save,
  Plus,
  Sparkles,
  Loader2,
  Repeat,
  Repeat1,
  Activity,
  Shuffle,
  Menu,
  X,
  Download,
  Link2,
  Guitar,
  RefreshCw
} from 'lucide-react';
import { Track, Playlist, LinuxWrapperPlugin, RackSettings, AudioPlugin } from './types';
import { formatTime, cn, parseTrackMetadata } from './utils';
import { savePlaylistToDB, loadPlaylistsFromDB, deletePlaylistFromDB, saveActiveSession, loadActiveSession } from './db';
import { Waveform } from './components/Waveform';
import { SpectrumVisualizer } from './components/SpectrumVisualizer';
import { AIAgendaModal } from './components/AIAgendaModal';
import { AILyricsModal } from './components/AILyricsModal';
import { analyzeAudio } from './aiAnalyzer';
import { PeakMeter } from './components/PeakMeter';
import { RackProcessor } from './components/RackProcessor';

const SOUND_PRESETS: Record<string, { name: string; bass: number; treble: number; comp: { threshold: number; ratio: number }; bands?: number[] }> = {
  custom: { name: 'Custom Rack', bass: 0, treble: 0, comp: { threshold: -24, ratio: 1 } },
  flat: { name: 'Flat', bass: 0, treble: 0, comp: { threshold: -24, ratio: 1 } },
  cinematic: { name: 'Cinematic', bass: 4, treble: 2, comp: { threshold: -20, ratio: 3 } },
  universal: { name: 'Universal', bass: 2, treble: 1, comp: { threshold: -18, ratio: 2.5 } },
  clarity: { name: 'Clarity', bass: -2, treble: 4, comp: { threshold: -16, ratio: 2 } },
  bassBoost: {
    name: 'Bass Boost',
    bass: 4,
    treble: 0,
    comp: { threshold: -20, ratio: 2 },
    bands: [4.0, 6.0, 7.5, 8.0, 7.0, 4.5, 2.0, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
  },
  vocalEnhance: {
    name: 'Vocal Enhance',
    bass: -1,
    treble: 3,
    comp: { threshold: -18, ratio: 2.5 },
    bands: [-2.0, -2.0, -2.0, -2.0, -1.0, 1.0, 1.5, 1.0, 1.5, 2.5, 3.5, 4.0, 3.0, 1.5, 1.0, 0.0]
  },
  fire: { name: 'Fire', bass: 5, treble: 3, comp: { threshold: -24, ratio: 4 } },
  tape: { name: 'Tape', bass: 1, treble: -3, comp: { threshold: -30, ratio: 5 } },
  natural: { name: 'Natural', bass: 0, treble: 0, comp: { threshold: -12, ratio: 1.5 } },
  spatial: { name: 'Spatial', bass: 1, treble: 4, comp: { threshold: -20, ratio: 2 } },
  punch: { name: 'Punch', bass: 6, treble: 1, comp: { threshold: -16, ratio: 6 } },
};
type PresetKey = keyof typeof SOUND_PRESETS;

const DEFAULT_RACK: RackSettings = {
  plugins: [
    { id: 'eq1', type: 'eq16', name: 'LSP Parametric Equalizer', enabled: true, params: { bands: new Array(16).fill(0) } },
    { id: 'ste1', type: 'stereo', name: 'LSP Stereo Width', enabled: true, params: { pan: 0, width: 1.0 } },
    { id: 'comp1', type: 'compressor', name: 'Calf Studio Compressor', enabled: true, params: { threshold: -24, ratio: 4, attack: 0.003, release: 0.25 } },
    { id: 'rev1', type: 'reverb', name: 'Calf Reverb', enabled: true, params: { mix: 0, decay: 2.0, preDelay: 0.02 } },
    { id: 'lim1', type: 'limiter', name: 'Calf Vintage Limiter', enabled: true, params: { threshold: -0.5, ratio: 20 } }
  ]
};

function createReverbBuffer(ctx: BaseAudioContext, decay: number, preDelay: number) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * decay));
  const buffer = ctx.createBuffer(2, len, rate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const preDelaySamples = Math.floor(preDelay * rate);
  
  for (let i = 0; i < len; i++) {
    if (i < preDelaySamples) {
      left[i] = 0;
      right[i] = 0;
    } else {
      const pct = (i - preDelaySamples) / (len - preDelaySamples);
      const dec = Math.pow(1 - pct, 2);
      left[i] = (Math.random() * 2 - 1) * dec;
      right[i] = (Math.random() * 2 - 1) * dec;
    }
  }
  return buffer;
}

export class StereoWidthProcessor {
  input: GainNode;
  output: ChannelMergerNode;
  private splitter: ChannelSplitterNode;
  private midGainLeft: GainNode;
  private midGainRight: GainNode;
  private sideGainLeft: GainNode;
  private sideGainRight: GainNode;
  private midNode: GainNode;
  private sideNode: GainNode;
  private sideWidthGain: GainNode;
  private leftOut: GainNode;
  private rightOut: GainNode;
  private invSideGain: GainNode;
  private panNode: StereoPannerNode | null = null;

  constructor(ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.splitter = ctx.createChannelSplitter(2);
    this.output = ctx.createChannelMerger(2);

    this.midGainLeft = ctx.createGain();
    this.midGainRight = ctx.createGain();
    this.sideGainLeft = ctx.createGain();
    this.sideGainRight = ctx.createGain();

    this.midNode = ctx.createGain();
    this.sideNode = ctx.createGain();
    this.sideWidthGain = ctx.createGain();

    this.leftOut = ctx.createGain();
    this.rightOut = ctx.createGain();
    this.invSideGain = ctx.createGain();

    // Split input to left and right
    this.input.connect(this.splitter);

    // Mid channel: M = 0.5 * (L + R)
    this.midGainLeft.gain.value = 0.5;
    this.midGainRight.gain.value = 0.5;
    this.splitter.connect(this.midGainLeft, 0);
    this.splitter.connect(this.midGainRight, 1);
    this.midGainLeft.connect(this.midNode);
    this.midGainRight.connect(this.midNode);

    // Side channel: S = 0.5 * (L - R)
    this.sideGainLeft.gain.value = 0.5;
    this.sideGainRight.gain.value = -0.5;
    this.splitter.connect(this.sideGainLeft, 0);
    this.splitter.connect(this.sideGainRight, 1);
    this.sideGainLeft.connect(this.sideNode);
    this.sideGainRight.connect(this.sideNode);

    // Side Width Gain: adjusts the side channel volume (Stereo Width)
    this.sideNode.connect(this.sideWidthGain);

    // Left Out: L' = M + S'
    this.midNode.connect(this.leftOut);
    this.sideWidthGain.connect(this.leftOut);

    // Right Out: R' = M - S'
    this.midNode.connect(this.rightOut);
    this.invSideGain.gain.value = -1.0;
    this.sideWidthGain.connect(this.invSideGain);
    this.invSideGain.connect(this.rightOut);

    // Connect to outputs
    this.leftOut.connect(this.output, 0, 0);
    this.rightOut.connect(this.output, 0, 1);

    if (ctx.createStereoPanner) {
      this.panNode = ctx.createStereoPanner();
      this.output.connect(this.panNode);
    }
  }

  get connector(): AudioNode {
    return this.panNode || this.output;
  }

  update(width: number, pan: number, time: number) {
    // Standard width is 1.0, maximum is 2.0 (super-stereo wide), mono is 0.0
    this.sideWidthGain.gain.setTargetAtTime(width, time, 0.05);
    if (this.panNode) {
      this.panNode.pan.setTargetAtTime(pan, time, 0.05);
    }
  }

  connect(dest: AudioNode) {
    this.connector.connect(dest);
  }

  disconnect() {
    try {
      this.connector.disconnect();
    } catch (e) {}
  }
}

export default function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // Deck A Nodes
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const bassNodeRef = useRef<BiquadFilterNode | null>(null);
  const trebleNodeRef = useRef<BiquadFilterNode | null>(null);
  const stereoNodeRef = useRef<StereoWidthProcessor | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserLeftRef = useRef<AnalyserNode | null>(null);
  const analyserRightRef = useRef<AnalyserNode | null>(null);
  const limiterRef = useRef<DynamicsCompressorNode | null>(null);

  // Deck B Nodes
  const audioRefB = useRef<HTMLAudioElement>(null);
  const compressorRefB = useRef<DynamicsCompressorNode | null>(null);
  const sourceNodeRefB = useRef<MediaElementAudioSourceNode | null>(null);
  const gainNodeRefB = useRef<GainNode | null>(null);
  const bassNodeRefB = useRef<BiquadFilterNode | null>(null);
  const trebleNodeRefB = useRef<BiquadFilterNode | null>(null);
  const stereoNodeRefB = useRef<StereoWidthProcessor | null>(null);
  const analyserRefB = useRef<AnalyserNode | null>(null);
  const analyserLeftRefB = useRef<AnalyserNode | null>(null);
  const analyserRightRefB = useRef<AnalyserNode | null>(null);
  const limiterRefB = useRef<DynamicsCompressorNode | null>(null);

  // EQ 16 peaking filters
  const eq16NodesRef = useRef<BiquadFilterNode[]>([]);
  const eq16NodesRefB = useRef<BiquadFilterNode[]>([]);

  // Reverb nodes
  const reverbConvolverRef = useRef<ConvolverNode | null>(null);
  const reverbWetGainRef = useRef<GainNode | null>(null);
  const reverbDryGainRef = useRef<GainNode | null>(null);
  const reverbConvolverRefB = useRef<ConvolverNode | null>(null);
  const reverbWetGainRefB = useRef<GainNode | null>(null);
  const reverbDryGainRefB = useRef<GainNode | null>(null);

  // Reverb parameter caches
  const reverbDecayA = useRef<number>(-1);
  const reverbPreDelayA = useRef<number>(-1);
  const reverbDecayB = useRef<number>(-1);
  const reverbPreDelayB = useRef<number>(-1);

  // Linux Wrapper dynamic nodes
  const wrapperNodesRef = useRef<Map<string, { [key: string]: AudioNode }>>(new Map());
  const wrapperNodesRefB = useRef<Map<string, { [key: string]: AudioNode }>>(new Map());

  const getOrCreateWrapperNodes = (plugin: LinuxWrapperPlugin, deckId: 'A' | 'B'): { [key: string]: AudioNode } => {
    const ctx = audioContextRef.current;
    if (!ctx) return {};
    const map = deckId === 'A' ? wrapperNodesRef.current : wrapperNodesRefB.current;
    if (map.has(plugin.id)) {
      return map.get(plugin.id)!;
    }

    const nodes: { [key: string]: AudioNode } = {};
    if (plugin.pluginId === 'calf_delay') {
      const delayNode = ctx.createDelay(2.0);
      const feedbackNode = ctx.createGain();
      const wetGain = ctx.createGain();
      const dryGain = ctx.createGain();
      const outGain = ctx.createGain();

      nodes.delayNode = delayNode;
      nodes.feedbackNode = feedbackNode;
      nodes.wetGain = wetGain;
      nodes.dryGain = dryGain;
      nodes.outGain = outGain;
    } else if (plugin.pluginId === 'calf_exciter') {
      const highPassFilter = ctx.createBiquadFilter();
      highPassFilter.type = 'highpass';
      highPassFilter.frequency.value = 4000;

      const shaper = ctx.createWaveShaper();
      const n = 44100;
      const curve = new Float32Array(n);
      for (let i = 0; i < n; ++i) {
        const x = (i * 2) / n - 1;
        curve[i] = Math.tanh(x * 1.5);
      }
      shaper.curve = curve;

      const wetGain = ctx.createGain();
      const dryGain = ctx.createGain();
      const outGain = ctx.createGain();

      nodes.highPassFilter = highPassFilter;
      nodes.shaper = shaper;
      nodes.wetGain = wetGain;
      nodes.dryGain = dryGain;
      nodes.outGain = outGain;
    } else if (plugin.pluginId === 'lsp_deesser') {
      const bandPassFilter = ctx.createBiquadFilter();
      bandPassFilter.type = 'bandpass';
      bandPassFilter.frequency.value = 6000;
      bandPassFilter.Q.value = 2.0;

      const notchFilter = ctx.createBiquadFilter();
      notchFilter.type = 'peaking';
      notchFilter.frequency.value = 6000;
      notchFilter.Q.value = 2.5;
      notchFilter.gain.value = 0;

      const outGain = ctx.createGain();

      nodes.bandPassFilter = bandPassFilter;
      nodes.notchFilter = notchFilter;
      nodes.outGain = outGain;
    } else if (plugin.pluginId === 'calf_gate') {
      const gateGain = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;

      nodes.gateGain = gateGain;
      nodes.analyser = analyser;
    }

    map.set(plugin.id, nodes);
    return nodes;
  };

  // Clipping state
  const [clipA, setClipA] = useState(false);
  const [clipB, setClipB] = useState(false);
  const clipCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Presets
  const [presetA, setPresetA] = useState<PresetKey>('flat');
  const [presetB, setPresetB] = useState<PresetKey>('flat');
  
  const [customRackA, setCustomRackA] = useState<RackSettings>(DEFAULT_RACK);
  const [customRackB, setCustomRackB] = useState<RackSettings>(DEFAULT_RACK);
  
  // State
  const [tracks, setTracks] = useState<Track[]>([]);
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  
  const [masterVolume, setMasterVolume] = useState<number>(0.8);
  const [autoAdvance, setAutoAdvance] = useState<boolean>(false);
  const [autoVolume, setAutoVolume] = useState<boolean>(false);
  const [autoAgenda, setAutoAgenda] = useState<boolean>(false);
  const [systemTime, setSystemTime] = useState(new Date());

  const [ytdlpVersion, setYtdlpVersion] = useState<string>('Loading...');
  const [isUpdatingYtdlp, setIsUpdatingYtdlp] = useState<boolean>(false);
  const [ytdlpUpdateMsg, setYtdlpUpdateMsg] = useState<string | null>(null);

  useEffect(() => {
    const fetchYtdlpStatus = async () => {
      try {
        const res = await fetch('/api/ytdlp/status');
        if (res.ok) {
          const data = await res.json();
          setYtdlpVersion(data.version || 'Unknown');
        } else {
          setYtdlpVersion('Unknown');
        }
      } catch (err) {
        setYtdlpVersion('Offline/Unknown');
      }
    };
    fetchYtdlpStatus();
  }, []);

  const handleUpdateYtdlp = async () => {
    if (isUpdatingYtdlp) return;
    setIsUpdatingYtdlp(true);
    setYtdlpUpdateMsg('Updating yt-dlp to latest release...');
    try {
      const res = await fetch('/api/ytdlp/update', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setYtdlpVersion(data.version || 'Updated');
        setYtdlpUpdateMsg(`Update Succeeded: ${data.version}`);
        setTimeout(() => setYtdlpUpdateMsg(null), 6000);
      } else {
        const data = await res.json();
        setYtdlpUpdateMsg(`Update Failed: ${data.error || 'Server error'}`);
        setTimeout(() => setYtdlpUpdateMsg(null), 6000);
      }
    } catch (err) {
      setYtdlpUpdateMsg('Network error updating engine.');
      setTimeout(() => setYtdlpUpdateMsg(null), 6000);
    } finally {
      setIsUpdatingYtdlp(false);
    }
  };

  // Refs for auto-agenda
  const lastTriggeredTimeRef = useRef<string | null>(null);
  const tracksRef = useRef<Track[]>(tracks);
  
  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  const playTrack = (index: number) => {
    setCurrentIndex(index);
    initAudio();
    // When src changes, audio element auto-loads. 
    // We can trigger play in a microtask or rely on an effect.
    setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.play().catch(console.error);
      }
    }, 50);
  };

  const playTrackRef = useRef(playTrack);
  useEffect(() => {
    playTrackRef.current = playTrack;
  }, [playTrack]);

  const stopPlayback = () => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setCurrentTime(0);
    setIsPlaying(false);
  };

  const stopPlaybackRef = useRef(stopPlayback);
  useEffect(() => {
    stopPlaybackRef.current = stopPlayback;
  }, [stopPlayback]);

  const handleTrackEndRef = useRef<() => void>(() => {});

  // Agenda Timer
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setSystemTime(now);

      if (autoAgenda && tracksRef.current.length > 0) {
        const currentTimeStr = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
        
        // Start track
        if (lastTriggeredTimeRef.current !== currentTimeStr) {
          const trackIndexToPlay = tracksRef.current.findIndex(t => t.agendaTime === currentTimeStr);
          if (trackIndexToPlay !== -1) {
            lastTriggeredTimeRef.current = currentTimeStr;
            playTrackRef.current(trackIndexToPlay);
          }
        }

        // End track
        if (isPlaying) {
          const activeTrackIndex = tracksRef.current.findIndex(t => t.id === tracksRef.current[currentIndex]?.id);
          if (activeTrackIndex !== -1) {
            const activeTrack = tracksRef.current[activeTrackIndex];
            if (activeTrack.agendaEndTime === currentTimeStr && lastTriggeredTimeRef.current !== `end-${currentTimeStr}`) {
              lastTriggeredTimeRef.current = `end-${currentTimeStr}`;
              if (audioRef.current) {
                audioRef.current.pause();
              }
              if (handleTrackEndRef.current) {
                handleTrackEndRef.current();
              } else {
                stopPlaybackRef.current();
              }
            }
          }
        }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [autoAgenda, isPlaying, currentIndex]);

  // Playlists
  const [savedPlaylists, setSavedPlaylists] = useState<Playlist[]>([]);
  const [currentPlaylistId, setCurrentPlaylistId] = useState<string | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [playlistNameInput, setPlaylistNameInput] = useState('');
  const [showAIAgenda, setShowAIAgenda] = useState(false);
  const [showChordsModal, setShowChordsModal] = useState(false);
  const [activeChordsTrack, setActiveChordsTrack] = useState<Track | null>(null);
  const [isGeneratingChords, setIsGeneratingChords] = useState(false);

  const handleGenerateChords = async (track: Track) => {
    setActiveChordsTrack(track);
    setShowChordsModal(true);
    if (track.aiLyricsChords) return;
    
    setIsGeneratingChords(true);
    try {
      const response = await fetch("/api/lyrics-chords/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackName: track.name })
      });
      if (!response.ok) throw new Error("Failed to generate");
      const data = await response.json();
      
      const updateFn = (prev: Track[]) => prev.map(t => t.id === track.id ? { ...t, aiLyricsChords: data } : t);
      setTracks(updateFn);
      setTracksB(updateFn);
      setActiveChordsTrack(prev => prev && prev.id === track.id ? { ...prev, aiLyricsChords: data } : prev);
    } catch (err) {
      console.error(err);
      alert("Gagal membuat chord dan lirik. " + (err as Error).message);
    } finally {
      setIsGeneratingChords(false);
    }
  };

  const handleApplyAIAgenda = (agendaItems: { name: string; startTime: string; endTime: string; }[]) => {
    setTracks(prev => {
      const next = [...prev];
      for (let i = 0; i < Math.min(next.length, agendaItems.length); i++) {
        next[i] = {
          ...next[i],
          agendaTime: agendaItems[i].startTime,
          agendaEndTime: agendaItems[i].endTime
        };
      }
      return next;
    });
  };

  useEffect(() => {
    loadPlaylistsFromDB().then(setSavedPlaylists).catch(console.error);
  }, []);

  // Deck B State
  const [tracksB, setTracksB] = useState<Track[]>([]);
  const [currentIndexB, setCurrentIndexB] = useState<number>(-1);
  const [isPlayingB, setIsPlayingB] = useState(false);
  const [currentTimeB, setCurrentTimeB] = useState(0);
  const [durationB, setDurationB] = useState(0);
  const [masterVolumeB, setMasterVolumeB] = useState<number>(0.5);
  
  const currentTrackB = currentIndexB >= 0 && currentIndexB < tracksB.length ? tracksB[currentIndexB] : null;

  const [activeDeckTab, setActiveDeckTab] = useState<'A' | 'B' | 'Rack'>('A');
  const [mobileActiveView, setMobileActiveView] = useState<'console' | 'playlist'>('console');
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [rackDeck, setRackDeck] = useState<'A' | 'B'>('A');

  const [duckingDuration, setDuckingDuration] = useState<number>(2.0);
  const [repeatModeA, setRepeatModeA] = useState<'off' | 'one' | 'all'>('off');
  const [repeatModeB, setRepeatModeB] = useState<'off' | 'one' | 'all'>('off');
  const [isShuffleA, setIsShuffleA] = useState<boolean>(false);

  const [isDolbyActive, setIsDolbyActive] = useState<boolean>(false);
  const [isSony360Active, setIsSony360Active] = useState<boolean>(false);

  const [isSessionLoaded, setIsSessionLoaded] = useState(false);
  const [inputUrl, setInputUrl] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isExtractingUrl, setIsExtractingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [audioPlaybackError, setAudioPlaybackError] = useState<string | null>(null);
  const initialSeekTimeRef = useRef<number | null>(null);
  const initialSeekTimeBRef = useRef<number | null>(null);

  // Load saved session on mount
  useEffect(() => {
    const restoreSession = async () => {
      try {
        // 1. Load tracks from IndexedDB (since File objects can only be saved there)
        const session = await loadActiveSession();
        if (session) {
          if (session.tracks && session.tracks.length > 0) {
            const restoredTracks = session.tracks.map((t: any) => ({
              ...t,
              url: t.isRemote ? t.url : URL.createObjectURL(t.file)
            }));
            setTracks(restoredTracks);

            // Backfill durations if missing
            restoredTracks.forEach((t: any) => {
              if (t.duration === undefined) {
                const audio = new Audio(t.url);
                audio.addEventListener('loadedmetadata', () => {
                  const dur = audio.duration;
                  setTracks(prev => prev.map(pt => pt.id === t.id ? { ...pt, duration: dur } : pt));
                });
              }
            });

            // Backfill analysis/peaks if missing for remote tracks
            restoredTracks.forEach((t: any) => {
              if (t.isRemote && (!t.peaks || !t.analysis)) {
                setAnalyzingIds(prev => new Set(prev).add(t.id));
                analyzeAudio(t.url)
                  .then(({ analysis, peaks }) => {
                    setTracks(prev => prev.map(pt => pt.id === t.id ? { ...pt, analysis, peaks } : pt));
                  })
                  .catch(err => console.error(`Failed to analyze remote track ${t.name} on restore`, err))
                  .finally(() => {
                    setAnalyzingIds(prev => {
                      const next = new Set(prev);
                      next.delete(t.id);
                      return next;
                    });
                  });
              }
            });
          }
          if (session.tracksB && session.tracksB.length > 0) {
            const restoredTracksB = session.tracksB.map((t: any) => ({
              ...t,
              url: t.isRemote ? t.url : URL.createObjectURL(t.file)
            }));
            setTracksB(restoredTracksB);

            // Backfill durations if missing
            restoredTracksB.forEach((t: any) => {
              if (t.duration === undefined) {
                const audio = new Audio(t.url);
                audio.addEventListener('loadedmetadata', () => {
                  const dur = audio.duration;
                  setTracksB(prev => prev.map(pt => pt.id === t.id ? { ...pt, duration: dur } : pt));
                });
              }
            });

            // Backfill analysis/peaks if missing for remote tracks B
            restoredTracksB.forEach((t: any) => {
              if (t.isRemote && (!t.peaks || !t.analysis)) {
                setAnalyzingIds(prev => new Set(prev).add(t.id));
                analyzeAudio(t.url)
                  .then(({ analysis, peaks }) => {
                    setTracksB(prev => prev.map(pt => pt.id === t.id ? { ...pt, analysis, peaks } : pt));
                  })
                  .catch(err => console.error(`Failed to analyze remote track B ${t.name} on restore`, err))
                  .finally(() => {
                    setAnalyzingIds(prev => {
                      const next = new Set(prev);
                      next.delete(t.id);
                      return next;
                    });
                  });
              }
            });
          }
        }

        // 2. Load simple settings from localStorage
        const savedCurrentIndex = localStorage.getItem('stage_cue_current_index');
        if (savedCurrentIndex !== null) setCurrentIndex(parseInt(savedCurrentIndex));

        const savedCurrentIndexB = localStorage.getItem('stage_cue_current_index_b');
        if (savedCurrentIndexB !== null) setCurrentIndexB(parseInt(savedCurrentIndexB));

        const savedCurrentTime = localStorage.getItem('stage_cue_current_time');
        if (savedCurrentTime !== null) {
          const t = parseFloat(savedCurrentTime);
          initialSeekTimeRef.current = t;
          setCurrentTime(t);
        }

        const savedCurrentTimeB = localStorage.getItem('stage_cue_current_time_b');
        if (savedCurrentTimeB !== null) {
          const t = parseFloat(savedCurrentTimeB);
          initialSeekTimeBRef.current = t;
          setCurrentTimeB(t);
        }

        const savedPresetA = localStorage.getItem('stage_cue_preset_a');
        if (savedPresetA !== null) setPresetA(savedPresetA as PresetKey);

        const savedPresetB = localStorage.getItem('stage_cue_preset_b');
        if (savedPresetB !== null) setPresetB(savedPresetB as PresetKey);

        const savedCustomRackA = localStorage.getItem('stage_cue_custom_rack_a');
        if (savedCustomRackA !== null) setCustomRackA(JSON.parse(savedCustomRackA));

        const savedCustomRackB = localStorage.getItem('stage_cue_custom_rack_b');
        if (savedCustomRackB !== null) setCustomRackB(JSON.parse(savedCustomRackB));

        const savedMasterVolume = localStorage.getItem('stage_cue_master_volume');
        if (savedMasterVolume !== null) setMasterVolume(parseFloat(savedMasterVolume));

        const savedMasterVolumeB = localStorage.getItem('stage_cue_master_volume_b');
        if (savedMasterVolumeB !== null) setMasterVolumeB(parseFloat(savedMasterVolumeB));

        const savedAutoAdvance = localStorage.getItem('stage_cue_auto_advance');
        if (savedAutoAdvance !== null) setAutoAdvance(savedAutoAdvance === 'true');

        const savedAutoVolume = localStorage.getItem('stage_cue_auto_volume');
        if (savedAutoVolume !== null) setAutoVolume(savedAutoVolume === 'true');

        const savedAutoAgenda = localStorage.getItem('stage_cue_auto_agenda');
        if (savedAutoAgenda !== null) setAutoAgenda(savedAutoAgenda === 'true');

        const savedActiveDeckTab = localStorage.getItem('stage_cue_active_deck_tab');
        if (savedActiveDeckTab !== null) setActiveDeckTab(savedActiveDeckTab as any);

        const savedRackDeck = localStorage.getItem('stage_cue_rack_deck');
        if (savedRackDeck !== null) setRackDeck(savedRackDeck as any);

        const savedRepeatModeA = localStorage.getItem('stage_cue_repeat_mode_a');
        if (savedRepeatModeA !== null) setRepeatModeA(savedRepeatModeA as any);

        const savedRepeatModeB = localStorage.getItem('stage_cue_repeat_mode_b');
        if (savedRepeatModeB !== null) setRepeatModeB(savedRepeatModeB as any);

        const savedIsShuffleA = localStorage.getItem('stage_cue_is_shuffle_a');
        if (savedIsShuffleA !== null) setIsShuffleA(savedIsShuffleA === 'true');

        const savedIsDolbyActive = localStorage.getItem('stage_cue_is_dolby_active');
        if (savedIsDolbyActive !== null) setIsDolbyActive(savedIsDolbyActive === 'true');

        const savedIsSony360Active = localStorage.getItem('stage_cue_is_sony360_active');
        if (savedIsSony360Active !== null) setIsSony360Active(savedIsSony360Active === 'true');

        const savedCurrentPlaylistId = localStorage.getItem('stage_cue_current_playlist_id');
        if (savedCurrentPlaylistId !== null) setCurrentPlaylistId(savedCurrentPlaylistId);

      } catch (e) {
        console.error("Error restoring active session:", e);
      } finally {
        setIsSessionLoaded(true);
      }
    };
    restoreSession();
  }, []);

  // Save tracks to IndexedDB
  useEffect(() => {
    if (!isSessionLoaded) return;
    const sessionData = {
      tracks: tracks.map(t => ({
        id: t.id,
        file: t.file,
        name: t.name,
        volume: t.volume,
        analysis: t.analysis,
        peaks: t.peaks,
        agendaTime: t.agendaTime,
        agendaEndTime: t.agendaEndTime,
        duration: t.duration,
        isRemote: t.isRemote,
        url: t.isRemote ? t.url : undefined
      })),
      tracksB: tracksB.map(t => ({
        id: t.id,
        file: t.file,
        name: t.name,
        volume: t.volume,
        analysis: t.analysis,
        peaks: t.peaks,
        agendaTime: t.agendaTime,
        agendaEndTime: t.agendaEndTime,
        duration: t.duration,
        isRemote: t.isRemote,
        url: t.isRemote ? t.url : undefined
      }))
    };
    saveActiveSession(sessionData).catch(err => console.error("Error saving tracklists:", err));
  }, [isSessionLoaded, tracks, tracksB]);

  // Save simple settings to localStorage
  useEffect(() => {
    if (!isSessionLoaded) return;
    localStorage.setItem('stage_cue_current_index', currentIndex.toString());
  }, [isSessionLoaded, currentIndex]);

  useEffect(() => {
    if (!isSessionLoaded) return;
    localStorage.setItem('stage_cue_current_index_b', currentIndexB.toString());
  }, [isSessionLoaded, currentIndexB]);

  useEffect(() => {
    if (!isSessionLoaded) return;
    localStorage.setItem('stage_cue_current_time', currentTime.toString());
  }, [isSessionLoaded, currentTime]);

  useEffect(() => {
    if (!isSessionLoaded) return;
    localStorage.setItem('stage_cue_current_time_b', currentTimeB.toString());
  }, [isSessionLoaded, currentTimeB]);

  useEffect(() => {
    if (!isSessionLoaded) return;
    localStorage.setItem('stage_cue_preset_a', presetA);
  }, [isSessionLoaded, presetA]);

  useEffect(() => {
    if (!isSessionLoaded) return;
    localStorage.setItem('stage_cue_preset_b', presetB);
  }, [isSessionLoaded, presetB]);

  useEffect(() => {
    if (!isSessionLoaded) return;
    localStorage.setItem('stage_cue_custom_rack_a', JSON.stringify(customRackA));
  }, [isSessionLoaded, customRackA]);

  useEffect(() => {
    if (!isSessionLoaded) return;
    localStorage.setItem('stage_cue_custom_rack_b', JSON.stringify(customRackB));
  }, [isSessionLoaded, customRackB]);

  useEffect(() => {
    if (!isSessionLoaded) return;
    localStorage.setItem('stage_cue_master_volume', masterVolume.toString());
  }, [isSessionLoaded, masterVolume]);

  useEffect(() => {
    if (!isSessionLoaded) return;
    localStorage.setItem('stage_cue_master_volume_b', masterVolumeB.toString());
  }, [isSessionLoaded, masterVolumeB]);

  useEffect(() => {
    if (!isSessionLoaded) return;
    localStorage.setItem('stage_cue_auto_advance', autoAdvance.toString());
  }, [isSessionLoaded, autoAdvance]);

  useEffect(() => {
    if (!isSessionLoaded) return;
    localStorage.setItem('stage_cue_auto_volume', autoVolume.toString());
  }, [isSessionLoaded, autoVolume]);

  useEffect(() => {
    if (!isSessionLoaded) return;
    localStorage.setItem('stage_cue_auto_agenda', autoAgenda.toString());
  }, [isSessionLoaded, autoAgenda]);

  useEffect(() => {
    if (!isSessionLoaded) return;
    localStorage.setItem('stage_cue_active_deck_tab', activeDeckTab);
  }, [isSessionLoaded, activeDeckTab]);

  useEffect(() => {
    if (!isSessionLoaded) return;
    localStorage.setItem('stage_cue_rack_deck', rackDeck);
  }, [isSessionLoaded, rackDeck]);

  useEffect(() => {
    if (!isSessionLoaded) return;
    localStorage.setItem('stage_cue_repeat_mode_a', repeatModeA);
  }, [isSessionLoaded, repeatModeA]);

  useEffect(() => {
    if (!isSessionLoaded) return;
    localStorage.setItem('stage_cue_repeat_mode_b', repeatModeB);
  }, [isSessionLoaded, repeatModeB]);

  useEffect(() => {
    if (!isSessionLoaded) return;
    localStorage.setItem('stage_cue_is_shuffle_a', isShuffleA.toString());
  }, [isSessionLoaded, isShuffleA]);

  useEffect(() => {
    if (!isSessionLoaded) return;
    localStorage.setItem('stage_cue_is_dolby_active', isDolbyActive.toString());
  }, [isSessionLoaded, isDolbyActive]);

  useEffect(() => {
    if (!isSessionLoaded) return;
    localStorage.setItem('stage_cue_is_sony360_active', isSony360Active.toString());
  }, [isSessionLoaded, isSony360Active]);

  useEffect(() => {
    if (!isSessionLoaded) return;
    localStorage.setItem('stage_cue_current_playlist_id', currentPlaylistId || '');
  }, [isSessionLoaded, currentPlaylistId]);

  // Auto Ducking for Deck B
  const duckingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!audioRefB.current) return;
    
    if (duckingIntervalRef.current) clearInterval(duckingIntervalRef.current);
    
    // Target volume: 0 if Deck A is playing, otherwise masterVolumeB * currentTrackB.volume
    const targetVolume = isPlaying ? 0 : masterVolumeB * (currentTrackB ? currentTrackB.volume : 1);
    
    // 50ms interval, so 20 steps per second.
    const steps = Math.max(1, duckingDuration * 20);
    const maxDiffPerStep = 1 / steps;

    duckingIntervalRef.current = setInterval(() => {
      if (!audioRefB.current) return;
      const currentVol = audioRefB.current.volume;
      const diff = targetVolume - currentVol;
      
      if (Math.abs(diff) < maxDiffPerStep) {
        audioRefB.current.volume = targetVolume;
        if (duckingIntervalRef.current) clearInterval(duckingIntervalRef.current);
      } else {
        audioRefB.current.volume = currentVol + (diff > 0 ? maxDiffPerStep : -maxDiffPerStep);
      }
    }, 50);

    return () => {
      if (duckingIntervalRef.current) clearInterval(duckingIntervalRef.current);
    }
  }, [isPlaying, masterVolumeB, currentTrackB, currentIndexB, duckingDuration]);

  // Deck B Audio Handlers
  const playTrackB = (index: number) => {
    setCurrentIndexB(index);
    setTimeout(() => {
      if (audioRefB.current) {
        audioRefB.current.play().catch(console.error);
      }
    }, 50);
  };

  const stopPlaybackB = () => {
    if (!audioRefB.current) return;
    audioRefB.current.pause();
    audioRefB.current.currentTime = 0;
    setCurrentTimeB(0);
    setIsPlayingB(false);
  };

  const handleFileUploadB = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    const newTracks: Track[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      name: file.name.replace(/\.[^/.]+$/, ""),
      url: URL.createObjectURL(file),
      volume: 1.0,
    }));

    setTracksB(prev => {
      const updated = [...prev, ...newTracks];
      if (prev.length === 0 && newTracks.length > 0) {
        setCurrentIndexB(0);
      }
      return updated;
    });

    // Load duration for new BGM tracks
    newTracks.forEach(track => {
      const audio = new Audio(track.url);
      audio.addEventListener('loadedmetadata', () => {
        const dur = audio.duration;
        setTracksB(prev => prev.map(t => t.id === track.id ? { ...t, duration: dur } : t));
      });
    });

    e.target.value = '';
  };

  const removeTrackB = (id: string, index: number) => {
    setTracksB(prev => {
      const updated = prev.filter(t => t.id !== id);
      URL.revokeObjectURL(prev[index].url);
      
      if (currentIndexB === index) {
        stopPlaybackB();
        setCurrentIndexB(updated.length > 0 ? 0 : -1);
      } else if (currentIndexB > index) {
        setCurrentIndexB(currentIndexB - 1);
      }
      return updated;
    });
  };

  const currentTrack = currentIndex >= 0 && currentIndex < tracks.length ? tracks[currentIndex] : null;

  // Sync Volume
  useEffect(() => {
    if (audioRef.current) {
      const trackVolume = currentTrack ? currentTrack.volume : 1;
      audioRef.current.volume = masterVolume * trackVolume;
    }
  }, [masterVolume, currentTrack, tracks]);

  // Handle Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Avoid triggering when user is typing in inputs, select boxes or text areas
      if (
        e.target instanceof HTMLInputElement || 
        e.target instanceof HTMLSelectElement || 
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const isDeckAMonitored = activeDeckTab === 'A' || (activeDeckTab === 'Rack' && rackDeck === 'A');

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          if (isDeckAMonitored) {
            togglePlayPause();
          } else {
            if (isPlayingB) {
              stopPlaybackB();
            } else {
              playTrackB(currentIndexB >= 0 ? currentIndexB : 0);
            }
          }
          break;

        case 'ArrowRight':
        case 'KeyN':
          e.preventDefault();
          if (isDeckAMonitored) {
            nextTrack();
          } else {
            if (tracksB.length > 0) {
              if (currentIndexB < tracksB.length - 1) {
                playTrackB(currentIndexB + 1);
              } else if (repeatModeB === 'all') {
                playTrackB(0);
              }
            }
          }
          break;

        case 'ArrowLeft':
        case 'KeyP':
          e.preventDefault();
          if (isDeckAMonitored) {
            prevTrack();
          } else {
            if (tracksB.length > 0) {
              if (currentTimeB > 3) {
                if (audioRefB.current) audioRefB.current.currentTime = 0;
              } else if (currentIndexB > 0) {
                playTrackB(currentIndexB - 1);
              } else if (repeatModeB === 'all') {
                playTrackB(tracksB.length - 1);
              }
            }
          }
          break;

        case 'Tab':
        case 'KeyD':
          e.preventDefault();
          setActiveDeckTab(prev => {
            if (prev === 'A') return 'B';
            if (prev === 'B') return 'A';
            return 'A';
          });
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeDeckTab,
    rackDeck,
    isPlaying,
    isPlayingB,
    currentIndex,
    currentIndexB,
    tracks,
    tracksB,
    currentTimeB,
    repeatModeA,
    repeatModeB,
    isShuffleA
  ]);

  const customRackARef = useRef(customRackA);
  const customRackBRef = useRef(customRackB);
  const presetARef = useRef(presetA);
  const presetBRef = useRef(presetB);
  useEffect(() => { customRackARef.current = customRackA; }, [customRackA]);
  useEffect(() => { customRackBRef.current = customRackB; }, [customRackB]);
  useEffect(() => { presetARef.current = presetA; }, [presetA]);
  useEffect(() => { presetBRef.current = presetB; }, [presetB]);

  // Audio Event Handlers
  const initAudio = () => {
    if (!audioContextRef.current && (audioRef.current || audioRefB.current)) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      
      const ctx = new AudioContextClass();
      audioContextRef.current = ctx;
      
      // Deck A Init
      if (audioRef.current) {
        sourceNodeRef.current = ctx.createMediaElementSource(audioRef.current);
        gainNodeRef.current = ctx.createGain();
        bassNodeRef.current = ctx.createBiquadFilter();
        bassNodeRef.current.type = 'lowshelf';
        bassNodeRef.current.frequency.value = 250;
        trebleNodeRef.current = ctx.createBiquadFilter();
        trebleNodeRef.current.type = 'highshelf';
        trebleNodeRef.current.frequency.value = 4000;
        stereoNodeRef.current = new StereoWidthProcessor(ctx);
        compressorRef.current = ctx.createDynamicsCompressor();
        
        limiterRef.current = ctx.createDynamicsCompressor();
        limiterRef.current.threshold.value = -0.5; // near 0dBFS
        limiterRef.current.knee.value = 0.0;
        limiterRef.current.ratio.value = 20.0;
        limiterRef.current.attack.value = 0.001;
        limiterRef.current.release.value = 0.1;

        analyserRef.current = ctx.createAnalyser();
        analyserRef.current.fftSize = 256;
        analyserLeftRef.current = ctx.createAnalyser();
        analyserLeftRef.current.fftSize = 256;
        analyserRightRef.current = ctx.createAnalyser();
        analyserRightRef.current.fftSize = 256;

        const freqs = [16, 25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000];
        eq16NodesRef.current = freqs.map(f => {
          const filter = ctx.createBiquadFilter();
          filter.type = 'peaking';
          filter.frequency.value = f;
          filter.Q.value = 1.4;
          filter.gain.value = 0;
          return filter;
        });

        reverbConvolverRef.current = ctx.createConvolver();
        reverbWetGainRef.current = ctx.createGain();
        reverbWetGainRef.current.gain.value = 0;
        reverbDryGainRef.current = ctx.createGain();
        reverbDryGainRef.current.gain.value = 1;
      }

      // Deck B Init
      if (audioRefB.current) {
        sourceNodeRefB.current = ctx.createMediaElementSource(audioRefB.current);
        gainNodeRefB.current = ctx.createGain();
        bassNodeRefB.current = ctx.createBiquadFilter();
        bassNodeRefB.current.type = 'lowshelf';
        bassNodeRefB.current.frequency.value = 250;
        trebleNodeRefB.current = ctx.createBiquadFilter();
        trebleNodeRefB.current.type = 'highshelf';
        trebleNodeRefB.current.frequency.value = 4000;
        stereoNodeRefB.current = new StereoWidthProcessor(ctx);
        compressorRefB.current = ctx.createDynamicsCompressor();
        
        limiterRefB.current = ctx.createDynamicsCompressor();
        limiterRefB.current.threshold.value = -0.5;
        limiterRefB.current.knee.value = 0.0;
        limiterRefB.current.ratio.value = 20.0;
        limiterRefB.current.attack.value = 0.001;
        limiterRefB.current.release.value = 0.1;

        analyserRefB.current = ctx.createAnalyser();
        analyserRefB.current.fftSize = 256;
        analyserLeftRefB.current = ctx.createAnalyser();
        analyserLeftRefB.current.fftSize = 256;
        analyserRightRefB.current = ctx.createAnalyser();
        analyserRightRefB.current.fftSize = 256;

        const freqs = [16, 25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000];
        eq16NodesRefB.current = freqs.map(f => {
          const filter = ctx.createBiquadFilter();
          filter.type = 'peaking';
          filter.frequency.value = f;
          filter.Q.value = 1.4;
          filter.gain.value = 0;
          return filter;
        });

        reverbConvolverRefB.current = ctx.createConvolver();
        reverbWetGainRefB.current = ctx.createGain();
        reverbWetGainRefB.current.gain.value = 0;
        reverbDryGainRefB.current = ctx.createGain();
        reverbDryGainRefB.current.gain.value = 1;
      }

      reconnectNodes();

      if (!clipCheckIntervalRef.current) {
        clipCheckIntervalRef.current = setInterval(() => {
          if (limiterRef.current && limiterRef.current.reduction > 0) setClipA(true);
          if (limiterRefB.current && limiterRefB.current.reduction > 0) setClipB(true);

          // Real-time Linux Noise Gate emulation
          ['A', 'B'].forEach(deckId => {
            const customRack = deckId === 'A' ? customRackARef.current : customRackBRef.current;
            const isCustom = deckId === 'A' ? presetARef.current === 'custom' : presetBRef.current === 'custom';
            if (!isCustom || !customRack) return;

            const gatePlugin = customRack.plugins.find(p => p.type === 'linux_wrapper' && p.pluginId === 'calf_gate' && p.enabled);
            if (gatePlugin) {
              const nodes = getOrCreateWrapperNodes(gatePlugin as LinuxWrapperPlugin, deckId as 'A' | 'B');
              if (nodes.gateGain && nodes.analyser) {
                const gateGain = nodes.gateGain as GainNode;
                const analyser = nodes.analyser as AnalyserNode;

                const bufferLength = analyser.frequencyBinCount;
                const dataArray = new Float32Array(bufferLength);
                analyser.getFloatTimeDomainData(dataArray);

                let sum = 0;
                for (let i = 0; i < bufferLength; i++) {
                  sum += dataArray[i] * dataArray[i];
                }
                const rms = Math.sqrt(sum / bufferLength);
                const db = rms > 0 ? 20 * Math.log10(rms) : -100;

                const threshold = (gateGain as any).threshold ?? -40;
                const range = (gateGain as any).range ?? -60;
                const attack = (gateGain as any).attack ?? 0.01;
                const release = (gateGain as any).release ?? 0.1;

                const now = ctx.currentTime;
                if (db < threshold) {
                  const targetGain = Math.pow(10, range / 20);
                  gateGain.gain.setTargetAtTime(targetGain, now, release);
                } else {
                  gateGain.gain.setTargetAtTime(1.0, now, attack);
                }
              }
            }
          });
        }, 100);
      }
    } else if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume();
    }
  };

  const routeDeck = (
    source: MediaElementAudioSourceNode | null,
    gain: GainNode | null,
    bass: BiquadFilterNode | null,
    treble: BiquadFilterNode | null,
    stereo: StereoWidthProcessor | null,
    comp: DynamicsCompressorNode | null,
    limiter: DynamicsCompressorNode | null,
    analyser: AnalyserNode | null,
    useEffects: boolean,
    dest: AudioNode,
    deckId: 'A' | 'B'
  ) => {
    if (!source || !analyser || !limiter) return;
    const analyserLeft = deckId === 'A' ? analyserLeftRef.current : analyserLeftRefB.current;
    const analyserRight = deckId === 'A' ? analyserRightRef.current : analyserRightRefB.current;

    try { source.disconnect(); } catch (e) {}
    if (gain) { try { gain.disconnect(); } catch (e) {} }
    if (bass) { try { bass.disconnect(); } catch (e) {} }
    if (treble) { try { treble.disconnect(); } catch (e) {} }
    if (stereo) { try { stereo.disconnect(); } catch (e) {} }
    if (comp) { try { comp.disconnect(); } catch (e) {} }
    if (analyserLeft) { try { analyserLeft.disconnect(); } catch (e) {} }
    if (analyserRight) { try { analyserRight.disconnect(); } catch (e) {} }
    try { limiter.disconnect(); } catch (e) {}
    try { analyser.disconnect(); } catch (e) {}

    // Disconnect existing wrapper nodes
    const wrapperMap = deckId === 'A' ? wrapperNodesRef.current : wrapperNodesRefB.current;
    wrapperMap.forEach(nodes => {
      Object.values(nodes as Record<string, any>).forEach(node => {
        try { (node as AudioNode).disconnect(); } catch (e) {}
      });
    });

    const eq16Nodes = deckId === 'A' ? eq16NodesRef.current : eq16NodesRefB.current;
    eq16Nodes.forEach(node => {
      try { node.disconnect(); } catch (e) {}
    });

    const revConvolver = deckId === 'A' ? reverbConvolverRef.current : reverbConvolverRefB.current;
    const revWet = deckId === 'A' ? reverbWetGainRef.current : reverbWetGainRefB.current;
    const revDry = deckId === 'A' ? reverbDryGainRef.current : reverbDryGainRefB.current;
    if (revConvolver) { try { revConvolver.disconnect(); } catch (e) {} }
    if (revWet) { try { revWet.disconnect(); } catch (e) {} }
    if (revDry) { try { revDry.disconnect(); } catch (e) {} }

    const presetKey = deckId === 'A' ? presetA : presetB;
    const customRack = deckId === 'A' ? customRackA : customRackB;

    if (useEffects && gain && bass && treble && comp) {
      let lastNode: AudioNode = source;
      lastNode.connect(gain);
      lastNode = gain;

      if (presetKey === 'custom' && customRack) {
        for (const plugin of customRack.plugins) {
          if (!plugin.enabled) continue;

          if (plugin.type === 'eq16' && eq16Nodes.length === 16) {
            lastNode.connect(eq16Nodes[0]);
            for (let i = 0; i < 15; i++) {
              eq16Nodes[i].connect(eq16Nodes[i+1]);
            }
            lastNode = eq16Nodes[15];
          } else if (plugin.type === 'compressor') {
            lastNode.connect(comp);
            lastNode = comp;
          } else if (plugin.type === 'limiter') {
            lastNode.connect(limiter);
            lastNode = limiter;
          } else if (plugin.type === 'stereo' && stereo) {
            lastNode.connect(stereo.input);
            lastNode = stereo.connector;
          } else if (plugin.type === 'linux_wrapper') {
            const nodes = getOrCreateWrapperNodes(plugin as LinuxWrapperPlugin, deckId);
            if (plugin.pluginId === 'calf_delay' && nodes.delayNode && nodes.feedbackNode && nodes.wetGain && nodes.dryGain && nodes.outGain) {
              const delay = nodes.delayNode as DelayNode;
              const feedback = nodes.feedbackNode as GainNode;
              const wet = nodes.wetGain as GainNode;
              const dry = nodes.dryGain as GainNode;
              const out = nodes.outGain as GainNode;

              lastNode.connect(dry);
              dry.connect(out);

              lastNode.connect(delay);
              delay.connect(wet);
              wet.connect(out);

              // feedback loop
              delay.connect(feedback);
              feedback.connect(delay);

              lastNode = out;
            } else if (plugin.pluginId === 'calf_exciter' && nodes.highPassFilter && nodes.shaper && nodes.wetGain && nodes.dryGain && nodes.outGain) {
              const hp = nodes.highPassFilter as BiquadFilterNode;
              const shaper = nodes.shaper as WaveShaperNode;
              const wet = nodes.wetGain as GainNode;
              const dry = nodes.dryGain as GainNode;
              const out = nodes.outGain as GainNode;

              lastNode.connect(dry);
              dry.connect(out);

              lastNode.connect(hp);
              hp.connect(shaper);
              shaper.connect(wet);
              wet.connect(out);

              lastNode = out;
            } else if (plugin.pluginId === 'lsp_deesser' && nodes.bandPassFilter && nodes.notchFilter && nodes.outGain) {
              const bp = nodes.bandPassFilter as BiquadFilterNode;
              const notch = nodes.notchFilter as BiquadFilterNode;
              const out = nodes.outGain as GainNode;

              lastNode.connect(bp);
              lastNode.connect(notch);
              notch.connect(out);

              lastNode = out;
            } else if (plugin.pluginId === 'calf_gate' && nodes.gateGain && nodes.analyser) {
              const gateGain = nodes.gateGain as GainNode;
              const analyser = nodes.analyser as AnalyserNode;

              lastNode.connect(gateGain);
              lastNode.connect(analyser);

              lastNode = gateGain;
            }
          } else if (plugin.type === 'reverb' && revConvolver && revWet && revDry) {
            const revOut = audioContextRef.current!.createGain();
            
            lastNode.connect(revDry);
            revDry.connect(revOut);

            lastNode.connect(revConvolver);
            revConvolver.connect(revWet);
            revWet.connect(revOut);

            lastNode = revOut;
          }
        }
      } else {
        lastNode.connect(bass);
        lastNode = bass;
        lastNode.connect(treble);
        lastNode = treble;
        if (stereo) {
          lastNode.connect(stereo.input);
          lastNode = stereo.connector;
        }
        lastNode.connect(comp);
        comp.connect(limiter);
        lastNode = limiter;
      }

      lastNode.connect(analyser);
      analyser.connect(dest);

      if (analyserLeft && analyserRight && audioContextRef.current) {
        try {
          const splitter = audioContextRef.current.createChannelSplitter(2);
          analyser.connect(splitter);
          splitter.connect(analyserLeft, 0);
          splitter.connect(analyserRight, 1);
        } catch (e) {
          console.warn("Failed to split channels inside routeDeck:", e);
        }
      }
    } else {
      source.connect(limiter);
      limiter.connect(analyser);
      analyser.connect(dest);

      if (analyserLeft && analyserRight && audioContextRef.current) {
        try {
          const splitter = audioContextRef.current.createChannelSplitter(2);
          analyser.connect(splitter);
          splitter.connect(analyserLeft, 0);
          splitter.connect(analyserRight, 1);
        } catch (e) {
          console.warn("Failed to split channels inside routeDeck (bypass):", e);
        }
      }
    }
  };

  const reconnectNodes = () => {
    if (!audioContextRef.current) return;
    const dest = audioContextRef.current.destination;
    routeDeck(sourceNodeRef.current, gainNodeRef.current, bassNodeRef.current, trebleNodeRef.current, stereoNodeRef.current, compressorRef.current, limiterRef.current, analyserRef.current, autoVolume || presetA !== 'flat', dest, 'A');
    routeDeck(sourceNodeRefB.current, gainNodeRefB.current, bassNodeRefB.current, trebleNodeRefB.current, stereoNodeRefB.current, compressorRefB.current, limiterRefB.current, analyserRefB.current, presetB !== 'flat', dest, 'B');
  };

  useEffect(() => {
    reconnectNodes();
  }, [autoVolume, presetA, presetB, customRackA, customRackB]);

  // Apply Presets and AI Volume
  const applyParams = (
    deckGain: GainNode | null, deckBass: BiquadFilterNode | null, deckTreble: BiquadFilterNode | null, deckComp: DynamicsCompressorNode | null, deckLimiter: DynamicsCompressorNode | null,
    presetKey: PresetKey, aiAnalysis?: any, isAutoVolumeEnabled = false, customRack?: RackSettings, deckId: 'A' | 'B' = 'A'
  ) => {
    if (!deckGain || !deckBass || !deckTreble || !deckComp || !deckLimiter || !audioContextRef.current) return;
    const time = audioContextRef.current.currentTime;
    
    let targetGain = 1;
    let targetBass = 0;
    let targetTreble = 0;

    const eq16Nodes = deckId === 'A' ? eq16NodesRef.current : eq16NodesRefB.current;
    const revConvolver = deckId === 'A' ? reverbConvolverRef.current : reverbConvolverRefB.current;
    const revWet = deckId === 'A' ? reverbWetGainRef.current : reverbWetGainRefB.current;
    const revDry = deckId === 'A' ? reverbDryGainRef.current : reverbDryGainRefB.current;
    const stereo = deckId === 'A' ? stereoNodeRef.current : stereoNodeRefB.current;

    // Set EQ16 peaking filters based on preset bands (or reset to neutral if not specified)
    if (presetKey !== 'custom' && eq16Nodes.length === 16) {
      const p = SOUND_PRESETS[presetKey];
      const presetBands = p && 'bands' in p ? p.bands : null;
      eq16Nodes.forEach((node, i) => {
        const val = (presetBands && presetBands[i] !== undefined) ? presetBands[i] : 0;
        node.gain.setTargetAtTime(val, time, 0.05);
      });
    }

    // Apply Preset
    if (presetKey === 'custom' && customRack) {
      const eqPlugin = customRack.plugins.find(p => p.type === 'eq16' && p.enabled);
      if (eqPlugin && eqPlugin.type === 'eq16') {
        if (eq16Nodes.length === 16) {
          eq16Nodes.forEach((node, i) => {
            const val = eqPlugin.params.bands[i] ?? 0;
            node.gain.setTargetAtTime(val, time, 0.05);
          });
        }
        // Approximate bass with band 3 (80Hz) and treble with band 12 (5kHz) for legacy UI fallback
        targetBass += eqPlugin.params.bands[3] ?? 0;
        targetTreble += eqPlugin.params.bands[12] ?? 0;
      } else {
        if (eq16Nodes.length === 16) {
          eq16Nodes.forEach(node => {
            node.gain.setTargetAtTime(0, time, 0.05);
          });
        }
      }
      
      const compPlugin = customRack.plugins.find(p => p.type === 'compressor' && p.enabled);
      if (compPlugin && compPlugin.type === 'compressor') {
        deckComp.threshold.setTargetAtTime(compPlugin.params.threshold, time, 0.1);
        deckComp.ratio.setTargetAtTime(compPlugin.params.ratio, time, 0.1);
        deckComp.attack.setTargetAtTime(compPlugin.params.attack, time, 0.1);
        deckComp.release.setTargetAtTime(compPlugin.params.release, time, 0.1);
      } else {
        deckComp.threshold.setTargetAtTime(0, time, 0.1);
        deckComp.ratio.setTargetAtTime(1, time, 0.1);
      }
      
      const limiterPlugin = customRack.plugins.find(p => p.type === 'limiter' && p.enabled);
      if (limiterPlugin && limiterPlugin.type === 'limiter') {
        deckLimiter.threshold.setTargetAtTime(limiterPlugin.params.threshold, time, 0.1);
        deckLimiter.ratio.setTargetAtTime(Math.min(20, Math.max(1, limiterPlugin.params.ratio || 20)), time, 0.1);
        if (limiterPlugin.params.release !== undefined) {
          deckLimiter.release.setTargetAtTime(Math.min(1.0, Math.max(0.001, limiterPlugin.params.release)), time, 0.1);
        }
      } else {
        deckLimiter.threshold.setTargetAtTime(0, time, 0.1);
        deckLimiter.ratio.setTargetAtTime(1, time, 0.1);
      }

      // Stereo width is handled globally at the end of applyParams based on decoders


      // Apply Linux wrappers parameters
      customRack.plugins.forEach(plugin => {
        if (plugin.type === 'linux_wrapper' && plugin.enabled) {
          const nodes = getOrCreateWrapperNodes(plugin as LinuxWrapperPlugin, deckId);
          if (plugin.pluginId === 'calf_delay' && nodes.delayNode && nodes.feedbackNode && nodes.wetGain && nodes.dryGain) {
            const delay = nodes.delayNode as DelayNode;
            const feedback = nodes.feedbackNode as GainNode;
            const wet = nodes.wetGain as GainNode;
            const dry = nodes.dryGain as GainNode;

            const delayVal = plugin.params.delayTime ?? 0.3;
            const feedbackVal = plugin.params.feedback ?? 0.5;
            const mixVal = plugin.params.mix ?? 0.3;

            delay.delayTime.setTargetAtTime(delayVal, time, 0.05);
            feedback.gain.setTargetAtTime(feedbackVal, time, 0.05);
            wet.gain.setTargetAtTime(mixVal, time, 0.05);
            dry.gain.setTargetAtTime(1.0 - mixVal, time, 0.05);
          } else if (plugin.pluginId === 'calf_exciter' && nodes.highPassFilter && nodes.wetGain && nodes.dryGain) {
            const hp = nodes.highPassFilter as BiquadFilterNode;
            const wet = nodes.wetGain as GainNode;
            const dry = nodes.dryGain as GainNode;

            const freqVal = plugin.params.frequency ?? 4000;
            const amtVal = plugin.params.amount ?? 3.0; // in dB

            hp.frequency.setTargetAtTime(freqVal, time, 0.05);
            const gainVal = Math.pow(10, amtVal / 20) - 1.0;
            wet.gain.setTargetAtTime(Math.max(0, gainVal), time, 0.05);
            dry.gain.setTargetAtTime(1.0, time, 0.05);
          } else if (plugin.pluginId === 'lsp_deesser' && nodes.bandPassFilter && nodes.notchFilter) {
            const bp = nodes.bandPassFilter as BiquadFilterNode;
            const notch = nodes.notchFilter as BiquadFilterNode;

            const freqVal = plugin.params.frequency ?? 6000;
            const intensityVal = plugin.params.intensity ?? 3.0;

            bp.frequency.setTargetAtTime(freqVal, time, 0.05);
            notch.frequency.setTargetAtTime(freqVal, time, 0.05);
            notch.gain.setTargetAtTime(-intensityVal, time, 0.05);
          } else if (plugin.pluginId === 'calf_gate' && nodes.gateGain) {
            const gateGain = nodes.gateGain as GainNode;
            (gateGain as any).threshold = plugin.params.threshold ?? -40;
            (gateGain as any).range = plugin.params.range ?? -60;
            (gateGain as any).attack = (plugin.params.attack ?? 10) / 1000;
            (gateGain as any).release = (plugin.params.release ?? 100) / 1000;
          }
        }
      });

      const reverbPlugin = customRack.plugins.find(p => p.type === 'reverb' && p.enabled);
      if (reverbPlugin && reverbPlugin.type === 'reverb' && revConvolver && revWet && revDry) {
        revWet.gain.setTargetAtTime(reverbPlugin.params.mix, time, 0.1);
        revDry.gain.setTargetAtTime(1.0 - reverbPlugin.params.mix, time, 0.1);

        const lastDecay = deckId === 'A' ? reverbDecayA : reverbDecayB;
        const lastPreDelay = deckId === 'A' ? reverbPreDelayA : reverbPreDelayB;

        if (reverbPlugin.params.decay !== lastDecay.current || reverbPlugin.params.preDelay !== lastPreDelay.current) {
          lastDecay.current = reverbPlugin.params.decay;
          lastPreDelay.current = reverbPlugin.params.preDelay;
          try {
            revConvolver.buffer = createReverbBuffer(audioContextRef.current, reverbPlugin.params.decay, reverbPlugin.params.preDelay);
          } catch (e) {
            console.error("Failed to create reverb buffer", e);
          }
        }
      } else if (revWet && revDry) {
        revWet.gain.setTargetAtTime(0, time, 0.1);
        revDry.gain.setTargetAtTime(1, time, 0.1);
      }
    } else {
      const p = SOUND_PRESETS[presetKey];
      if (p) {
        targetBass += p.bass;
        targetTreble += p.treble;
        deckComp.threshold.setTargetAtTime(p.comp.threshold, time, 0.1);
        deckComp.ratio.setTargetAtTime(p.comp.ratio, time, 0.1);
        deckComp.attack.setTargetAtTime(0.003, time, 0.1);
        deckComp.release.setTargetAtTime(0.25, time, 0.1);
        deckLimiter.threshold.setTargetAtTime(-0.5, time, 0.1);
        deckLimiter.ratio.setTargetAtTime(20, time, 0.1);
      }
      // Stereo width and pan calculation is consolidated globally at the end of applyParams
    }

    // Apply AI Analysis overrides if autoVolume is true (for Deck A mostly)
    if (isAutoVolumeEnabled && aiAnalysis) {
      targetGain *= aiAnalysis.gainAdjustment;
      targetBass += aiAnalysis.bassEQ;
      targetTreble += aiAnalysis.trebleEQ;
    }

    // Consolidated prestige decoder spatial rendering & custom/default width
    let finalWidth = 1.0;
    let finalPan = 0;

    if (presetKey === 'custom' && customRack) {
      const stereoPlugin = customRack.plugins.find(p => p.type === 'stereo' && p.enabled);
      if (stereoPlugin && stereoPlugin.type === 'stereo') {
        finalWidth = stereoPlugin.params.width;
        finalPan = stereoPlugin.params.pan;
      }
    }

    if (isDolbyActive && isSony360Active) {
      finalWidth = Math.max(finalWidth, 2.0); // maximum surround immersion
      targetBass += 3.5;
      targetTreble += 4.0;
    } else if (isDolbyActive) {
      finalWidth = Math.max(finalWidth, 1.6); // Dolby Pro-Logic/Surround simulation
      targetBass += 3.0;
      targetTreble += 1.5;
    } else if (isSony360Active) {
      finalWidth = Math.max(finalWidth, 1.9); // Sony 360 Spatial Audio simulation
      targetBass += 0.5;
      targetTreble += 3.0;
    }

    if (stereo) {
      stereo.update(finalWidth, finalPan, time);
    }

    deckGain.gain.setTargetAtTime(targetGain, time, 0.5);
    deckBass.gain.setTargetAtTime(targetBass, time, 0.5);
    deckTreble.gain.setTargetAtTime(targetTreble, time, 0.5);
  };

  useEffect(() => {
    applyParams(gainNodeRef.current, bassNodeRef.current, trebleNodeRef.current, compressorRef.current, limiterRef.current, presetA, currentTrack?.analysis, autoVolume, customRackA, 'A');
  }, [presetA, autoVolume, currentTrack, customRackA, isDolbyActive, isSony360Active]);

  useEffect(() => {
    applyParams(gainNodeRefB.current, bassNodeRefB.current, trebleNodeRefB.current, compressorRefB.current, limiterRefB.current, presetB, currentTrackB?.analysis, false, customRackB, 'B');
  }, [presetB, currentTrackB, customRackB, isDolbyActive, isSony360Active]);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
      if (initialSeekTimeRef.current !== null) {
        audioRef.current.currentTime = initialSeekTimeRef.current;
        initialSeekTimeRef.current = null;
      }
    }
  };

  const getRandomIndex = (excludeIndex: number, length: number): number => {
    if (length <= 1) return 0;
    let rand = Math.floor(Math.random() * length);
    while (rand === excludeIndex) {
      rand = Math.floor(Math.random() * length);
    }
    return rand;
  };

  const handleTrackEnd = () => {
    if (repeatModeA === 'one') {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(console.error);
      }
    } else if (isShuffleA && tracks.length > 0) {
      if (autoAdvance) {
        const nextIdx = getRandomIndex(currentIndex, tracks.length);
        playTrack(nextIdx);
      } else {
        setIsPlaying(false);
        setCurrentTime(0);
      }
    } else if (autoAdvance && currentIndex < tracks.length - 1) {
      playTrack(currentIndex + 1);
    } else if (autoAdvance && repeatModeA === 'all' && tracks.length > 0) {
      playTrack(0);
    } else {
      setIsPlaying(false);
      setCurrentTime(0);
    }
  };

  useEffect(() => {
    handleTrackEndRef.current = handleTrackEnd;
  }, [handleTrackEnd]);

  // Actions
  const togglePlayPause = () => {
    if (!audioRef.current || !currentTrack) return;
    initAudio();
    if (audioRef.current.paused) {
      audioRef.current.play().catch(console.error);
    } else {
      audioRef.current.pause();
    }
  };

  const nextTrack = () => {
    if (tracks.length === 0) return;
    if (isShuffleA) {
      const nextIdx = getRandomIndex(currentIndex, tracks.length);
      playTrack(nextIdx);
    } else if (currentIndex < tracks.length - 1) {
      playTrack(currentIndex + 1);
    } else if (repeatModeA === 'all' && tracks.length > 0) {
      playTrack(0);
    }
  };

  const prevTrack = () => {
    if (tracks.length === 0) return;
    if (currentTime > 3) {
      // If playing for more than 3 seconds, jump to start
      if (audioRef.current) audioRef.current.currentTime = 0;
    } else if (isShuffleA) {
      const prevIdx = getRandomIndex(currentIndex, tracks.length);
      playTrack(prevIdx);
    } else if (currentIndex > 0) {
      playTrack(currentIndex - 1);
    } else if (repeatModeA === 'all' && tracks.length > 0) {
      playTrack(tracks.length - 1);
    }
  };

  const seekTo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const exportTrack = (track: Track) => {
    try {
      const a = document.createElement('a');
      if (track.isRemote) {
        a.href = track.url;
        a.download = `${track.name}.mp3`;
        a.target = '_blank';
      } else {
        a.href = track.url || URL.createObjectURL(track.file);
        a.download = track.file.name;
      }
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error("Failed to export track", err);
    }
  };

  const handleAddUrl = async () => {
    if (!inputUrl.trim()) return;
    setIsExtractingUrl(true);
    setUrlError(null);
    try {
      let cleanUrl = inputUrl.trim();
      if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
        cleanUrl = 'https://' + cleanUrl;
      }
      
      const res = await fetch(`/api/youtube/info?url=${encodeURIComponent(cleanUrl)}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to parse URL. Please check the address.");
      }
      
      const data = await res.json();
      
      // Create mock File object so standard file-handling properties don't throw errors
      const mockFile = new File([], data.title, { type: "audio/mpeg" });
      
      const newTrack: Track = {
        id: crypto.randomUUID(),
        file: mockFile,
        name: data.title,
        url: data.proxyUrl, // Use our CORS-safe proxy stream
        volume: 1.0,
        isRemote: true,
        duration: data.duration > 0 ? data.duration : undefined
      };
      
      if (activeDeckTab === 'A') {
        setTracks(prev => [...prev, newTrack]);
        if (!newTrack.duration) {
          const audio = new Audio(newTrack.url);
          audio.addEventListener('loadedmetadata', () => {
            const dur = audio.duration;
            setTracks(prev => prev.map(t => t.id === newTrack.id ? { ...t, duration: dur } : t));
          });
        }
      } else {
        setTracksB(prev => [...prev, newTrack]);
        if (!newTrack.duration) {
          const audio = new Audio(newTrack.url);
          audio.addEventListener('loadedmetadata', () => {
            const dur = audio.duration;
            setTracksB(prev => prev.map(t => t.id === newTrack.id ? { ...t, duration: dur } : t));
          });
        }
      }

      // Trigger AI Analysis for remote track
      setAnalyzingIds(prev => new Set(prev).add(newTrack.id));
      analyzeAudio(newTrack.url)
        .then(({ analysis, peaks }) => {
          if (activeDeckTab === 'A') {
            setTracks(prevTracks => 
              prevTracks.map(t => t.id === newTrack.id ? { ...t, analysis, peaks } : t)
            );
          } else {
            setTracksB(prevTracks => 
              prevTracks.map(t => t.id === newTrack.id ? { ...t, analysis, peaks } : t)
            );
          }
        })
        .catch(err => console.error(`AI Analysis failed for remote track ${newTrack.name}`, err))
        .finally(() => {
          setAnalyzingIds(prev => {
            const next = new Set(prev);
            next.delete(newTrack.id);
            return next;
          });
        });
      
      setInputUrl('');
      setShowUrlInput(false);
    } catch (err: any) {
      console.error("URL extraction error:", err);
      setUrlError(err.message || "Could not retrieve audio from this URL. Make sure it is valid.");
    } finally {
      setIsExtractingUrl(false);
    }
  };

  // Track Management
  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    const newTracks: Track[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      name: file.name.replace(/\.[^/.]+$/, ""),
      url: URL.createObjectURL(file),
      volume: 1.0,
    }));

    setTracks(prev => {
      const updated = [...prev, ...newTracks];
      // Select first track if empty
      if (prev.length === 0 && newTracks.length > 0) {
        setCurrentIndex(0);
      }
      return updated;
    });

    // Load duration for new tracks
    newTracks.forEach(track => {
      const audio = new Audio(track.url);
      audio.addEventListener('loadedmetadata', () => {
        const dur = audio.duration;
        setTracks(prev => prev.map(t => t.id === track.id ? { ...t, duration: dur } : t));
      });
    });
    
    // Trigger AI Analysis for new tracks
    newTracks.forEach(track => {
      setAnalyzingIds(prev => new Set(prev).add(track.id));
      analyzeAudio(track.file)
        .then(({ analysis, peaks }) => {
          setTracks(prevTracks => 
            prevTracks.map(t => t.id === track.id ? { ...t, analysis, peaks } : t)
          );
        })
        .catch(err => console.error(`AI Analysis failed for ${track.name}`, err))
        .finally(() => {
          setAnalyzingIds(prev => {
            const next = new Set(prev);
            next.delete(track.id);
            return next;
          });
        });
    });

    // Reset input
    e.target.value = '';
  };

  const removeTrack = (id: string, index: number) => {
    setTracks(prev => {
      const updated = prev.filter(t => t.id !== id);
      URL.revokeObjectURL(prev[index].url);
      
      if (currentIndex === index) {
        stopPlayback();
        setCurrentIndex(updated.length > 0 ? 0 : -1);
      } else if (currentIndex > index) {
        setCurrentIndex(currentIndex - 1);
      }
      return updated;
    });
  };

  const moveTrack = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === tracks.length - 1) return;

    setTracks(prev => {
      const updated = [...prev];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      
      // Swap
      [updated[index], updated[targetIndex]] = [updated[targetIndex], updated[index]];
      
      // Keep track of current playing index
      if (currentIndex === index) {
        setCurrentIndex(targetIndex);
      } else if (currentIndex === targetIndex) {
        setCurrentIndex(index);
      }
      
      return updated;
    });
  };

  const updateTrackVolume = (id: string, newVolume: number) => {
    setTracks(prev => prev.map(t => t.id === id ? { ...t, volume: newVolume } : t));
  };

  const updateTrackAgendaTime = (id: string, time: string) => {
    setTracks(prev => prev.map(t => t.id === id ? { ...t, agendaTime: time } : t));
  };

  const updateTrackAgendaEndTime = (id: string, time: string) => {
    setTracks(prev => prev.map(t => t.id === id ? { ...t, agendaEndTime: time } : t));
  };

  // Playlist Management
  const openSaveModal = () => {
    const current = savedPlaylists.find(p => p.id === currentPlaylistId);
    setPlaylistNameInput(current ? current.name : `Playlist ${savedPlaylists.length + 1}`);
    setShowSaveModal(true);
  };

  const handleSavePlaylist = async () => {
    if (!playlistNameInput.trim()) return;
    
    const existing = savedPlaylists.find(p => p.name === playlistNameInput.trim());
    const id = existing ? existing.id : crypto.randomUUID();
    
    const newPlaylist: Playlist = {
      id,
      name: playlistNameInput.trim(),
      tracks: tracks.map(t => ({
        id: t.id,
        file: t.file,
        name: t.name,
        volume: t.volume,
        analysis: t.analysis,
        peaks: t.peaks,
        agendaTime: t.agendaTime,
        agendaEndTime: t.agendaEndTime,
        duration: t.duration,
        isRemote: t.isRemote,
        url: t.isRemote ? t.url : undefined
      }))
    };
    
    try {
      await savePlaylistToDB(newPlaylist);
      const updated = await loadPlaylistsFromDB();
      setSavedPlaylists(updated);
      setCurrentPlaylistId(id);
      setShowSaveModal(false);
    } catch (e) {
      console.error("Failed to save playlist", e);
    }
  };

  const loadPlaylist = (playlistId: string) => {
    if (!playlistId) {
      stopPlayback();
      tracks.forEach(t => URL.revokeObjectURL(t.url));
      setTracks([]);
      setCurrentPlaylistId(null);
      setCurrentIndex(-1);
      return;
    }
    
    const playlist = savedPlaylists.find(p => p.id === playlistId);
    if (playlist) {
      stopPlayback();
      tracks.forEach(t => URL.revokeObjectURL(t.url));
      
      const loadedTracks: Track[] = playlist.tracks.map(t => ({
        ...t,
        url: t.isRemote ? t.url : URL.createObjectURL(t.file)
      }));
      setTracks(loadedTracks);
      setCurrentPlaylistId(playlist.id);
      setCurrentIndex(loadedTracks.length > 0 ? 0 : -1);

      // Backfill durations if missing
      loadedTracks.forEach((t: any) => {
        if (t.duration === undefined) {
          const audio = new Audio(t.url);
          audio.addEventListener('loadedmetadata', () => {
            const dur = audio.duration;
            setTracks(prev => prev.map(pt => pt.id === t.id ? { ...pt, duration: dur } : pt));
          });
        }
      });
    }
  };

  const handleDeletePlaylist = async () => {
    if (currentPlaylistId) {
      await deletePlaylistFromDB(currentPlaylistId);
      const updated = await loadPlaylistsFromDB();
      setSavedPlaylists(updated);
      loadPlaylist('');
    }
  };

  const isDeckAMonitored = activeDeckTab === 'A' || (activeDeckTab === 'Rack' && rackDeck === 'A');
  const monitoredTrack = isDeckAMonitored ? currentTrack : currentTrackB;
  const monitoredNextTrack = isDeckAMonitored 
    ? (currentIndex >= 0 && currentIndex + 1 < tracks.length ? tracks[currentIndex + 1] : null)
    : (currentIndexB >= 0 && currentIndexB + 1 < tracksB.length ? tracksB[currentIndexB + 1] : null);
  const isMonitoredPlaying = isDeckAMonitored ? isPlaying : isPlayingB;
  const monitoredTime = isDeckAMonitored ? currentTime : currentTimeB;
  const monitoredDuration = isDeckAMonitored ? duration : durationB;
  const monitoredDeckName = isDeckAMonitored ? "DECK A" : "DECK B";

  return (
    <div className="h-screen bg-[#0F1012] text-[#E2E8F0] font-sans selection:bg-[#F27D26]/30 flex flex-col p-4 gap-4 overflow-hidden app-root-container">
      {audioPlaybackError && (
        <div className="z-50 bg-red-950/95 border border-red-500/30 text-red-200 px-4 py-3 rounded-lg flex items-center justify-between shadow-[0_4px_20px_rgba(239,68,68,0.2)] max-w-xl w-[90%] mx-auto fixed top-4 left-1/2 -translate-x-1/2">
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-[#F27D26] font-bold">● AUDIO ERROR:</span>
            <span>{audioPlaybackError}</span>
          </div>
          <button 
            onClick={() => setAudioPlaybackError(null)}
            className="text-red-400 hover:text-red-100 font-bold ml-4 text-[10px] bg-red-900/40 hover:bg-red-900/80 px-2 py-1 rounded cursor-pointer"
          >
            DISMISS
          </button>
        </div>
      )}
      {/* Side Panel Drawer (Mobile Navigation & Utilities) */}
      {isSidebarOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          {/* Backdrop blur */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.6 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />

          {/* Sliding Panel */}
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 220 }}
            className="relative w-[300px] max-w-[85vw] h-full bg-[#141519] border-r border-white/10 flex flex-col p-5 shadow-[5px_0_30px_rgba(0,0,0,0.8)] select-none z-10 overflow-y-auto"
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-4">
              <div className="flex items-center gap-2.5">
                <img 
                  src="/src/assets/images/stagecue_favicon_1783965127263.jpg" 
                  alt="StageCue Logo" 
                  className="w-9 h-9 rounded-lg border border-white/10 shadow-[0_0_10px_rgba(242,125,38,0.2)] object-cover select-none"
                  referrerPolicy="no-referrer"
                />
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-mono font-bold text-[#F27D26] uppercase tracking-[0.2em]">STAGE005</span>
                  <span className="text-sm font-bold text-[#E2E8F0] tracking-wider uppercase font-orbitron">SYSTEM CONTROL</span>
                </div>
              </div>
              <button 
                onClick={() => setIsSidebarOpen(false)}
                className="p-1.5 rounded-lg border border-white/5 bg-black/20 text-zinc-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content Groups */}
            <div className="flex-1 flex flex-col gap-5">
              
              {/* GROUP 1: MODULE SELECTION */}
              <div className="flex flex-col gap-2">
                <div className="text-[9px] font-mono font-extrabold text-zinc-500 uppercase tracking-widest pl-1">
                  MODULE NAVIGATOR
                </div>
                
                {/* Player Console Link */}
                <button
                  onClick={() => {
                    setMobileActiveView('console');
                    setIsSidebarOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border text-left transition-all font-mono font-bold text-xs uppercase tracking-wider",
                    mobileActiveView === 'console'
                      ? "bg-[#F27D26]/10 border-[#F27D26]/40 text-[#F27D26] shadow-[0_0_12px_rgba(242,125,38,0.15)]"
                      : "bg-black/20 border-white/[0.03] text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <Activity className="w-4 h-4" />
                    <span>Player Console</span>
                  </div>
                  {mobileActiveView === 'console' && <span className="w-1.5 h-1.5 rounded-full bg-[#F27D26] shadow-[0_0_6px_#F27D26]" />}
                </button>

                {/* Playlist Deck A Link */}
                <button
                  onClick={() => {
                    setMobileActiveView('playlist');
                    setActiveDeckTab('A');
                    setIsSidebarOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border text-left transition-all font-mono font-bold text-xs uppercase tracking-wider",
                    mobileActiveView === 'playlist' && activeDeckTab === 'A'
                      ? "bg-[#F27D26]/10 border-[#F27D26]/40 text-[#F27D26] shadow-[0_0_12px_rgba(242,125,38,0.15)]"
                      : "bg-black/20 border-white/[0.03] text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <ListMusic className="w-4 h-4" />
                    <span>Deck A (Cues)</span>
                  </div>
                  {mobileActiveView === 'playlist' && activeDeckTab === 'A' && <span className="w-1.5 h-1.5 rounded-full bg-[#F27D26] shadow-[0_0_6px_#F27D26]" />}
                </button>

                {/* Playlist Deck B Link */}
                <button
                  onClick={() => {
                    setMobileActiveView('playlist');
                    setActiveDeckTab('B');
                    setIsSidebarOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border text-left transition-all font-mono font-bold text-xs uppercase tracking-wider",
                    mobileActiveView === 'playlist' && activeDeckTab === 'B'
                      ? "bg-[#F27D26]/10 border-[#F27D26]/40 text-[#F27D26] shadow-[0_0_12px_rgba(242,125,38,0.15)]"
                      : "bg-black/20 border-white/[0.03] text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <ListMusic className="w-4 h-4" />
                    <span>Deck B (BGM)</span>
                  </div>
                  {mobileActiveView === 'playlist' && activeDeckTab === 'B' && <span className="w-1.5 h-1.5 rounded-full bg-[#F27D26] shadow-[0_0_6px_#F27D26]" />}
                </button>

                {/* DSP Rack Link */}
                <button
                  onClick={() => {
                    setMobileActiveView('playlist');
                    setActiveDeckTab('Rack');
                    setIsSidebarOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border text-left transition-all font-mono font-bold text-xs uppercase tracking-wider",
                    mobileActiveView === 'playlist' && activeDeckTab === 'Rack'
                      ? "bg-[#34D399]/10 border-[#34D399]/40 text-[#34D399] shadow-[0_0_12px_rgba(52,211,153,0.15)]"
                      : "bg-black/20 border-white/[0.03] text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <Settings2 className="w-4 h-4" />
                    <span>DSP Effect Rack</span>
                  </div>
                  {mobileActiveView === 'playlist' && activeDeckTab === 'Rack' && <span className="w-1.5 h-1.5 rounded-full bg-[#34D399] shadow-[0_0_6px_#34D399]" />}
                </button>
              </div>

              {/* GROUP 2: SOUND PRESETS & STYLES */}
              <div className="flex flex-col gap-2.5 border-t border-white/5 pt-4">
                <div className="text-[9px] font-mono font-extrabold text-zinc-500 uppercase tracking-widest pl-1">
                  SOUND STYLE PRESETS
                </div>
                
                {/* Deck A Sound Style */}
                <div className="flex flex-col gap-1.5 bg-black/25 border border-white/[0.03] rounded-xl p-3">
                  <div className="text-[9px] font-mono font-bold text-[#F27D26]/80 uppercase tracking-wider">
                    DECK A (CUES) PRESET
                  </div>
                  <select
                    value={presetA}
                    onChange={(e) => setPresetA(e.target.value as PresetKey)}
                    className="w-full bg-black/50 border border-white/10 rounded px-2 py-1.5 text-xs text-[#E2E8F0] uppercase tracking-wider font-semibold focus:outline-none focus:border-[#F27D26] cursor-pointer"
                  >
                    {Object.entries(SOUND_PRESETS).map(([k, v]) => (
                      <option key={k} value={k} className="bg-[#1E2024]">{v.name}</option>
                    ))}
                  </select>
                </div>

                {/* Deck B Sound Style */}
                <div className="flex flex-col gap-1.5 bg-black/25 border border-white/[0.03] rounded-xl p-3">
                  <div className="text-[9px] font-mono font-bold text-cyan-400/80 uppercase tracking-wider">
                    DECK B (BGM) PRESET
                  </div>
                  <select
                    value={presetB}
                    onChange={(e) => setPresetB(e.target.value as PresetKey)}
                    className="w-full bg-black/50 border border-white/10 rounded px-2 py-1.5 text-xs text-[#E2E8F0] uppercase tracking-wider font-semibold focus:outline-none focus:border-[#F27D26] cursor-pointer"
                  >
                    {Object.entries(SOUND_PRESETS).map(([k, v]) => (
                      <option key={k} value={k} className="bg-[#1E2024]">{v.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* GROUP 3: AUDIO DECODERS (Dolby / Sony 360) */}
              <div className="flex flex-col gap-2 border-t border-white/5 ">
                {/*<div className="text-[9px] font-mono font-extrabold text-zinc-500 uppercase tracking-widest pl-1">
                  AUDIO DECODERS
                </div> */}
                
                {/* Dolby Surround */}
                <button
                  onClick={() => {
                    setIsDolbyActive(!isDolbyActive);
                    if (!isDolbyActive) {
                      setIsSony360Active(false);
                    }
                  }}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3.5 py-2 rounded-lg border text-[10px] font-mono font-bold tracking-[0.1em] transition-all duration-300",
                    isDolbyActive
                      ? "bg-amber-500/15 border-amber-500/40 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.2)]"
                      : "bg-black/20 border-white/[0.03] text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  <svg className="w-4 h-3 fill-current" viewBox="0 0 24 24">
                    <path d="M2 4h5a8 8 0 0 1 0 16H2V4zm5 3a5 5 0 0 0 0 10H5V7h2z M22 4h-5a8 8 0 0 0 0 16h5V4zm-5 3a5 5 0 0 1 0 10h2V7h-2z" />
                  </svg>
                  <span>DOLBY SURROUND</span>
                </button>

                {/* Sony 360 Reality Audio */}
                <button
                  onClick={() => {
                    setIsSony360Active(!isSony360Active);
                    if (!isSony360Active) {
                      setIsDolbyActive(false);
                    }
                  }}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3.5 py-2 rounded-lg border text-[10px] font-mono font-bold tracking-[0.1em] transition-all duration-300",
                    isSony360Active
                      ? "bg-[#00E5FF]/15 border-[#00E5FF]/40 text-[#00E5FF] shadow-[0_0_12px_rgba(0,229,255,0.2)]"
                      : "bg-black/20 border-white/[0.03] text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  <div className="w-4 h-4 rounded-full border-2 border-current flex items-center justify-center text-[8px] font-extrabold">360</div>
                  <span>360 REALITY AUDIO</span>
                </button>
              </div>

              {/* GROUP 4: SYSTEM TOGGLES */}
              <div className="flex flex-col gap-3 border-t border-white/5 pt-4">
                <div className="text-[9px] font-mono font-extrabold text-zinc-500 uppercase tracking-widest pl-1">
                  SYSTEM SETTINGS
                </div>
                
                {/* Auto Volume Toggle */}
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-[10px] font-bold font-mono tracking-wider text-zinc-400 uppercase">AUTO-VOLUME</span>
                  <label className="relative inline-block w-8 h-4 align-middle select-none transition duration-200 ease-in cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={autoVolume}
                      onChange={(e) => setAutoVolume(e.target.checked)}
                      className="toggle-checkbox absolute block w-4 h-4 rounded-full bg-[#94A3B8] border-2 border-[#1E2024] appearance-none cursor-pointer transition-all duration-300 checked:right-0 checked:bg-[#F27D26] checked:border-transparent"
                      style={{ right: autoVolume ? '0' : '1rem', top: 0 }}
                    />
                    <div className="toggle-label block overflow-hidden h-4 rounded-full bg-black/50 cursor-pointer"></div>
                  </label>
                </div>

                {/* Auto Advance Toggle */}
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-[10px] font-bold font-mono tracking-wider text-zinc-400 uppercase">AUTO-CUE</span>
                  <label className="relative inline-block w-8 h-4 align-middle select-none transition duration-200 ease-in cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={autoAdvance}
                      onChange={(e) => setAutoAdvance(e.target.checked)}
                      className="toggle-checkbox absolute block w-4 h-4 rounded-full bg-[#94A3B8] border-2 border-[#1E2024] appearance-none cursor-pointer transition-all duration-300 checked:right-0 checked:bg-[#F27D26] checked:border-transparent"
                      style={{ right: autoAdvance ? '0' : '1rem', top: 0 }}
                    />
                    <div className="toggle-label block overflow-hidden h-4 rounded-full bg-black/50 cursor-pointer"></div>
                  </label>
                </div>

                {/* Auto Agenda Toggle */}
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-[10px] font-bold font-mono tracking-wider text-zinc-400 uppercase">AI AGENDA CTL</span>
                  <label className="relative inline-block w-8 h-4 align-middle select-none transition duration-200 ease-in cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={autoAgenda}
                      onChange={(e) => setAutoAgenda(e.target.checked)}
                      className="toggle-checkbox absolute block w-4 h-4 rounded-full bg-[#94A3B8] border-2 border-[#1E2024] appearance-none cursor-pointer transition-all duration-300 checked:right-0 checked:bg-[#F27D26] checked:border-transparent"
                      style={{ right: autoAgenda ? '0' : '1rem', top: 0 }}
                    />
                    <div className="toggle-label block overflow-hidden h-4 rounded-full bg-black/50 cursor-pointer"></div>
                  </label>
                </div>

                {/* AI Agenda Trigger */}
                <button 
                  onClick={() => {
                    setShowAIAgenda(true);
                    setIsSidebarOpen(false);
                  }}
                  className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 bg-[#F27D26] hover:bg-[#F27D26]/90 text-black text-xs font-mono font-bold tracking-widest uppercase transition-colors rounded-lg shadow-[0_0_15px_rgba(242,125,38,0.25)]"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>OPEN AI AGENDA</span>
                </button>

                {/* Keyboard Shortcuts Trigger */}
                <button 
                  onClick={() => {
                    setShowShortcuts(true);
                    setIsSidebarOpen(false);
                  }}
                  className="mt-2 w-full flex items-center justify-center gap-2 py-2 bg-black/40 hover:bg-black/60 border border-white/10 hover:border-white/20 text-[#E2E8F0] text-xs font-mono font-bold tracking-widest uppercase transition-all rounded-lg"
                >
                  <svg className="w-4 h-4 text-[#F27D26]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10" />
                  </svg>
                  <span>Keyboard Shortcuts</span>
                </button>
              </div>

            </div>

            {/* Footer with clock */}
            <div className="border-t border-white/5 pt-4 mt-auto flex items-center justify-between text-[10px] font-mono text-zinc-500">
              <span>SYS_OK</span>
              <span>{systemTime.toLocaleTimeString('en-US', { hour12: false })}</span>
            </div>
          </motion.div>
        </div>
      )}

      {/* AI Agenda Modal */}
      {showAIAgenda && (
        <AIAgendaModal 
          onClose={() => setShowAIAgenda(false)} 
          onApply={handleApplyAIAgenda} 
        />
      )}

      {/* AI Lyrics & Chords Modal */}
      {showChordsModal && activeChordsTrack && activeChordsTrack.aiLyricsChords && (
        <AILyricsModal
          track={activeChordsTrack}
          onClose={() => {
            setShowChordsModal(false);
            setActiveChordsTrack(null);
          }}
        />
      )}

      {/* Save Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-[#1E2024] p-6 rounded-xl border border-white/10 w-96 shadow-2xl">
            <h3 className="text-[#E2E8F0] font-semibold mb-4 text-sm tracking-widest uppercase">Save Playlist</h3>
            <input 
              type="text" 
              value={playlistNameInput}
              onChange={e => setPlaylistNameInput(e.target.value)}
              placeholder="Playlist name..."
              className="w-full bg-black/50 border border-white/10 rounded px-3 py-2 text-[#E2E8F0] mb-4 focus:outline-none focus:border-[#F27D26]"
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setShowSaveModal(false)}
                className="px-4 py-2 text-xs font-semibold tracking-widest uppercase text-[#94A3B8] hover:text-[#E2E8F0] transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleSavePlaylist}
                className="px-4 py-2 text-xs font-semibold tracking-widest uppercase bg-[#F27D26] text-black rounded hover:bg-[#F27D26]/90 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Overlay */}
      {showShortcuts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-[#141519] border-2 border-zinc-800 p-6 rounded-2xl w-full max-w-md max-h-[95vh] overflow-y-auto custom-scrollbar shadow-[0_20px_50px_rgba(0,0,0,0.9)] relative select-none"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-5">
              <div className="flex items-center gap-2.5">
                <img 
                  src="/src/assets/images/stagecue_favicon_1783965127263.jpg" 
                  alt="StageCue Logo" 
                  className="w-9 h-9 rounded-lg border border-white/10 shadow-[0_0_10px_rgba(242,125,38,0.2)] object-cover select-none"
                  referrerPolicy="no-referrer"
                />
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-mono font-extrabold text-[#F27D26] uppercase tracking-[0.2em]">STAGE005</span>
                  <span className="text-sm font-bold text-[#E2E8F0] tracking-wider uppercase flex items-center gap-2">
                    KEYBOARD SHORTCUTS
                  </span>
                </div>
              </div>
              <button 
                onClick={() => setShowShortcuts(false)}
                className="p-1.5 rounded-lg border border-white/5 bg-black/20 text-zinc-400 hover:text-white transition-colors cursor-pointer flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* List of shortcuts */}
            <div className="flex flex-col gap-4">
              <p className="text-xs text-zinc-400 font-medium leading-relaxed">
                Control the Stage005 Audio Console hands-free using these global hotkeys. Shortcuts adapt automatically to the active channel.
              </p>

              <div className="flex flex-col gap-3.5 bg-black/25 border border-white/[0.03] rounded-xl p-4">
                
                {/* Play/Pause */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-300">Play / Pause Active Deck</span>
                  <div className="flex items-center gap-1">
                    <kbd className="px-2 py-1 bg-[#1E2024] border border-white/10 rounded text-[10px] font-mono font-bold text-zinc-300 shadow-sm uppercase">Space</kbd>
                  </div>
                </div>

                {/* Divider */}
                <div className="h-[1px] bg-white/5" />

                {/* Prev Track */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-300">Previous Track</span>
                  <div className="flex items-center gap-1.5">
                    <kbd className="px-2 py-1 bg-[#1E2024] border border-white/10 rounded text-[10px] font-mono font-bold text-zinc-300 shadow-sm">◀ Arrow</kbd>
                    <span className="text-[10px] text-zinc-500 font-bold font-mono">or</span>
                    <kbd className="px-2.5 py-1 bg-[#1E2024] border border-white/10 rounded text-[10px] font-mono font-bold text-zinc-300 shadow-sm uppercase">P</kbd>
                  </div>
                </div>

                {/* Divider */}
                <div className="h-[1px] bg-white/5" />

                {/* Next Track */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-300">Next Track</span>
                  <div className="flex items-center gap-1.5">
                    <kbd className="px-2 py-1 bg-[#1E2024] border border-white/10 rounded text-[10px] font-mono font-bold text-zinc-300 shadow-sm">Arrow ▶</kbd>
                    <span className="text-[10px] text-zinc-500 font-bold font-mono">or</span>
                    <kbd className="px-2.5 py-1 bg-[#1E2024] border border-white/10 rounded text-[10px] font-mono font-bold text-zinc-300 shadow-sm uppercase">N</kbd>
                  </div>
                </div>

                {/* Divider */}
                <div className="h-[1px] bg-white/5" />

                {/* Deck Switch */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-300">Switch Active Channel (A / B)</span>
                  <div className="flex items-center gap-1.5">
                    <kbd className="px-2 py-1 bg-[#1E2024] border border-white/10 rounded text-[10px] font-mono font-bold text-zinc-300 shadow-sm uppercase">Tab</kbd>
                    <span className="text-[10px] text-zinc-500 font-bold font-mono">or</span>
                    <kbd className="px-2.5 py-1 bg-[#1E2024] border border-white/10 rounded text-[10px] font-mono font-bold text-zinc-300 shadow-sm uppercase">D</kbd>
                  </div>
                </div>

              </div>
              
              <div className="mt-2 text-[9px] font-mono text-zinc-500 flex justify-between items-center bg-black/15 p-2 rounded border border-white/[0.02]">
                <span>STATUS_ACTIVE: OK</span>
                <span>CH_ACTIVE: {activeDeckTab === 'Rack' ? `RACK (${rackDeck})` : `DECK ${activeDeckTab}`}</span>
              </div>
            </div>

            {/* Footer Close Button */}
            <div className="mt-5 flex justify-end">
              <button 
                onClick={() => setShowShortcuts(false)}
                className="px-4 py-2 bg-[#F27D26] hover:bg-[#F27D26]/90 text-black text-xs font-mono font-bold tracking-widest uppercase transition-all rounded-lg shadow-[0_4px_12px_rgba(242,125,38,0.2)] cursor-pointer"
              >
                CLOSE UTILITY
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Hidden Audio Element */}
      <audio
        ref={audioRef}
        src={currentTrack?.url}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleTrackEnd}
        onError={(e) => {
          const errorCode = audioRef.current?.error?.code;
          const isRemote = currentTrack?.isRemote;
          let msg = "Terjadi kesalahan saat memutar audio.";
          if (errorCode === 4) { // MEDIA_ERR_SRC_NOT_SUPPORTED
            if (!isRemote) {
              msg = "Akses file lokal kedaluwarsa karena keamanan browser. Silakan re-import/drag file ini lagi untuk memutar.";
            } else {
              msg = "File audio streaming tidak ditemukan atau dibatasi oleh provider (Coba URL lain atau unduh/unggah file lokal).";
            }
          } else if (errorCode === 3) {
            msg = "Kesalahan decoding audio. Format file ini mungkin tidak didukung.";
          }
          console.error("Audio deck A playback error code:", errorCode, msg);
          setAudioPlaybackError(msg);
        }}
      />

      {/* Header */}
      <header className="bg-[#1E2024] border border-white/5 rounded-lg px-4 md:px-6 py-3 flex flex-col md:flex-row md:items-center justify-between flex-shrink-0 gap-3 main-header-container">
        <div className="flex items-center justify-between md:justify-start gap-4 w-full md:w-auto">
          <div className="flex items-center gap-3">

            <img 
              src="/src/assets/images/stagecue_favicon_1783965127263.jpg" 
              alt="StageCue Logo" 
              className="w-8 h-8 rounded-lg border border-white/10 shadow-[0_0_12px_rgba(242,125,38,0.25)] object-cover select-none"
              referrerPolicy="no-referrer"
            />
            <h1 className="text-sm md:text-[18px] font-normal text-[#E2E8F0] m-0 tracking-tight flex items-center gap-1">
              STAGE_005 <span className="opacity-40 ml-1.5">/</span> <span className="text-[#94A3B8] ml-1.5 text-xs md:text-sm uppercase tracking-widest">Audio Console</span>
            </h1>
          </div>
          
          {/* Mobile Side Panel trigger */}
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="flex lg:hidden items-center gap-1.5 px-3 py-1.5 bg-[#F27D26]/10 border border-[#F27D26]/30 hover:border-[#F27D26]/60 rounded text-[10px] font-bold font-mono tracking-wider text-[#F27D26] hover:bg-[#F27D26]/20 transition-all uppercase active:scale-95"
          >
            <Menu className="w-3.5 h-3.5" />
            <span>Utilities</span>
          </button>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 md:gap-4 bg-black/20 px-3 md:px-4 py-1.5 md:py-2 rounded border border-white/5 justify-between md:justify-end text-[10px] md:text-xs w-full md:w-auto">
          <div className="flex items-center gap-3 md:gap-4 flex-wrap">
            <label className="flex items-center gap-1.5 cursor-pointer group">
              <div className="relative inline-block w-8 h-4 align-middle select-none transition duration-200 ease-in">
                <input 
                  type="checkbox" 
                  checked={autoVolume}
                  onChange={(e) => setAutoVolume(e.target.checked)}
                  className="toggle-checkbox absolute block w-4 h-4 rounded-full bg-[#94A3B8] border-2 border-[#1E2024] appearance-none cursor-pointer transition-all duration-300 checked:right-0 checked:bg-[#F27D26] checked:border-transparent"
                  style={{ right: autoVolume ? '0' : '1rem', top: 0 }}
                />
                <div className="toggle-label block overflow-hidden h-4 rounded-full bg-black/50 cursor-pointer"></div>
              </div>
              <span className="text-[10px] font-bold tracking-widest text-[#94A3B8] uppercase group-hover:text-[#E2E8F0] transition-colors">
                Auto-Vol
              </span>
            </label>
            <div className="w-[1px] h-3 bg-white/10"></div>
            <label className="flex items-center gap-1.5 cursor-pointer group">
              <div className="relative inline-block w-8 h-4 align-middle select-none transition duration-200 ease-in">
                <input 
                  type="checkbox" 
                  checked={autoAdvance}
                  onChange={(e) => setAutoAdvance(e.target.checked)}
                  className="toggle-checkbox absolute block w-4 h-4 rounded-full bg-[#94A3B8] border-2 border-[#1E2024] appearance-none cursor-pointer transition-all duration-300 checked:right-0 checked:bg-[#F27D26] checked:border-transparent"
                  style={{ right: autoAdvance ? '0' : '1rem', top: 0 }}
                />
                <div className="toggle-label block overflow-hidden h-4 rounded-full bg-black/50 cursor-pointer"></div>
              </div>
              <span className="text-[10px] font-bold tracking-widest text-[#94A3B8] uppercase group-hover:text-[#E2E8F0] transition-colors">
                Auto-Cue
              </span>
            </label>
            <div className="w-[1px] h-3 bg-white/10"></div>
            <label className="flex items-center gap-1.5 cursor-pointer group">
              <div className="relative inline-block w-8 h-4 align-middle select-none transition duration-200 ease-in">
                <input 
                  type="checkbox" 
                  checked={autoAgenda}
                  onChange={(e) => setAutoAgenda(e.target.checked)}
                  className="toggle-checkbox absolute block w-4 h-4 rounded-full bg-[#94A3B8] border-2 border-[#1E2024] appearance-none cursor-pointer transition-all duration-300 checked:right-0 checked:bg-[#F27D26] checked:border-transparent"
                  style={{ right: autoAgenda ? '0' : '1rem', top: 0 }}
                />
                <div className="toggle-label block overflow-hidden h-4 rounded-full bg-black/50 cursor-pointer"></div>
              </div>
              <span className="text-[10px] font-bold tracking-widest text-[#94A3B8] uppercase group-hover:text-[#E2E8F0] transition-colors">
                Agenda
              </span>
            </label>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="w-[1px] h-3 bg-white/10 hidden md:block"></div>
            <div className="text-[#E2E8F0] font-mono tracking-widest text-[11px] md:text-sm pl-0 md:pl-2">
              {systemTime.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
            <div className="w-[1px] h-3 bg-white/10"></div>
            <button 
              onClick={() => setShowShortcuts(true)}
              className="flex items-center gap-1.5 text-[#94A3B8] hover:text-[#E2E8F0] text-[10px] font-bold tracking-widest uppercase transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10" />
              </svg>
              <span>Shortcuts</span>
            </button>
            <div className="w-[1px] h-3 bg-white/10"></div>
            <button 
              onClick={() => setShowAIAgenda(true)}
              className="flex items-center gap-1 text-[#F27D26] hover:text-[#F27D26]/80 text-[10px] font-bold tracking-widest uppercase transition-colors"
            >
              <Sparkles className="w-2.5 h-2.5" />
              AI Agenda
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 flex gap-4 min-h-0">
        
        {/* Left Column: Player Console */}
        <section className={cn(
          "w-full lg:w-1/2 flex flex-col bg-[radial-gradient(circle_at_center,#1E2024_0%,#0F1012_100%)] border border-white/5 rounded-lg overflow-hidden relative",
          mobileActiveView !== 'console' && "hidden lg:flex"
        )}>
          
          <div className="px-4 py-2 bg-black/20 border-b border-white/5 text-xs uppercase tracking-widest text-[#94A3B8] font-semibold flex-shrink-0 flex items-center justify-between">
            <span>Active Channel: {monitoredDeckName}</span>
            {monitoredTrack && (
              <button
                onClick={() => exportTrack(monitoredTrack)}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-[#F27D26]/10 hover:bg-[#F27D26]/20 border border-[#F27D26]/30 hover:border-[#F27D26]/60 rounded text-[10px] font-mono font-bold tracking-wider text-[#F27D26] transition-all hover:scale-[1.02] active:scale-[0.98]"
                title="Export currently loaded track"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Track</span>
              </button>
            )}
          </div>

          <div className="flex-1 flex flex-col justify-center items-center p-4 md:p-6 text-center relative min-h-0 rounded">
            <div className="absolute inset-0 top-12 bottom-[2%] opacity-60 pointer-events-none">
              <SpectrumVisualizer analyser={analyserRef.current} />
            </div>
            
            <div className="text-[#F27D26] text-[9px] font-mono font-bold uppercase tracking-[0.3em] mb-4 relative z-10 opacity-60 select-none">Stage005 Performance Monitor</div>
            
            {/* Premium High-End Car Audio / VFD Digital Screen Panel */}
            <div className="relative w-full max-w-2xl bg-gradient-to-b from-[#0c0d12] via-[#07080b] to-[#030406] border-2 border-slate-800/80 px-2 md:px-3 py-2 md:py-3 rounded-2xl shadow-[0_15px_40px_rgba(0,0,0,0.85),inset_0_2px_20px_rgba(0,0,0,0.95)] overflow-hidden flex flex-col gap-2.5 md:gap-3 min-h-[11rem] select-none mb-4 relative z-10 opacity-90 vfd-screen">
              
              {/* Glass shine glare layer */}
              <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.015] to-white/[0.05] pointer-events-none z-20" />
              
              {/* LED Matrix Dot/Scanline Overlay */}
              <div className="absolute inset-0 opacity-[0.06] bg-[linear-gradient(rgba(242,125,38,0.15)_1px,transparent_1px),linear-gradient(90deg,rgba(242,125,38,0.15)_1px,transparent_1px)] bg-[size:3px_3px] pointer-events-none z-10" />
              <div className="absolute inset-0 opacity-[0.08] bg-[linear-gradient(to_bottom,transparent_50%,rgba(0,0,0,0.45)_50%)] bg-[size:100%_4px] pointer-events-none z-10" />

              {/* Header Row: Hi-Fi Status Indicators */}
              <div className="flex items-center justify-between font-mono text-[9px] text-[#94A3B8]/60 tracking-wider border-b border-white/[0.03] pb-1.5 z-10">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "w-2 h-2 rounded-full transition-all duration-300", 
                    isMonitoredPlaying ? "bg-[#F27D26] shadow-[0_0_8px_#F27D26] animate-pulse" : "bg-zinc-700"
                  )} />
                  <span className={cn("font-bold", isMonitoredPlaying ? "text-[#F27D26]" : "text-zinc-500")}>
                    {isMonitoredPlaying ? "▶ PLAYING" : "⏸ PAUSED"}
                  </span>
                  <span className="text-zinc-700">|</span>
                  <span className="text-amber-500/80 font-bold bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/25 shadow-[0_0_6px_rgba(245,158,11,0.1)]">HQ AUDIO</span>
                </div>

                <div className="flex items-center gap-2.5">
                  <div className="relative overflow-hidden w-20 sm:w-60 md:w-80 h-[17px] flex items-center rounded px-1">
                    <motion.div
                      animate={{ x: ["100%", "-100%"] }}
                      transition={{
                        repeat: Infinity,
                        repeatType: "loop",
                        duration: 35,
                        ease: "linear"
                      }}
                      className="whitespace-nowrap text-cyan-400/90 font-bold tracking-[0.1em] text-[8px] uppercase"
                    >
                      Stage005 Premium Monitor • Chief Architect & Executive Producer: egidf • Powered by Google Gemini AI • Core Media Engine: yt-dlp Contributors (pukkandan, remitamine, bashonly, grubles) • Custom Web Audio API DSP Engine • Waveform Engine: Wavesurfer.js (katspaugh) • Animations: Framer Motion (mattgperry) • Icons: Lucide React • Charts: Recharts • Styled with Tailwind CSS • Developed on Google AI Studio Build Platform
                    </motion.div>
                  </div>
                  <span className="text-zinc-700">•</span>
                  <span className="text-[#F27D26] font-bold">{monitoredDeckName}</span>
                </div>
              </div>

              {/* Main Content Area: Scrolling Ticker with high-fidelity metadata displays */}
              <div className="flex-1 flex items-center justify-center relative overflow-hidden py-1">
                {monitoredTrack ? (
                  <div className="w-full flex flex-col gap-2.5 md:gap-3.5 select-none text-left px-1">
                    
                    {/* NOW PERFORMANCE BAND */}
                    <div className="flex flex-col gap-1">
                      <div className="text-[9px] font-mono tracking-[0.2em] text-[#F27D26]/75 uppercase font-bold my-auto">Now Performing</div>
                      
                      <div className="flex flex-col md:flex-row md:items-center justify-between w-full bg-black/40 border border-[#F27D26]/20 rounded-xl px-4 py-2.5 shadow-[inset_0_1px_8px_rgba(0,0,0,0.6)] relative overflow-hidden gap-2.5 md:gap-0">
                        {/* Glass shine element on this card */}
                        <div className="absolute inset-0 bg-gradient-to-r from-[#F27D26]/0 via-[#F27D26]/5 to-[#F27D26]/0 pointer-events-none" />
                        
                        {/* Left Part: Title / Artist / Album (Scrolling ticker if too long) */}
                        <div className="flex-1 overflow-hidden relative pr-0 md:pr-4 md:mr-2">
                          <div className="w-full overflow-hidden relative">
                            {(() => {
                              const currentMeta = parseTrackMetadata(monitoredTrack.name, monitoredTrack.id);
                              const currentTitleFull = `${currentMeta.title} - ${currentMeta.artist} - ${currentMeta.album}`;
                              const scrollDuration = Math.max(12, currentTitleFull.length * 0.35);
                              
                              return (
                                <motion.div
                                  className="inline-block whitespace-nowrap"
                                  animate={isMonitoredPlaying ? {
                                    x: ["0%", "-50%"]
                                  } : { x: "0%" }}
                                  transition={isMonitoredPlaying ? {
                                    repeat: Infinity,
                                    repeatType: "loop",
                                    duration: scrollDuration,
                                    ease: "linear"
                                  } : {
                                    duration: 0.5,
                                    ease: "easeInOut"
                                  }}
                                >
                                  <span className="text-base md:text-xl font-orbitron font-extrabold uppercase tracking-[0.05em] text-[#F27D26] pr-20 drop-shadow-[0_0_10px_rgba(242,125,38,0.6)]">
                                    {currentTitleFull}
                                  </span>
                                  {/* Duplicate for seamless loop if playing */}
                                  {isMonitoredPlaying && (
                                    <span className="text-base md:text-xl font-orbitron font-extrabold uppercase tracking-[0.05em] text-[#F27D26] pr-20 drop-shadow-[0_0_10px_rgba(242,125,38,0.6)]">
                                      {currentTitleFull}
                                    </span>
                                  )}
                                </motion.div>
                              );
                            })()}
                          </div>
                        </div>
                        
                        {/* Middle/Right Technical Specs exactly as in reference image */}
                        {(() => {
                          const currentMeta = parseTrackMetadata(monitoredTrack.name, monitoredTrack.id);
                          return (
                            <div className="flex items-center justify-between md:justify-end gap-3 md:gap-3.5 font-mono text-[9px] md:text-[10px] text-[#F27D26] border-t md:border-t-0 md:border-l border-[#F27D26]/20 md:border-[#F27D26]/30 pt-1.5 md:pt-0 pl-0 md:pl-4 flex-shrink-0">
                              {/* Column 1: KHZ / KBPS */}
                              <div className="flex flex-col text-right leading-tight font-bold tracking-wider">
                                <span className="drop-shadow-[0_0_5px_rgba(242,125,38,0.4)]">{currentMeta.khz}</span>
                                <span className="text-[#F27D26]/75 text-[8px] font-semibold">{currentMeta.kbps}</span>
                              </div>
                              
                              {/* Column Separator */}
                              <span className="text-[#F27D26]/40 text-sm font-light">|</span>
                              
                              {/* Column 2: Format / Bit */}
                              <div className="flex flex-col text-right leading-tight font-bold tracking-wider">
                                <span className="drop-shadow-[0_0_5px_rgba(242,125,38,0.4)]">{currentMeta.format}</span>
                                <span className="text-[#F27D26]/75 text-[8px] font-semibold">{currentMeta.bit}</span>
                              </div>
                              
                              {/* Column Separator */}
                              <span className="text-[#F27D26]/40 text-sm font-light">|</span>
                              
                              {/* Column 3: Large BPM */}
                              <div className="text-xs md:text-sm font-orbitron font-black tracking-tight text-[#F27D26] drop-shadow-[0_0_8px_rgba(242,125,38,0.6)] flex items-center gap-0.5 leading-none">
                                <span>{currentMeta.bpm.split(" ")[0]}</span>
                                <span className="text-[7px] font-bold text-[#F27D26]/60">BPM</span>
                              </div>

                              {/* Column Separator */}
                              <span className="text-[#F27D26]/40 text-sm font-light">|</span>

                              {/* Column 4: Glowing Timer */}
                              <div className="text-xs md:text-sm font-orbitron font-bold tracking-widest text-[#F27D26] drop-shadow-[0_0_8px_rgba(242,125,38,0.7)] leading-none min-w-[55px] text-right">
                                {formatTime(monitoredTime)}
                              </div>
                            </div>
                          );
                        })()}
                        
                      </div>
                    </div>
                    

              <div className="w-full my-auto">
              <div className="w-12/12">
                <Waveform
                  peaks={monitoredTrack?.peaks}
                  currentTime={monitoredTime}
                  duration={monitoredDuration}
                  onSeek={(time) => {
                    const audioEl = isDeckAMonitored ? audioRef.current : audioRefB.current;
                    const setTimeFn = isDeckAMonitored ? setCurrentTime : setCurrentTimeB;
                    if (audioEl) {
                      audioEl.currentTime = time;
                      setTimeFn(time);
                    }
                  }}
                />
              </div>

              </div>

                    
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-[#F27D26]/70 uppercase tracking-[0.2em] font-orbitron font-bold py-6 relative z-10">
                    <div className="text-base md:text-lg animate-pulse mb-1.5 drop-shadow-[0_0_10px_rgba(242,125,38,0.5)]">
                      === SYSTEM READY ===
                    </div>
                    <div className="text-[9px] font-mono tracking-[0.15em] text-zinc-500 font-bold">
                      INSERT CUE TO START PERFORMANCE
                    </div>
                  </div>
                )}
              </div>

              {/* Prestige Decoders Interactive Toggle Row */}
              <div className="flex items-center justify-center gap-4 py-2 border-t border-white/[0.03] z-10">
                {/* Dolby Surround Button */}
                <button
                  id="btn-dolby-decoder"
                  onClick={() => {
                    setIsDolbyActive(!isDolbyActive);
                    if (!isDolbyActive) {
                      setIsSony360Active(false);
                    }
                  }}
                  className={cn(
                    "flex items-center gap-2.5 px-3.5 py-1.5 rounded-lg border text-[10px] font-bold tracking-[0.15em] transition-all duration-300 cursor-pointer shadow-md select-none",
                    isDolbyActive 
                      ? "bg-amber-500/15 border-amber-500/40 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.25)] scale-[1.03]" 
                      : "bg-black/50 border-white/[0.04] text-zinc-500 hover:text-zinc-300 hover:border-white/10"
                  )}
                  title="Dolby Surround Sound Matrix Decoder"
                >
                  <svg className="w-5 h-3.5 fill-current" viewBox="0 0 24 24">
                    <path d="M2 4h5a8 8 0 0 1 0 16H2V4zm5 3a5 5 0 0 0 0 10H5V7h2z M22 4h-5a8 8 0 0 0 0 16h5V4zm-5 3a5 5 0 0 1 0 10h2V7h-2z"/>
                  </svg>
                  <span>DOLBY SURROUND</span>
                </button>

                {/* Sony 360 Reality Audio Button */}
                <button
                  id="btn-sony-360-decoder"
                  onClick={() => {
                    setIsSony360Active(!isSony360Active);
                    if (!isSony360Active) {
                      setIsDolbyActive(false);
                    }
                  }}
                  className={cn(
                    "flex items-center gap-2 px-3.5 py-1.5 rounded-lg border text-[10px] font-bold tracking-[0.15em] transition-all duration-300 cursor-pointer shadow-md select-none",
                    isSony360Active 
                      ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.25)] scale-[1.03]" 
                      : "bg-black/50 border-white/[0.04] text-zinc-500 hover:text-zinc-300 hover:border-white/10"
                  )}
                  title="Sony 360 Reality Audio Spatial Decoder"
                >
                  <svg className="w-4 h-4 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
                    <circle cx="12" cy="12" r="4.5" />
                    <path d="M12 2a10 10 0 0 1 10 10" />
                    <path d="M12 22a10 10 0 0 1-10-10" />
                  </svg>
                  <span>REALITY AUDIO</span>
                </button>

              

              </div>

            
           
            </div>


          </div>

          {/* Master Volume and Presets */}

          
          <div className="w-full px-8 mb-8 flex-shrink-0 flex gap-4 gain-preset-container">
            <div className="bg-black/10 p-6 rounded-xl border border-white/5 flex-1 flex flex-col justify-center">
              <div className="flex justify-between items-center mb-4">
                <span className="text-[11px] text-[#94A3B8] font-semibold tracking-widest uppercase">Channel Gain</span>
                <span className="font-mono text-[#F27D26]">{Math.round(masterVolume * 100)}%</span>
              </div>
              <div className="relative h-1 w-full bg-black rounded flex items-center mb-6">
                  <div 
                    className="h-full bg-[#F27D26]"
                    style={{ width: `${masterVolume * 100}%` }}
                  />
                  <div 
                    className="absolute w-2 h-2 bg-white shadow-[0_0_10px_#F27D26] pointer-events-none"
                    style={{ left: `calc(${masterVolume * 100}% - 2px)` }}
                  ></div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={masterVolume}
                    onChange={(e) => setMasterVolume(Number(e.target.value))}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
              </div>

              <div className="flex justify-between items-center">
                <span className="text-[11px] text-[#94A3B8] font-semibold tracking-widest uppercase flex items-center gap-2">
                  <Sparkles className="w-3 h-3" />
                  Sound Style
                </span>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => {
                      setPresetA('custom');
                      setRackDeck('A');
                      setActiveDeckTab('Rack');
                    }}
                    className="text-[10px] uppercase font-bold tracking-widest bg-[#34D399]/10 text-[#34D399] border border-[#34D399]/30 px-2 py-1 rounded hover:bg-[#34D399]/20 transition-colors"
                  >
                    Open Rack
                  </button>
                  <select
                    value={presetA}
                    onChange={(e) => setPresetA(e.target.value as PresetKey)}
                    className="bg-black/50 border border-white/10 rounded px-2 py-1 text-[11px] text-[#E2E8F0] uppercase tracking-wider font-semibold focus:outline-none focus:border-[#F27D26]"
                  >
                    {Object.entries(SOUND_PRESETS).map(([k, v]) => (
                      <option key={k} value={k}>{v.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="w-20 bg-black/25 px-2 py-3 rounded-xl border border-white/5 flex flex-col items-center h-36">
          {/*    <span className="text-[9px] text-[#94A3B8] font-mono font-bold tracking-widest uppercase mb-1.5 select-none">Peak</span> */}
              <div className="flex-1 w-full min-h-0">
                <PeakMeter 
                  analyserLeft={analyserLeftRef.current} 
                  analyserRight={analyserRightRef.current} 
                  isClipping={clipA} 
                  className="w-full h-full p-0.5 gap-2 border-none bg-transparent"
                />
              </div>
            </div>
          </div>

          {/* Transport Controls */}
          <div className="mt-auto flex justify-center items-center gap-6 p-6 bg-black/30 border-t border-white/5 flex-shrink-0 relative transport-controls-container">
              <button
                onClick={() => setRepeatModeA(prev => prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off')}
                className={cn(
                  "absolute left-6 w-10 h-10 rounded-full flex items-center justify-center transition-colors border",
                  repeatModeA !== 'off' ? "text-[#F27D26] border-[#F27D26]/30 bg-[#F27D26]/10" : "text-[#94A3B8] border-transparent hover:bg-white/5"
                )}
                title={repeatModeA === 'off' ? "Repeat: Off" : repeatModeA === 'all' ? "Repeat: Playlist" : "Repeat: Track"}
              >
                {repeatModeA === 'one' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
              </button>

              <button 
                onClick={prevTrack}
                disabled={tracks.length === 0}
                className="w-16 h-16 rounded-full border-2 border-[#94A3B8] text-[#94A3B8] flex items-center justify-center hover:bg-white/5 transition-all disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <SkipBack className="w-6 h-6 fill-current" />
              </button>
              
              <button 
                onClick={stopPlayback}
                disabled={!currentTrack}
                className="w-16 h-16 rounded-full border-2 border-[#94A3B8] text-[#94A3B8] flex items-center justify-center hover:text-red-400 hover:border-red-400 hover:bg-red-400/10 transition-all disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <Square className="w-5 h-5 fill-current" />
              </button>
              
              <button 
                onClick={togglePlayPause}
                disabled={!currentTrack}
                className="w-20 h-20 rounded-full border-2 border-[#F27D26] text-[#F27D26] flex items-center justify-center transition-all hover:bg-[#F27D26]/10 shadow-[0_0_15px_rgba(242,125,38,0.2)] disabled:opacity-30 disabled:hover:bg-transparent disabled:shadow-none"
              >
                {isPlaying ? (
                  <Pause className="w-8 h-8 fill-current" />
                ) : (
                  <Play className="w-8 h-8 fill-current ml-1" />
                )}
              </button>
              
              <button 
                onClick={nextTrack}
                disabled={tracks.length === 0}
                className="w-16 h-16 rounded-full border-2 border-[#94A3B8] text-[#94A3B8] flex items-center justify-center hover:bg-white/5 transition-all disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <SkipForward className="w-6 h-6 fill-current" />
              </button>

              <button
                onClick={() => setIsShuffleA(prev => !prev)}
                className={cn(
                  "absolute right-6 w-10 h-10 rounded-full flex items-center justify-center transition-colors border",
                  isShuffleA ? "text-[#F27D26] border-[#F27D26]/30 bg-[#F27D26]/10" : "text-[#94A3B8] border-transparent hover:bg-white/5"
                )}
                title={isShuffleA ? "Shuffle: On" : "Shuffle: Off"}
              >
                <Shuffle className="w-4 h-4" />
              </button>
          </div>
          
        </section>

        {/* Right Column: Playlist */}
        <section className={cn(
          "w-full lg:w-1/2 bg-[#1E2024] border border-white/5 rounded-lg flex-col overflow-hidden relative  uppercase",
          mobileActiveView !== 'playlist' ? "hidden lg:flex" : "flex"
        )}>
          
          <div className="px-4 py-3 bg-black/20 border-b border-white/5 flex items-center justify-between text-xs uppercase tracking-widest text-[#94A3B8] font-semibold flex-shrink-0">
            <div className="flex items-center gap-4">
              <button onClick={() => setActiveDeckTab('A')} className={cn("transition-colors", activeDeckTab === 'A' ? "text-[#F27D26]" : "hover:text-[#E2E8F0]")}>Deck A (Cues)</button>
              <div className="w-[1px] h-3 bg-white/10"></div>
              <button onClick={() => setActiveDeckTab('B')} className={cn("transition-colors", activeDeckTab === 'B' ? "text-[#F27D26]" : "hover:text-[#E2E8F0]")}>Deck B (BGM)</button>
              <div className="w-[1px] h-3 bg-white/10"></div>
              <button onClick={() => setActiveDeckTab('Rack')} className={cn("transition-colors flex items-center gap-1", activeDeckTab === 'Rack' ? "text-[#34D399]" : "hover:text-[#E2E8F0]")}>
                <Activity className="w-3 h-3" /> DSP Rack
              </button>
            </div>
            <div className="flex items-center gap-4">
              {activeDeckTab === 'A' && (
                <>
                  <select 
                    value={currentPlaylistId || ''} 
                    onChange={(e) => loadPlaylist(e.target.value)}
                    className="bg-transparent text-[#E2E8F0] font-semibold outline-none cursor-pointer hover:text-white max-w-[120px] truncate"
                  >
                    <option value="">-- UNSAVED --</option>
                    {savedPlaylists.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  {currentPlaylistId && (
                    <button onClick={handleDeletePlaylist} className="hover:text-red-400 p-1" title="Delete Playlist">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  <button onClick={openSaveModal} className="flex items-center gap-1.5 text-[#94A3B8] hover:text-[#E2E8F0] transition-colors" title="Save Playlist">
                    <Save className="w-4 h-4" />
                  </button>
                </>
              )}
              {activeDeckTab !== 'Rack' && (
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => {
                      setShowUrlInput(!showUrlInput);
                      setUrlError(null);
                    }} 
                    className={cn(
                      "flex items-center gap-1.5 cursor-pointer text-[#94A3B8] hover:text-[#E2E8F0] transition-colors",
                      showUrlInput && "text-[#F27D26] hover:text-[#F27D26]"
                    )}
                    title="Add from URL (YouTube/Direct)"
                  >
                    <Link2 className="w-4 h-4" />
                  </button>
                  <label className="flex items-center gap-1.5 cursor-pointer text-[#94A3B8] hover:text-[#E2E8F0] transition-colors" title="Upload Local File">
                    <Upload className="w-4 h-4" />
                    <input type="file" accept="audio/*" multiple onChange={activeDeckTab === 'A' ? handleFileUpload : handleFileUploadB} className="hidden" />
                  </label>
                </div>
              )}
            </div>
          </div>

          {/* URL Input Box */}
          {showUrlInput && activeDeckTab !== 'Rack' && (
            <div className="px-4 py-2.5 bg-black/40 border-b border-white/5 flex flex-col gap-1.5 flex-shrink-0">
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  placeholder={activeDeckTab === 'A' ? "Paste YouTube or direct audio URL for Deck A..." : "Paste YouTube or direct audio URL for Deck B..."}
                  value={inputUrl}
                  onChange={(e) => {
                    setInputUrl(e.target.value);
                    if (urlError) setUrlError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddUrl();
                  }}
                  className="flex-1 bg-black/60 border border-white/10 rounded px-3 py-1.5 text-xs text-[#E2E8F0] placeholder-[#94A3B8]/50 focus:outline-none focus:border-[#F27D26]"
                  disabled={isExtractingUrl}
                />
                <button
                  onClick={handleAddUrl}
                  disabled={isExtractingUrl || !inputUrl.trim()}
                  className="px-3.5 py-1.5 bg-[#F27D26] hover:bg-[#F27D26]/90 disabled:bg-zinc-700 disabled:text-zinc-500 text-black font-mono font-bold text-[10px] uppercase rounded flex items-center gap-1.5 transition-all active:scale-95 flex-shrink-0 cursor-pointer"
                >
                  {isExtractingUrl ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>Load</span>
                </button>
              </div>
              {urlError && (
                <div className="text-[10px] text-red-400 font-mono mt-0.5 pl-1 flex items-center gap-1">
                  <span>●</span> {urlError}
                </div>
              )}

              {/* YT-DLP Engine Status & Update Button */}
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5 text-[10px] sm:text-xs">
                <div className="flex items-center gap-1.5 text-[#94A3B8]">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                  <span>YT-DLP Engine:</span>
                  <span className="font-mono bg-black/40 px-1.5 py-0.5 rounded text-white border border-white/5 select-all">
                    {ytdlpVersion}
                  </span>
                </div>
                <button
                  onClick={handleUpdateYtdlp}
                  disabled={isUpdatingYtdlp}
                  className="flex items-center gap-1 bg-[#F27D26]/10 hover:bg-[#F27D26]/20 border border-[#F27D26]/30 px-2.5 py-1 rounded text-[10px] text-[#F27D26] font-mono transition-all disabled:opacity-50 active:scale-95 cursor-pointer"
                >
                  {isUpdatingYtdlp ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  <span>{isUpdatingYtdlp ? 'Updating...' : 'Update Engine'}</span>
                </button>
              </div>
              {ytdlpUpdateMsg && (
                <div className="text-[10px] text-amber-400/90 font-mono mt-1 pl-1 bg-amber-500/5 border border-amber-500/10 rounded px-2 py-1 flex items-center gap-1.5">
                  <span className="animate-pulse">ℹ</span> {ytdlpUpdateMsg}
                </div>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {activeDeckTab === 'Rack' ? (
              <RackProcessor
                deckName={rackDeck}
                settings={rackDeck === 'A' ? customRackA : customRackB}
                onChange={rackDeck === 'A' ? setCustomRackA : setCustomRackB}
                onClose={() => setActiveDeckTab(rackDeck)}
                onSwitchDeck={(deck) => setRackDeck(deck)}
                analyser={rackDeck === 'A' ? analyserRef.current : analyserRefB.current}
                onReset={() => {
                  if (rackDeck === 'A') {
                    setCustomRackA(DEFAULT_RACK);
                  } else {
                    setCustomRackB(DEFAULT_RACK);
                  }
                }}
              />
            ) : activeDeckTab === 'A' ? (
              tracks.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-[#94A3B8] space-y-4">
                  <Upload className="w-12 h-12 text-[#94A3B8]/30" />
                  <p className="font-medium">No cues loaded in Deck A</p>
                </div>
              ) : (
                tracks.map((track, index) => {
                  const isActive = index === currentIndex;
                  return (
                    <div 
                      key={track.id}
                      className={cn(
                        "group flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4 px-4 py-3 border-b border-white/[0.03] transition-colors duration-200",
                        isActive 
                          ? "bg-[#F27D26]/10 border-l-[3px] border-l-[#F27D26]" 
                          : "border-l-[3px] border-l-transparent hover:bg-white/[0.02]"
                      )}
                    >
                      {/* Top main row for track info & play action */}
                      <div className="flex-1 flex items-center min-w-0 gap-2 w-full">
                        {/* Move arrows */}
                        <div className="flex flex-col gap-1 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-[#94A3B8] flex-shrink-0">
                          <button onClick={() => moveTrack(index, 'up')} disabled={index === 0} className="hover:text-[#E2E8F0] disabled:opacity-30">
                            <ChevronUp className="w-3 h-3" />
                          </button>
                          <button onClick={() => moveTrack(index, 'down')} disabled={index === tracks.length - 1} className="hover:text-[#E2E8F0] disabled:opacity-30">
                            <ChevronDown className="w-3 h-3" />
                          </button>
                        </div>

                        {/* Index */}
                        <div className="w-6 font-mono text-xs text-[#94A3B8] flex-shrink-0">
                          {String(index + 1).padStart(2, '0')}
                        </div>
                        
                        {/* Title, duration, AI badges */}
                        <div 
                          className="flex-1 min-w-0 cursor-pointer"
                          onClick={() => playTrack(index)}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className={cn(
                              "font-medium text-sm truncate max-w-[150px] sm:max-w-xs md:max-w-md lg:max-w-[200px] xl:max-w-sm",
                              isActive ? "text-[#E2E8F0]" : "text-[#E2E8F0]"
                            )}>
                              {track.name}
                            </h4>
                            
                            {track.duration !== undefined && (
                              <span className="text-[10px] font-mono font-bold text-[#F27D26]/70 bg-[#F27D26]/5 border border-[#F27D26]/10 px-1.5 py-0.5 rounded flex-shrink-0">
                                {formatTime(track.duration)}
                              </span>
                            )}
                            
                            {analyzingIds.has(track.id) ? (
                              <div className="flex items-center gap-1 text-[10px] text-[#94A3B8] font-mono tracking-widest uppercase bg-black/30 px-1.5 py-0.5 rounded flex-shrink-0">
                                <Loader2 className="w-3 h-3 animate-spin text-[#F27D26]" /> AI
                              </div>
                            ) : track.analysis?.analyzed ? (
                              <div className="flex items-center gap-1 text-[10px] text-[#34D399] font-mono tracking-widest uppercase bg-[#065F46]/30 border border-[#065F46]/50 px-1.5 py-0.5 rounded flex-shrink-0" title="AI Normalized">
                                <Sparkles className="w-3 h-3" /> AI
                              </div>
                            ) : null}

                            {isActive && isPlaying && (
                              <div className="flex gap-[2px] items-end h-2.5 ml-2 flex-shrink-0">
                                <div className="w-[2px] bg-[#F27D26] h-1.5 animate-[bounce_1s_infinite]"></div>
                                <div className="w-[2px] bg-[#F27D26] h-2.5 animate-[bounce_0.8s_infinite]"></div>
                                <div className="w-[2px] bg-[#F27D26] h-2 animate-[bounce_1.2s_infinite]"></div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Controls row/group: Volume slider, Agenda times, Actions */}
                      <div className="flex flex-wrap items-center gap-3 md:gap-4 ml-8 lg:ml-0 flex-shrink-0 w-full lg:w-auto lg:justify-end">
                        {/* Volume Slider */}
                        <div className="flex items-center gap-2 w-24 sm:w-28 transition-all">
                          <span className="text-[9px] uppercase font-bold text-[#94A3B8] select-none">Vol</span>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={track.volume}
                            onChange={(e) => updateTrackVolume(track.id, Number(e.target.value))}
                            className="w-full h-1 bg-black rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:bg-[#F27D26] [&::-webkit-slider-thumb]:rounded-full"
                          />
                        </div>

                        {/* Agenda Times */}
                        <div className="flex items-center gap-1">
                          <input 
                            type="time" 
                            value={track.agendaTime || ''}
                            onChange={(e) => updateTrackAgendaTime(track.id, e.target.value)}
                            className="bg-black/30 border border-white/5 rounded px-1.5 py-0.5 text-[10px] sm:text-[11px] text-[#94A3B8] font-mono outline-none focus:border-[#F27D26] w-[70px] sm:w-[80px]"
                            title="Start Time"
                          />
                          <span className="text-[#94A3B8] text-[10px] select-none">-</span>
                          <input 
                            type="time" 
                            value={track.agendaEndTime || ''}
                            onChange={(e) => updateTrackAgendaEndTime(track.id, e.target.value)}
                            className="bg-black/30 border border-white/5 rounded px-1.5 py-0.5 text-[10px] sm:text-[11px] text-[#94A3B8] font-mono outline-none focus:border-[#F27D26] w-[70px] sm:w-[80px]"
                            title="End Time"
                          />
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-1 justify-end ml-auto lg:ml-0">
                          <button
                            onClick={() => handleGenerateChords(track)}
                            className={cn(
                              "p-1.5 rounded transition-colors",
                              track.aiLyricsChords ? "text-[#F27D26] bg-[#F27D26]/10" : "text-[#94A3B8] hover:text-[#F27D26] hover:bg-[#F27D26]/10"
                            )}
                            title="AI Lyrics & Chords"
                          >
                            {isGeneratingChords && activeChordsTrack?.id === track.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Guitar className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            onClick={() => exportTrack(track)}
                            className="p-1.5 text-[#94A3B8] hover:text-[#F27D26] hover:bg-[#F27D26]/10 rounded transition-colors"
                            title="Export Song"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => removeTrack(track.id, index)}
                            className="p-1.5 text-[#94A3B8] hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                            title="Remove cue"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                    </div>
                  );
                })
              )
            ) : (
              tracksB.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-[#94A3B8] space-y-4">
                  <Upload className="w-12 h-12 text-[#94A3B8]/30" />
                  <p className="font-medium">No background music loaded in Deck B</p>
                </div>
              ) : (
                tracksB.map((track, index) => {
                  const isActive = index === currentIndexB;
                  return (
                    <div 
                      key={track.id}
                      className={cn(
                        "group flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 border-b border-white/[0.03] transition-colors duration-200",
                        isActive 
                          ? "bg-[#F27D26]/10 border-l-[3px] border-l-[#F27D26]" 
                          : "border-l-[3px] border-l-transparent hover:bg-white/[0.02]"
                      )}
                    >
                      <div className="flex-1 flex items-center min-w-0 gap-2">
                        <div className="w-6 font-mono text-xs text-[#94A3B8] flex-shrink-0">
                          {String(index + 1).padStart(2, '0')}
                        </div>
                        
                        <div 
                          className="flex-1 min-w-0 cursor-pointer"
                          onClick={() => playTrackB(index)}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className={cn(
                              "font-medium text-sm truncate max-w-[180px] sm:max-w-xs md:max-w-md lg:max-w-[220px] xl:max-w-sm",
                              isActive ? "text-[#E2E8F0]" : "text-[#E2E8F0]"
                            )}>
                              {track.name}
                            </h4>

                            {track.duration !== undefined && (
                              <span className="text-[10px] font-mono font-bold text-[#F27D26]/70 bg-[#F27D26]/5 border border-[#F27D26]/10 px-1.5 py-0.5 rounded flex-shrink-0">
                                {formatTime(track.duration)}
                              </span>
                            )}

                            {isActive && isPlayingB && (
                              <div className="flex gap-[2px] items-end h-2.5 ml-2 flex-shrink-0">
                                <div className="w-[2px] bg-[#F27D26] h-1.5 animate-[bounce_1s_infinite]"></div>
                                <div className="w-[2px] bg-[#F27D26] h-2.5 animate-[bounce_0.8s_infinite]"></div>
                                <div className="w-[2px] bg-[#F27D26] h-2 animate-[bounce_1.2s_infinite]"></div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 justify-end ml-8 sm:ml-0 flex-shrink-0">
                        <button
                          onClick={() => handleGenerateChords(track)}
                          className={cn(
                            "p-1.5 rounded transition-colors",
                            track.aiLyricsChords ? "text-[#F27D26] bg-[#F27D26]/10" : "text-[#94A3B8] hover:text-[#F27D26] hover:bg-[#F27D26]/10"
                          )}
                          title="AI Lyrics & Chords"
                        >
                          {isGeneratingChords && activeChordsTrack?.id === track.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Guitar className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          onClick={() => exportTrack(track)}
                          className="p-1.5 text-[#94A3B8] hover:text-[#F27D26] hover:bg-[#F27D26]/10 rounded transition-colors"
                          title="Export Song"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => removeTrackB(track.id, index)}
                          className="p-1.5 text-[#94A3B8] hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                          title="Remove BGM"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )
            )}
          </div>

          <div className="border-t border-white/5 bg-black/30 p-4 flex flex-col gap-3 flex-shrink-0 z-10">
            <div className="flex items-center justify-between text-xs uppercase tracking-widest text-[#94A3B8] font-semibold">
              <span className="flex items-center gap-2">
                Deck B <span className="opacity-50">|</span> BGM
              </span>
              <div className="flex items-center gap-4">
                {isPlaying && isPlayingB && (
                  <span className="text-red-400 text-[10px] animate-pulse bg-red-400/10 px-1.5 py-0.5 rounded">AUTO-MUTED</span>
                )}
                <div className="flex items-center gap-2" title="Crossfade Duration">
                  <span className="text-[10px]">Crossfade:</span>
                  <input 
                    type="number" 
                    min="0" max="10" step="0.1" 
                    value={duckingDuration} 
                    onChange={(e) => setDuckingDuration(Number(e.target.value))} 
                    className="w-12 bg-black/50 border border-white/10 rounded px-1 text-center font-mono focus:outline-none focus:border-[#F27D26]"
                  />
                  <span className="text-[10px]">s</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <button
                onClick={() => setRepeatModeB(prev => prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off')}
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center transition-colors border",
                  repeatModeB !== 'off' ? "text-[#F27D26] border-[#F27D26]/30 bg-[#F27D26]/10" : "text-[#94A3B8] border-transparent hover:bg-white/5"
                )}
                title={repeatModeB === 'off' ? "Repeat: Off" : repeatModeB === 'all' ? "Repeat: Playlist" : "Repeat: Track"}
              >
                {repeatModeB === 'one' ? <Repeat1 className="w-3 h-3" /> : <Repeat className="w-3 h-3" />}
              </button>

              <button 
                onClick={() => isPlayingB ? stopPlaybackB() : playTrackB(currentIndexB >= 0 ? currentIndexB : 0)} 
                disabled={tracksB.length === 0} 
                className="w-10 h-10 rounded-full bg-[#1E2024] border border-white/10 flex items-center justify-center text-[#E2E8F0] hover:bg-white/5 transition-all disabled:opacity-30 disabled:hover:bg-[#1E2024]"
              >
                {isPlayingB ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
              </button>
              
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[#E2E8F0] truncate">
                  {currentTrackB?.name || 'No BGM Selected'}
                </div>
                <div className="text-[10px] font-mono text-[#94A3B8] flex items-center gap-3 mt-1">
                  <span>{formatTime(currentTimeB)} / {formatTime(durationB)}</span>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => {
                        setPresetB('custom');
                        setRackDeck('B');
                        setActiveDeckTab('Rack');
                      }}
                      className="text-[8px] uppercase font-bold tracking-widest bg-[#34D399]/10 text-[#34D399] border border-[#34D399]/30 px-1.5 py-0.5 rounded hover:bg-[#34D399]/20 transition-colors"
                    >
                      Rack
                    </button>
                    <Sparkles className="w-2.5 h-2.5 ml-1 text-[#94A3B8]" />
                    <select
                      value={presetB}
                      onChange={(e) => setPresetB(e.target.value as PresetKey)}
                      className="bg-transparent text-[9px] uppercase font-bold text-[#E2E8F0] focus:outline-none cursor-pointer"
                    >
                      {Object.entries(SOUND_PRESETS).map(([k, v]) => (
                        <option key={k} value={k} className="bg-[#1E2024]">{v.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="w-24 flex items-center gap-2">
                <Volume2 className="w-3 h-3 text-[#94A3B8]" />
                <input 
                  type="range" 
                  min="0" max="1" step="0.01" 
                  value={masterVolumeB} 
                  onChange={(e) => setMasterVolumeB(Number(e.target.value))} 
                  className="w-full h-1 bg-black rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:bg-[#F27D26] [&::-webkit-slider-thumb]:rounded-full"
                />
              </div>

              <div className="h-12 w-16 flex flex-col items-center ml-2 border border-white/5 bg-black/50 p-0.5 rounded-sm">
                <PeakMeter 
                  analyserLeft={analyserLeftRefB.current} 
                  analyserRight={analyserRightRefB.current} 
                  isClipping={clipB} 
                  className="w-full h-full p-0.5 gap-1.5 border-none bg-transparent"
                />
              </div>
            </div>
            
            <audio 
              ref={audioRefB} 
              src={currentTrackB?.url} 
              onPlay={() => setIsPlayingB(true)} 
              onPause={() => setIsPlayingB(false)} 
              onTimeUpdate={() => { if(audioRefB.current) setCurrentTimeB(audioRefB.current.currentTime) }} 
              onLoadedMetadata={() => { 
                if (audioRefB.current) {
                  setDurationB(audioRefB.current.duration);
                  if (initialSeekTimeBRef.current !== null) {
                    audioRefB.current.currentTime = initialSeekTimeBRef.current;
                    initialSeekTimeBRef.current = null;
                  }
                }
              }} 
              onEnded={() => { 
                if (repeatModeB === 'one') {
                  if (audioRefB.current) {
                    audioRefB.current.currentTime = 0;
                    audioRefB.current.play().catch(console.error);
                  }
                } else if (currentIndexB < tracksB.length - 1) {
                  playTrackB(currentIndexB + 1);
                } else if (repeatModeB === 'all' && tracksB.length > 0) {
                  playTrackB(0);
                } else {
                  stopPlaybackB();
                }
              }} 
              onError={(e) => {
                const errorCode = audioRefB.current?.error?.code;
                const isRemote = currentTrackB?.isRemote;
                let msg = "Terjadi kesalahan saat memutar audio.";
                if (errorCode === 4) { // MEDIA_ERR_SRC_NOT_SUPPORTED
                  if (!isRemote) {
                    msg = "Akses file lokal kedaluwarsa karena keamanan browser. Silakan re-import/drag file ini lagi untuk memutar.";
                  } else {
                    msg = "File audio streaming tidak ditemukan atau dibatasi oleh provider (Coba URL lain atau unduh/unggah file lokal).";
                  }
                } else if (errorCode === 3) {
                  msg = "Kesalahan decoding audio. Format file ini mungkin tidak didukung.";
                }
                console.error("Audio deck B playback error code:", errorCode, msg);
                setAudioPlaybackError(msg);
              }}
            />
          </div>
        </section>

      </main>
    </div>
  );
}
