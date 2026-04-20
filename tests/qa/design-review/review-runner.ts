import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, '..', '.env.qa') });

const client = new Anthropic();

interface Group {
  surface: 'dashboard' | 'website';
  tier: number;
  promptPath: string;
  shotPaths: string[];
}

async function reviewGroup(group: Group): Promise<void> {
  const prompt = await fs.readFile(group.promptPath, 'utf8');
  const imageBlocks: Anthropic.ImageBlockParam[] = await Promise.all(
    group.shotPaths.map(async (p) => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: (await fs.readFile(p)).toString('base64'),
      },
    }))
  );
  const res = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: prompt }, ...imageBlocks],
    }],
  });
  const text = res.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map(c => c.text)
    .join('');
  // Extract JSON array from response (subagent may wrap in markdown occasionally)
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  const findings = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  await fs.mkdir('results', { recursive: true });
  const outPath = `results/design-review-${group.surface}-tier${group.tier}.json`;
  await fs.writeFile(outPath, JSON.stringify(findings, null, 2));
  console.log(`[review] ${group.surface}-tier${group.tier} → ${findings.length} findings → ${outPath}`);
}

async function collectGroups(): Promise<Group[]> {
  const groups: Group[] = [];
  const shotsDir = 'shots';
  try { await fs.access(shotsDir); } catch { return groups; }

  for (const surface of ['dashboard', 'website'] as const) {
    const promptPath = `design-review/prompts/${surface}-review.md`;
    try { await fs.access(promptPath); } catch { continue; }

    const surfaceDir = path.join(shotsDir, surface);
    try { await fs.access(surfaceDir); } catch { continue; }

    const tierDirs = await fs.readdir(surfaceDir);
    for (const tierDir of tierDirs.filter(d => d.startsWith('tier'))) {
      const tier = parseInt(tierDir.replace('tier', ''), 10);
      if (isNaN(tier)) continue;
      const full = path.join(surfaceDir, tierDir);
      const files = await fs.readdir(full);
      const shotPaths = files.filter(f => f.endsWith('.png')).map(f => path.join(full, f));
      if (shotPaths.length === 0) continue;
      groups.push({ surface, tier, promptPath, shotPaths });
    }
  }
  return groups;
}

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[review] ANTHROPIC_API_KEY not set — skipping design-review pass');
    return;
  }
  const groups = await collectGroups();
  if (groups.length === 0) {
    console.warn('[review] no screenshot groups found; run capture.ts first');
    return;
  }
  console.log(`[review] running ${groups.length} review groups in parallel`);
  await Promise.all(groups.map(reviewGroup));
  console.log('[review] complete');
})();
