'use server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { revalidatePath } from 'next/cache';

/**
 * Hard-delete a plan clip from a clips-only / plan-only job.
 *
 * Steps:
 * 1. Auth check.
 * 2. Load the clip row to know its index, job_id, and storage_path.
 * 3. Delete the rendered mp4 from Storage if storage_path is set.
 * 4. Hard-delete the clip row.
 * 5. Re-index remaining clips: shift every clip with index > deleted down by 1.
 * 6. Revalidate paths.
 *
 * Auth-checks via user cookie; writes via service role (clips table has
 * "authed read" RLS only, writes silently match 0 rows without service role).
 */
export async function removePlanClip(
  clipId: string,
  parshaSlug: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const svc = createServiceClient();

  // 1. Fetch the clip so we know its index, job, and storage path.
  const { data: clip, error: fetchErr } = await svc
    .from('clips')
    .select('id, index, job_id, storage_path')
    .eq('id', clipId)
    .maybeSingle();

  if (fetchErr) return { ok: false, error: fetchErr.message };
  if (!clip) return { ok: false, error: 'Clip not found' };

  const { index: clipIndex, job_id: jobId, storage_path: storagePath } = clip;

  // 2. Delete the rendered mp4 from Storage if it exists.
  if (storagePath) {
    const { error: storageErr } = await svc.storage.from('videos').remove([storagePath]);
    if (storageErr) {
      // Non-fatal: log but continue — the row delete still removes the
      // plan entry even if the Storage cleanup fails (e.g. already gone).
      console.warn(
        `[removePlanClip] Storage delete failed for ${storagePath}: ${storageErr.message}`,
      );
    }
  }

  // 3. Hard-delete the clip row.
  const { error: deleteErr } = await svc.from('clips').delete().eq('id', clipId);
  if (deleteErr) return { ok: false, error: deleteErr.message };

  // 4. Re-index remaining clips: shift every clip with index > deleted by -1.
  //    This keeps the sequence contiguous (0, 1, 2, … n-1).
  const { error: reindexErr } = await svc.rpc('shift_clip_indexes_after_delete', {
    p_job_id: jobId,
    p_deleted_index: clipIndex,
  });

  if (reindexErr) {
    // Fallback: do it with a raw update if the RPC isn't present.
    // The RPC is safer (atomic) but the fallback keeps the action working
    // even if the RPC hasn't been deployed yet.
    const { data: remaining } = await svc
      .from('clips')
      .select('id, index')
      .eq('job_id', jobId)
      .gt('index', clipIndex)
      .order('index');

    if (remaining && remaining.length > 0) {
      for (const r of remaining) {
        await svc
          .from('clips')
          .update({ index: (r.index as number) - 1 })
          .eq('id', r.id);
      }
    }
  }

  revalidatePath('/', 'layout');
  revalidatePath(`/videos/${parshaSlug}`, 'layout');

  return { ok: true };
}
