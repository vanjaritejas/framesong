-- FrameSong Day 4: the song and the edit
-- Run once in Supabase: SQL Editor > New query > paste this whole file > Run.
-- Safe to run again.

alter table public.projects
  add column if not exists song_status text not null default 'none',
  add column if not exists song_request_id text,
  add column if not exists ai_song_path text,
  add column if not exists ai_song_seconds real,
  add column if not exists edit_status text not null default 'none',
  add column if not exists edit_request_id text,
  add column if not exists edit_plan jsonb,
  add column if not exists preview_path text,
  add column if not exists preview_url text;

alter table public.projects
  drop constraint if exists projects_song_status_check;
alter table public.projects
  add constraint projects_song_status_check
  check (song_status in ('none', 'queued', 'running', 'done', 'failed'));

alter table public.projects
  drop constraint if exists projects_edit_status_check;
alter table public.projects
  add constraint projects_edit_status_check
  check (edit_status in ('none', 'queued', 'running', 'done', 'failed'));
