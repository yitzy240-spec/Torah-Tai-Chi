/**
 * Thin server-only helper: fetch a single story by numeric ID.
 * Extracted so pages can import it without pulling in the full mapi client.
 */

const SPACE_ID = process.env.STORYBLOK_SPACE_ID!;
const MGMT_TOKEN = process.env.STORYBLOK_MANAGEMENT_TOKEN!;
const BASE = `https://mapi.storyblok.com/v1/spaces/${SPACE_ID}`;

export async function mapiGetStory(id: number) {
  const res = await fetch(`${BASE}/stories/${id}`, {
    headers: { Authorization: MGMT_TOKEN },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Story ${id} not found (${res.status})`);
  const data = await res.json();
  return data.story as {
    id: number;
    slug: string;
    full_slug: string;
    name: string;
    published: boolean;
    updated_at: string;
    content: Record<string, unknown>;
  };
}
