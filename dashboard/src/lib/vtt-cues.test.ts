// Run: node --test --experimental-strip-types src/lib/vtt-cues.test.ts  (from dashboard/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVtt, parseVttDataUrl } from './vtt-cues.ts';

function b64DataUrl(vtt: string): string {
  return `data:text/vtt;charset=utf-8;base64,${Buffer.from(vtt, 'utf-8').toString('base64')}`;
}

const VTT =
  'WEBVTT\n\n00:00:00.000 --> 00:00:09.000\nIn this week\u2019s portion, Jacob\n\n' +
  '00:00:09.000 --> 00:00:19.500\nwrestles \u2014 and limps away.\n';

test('parses the buildClipPayload base64 data URL, keeping UTF-8 punctuation', () => {
  assert.deepEqual(parseVttDataUrl(b64DataUrl(VTT)), [
    { start: 0, end: 9, text: 'In this week\u2019s portion, Jacob' },
    { start: 9, end: 19.5, text: 'wrestles \u2014 and limps away.' },
  ]);
});

test('accepts percent-encoded data URLs and mm:ss timings', () => {
  const url = 'data:text/vtt,' + encodeURIComponent('WEBVTT\n\n01:02.250 --> 01:05.000\nHi\n');
  assert.deepEqual(parseVttDataUrl(url), [{ start: 62.25, end: 65, text: 'Hi' }]);
});

test('skips malformed, empty and zero-length cues', () => {
  const vtt = 'WEBVTT\n\nNOTE hi\n\n00:00:01.000 --> 00:00:01.000\nzero\n\n' +
    'garbage --> 00:00:02.000\nbad\n\n00:00:02.000 --> 00:00:03.000\n\n' +
    'id-1\n00:00:03.000 --> 00:00:04.000 align:start\nok\n';
  assert.deepEqual(parseVtt(vtt), [{ start: 3, end: 4, text: 'ok' }]);
});

test('null, empty or non-data input yields no cues', () => {
  assert.deepEqual(parseVttDataUrl(null), []);
  assert.deepEqual(parseVttDataUrl(''), []);
  assert.deepEqual(parseVttDataUrl('https://example.com/a.vtt'), []);
  assert.deepEqual(parseVttDataUrl('data:text/vtt;base64,%%%'), []);
});
