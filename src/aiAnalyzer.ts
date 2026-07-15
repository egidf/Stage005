import { AudioAnalysis } from './types';

export const analyzeAudio = async (source: File | Blob | string): Promise<{ analysis: AudioAnalysis, peaks: number[] }> => {
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  
  let arrayBuffer: ArrayBuffer;
  if (typeof source === 'string') {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio file from ${source}: ${response.statusText}`);
    }
    arrayBuffer = await response.arrayBuffer();
  } else {
    arrayBuffer = await source.arrayBuffer();
  }
  
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  
  // Calculate Waveform Peaks
  const peaks: number[] = [];
  const channelData = audioBuffer.getChannelData(0);
  const numPeaks = 200;
  const sampleSize = Math.floor(channelData.length / numPeaks);
  
  for (let i = 0; i < numPeaks; i++) {
    let min = 1.0;
    let max = -1.0;
    const start = i * sampleSize;
    for (let j = 0; j < sampleSize; j++) {
      const val = channelData[start + j];
      if (val < min) min = val;
      if (val > max) max = val;
    }
    peaks.push(Math.max(Math.abs(min), Math.abs(max)));
  }

  // Analyze Loudness (RMS), Stereo Width, and Frequency Balance (ZCR)
  let rmsSum = 0;
  let midSum = 0;
  let sideSum = 0;
  let zcr = 0;
  
  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;
  
  const step = 100; // Sample every 100th frame for performance
  const samples = Math.floor(left.length / step);
  
  for (let i = 1; i < left.length; i += step) {
    const l = left[i];
    const r = right[i];
    rmsSum += (l * l + r * r) / 2;
    
    const mid = (l + r) / 2;
    const side = (l - r) / 2;
    midSum += Math.abs(mid);
    sideSum += Math.abs(side);

    // Zero crossing for frequency proxy
    if ((l >= 0 && left[i-step] < 0) || (l < 0 && left[i-step] >= 0)) {
      zcr++;
    }
  }
  
  // Gain normalization
  const rms = Math.sqrt(rmsSum / samples);
  const targetRms = 0.15; // Target loudness
  let gainAdjustment = targetRms / (rms || 0.01);
  gainAdjustment = Math.max(0.1, Math.min(gainAdjustment, 4.0));

  // Stereo normalization
  const stereoRatio = sideSum / (midSum || 1);
  const targetStereo = 0.25;
  let stereoWidth = targetStereo / (stereoRatio || 0.1);
  stereoWidth = Math.max(0.5, Math.min(stereoWidth, 2.0));

  // EQ normalization based on ZCR proxy
  const zcrRate = zcr / samples;
  // If zcr is high, it's treble heavy -> boost bass, cut treble
  // If zcr is low, it's bass heavy -> cut bass, boost treble
  const baseZcr = 0.1;
  const diff = zcrRate - baseZcr;
  
  const bassEQ = Math.max(-5, Math.min(5, diff * 20)); // dB
  const trebleEQ = Math.max(-5, Math.min(5, -diff * 20)); // dB
  const midEQ = 0; // Keep mid flat for vocals

  return {
    analysis: {
      gainAdjustment,
      bassEQ,
      midEQ,
      trebleEQ,
      stereoWidth,
      analyzed: true
    },
    peaks
  };
};
