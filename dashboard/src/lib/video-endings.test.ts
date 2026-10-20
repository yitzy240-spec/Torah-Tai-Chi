// Run: node --test --experimental-strip-types src/lib/video-endings.test.ts  (from dashboard/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENDING_DOWNLOAD_LABELS,
  endingDownloadFilename,
  endingForPlatform,
  videoPathForEnding,
  videoPathForPlatform,
} from './video-endings.ts';

const both = { mp4_path: 'jobs/j/noach-follow.mp4', mp4_subscribe_path: 'jobs/j/noach-subscribe.mp4' };
const legacy = { mp4_path: 'jobs/j/final.mp4', mp4_subscribe_path: null };

test('YouTube gets the subscribe ending; every other platform the follow ending', () => {
  assert.equal(endingForPlatform('youtube'), 'subscribe');
  for (const p of ['instagram', 'tiktok', 'facebook', 'twitter']) {
    assert.equal(endingForPlatform(p), 'follow', p);
  }
});

test('posting resolves each platform to its own file', () => {
  assert.equal(videoPathForPlatform(both, 'youtube'), 'jobs/j/noach-subscribe.mp4');
  assert.equal(videoPathForPlatform(both, 'instagram'), 'jobs/j/noach-follow.mp4');
  assert.equal(videoPathForPlatform(both, 'tiktok'), 'jobs/j/noach-follow.mp4');
  assert.equal(videoPathForPlatform(both, 'facebook'), 'jobs/j/noach-follow.mp4');
  assert.equal(videoPathForPlatform(both, 'twitter'), 'jobs/j/noach-follow.mp4');
});

test('old videos without a subscribe cut fall back to the main video', () => {
  assert.equal(videoPathForPlatform(legacy, 'youtube'), 'jobs/j/final.mp4');
  assert.equal(videoPathForEnding({ mp4_path: 'a.mp4' }, 'subscribe'), 'a.mp4');
  assert.equal(videoPathForEnding({ mp4_path: 'a.mp4', mp4_subscribe_path: '' }, 'subscribe'), 'a.mp4');
});

test('no video file → null, never an empty path', () => {
  assert.equal(videoPathForEnding({ mp4_path: '' }, 'follow'), null);
  assert.equal(videoPathForEnding({ mp4_path: null, mp4_subscribe_path: null }, 'subscribe'), null);
});

test('download filenames are <parsha>-follow.mp4 / <parsha>-subscribe.mp4', () => {
  assert.equal(endingDownloadFilename('noach', 'follow'), 'noach-follow.mp4');
  assert.equal(endingDownloadFilename('noach', 'subscribe'), 'noach-subscribe.mp4');
  assert.equal(endingDownloadFilename('Lech Lecha', 'follow'), 'lech-lecha-follow.mp4');
  assert.equal(endingDownloadFilename('', 'subscribe'), 'torah-tai-chi-subscribe.mp4');
});

test('download buttons are labelled by platform', () => {
  assert.equal(ENDING_DOWNLOAD_LABELS.follow, 'Download for Facebook / IG / TikTok (Follow ending)');
  assert.equal(ENDING_DOWNLOAD_LABELS.subscribe, 'Download for YouTube (Subscribe ending)');
});
