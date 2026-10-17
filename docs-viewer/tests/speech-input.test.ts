import assert from 'node:assert/strict'
import test from 'node:test'
import { appendSpeechDraft, speechErrorMessage, startSpeechInput, type SpeechEngine, type SpeechResult } from '../src/speech-input.ts'

class MockSpeech implements SpeechEngine {
  static current: MockSpeech
  lang = ''
  continuous = false
  interimResults = false
  onstart: SpeechEngine['onstart'] = null
  onresult: SpeechEngine['onresult'] = null
  onerror: SpeechEngine['onerror'] = null
  onend: SpeechEngine['onend'] = null
  aborted = false
  constructor() { MockSpeech.current = this }
  start() { this.onstart?.() }
  stop() { this.onend?.() }
  abort() { this.aborted = true }
}
function result(transcript: string, isFinal: boolean): SpeechResult {
  return { isFinal, 0: { transcript } }
}
function fixture() {
  const completed: string[] = []
  const previews: string[] = []
  const errors: string[] = []
  const session = startSpeechInput(MockSpeech, { onListening() {}, onPreview: (text) => previews.push(text), onComplete: (text) => completed.push(text), onError: (text) => errors.push(text) })
  return { session, engine: MockSpeech.current, completed, previews, errors }
}

test('Chinese speech previews interim text and commits final results once', () => {
  const { session, engine, completed, previews } = fixture()
  assert.equal(engine.lang, 'zh-CN')
  engine.onresult?.({ results: [result('你好', true), result('知识', false)] })
  engine.onresult?.({ results: [result('你好', true), result('知识库', true)] })
  const lateEnd = engine.onend
  session.stop()
  lateEnd?.()
  assert.deepEqual(previews, ['你好知识', '你好知识库'])
  assert.deepEqual(completed, ['你好知识库'])
})

test('switching conversations cancels recognition without leaking a transcript', () => {
  const { session, engine, completed } = fixture()
  const lateResult = engine.onresult
  const lateEnd = engine.onend
  session.cancel()
  lateResult?.({ results: [result('旧会话语音', true)] })
  lateEnd?.()
  assert.deepEqual(completed, [])
  assert.equal(engine.aborted, true)
})

test('permission errors report actionable text and end the session', () => {
  const { engine, errors, completed } = fixture()
  engine.onerror?.({ error: 'not-allowed' })
  assert.match(errors[0], /麦克风权限/)
  assert.deepEqual(completed, [''])
  assert.equal(engine.aborted, true)
})

test('failed sessions preserve confirmed text but not speculative interim results', () => {
  const { engine, completed } = fixture()
  engine.onresult?.({ results: [result('已确认', true), result('不确定', false)] })
  engine.onerror?.({ error: 'network' })
  assert.deepEqual(completed, ['已确认'])
})

test('draft append preserves existing typing and observes the composer limit', () => {
  assert.equal(appendSpeechDraft('原有草稿', '语音'), '原有草稿 语音')
  assert.equal(appendSpeechDraft('原文\n', '语音'), '原文\n语音')
  assert.equal(appendSpeechDraft('原文', '   '), '原文')
  assert.equal(appendSpeechDraft('字'.repeat(3999), '语音').length, 4000)
  assert.match(speechErrorMessage('no-speech'), /没有识别到语音/)
})

test('synchronous startup failures abort the microphone and release handlers', () => {
  class FailedSpeech extends MockSpeech { start() { throw new Error('denied') } }
  assert.throws(() => startSpeechInput(FailedSpeech, { onListening() {}, onPreview() {}, onComplete() {}, onError() {} }), /denied/)
  assert.equal(MockSpeech.current.aborted, true)
  assert.equal(MockSpeech.current.onresult, null)
})
