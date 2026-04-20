import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  expandPrompt,
  createKieImageTask,
  pollKieImageTask,
  REFERENCE_ASSETS,
  type ReferenceKind,
  type AspectRatio,
} from '@/lib/ai-image';
import { logEvent } from '@/lib/events';

export const dynamic = 'force-dynamic';

/**
 * POST /api/compose/generate-image
 * Body: {
 *   userPrompt: string,
 *   reference?: { kind: 'rav-eli' | 'logo' | 'custom' | 'none', url?: string },
 *   feedback?: string,          // when iterating
 *   previousPrompt?: string,    // ditto
 *   aspectRatio?: '1:1' | '9:16' | '16:9',
 * }
 * Response: { taskId, expandedPrompt }
 *
 * Claude expansion + Kie task creation run synchronously (~5s total).
 * The client polls GET with the taskId until state=success.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: {
    userPrompt?: string;
    reference?: { kind?: ReferenceKind; url?: string };
    feedback?: string;
    previousPrompt?: string;
    aspectRatio?: AspectRatio;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const userPrompt = body.userPrompt?.trim();
  if (!userPrompt) return NextResponse.json({ error: 'userPrompt is required' }, { status: 400 });

  const refKind: ReferenceKind = body.reference?.kind ?? 'none';
  let referenceUrl: string | undefined;
  if (refKind === 'rav-eli' || refKind === 'logo') {
    referenceUrl = REFERENCE_ASSETS[refKind];
  } else if (refKind === 'custom') {
    if (!body.reference?.url) return NextResponse.json({ error: 'custom reference requires url' }, { status: 400 });
    referenceUrl = body.reference.url;
  }

  try {
    const expandedPrompt = await expandPrompt({
      userPrompt,
      hasReference: !!referenceUrl,
      feedback: body.feedback,
      previousPrompt: body.previousPrompt,
    });

    const taskId = await createKieImageTask({
      expandedPrompt,
      referenceUrls: referenceUrl ? [referenceUrl] : undefined,
      aspectRatio: body.aspectRatio ?? '1:1',
    });

    await logEvent({
      actor: 'ai-image',
      level: 'info',
      event: 'compose.image.start',
      subjectType: 'kie_task',
      subjectId: taskId,
      message: `Image generation started (task ${taskId})`,
      details: {
        referenceKind: refKind,
        aspectRatio: body.aspectRatio ?? '1:1',
        iterating: !!body.feedback,
      },
    });

    return NextResponse.json({ taskId, expandedPrompt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logEvent({
      actor: 'ai-image',
      level: 'error',
      event: 'compose.image.start.error',
      message: `Image generation start failed: ${msg}`,
      details: {
        referenceKind: refKind,
        aspectRatio: body.aspectRatio ?? '1:1',
        userPromptPreview: userPrompt.slice(0, 200),
        error: msg,
      },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/compose/generate-image?taskId=…
 * Response: { state: 'pending' | 'success' | 'failed', url?, error? }
 *
 * On success, the image is mirrored to Supabase Storage keyed by the
 * taskId; subsequent polls are idempotent.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('taskId');
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 });

  try {
    const result = await pollKieImageTask(taskId);
    if (result.state === 'failed') {
      await logEvent({
        actor: 'ai-image',
        level: 'error',
        event: 'compose.image.poll.failed',
        subjectType: 'kie_task',
        subjectId: taskId,
        message: `Image generation failed: ${result.error ?? 'unknown'}`,
        details: { taskId, error: result.error ?? null },
      });
    }
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logEvent({
      actor: 'ai-image',
      level: 'error',
      event: 'compose.image.poll.error',
      subjectType: 'kie_task',
      subjectId: taskId,
      message: `Image poll threw: ${msg}`,
      details: { taskId, error: msg },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
