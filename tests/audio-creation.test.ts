import assert from 'node:assert/strict';
import test from 'node:test';
import { audioCreationSignature, isTTSNode, isVoiceDesignNode, normalizeMusicReference, normalizeMusicSubmission, normalizeTTSSettings, normalizeTTSSubmission, normalizeVoiceDesignSubmission } from '../src/audio-creation.ts';
import { storageDocument } from '../src/cloud-document.ts';
import type { CanvasNode, Document } from '../src/canvas-types.ts';

const localAudio = 'proxy-canvas:audio:v1:12345678-1234-1234-1234-123456789012';
const music = { id: 'music', type: 'audio', supported_input_modes: ['text', 'reference_audio'], audio_modes: ['song', 'instrumental'], output_formats: ['mp3'] };
const voice = { id: 'minimax-voice-design', type: 'audio', supported_input_modes: ['text'], supported_parameters: { prompt: {}, preview_text: {} } };
const node: CanvasNode = { id: 'creator', type: 'prompt', mediaType: 'audio', title: 'audio', text: 'test', color: '#fff', width: 300, height: 180, x: 0, y: 0 };

test('audio submissions retain frozen inputs but never accept inline audio bytes or transient URLs', () => {
  const submission = normalizeMusicSubmission({ key: 'submit-1', model: 'music', prompt: 'original', referenceLocalAudio: localAudio, referenceDuration: 10, referenceSize: 40, audio_base64: 'private bytes', extra: true });
  assert.equal(submission?.referenceLocalAudio, localAudio);
  assert.equal('audio_base64' in submission!, false);
  assert.equal('extra' in submission!, false);
  assert.equal(normalizeMusicSubmission({ key: 'bad/key', model: 'music', prompt: 'test' }), undefined);
  assert.equal(normalizeMusicReference({ localAudio: 'blob:preview', title: 'file', duration: 10, size: 40 }), undefined);
  assert.equal(normalizeMusicReference({ localAudio, title: 'file', duration: 5, size: 40 }), undefined);
  assert.equal(normalizeMusicReference({ localAudio, title: 'file', duration: NaN, size: 40 }), undefined);
  assert.equal(normalizeMusicReference({ localAudio, title: 'file', duration: 10, size: NaN }), undefined);
  assert.equal(normalizeVoiceDesignSubmission({ key: 'voice-1', model: 'voice', prompt: 'low', previewText: 'hello', extra: true })?.previewText, 'hello');
});

test('TTS settings and frozen submissions validate voice identity and preserve Unicode text', () => {
  const text = '你好🎵'.repeat(12000);
  const normalized = normalizeTTSSubmission({ key: 'tts-1', model: 'minimax-speech-2.8-hd', text, settings: { voice_id: 'voice-1', speed: 1.1, pitch: -2, secret: 'drop' }, upstream_url: 'drop' });
  assert.equal(normalized?.text, text);
  assert.deepEqual(normalized?.settings, { voice_id: 'voice-1', speed: 1.1, pitch: -2 });
  assert.equal(normalizeTTSSubmission({ key: 'tts-2', model: 'tts', text: 'hi', settings: { speed: 1 } }), undefined);
  assert.deepEqual(normalizeTTSSettings({ voice_id: ' voice-2 ', output_format: 'mp3', audio_base64: 'drop' }), { voice_id: ' voice-2 ', output_format: 'mp3' });
  assert.equal(isTTSNode({ audioMode: 'tts' }), true);
  assert.equal(isTTSNode({ audioMode: 'music', audioTaskType: 'tts' }), true);
});

test('audio fingerprints include lyrics, mode, preview text and reference identity', () => {
  const signature = (patch: Partial<CanvasNode>) => audioCreationSignature({ ...node, ...patch }, [music, voice], 'test');
  const initial = signature({});
  assert.notEqual(initial, signature({ musicLyrics: '[Verse] New lyrics' }));
  assert.notEqual(initial, signature({ audioMode: 'voice_design', voicePreviewText: '试听' }));
  assert.notEqual(signature({ audioMode: 'voice_design', voicePreviewText: '试听' }), signature({ audioMode: 'voice_design', voicePreviewText: '另一段' }));
  assert.notEqual(signature({ audioMode: 'tts', text: 'Hello', ttsSettings: { voice_id: 'one' } }), signature({ audioMode: 'tts', text: 'Hello', ttsSettings: { voice_id: 'two' } }));
  assert.notEqual(initial, signature({ musicReference: { localAudio, title: 'reference', duration: 10, size: 40 } }));
  assert.equal(initial, signature({ x: 900, y: 120 }));
  assert.equal(signature({ musicLyrics: 'lyrics' }), signature({ musicLyrics: '  lyrics\n' }));
  assert.equal(signature({ musicSettings: { audio_mode: 'instrumental' }, musicLyrics: 'old lyrics' }), signature({ musicSettings: { audio_mode: 'instrumental' }, musicLyrics: 'unsubmitted new lyrics' }));
});

test('the durable voice task keeps its own API identity when the creator switches modes', () => {
  assert.equal(isVoiceDesignNode({ audioMode: 'music', audioTaskType: 'voice_design' }), true);
  assert.equal(isVoiceDesignNode({ audioMode: 'voice_design', audioTaskType: 'music' }), false);
  assert.equal(isVoiceDesignNode({ audioMode: 'voice_design' }), true);
});

test('voice recovery preserves every character in the original valid Unicode preview', () => {
  const previewText = '🎵'.repeat(500);
  const submission = { key: 'voice-unicode', model: voice.id, prompt: '清晰温暖的声音', previewText };
  assert.equal(normalizeVoiceDesignSubmission(submission)?.previewText, previewText);
  assert.equal(normalizeVoiceDesignSubmission({ ...submission, previewText: previewText + '🎵' })?.previewText, previewText);
});

test('cloud snapshots keep stable audio identities and strip local cache keys and unsolicited base64', () => {
  const document: Document = { id: 'doc', name: 'audio', createdAt: '2026-10-14', updatedAt: '2026-10-14', viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ ...node, taskId: 'accepted-task', localAudio, musicReference: { localAudio, assetId: 'reference-asset', title: 'ref', duration: 10, size: 40 }, musicSubmission: { key: 'submit-1', model: 'music', prompt: 'test', referenceLocalAudio: localAudio, referenceAssetId: 'reference-asset', audio_base64: 'private' } as any }] };
  const saved = storageDocument(document);
  assert.equal(saved.nodes[0].localAudio, undefined);
  assert.equal(saved.nodes[0].musicReference?.localAudio, undefined);
  assert.equal(saved.nodes[0].musicReference?.assetId, 'reference-asset');
  assert.equal(saved.nodes[0].musicSubmission?.referenceLocalAudio, undefined);
  assert.equal(saved.nodes[0].musicSubmission?.referenceAssetId, 'reference-asset');
  assert.equal(JSON.stringify(saved).includes('proxy-canvas:'), false);
  assert.equal(JSON.stringify(saved).includes('private'), false);
  assert.equal((document.nodes[0].musicSubmission as any).audio_base64, 'private');
});
