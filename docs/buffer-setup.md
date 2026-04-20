# Buffer Setup

Buffer schedules Torah Tai Chi videos to TikTok, Instagram, YouTube, and Facebook.

## Steps

### 1. Sign up for Buffer Essentials

Go to https://buffer.com/pricing and sign up for the **Essentials** plan (~$12/month).
This covers 4 social channels.

### 2. Connect your social accounts

Inside Buffer's dashboard, connect:
- TikTok
- Instagram
- YouTube
- Facebook

### 3. Create a Buffer app

1. Go to https://buffer.com/developers/apps
2. Click **Create an App**
3. Name it: **Torah Tai Chi**
4. Note down your **Access Token**

### 4. Add to .env

In `dashboard/.env.local` (or `.env` / Vercel environment variables):

```
BUFFER_ACCESS_TOKEN=your_token_here
```

Then restart your dev server or trigger a Vercel redeploy.

### 5. Verify

Go to Channels in the dashboard — connected accounts should now show real usernames instead of "Not connected".

## Notes

- The current integration uses a static access token (no OAuth flow). This is suitable for a single-owner dashboard.
- The OAuth flow (for multi-user) is deferred to a future phase.
- Buffer's free tier does not support scheduling — Essentials or higher is required.
