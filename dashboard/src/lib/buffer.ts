const BUFFER_API = 'https://api.bufferapp.com/1';

export type BufferProfile = {
  id: string;
  service: string;       // 'tiktok' | 'instagram' | 'youtube' | 'facebook'
  service_username: string;
  formatted_service: string;
};

export async function listProfiles(token: string): Promise<BufferProfile[]> {
  const r = await fetch(`${BUFFER_API}/profiles.json?access_token=${token}`);
  if (!r.ok) throw new Error(`Buffer profiles: ${r.status}`);
  return r.json();
}

export type CreateUpdateArgs = {
  token: string;
  profileIds: string[];
  text: string;           // caption
  mediaUrl?: string;      // public video URL
  scheduledAt?: Date;     // if omitted, posts to queue
};

export async function createUpdate(a: CreateUpdateArgs): Promise<{ id: string; status: string }> {
  const body = new URLSearchParams();
  body.set('access_token', a.token);
  for (const pid of a.profileIds) body.append('profile_ids[]', pid);
  body.set('text', a.text);
  if (a.mediaUrl) body.set('media[video]', a.mediaUrl);
  if (a.scheduledAt) body.set('scheduled_at', Math.floor(a.scheduledAt.getTime() / 1000).toString());
  const r = await fetch(`${BUFFER_API}/updates/create.json`, {
    method: 'POST',
    body,
  });
  if (!r.ok) throw new Error(`Buffer createUpdate: ${r.status} ${await r.text()}`);
  return r.json();
}
