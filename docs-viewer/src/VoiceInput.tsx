import { useEffect, useRef, useState } from 'react'
import { Mic, Square } from 'lucide-react'
import { startSpeechInput, type SpeechEngineConstructor } from './speech-input'

export function VoiceInput({ disabled, onTranscript, onActiveChange }: {
  disabled: boolean
  onTranscript: (text: string) => void
  onActiveChange: (active: boolean) => void
}) {
  const [state, setState] = useState<'idle' | 'starting' | 'listening' | 'stopping'>('idle')
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  const session = useRef<ReturnType<typeof startSpeechInput> | null>(null)
  const transcriptCallback = useRef(onTranscript)
  transcriptCallback.current = onTranscript
  const active = state !== 'idle'

  useEffect(() => () => {
    session.current?.cancel()
    session.current = null
    onActiveChange(false)
  }, [onActiveChange])

  function toggle() {
    if (active) {
      setState('stopping')
      session.current?.stop()
      return
    }
    setError('')
    const browser = window as Window & { SpeechRecognition?: SpeechEngineConstructor; webkitSpeechRecognition?: SpeechEngineConstructor }
    const Engine = browser.SpeechRecognition || browser.webkitSpeechRecognition
    if (!Engine) {
      setError('当前浏览器不支持语音输入，请使用系统听写或支持语音识别的浏览器。')
      return
    }
    if (!window.isSecureContext) {
      setError('语音输入需要 HTTPS 或本机 localhost 地址。')
      return
    }
    setPreview('')
    setState('starting')
    onActiveChange(true)
    try {
      session.current = startSpeechInput(Engine, {
        onListening: () => setState('listening'),
        onPreview: setPreview,
        onError: setError,
        onComplete: (text) => {
          session.current = null
          setState('idle')
          setPreview('')
          onActiveChange(false)
          if (text.trim()) transcriptCallback.current(text)
        },
      })
    } catch {
      session.current = null
      setState('idle')
      onActiveChange(false)
      setError('无法启动语音输入，请检查麦克风权限或使用系统听写。')
    }
  }

  return <div className="ai-voice-input">
    <button type="button" className={`ai-voice-button${active ? ' is-listening' : ''}`} disabled={(disabled && !active) || state === 'stopping'} onClick={toggle} aria-pressed={active} aria-label={active ? '停止语音输入' : '语音输入'} title={active ? '停止识别并填入草稿' : '语音输入（中文）；浏览器可能使用在线语音服务'}>
      {active ? <Square size={15} /> : <Mic size={17} />}
    </button>
    {active || error ? <div className="ai-voice-status" role={error ? 'alert' : 'status'}>
      <strong>{error || (state === 'starting' ? '正在请求麦克风权限…' : state === 'stopping' ? '正在完成识别…' : '正在聆听…点击麦克风停止')}</strong>
      {preview ? <p>{preview}</p> : null}
      <small>语音仅填入草稿，不会自动发送；浏览器可能使用在线语音服务。</small>
      {error ? <button type="button" onClick={() => setError('')}>关闭提示</button> : null}
    </div> : null}
  </div>
}
