// dashboard/src/lib/claude.ts
//
// Thin client for dashboard-side Claude calls (script generation, polish).
// Uses OpenRouter (Anthropic-compatible endpoint). All script-AI calls go
// through this single helper — do not call OpenRouter directly from routes.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Verified against https://openrouter.ai/api/v1/models on 2026-05-19.
// Opus 4.7 is the strongest Claude model currently on OpenRouter.
const DEFAULT_MODEL = 'anthropic/claude-opus-4.7';

interface CallClaudeOpts {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  maxTokens?: number;
}

/**
 * Send a single system+user turn to Claude via OpenRouter.
 * Returns the assistant's text content.
 *
 * Throws with a descriptive message on auth failure, network error, or
 * unexpected response shape.
 */
export async function callClaude(opts: CallClaudeOpts): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set in the environment');

  const model = opts.model ?? DEFAULT_MODEL;
  const maxTokens = opts.maxTokens ?? 1024;

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://dashboard.torahtaichi.com',
      'X-Title': 'Torah Tai Chi Dashboard',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: opts.systemPrompt },
        { role: 'user', content: opts.userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message: string };
  };

  if (json.error) throw new Error(`OpenRouter error: ${json.error.message}`);

  const text = json.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    throw new Error(`Unexpected OpenRouter response shape: ${JSON.stringify(json).slice(0, 200)}`);
  }

  return text;
}
