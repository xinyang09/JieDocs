import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Agent as HttpAgent, request as httpRequest } from 'node:http'
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { configKeys, createConfigStore } from './config-store.ts'
import { availablePiModels } from './pi-models.ts'

const connectionKey = 'fns-docs-viewer.connection'
const cookieName = 'fns_docs_viewer'
const maxBodySize = 1024 * 1024
const maxAiContentSize = 120_000
const maxSkillContentSize = 512 * 1024
const maxConcurrentAi = 2
const aiDailyLimit = 100
let activeAiRequests = 0
const aiUsage = new Map<string, { day: string; count: number }>()

type LocalApiOptions = {
  databasePath: string
  baseUrl: string
  defaultVault?: string
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function extractContentText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    const texts: string[] = []
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const item = part as Record<string, unknown>
      if (item.type === 'text' && typeof item.text === 'string') {
        texts.push(item.text)
      } else if (typeof item.text === 'string' && item.type !== 'thinking') {
        texts.push(item.text)
      }
    }
    return texts.join('').trim()
  }
  return ''
}

export function extractPiText(output: string) {
  let agentEndText = ''
  let turnEndText = ''
  let messageEndText = ''
  let lastUpdateText = ''
  const fallbackCandidates: string[] = []

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>
      if (event.type === 'agent_end' && Array.isArray(event.messages)) {
        for (let i = event.messages.length - 1; i >= 0; i -= 1) {
          const msg = event.messages[i] as Record<string, unknown> | undefined
          if (msg && typeof msg === 'object' && msg.role === 'assistant') {
            const text = extractContentText(msg.content)
            if (text) {
              agentEndText = text
              break
            }
          }
        }
      } else if (event.type === 'turn_end') {
        const msg = event.message as Record<string, unknown> | undefined
        if (msg && typeof msg === 'object' && msg.role === 'assistant') {
          const text = extractContentText(msg.content)
          if (text) turnEndText = text
        }
      } else if (event.type === 'message_end') {
        const msg = event.message as Record<string, unknown> | undefined
        if (msg && typeof msg === 'object' && msg.role === 'assistant') {
          const text = extractContentText(msg.content)
          if (text) messageEndText = text
        }
      } else if (event.type === 'message_update') {
        const msg = event.message as Record<string, unknown> | undefined
        if (msg && typeof msg === 'object' && msg.role === 'assistant') {
          const text = extractContentText(msg.content)
          if (text) lastUpdateText = text
        }
      } else {
        const msg = event.message as Record<string, unknown> | undefined
        const role = msg?.role || event.role
        if (role === 'assistant') {
          const text = extractContentText(msg?.content ?? event.content)
          if (text) fallbackCandidates.push(text)
        }
      }
    } catch {
      // Pi may emit informational or diagnostic lines around JSON events; ignore them.
    }
  }

  return agentEndText || turnEndText || messageEndText || lastUpdateText || (fallbackCandidates.length ? fallbackCandidates[fallbackCandidates.length - 1] : '')
}

export interface SkillItem {
  id: string
  key: string
  name: string
  description: string
  path: string
  source: 'workspace' | 'custom' | 'codex' | 'agents' | 'system'
  content?: string
}

function findSkillFile(dirPath: string): string | null {
  try {
    const stat = statSync(dirPath)
    if (!stat.isDirectory()) return null
    const skillMd = join(dirPath, 'SKILL.md')
    if (existsSync(skillMd)) return skillMd
    const skillmdLower = join(dirPath, 'skill.md')
    if (existsSync(skillmdLower)) return skillmdLower
  } catch {
    return null
  }
  return null
}

