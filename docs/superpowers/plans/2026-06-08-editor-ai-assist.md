# Editor AI Assist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-click AI help in the article editor — generate SEO title/description + excerpt, and Improve/Shorten/Fix-grammar on selected text — reusing the existing OpenRouter client, without inventing facts and without blocking save/publish.

**Architecture:** One authed `/api/ai` route dispatches by `task` to a pure prompt builder, then calls the existing `callClaude` helper with a pinned Sonnet model. Two pure helpers (`tiptap-text`, `ai-prompts`) are unit-tested. The article form gets ✨ Generate on SEO title/description/excerpt (fill-empty / confirm-before-replace); the editor bubble menu gets a ✨ menu that rewrites the selection in place.

**Tech Stack:** Next.js (dashboard), TipTap v3.26, OpenRouter via `dashboard/src/lib/claude.ts` (`callClaude`), model `anthropic/claude-sonnet-4.6` (verified on openrouter.ai/api/v1/models 2026-06-08, $3/$15 per M), Node `node --test` for unit tests.

**Gates (both, every task that compiles):** `npx tsc --noEmit -p dashboard/tsconfig.json` AND `npm run build` in `dashboard/`. CI runs a bare `tsc` over `*.test.ts` — keep tests typed (dashboard tsconfig has `allowImportingTsExtensions`).

---

## File structure

| File | Responsibility | Action |
|------|----------------|--------|
| `dashboard/src/lib/tiptap-text.ts` | pure `tiptapJsonToText(doc)` → plain text | Create |
| `dashboard/src/lib/tiptap-text.test.ts` | unit tests | Create |
| `dashboard/src/lib/ai-prompts.ts` | pure `buildAiPrompt(task, {articleText, selectionText})` → `{system,user,maxTokens}` + `AI_TASKS` | Create |
| `dashboard/src/lib/ai-prompts.test.ts` | unit tests | Create |
| `dashboard/src/app/api/ai/route.ts` | authed POST, task dispatch → `callClaude` | Create |
| `dashboard/src/components/article-form.tsx` | ✨ Generate on SEO title/description/excerpt + fill/confirm | Modify |
| `dashboard/src/components/article-editor.tsx` | ✨ menu in bubble menu → rewrite selection | Modify |

No new deps. No env changes (reuses `OPENROUTER_API_KEY`).

---

## Task 1: `tiptapJsonToText` (plain text from body JSON)

**Files:** Create `dashboard/src/lib/tiptap-text.ts`, `dashboard/src/lib/tiptap-text.test.ts`

- [ ] **Step 1: Failing test.** Create `dashboard/src/lib/tiptap-text.test.ts`:

```ts
// Run: node --test --experimental-strip-types src/lib/tiptap-text.test.ts  (from dashboard/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tiptapJsonToText } from './tiptap-text.ts';

const p = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });

test('joins block text with newlines', () => {
  const doc = { type: 'doc', content: [p('First.'), p('Second.')] };
  assert.equal(tiptapJsonToText(doc), 'First.\nSecond.');
});

test('headings and nested marks render as text', () => {
  const doc = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
    { type: 'paragraph', content: [
      { type: 'text', text: 'a ' },
      { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
    ] },
  ] };
  assert.equal(tiptapJsonToText(doc), 'Title\na bold');
});

test('list items are separate lines', () => {
  const doc = { type: 'doc', content: [
    { type: 'bulletList', content: [
      { type: 'listItem', content: [p('one')] },
      { type: 'listItem', content: [p('two')] },
    ] },
  ] };
  assert.equal(tiptapJsonToText(doc), 'one\ntwo');
});

test('null / non-object / empty doc returns empty string', () => {
  assert.equal(tiptapJsonToText(null), '');
  assert.equal(tiptapJsonToText(undefined), '');
  assert.equal(tiptapJsonToText({ type: 'doc', content: [] }), '');
});
```

- [ ] **Step 2: Run, verify fail.** `cd dashboard && node --test --experimental-strip-types src/lib/tiptap-text.test.ts`

- [ ] **Step 3: Implement.** Create `dashboard/src/lib/tiptap-text.ts`:

