import Link from "next/link";
import { notFound } from "next/navigation";
import DeleteMovieButton from "@/components/DeleteMovieButton";
import MoviePlanner from "@/components/MoviePlanner";
import { createClient } from "@/lib/supabase/server";
import { BUCKET, signedUrlMap } from "@/lib/storage";
import { isPlan } from "@/lib/plan";
import { clipSecondsFor, estimateClips } from "@/lib/video";
import { cutLengths, estimateEdit, totalSeconds } from "@/lib/timeline";
import {
  ASPECT_NAME,
  STATUS_LABELS,
  STYLE_NAME,
  needsRestyle,
  ratioCss,
  type AspectId,
  type StyleId,
} from "@/lib/constants";
import { deleteProject } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Movie = {
  id: string;
  title: string;
  style: StyleId;
  aspect_ratio: AspectId;
  song_mode: "ai" | "upload";
  song_mood: string | null;
  song_notes: string | null;
  song_path: string | null;
  status: string;
  director_plan: unknown;
  error: string | null;
  song_status: string;
  ai_song_path: string | null;
  ai_song_seconds: number | null;
  edit_status: string;
  preview_path: string | null;
  preview_url: string | null;
};

type Photo = {
  id: string;
  storage_path: string;
  styled_path: string | null;
  style_status: string;
  clip_path: string | null;
  clip_status: string;
  clip_seconds: number | null;
  position: number;
};

