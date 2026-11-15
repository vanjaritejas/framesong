-- FrameSong Day 3: animated clips
-- Run once in Supabase: SQL Editor > New query > paste this whole file > Run.
-- Safe to run again.

-- Track the video clip for each shot
alter table public.project_images
  add column if not exists clip_path text,
  add column if not exists clip_status text not null default 'pending',
  add column if not exists clip_request_id text,
  add column if not exists clip_seconds int,
  add column if not exists clip_error text;

alter table public.project_images
  drop constraint if exists project_images_clip_status_check;
alter table public.project_images
  add constraint project_images_clip_status_check
  check (clip_status in ('pending', 'queued', 'running', 'done', 'failed'));

-- New movie status: "animated" (every clip is made)
alter table public.projects
  drop constraint if exists projects_status_check;
alter table public.projects
  add constraint projects_status_check
  check (status in ('draft', 'directing', 'styling', 'planned', 'generating', 'animated',
                    'editing', 'preview_ready', 'rendering_4k', 'done', 'failed'));

-- Let the private storage bucket hold video clips (50 MB max per file, the free plan limit)
update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp',
      'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac',
      'audio/wav', 'audio/x-wav',
      'video/mp4'
    ]
where id = 'uploads';