function parseSkillMetadata(skillFile: string, fallbackName: string): { name: string; description: string; content: string } {
  try {
    const content = readFileSync(skillFile, 'utf-8')
    let name = fallbackName
    let description = ''

    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (fmMatch) {
      const fmLines = fmMatch[1].split('\n')
      for (const line of fmLines) {
        const nMatch = line.match(/^name:\s*(.+)$/i)
        if (nMatch) name = nMatch[1].trim().replace(/^[\"\'\s]+|[\"\'\s]+$/g, '')
        const dMatch = line.match(/^description:\s*(.+)$/i)
        if (dMatch) description = dMatch[1].trim().replace(/^[\"\'\s]+|[\"\'\s]+$/g, '')
      }
    }

    if (!description) {
      const lines = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith('#')) {
          description = trimmed.slice(0, 240)
          break
        }
      }
    }
    return { name, description, content }
  } catch {
    return { name: fallbackName, description: '', content: '' }
  }
}


export function getSkillsInstallDir(): string {
  const envSkills = process.env.SKILLS_DIR || process.env.FNS_SKILLS_DIR
  if (envSkills) {
    const first = envSkills.split(/[:;,]/).map((p) => p.trim()).find(Boolean)
    if (first) return resolve(first)
  }
  const candidates = [
    resolve(process.cwd(), 'skills'),
    resolve(process.cwd(), '..', 'skills'),
    resolve((import.meta.dirname || process.cwd()), '..', 'skills'),
    resolve((import.meta.dirname || process.cwd()), '..', '..', 'skills'),
  ]
  for (const dir of candidates) {
    if (existsSync(dir)) return dir
  }
  return candidates[0]
}

export function listAvailableSkills(): SkillItem[] {
  const home = homedir()
  const candidateDirs: Array<{ source: SkillItem['source']; dir: string }> = []

  // 1. 环境变量自定义目录（支持 Docker 挂载卷或生产服务器自定义路径，多个路径以冒号/分号/逗号分隔）
  const envSkills = process.env.SKILLS_DIR || process.env.FNS_SKILLS_DIR
  if (envSkills) {
    const paths = envSkills.split(/[:;,]/).map((p) => p.trim()).filter(Boolean)
    for (const p of paths) {
      candidateDirs.push({ source: 'custom', dir: p })
    }
  }

  // 2. 项目内建/工作区技能目录（随代码仓库或构建包直接交付，服务器开箱即用）
  const workspaceDirs = [
    join(process.cwd(), 'skills'),
    join(process.cwd(), 'docs', 'skills'),
    join(process.cwd(), '..', 'skills'),
    join(process.cwd(), '..', 'docs', 'skills'),
    join((import.meta.dirname || process.cwd()), '..', 'skills'),
    join((import.meta.dirname || process.cwd()), '..', '..', 'docs', 'skills'),
    join((import.meta.dirname || process.cwd()), '..', '..', 'skills'),
  ]
  const seenDirs = new Set<string>()
  for (const dir of workspaceDirs) {
    if (existsSync(dir) && !seenDirs.has(dir)) {
      seenDirs.add(dir)
      candidateDirs.push({ source: 'workspace', dir })
    }
  }

  // 3. Linux/Unix 服务器标准系统服务路径
  const systemServerDirs = [
    '/var/lib/fast-note/skills',
    '/etc/fns/skills',
  ]
  for (const dir of systemServerDirs) {
    if (existsSync(dir) && !seenDirs.has(dir)) {
      seenDirs.add(dir)
      candidateDirs.push({ source: 'custom', dir })
    }
  }

  // 4. 宿主机个人目录（仅在显式配置 SCAN_HOST_SKILLS=true 的本地调试时生效，默认不侵入系统内部目录）
  if (process.env.SCAN_HOST_SKILLS === 'true') {
    candidateDirs.push(
      { source: 'codex', dir: join(home, '.codex/skills') },
      { source: 'agents', dir: join(home, '.agents/skills') },
    )
  }

  const skills: SkillItem[] = []
  const seenNames = new Set<string>()

  for (const { source, dir } of candidateDirs) {
    if (!existsSync(dir)) continue
    let entries: string[] = []
    try { entries = readdirSync(dir) } catch { continue }
    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      const fullPath = join(dir, entry)
      const skillFile = findSkillFile(fullPath)
      if (skillFile) {
        const meta = parseSkillMetadata(skillFile, entry)
        const normName = (meta.name || entry).trim().toLowerCase()
        if (seenNames.has(normName)) continue
        seenNames.add(normName)
        skills.push({
          id: `${source}:${entry}`,
          key: entry,
          name: meta.name || entry,
          description: meta.description,
          path: fullPath,
          source,
          content: meta.content,
        })
      }
    }
  }

  return skills.sort((a, b) => {
    const priorityMap: Record<string, number> = {
      workspace: 1,
      custom: 2,
      codex: 3,
      agents: 4,
      system: 5,
    }
    const prioA = priorityMap[a.source] ?? 99
    const prioB = priorityMap[b.source] ?? 99
    if (prioA !== prioB) return prioA - prioB
    return a.name.localeCompare(b.name, 'zh-CN')
  })
}

export function streamPi(
  prompt: string,
  callbacks: {
    onChunk: (text: string) => void
    onError: (error: Error) => void
    onDone: (text: string) => void
  },
  options?: {
    thinking?: string
    skills?: string[]
    provider?: string
    model?: string
  }
) {
  const args = ['-p', prompt, '--mode', 'json', '--no-tools', '--no-session']
  if (options?.provider && options?.model) args.push('--provider', options.provider, '--model', options.model)
  if (options?.thinking) {
    args.push('--thinking', options.thinking)
  }
  if (Array.isArray(options?.skills)) {
    for (const skillPath of options.skills) {
      if (typeof skillPath === 'string' && skillPath.trim()) {
        args.push('--skill', skillPath.trim())
      }
    }
  }
  const child = spawn(process.env.PI_BIN || 'pi', args, {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdoutBuffer = ''
  let stderr = ''
  let latestText = ''
  let isDone = false

  const timer = setTimeout(() => {
    if (!isDone) {
      isDone = true
      child.kill('SIGTERM')
      callbacks.onError(new Error('Pi 请求超时。'))
    }
  }, 90_000)

  function processLine(line: string) {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>
      let text = ''
      if (event.type === 'message_update' || event.type === 'message_end' || event.type === 'turn_end') {
        const msg = event.message as Record<string, unknown> | undefined
        if (msg && typeof msg === 'object' && msg.role === 'assistant') {
          text = extractContentText(msg.content)
        }
      } else if (event.type === 'agent_end' && Array.isArray(event.messages)) {
        for (let i = event.messages.length - 1; i >= 0; i -= 1) {
          const msg = event.messages[i] as Record<string, unknown> | undefined
          if (msg && typeof msg === 'object' && msg.role === 'assistant') {
            text = extractContentText(msg.content)
            if (text) break
          }
        }
      } else {
        const msg = event.message as Record<string, unknown> | undefined
        const role = msg?.role || event.role
        if (role === 'assistant') {
          text = extractContentText(msg?.content ?? event.content)
        }
      }
      if (text && text !== latestText) {
        latestText = text
        callbacks.onChunk(text)
      }
    } catch {
      // Ignore non-JSON lines or diagnostic warnings
    }
  }

  child.stdout.on('data', (chunk) => {
    stdoutBuffer += String(chunk)
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() || ''
    for (const line of lines) {
      processLine(line)
    }
  })

  child.stderr.on('data', (chunk) => {
    stderr += String(chunk)
  })

  child.once('error', (error) => {
    clearTimeout(timer)
    if (!isDone) {
      isDone = true
      callbacks.onError(error)
    }
  })

  child.once('close', (code, signal) => {
    clearTimeout(timer)
    if (isDone) return
    isDone = true
    if (stdoutBuffer.trim()) {
      processLine(stdoutBuffer.trim())
    }
    if (signal) {
      callbacks.onError(new Error('Pi 请求超时。'))
      return
    }
    if (code !== 0 && !latestText) {
      callbacks.onError(new Error(stderr.trim() || `Pi exited with code ${code}.`))
      return
    }
    if (!latestText) {
      callbacks.onError(new Error('Pi 没有返回可读内容。'))
      return
    }
    callbacks.onDone(latestText)
  })

  return () => {
    if (!isDone) {
      isDone = true
      clearTimeout(timer)
      child.kill('SIGTERM')
    }
  }
}

function runPi(prompt: string, options?: { thinking?: string; skills?: string[]; provider?: string; model?: string }) {
  return new Promise<string>((resolve, reject) => {
    streamPi(prompt, {
      onChunk: () => {},
      onError: reject,
      onDone: resolve,
    }, options)
  })
}

function sessionIdFrom(req: IncomingMessage) {
  const value = req.headers.cookie?.split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
  return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined
}

function isSameOrigin(req: IncomingMessage) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  if (!req.headers.origin) return true
  try {
    return new URL(req.headers.origin).host === req.headers.host
  } catch {
    return false
  }
}

async function readBody(req: IncomingMessage) {
  if (Number(req.headers['content-length']) > maxBodySize) throw new Error('Configuration is too large.')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > maxBodySize) throw new Error('Configuration is too large.')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function normalizeValue(key: string, value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new Error('Configuration must be JSON.')
  const parsed = JSON.parse(value)
  if (key !== connectionKey) return JSON.stringify(parsed)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid connection.')
  const url = new URL(parsed.baseUrl)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid FNS service address.')
  const user = parsed.user && typeof parsed.user === 'object' ? parsed.user : undefined
  // Persist only connection fields, never a submitted account password.
  return JSON.stringify({
    baseUrl: url.toString().replace(/\/$/, ''),
    token: typeof parsed.token === 'string' ? parsed.token : '',
    clientType: typeof parsed.clientType === 'string' ? parsed.clientType : 'webgui',
    defaultVault: typeof parsed.defaultVault === 'string' ? parsed.defaultVault : '',
    ...(user ? { user: {
      uid: user.uid,
      username: user.username,
      email: user.email,
      tokenId: user.tokenId,
      avatar: user.avatar,
    } } : {}),
  })
}

export function createLocalApi(options: LocalApiOptions) {
  const store = createConfigStore(options.databasePath)
  const httpAgent = new HttpAgent({ keepAlive: true, maxSockets: 8 })
  const httpsAgent = new HttpsAgent({ keepAlive: true, maxSockets: 8 })
  const defaultConnection = JSON.stringify({
    baseUrl: options.baseUrl.replace(/\/$/, ''),
    token: '',
    clientType: 'webgui',
    defaultVault: options.defaultVault || '',
  })

  async function configuration(req: IncomingMessage, res: ServerResponse) {
    if (!isSameOrigin(req) || req.headers['x-docs-viewer'] !== '1') {
      sendJson(res, 403, { message: 'Only same-origin application requests are allowed.' })
      return
    }
    let sessionId = sessionIdFrom(req)
    if (!sessionId && req.method !== 'GET') {
      sendJson(res, 401, { message: 'Please reload the application.' })
      return
    }
    if (req.method === 'GET') {
      sessionId ||= randomBytes(32).toString('hex')
      const secure = 'encrypted' in req.socket && req.socket.encrypted ? '; Secure' : ''
      res.setHeader('Set-Cookie', `${cookieName}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure}`)
      sendJson(res, 200, {
        values: store.read(sessionId),
        defaults: { [connectionKey]: defaultConnection },
      })
      return
    }
    if (req.method !== 'PUT') {
      res.setHeader('Allow', 'GET, PUT')
      sendJson(res, 405, { message: 'Method not allowed.' })
      return
    }
    if (!req.headers['content-type']?.startsWith('application/json')) {
      sendJson(res, 415, { message: 'JSON is required.' })
      return
    }
    let key: string
    let value: string | null
    try {
      const body = await readBody(req)
      if (!body || typeof body !== 'object' || !('key' in body) || !('value' in body) || typeof body.key !== 'string' || !configKeys.has(body.key)) {
        throw new Error('Unknown configuration key.')
      }
      key = body.key
      value = normalizeValue(key, body.value)
    } catch {
      sendJson(res, 400, { message: 'Invalid configuration.' })
      return
    }
    store.write(sessionId!, key, value)
    sendJson(res, 200, { value })
  }

  async function piAi(req: IncomingMessage, res: ServerResponse) {
    const sessionId = sessionIdFrom(req)
    if (!isSameOrigin(req) || !sessionId) {
      sendJson(res, 401, { message: 'Please reload the application.' })
      return
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      sendJson(res, 405, { message: 'Method not allowed.' })
      return
    }
    if (!req.headers['content-type']?.startsWith('application/json')) {
      sendJson(res, 415, { message: 'JSON is required.' })
      return
    }
    try {

      if (activeAiRequests >= maxConcurrentAi) { sendJson(res, 429, { message: 'AI 服务繁忙，请稍后重试。' }); return }
      const usageKey = sessionId
      const day = new Date().toISOString().slice(0, 10)
      const usage = aiUsage.get(usageKey)
      const count = usage?.day === day ? usage.count : 0
      if (count >= aiDailyLimit) { sendJson(res, 429, { message: `今日 AI 使用次数已达上限（${aiDailyLimit} 次）。` }); return }
      aiUsage.set(usageKey, { day, count: count + 1 })
      activeAiRequests += 1
      res.once('close', () => { activeAiRequests = Math.max(0, activeAiRequests - 1) })
      const body = await readBody(req)
      if (!body || typeof body !== 'object') throw new Error('Invalid request.')
      const input = body as Record<string, unknown>
      const instruction = typeof input.instruction === 'string' ? input.instruction.trim() : ''
      const provider = typeof input.provider === 'string' ? input.provider : ''
      const model = typeof input.model === 'string' ? input.model : ''
      if (provider || model) {
        if (!provider || !model || provider.length > 200 || model.length > 300 || provider.startsWith('-') || model.startsWith('-')) throw new Error('Invalid request.')
        const models = await availablePiModels()
        if (!models.some((item) => item.provider === provider && item.id === model)) {
          sendJson(res, 400, { message: '所选模型不可用，请刷新模型列表后重新选择。' })
          return
        }
      }
      const content = typeof input.content === 'string' ? input.content : ''
      const title = typeof input.title === 'string' ? input.title.trim().slice(0, 200) : ''
      if (!instruction || instruction.length > 12_000 || content.length > maxAiContentSize) throw new Error('Invalid request.')
      const requestedSkills = Array.isArray(input.skills)
        ? (input.skills.filter((s) => typeof s === 'string' && s.trim()) as string[])
        : []

      const availableSkills = listAvailableSkills()
      const validSkillPaths: string[] = []
      const loadedSkillSummaries: string[] = []

      for (const skillReq of requestedSkills) {
        const found = availableSkills.find((s) => s.id === skillReq || s.path === skillReq || s.name === skillReq)
        if (found && existsSync(found.path)) {
          if (!validSkillPaths.includes(found.path)) {
            validSkillPaths.push(found.path)
            loadedSkillSummaries.push(`- ${found.name}: ${found.description || '遵循该技能专业指导规范'}`)
          }
        }
      }

      let skillPromptAddon = ''
      if (loadedSkillSummaries.length > 0) {
        skillPromptAddon = `\n\n【已挂载技能库 (Skills)】\n请在回答或编辑时严格遵循以下专业技能规范与最佳实践：\n${loadedSkillSummaries.join('\n')}`
      }

      const prompt = content
        ? `You are the AI assistant inside a Markdown notes app. Return only the requested result, with no preamble.\n\nInstruction: ${instruction}${skillPromptAddon}\n\nNote title: ${title || '(untitled)'}\n\nNote content:\n${content}`
        : `You are the AI assistant inside a Markdown notes app. Return only the requested result, with no preamble.\n\nInstruction: ${instruction}${skillPromptAddon}\n\nNote title: ${title || '(untitled)'}`
      const wantsStream = Boolean(input.stream) || Boolean(req.headers.accept?.includes('text/event-stream'))

      const thinkingMode = input.thinking === 'high' || input.thinking === true || input.thinking === 'on' ? 'high' : (input.thinking === 'off' || input.thinking === false ? 'off' : undefined)

      if (wantsStream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        })
        const cancel = streamPi(prompt, {
          onChunk: (text) => {
            if (!res.writableEnded) {
              res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`)
            }
          },
          onError: (error) => {
            if (!res.writableEnded) {
              const code = (error as NodeJS.ErrnoException).code
              const msg = code === 'ENOENT' ? '未检测到 Pi。请先安装 Pi 并确保 pi 命令在 PATH 中。' : error.message
              res.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`)
              res.end()
            }
          },
          onDone: (text) => {
            if (!res.writableEnded) {
              res.write(`data: ${JSON.stringify({ type: 'done', text })}\n\n`)
              res.end()
            }
          },
        }, { thinking: thinkingMode, skills: validSkillPaths, provider, model })
        res.on('close', () => {
          if (!res.writableFinished) cancel()
        })
      } else {
        const text = await runPi(prompt, { thinking: thinkingMode, skills: validSkillPaths, provider, model })
        res.setHeader('X-AI-Usage-Daily-Limit', String(aiDailyLimit))
        res.setHeader('X-AI-Usage-Daily-Count', String(aiUsage.get(sessionId)?.count || 0))
        sendJson(res, 200, { text })
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (error instanceof Error && error.message === 'Invalid request.') sendJson(res, 400, { message: 'AI 请求无效。' })
      else if (code === 'ENOENT') sendJson(res, 404, { message: '未检测到 Pi。请先安装 Pi 并确保 pi 命令在 PATH 中。' })
      else sendJson(res, 502, { message: error instanceof Error ? error.message : 'Pi 请求失败。' })
    }
  }


  