```ts
/**
 * Flatten a TipTap/ProseMirror doc to plain text for AI prompts.
 * Text nodes are concatenated; block-level nodes are separated by newlines.
 * Resilient to null/odd input.
 */
const BLOCK = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'tableHeader', 'tableCell']);

export function tiptapJsonToText(doc: unknown): string {
  const out: string[] = [];
  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (n.type === 'text' && typeof n.text === 'string') { out.push(n.text); return; }
    if (Array.isArray(n.content)) n.content.forEach(walk);
    if (n.type && BLOCK.has(n.type)) out.push('\n');
  }
  walk(doc);
  return out.join('').replace(/\n{2,}/g, '\n').trim();
}
```

- [ ] **Step 4: Run, verify pass (4/4).**

- [ ] **Step 5: Commit.**

```bash
git add dashboard/src/lib/tiptap-text.ts dashboard/src/lib/tiptap-text.test.ts
git commit -m "feat(dashboard): tiptapJsonToText helper for AI prompts"
```

---

## Task 2: `ai-prompts` (pure task → prompt builder)

**Files:** Create `dashboard/src/lib/ai-prompts.ts`, `dashboard/src/lib/ai-prompts.test.ts`

- [ ] **Step 1: Failing test.** Create `dashboard/src/lib/ai-prompts.test.ts`:

```ts
// Run: node --test --experimental-strip-types src/lib/ai-prompts.test.ts  (from dashboard/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAiPrompt, AI_TASKS } from './ai-prompts.ts';

test('AI_TASKS lists the six supported tasks', () => {
  assert.deepEqual([...AI_TASKS].sort(), ['excerpt', 'fix-grammar', 'improve', 'seo-description', 'seo-title', 'shorten']);
});

test('every task prompt forbids inventing facts and returns only the text', () => {
  for (const task of AI_TASKS) {
    const built = buildAiPrompt(task, { articleText: 'Body text here.', selectionText: 'A sentence to edit.' });
    assert.match(built.system, /never invent|do not invent|only.*provided/i);
    assert.ok(built.maxTokens > 0);
    assert.ok(built.user.length > 0);
  }
});

test('seo/excerpt tasks use articleText; edit tasks use selectionText', () => {
  const seo = buildAiPrompt('seo-description', { articleText: 'UNIQUE_ARTICLE', selectionText: 'sel' });
  assert.match(seo.user, /UNIQUE_ARTICLE/);
  const imp = buildAiPrompt('improve', { articleText: 'art', selectionText: 'UNIQUE_SELECTION' });
  assert.match(imp.user, /UNIQUE_SELECTION/);
});

test('seo-title constrains length (~60 chars)', () => {
  const t = buildAiPrompt('seo-title', { articleText: 'x' });
  assert.match(t.system, /60/);
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement.** Create `dashboard/src/lib/ai-prompts.ts`:

```ts
export const AI_TASKS = ['seo-title', 'seo-description', 'excerpt', 'improve', 'shorten', 'fix-grammar'] as const;
export type AiTask = (typeof AI_TASKS)[number];

const PREAMBLE =
  'You are an editorial assistant for a calm, contemplative blog about Torah and internal ' +
  'martial arts. Match that measured, sincere voice — no hype, no clichés, no emoji. ' +
  'Work ONLY from the text provided: never invent quotes, sources, citations, names, or facts. ' +
  'Return ONLY the requested text — no preamble, no surrounding quotation marks, no markdown.';

interface Built { system: string; user: string; maxTokens: number; }

