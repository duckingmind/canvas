import assert from 'node:assert/strict';
import test from 'node:test';
import { generateMusicLyrics, lyricsModel, lyricsText } from '../src/music-lyrics.ts';

test('lyrics model selection excludes unavailable and non-text/non-responses models', () => {
  assert.equal(lyricsModel({ data: [{ id: 'audio', type: 'audio' }, { id: 'no', available: false }, { id: 'chat', supported_endpoints: ['chat/completions'] }, { id: 'text-only', input_modalities: ['text'], supported_endpoints: ['/v1/responses'] }] }), 'text-only');
  assert.equal(lyricsModel([{ id: 'first' }, { id: 'default', is_default: true }]), 'default');
  assert.equal(lyricsModel({ data: [{ id: 'unavailable-default', available: false, is_default: true }, { id: 'no-responses-default', supports_responses: false, is_default: true }, { id: 'text', capabilities: { supported_endpoints: ['/v1/responses'] } }] }), 'text');
});

test('lyrics parses Responses text blocks and reports incomplete/empty output', () => {
  assert.equal(lyricsText({ output: [{ type: 'message', content: [{ type: 'output_text', text: '[Verse]\n开场' }, { type: 'refusal', refusal: 'ignored' }] }] }), '[Verse]\n开场');
  assert.equal(lyricsText({ output_text: '```lyrics\n[Chorus]\n你好\n```' }), '[Chorus]\n你好');
  assert.throws(() => lyricsText({ status: 'incomplete', output_text: 'partial' }), /未完成/);
  assert.throws(() => lyricsText({ output: [] }), /未返回歌词/);
  assert.throws(() => lyricsText({ error: { message: '账户额度不足' }, output_text: 'old output' }), /账户额度不足/);
  assert.throws(() => lyricsText({ output_text: '字'.repeat(3501) }), /歌词过长/);
});

test('AI lyrics uses the discovered model and returns editable lyrics from Responses', async () => {
  const calls: {path: string; body?: any}[] = [];
  const result = await generateMusicLyrics(async (path, init) => {
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return path === '/models' ? { data: [{ id: 'text-model' }] } : { output_text: '[Verse]\n这是一段新歌词' };
  }, '民谣与春天');
  assert.equal(result, '[Verse]\n这是一段新歌词');
  assert.deepEqual(calls.map(call => call.path), ['/models', '/responses']);
  assert.equal(calls[1].body.model, 'text-model');
  assert.equal(calls[1].body.store, false);
  assert.equal(calls[1].body.input[0].content[0].text, '民谣与春天');
});
