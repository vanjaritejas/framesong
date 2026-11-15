-- FrameSong database setup
-- Run once in Supabase: SQL Editor > New query > paste this whole file > Run.
-- Safe to run again: it skips or replaces what already exists.
-- Already ran an older version of this file? Also run day2.sql.

-- ─────────────────────────────────────────────
-- Movies
-- ─────────────────────────────────────────────
create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title         text not null default 'Untitled movie' check (char_length(title) <= 120),
  style         text not null check (style in ('real_nature', 'animated_3d', 'cartoon')),
  aspect_ratio  text not null default '16:9' check (aspect_ratio in ('16:9', '9:16', '1:1')),
  song_mode     text not null default 'ai' check (song_mode in ('ai', 'upload')),
  song_mood     text,
  song_notes    text check (song_notes is null or char_length(song_notes) <= 500),
  song_path     text,                 -- the user's own song file, if they uploaded one
  status        text not null default 'draft' check (
                  status in ('draft', 'directing', 'styling', 'planned', 'generating',
                             'editing', 'preview_ready', 'rendering_4k', 'done', 'failed')
                ),
  director_plan jsonb,                -- Day 2: scene order, motion prompts, lyrics
  preview_path  text,                 -- Day 4: 1080p preview video
  final_path    text,                 -- Day 5: 4K video
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- Photos in each movie (one row per photo, in play order)
-- ─────────────────────────────────────────────
create table if not exists public.project_images (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  storage_path  text not null,
  position      int  not null,
  width         int,
  height        int,
  styled_path   text,                 -- Day 2: cartoon / 3D version of the photo
  style_request_id text,              -- Day 2: fal.ai job for the redraw
  style_status  text not null default 'none' check (
                  style_status in ('none', 'queued', 'running', 'done', 'failed')
                ),
  motion_prompt text,                 -- Day 2: what moves in this shot
  clip_path     text,                 -- Day 3: the animated clip
  clip_status   text not null default 'pending' check (
                  clip_status in ('pending', 'queued', 'running', 'done', 'failed')
                ),
  created_at    timestamptz not null default now()
);

create index if not exists projects_user_created_idx
  on public.projects (user_id, created_at desc);
create index if not exists project_images_project_position_idx
  on public.project_images (project_id, position);

-- Keep updated_at current
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────
-- Row level security: people only see their own movies and photos
-- ─────────────────────────────────────────────
alter table public.projects enable row level security;
alter table public.project_images enable row level security;

drop policy if exists "Users manage their own movies" on public.projects;
create policy "Users manage their own movies"
  on public.projects for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage photos in their own movies" on public.project_images;
create policy "Users manage photos in their own movies"
  on public.project_images for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = (select auth.uid())
    )
  );

-- ─────────────────────────────────────────────
-- Private storage bucket for photos and songs (25 MB max per file)
-- Files live at:  <user id>/<movie id>/<file>
-- ─────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'uploads', 'uploads', false, 26214400,
  array[
    'image/jpeg', 'image/png', 'image/webp',
    'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac',
    'audio/wav', 'audio/x-wav'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Upload to own folder" on storage.objects;
create policy "Upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Read own files" on storage.objects;
create policy "Read own files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Replace own files" on storage.objects;
create policy "Replace own files"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Delete own files" on storage.objects;
create policy "Delete own files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
