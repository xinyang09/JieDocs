export type SpeechResult = { isFinal: boolean; 0: { transcript: string } }
export type SpeechEngine = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onstart: (() => void) | null
  onresult: ((event: { results: ArrayLike<SpeechResult> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
export type SpeechEngineConstructor = new () => SpeechEngine

export function speechErrorMessage(error: string) {
  const messages: Record<string, string> = {
    'not-allowed': '无法使用麦克风，请允许浏览器和系统的麦克风权限后重试。',
    'service-not-allowed': '当前浏览器未获准使用语音识别服务，请使用系统听写或其他支持的浏览器。',
    'audio-capture': '未检测到可用麦克风，请检查设备连接和系统权限。',
    'no-speech': '没有识别到语音，请点击麦克风重试。',
    network: '无法连接语音识别服务，请检查网络，或使用系统听写。',
    'language-not-supported': '当前语音服务不支持中文，请使用系统听写。',
  }
  return messages[error] || '语音识别未能完成，请重试或使用键盘输入。'
}

export function appendSpeechDraft(draft: string, transcript: string, limit = 4000) {
  const text = transcript.trim()
  if (!text) return draft
  return `${draft}${draft && !/\s$/.test(draft) ? ' ' : ''}${text}`.slice(0, limit)
}

export function startSpeechInput(Engine: SpeechEngineConstructor, callbacks: {
  onListening: () => void
  onPreview: (text: string) => void
  onComplete: (text: string) => void
  onError: (message: string) => void
}) {
  const engine = new Engine()
  let finalText = ''
  let finished = false
  let timer: ReturnType<typeof setTimeout> | undefined
  function detach() {
    clearTimeout(timer)
    engine.onstart = null
    engine.onresult = null
    engine.onerror = null
    engine.onend = null
  }
  function complete() {
    if (finished) return
    finished = true
    detach()
    callbacks.onComplete(finalText)
  }
  engine.lang = 'zh-CN'
  engine.continuous = true
  engine.interimResults = true
  engine.onstart = () => { if (!finished) callbacks.onListening() }
  engine.onresult = (event) => {
    if (finished) return
    const results = Array.from(event.results)
    finalText = results.filter((result) => result.isFinal).map((result) => result[0].transcript).join('')
    callbacks.onPreview(results.map((result) => result[0].transcript).join('').slice(0, 4000))
  }
  engine.onerror = (event) => {
    if (finished) return
    if (event.error !== 'aborted') callbacks.onError(speechErrorMessage(event.error))
    complete()
    try { engine.abort() } catch {}
  }
  engine.onend = complete
  function stop() {
    if (finished) return
    clearTimeout(timer)
    timer = setTimeout(() => { complete(); try { engine.abort() } catch {} }, 3000)
    try { engine.stop() } catch { complete() }
  }
  timer = setTimeout(stop, 60000)
  try { engine.start() } catch (error) {
    finished = true
    detach()
    try { engine.abort() } catch {}
    throw error
  }
  return {
    stop,
    cancel() {
      if (finished) return
      finished = true
      detach()
      try { engine.abort() } catch {}
    },
  }
}
