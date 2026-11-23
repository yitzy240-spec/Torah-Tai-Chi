import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultBurnOnScreenText, onScreenStitchPayload } from './on-screen-text.ts';

describe('defaultBurnOnScreenText', () => {
  it('is off when hook and override are empty', () => {
    assert.equal(defaultBurnOnScreenText('', ''), false);
    assert.equal(defaultBurnOnScreenText('   ', '\n'), false);
  });

  it('is on when a hook line is set', () => {
    assert.equal(defaultBurnOnScreenText('Why did Lavan run?', ''), true);
  });

  it('is on when a caption override is set', () => {
    assert.equal(defaultBurnOnScreenText('', 'Lavan and Leah'), true);
  });
});

describe('onScreenStitchPayload', () => {
  it('mirrors the dashboard fields into stitch_settings.on_screen', () => {
    assert.deepEqual(
      onScreenStitchPayload({
        hookText: 'Why did Lavan run?',
        captionOverride: 'Lavan and Leah',
        enabled: true,
      }),
      {
        hook_text: 'Why did Lavan run?',
        caption_override: 'Lavan and Leah',
        enabled: true,
      },
    );
  });
});
