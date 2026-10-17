const values: Record<string, string> = {}
export const configStorage = {
  getItem(key: string) { try { return values[key] ?? localStorage.getItem(key) } catch { return values[key] ?? null } },
  setItem(key: string, value: string) { values[key] = value; try { localStorage.setItem(key, value) } catch {}; return Promise.resolve() },
  removeItem(key: string) { delete values[key]; try { localStorage.removeItem(key) } catch {}; return Promise.resolve() },
}
export function initializeStorage() { return Promise.resolve() }
