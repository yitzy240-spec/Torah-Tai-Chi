import fs from 'node:fs/promises';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { FindingsArraySchema, type Finding } from './findings-schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadEnv({ path: path.join(__dirname, '..', '.env.qa') });

async function readJsonIfExists<T>(p: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

interface PlaywrightJsonReport {
  suites?: Array<{
    specs?: Array<{
      title?: string;
      file?: string;
      line?: number;
      tests?: Array<{
        results?: Array<{
          status?: string;
          retry?: number;
          error?: { message?: string };
          attachments?: Array<{ contentType?: string; path?: string }>;
        }>;
      }>;
    }>;
    suites?: PlaywrightJsonReport['suites'];
  }>;
}

function walkSuites(suites: NonNullable<PlaywrightJsonReport['suites']>, out: Finding[]): void {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      for (const testRun of spec.tests ?? []) {
        for (const result of testRun.results ?? []) {
          if (result.status === 'passed' || result.status === 'skipped') continue;
          const file = spec.file ?? 'unknown.spec.ts';
          const title = spec.title ?? 'untitled';
          const tier: Finding['tier'] = /tier1/.test(file) ? 1 : /tier2/.test(file) ? 2 : 3;
          const surface: Finding['surface'] = file.includes('dashboard') ? 'dashboard' : 'website';
          const severity: Finding['severity'] = tier === 1 ? 'P0' : tier === 2 ? 'P1' : 'P2';
          const screenshot = result.attachments?.find(a => a.contentType === 'image/png')?.path;
          const id = `pw-${surface}-${(title + (result.retry ?? 0)).replace(/\W+/g, '-').toLowerCase()}`.slice(0, 60);
          out.push({
            id, category: 'func', tier, severity, surface,
            what: title,
            where: file,
            test: `${file}${spec.line ? ':' + spec.line : ''}`,
            actual: result.error?.message ?? 'test failed',
            screenshot,
          });
        }
      }
    }
    if (suite.suites) walkSuites(suite.suites, out);
  }
}

async function collectPlaywrightFindings(): Promise<Finding[]> {
  const report = await readJsonIfExists<PlaywrightJsonReport>(path.join(__dirname, '..', 'results', 'playwright.json'));
  if (!report) return [];
  const findings: Finding[] = [];
  if (report.suites) walkSuites(report.suites, findings);
  return findings;
}

async function collectDesignReviewFindings(): Promise<Finding[]> {
  const dir = path.join(__dirname, '..', 'results');
  try { await fs.access(dir); } catch { return []; }
  const files = (await fs.readdir(dir)).filter(f => f.startsWith('design-review-') && f.endsWith('.json'));
  const out: Finding[] = [];
  for (const f of files) {
    const raw = await readJsonIfExists<unknown>(path.join(dir, f));
    const parsed = FindingsArraySchema.safeParse(raw);
    if (parsed.success) {
      out.push(...parsed.data);
    } else {
      console.warn(`[report] ${f} did not match findings schema:`, parsed.error.issues.slice(0, 3));
    }
  }
  return out;
}

function render(findings: Finding[]): string {
  const bySev: Record<Finding['severity'], Finding[]> = { P0: [], P1: [], P2: [] };
  for (const f of findings) bySev[f.severity].push(f);

  const surfaces = new Set(findings.map(f => f.surface)).size;
  const lines: string[] = [
    `# QA Findings — ${new Date().toISOString()}`,
    ``,
    `_Summary: ${bySev.P0.length} P0, ${bySev.P1.length} P1, ${bySev.P2.length} P2 across ${surfaces} surface${surfaces === 1 ? '' : 's'}._`,
    ``,
    `Conventions — every finding below is self-contained. A fix agent should work top-to-bottom:`,
    `1. Open the \`Where\` file.`,
    `2. Run the \`Test\` to reproduce the failure (if present).`,
    `3. Apply the \`Suggested fix\` direction.`,
    `4. Re-run the test; move on when it passes.`,
    ``,
  ];
  const titles: Record<Finding['severity'], string> = {
    P0: 'P0 — Broken (blocks ship)',
    P1: 'P1 — Noticeable',
    P2: 'P2 — Polish',
  };
  for (const sev of ['P0', 'P1', 'P2'] as const) {
    lines.push(`## ${titles[sev]}`);
    lines.push('');
    if (bySev[sev].length === 0) { lines.push('_None._', ''); continue; }
    for (const f of bySev[sev]) {
      lines.push(`### ${f.id}  [${f.category}] [tier${f.tier}]`);
      lines.push(`**What:** ${f.what}`);
      lines.push(`**Where:** ${f.where}`);
      if (f.repro && f.repro.length)   lines.push(`**Repro:**\n${f.repro.map((s,i) => `${i+1}. ${s}`).join('\n')}`);
      if (f.expected)                  lines.push(`**Expected:** ${f.expected}`);
      if (f.actual)                    lines.push(`**Actual:** ${f.actual}`);
      if (f.test)                      lines.push(`**Test:** ${f.test}`);
      if (f.screenshot)                lines.push(`**Screenshot:** ${f.screenshot}`);
      if (f.suggestedFix)              lines.push(`**Suggested fix:** ${f.suggestedFix}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

(async () => {
  const funcFindings = await collectPlaywrightFindings();
  const designFindings = await collectDesignReviewFindings();
  const all = [...funcFindings, ...designFindings];

  const outDir = path.join(__dirname, '..', '..', '..', 'docs', 'qa');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'findings.md');
  await fs.writeFile(outPath, render(all));
  console.log(`[report] wrote ${outPath} (${all.length} findings: ${funcFindings.length} functional, ${designFindings.length} design-review)`);
})();
