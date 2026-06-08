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
