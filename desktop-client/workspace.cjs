const path = require('path')

function firstConfiguredRoot(env = process.env) {
  return env.FNS_LOCAL_VAULT || ''
}
/** Resolve only an explicitly configured workspace. The desktop client starts
 * empty and asks the user to choose a Markdown folder. */
function resolveWorkspaceRoot({ env = process.env } = {}) {
  const configured = firstConfiguredRoot(env)
  if (configured.trim()) return path.resolve(configured)
  return ''
}

module.exports = { resolveWorkspaceRoot }
