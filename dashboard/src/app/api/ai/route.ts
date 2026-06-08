import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { callClaude } from '@/lib/claude';
import { buildAiPrompt, AI_TASKS, type AiTask } from '@/lib/ai-prompts';

// Sonnet 4.6 — verified on openrouter.ai/api/v1/models 2026-06-08 ($3/$15 per M).
// Cheaper + faster than the script tools' Opus default; ample for these short tasks.
const AI_MODEL = 'anthropic/claude-sonnet-4.6';

export async function POST(req: NextRequest) {
  const { response: authResponse } = await requireAuth();
  if (authResponse) return authResponse;

  let body: { task?: string; articleText?: string; selectionText?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const task = body.task as AiTask;
  if (!AI_TASKS.includes(task)) {
    return NextResponse.json({ error: `Unknown task: ${String(body.task)}` }, { status: 400 });
  }

  const { system, user, maxTokens } = buildAiPrompt(task, {
    articleText: body.articleText,
    selectionText: body.selectionText,
  });

  // Guard: edit tasks need a selection; generation tasks need article text.
  const needsSelection = task === 'improve' || task === 'shorten' || task === 'fix-grammar';
  if (needsSelection && !(body.selectionText ?? '').trim()) {
    return NextResponse.json({ error: 'No text selected' }, { status: 400 });
  }
  if (!needsSelection && !(body.articleText ?? '').trim()) {
    return NextResponse.json({ error: 'The article is empty — add some text first' }, { status: 400 });
  }

  try {
    const text = await callClaude({ systemPrompt: system, userPrompt: user, model: AI_MODEL, maxTokens });
    return NextResponse.json({ text: text.trim() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'AI request failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
