# FrameSong

Turn photos into a short film with its own song. This is the Day 1 build.

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

## Next: Day 2

The AI director: Claude looks at the photos, suggests the best order, writes the camera motion for each shot, and writes song lyrics that fit the story. Cartoon and 3D looks get their redraw step.

Have these ready:

- An Anthropic API key (console.anthropic.com)
- A fal.ai API key (fal.ai), with a small amount of credit for testing
