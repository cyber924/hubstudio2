import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiError, isGeminiError, normalizeGeminiError } from '../server/gemini-errors.js';

test('disabled bound Google service account has clear Korean remediation and no raw JSON', () => {
  const raw = '{"error":{"code":401,"message":"The bound service account is deleted or disabled. The service account bound to the API key must be active.","status":"UNAUTHENTICATED","details":[{"reason":"ACCOUNT_STATE_INVALID"}]}}';
  const normalized = normalizeGeminiError(Object.assign(new Error(raw), { status: 401 }));
  assert.equal(normalized.status, 503);
  assert.equal(normalized.code, 'GEMINI_ACCOUNT_INACTIVE');
  assert.match(normalized.message, /GEMINI_API_KEY/);
  assert.doesNotMatch(normalized.message, /ACCOUNT_STATE_INVALID|@type|google\.rpc/);
});

test('invalid key, quota, and unsupported model are distinguished', () => {
  assert.equal(normalizeGeminiError(Object.assign(new Error('API_KEY_INVALID'), { status: 400 })).code, 'GEMINI_API_KEY_INVALID');
  const quota = normalizeGeminiError(Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 }));
  assert.equal(quota.code, 'GEMINI_QUOTA_EXCEEDED');
  assert.equal(quota.status, 429);
  assert.equal(normalizeGeminiError(Object.assign(new Error('model not found'), { status: 404 })).code, 'GEMINI_MODEL_UNAVAILABLE');
});

test('unknown provider errors do not expose upstream internals', () => {
  const e = normalizeGeminiError(new Error('private service metadata, internal stack, x-goog-api-key'));
  assert.equal(e.code, 'GEMINI_REQUEST_FAILED');
  assert.equal(e.status, 502);
  assert.doesNotMatch(e.message, /private service metadata|x-goog-api-key/);
});

test('already normalized service errors remain stable', () => {
  const original = geminiError('GEMINI_API_KEY_MISSING', '서버 키 미설정');
  assert.ok(isGeminiError(original));
  assert.strictEqual(normalizeGeminiError(original), original);
});