export default async function MoviePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await createClient();
  const [movieResult, photoResult] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, title, style, aspect_ratio, song_mode, song_mood, song_notes, song_path, status, director_plan, error, song_status, ai_song_path, ai_song_seconds, edit_status, preview_path, preview_url",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("project_images")
      .select("id, storage_path, styled_path, style_status, clip_path, clip_status, clip_seconds, position")
      .eq("project_id", id)
      .order("position", { ascending: true }),
  ]);

  if (!movieResult.data) notFound();
  const movie = movieResult.data as unknown as Movie;
  const photos = (photoResult.data ?? []) as unknown as Photo[];
  const plan = isPlan(movie.director_plan) ? movie.director_plan : null;
  const restyles = needsRestyle(movie.style);

  const urls = await signedUrlMap(supabase, [
    ...photos.map((p) => p.storage_path),
    ...photos.flatMap((p) => (p.styled_path ? [p.styled_path] : [])),
    ...photos.flatMap((p) => (p.clip_path && p.clip_status === "done" ? [p.clip_path] : [])),
    ...(movie.song_path ? [movie.song_path] : []),
    ...(movie.ai_song_path && movie.song_status === "done" ? [movie.ai_song_path] : []),
    ...(movie.preview_path ? [movie.preview_path] : []),
  ]);
  const songUrl = movie.song_path ? urls.get(movie.song_path) : undefined;
  const aiSongUrl =
    movie.ai_song_path && movie.song_status === "done" ? urls.get(movie.ai_song_path) : undefined;

  // The finished movie, with a separate link that downloads it with a friendly file name.
  const movieUrl = movie.preview_path ? urls.get(movie.preview_path) : (movie.preview_url ?? undefined);
  let downloadUrl: string | undefined = movie.preview_url ?? undefined;
  if (movie.preview_path) {
    const fileName = `${movie.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "framesong"}.mp4`;
    const { data } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(movie.preview_path, 3600, { download: fileName });
    downloadUrl = data?.signedUrl;
  }
  const ratio = ratioCss(movie.aspect_ratio);
  const photoById = new Map(photos.map((p) => [p.id, p]));

  const counts = {
    total: restyles ? photos.length : 0,
    done: photos.filter((p) => p.style_status === "done").length,
    failed: photos.filter((p) => p.style_status === "failed").length,
    pending: photos.filter((p) => p.style_status === "queued" || p.style_status === "running").length,
  };

  const clipCounts = {
    total: photos.length,
    done: photos.filter((p) => p.clip_status === "done").length,
    failed: photos.filter((p) => p.clip_status === "failed").length,
    pending: photos.filter((p) => p.clip_status === "queued" || p.clip_status === "running").length,
  };
  const canAnimate = !restyles || photos.every((p) => p.style_status === "done");

  // Shots follow the plan; photos added after planning are listed at the end.
  const plannedIds = new Set(plan?.shots.map((s) => s.image_id) ?? []);
  const shots = plan
    ? [
        ...plan.shots.filter((s) => photoById.has(s.image_id)),
        ...photos
          .filter((p) => !plannedIds.has(p.id))
          .map((p) => ({ image_id: p.id, scene: "", motion: "", seconds: 5 })),
      ]
    : [];

  // Cost estimate for the shots that don't have a finished clip yet.
  const estimate = estimateClips(
    shots.filter((s) => photoById.get(s.image_id)?.clip_status !== "done").map((s) => s.seconds),
  );

  // Cost estimate for making the finished movie from the clips that exist.
  const editable = shots.filter((s) => photoById.get(s.image_id)?.clip_status === "done");
  const editLengths = cutLengths(
    editable.map((s) => ({
      seconds: s.seconds,
      clipSeconds: photoById.get(s.image_id)?.clip_seconds ?? clipSecondsFor(s.seconds),
    })),
    movie.song_mode === "ai" && plan ? plan.song.bpm : null,
  );
  const movieSeconds = totalSeconds(editLengths);
  const songFits =
    movie.song_status === "done" && Boolean(movie.ai_song_path) && (movie.ai_song_seconds ?? 0) >= movieSeconds - 0.5;
  const editEstimate = estimateEdit(movieSeconds, movie.song_mode === "ai" && !songFits);
  const newSongEstimate = estimateEdit(movieSeconds, movie.song_mode === "ai");
  const editStage =
    movie.status !== "editing"
      ? null
      : movie.song_status === "queued" || movie.song_status === "running"
        ? ("song" as const)
        : ("edit" as const);

  return (
    <>
      <Link href="/studio" className="back">
        All movies
      </Link>

      <div className="detail-head">
        <h1>{movie.title}</h1>
        <span className="badge" data-status={movie.status}>
          {STATUS_LABELS[movie.status] ?? movie.status}
        </span>
      </div>

      <dl className="facts">
        <div>
          <dt>Look</dt>
          <dd>{STYLE_NAME[movie.style] ?? movie.style}</dd>
        </div>
        <div>
          <dt>Format</dt>
          <dd>
            {ASPECT_NAME[movie.aspect_ratio] ?? movie.aspect_ratio} ({movie.aspect_ratio})
          </dd>
        </div>
        <div>
          <dt>Song</dt>
          <dd>{movie.song_mode === "ai" ? `New song, ${movie.song_mood ?? "any mood"}` : "Your own song"}</dd>
        </div>
        <div>
          <dt>{plan ? "Length" : "Photos"}</dt>
          <dd>{plan ? `About ${plan.total_seconds} seconds` : photos.length}</dd>
        </div>
      </dl>

      {movieUrl && (
        <section className="movie-player" aria-labelledby="movie-title">
          <h2 id="movie-title">Your movie</h2>
          <video
            src={movieUrl}
            controls
            playsInline
            preload="metadata"
            style={{ aspectRatio: ratio }}
            aria-label={`${movie.title}, the finished movie`}
          />
          <div className="planner-actions">
            {downloadUrl && (
              <a className="btn btn-primary" href={downloadUrl} download>
                Download the movie
              </a>
            )}
          </div>
          {movie.status === "editing" && (
            <p className="hint">A new edit is being made. This is the previous version.</p>
          )}
        </section>
      )}

      {photos.length === 0 ? (
        <div className="notice error" role="alert">
          This movie has no photos. Delete it below and create a new one.
        </div>
      ) : (
        <MoviePlanner
          movieId={movie.id}
          status={movie.status}
          hasPlan={Boolean(plan)}
          restyles={restyles}
          styleName={STYLE_NAME[movie.style] ?? movie.style}
          counts={counts}
          clipCounts={clipCounts}
          canAnimate={canAnimate}
          estimate={estimate}
          songMode={movie.song_mode}
          editEstimate={editEstimate}
          newSongEstimate={newSongEstimate}
          editStage={editStage}
          hasMovie={Boolean(movieUrl)}
          error={movie.error}
        />
      )}

      {plan ? (
        <>
          <section className="plan" aria-labelledby="plan-title">
            <h2 id="plan-title">Shots</h2>
            {plan.logline && <p className="logline">{plan.logline}</p>}
            <ol className="shots" data-aspect={movie.aspect_ratio}>
              {shots.map((shot, i) => {
                const photo = photoById.get(shot.image_id);
                if (!photo) return null;
                const original = urls.get(photo.storage_path);
                const styled = photo.styled_path ? urls.get(photo.styled_path) : undefined;
                const redrawing = photo.style_status === "queued" || photo.style_status === "running";
                const clip =
                  photo.clip_status === "done" && photo.clip_path ? urls.get(photo.clip_path) : undefined;
                const animating = photo.clip_status === "queued" || photo.clip_status === "running";
                return (
                  <li key={shot.image_id} className="shot">
                    <div className="shot-media" style={{ aspectRatio: ratio }}>
                      {clip ? (
                        <video
                          className="shot-video"
                          src={clip}
                          poster={styled ?? original}
                          controls
                          muted
                          loop
                          playsInline
                          preload="metadata"
                          aria-label={`Clip for shot ${i + 1}`}
                        />
                      ) : (
                        <>
                          {(styled ?? original) && <img src={styled ?? original} alt={`Shot ${i + 1}`} />}
                          {styled && original && (
                            <img
                              className="shot-original"
                              src={original}
                              alt={`Original photo for shot ${i + 1}`}
                            />
                          )}
                        </>
                      )}
                      {restyles && redrawing && <span className="shot-flag">Redrawing…</span>}
                      {restyles && photo.style_status === "failed" && (
                        <span className="shot-flag is-failed">Not redrawn</span>
                      )}
                      {animating && <span className="shot-flag">Animating…</span>}
                      {photo.clip_status === "failed" && (
                        <span className="shot-flag is-failed">Not animated</span>
                      )}
                    </div>
                    <div className="shot-text">
                      <div className="shot-top">
                        <span className="shot-num">{i + 1}</span>
                        <span className="hint">{shot.seconds} seconds</span>
                      </div>
                      {shot.scene && <p className="shot-scene">{shot.scene}</p>}
                      {shot.motion ? (
                        <p className="shot-motion">
                          <span className="shot-label">Motion</span> {shot.motion}
                        </p>
                      ) : (
                        <p className="hint">Added after planning. Plan again to include this photo.</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="song-panel" aria-labelledby="song-title">
            <h2 id="song-title">Song</h2>
            {movie.song_mode === "ai" ? (
              <>
                <h3>{plan.song.title}</h3>
                <p className="hint">
                  {plan.song.style ? `${plan.song.style}, ` : ""}
                  {plan.song.bpm} BPM
                </p>
                {aiSongUrl && <audio controls src={aiSongUrl} preload="none" aria-label="The song" />}
                {plan.song.lyrics && <pre className="lyrics">{plan.song.lyrics}</pre>}
                {movie.song_notes && <p className="hint">You asked it to mention: {movie.song_notes}</p>}
              </>
            ) : (
              <>
                <p>Your own song plays over the movie.</p>
                {songUrl && <audio controls src={songUrl} preload="none" />}
              </>
            )}
          </section>
        </>
      ) : (
        photos.length > 0 && (
          <section className="plan" aria-labelledby="photos-title">
            <h2 id="photos-title">Photos</h2>
            {songUrl && (
              <div className="field">
                <span className="label">Your song</span>
                <audio controls src={songUrl} preload="none" />
              </div>
            )}
            <ol className="frames" aria-label="Photos in play order">
              {photos.map((p, i) => {
                const src = urls.get(p.storage_path);
                return (
                  <li key={p.id} className="frame-tile">
                    <div className="frame-media" style={{ aspectRatio: ratio }}>
                      {src && <img src={src} alt={`Photo ${i + 1}`} />}
                    </div>
                    <div className="frame-bar">
                      <span className="frame-num">{i + 1}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        )
      )}

      <form action={deleteProject} className="danger-zone">
        <input type="hidden" name="id" value={movie.id} />
        <DeleteMovieButton />
      </form>
    </>
  );
}
