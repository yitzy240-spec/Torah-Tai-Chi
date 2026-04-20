# Torah Tai Chi — Website Deploy Checklist

## 1. Create Vercel Project

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import from GitHub — select the `torah-tai-chi` repo
3. Set **Root Directory** to `website/`
4. Framework: Next.js (auto-detected)
5. Build command: `npm run build` (or leave default)
6. Output directory: `out` (or leave default — Vercel reads `vercel.json`)

## 2. Set Environment Variables

In Vercel project → **Settings → Environment Variables**, add:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL (`https://jswdfthmegjbhnwbgeca.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon public key |

Apply to: **Production**, **Preview**, and **Development**.

## 3. Set Custom Domain

1. Vercel project → **Settings → Domains**
2. Add `torahtaichi.com` and `www.torahtaichi.com`
3. Update your DNS at your registrar to point to Vercel's nameservers (or add the CNAME/A records Vercel provides)
4. Vercel will auto-provision SSL

## 4. Set Up a Deploy Hook

1. Vercel project → **Settings → Git → Deploy Hooks**
2. Create a hook named `Content Update` for the `main` branch
3. Copy the webhook URL
4. Add this URL to the dashboard so content changes (new articles, toggling `book.visible`, etc.) trigger a fresh build and deploy

## 5. Enable the Book Page

When the book is ready to announce:

1. Go to the dashboard → Site Content
2. Set `book.visible` to `true`
3. Trigger a redeploy (or use the Deploy Hook from step 4)
4. The `/book` page, and the "Book" nav link, will appear automatically

## 6. OG Image Note

The default OG image is a placeholder at `public/og/default.png`. Before launch, replace it with a real 1200×630 PNG using the Torah Tai Chi brand mark on a linen background.

Dynamic parsha and article OG images are generated at build time via Next.js route handlers (`/og/parsha/[slug]` and `/og/article/[slug]`).
