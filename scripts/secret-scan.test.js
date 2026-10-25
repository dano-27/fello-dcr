/**
 * Tests for scripts/secret-scan.js (FCCV-92). Zero dependencies — run with:
 *
 *   node --test scripts/secret-scan.test.js
 *
 * Fake values are generated at runtime so this file never contains a literal the scanner would flag.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { scanText } = require('./secret-scan.js');

// Deterministic fake: mixed case + digits, never a real credential.
const fake = n => 'Ab3'.repeat(Math.ceil(n / 3)).slice(0, n);
const q = "'";
const rules = (text, file = 'google-apps-script.js') => scanText(text, file).map(f => f.rule);

test('flags a Laravel 11 Sanctum token (id|40 chars + 8-char checksum) behind "Bearer "', () => {
  const line = `  var IMS_TOKEN = ${q}Bearer 1234|${fake(48)}${q};`;
  const found = rules(line);
  assert.ok(found.includes('LARAVEL_TOKEN'), found.join(','));
  assert.ok(found.includes('BEARER_LITERAL'), found.join(','));
});

test('flags a classic 40-char Sanctum token', () => {
  assert.ok(rules(`x = ${q}99|${fake(40)}${q}`).includes('LARAVEL_TOKEN'));
});

test('flags a quoted bearer token of any shape', () => {
  assert.ok(rules(`headers: { Authorization: ${q}Bearer ${fake(32)}${q} }`).includes('BEARER_LITERAL'));
});

test('flags a hardcoded API key assignment', () => {
  assert.ok(rules(`var SIMPLEMDM_API_KEY = ${q}${fake(22)}${q};`).includes('SECRET_ASSIGN'));
});

test('does not flag the Script Properties reads used in google-apps-script.js', () => {
  const text = [
    "  var SIMPLEMDM_API_KEY = getSecret_('SIMPLEMDM_API_KEY');",
    "  var IMS_TOKEN = getSecret_('IMS_TOKEN').replace(/^Bearer\\s+/i, '');",
    "      headers: { 'Authorization': 'Bearer ' + IMS_TOKEN },",
  ].join('\n');
  assert.deepEqual(rules(text), []);
});

test('does not flag placeholders', () => {
  assert.deepEqual(rules(`var SIMPLEMDM_API_KEY = ${q}YOUR_SIMPLEMDM_API_KEY${q};`), []);
  assert.deepEqual(rules(`var t = ${q}Bearer <your-token-here-xxxxxxxx>${q};`), []);
});
