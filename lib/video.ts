// Video clip settings shared by the server and the movie page. Safe to import anywhere.

// The clip lengths the video model can make (Veo 3.1 Lite: 4, 6 or 8 seconds).
export const CLIP_LENGTHS = [4, 6, 8] as const;

// fal.ai price in US dollars per second of video, used only for the cost estimate.
// Veo 3.1 Lite at 720p without audio. If you change VIDEO_MODEL or VIDEO_RESOLUTION
// in lib/animate.ts, update this number from the model's page on fal.ai.
export const VIDEO_PRICE_PER_SECOND = 0.03;

// Each clip is at least as long as the planned shot, so the editor can trim it to the beat.
export function clipSecondsFor(planned: number): number {
  const wanted = Number.isFinite(planned) ? planned : 5;
  const fit = CLIP_LENGTHS.find((length) => length >= wanted);
  return fit ?? CLIP_LENGTHS[CLIP_LENGTHS.length - 1];
}

export function estimateClips(plannedSeconds: number[]) {
  const seconds = plannedSeconds.reduce((sum, s) => sum + clipSecondsFor(s), 0);
  return {
    clips: plannedSeconds.length,
    seconds,
    dollars: Math.round(seconds * VIDEO_PRICE_PER_SECOND * 100) / 100,
  };
}

export type ClipEstimate = ReturnType<typeof estimateClips>;
