"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Scene from "@/components/Scene";
import { createClient } from "@/lib/supabase/client";
import { BUCKET } from "@/lib/storage";
import {
  ASPECTS,
  MOODS,
  PHOTO_LIMITS,
  SONG_LIMITS,
  STYLES,
  STYLE_NAME,
  ASPECT_NAME,
  ratioCss,
  type AspectId,
  type StyleId,
} from "@/lib/constants";

type UploadStatus = "ready" | "uploading" | "done" | "failed";

type PhotoItem = {
  id: string;
  file: File;
  previewUrl: string;
  width: number;
  height: number;
  status: UploadStatus;
  storagePath?: string;
};

type Message = { kind: "error" | "info"; text: string };

const IMAGE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const SHAPE_SIZE: Record<AspectId, { width: number; height: number }> = {
  "16:9": { width: 40, height: 23 },
  "9:16": { width: 23, height: 40 },
  "1:1": { width: 32, height: 32 },
};

const STATUS_TEXT: Record<UploadStatus, string> = {
  ready: "Ready",
  uploading: "Uploading…",
  done: "Uploaded",
  failed: "Upload failed",
};

// Phone photos can be 8–15 MB. Shrinking to 2560 px on the long edge keeps them sharp
// enough for a 4K movie while making uploads much faster and saving storage space.
const MAX_EDGE = 2560;

async function shrinkPhoto(file: File): Promise<{ body: Blob; type: string; ext: string }> {
  const original = { body: file as Blob, type: file.type, ext: IMAGE_EXT[file.type] ?? "jpg" };
  try {
    // "from-image" keeps phone photos the right way up.
    const options = { imageOrientation: "from-image" } as unknown as ImageBitmapOptions;
    const bitmap = await createImageBitmap(file, options);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= 3 * 1024 * 1024) {
      bitmap.close();
      return original;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return original;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    return blob ? { body: blob, type: "image/jpeg", ext: "jpg" } : original;
  } catch {
    return original; // Older browsers: upload the photo as it is.
  }
}

function readSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
}

// Runs `task` for every item, at most `limit` at a time.
async function runPool<T>(list: T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const item = list[next++];
      await task(item);
    }
  });
  await Promise.all(workers);
}

function fileExt(name: string, fallback: string) {
  const match = /\.([a-z0-9]{2,5})$/i.exec(name);
  return match ? match[1].toLowerCase() : fallback;
}

