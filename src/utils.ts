export function formatTime(timeInSeconds: number | undefined): string {
  if (timeInSeconds === undefined || isNaN(timeInSeconds)) return "00:00";
  const m = Math.floor(timeInSeconds / 60).toString().padStart(2, '0');
  const s = Math.floor(timeInSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}

export interface ParsedTrackMetadata {
  title: string;
  artist: string;
  album: string;
  khz: string;
  kbps: string;
  format: string;
  bit: string;
  bpm: string;
}

export function parseTrackMetadata(trackName: string, trackId?: string): ParsedTrackMetadata {
  // Clean file extensions if present
  const cleanName = trackName.replace(/\.[^/.]+$/, "");
  
  // Try to split by common separators like ' - ' or ' — ' or ' | '
  const parts = cleanName.split(/\s*[-—|]\s*/);
  
  let title = parts[0] || "UNKNOWN TITLE";
  let artist = parts[1] || "UNKNOWN ARTIST";
  let album = parts[2] || "LIVE DESK";
  
  if (parts.length === 1) {
    title = parts[0];
    artist = "STAGECUE ARTIST";
    album = "LIVE STUDIO";
  } else if (parts.length === 2) {
    title = parts[0];
    artist = parts[1];
    album = "LIVE PERFORMANCE";
  }
  
  // Generate deterministic values based on track name + id
  const seedString = `${trackName}-${trackId || ''}`;
  let hash = 0;
  for (let i = 0; i < seedString.length; i++) {
    hash = seedString.charCodeAt(i) + ((hash << 5) - hash);
  }
  hash = Math.abs(hash);
  
  const khzList = ["44.1", "48.0", "96.0", "192.0"];
  const kbpsList = ["320", "256", "1411", "960"];
  const formatList = ["MP3", "WAV", "FLAC", "M4A"];
  const bitList = ["16", "24", "32"];
  const bpmValue = 90 + (hash % 51); // Deterministic BPM between 90 and 140
  
  const khz = `${khzList[hash % khzList.length]} KHZ`;
  const kbps = `${kbpsList[(hash >> 2) % kbpsList.length]} KBPS`;
  const format = formatList[(hash >> 4) % formatList.length];
  const bit = `${bitList[(hash >> 6) % bitList.length]} BIT`;
  const bpm = `${bpmValue} BPM`;
  
  return {
    title: title.toUpperCase().trim(),
    artist: artist.toUpperCase().trim(),
    album: album.toUpperCase().trim(),
    khz,
    kbps,
    format,
    bit,
    bpm
  };
}

