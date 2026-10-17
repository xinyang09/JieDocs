const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const knownAgents = [
  { id: 'pi', label: 'Pi', adapter: 'pi' },
  { id: 'claude', label: 'Claude Code', adapter: 'mirasim' },
  { id: 'codex', label: 'Codex', adapter: 'mirasim' },
  { id: 'kimi', label: 'Kimi Code', adapter: 'mirasim' },
  { id: 'gemini', label: 'Gemini CLI', adapter: 'mirasim' },
  { id: 'qwen', label: 'Qwen Code', adapter: 'mirasim' },
]

function executable(pathname) {
  try { return fs.statSync(pathname).isFile() && (process.platform === 'win32' || (fs.statSync(pathname).mode & 0o111) !== 0) } catch { return false }
}

function findOnPath(command, env = process.env) {
  const pathValue = env.PATH || ''
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, command)
    if (executable(candidate)) return candidate
  }
  return ''
}

function readVersion(command) {
  try {
    const output = execFileSync(command, ['--version'], { encoding: 'utf8', timeout: 2500, stdio: ['ignore', 'pipe', 'ignore'] })
    return String(output).trim().split(/\r?\n/)[0].slice(0, 120)
  } catch { return '' }
}

function discoverLocalAgents({ env = process.env } = {}) {
  const configured = env.FNS_LOCAL_AGENT || env.PI_BIN || ''
  const result = []
  const seen = new Set()
  function add(item) {
    if (!item.command || seen.has(item.command)) return
    seen.add(item.command)
    result.push(item)
  }
  if (configured.trim()) {
    const command = path.isAbsolute(configured) ? configured : findOnPath(configured, env) || configured
    add({ id: 'configured', label: path.basename(command), command, version: readVersion(command), detected: executable(command), supported: true, adapter: 'pi', configured: true })
  }
  const mirasim = path.join(os.homedir(), '.mirasim', 'bin', 'mirasim')
  const hasMirasim = executable(mirasim)
  for (const agent of knownAgents) {
    const command = findOnPath(agent.id, env)
    if (command) add({ ...agent, command, version: readVersion(command), detected: true, supported: agent.adapter === 'pi' || hasMirasim, configured: command === configured })
  }
  return result
}

module.exports = { discoverLocalAgents }
