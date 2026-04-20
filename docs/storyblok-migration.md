# Storyblok Integration

## ISR Webhook Setup

The website uses Incremental Static Regeneration (ISR). Pages revalidate automatically every 60 seconds (300 s for individual parsha pages). For instant propagation when you publish a story in Storyblok, configure a webhook.

### Step-by-step

1. In Storyblok, go to **Space Settings → Webhooks**.
2. Click **Add webhook**.
3. Set **Trigger** to `Stories published`.
4. Set **Endpoint URL** to:
   ```
   https://torahtaichi.com/api/revalidate
   ```
5. Under **Signing secret**, paste the value of your `STORYBLOK_WEBHOOK_SECRET` env var.
6. Save.

### Environment variable

In **Vercel → Settings → Environment Variables**, add:

| Key | Value |
|---|---|
| `STORYBLOK_WEBHOOK_SECRET` | A long random string (e.g. `openssl rand -hex 32`) |

Use the same value in both Storyblok and Vercel.

### What gets revalidated

| Story type | Pages cleared |
|---|---|
| `articles/*` | `/articles/[slug]`, `/articles`, `/` |
| `site-text/*` | Entire site layout (`/`) |
| `book-folder/*` | Entire site layout (`/`) |
| Anything else | The matching path |

Changes are live within ~30 seconds of clicking Publish in Storyblok.
