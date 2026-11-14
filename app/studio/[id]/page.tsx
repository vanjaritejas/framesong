import Link from "next/link";
import { notFound } from "next/navigation";
import DeleteMovieButton from "@/components/DeleteMovieButton";
import { createClient } from "@/lib/supabase/server";
import { signedUrlMap } from "@/lib/storage";
import {
  ASPECT_NAME,
  STATUS_LABELS,
  STYLE_NAME,
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
};

type Photo = { id: string; storage_path: string; position: number };

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
      .select("id, title, style, aspect_ratio, song_mode, song_mood, song_notes, song_path, status")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("project_images")
      .select("id, storage_path, position")
      .eq("project_id", id)
      .order("position", { ascending: true }),
  ]);

  if (!movieResult.data) notFound();
  const movie = movieResult.data as unknown as Movie;
  const photos = (photoResult.data ?? []) as unknown as Photo[];

  const urls = await signedUrlMap(supabase, [
    ...photos.map((p) => p.storage_path),
    ...(movie.song_path ? [movie.song_path] : []),
  ]);
  const songUrl = movie.song_path ? urls.get(movie.song_path) : undefined;
  const ratio = ratioCss(movie.aspect_ratio);

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
          <dt>Photos</dt>
          <dd>{photos.length}</dd>
        </div>
      </dl>

      {movie.song_notes && (
        <p className="hint song-notes">Song should mention: {movie.song_notes}</p>
      )}
      {songUrl && (
        <div className="field">
          <span className="label">Your song</span>
          <audio controls src={songUrl} preload="none" />
        </div>
      )}

      {photos.length === 0 ? (
        <div className="notice error" role="alert">
          This movie has no photos. Delete it below and create a new one.
        </div>
      ) : (
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
      )}

      <section className="generate" aria-labelledby="generate-title">
        <h2 id="generate-title">Make the movie</h2>
        <p>
          FrameSong will plan each scene, animate your photos, make the song, and cut
          everything to the beat. You’ll watch a preview first, then you can render it in 4K.
        </p>
        <div>
          <button type="button" className="btn btn-primary" disabled>
            Generate movie
          </button>
        </div>
        <p className="hint">
          Movie generation arrives in the next update. Your photos and settings are saved.
        </p>
      </section>

      <form action={deleteProject} className="danger-zone">
        <input type="hidden" name="id" value={movie.id} />
        <DeleteMovieButton />
      </form>
    </>
  );
}
