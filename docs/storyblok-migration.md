# Storyblok Migration Notes

Content is now stored in **Storyblok** (space: Torah Tai Chi, ID `291966442816972`).
The custom dashboard at `/dashboard` is the only UI Yonah uses — it's a wrapper
that calls Storyblok's API; Yonah never logs into Storyblok.

---

## Tokens

| Token | Variable | Where it goes | Can ship to browser? |
|---|---|---|---|
| Preview token | `STORYBLOK_PREVIEW_TOKEN` | `website/.env.local` → Vercel env | Yes (read-only CDN) |
| Management token | `STORYBLOK_MANAGEMENT_TOKEN` | `dashboard/.env.local` → Vercel env (server only) | **No** — write access |
| Space ID | `STORYBLOK_SPACE_ID` | both apps | Yes |

---

## Content types (components)

| Component | Folder in Storyblok | Used by |
|---|---|---|
| `article` | `articles/` | Dashboard + website articles pages |
| `site_text` | `site-text/` | Dashboard site-content editor + all website pages |
| `book` | `book-folder/` | (future — book data currently lives as `book.*` site_text entries) |

---

## How to add a new article

**Via dashboard** (recommended for Yonah):
1. Go to `/articles` → click **+ New article**
2. Fill title, body, category, etc.
3. Click **Publish** — story appears on website within ~60 s (ISR revalidation)

**Directly in Storyblok** (for admins):
1. Open space → Content → articles folder → Create story
2. Choose `article` component
3. Fill fields and publish

---

## How to add or edit a site_text key

**Via dashboard**:
1. Go to `/site-content`
2. Find the field, edit, click **Save**

**Directly in Storyblok**:
1. Open space → Content → site-text folder
2. Find the story whose slug matches the key (dots replaced by hyphens, e.g. `home-hero-title`)
3. Edit the `value` field and publish

**To add a brand-new key** (admins only):
1. In Storyblok create a new story in the `site-text` folder with component `site_text`
2. Set `key` (e.g. `home.new.thing`) and `value`
3. Publish
4. Reference `c['home.new.thing']` in the website code

---

## Architecture note

- **Website** (`website/`) uses the **Content Delivery API** (`api.storyblok.com/v2/cdn`) with the preview token. Stories are ISR-cached for 60 seconds.
- **Dashboard** (`dashboard/`) uses the **Management API** (`mapi.storyblok.com/v1/spaces/…`) with the management token. Only runs server-side (Next.js Server Components + Route Handlers). Token is never in any client bundle.
- Supabase tables `articles` and `site_content` were dropped in migration `drop_cms_tables` (April 2026). Supabase is still used for videos, jobs, channels, and analytics.

---

## Vercel deploy checklist

When deploying website to Vercel, add these env vars in the Vercel dashboard:

```
STORYBLOK_PREVIEW_TOKEN=QMurQlRJiXH4Olb9r6mhewtt
STORYBLOK_SPACE_ID=291966442816972
```

Do **not** add `STORYBLOK_MANAGEMENT_TOKEN` to the website — only to the dashboard.
