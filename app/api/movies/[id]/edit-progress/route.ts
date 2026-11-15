import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/storage";
import { checkSong } from "@/lib/edit";
import { probeSeconds, renderMovie } from "@/lib/render";
import { fitToSong, isEditPlan } from "@/lib/timeline";
import { friendlyError } from "@/lib/errors";
import type { AspectId } from "@/lib/constants";

// The edit runs inside this request, so it gets the most time Vercel allows.
export const maxDuration = 300;

// An edit marked "running" for longer than this has stopped, so it can be started again.
const STALE_RUN_MS = 6 * 60 * 1000;

// Storage keeps files up to 50 MB (the Supabase free plan limit).
const MAX_MOVIE_BYTES = 50 * 1024 * 1024;

type MovieRow = {
  id: string;
  status: string;
  aspect_ratio: AspectId;
  song_mode: "ai" | "upload";
  song_path: string | null;
  song_status: string;
  song_request_id: string | null;
  ai_song_path: string | null;
  edit_status: string;
  edit_plan: unknown;
  preview_path: string | null;
  updated_at: string;
};

type Stage = "song" | "edit" | "done" | "failed" | "idle";

function active(status: string) {
  return status === "queued" || status === "running";
}

// Called every few seconds by the movie page while the song and the edit are being made.
// The first check after the edit is queued runs the edit itself, which takes about a minute.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Your session ended. Sign in again." }, { status: 401 });

  const { data: movieData } = await supabase
    .from("projects")
    .select(
      "id, status, aspect_ratio, song_mode, song_path, song_status, song_request_id, ai_song_path, edit_status, edit_plan, preview_path, updated_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!movieData) return NextResponse.json({ error: "This movie doesn't exist." }, { status: 404 });
  const movie = movieData as unknown as MovieRow;

  const fallbackStatus = movie.preview_path ? "preview_ready" : "animated";
  const fail = async (message: string, fields: Record<string, unknown>) => {
    await supabase
      .from("projects")
      .update({ ...fields, status: fallbackStatus, error: message })
      .eq("id", id);
    return NextResponse.json({ stage: "failed" as Stage, error: message });
  };

  if (movie.status !== "editing") {
    const stage: Stage = movie.status === "preview_ready" ? "done" : "idle";
    return NextResponse.json({ stage });
  }

  // 1. The song (new-song movies only), made on fal.ai.
  if (active(movie.song_status)) {
    if (!movie.song_request_id) {
      return fail("The song job was lost. Select Make the movie to try again.", { song_status: "failed" });
    }

    let check;
    try {
      check = await checkSong(movie.song_request_id);
    } catch {
      return NextResponse.json({ stage: "song" as Stage }); // Network hiccup: check again next time.
    }

    if (check.state === "pending") {
      if (check.running && movie.song_status !== "running") {
        await supabase.from("projects").update({ song_status: "running" }).eq("id", id);
      }
      return NextResponse.json({ stage: "song" as Stage });
    }
    if (check.state === "failed") {
      return fail(`The song couldn't be made: ${check.reason.slice(0, 200)}`, { song_status: "failed" });
    }

    // Save the song, then queue the edit. The next check runs it.
    try {
      const res = await fetch(check.url);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const contentType = check.contentType?.startsWith("audio/") ? check.contentType : "audio/wav";
      const ext = contentType.includes("mpeg") || contentType.includes("mp3") ? "mp3" : "wav";
      const songPath = `${user.id}/${id}/song-ai.${ext}`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(songPath, await res.arrayBuffer(), { contentType, upsert: true });
      if (error) throw new Error(error.message);
      await supabase
        .from("projects")
        .update({
          song_status: "done",
          ai_song_path: songPath,
          ai_song_seconds: check.seconds,
          edit_status: "queued",
        })
        .eq("id", id);
      return NextResponse.json({ stage: "edit" as Stage });
    } catch (err) {
      return fail(`The song was made, but it couldn't be saved: ${friendlyError(err)}`, { song_status: "failed" });
    }
  }

  // 2. The edit, made with FFmpeg on this server.
  if (movie.edit_status === "running") {
    const age = Date.now() - new Date(movie.updated_at).getTime();
    if (age > STALE_RUN_MS) {
      return fail("The edit stopped before it finished. Select Make the movie to try again.", { edit_status: "failed" });
    }
    return NextResponse.json({ stage: "edit" as Stage }); // Another check is running it.
  }

  if (movie.edit_status !== "queued") {
    return fail("The edit stopped. Select Make the movie to try again.", {});
  }

  // Claim the edit so only one check runs it, even if two tabs are open.
  const { data: claimed } = await supabase
    .from("projects")
    .update({ edit_status: "running" })
    .eq("id", id)
    .eq("edit_status", "queued")
    .select("id");
  if (!claimed || claimed.length === 0) return NextResponse.json({ stage: "edit" as Stage });

  const plan = isEditPlan(movie.edit_plan) ? movie.edit_plan : null;
  const songPath = movie.song_mode === "ai" ? movie.ai_song_path : movie.song_path;
  if (!plan) return fail("The edit plan is missing. Select Make the movie again.", { edit_status: "failed" });
  if (!songPath) return fail("The song file is missing. Select Make the movie again.", { edit_status: "failed" });

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "framesong-"));
  try {
    // Copy the clips and the song from storage into a temporary folder.
    const download = async (storagePath: string, file: string) => {
      const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
      if (error || !data) throw new Error(`A file couldn't be read from storage (${storagePath.split("/").pop()}).`);
      await fs.writeFile(file, Buffer.from(await data.arrayBuffer()));
      return file;
    };

    const clipFiles: string[] = [];
    for (const [i, cut] of plan.cuts.entries()) {
      clipFiles.push(await download(cut.clip_path, path.join(workDir, `clip-${i}.mp4`)));
    }
    const songFile = await download(songPath, path.join(workDir, `song${path.extname(songPath) || ".mp3"}`));

    // Never ask for more song than there is.
    const songSeconds = await probeSeconds(songFile);
    const lengths = fitToSong(
      plan.cuts.map((c) => c.seconds),
      songSeconds,
    );

    const outFile = path.join(workDir, "movie.mp4");
    await renderMovie({
      clips: clipFiles.map((file, i) => ({ file, seconds: lengths[i] })),
      song: songFile,
      aspect: movie.aspect_ratio,
      outFile,
    });

    const movieBytes = await fs.readFile(outFile);
    if (movieBytes.byteLength > MAX_MOVIE_BYTES) {
      throw new Error("The finished movie is bigger than 50 MB, the storage limit. Try a shorter movie.");
    }
    const moviePath = `${user.id}/${id}/movie.mp4`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(moviePath, movieBytes, { contentType: "video/mp4", upsert: true });
    if (error) throw new Error(`The movie was made but couldn't be saved: ${error.message}`);

    await supabase
      .from("projects")
      .update({
        status: "preview_ready",
        edit_status: "done",
        preview_path: moviePath,
        preview_url: null,
        error: null,
      })
      .eq("id", id);
    return NextResponse.json({ stage: "done" as Stage });
  } catch (err) {
    return fail(`The movie couldn't be edited: ${friendlyError(err)}`, { edit_status: "failed" });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
