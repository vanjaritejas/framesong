# FrameSong

Turn photos into a short film with its own song. This build includes Day 1 (website, sign in, uploads), Day 2 (AI director and photo redraws), Day 3 (animated clips), and Day 4 (the song and the edit).

**What works today:** home page, sign in with an email link, and a "New movie" builder where you add up to 20 photos, put them in order, choose a look (real nature, 3D animated, or cartoon), choose a song (a mood for a new song, or upload your own), choose a format (widescreen, vertical, or square), and save it all to private storage. You can see your movies, open each one, and delete them.

**Tech:** Next.js 16 (website), Supabase (login, database, file storage), Vercel (hosting), GitHub (code).

---

## Setup (about 30–45 minutes)

### 1. Install the tools

- **Node.js 22 LTS** from nodejs.org (Next.js 16 needs Node 20.9 or newer). Check with `node -v`.
- **Git** from git-scm.com. Check with `git --version`.
- A code editor, such as VS Code.

### 2. Create the Supabase project

1. Go to supabase.com, sign up, and create a **New project**. Save the database password somewhere safe.
2. Open **SQL Editor**, then **New query**. Paste everything from `supabase/schema.sql` and select **Run**. You should see "Success. No rows returned."
3. Open **Project Settings**, then **API Keys** (or **API** in older dashboards). Copy:
   - the **Project URL**
   - the **publishable key** (older projects call it the **anon public** key)
4. Open **Authentication**, then **URL Configuration**:
   - Site URL: `http://localhost:3000`
   - Redirect URLs: add `http://localhost:3000/**`

### 3. Run it on your computer

In a terminal, inside this folder:

```bash
npm install
cp .env.example .env.local        # Windows: copy .env.example .env.local
```

Open `.env.local` and paste your Project URL and publishable key. Then:

```bash
npm run dev
```

Open http://localhost:3000, sign in with your email, and make a test movie.

### 4. Put the code on GitHub

1. On github.com, create a new **empty** repository named `framesong` (private is a good choice). Don't add a README there.
2. In the terminal:

```bash
git init
git add .
git commit -m "Day 1: website, sign in, photo upload"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/framesong.git
git push -u origin main
```

Your keys stay on your computer: `.env.local` is listed in `.gitignore`, so Git never uploads it.

### 5. Put the website online with Vercel

1. Go to vercel.com and sign in with GitHub.
2. Select **Add New**, then **Project**, and import the `framesong` repository.
3. Under **Environment Variables**, add the same two values from `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
4. Select **Deploy**. You'll get a link like `https://framesong-abc123.vercel.app`.
5. Back in Supabase, open **Authentication**, then **URL Configuration**:
   - Change Site URL to your Vercel link.
   - Add `https://framesong-abc123.vercel.app/**` to Redirect URLs (keep the localhost one too).

From now on, every `git push` to `main` updates the live site automatically.

---

## Day 1 test checklist

- [ ] The sign-in email arrives and the link signs you in
- [ ] Create a movie with 5 photos, reorder them, pick Cartoon and Vertical
- [ ] The movie shows up in "Your movies" with a cover photo
- [ ] The movie page shows the photos in the right order
- [ ] Upload your own song on a second movie and play it on the movie page
- [ ] Delete a movie
- [ ] Sign out, then open `/studio`: you should land on the sign-in page
- [ ] Repeat the main steps on your phone using the Vercel link

---

## If something goes wrong

**"Missing Supabase settings"**
`.env.local` is empty or missing, or the Vercel environment variables weren't added. Fix them, then restart `npm run dev` or redeploy on Vercel.

**The sign-in link opens localhost when using the live site**
Update the Site URL and Redirect URLs in Supabase (step 5.5).

**"That sign-in link didn't work"**
Links expire and only work in the same browser that asked for them. Request a new link and open it in that browser.

**"Too many sign-in emails were sent"**
Supabase's built-in email sender is for testing and only sends a few emails per hour. Before real users sign up, connect your own email provider (such as Resend) in Supabase's Authentication settings under SMTP.

**"Your movies couldn't load"**
The database tables don't exist yet. Run `supabase/schema.sql` in the SQL Editor.

**Uploads fail with a "row-level security" message**
The schema didn't finish running, or you were signed out. Run the whole `schema.sql` file again (it's safe to re-run) and sign in again.

**iPhone photos (HEIC)**
The iPhone photo picker usually converts them to JPG automatically. If one is rejected, export it as JPG first.

---

## Project map

```
app/
  page.tsx                  Home page
  login/page.tsx            Sign in
  auth/callback/route.ts    Finishes the email sign-in
  auth/signout/route.ts     Sign out
  studio/layout.tsx         Header + sign-in check for all studio pages
  studio/page.tsx           Your movies
  studio/new/page.tsx       New movie
  studio/[id]/page.tsx      One movie
  studio/[id]/actions.ts    Delete a movie
  globals.css               All styles (light and dark mode)
components/
  NewMovieForm.tsx          The photo, look, song, and format builder
  LoginForm.tsx             Email sign-in form
  SiteHeader.tsx, Scene.tsx, DeleteMovieButton.tsx
lib/
  supabase/                 Supabase connections (browser, server, proxy)
  constants.ts              Looks, formats, moods, upload limits
  storage.ts                Private file links
proxy.ts                    Keeps people signed in, protects /studio
supabase/schema.sql         Database tables, security rules, storage bucket
```