export default function NewMovieForm() {
  const router = useRouter();

  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [style, setStyle] = useState<StyleId>("real_nature");
  const [aspect, setAspect] = useState<AspectId>("16:9");
  const [songMode, setSongMode] = useState<"ai" | "upload">("ai");
  const [mood, setMood] = useState<string>(MOODS[0]);
  const [songNotes, setSongNotes] = useState("");
  const [songFile, setSongFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");

  const [projectId, setProjectId] = useState<string | null>(null);
  const [songUploadedPath, setSongUploadedPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [dragging, setDragging] = useState(false);

  const photosRef = useRef<PhotoItem[]>(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  // Free the preview images from memory when leaving the page.
  useEffect(() => {
    return () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl));
  }, []);

  const doneCount = photos.filter((p) => p.status === "done").length;

  async function addFiles(fileList: FileList | File[]) {
    setMessage(null);
    const problems: string[] = [];
    const accepted: File[] = [];

    for (const file of Array.from(fileList)) {
      if (!PHOTO_LIMITS.types.includes(file.type)) {
        problems.push(`${file.name} isn’t a JPG, PNG, or WebP photo`);
      } else if (file.size > PHOTO_LIMITS.maxMB * 1024 * 1024) {
        problems.push(`${file.name} is larger than ${PHOTO_LIMITS.maxMB} MB`);
      } else {
        accepted.push(file);
      }
    }

    const room = Math.max(PHOTO_LIMITS.max - photosRef.current.length, 0);
    const kept = accepted.slice(0, room);
    if (accepted.length > kept.length) {
      problems.push(
        `A movie holds up to ${PHOTO_LIMITS.max} photos, so ${accepted.length - kept.length} were left out`,
      );
    }

    const items = await Promise.all(
      kept.map(async (file): Promise<PhotoItem> => {
        const previewUrl = URL.createObjectURL(file);
        const { width, height } = await readSize(previewUrl);
        return { id: crypto.randomUUID(), file, previewUrl, width, height, status: "ready" };
      }),
    );

    setPhotos((prev) => [...prev, ...items]);
    if (problems.length > 0) setMessage({ kind: "error", text: `${problems.join(". ")}.` });
  }

  function move(index: number, direction: -1 | 1) {
    setPhotos((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  }

  function remove(id: string) {
    setPhotos((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  function pickSong(file: File | null) {
    setMessage(null);
    setSongUploadedPath(null);
    if (!file) {
      setSongFile(null);
      return;
    }
    if (!SONG_LIMITS.types.includes(file.type)) {
      setMessage({ kind: "error", text: `${file.name} isn’t an MP3, M4A, AAC, or WAV file.` });
      return;
    }
    if (file.size > SONG_LIMITS.maxMB * 1024 * 1024) {
      setMessage({ kind: "error", text: `${file.name} is larger than ${SONG_LIMITS.maxMB} MB.` });
      return;
    }
    setSongFile(file);
  }

  async function handleCreate() {
    if (photos.length < PHOTO_LIMITS.min) {
      setMessage({ kind: "error", text: `Add at least ${PHOTO_LIMITS.min} photos to make a movie.` });
      return;
    }
    if (songMode === "upload" && !songFile) {
      setMessage({ kind: "error", text: "Choose your song file, or switch to a new song." });
      return;
    }

    setBusy(true);
    setMessage(null);
    const supabase = createClient();

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login?next=/studio/new");
        return;
      }

      // 1. Save the movie settings (or update them when retrying).
      const fields = {
        title: title.trim() || "Untitled movie",
        style,
        aspect_ratio: aspect,
        song_mode: songMode,
        song_mood: songMode === "ai" ? mood : null,
        song_notes: songMode === "ai" && songNotes.trim() ? songNotes.trim() : null,
      };

      let movieId = projectId;
      if (!movieId) {
        const { data, error } = await supabase.from("projects").insert(fields).select("id").single();
        if (error || !data) throw new Error(`The movie couldn’t be saved: ${error?.message ?? "no data returned"}.`);
        movieId = (data as { id: string }).id;
        setProjectId(movieId);
      } else {
        const { error } = await supabase.from("projects").update(fields).eq("id", movieId);
        if (error) throw new Error(`The movie settings couldn’t be saved: ${error.message}.`);
      }
      const id: string = movieId;

      // 2. Upload photos, 3 at a time. Already-uploaded photos are skipped on retry.
      const snapshot = photosRef.current;
      const paths = new Map<string, string>();
      snapshot.forEach((p) => {
        if (p.status === "done" && p.storagePath) paths.set(p.id, p.storagePath);
      });
      const pending = snapshot.filter((p) => !paths.has(p.id));

      const setStatus = (photoId: string, status: UploadStatus, storagePath?: string) =>
        setPhotos((prev) =>
          prev.map((p) =>
            p.id === photoId ? { ...p, status, storagePath: storagePath ?? p.storagePath } : p,
          ),
        );

      await runPool(pending, 3, async (p) => {
        setStatus(p.id, "uploading");
        const prepared = await shrinkPhoto(p.file);
        const path = `${user.id}/${id}/${p.id}.${prepared.ext}`;
        let ok = false;
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          const { error } = await supabase.storage
            .from(BUCKET)
            .upload(path, prepared.body, { contentType: prepared.type, upsert: true });
          ok = !error;
        }
        if (ok) {
          paths.set(p.id, path);
          setStatus(p.id, "done", path);
        } else {
          setStatus(p.id, "failed");
        }
      });

      const failed = snapshot.length - paths.size;
      if (failed > 0) {
        setMessage({
          kind: "error",
          text: `${failed} photo${failed === 1 ? "" : "s"} didn’t upload. Check your connection, then select Create movie again. Only the missing photos will upload.`,
        });
        return;
      }

      // 3. Upload the song file, if the user brought one.
      if (songMode === "upload" && songFile && !songUploadedPath) {
        const songPath = `${user.id}/${id}/song.${fileExt(songFile.name, "mp3")}`;
        const { error: songError } = await supabase.storage
          .from(BUCKET)
          .upload(songPath, songFile, { contentType: songFile.type, upsert: true });
        if (songError) throw new Error(`Your song didn’t upload: ${songError.message}. Select Create movie to try again.`);
        const { error: saveError } = await supabase.from("projects").update({ song_path: songPath }).eq("id", id);
        if (saveError) throw new Error(`Your song uploaded but couldn’t be linked to the movie: ${saveError.message}.`);
        setSongUploadedPath(songPath);
      }

      // 4. Save the photo order. Replacing all rows keeps retries clean.
      const { error: clearError } = await supabase.from("project_images").delete().eq("project_id", id);
      if (clearError) throw new Error(`The photo order couldn’t be saved: ${clearError.message}.`);

      const rows = snapshot.map((p, index) => ({
        project_id: id,
        storage_path: paths.get(p.id) as string,
        position: index,
        width: p.width || null,
        height: p.height || null,
      }));
      const { error: rowsError } = await supabase.from("project_images").insert(rows);
      if (rowsError) throw new Error(`The photo order couldn’t be saved: ${rowsError.message}.`);

      router.push(`/studio/${id}`);
      router.refresh();
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "The movie couldn’t be created. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  const ratio = ratioCss(aspect);
  const summary = [
    `${photos.length} photo${photos.length === 1 ? "" : "s"}`,
    STYLE_NAME[style],
    ASPECT_NAME[aspect],
  ].join(", ");

  return (
    <div className="builder">
      {/* 1. Photos */}
      <section className="step-block" aria-labelledby="step-photos">
        <header className="step-head">
          <span className="step-num" aria-hidden="true">1</span>
          <div>
            <h2 id="step-photos">Add your photos</h2>
            <p className="hint">
              {PHOTO_LIMITS.min} to {PHOTO_LIMITS.max} photos. They play in this order. JPG,
              PNG, or WebP, up to {PHOTO_LIMITS.maxMB} MB each.
            </p>
          </div>
        </header>

        <label
          className={`dropzone${dragging ? " is-dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!busy && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
          }}
        >
          <input
            type="file"
            multiple
            accept={PHOTO_LIMITS.types.join(",")}
            className="visually-hidden"
            disabled={busy || photos.length >= PHOTO_LIMITS.max}
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <span className="dropzone-title">Drop photos here or choose files</span>
          <span className="hint">
            {photos.length} of {PHOTO_LIMITS.max} added
          </span>
        </label>

        {photos.length > 0 && (
          <ol className="frames" aria-label="Photos in play order">
            {photos.map((p, i) => (
              <li key={p.id} className="frame-tile" data-status={p.status}>
                <div className="frame-media" style={{ aspectRatio: ratio }}>
                  <img src={p.previewUrl} alt={`Photo ${i + 1}: ${p.file.name}`} />
                </div>
                <div className="frame-bar">
                  <span className="frame-num">{i + 1}</span>
                  <span className="frame-status">{STATUS_TEXT[p.status]}</span>
                  <div className="tile-actions">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={busy || i === 0}
                      aria-label={`Move photo ${i + 1} earlier`}
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={busy || i === photos.length - 1}
                      aria-label={`Move photo ${i + 1} later`}
                    >
                      ›
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(p.id)}
                      disabled={busy}
                      aria-label={`Remove photo ${i + 1}`}
                    >
                      ×
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* 2. Look */}
      <section className="step-block" aria-labelledby="step-look">
        <header className="step-head">
          <span className="step-num" aria-hidden="true">2</span>
          <div>
            <h2 id="step-look">Choose a look</h2>
            <p className="hint">Every photo in the movie gets the same look.</p>
          </div>
        </header>
        <div className="option-grid" role="radiogroup" aria-labelledby="step-look">
          {STYLES.map((s) => (
            <label key={s.id} className="option">
              <input
                type="radio"
                name="style"
                value={s.id}
                className="visually-hidden"
                checked={style === s.id}
                onChange={() => setStyle(s.id)}
                disabled={busy}
              />
              <Scene look={s.id} />
              <span className="option-title">{s.name}</span>
              <span className="option-desc">{s.description}</span>
            </label>
          ))}
        </div>
      </section>

      {/* 3. Song */}
      <section className="step-block" aria-labelledby="step-song">
        <header className="step-head">
          <span className="step-num" aria-hidden="true">3</span>
          <div>
            <h2 id="step-song">Pick the song</h2>
            <p className="hint">The movie is cut to the beat of whichever song you choose.</p>
          </div>
        </header>
        <div className="option-row" role="radiogroup" aria-labelledby="step-song">
          <label className="option compact">
            <input
              type="radio"
              name="songMode"
              className="visually-hidden"
              checked={songMode === "ai"}
              onChange={() => setSongMode("ai")}
              disabled={busy}
            />
            <span className="option-title">Make a new song</span>
            <span className="option-desc">Lyrics are written from your photos.</span>
          </label>
          <label className="option compact">
            <input
              type="radio"
              name="songMode"
              className="visually-hidden"
              checked={songMode === "upload"}
              onChange={() => setSongMode("upload")}
              disabled={busy}
            />
            <span className="option-title">Use my own song</span>
            <span className="option-desc">MP3, M4A, AAC, or WAV, up to {SONG_LIMITS.maxMB} MB.</span>
          </label>
        </div>

        {songMode === "ai" ? (
          <div className="field-stack">
            <div className="field">
              <label htmlFor="mood">Mood</label>
              <select
                id="mood"
                className="select"
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                disabled={busy}
              >
                {MOODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="notes">Anything the song should mention? (optional)</label>
              <textarea
                id="notes"
                className="textarea"
                maxLength={500}
                placeholder="Names, places, or a feeling. For example: Maya’s 30th birthday by the lake."
                value={songNotes}
                onChange={(e) => setSongNotes(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="song">Song file</label>
            <input
              id="song"
              type="file"
              className="input"
              accept={SONG_LIMITS.types.join(",")}
              onChange={(e) => pickSong(e.target.files?.[0] ?? null)}
              disabled={busy}
            />
            {songFile && <span className="hint">Selected: {songFile.name}</span>}
          </div>
        )}
      </section>

      {/* 4. Format and title */}
      <section className="step-block" aria-labelledby="step-format">
        <header className="step-head">
          <span className="step-num" aria-hidden="true">4</span>
          <div>
            <h2 id="step-format">Set the format and title</h2>
            <p className="hint">The photo previews above show how each shot will be framed.</p>
          </div>
        </header>
        <div className="option-row" role="radiogroup" aria-labelledby="step-format">
          {ASPECTS.map((a) => (
            <label key={a.id} className="option compact aspect">
              <input
                type="radio"
                name="aspect"
                className="visually-hidden"
                checked={aspect === a.id}
                onChange={() => setAspect(a.id)}
                disabled={busy}
              />
              <span className="ratio-shape" style={SHAPE_SIZE[a.id]} aria-hidden="true" />
              <span>
                <span className="option-title">{a.name}</span>
                <span className="option-desc">{a.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="field">
          <label htmlFor="title">Title</label>
          <input
            id="title"
            className="input"
            maxLength={120}
            placeholder="Untitled movie"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
          />
        </div>
      </section>

      <div className="action-bar">
        <div className="action-inner">
          {message ? (
            <p className={`notice${message.kind === "error" ? " error" : ""}`} role="alert">
              {message.text}
            </p>
          ) : (
            <p className="summary">{summary}</p>
          )}
          <button type="button" className="btn btn-primary" onClick={handleCreate} disabled={busy}>
            {busy ? `Uploading ${doneCount} of ${photos.length}…` : "Create movie"}
          </button>
        </div>
      </div>
    </div>
  );
}
