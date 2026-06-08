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