Files are stored as `<user id>/<movie id>/<file>` in a private `uploads` bucket. Security rules make sure each person can only see and change their own movies and files.

---

## Day 2: the AI director

**What's new:** on each movie page, **Plan my movie** sends your photos to Claude. Claude picks the story order (you can turn this off), writes what moves in each shot, sets how long each shot plays, and writes an original song with lyrics. For **cartoon** and **3D animated** movies, every photo is then redrawn in that look by Google's Nano Banana 2 model on fal.ai, and the redrawn shots appear one by one. Big photos are also shrunk in the browser before upload now, so uploads are faster.

### Setup

1. **Anthropic API key:** sign in to the Claude Console (console.anthropic.com), open **API Keys**, and create a key. Add a little credit under **Billing**. A Claude.ai subscription doesn't include API credit.
2. **fal.ai key:** sign in at fal.ai, open **Keys** in the dashboard, create a key, and add a little credit under **Billing**.
3. Add both keys to `.env.local`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   FAL_KEY=...
   ```
4. Run `supabase/day2.sql` in the Supabase SQL Editor (it adds redraw tracking and the new statuses).
5. Run `npm install` (new packages: the Anthropic SDK, the fal.ai client, and sharp for resizing photos).
6. Restart the website with `npm run dev`.

When you deploy, add `ANTHROPIC_API_KEY` and `FAL_KEY` to Vercel's Environment Variables too.

### Day 2 test checklist

- [ ] Open a movie and select **Plan my movie**: within about a minute you see shots with motion notes and a song with lyrics
- [ ] A **Real nature** movie goes straight to "Plan ready" (no redrawing)
- [ ] A **Cartoon** or **3D animated** movie shows "Redrawing photos: 0 of N done," and redrawn shots appear one by one, with the original photo in the corner
- [ ] Turn off **Let Claude choose the photo order**, select **Plan again**, and the shots keep your order
- [ ] **Plan again** doesn't redraw photos that are already redrawn

### What it costs (roughly)

- Planning with Claude Sonnet: a few cents per plan.
- Redrawing (cartoon and 3D only): about $0.08 per photo at the "1K" setting, so a 10-photo movie is about $0.80. Real nature movies skip this.

To change quality and price, edit `RESTYLE_RESOLUTION` in `lib/restyle.ts` ("2K" is sharper and costs 1.5×) or `DIRECTOR_MODEL` in `lib/director.ts`.

### If something goes wrong (Day 2)

**"ANTHROPIC_API_KEY is missing" or "FAL_KEY is missing"**
The key isn't in `.env.local`, or the website wasn't restarted after adding it. Press Ctrl + C in the terminal, then run `npm run dev` again.

**"Your Anthropic account is out of API credits" / "Your fal.ai account is out of credit"**
Add credit in that service's Billing page, then try again.

**"An API key was rejected"**
A key was copied incompletely. Copy it again into `.env.local` and restart.

**Some photos say "Not redrawn"**
Select **Redraw N photos** on the movie page. The model occasionally refuses or fails on a single photo.

**A database error mentioning "style_status" or "check constraint"**
`supabase/day2.sql` hasn't been run yet.

### New files

```
lib/director.ts                     Sends photos to Claude and checks its plan
lib/restyle.ts                      Starts and collects redraws on fal.ai
lib/plan.ts                         The shape of a saved plan
lib/errors.ts, lib/server-env.ts    Friendly errors, secret key checks
app/api/movies/[id]/plan            Plans a movie (Claude), then starts redraws
app/api/movies/[id]/progress        Collects finished redraws
app/api/movies/[id]/restyle         Retries failed redraws
components/MoviePlanner.tsx         The planning panel on the movie page
supabase/day2.sql                   Database update for Day 2
```

---

## Day 3: animated clips

**What's new:** once a movie is planned (and, for cartoon and 3D, every photo is redrawn), **Animate movie** turns each shot into a short video clip with Google's Veo 3.1 Lite model on fal.ai. Each clip starts from the shot's image (the redrawn one for cartoon and 3D) and follows the motion Claude wrote. A progress bar counts the finished clips, and each one plays on the movie page. Clips are saved in your private Supabase storage.

### Setup

1. Run `supabase/day3.sql` in the Supabase SQL Editor (it adds clip tracking, the "Clips ready" status, and lets storage hold MP4 videos).
2. Restart the website with `npm run dev`. No new packages or keys are needed.

### Day 3 test checklist

- [ ] On a planned movie with 3 or 4 shots, select **Animate movie**: a box shows the clip count and estimated cost before anything is spent
- [ ] The panel shows "Animating shots: 0 of N done," and shots show **Animating…**
- [ ] Clips appear one by one (each takes a minute or two) and play on the movie page
- [ ] When all are done, the badge says **Clips ready**
- [ ] Leave the page while animating, come back, and it picks up where it left off
- [ ] If a shot says **Not animated**, **Try again** remakes only the failed shots
- [ ] **Plan again** asks before clearing the clips

### What it costs (roughly)

- Veo 3.1 Lite at 720p without audio: about $0.03 per second of video.
- Clips are 4, 6, or 8 seconds: each shot gets the shortest clip at least as long as the plan says, so the edit can cut it to the beat on Day 4. A 5-second shot becomes a 6-second clip (about $0.18).
- A 4-shot movie is usually under $1. A 20-shot movie can be up to about $4.80.

To change the model or quality, edit `VIDEO_MODEL` and `VIDEO_RESOLUTION` in `lib/animate.ts`, then update `VIDEO_PRICE_PER_SECOND` in `lib/video.ts` so the cost estimate stays right.

### If something goes wrong (Day 3)

**A database error mentioning "clip_request_id," "clip_seconds," or "check constraint"**
`supabase/day3.sql` hasn't been run yet. Run it, then try again.

**Clips are made but say "couldn't be saved," mentioning "mime type" or "size"**
Storage doesn't accept videos yet. Run `supabase/day3.sql`.

**Some shots say "Not animated"**
The video model sometimes refuses a picture (often a safety filter on faces) or fails once. Select **Try again**. If the same shot keeps failing, plan again or use a different photo.

**"Some photos aren't redrawn yet"**
Cartoon and 3D movies animate the redrawn photos. Select **Redraw N photos** first.

**Square movies**
Veo makes 16:9 and 9:16 clips, so square movies get 16:9 clips that the edit crops to square.

### New files

```
lib/video.ts                        Clip lengths and the cost estimate
lib/animate.ts                      Starts and collects video clips on fal.ai
app/api/movies/[id]/animate         Starts animating (or retries failed shots)
app/api/movies/[id]/clips           Collects finished clips into storage
supabase/day3.sql                   Database update for Day 3
```

---

## Day 4: the song and the edit

**What's new:** once the clips are made, **Make the movie** turns them into one finished video. For new-song movies, MiniMax Music 3 on fal.ai first sings Claude's lyrics at the plan's tempo, and every cut is a whole number of beats so the shots change on the beat. Movies with your own song use the shot lengths from the plan. Then FFmpeg, running on your own server (your computer while testing, Vercel when live), lines the clips up in order, trims each one, fills the frame for the movie's format, and lays the song underneath with a short fade at the end. If the song is shorter than the movie, the cuts are shortened a little so the movie ends with the song. The movie plays at the top of the movie page with a **Download the movie** button, and the new song gets its own player in the Song section.

### Setup

1. Run `supabase/day4.sql` in the Supabase SQL Editor (it adds song and edit tracking to movies).
2. Run `npm install`. It adds `ffmpeg-static`, which downloads the FFmpeg program used for the edit.
3. Restart the website with `npm run dev`.

### Day 4 test checklist

- [ ] On a movie with **Clips ready**, select **Make the movie**: a box shows the length and cost first
- [ ] A new-song movie shows "Making the song," then "Editing"; a your-own-song movie goes straight to "Editing"
- [ ] The finished movie appears at the top of the page and plays with the song
- [ ] **Download the movie** saves an MP4 named after the movie
- [ ] **Edit again** reuses the same song; **Make a new song** makes a fresh one
- [ ] **Plan again** asks before clearing the clips, the song, and the movie

### What it costs (roughly)

- The song: about $0.002 per second, so a 30-second song is about $0.06.
- The edit: free. It runs on your own server, not on fal.ai.

To change the music model, edit `SONG_MODEL` in `lib/edit.ts` and update `SONG_PRICE_PER_SECOND` in `lib/timeline.ts`.

### If something goes wrong (Day 4)

**A database error mentioning "song_status," "edit_status," or "edit_plan"**
`supabase/day4.sql` hasn't been run yet.

**"The song couldn't be made"**
The music model sometimes refuses lyrics or fails once. Select **Make the movie** again. If it keeps failing, select **Plan again** for new lyrics.

**"FFmpeg isn't installed"**
Stop the website (Ctrl + C), run `npm install`, and start it again with `npm run dev`.

**"The finished movie is bigger than 50 MB"**
Supabase's free plan stores files up to 50 MB. Try a movie with fewer shots.

**The edit stops partway on the live site**
Editing happens while the movie page is open, so keep it open until the movie appears.

**The cuts don't line up perfectly with your own song**
For your own songs, FrameSong doesn't know the tempo yet, so cuts follow the plan's shot lengths.

**Square movies**
The clips are 16:9, so square movies are cropped from the middle of each clip.

### New files

```
lib/timeline.ts                     Cut lengths on the beat, and the cost estimate
lib/edit.ts                         Makes the song on fal.ai
lib/render.ts                       Makes the finished movie with FFmpeg on your server
app/api/movies/[id]/edit            Starts the song and the edit
app/api/movies/[id]/edit-progress   Follows the song, runs the edit, and saves the movie
supabase/day4.sql                   Database update for Day 4
```

---

## Next: Day 5

4K: the finished movie is upscaled to 4K for a sharp download.
