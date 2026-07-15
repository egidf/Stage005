import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { exec, execFile } from "child_process";
import fs from "fs";
import ytdl from "@distube/ytdl-core";
import https from "https";
import http from "http";
import crypto from "crypto";
import os from "os";

dotenv.config();

const downloadsDir = path.join(process.cwd(), "downloads");
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

let resolvedYtdlpPath = path.join(process.cwd(), "yt-dlp");
let usePythonInterpreter = false;
let pythonCommand = "python3";

async function testYtdlp(binPath: string): Promise<{ success: boolean; usePython?: boolean; pythonCmd?: string }> {
  return new Promise((resolve) => {
    try {
      // Set execute permissions
      try {
        fs.chmodSync(binPath, "755");
      } catch (e) {}

      // On macOS, try to strip quarantine flag if possible
      if (os.platform() === "darwin") {
        try {
          exec(`xattr -d com.apple.quarantine "${binPath}"`, () => {});
        } catch (e) {}
      }

      // Test native execution first
      execFile(binPath, ["--version"], (err) => {
        if (!err) {
          return resolve({ success: true, usePython: false });
        }

        console.warn(`Native test failed for ${binPath}: ${err.message}. Trying python fallback...`);

        // Test python3
        execFile("python3", [binPath, "--version"], (py3Err) => {
          if (!py3Err) {
            return resolve({ success: true, usePython: true, pythonCmd: "python3" });
          }

          // Test python
          execFile("python", [binPath, "--version"], (pyErr) => {
            if (!pyErr) {
              return resolve({ success: true, usePython: true, pythonCmd: "python" });
            }
            resolve({ success: false });
          });
        });
      });
    } catch (err) {
      resolve({ success: false });
    }
  });
}

