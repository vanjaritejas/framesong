import { spawn } from "node:child_process";
import { promises as fs, constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AspectId } from "@/lib/constants";

// The finished movie is made with FFmpeg right on the server (your computer while testing,
// Vercel when live). The ffmpeg-static package downloads the FFmpeg program during npm install.

// Frame size of the finished movie for each format.
const FRAME: Record<AspectId, { width: number; height: number }> = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "1:1": { width: 720, height: 720 },
};

const FPS = 24;

function installedFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const name = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  return path.join(process.cwd(), "node_modules", "ffmpeg-static", name);
}

let runnable: string | null = null;

// Finds FFmpeg and makes sure it can run. Some hosts copy it without permission to run,
// so in that case a runnable copy is made in the temporary folder.
async function ffmpegPath(): Promise<string> {
  if (runnable) return runnable;
  const installed = installedFfmpeg();
  try {
    await fs.access(installed, fsConstants.F_OK);
  } catch {
    throw new Error(
      "FFmpeg isn't installed. Stop the website (Ctrl + C), run npm install, then start it again with npm run dev.",
    );
  }
  try {
    await fs.access(installed, fsConstants.X_OK);
    runnable = installed;
  } catch {
    const copy = path.join(os.tmpdir(), "framesong-ffmpeg");
    await fs.copyFile(installed, copy);
    await fs.chmod(copy, 0o755);
    runnable = copy;
  }
  return runnable;
}

function run(args: string[], timeoutMs: number): Promise<{ code: number | null; stderr: string }> {
  return ffmpegPath().then(
    (bin) =>
      new Promise((resolve, reject) => {
        const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
        child.stderr.on("data", (chunk: Buffer) => {
          stderr = (stderr + chunk.toString()).slice(-20000);
        });
        child.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ code, stderr });
        });
      }),
  );
}

// How long an audio or video file is, in seconds, or null if FFmpeg can't tell.
export async function probeSeconds(file: string): Promise<number | null> {
  const { stderr } = await run(["-hide_banner", "-i", file], 30_000);
  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export type RenderInput = {
  clips: { file: string; seconds: number }[]; // in play order
  song: string;
  aspect: AspectId;
  outFile: string;
};

// Plays each clip for its cut length, fills the frame for the movie's format,
// joins them in order, and lays the song underneath with a short fade at the end.
export async function renderMovie(input: RenderInput) {
  const { width, height } = FRAME[input.aspect] ?? FRAME["16:9"];
  const total = input.clips.reduce((sum, c) => sum + c.seconds, 0);
  const n = input.clips.length;

  const videoChains = input.clips.map(
    (clip, i) =>
      `[${i}:v]trim=0:${clip.seconds.toFixed(3)},setpts=PTS-STARTPTS,` +
      `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},` +
      `setsar=1,fps=${FPS},format=yuv420p[v${i}]`,
  );
  const concat = `${input.clips.map((_, i) => `[v${i}]`).join("")}concat=n=${n}:v=1:a=0[vout]`;
  const fadeStart = Math.max(0, total - 1.5).toFixed(3);
  const audio = `[${n}:a]atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=out:st=${fadeStart}:d=1.5[aout]`;

  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    ...input.clips.flatMap((c) => ["-i", c.file]),
    "-i",
    input.song,
    "-filter_complex",
    [...videoChains, concat, audio].join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    "-t",
    total.toFixed(3),
    input.outFile,
  ];

  const { code, stderr } = await run(args, 240_000);
  if (code !== 0) {
    const reason = stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300);
    throw new Error(reason ? `FFmpeg couldn't make the movie: ${reason}` : "FFmpeg couldn't make the movie.");
  }
}
