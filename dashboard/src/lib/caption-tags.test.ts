import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitCaption, joinCaption } from './caption-tags.ts';

test('splits apostrophe hashtags into the tag block, not the body', () => {
  const { body, tags } = splitCaption(
    "Some teaching.\n\nLearn more at TorahTaiChi.com.\n\n#TorahTaiChi #Va'etchanan #TaiChi",
  );
  assert.equal(body, 'Some teaching.\n\nLearn more at TorahTaiChi.com.');
  assert.equal(tags, "#TorahTaiChi #Va'etchanan #TaiChi");
});

test('join strips hashtag remnants glued to the body (Re’eh duplication)', () => {
  // Body as the old regex left it: half the hashtag block + stranded '#'.
  const mangledBody =
    'Learn more at TorahTaiChi.com\n\n#TorahTaiChi #Torah #TaiChi #Shorts #fyp #JewishMindfulness #';
  const joined = joinCaption(mangledBody, '#TorahTaiChi #Torah #Parsha #Reeh');
  assert.equal(
    joined,
    'Learn more at TorahTaiChi.com\n\n#TorahTaiChi #Torah #Parsha #Reeh',
  );
  assert.equal((joined.match(/#TorahTaiChi/g) ?? []).length, 1);
});

test('round-trip is stable for clean captions', () => {
  const cap = 'Body text here.\n\n#One #Two #Three';
  const { body, tags } = splitCaption(cap);
  assert.equal(joinCaption(body, tags), cap);
});
