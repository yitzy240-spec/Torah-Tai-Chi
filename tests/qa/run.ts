import { spawn } from 'node:child_process';

function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: 'inherit', shell: true });
    p.on('exit', (code) => resolve(code ?? 1));
  });
}

(async () => {
  console.log('\n=== 1/4  Playwright suites ===');
  const playwrightCode = await run('npx', ['playwright', 'test']);
  if (playwrightCode !== 0) {
    console.log(`[qa] Playwright exited with code ${playwrightCode} — continuing (findings are legitimate)`);
  }

  console.log('\n=== 2/4  Design-review capture ===');
  await run('npx', ['tsx', 'design-review/capture.ts']);

  console.log('\n=== 3/4  Design-review subagents ===');
  await run('npx', ['tsx', 'design-review/review-runner.ts']);

  console.log('\n=== 4/4  Aggregate findings ===');
  await run('npx', ['tsx', 'report/aggregate.ts']);

  console.log('\n[qa] complete → see docs/qa/findings.md');
})();
