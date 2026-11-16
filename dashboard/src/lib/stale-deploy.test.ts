// dashboard/src/lib/stale-deploy.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isStaleDeployError,
  stashUnsaved,
  readUnsaved,
  clearUnsaved,
  unsavedKey,
} from './stale-deploy.ts';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    map: m,
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

test('detects the client-side "was not found on the server" error', () => {
  assert.equal(
    isStaleDeployError(new Error("Server Action '78be80eb1234' was not found on the server.")),
    true,
  );
});

test('detects the server-side "Failed to find Server Action" error', () => {
  assert.equal(
    isStaleDeployError(
      new Error('Failed to find Server Action "78be80eb". This request might be from an older or newer deployment.'),
    ),
    true,
  );
  assert.equal(isStaleDeployError('failed to find server action "x"'), true);
});

test('ignores ordinary save errors and junk', () => {
  assert.equal(isStaleDeployError(new Error('Voiceover too long (max 1500 chars)')), false);
  assert.equal(isStaleDeployError(new Error('Not authenticated')), false);
  assert.equal(isStaleDeployError(null), false);
  assert.equal(isStaleDeployError(undefined), false);
  assert.equal(isStaleDeployError({ message: 42 }), false);
  assert.equal(isStaleDeployError(''), false);
});

test('stash writes the draft key and the marker, read returns it', () => {
  const s = memoryStorage();
  stashUnsaved(s, 'caption.tiktok.v1', 'new caption');
  assert.equal(s.getItem('caption.tiktok.v1'), 'new caption');
  assert.equal(s.getItem(unsavedKey('caption.tiktok.v1')), 'new caption');
  assert.equal(readUnsaved(s, 'caption.tiktok.v1'), 'new caption');
});

test('stashes are per field', () => {
  const s = memoryStorage();
  stashUnsaved(s, 'a', 'A');
  stashUnsaved(s, 'b', 'B');
  assert.equal(readUnsaved(s, 'a'), 'A');
  assert.equal(readUnsaved(s, 'b'), 'B');
  assert.equal(readUnsaved(s, 'c'), null);
});

test('clear removes only the marker', () => {
  const s = memoryStorage();
  stashUnsaved(s, 'a', 'A');
  clearUnsaved(s, 'a');
  assert.equal(readUnsaved(s, 'a'), null);
  assert.equal(s.getItem('a'), 'A');
});

test('missing or throwing storage is a no-op', () => {
  assert.doesNotThrow(() => stashUnsaved(null, 'a', 'A'));
  assert.equal(readUnsaved(undefined, 'a'), null);
  const broken = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('quota'); },
    removeItem: () => { throw new Error('denied'); },
  };
  assert.doesNotThrow(() => stashUnsaved(broken, 'a', 'A'));
  assert.equal(readUnsaved(broken, 'a'), null);
  assert.doesNotThrow(() => clearUnsaved(broken, 'a'));
});