export function buildAiPrompt(
  task: AiTask,
  input: { articleText?: string; selectionText?: string },
): Built {
  const article = (input.articleText ?? '').slice(0, 12000);
  const selection = (input.selectionText ?? '').slice(0, 4000);
  switch (task) {
    case 'seo-title':
      return {
        system: `${PREAMBLE} Write an SEO page title for this article: compelling, specific, at most 60 characters.`,
        user: `Article:\n${article}`,
        maxTokens: 64,
      };
    case 'seo-description':
      return {
        system: `${PREAMBLE} Write an SEO meta description for this article: one sentence, roughly 140-155 characters, inviting and accurate.`,
        user: `Article:\n${article}`,
        maxTokens: 96,
      };
    case 'excerpt':
      return {
        system: `${PREAMBLE} Write a 1-2 sentence excerpt that summarizes this article for a preview card.`,
        user: `Article:\n${article}`,
        maxTokens: 128,
      };
    case 'improve':
      return {
        system: `${PREAMBLE} Rewrite the passage to read more clearly and gracefully, preserving its meaning, voice, and approximate length.`,
        user: `Passage:\n${selection}`,
        maxTokens: editTokens(selection),
      };
    case 'shorten':
      return {
        system: `${PREAMBLE} Tighten the passage: same meaning and voice, noticeably fewer words.`,
        user: `Passage:\n${selection}`,
        maxTokens: editTokens(selection),
      };
    case 'fix-grammar':
      return {
        system: `${PREAMBLE} Correct only grammar, spelling, and punctuation. Keep the wording, meaning, and voice otherwise unchanged.`,
        user: `Passage:\n${selection}`,
        maxTokens: editTokens(selection),
      };
  }
}

