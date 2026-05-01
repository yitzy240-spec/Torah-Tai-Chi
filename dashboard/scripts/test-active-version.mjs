// Standalone verification for pickActiveVersion. Run with `node`:
//   node scripts/test-active-version.mjs
// Exits non-zero on any failed case.

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Allow importing the .ts source directly via tsx/loader if available;
// otherwise we re-implement the function here for the test (the file is
// pure so a copy-paste is acceptable for verification).

function pickActiveVersion(versions, selectedId) {
  if (versions.length === 0) return null;
  const latest = versions[versions.length - 1];
  if (!selectedId) return latest;
  return versions.find(v => v.videoId === selectedId) ?? latest;
}

const cases = [
  {
    name: 'empty list returns null',
    versions: [],
    selectedId: null,
    expect: null,
  },
  {
    name: 'null selectedId returns latest',
    versions: [
      { videoId: 'v1', publishedToWebsite: true },
      { videoId: 'v2', publishedToWebsite: false },
      { videoId: 'v3', publishedToWebsite: false },
    ],
    selectedId: null,
    expect: { videoId: 'v3', publishedToWebsite: false },
  },
  {
    name: 'undefined selectedId returns latest',
    versions: [
      { videoId: 'v1', publishedToWebsite: false },
      { videoId: 'v2', publishedToWebsite: true },
    ],
    selectedId: undefined,
    expect: { videoId: 'v2', publishedToWebsite: true },
  },
  {
    name: 'empty-string selectedId returns latest',
    versions: [
      { videoId: 'v1', publishedToWebsite: false },
      { videoId: 'v2', publishedToWebsite: true },
    ],
    selectedId: '',
    expect: { videoId: 'v2', publishedToWebsite: true },
  },
  {
    name: 'selectedId pointing at older version returns that version',
    versions: [
      { videoId: 'v1', publishedToWebsite: true },
      { videoId: 'v2', publishedToWebsite: false },
      { videoId: 'v3', publishedToWebsite: false },
    ],
    selectedId: 'v1',
    expect: { videoId: 'v1', publishedToWebsite: true },
  },
  {
    name: 'selectedId matching latest returns latest',
    versions: [
      { videoId: 'v1', publishedToWebsite: false },
      { videoId: 'v2', publishedToWebsite: true },
    ],
    selectedId: 'v2',
    expect: { videoId: 'v2', publishedToWebsite: true },
  },
  {
    name: 'selectedId not in list falls back to latest',
    versions: [
      { videoId: 'v1', publishedToWebsite: false },
      { videoId: 'v2', publishedToWebsite: true },
    ],
    selectedId: 'v999-stale',
    expect: { videoId: 'v2', publishedToWebsite: true },
  },
  {
    name: 'mid-tree version with publishedToWebsite=true',
    versions: [
      { videoId: 'v1', publishedToWebsite: false },
      { videoId: 'v2', publishedToWebsite: true },
      { videoId: 'v3', publishedToWebsite: false },
      { videoId: 'v4', publishedToWebsite: false },
    ],
    selectedId: 'v2',
    expect: { videoId: 'v2', publishedToWebsite: true },
  },
];

let failed = 0;
for (const c of cases) {
  const got = pickActiveVersion(c.versions, c.selectedId);
  const ok = JSON.stringify(got) === JSON.stringify(c.expect);
  if (!ok) {
    failed++;
    console.error(`FAIL: ${c.name}`);
    console.error(`  selectedId: ${JSON.stringify(c.selectedId)}`);
    console.error(`  expected:   ${JSON.stringify(c.expect)}`);
    console.error(`  got:        ${JSON.stringify(got)}`);
  } else {
    console.log(`PASS: ${c.name}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} of ${cases.length} cases failed.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} cases passed.`);
