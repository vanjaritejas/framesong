// How the finished movie is timed. Safe to import anywhere.

// fal.ai prices in US dollars, used only for the cost estimate.
// MiniMax Music 3 bills per second of song. The edit runs on your own server, so it's free.
export const SONG_PRICE_PER_SECOND = 0.002;

// The song is asked to run a little longer than the movie so it never stops early.
export const SONG_EXTRA_SECONDS = 3;

export type CutInput = {
  seconds: number; // how long the plan wants the shot
  clipSeconds: number; // how long the finished clip is
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

// Length of each cut in seconds.
// With a tempo (a new song), every cut is a whole number of beats, so cuts land on the beat.
// Without one (your own song), each shot keeps its planned length.
export function cutLengths(shots: CutInput[], bpm: number | null): number[] {
  if (!bpm || !Number.isFinite(bpm)) {
    return shots.map((s) => Math.round(Math.min(s.seconds, s.clipSeconds) * 1000) / 1000);
  }
  const beat = 60 / clamp(bpm, 60, 160);
  // Cut every 2 beats when that's quick enough, otherwise every beat.
  const unit = beat * 2 <= 1.6 ? beat * 2 : beat;
  return shots.map((s) => {
    let count = Math.max(1, Math.round(s.seconds / unit));
    while (count > 1 && count * unit > s.clipSeconds + 0.001) count -= 1;
    return Math.round(count * unit * 1000) / 1000;
  });
}

export function totalSeconds(lengths: number[]) {
  return Math.round(lengths.reduce((sum, s) => sum + s, 0) * 1000) / 1000;
}

export function estimateEdit(movieSeconds: number, makesSong: boolean) {
  const songSeconds = makesSong ? Math.ceil(movieSeconds + SONG_EXTRA_SECONDS) : 0;
  const dollars = songSeconds * SONG_PRICE_PER_SECOND;
  return {
    movieSeconds: Math.round(movieSeconds),
    makesSong,
    dollars: makesSong ? Math.max(0.01, Math.round(dollars * 100) / 100) : 0,
  };
}

// If the song is shorter than the movie, every cut is shortened a little so the movie
// ends with the song instead of running on in silence.
export function fitToSong(cuts: number[], songSeconds: number | null): number[] {
  const total = cuts.reduce((sum, s) => sum + s, 0);
  if (!songSeconds || total <= songSeconds - 0.05) return cuts;
  const scale = Math.max(0.1, songSeconds - 0.1) / total;
  return cuts.map((s) => Math.max(1, Math.floor(s * scale * 1000) / 1000));
}

export type EditEstimate = ReturnType<typeof estimateEdit>;

// What gets saved on the movie when an edit starts, so the editor knows the exact cuts.
export type EditPlan = {
  cuts: { image_id: string; clip_path: string; seconds: number }[];
  total_seconds: number;
  bpm: number | null;
};

export function isEditPlan(value: unknown): value is EditPlan {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as EditPlan).cuts) &&
    typeof (value as EditPlan).total_seconds === "number"
  );
}
