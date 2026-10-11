import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LOW_BALANCE_USD,
  parseKieCredits,
  resolveLowBalanceUsd,
  usdToCredits,
} from './kie-balance.ts';

test('parseKieCredits reads Kie’s bare-number shape', () => {
  assert.equal(parseKieCredits({ code: 200, msg: 'success', data: 1226.98 }), 1226.98);
});

test('parseKieCredits accepts nested variants and rejects junk', () => {
  assert.equal(parseKieCredits({ data: { credits: 500 } }), 500);
  assert.equal(parseKieCredits({ data: { balance: 0 } }), 0);
  assert.equal(parseKieCredits({ code: 401, msg: 'bad key' }), null);
  assert.equal(parseKieCredits(null), null);
  assert.equal(parseKieCredits({ data: 'lots' }), null);
});

test('threshold: setting row wins, then env, then $20', () => {
  assert.equal(DEFAULT_LOW_BALANCE_USD, 20);
  assert.equal(resolveLowBalanceUsd('35', '50'), 35);
  assert.equal(resolveLowBalanceUsd('$12.50', undefined), 12.5);
  assert.equal(resolveLowBalanceUsd(null, '50'), 50);
  assert.equal(resolveLowBalanceUsd('not a number', '50'), 50);
  assert.equal(resolveLowBalanceUsd(undefined, undefined), 20);
  assert.equal(resolveLowBalanceUsd('-5', ''), 20);
});

test('usdToCredits uses $0.005/credit', () => {
  assert.equal(usdToCredits(20), 4000);
  assert.equal(usdToCredits(12.5), 2500);
});
