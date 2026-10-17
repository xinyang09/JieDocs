import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const configKeys = new Set([
  'fns-docs-viewer.connection',
  'fns-docs-viewer.settings',
  'fns-docs-viewer.workspace',
  'fns-docs-viewer.favorites',
  'fns-docs-viewer.recents',
  'fns-docs-viewer.quick-links',
])

export function createConfigStore(filename: string) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(filename)
  if (filename !== ':memory:') chmodSync(filename, 0o600)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS viewer_config (
      session_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (session_id, key)
    );
  `)
  const select = db.prepare('SELECT key, value FROM viewer_config WHERE session_id = ?')
  const upsert = db.prepare(`
    INSERT INTO viewer_config (session_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT (session_id, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `)
  const remove = db.prepare('DELETE FROM viewer_config WHERE session_id = ? AND key = ?')

  return {
    read(sessionId: string): Record<string, string> {
      return Object.fromEntries(select.all(sessionId).map((row) => [String(row.key), String(row.value)]))
    },
    write(sessionId: string, key: string, value: string | null) {
      if (!configKeys.has(key)) throw new Error('Unknown configuration key.')
      if (value === null) remove.run(sessionId, key)
      else upsert.run(sessionId, key, value)
    },
    close() {
      db.close()
    },
  }
}
