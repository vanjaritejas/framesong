-- FrameSong Day 2: AI director and photo redraws
-- Run once in Supabase: SQL Editor > New query > paste this whole file > Run.
-- Safe to run again.

-- Track the cartoon / 3D redraw of each photo
alter table public.project_images
  add column if not exists style_request_id text,
  add column if not exists style_status text not null default 'none';

alter table public.project_images
  drop constraint if exists project_images_style_status_check;
alter table public.project_images
  add constraint project_images_style_status_check
  check (style_status in ('none', 'queued', 'running', 'done', 'failed'));

-- New movie statuses: "styling" (redrawing photos) and "planned" (plan ready)
alter table public.projects
  drop constraint if exists projects_status_check;
alter table public.projects
  add constraint projects_status_check
  check (status in ('draft', 'directing', 'styling', 'planned', 'generating',
                    'editing', 'preview_ready', 'rendering_4k', 'done', 'failed'));