function editTokens(selection: string): number {
  return Math.min(512, Math.max(64, Math.ceil(selection.length / 2)));
}
```

- [ ] **Step 4: Run, verify pass (4/4).** Adjust the impl (not the tests) if any assertion mismatches — e.g. confirm the `/never invent|do not invent|only.*provided/i` regex matches the PREAMBLE (it contains "never invent").

- [ ] **Step 5: Commit.**

```bash
git add dashboard/src/lib/ai-prompts.ts dashboard/src/lib/ai-prompts.test.ts
git commit -m "feat(dashboard): AI task prompt builder (no-invented-facts guardrail)"
```

---

## Task 3: `/api/ai` route

**Files:** Create `dashboard/src/app/api/ai/route.ts`

- [ ] **Step 1: Implement.** Create `dashboard/src/app/api/ai/route.ts`:

```ts
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
```

- [ ] **Step 2: Verify the auth contract.** Read `dashboard/src/lib/api-auth.ts` to confirm `requireAuth()` returns `{ response }` (the articles/upload routes use this exact pattern). Adapt if different.

- [ ] **Step 3: Gate.** `cd dashboard && npx tsc --noEmit -p tsconfig.json` (exit 0).

- [ ] **Step 4: Commit.**

```bash
git add dashboard/src/app/api/ai/route.ts
git commit -m "feat(dashboard): authed /api/ai route (task-dispatched, Sonnet 4.6)"
```

---

## Task 4: ✨ Generate for SEO title, SEO description, excerpt (form)

**Files:** Modify `dashboard/src/components/article-form.tsx`

- [ ] **Step 1: Imports + state.** Add `import { tiptapJsonToText } from '@/lib/tiptap-text';`. Near the other `useState` calls add:

```tsx
type AiTarget = 'seo_title' | 'seo_description' | 'excerpt';
const [aiBusy, setAiBusy] = useState<AiTarget | null>(null);
const [aiError, setAiError] = useState<string | null>(null);
// When a field already has text, hold the suggestion for explicit Replace/Keep.
const [aiSuggestion, setAiSuggestion] = useState<{ target: AiTarget; text: string } | null>(null);
```

- [ ] **Step 2: The generate handler.** Add inside the component:

```tsx
async function generateAi(target: AiTarget) {
  const taskByTarget: Record<AiTarget, string> = {
    seo_title: 'seo-title', seo_description: 'seo-description', excerpt: 'excerpt',
  };
  const articleText = `${form.title}\n\n${tiptapJsonToText(form.body_json)}`.trim();
  setAiBusy(target);
  setAiError(null);
  setAiSuggestion(null);
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: taskByTarget[target], articleText }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setAiError(data.error ?? 'AI request failed'); return; }
    const text: string = (data.text ?? '').trim();
    if (!text) { setAiError('No suggestion returned'); return; }
    const current = (form[target] ?? '').trim();
    if (current) setAiSuggestion({ target, text });   // confirm before replacing
    else set(target, text);                            // empty → fill directly
  } catch {
    setAiError('AI request failed');
  } finally {
    setAiBusy(null);
  }
}
```

- [ ] **Step 3: A reusable ✨ button + suggestion bar.** Add a small render helper inside the component:

```tsx
function AiGenerate({ target }: { target: AiTarget }) {
  return (
    <>
      <button
        type="button"
        onClick={() => generateAi(target)}
        disabled={aiBusy !== null}
        style={{
          fontFamily: 'var(--ff-body)', fontSize: '12px', fontWeight: 600,
          color: 'var(--navy-700)', background: 'transparent', border: 'none',
          cursor: aiBusy ? 'default' : 'pointer', padding: '2px 4px', opacity: aiBusy ? 0.6 : 1,
        }}
      >
        {aiBusy === target ? '✨ Generating…' : '✨ Generate'}
      </button>
      {aiSuggestion?.target === target && (
        <div style={{ marginTop: '6px', padding: '8px 10px', background: 'var(--linen-100)', border: '1px solid var(--ink-100)', borderRadius: 'var(--r-sm)', fontFamily: 'var(--ff-body)', fontSize: '13px', color: 'var(--ink-700)' }}>
          <div style={{ marginBottom: '6px' }}>{aiSuggestion.text}</div>
          <button type="button" onClick={() => { set(target, aiSuggestion.text); setAiSuggestion(null); }}
            style={{ fontSize: '12px', fontWeight: 600, color: 'var(--navy-700)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>Replace</button>
          <button type="button" onClick={() => setAiSuggestion(null)}
            style={{ fontSize: '12px', color: 'var(--ink-500)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>Keep mine</button>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Place the buttons.** In the JSX:
  - Next to the **excerpt** `<label>` (or right under the excerpt textarea), render `<AiGenerate target="excerpt" />`.
  - In the SEO section, next to the SEO-title label render `<AiGenerate target="seo_title" />`, and next to the SEO-description label render `<AiGenerate target="seo_description" />`.
  - Render the error once near the actions or under the SEO section: `{aiError && <p style={{ color: 'var(--tassel)', fontSize: '12px', fontFamily: 'var(--ff-body)', marginTop: '6px' }}>{aiError}</p>}`.
  (Read the current label markup for those three fields and slot the button beside each label, e.g. wrap label + button in a flex row.)

- [ ] **Step 5: Gate.** `cd dashboard && npx tsc --noEmit -p tsconfig.json` (exit 0), then `cd dashboard && npm run build` (must succeed — paste final lines).

- [ ] **Step 6: Commit.**

```bash
git add dashboard/src/components/article-form.tsx
git commit -m "feat(dashboard): ✨ Generate for SEO title/description + excerpt (fill or confirm-replace)"
```

---

## Task 5: ✨ Improve/Shorten/Fix-grammar in the bubble menu (editor)

**Files:** Modify `dashboard/src/components/article-editor.tsx`

- [ ] **Step 1: State + handler.** Inside the component add:

```tsx
const [aiMenuOpen, setAiMenuOpen] = useState(false);
const [aiRunning, setAiRunning] = useState(false);

const runAiOnSelection = useCallback(async (task: 'improve' | 'shorten' | 'fix-grammar') => {
  if (!editor) return;
  const { from, to } = editor.state.selection;
  const selectionText = editor.state.doc.textBetween(from, to, ' ').trim();
  if (!selectionText) { setAiMenuOpen(false); return; }
  setAiRunning(true);
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, selectionText }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && (data.text ?? '').trim()) {
      editor.chain().focus().insertContentAt({ from, to }, data.text.trim()).run();
    } else {
      window.alert(`AI: ${data.error ?? 'request failed'}`);
    }
  } catch {
    window.alert('AI request failed.');
  } finally {
    setAiRunning(false);
    setAiMenuOpen(false);
  }
}, [editor]);
```

- [ ] **Step 2: Add the ✨ control to the bubble menu.** Inside the existing `<BubbleMenu>` button row, after the Quote button, add:

```tsx
<div style={{ position: 'relative', display: 'inline-flex' }}>
  <button type="button" aria-label="AI improve" disabled={aiRunning}
    onClick={() => setAiMenuOpen((v) => !v)} style={bubbleBtn(aiMenuOpen)}>
    {aiRunning ? '…' : '✨'}
  </button>
  {aiMenuOpen && (
    <div style={{ position: 'absolute', top: '34px', right: 0, zIndex: 30, display: 'flex', flexDirection: 'column', minWidth: '130px', background: 'var(--ink-900)', borderRadius: 'var(--r-sm)', padding: '4px', boxShadow: '0 6px 24px rgba(0,0,0,.24)' }}>
      <button type="button" onClick={() => runAiOnSelection('improve')} style={aiItemStyle}>Improve</button>
      <button type="button" onClick={() => runAiOnSelection('shorten')} style={aiItemStyle}>Shorten</button>
      <button type="button" onClick={() => runAiOnSelection('fix-grammar')} style={aiItemStyle}>Fix grammar</button>
    </div>
  )}
</div>
```

Add an `aiItemStyle` const near `bubbleBtn`:

```tsx
const aiItemStyle: React.CSSProperties = {
  textAlign: 'left', padding: '7px 10px', background: 'transparent', border: 'none',
  color: 'var(--linen-50)', cursor: 'pointer', fontSize: '13px', fontFamily: 'var(--ff-body)', borderRadius: '4px',
};
```

- [ ] **Step 2b:** `useState` is already imported in this file; confirm and add it to the import if not.

- [ ] **Step 3: Gate.** `cd dashboard && npx tsc --noEmit -p tsconfig.json` (exit 0), then `cd dashboard && npm run build` (must succeed — paste final lines). The BubbleMenu nesting is the only risk; the menu is plain absolutely-positioned divs inside the existing BubbleMenu children, which is fine.

- [ ] **Step 4: Commit.**

```bash
git add dashboard/src/components/article-editor.tsx
git commit -m "feat(dashboard): bubble-menu ✨ Improve/Shorten/Fix-grammar rewrites selection"
```

---

## Task 6: Gate + deploy + E2E

**Files:** none (verification).

- [ ] **Step 1: All unit tests green.**
  - `cd dashboard && node --test --experimental-strip-types src/lib/tiptap-text.test.ts`
  - `cd dashboard && node --test --experimental-strip-types src/lib/ai-prompts.test.ts`

- [ ] **Step 2: Full gate (the CI commands).** `cd dashboard && npx tsc --noEmit -p tsconfig.json` AND `cd dashboard && npm run build` — both succeed. (Website untouched, but if merging to main, the website CI `tsc` must still pass — it does.)

- [ ] **Step 3: Merge/PR per the team flow, deploy, then manual E2E (deployed, logged in):**
  - On a real article: **✨ Generate** SEO title, SEO description, excerpt — empty field fills directly; a field with text shows the **[Replace] [Keep mine]** bar.
  - Select a sentence → bubble menu **✨ → Improve / Shorten / Fix grammar** rewrites it in place; **Cmd/Ctrl+Z** reverts.
  - Confirm the calls go to Sonnet (fast) and that an induced failure (e.g. empty article) shows an inline message and blocks nothing.
  - Spot-check that generated text invents no quotes/sources (read it).

---

## Self-review notes
- **Spec coverage:** tiptap-text→T1; ai-prompts (incl. no-invent guardrail + per-task constraints)→T2; /api/ai route→T3; SEO+excerpt generate w/ fill-or-confirm→T4; bubble-menu improve/shorten/fix-grammar→T5; gates+E2E→T6. ✓
- **Type consistency:** `AI_TASKS`/`AiTask`, `buildAiPrompt(task,{articleText,selectionText})→{system,user,maxTokens}`, `tiptapJsonToText(doc)`, `AiTarget`, `generateAi(target)`, `runAiOnSelection(task)`, model const `AI_MODEL='anthropic/claude-sonnet-4.6'` — consistent across tasks. ✓
- **Model verified** (not guessed): `anthropic/claude-sonnet-4.6`, live API 2026-06-08.
- **No token leak:** key stays in `callClaude` (server); route is auth-gated.
- **Tests stay typed** so CI's bare `tsc` passes (dashboard tsconfig has allowImportingTsExtensions).