async function installSkillHandler(req: IncomingMessage, res: ServerResponse) {
    const sessionId = sessionIdFrom(req)
    if (!isSameOrigin(req) || !sessionId) {
      sendJson(res, 401, { message: 'Please reload the application.' })
      return
    }

    let body: any
    try {
      body = await readBody(req)
    } catch {
      sendJson(res, 400, { message: '请求格式错误。' })
      return
    }
    if (!body || typeof body !== 'object') {
      sendJson(res, 400, { message: '参数格式无效。' })
      return
    }

    let { name, title, description, content, url, repo } = body as {
      name?: string
      title?: string
      description?: string
      content?: string
      url?: string
      repo?: string
    }

    let finalContent = typeof content === 'string' ? content.trim() : ''
    let skillName = typeof name === 'string' ? name.trim() : ''
    let skillDesc = typeof description === 'string' ? description.trim() : ''

    // Skill installation is intentionally local-only. The viewer must not turn
    // an authenticated browser session into an arbitrary outbound fetcher.
    // Remote sources can be fetched by a separately authenticated FNS service
    // and then submitted as reviewed content.
    if ((typeof url === 'string' && url.trim()) || (typeof repo === 'string' && repo.trim())) {
      sendJson(res, 400, { message: '本地查看器不支持联网安装技能，请提供已审核的 SKILL.md 内容。' })
      return
    }

    const sanitizedName = (skillName || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
    if (!sanitizedName || sanitizedName.length > 40) {
      sendJson(res, 400, { message: '技能标识必须为 1-40 位英文字母、数字或短横线。' })
      return
    }

    if (!finalContent) {
      sendJson(res, 400, { message: '技能内容 (SKILL.md) 不能为空。' })
      return
    }
    if (Buffer.byteLength(finalContent, 'utf8') > maxSkillContentSize) {
      sendJson(res, 413, { message: `技能内容不能超过 ${maxSkillContentSize} 字节。` })
      return
    }

    if (!/^---[\s\S]*?---/.test(finalContent)) {
      const desc = (skillDesc || title || sanitizedName).replace(/[\r\n]+/g, ' ')
      finalContent = `---\nname: ${sanitizedName}\ndescription: ${desc}\nversion: 1.0.0\n---\n\n${title ? `# ${title}\n\n` : ''}${finalContent}`
    } else if (!/^---[\s\S]*?name:\s*[^\r\n]+[\s\S]*?---/m.test(finalContent)) {
      finalContent = finalContent.replace(/^---/, `---\nname: ${sanitizedName}`)
    }
    if (Buffer.byteLength(finalContent, 'utf8') > maxSkillContentSize) {
      sendJson(res, 413, { message: `技能内容不能超过 ${maxSkillContentSize} 字节。` })
      return
    }

    const installRoot = resolve(getSkillsInstallDir())
    let canonicalRoot: string
    try {
      mkdirSync(installRoot, { recursive: true })
      canonicalRoot = realpathSync(installRoot)
    } catch {
      sendJson(res, 500, { message: '技能目录不可用。' })
      return
    }
    const targetDir = resolve(canonicalRoot, sanitizedName)
    const relativeTarget = relative(canonicalRoot, targetDir)
    if (!relativeTarget || isAbsolute(relativeTarget) || relativeTarget.startsWith(`..${sep}`) || relativeTarget === '..') {
      sendJson(res, 400, { message: '非法的技能保存路径。' })
      return
    }

    try {
      if (existsSync(targetDir) && lstatSync(targetDir).isSymbolicLink()) {
        sendJson(res, 400, { message: '技能保存路径不能是符号链接。' })
        return
      }
      mkdirSync(targetDir, { recursive: true })
      const skillTarget = join(targetDir, 'SKILL.md')
      if (existsSync(skillTarget) && lstatSync(skillTarget).isSymbolicLink()) {
        sendJson(res, 400, { message: '技能文件不能是符号链接。' })
        return
      }
      writeFileSync(skillTarget, finalContent, 'utf8')
    } catch (err) {
      sendJson(res, 500, { message: '保存技能文件失败。' })
      return
    }

    const allSkills = listAvailableSkills()
    const savedSkill = allSkills.find((s) => s.key === sanitizedName || s.name === sanitizedName) || {
      id: `workspace:${sanitizedName}`,
      key: sanitizedName,
      name: sanitizedName,
      description: skillDesc || sanitizedName,
      path: targetDir,
      source: 'workspace',
      content: finalContent,
    }

    sendJson(res, 200, {
      message: `技能 "${sanitizedName}" 安装成功！`,
      skill: savedSkill,
      skills: allSkills,
    })
  }

  function getSkills(req: IncomingMessage, res: ServerResponse) {
    const sessionId = sessionIdFrom(req)
    if (!isSameOrigin(req) || !sessionId) {
      sendJson(res, 401, { message: 'Please reload the application.' })
      return
    }
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      sendJson(res, 405, { message: 'Method not allowed.' })
      return
    }
    const skills = listAvailableSkills()
    sendJson(res, 200, { skills })
  }

  /**
   * Forward a request to the configured FNS service. The browser only sends a
   * local session cookie to this process; when it does not include an
   * Authorization header, use the token stored in that session's connection
   * record. This is what makes same-origin canonical AI calls work without
   * exposing the configured token to the page.
   */
  function proxy(req: IncomingMessage, res: ServerResponse, routePrefix = '/fns-proxy', allowedPathPrefix?: string) {
    const sessionId = sessionIdFrom(req)
    if (!isSameOrigin(req) || !sessionId) {
      sendJson(res, 401, { message: 'Please reload the application.' })
      return
    }
    const connection = JSON.parse(store.read(sessionId)[connectionKey] || defaultConnection)
    const path = (req.url || '').slice(routePrefix.length)
    if (!path.startsWith('/api/')) {
      sendJson(res, 404, { message: 'Not found.' })
      return
    }
    const pathName = path.split('?')[0]
    if (allowedPathPrefix && !(pathName === allowedPathPrefix || pathName.startsWith(`${allowedPathPrefix}/`))) {
      sendJson(res, 404, { message: 'Not found.' })
      return
    }
    if (!connection || typeof connection.baseUrl !== 'string' || !connection.baseUrl.trim()) {
      sendJson(res, 503, { message: '未配置 FNS 服务地址。' })
      return
    }
    const target = new URL(path, connection.baseUrl)
    if (!['http:', 'https:'].includes(target.protocol)) {
      sendJson(res, 400, { message: 'FNS 服务地址必须使用 HTTP 或 HTTPS。' })
      return
    }
    const client = target.protocol === 'https:' ? httpsRequest : httpRequest
    const configuredToken = typeof connection.token === 'string' ? connection.token.trim() : ''
    const authorization = req.headers.authorization || (configuredToken
      ? (configuredToken.startsWith('Bearer ') ? configuredToken : `Bearer ${configuredToken}`)
      : '')
    const upstream = client(target, {
      method: req.method,
      timeout: 15000,
      agent: target.protocol === 'https:' ? httpsAgent : httpAgent,
      headers: {
        ...(authorization ? { Authorization: authorization } : {}),
        Accept: req.headers.accept || 'application/json',
        ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}),
        ...(req.headers['content-length'] ? { 'Content-Length': req.headers['content-length'] } : {}),
        ...(req.headers['idempotency-key'] ? { 'Idempotency-Key': req.headers['idempotency-key'] } : {}),
        ...(req.headers['last-event-id'] ? { 'Last-Event-ID': req.headers['last-event-id'] } : {}),
        'X-Client': req.headers['x-client'] || 'webgui',
        'X-Client-Name': 'FNS Docs Viewer',
        'User-Agent': req.headers['user-agent'] || 'FNS Docs Viewer',
      },
    }, (response) => {
      const headers: Record<string, string | number | string[]> = { 'Cache-Control': 'no-store' }
      for (const name of ['content-type', 'content-length', 'etag', 'last-modified', 'content-disposition']) {
        const value = response.headers[name]
        if (value !== undefined) headers[name] = value
      }
      res.writeHead(response.statusCode || 502, headers)
      response.pipe(res)
      response.on('error', () => res.destroy())
    })
    upstream.on('timeout', () => upstream.destroy(new Error('Upstream timeout.')))
    upstream.on('error', () => {
      if (res.headersSent) res.destroy()
      else sendJson(res, 502, { message: 'The local proxy could not reach the FNS service.' })
    })
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy()
    })
    req.pipe(upstream)
  }

  return {
    middleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
      const path = (req.url || '/').split('?')[0]
      if (path === '/viewer-config') {
        void configuration(req, res).catch(() => {
          if (!res.headersSent) sendJson(res, 500, { message: 'Could not access the local SQLite database.' })
        })
      } else if (path === '/pi-skills') {
        res.setHeader('Deprecation', 'true')
        res.setHeader('X-AI-Endpoint', '/api/ai/skills')
        if (req.method === 'POST') {
          void installSkillHandler(req, res)
        } else {
          getSkills(req, res)
        }
      } else if (path === '/pi-skills/install') {
        res.setHeader('Deprecation', 'true')
        res.setHeader('X-AI-Endpoint', '/api/ai/skills')
        void installSkillHandler(req, res)
      } else if (path === '/pi-models') {
        res.setHeader('Deprecation', 'true')
        res.setHeader('X-AI-Endpoint', '/api/ai/models')
        if (req.method !== 'GET') {
          res.setHeader('Allow', 'GET')
          sendJson(res, 405, { message: 'Method not allowed.' })
        } else if (!isSameOrigin(req) || !sessionIdFrom(req)) {
          sendJson(res, 401, { message: 'Please reload the application.' })
        } else {
          res.setHeader('Cache-Control', 'no-store')
          void availablePiModels().then((models) => sendJson(res, 200, { models }))
            .catch((error: Error) => sendJson(res, 503, { message: error.message }))
        }
      } else if (path === '/pi-ai') {
        res.setHeader('Deprecation', 'true')
        res.setHeader('X-AI-Endpoint', '/api/ai/execute')
        void piAi(req, res)
      } else if (path === '/api/ai' || path.startsWith('/api/ai/')) {
        // Canonical AI endpoints are always forwarded to the authenticated FNS
        // service. Keep this route narrow so the local viewer cannot become a
        // general-purpose proxy through arbitrary /api paths.
        try {
          proxy(req, res, '', '/api/ai')
        } catch {
          sendJson(res, 500, { message: 'Could not read the local connection configuration.' })
        }
      } else if (path.startsWith('/fns-proxy/')) {
        try {
          proxy(req, res)
        } catch {
          sendJson(res, 500, { message: 'Could not read the local connection configuration.' })
        }
      } else next()
    },
    close() {
      httpAgent.destroy()
      httpsAgent.destroy()
      store.close()
    },
  }
}
