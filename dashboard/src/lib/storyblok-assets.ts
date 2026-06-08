/**
 * Upload a file to Storyblok assets via the Management API and return its public
 * CDN URL. Server-only — uses STORYBLOK_MANAGEMENT_TOKEN / STORYBLOK_SPACE_ID.
 *
 * Flow (verified against Storyblok Management API docs):
 *  1. POST /spaces/{id}/assets/  { filename, size } -> { id, post_url, fields{} }
 *  2. POST post_url  (multipart/form-data: every `fields` entry, then `file` LAST) -> S3 stores it
 *  3. GET  /spaces/{id}/assets/{id}/finish_upload   -> Storyblok finalizes (mime/size)
 *  Public URL = https://a.storyblok.com/{fields.key}
 */
import { sanitizeAssetFilename } from './asset-filename';

const SPACE_ID = process.env.STORYBLOK_SPACE_ID!;
const MGMT_TOKEN = process.env.STORYBLOK_MANAGEMENT_TOKEN!;
const MAPI = `https://mapi.storyblok.com/v1/spaces/${SPACE_ID}`;

export async function uploadAsset(file: File): Promise<string> {
  const filename = sanitizeAssetFilename(file.name || 'image');
  const buf = Buffer.from(await file.arrayBuffer());

  // 1. sign
  const signRes = await fetch(`${MAPI}/assets/`, {
    method: 'POST',
    headers: { Authorization: MGMT_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, size: buf.length }),
  });
  if (!signRes.ok) throw new Error(`Storyblok sign failed: ${signRes.status} ${await signRes.text()}`);
  const signed = await signRes.json() as { id: number; post_url: string; fields: Record<string, string> };

  // 2. upload to S3 — fields first, file LAST
  const form = new FormData();
  for (const [k, v] of Object.entries(signed.fields)) form.append(k, v);
  form.append('file', new Blob([buf], { type: file.type || 'application/octet-stream' }), filename);
  const s3Res = await fetch(signed.post_url, { method: 'POST', body: form });
  if (!s3Res.ok && s3Res.status !== 204) throw new Error(`S3 upload failed: ${s3Res.status}`);

  // 3. finalize
  const finRes = await fetch(`${MAPI}/assets/${signed.id}/finish_upload`, {
    method: 'GET',
    headers: { Authorization: MGMT_TOKEN },
  });
  if (!finRes.ok) throw new Error(`Storyblok finish failed: ${finRes.status}`);

  return `https://a.storyblok.com/${signed.fields.key}`;
}