// Helper to ensure yt-dlp binary exists on startup and is executable
async function ensureYtdlp(forceDownload = false) {
  const platform = os.platform();
  const isWin = platform === "win32";
  const baseBinName = isWin ? "yt-dlp.exe" : "yt-dlp";

  const localPath = path.join(process.cwd(), baseBinName);
  const tempPath = path.join(os.tmpdir(), baseBinName);

  console.log(`Verifying yt-dlp path options for platform: ${platform} (forceDownload: ${forceDownload})...`);

  if (!forceDownload) {
    // 1. Try local path first if it exists
    if (fs.existsSync(localPath)) {
      const res = await testYtdlp(localPath);
      if (res.success) {
        resolvedYtdlpPath = localPath;
        usePythonInterpreter = !!res.usePython;
        pythonCommand = res.pythonCmd || "python3";
        console.log(`Using working local yt-dlp: ${resolvedYtdlpPath} (usePython: ${usePythonInterpreter})`);
        return;
      }
    }

    // 2. Try copying to temp directory (/tmp or local temp) to resolve partition/execution restrictions
    if (fs.existsSync(localPath)) {
      try {
        console.log(`Copying local yt-dlp to temp directory (${tempPath}) to resolve execution/permission restrictions...`);
        fs.copyFileSync(localPath, tempPath);
        const res = await testYtdlp(tempPath);
        if (res.success) {
          resolvedYtdlpPath = tempPath;
          usePythonInterpreter = !!res.usePython;
          pythonCommand = res.pythonCmd || "python3";
          console.log(`Using temp-executable yt-dlp: ${resolvedYtdlpPath} (usePython: ${usePythonInterpreter})`);
          return;
        }
      } catch (copyErr: any) {
        console.warn("Failed to copy/run from temp directory:", copyErr.message);
      }
    }
  }

  // 3. Download the correct platform-specific binary
  let downloadUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
  if (platform === "win32") {
    downloadUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
  } else if (platform === "darwin") {
    downloadUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";
  }

  console.log(`Downloading platform-specific yt-dlp from: ${downloadUrl} to ${tempPath}`);

  const runDownload = (url: string, dest: string): Promise<boolean> => {
    return new Promise((resolve) => {
      exec(`curl -L "${url}" -o "${dest}" && chmod +x "${dest}"`, async (err, stdout, stderr) => {
        if (err) {
          console.error(`Failed download from ${url}:`, err, stderr);
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  };

  let downloadOk = await runDownload(downloadUrl, tempPath);
  if (downloadOk) {
    const res = await testYtdlp(tempPath);
    if (res.success) {
      resolvedYtdlpPath = tempPath;
      usePythonInterpreter = !!res.usePython;
      pythonCommand = res.pythonCmd || "python3";
      console.log(`Downloaded platform-specific yt-dlp successfully to ${resolvedYtdlpPath}`);
      return;
    }
  }

  // 4. Download local fallback
  console.log(`Retrying platform download to local path: ${localPath}`);
  downloadOk = await runDownload(downloadUrl, localPath);
  if (downloadOk) {
    const res = await testYtdlp(localPath);
    if (res.success) {
      resolvedYtdlpPath = localPath;
      usePythonInterpreter = !!res.usePython;
      pythonCommand = res.pythonCmd || "python3";
      console.log(`Downloaded platform-specific yt-dlp successfully to local path ${resolvedYtdlpPath}`);
      return;
    }
  }

  // 5. Download the platform-independent Python zipapp as ultimate backup
  const zipappUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
  console.log(`Downloading platform-independent Python zipapp fallback from: ${zipappUrl} to ${tempPath}`);
  downloadOk = await runDownload(zipappUrl, tempPath);
  if (downloadOk) {
    const res = await testYtdlp(tempPath);
    if (res.success) {
      resolvedYtdlpPath = tempPath;
      usePythonInterpreter = !!res.usePython;
      pythonCommand = res.pythonCmd || "python3";
      console.log(`Python zipapp fallback downloaded and verified successfully at ${resolvedYtdlpPath}`);
      return;
    }
  }

  console.error("All yt-dlp initialization attempts failed. Setting path to localPath fallback.");
  resolvedYtdlpPath = localPath;
}

function getYtdlpVersion(): Promise<string> {
  return new Promise((resolve) => {
    const callback = (err: any, stdout: string) => {
      if (err) {
        resolve("Unknown (Failed to run)");
      } else {
        resolve(stdout.trim());
      }
    };
    if (usePythonInterpreter) {
      execFile(pythonCommand, [resolvedYtdlpPath, "--version"], callback);
    } else {
      execFile(resolvedYtdlpPath, ["--version"], callback);
    }
  });
}

// Helper to download audio via yt-dlp
function downloadAudioViaYtdlp(videoUrl: string): Promise<{ title: string; duration: number; filename: string }> {
  return new Promise((resolve, reject) => {
    const ytdlpPath = resolvedYtdlpPath;
    
    // We prioritize format 251 (Opus) and extract to high-fidelity wav as requested by the user
    const args = [
      "-f", "251/bestaudio",
      "-x",
      "--audio-format", "wav",
      "--ffmpeg-location", "/usr/bin/ffmpeg",
      "-o", path.join(downloadsDir, "%(title)s.%(ext)s"),
      "--print", "after_move:%(title)s ||| %(duration)s ||| %(id)s ||| %(filepath)s",
      "--no-playlist",
      videoUrl
    ];

    if (process.env.YOUTUBE_COOKIE) {
      args.push("--add-header", `Cookie: ${process.env.YOUTUBE_COOKIE}`);
    }

    console.log("Running yt-dlp with args:", args, "usePythonInterpreter:", usePythonInterpreter);

    const callback = (error: any, stdout: string, stderr: string) => {
      if (error) {
        console.error("yt-dlp execution error:", error, stderr);
        return reject(error);
      }
      try {
        const lines = stdout.trim().split("\n");
        const matchingLine = lines.find(line => line.includes(" ||| "));
        if (!matchingLine) {
          return reject(new Error("Invalid output format from yt-dlp: " + stdout));
        }
        const parts = matchingLine.split(" ||| ");
        if (parts.length < 4) {
          return reject(new Error("Invalid output format from yt-dlp: " + stdout));
        }
        const title = parts[0];
        const duration = Math.round(parseFloat(parts[1])) || 0;
        const id = parts[2].trim();
        const finalPath = parts[3].trim();
        const filename = path.basename(finalPath);
        resolve({ title, duration, filename });
      } catch (parseErr) {
        reject(parseErr);
      }
    };

    if (usePythonInterpreter) {
      execFile(pythonCommand, [ytdlpPath, ...args], callback);
    } else {
      execFile(ytdlpPath, args, callback);
    }
  });
}

// Fallback downloader for direct audio URLs or stream URLs
function downloadDirectAudio(url: string, prefix = ""): Promise<{ title: string; duration: number; filename: string }> {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(url);
      const ext = path.extname(parsedUrl.pathname) || ".mp3";
      const hash = crypto.createHash("md5").update(url).digest("hex");
      const filename = `${prefix}${hash}${ext}`;
      const destPath = path.join(downloadsDir, filename);

      const title = decodeURIComponent(path.basename(parsedUrl.pathname)) || "Direct Audio";

      // If already downloaded, return immediately
      if (fs.existsSync(destPath)) {
        return resolve({ title, duration: 0, filename });
      }

      console.log(`Downloading direct audio from ${url} to ${destPath}...`);
      const file = fs.createWriteStream(destPath);
      const client = url.startsWith("https") ? https : http;

      client.get(url, (response) => {
        if (response.statusCode && (response.statusCode < 200 || response.statusCode >= 300)) {
          fs.unlink(destPath, () => {});
          return reject(new Error(`Server returned status code ${response.statusCode}`));
        }
        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve({ title, duration: 0, filename });
        });
      }).on("error", (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

async function startServer() {
  await ensureYtdlp();
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "10mb" }));

  // API Routes
  app.post("/api/agenda/generate", async (req, res) => {
    try {
      const { prompt, rawData } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY environment variable is missing" });
      }

      const ai = new GoogleGenAI({ apiKey });

      const systemPrompt = `You are an AI assistant that parses or generates an event agenda.
The user might provide a prompt describing the event, or paste raw data (from Excel/CSV).
Your goal is to return a strict JSON array of objects representing the agenda items.
Each object must have the following fields:
- "name": A descriptive name for the track or segment.
- "startTime": The start time in "HH:MM" format (24-hour).
- "endTime": The end time in "HH:MM" format (24-hour).
Do not include markdown blocks, just return the raw JSON array. Ensure times are strictly "HH:MM". If no data is given, use the prompt to generate a reasonable agenda.`;

      let userContent = "";
      if (prompt) userContent += `Prompt: ${prompt}\n`;
      if (rawData) userContent += `Raw Data: ${rawData}\n`;

      let retries = 3;
      let lastError;

      while (retries > 0) {
        try {
          const response = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: [
              { role: "user", parts: [{ text: userContent }] }
            ],
            config: {
              systemInstruction: systemPrompt,
              temperature: 0.1,
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING, description: "Descriptive name for the track or segment." },
                    startTime: { type: Type.STRING, description: "Start time in HH:MM format (24-hour)" },
                    endTime: { type: Type.STRING, description: "End time in HH:MM format (24-hour)" }
                  },
                  required: ["name", "startTime", "endTime"]
                }
              }
            }
          });

          let responseText = response.text || "[]";
          const agenda = JSON.parse(responseText.trim());
          return res.json(agenda);
        } catch (err: any) {
          lastError = err;
          if (err.message?.includes("503") || err.message?.includes("high demand") || err.status === 503 || err.status === "UNAVAILABLE" || err instanceof SyntaxError) {
            retries--;
            if (retries > 0) {
              console.log(`Error generating agenda, retrying... (${retries} attempts left)`);
              await new Promise(resolve => setTimeout(resolve, 2000));
              continue;
            }
          }
          throw err;
        }
      }
      throw lastError;

    } catch (error: any) {
      console.error("AI Agenda generation error:", error);
      res.status(500).json({ error: error.message || "Failed to generate agenda" });
    }
  });

  // AI Lyrics and Chords Generator Endpoint
  app.post("/api/lyrics-chords/generate", async (req, res) => {
    try {
      const { trackName } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY environment variable is missing" });
      }
      if (!trackName) {
        return res.status(400).json({ error: "Track name is required" });
      }

      const ai = new GoogleGenAI({ apiKey });
      const systemPrompt = `You are a professional multi-lingual music transcriber, chord-editor, and guitar/piano teacher.
Your job is to generate accurate, high-quality lyrics and chords for any requested song.

CRITICAL REQUIREMENT FOR CHORD ALIGNMENT:
- Chords must be written on their own line.
- The chord symbols must be placed exactly above the lyric syllables where the harmony changes.
- Use simple space characters to align them.
- If the song is in Indonesian, output the lyrics in Indonesian with accurate Indonesian/Western chords. If English, output English.`;

      let retries = 3;
      let lastError;
      
      while (retries > 0) {
        try {
          const response = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: [
              { role: "user", parts: [{ text: `Generate full lyrics and chords for: "${trackName}"` }] }
            ],
            config: {
              systemInstruction: systemPrompt,
              temperature: 0.2,
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING, description: "Song Title" },
                  artist: { type: Type.STRING, description: "Artist Name" },
                  key: { type: Type.STRING, description: "Original Key (e.g., C Major, G# Minor)" },
                  tempo: { type: Type.STRING, description: "Estimated Tempo (e.g., 120 BPM)" },
                  strumming: { type: Type.STRING, description: "Suggested Strumming Pattern" },
                  difficulty: { type: Type.STRING, description: "Difficulty Level (Easy / Medium / Hard)" },
                  chordsSheet: { type: Type.STRING, description: "The complete song layout with chord symbols aligned precisely on the line ABOVE the lyrics. Use spaces to align." },
                  history: { type: Type.STRING, description: "A short, engaging paragraph containing interesting trivia, context, or meaning of the song." }
                },
                required: ["title", "artist", "key", "tempo", "strumming", "difficulty", "chordsSheet", "history"]
              }
            }
          });

          let responseText = response.text || "{}";
          const result = JSON.parse(responseText.trim());
          return res.json(result);
        } catch (err: any) {
          lastError = err;
          if (err.message?.includes("503") || err.message?.includes("high demand") || err.status === 503 || err.status === "UNAVAILABLE" || err instanceof SyntaxError) {
            retries--;
            if (retries > 0) {
              console.log(`Error generating, retrying... (${retries} attempts left)`);
              await new Promise(resolve => setTimeout(resolve, 2000));
              continue;
            }
          }
          throw err;
        }
      }
      throw lastError;

    } catch (error: any) {
      console.error("AI Lyrics and Chords generation error:", error);
      res.status(500).json({ error: error.message || "Failed to generate lyrics and chords" });
    }
  });

  // Get yt-dlp Status & Version
  app.get("/api/ytdlp/status", async (req, res) => {
    try {
      const version = await getYtdlpVersion();
      res.json({
        version,
        path: resolvedYtdlpPath,
        usePython: usePythonInterpreter,
        pythonCmd: pythonCommand
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to get yt-dlp status" });
    }
  });

  // Force Update yt-dlp to latest version from GitHub
  app.post("/api/ytdlp/update", async (req, res) => {
    try {
      console.log("Forcing manual update of yt-dlp binary...");
      await ensureYtdlp(true); // force download
      const version = await getYtdlpVersion();
      console.log("Manual update succeeded, new version:", version);
      res.json({
        success: true,
        version,
        path: resolvedYtdlpPath,
        usePython: usePythonInterpreter
      });
    } catch (err: any) {
      console.error("Manual yt-dlp update failed:", err);
      res.status(500).json({ error: err.message || "Failed to update yt-dlp" });
    }
  });

  // Extract metadata and download audio locally from YouTube/web URLs
  app.get("/api/youtube/info", async (req, res) => {
    try {
      const { url } = req.query;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "URL is required" });
      }

      const isYouTube = ytdl.validateURL(url);
      let downloadedFile: { title: string; duration: number; filename: string } | null = null;
      let ytdlErrorMsg = "";

      // 1. First, always attempt downloading via yt-dlp as it handles YouTube and hundreds of other websites natively!
      try {
        console.log("Attempting audio download via yt-dlp for URL:", url);
        downloadedFile = await downloadAudioViaYtdlp(url);
        console.log("yt-dlp download and metadata extraction succeeded!");
      } catch (err: any) {
        console.warn("yt-dlp download failed:", err.message);
        ytdlErrorMsg += `[yt-dlp]: ${err.message}. `;
      }

      // 2. If yt-dlp fails and it's YouTube, try ytdl-core fallback
      if (!downloadedFile && isYouTube) {
        console.log("Falling back to local ytdl-core metadata extraction & downloading...");
        const options: any = {};
        if (process.env.YOUTUBE_COOKIE) {
          options.requestOptions = {
            headers: {
              cookie: process.env.YOUTUBE_COOKIE
            }
          };
        }

        try {
          const info = await ytdl.getInfo(url, options);
          let format;
          try {
            format = ytdl.chooseFormat(info.formats, { filter: "audioonly", quality: "highestaudio" });
          } catch (e) {
            console.log("highestaudio format selection failed, trying fallback selectors...");
            format = info.formats.find(f => f.hasAudio && !f.hasVideo) || info.formats.find(f => f.hasAudio);
          }
          if (format && format.url) {
            const title = info.videoDetails.title || "YouTube Audio";
            const duration = parseInt(info.videoDetails.lengthSeconds) || 0;
            
            // Download the stream URL using our direct download mechanism
            console.log("Downloading ytdl-core direct audio stream...");
            const downloadRes = await downloadDirectAudio(format.url, `ytdl_${info.videoDetails.videoId}_`);
            downloadedFile = {
              title,
              duration,
              filename: downloadRes.filename
            };
          } else {
            throw new Error("No suitable audio formats found by ytdl-core");
          }
        } catch (ytdlErr: any) {
          console.error("ytdl-core download fallback failed:", ytdlErr);
          throw new Error(
            `YouTube download failed via all endpoints.\n` +
            `Primary yt-dlp Error: ${ytdlErrorMsg}\n` +
            `Fallback ytdl-core Error: ${ytdlErr.message || "Failed to download stream details"}`
          );
        }
      }

      // 3. If yt-dlp fails and it's NOT YouTube, treat it as a direct audio file and download it
      if (!downloadedFile && !isYouTube) {
        try {
          console.log("Attempting direct audio download fallback...");
          const downloadRes = await downloadDirectAudio(url);
          downloadedFile = {
            title: downloadRes.title,
            duration: 0,
            filename: downloadRes.filename
          };
        } catch (directErr: any) {
          console.error("Direct audio download fallback failed:", directErr);
          throw new Error(`Failed to retrieve or download direct audio. Error: ${directErr.message}`);
        }
      }

      if (!downloadedFile) {
        throw new Error("Could not download or extract any playable audio from this URL.");
      }

      // Return local downloaded path
      const localUrl = `/api/downloads/${downloadedFile.filename}`;
      res.json({
        title: downloadedFile.title,
        duration: downloadedFile.duration,
        directUrl: localUrl,
        proxyUrl: localUrl
      });
    } catch (error: any) {
      console.error("YouTube/URL load endpoint error:", error);
      let errMsg = error.message || "Gagal mengunduh audio";
      if (
        errMsg.toLowerCase().includes("sign in") ||
        errMsg.toLowerCase().includes("bot") ||
        errMsg.toLowerCase().includes("captcha") ||
        errMsg.toLowerCase().includes("age restrict") ||
        errMsg.toLowerCase().includes("forbidden") ||
        errMsg.toLowerCase().includes("403")
      ) {
        errMsg = "Akses video dibatasi oleh YouTube (butuh Sign-In/mendeteksi bot). Silakan coba video lain, direct audio URL (.mp3), atau unggah file lokal.";
      }
      res.status(500).json({ error: errMsg });
    }
  });

  // Serve downloaded files with Range & CORS headers supported for Web Audio API analyze
  app.get("/api/downloads/:filename", (req, res) => {
    const filename = req.params.filename;
    const safeFilename = path.basename(filename);
    const filePath = path.join(downloadsDir, safeFilename);

    if (fs.existsSync(filePath)) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
      res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
      return res.sendFile(filePath);
    } else {
      return res.status(404).send("File not found");
    }
  });

  // Stream Proxy to bypass CORS restrictions for Web Audio API
  app.get("/api/youtube/proxy", (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).send("URL is required");
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
    res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");

    const client = url.startsWith("https") ? https : http;

    // Set client request options, including Range header if requested by browser
    const options: any = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive'
      }
    };
    if (req.headers.range) {
      options.headers['Range'] = req.headers.range;
    }

    client.get(url, options, (proxyRes) => {
      // Forward status code
      res.status(proxyRes.statusCode || 200);

      // Forward essential headers
      const headersToForward = [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "cache-control"
      ];

      headersToForward.forEach(header => {
        if (proxyRes.headers[header]) {
          res.setHeader(header, proxyRes.headers[header] as string);
        }
      });

      proxyRes.pipe(res);
    }).on("error", (err) => {
      console.error("Proxy streaming error:", err);
      if (!res.headersSent) {
        res.status(500).send("Streaming failed");
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // When compiled to dist/server.cjs or packaged with pkg, __dirname represents the dist directory.
    const distPath = typeof __dirname !== 'undefined' ? __dirname : path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // Auto-open browser when running locally in production / packaged mode
    if (process.env.NODE_ENV === "production" || typeof __dirname !== "undefined") {
      const url = `http://localhost:${PORT}`;
      const start = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      
      // Execute the system-specific open command. We catch errors silently in case it's a headless server
      exec(`${start} ${url}`, () => {});
    }
  });
}

startServer();
