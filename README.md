# FrameSong

Turn photos into a short film with its own song. This build includes Day 1 (website, sign in, uploads) and Day 2 (AI director and photo redraws).

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

## Next: Day 3

Animation: each shot becomes a moving clip with an image-to-video model on fal.ai, using the motion Claude wrote, with a live progress view.
