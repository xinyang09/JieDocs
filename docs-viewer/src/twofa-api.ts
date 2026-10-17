import { fnsHeaders } from './api'
import type { Connection } from './types'

export type TwoFAAccount = {
  id: string
  name: string
  account: string
  algorithm: string
  digits: number
  period: number
  code: string
  expiresAt: number
}

export type TwoFAInput = Omit<TwoFAAccount, 'id' | 'code' | 'expiresAt'> & { secret: string }
export type TwoFASnapshot = { accounts: TwoFAAccount[]; serverTime: number }

export function remainingSeconds(expiresAt: number, now: number) {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000))
}

export function formatCode(code: string) {
  const middle = Math.ceil(code.length / 2)
  return `${code.slice(0, middle)} ${code.slice(middle)}`
}

export async function twoFARequest<Result>(connection: Connection, method: string, id = '', input?: TwoFAInput, signal?: AbortSignal): Promise<Result> {
  const response = await fetch(`/api/twofa${id ? `/${encodeURIComponent(id)}` : ''}`, {
    method,
    signal,
    cache: 'no-store',
    headers: { ...fnsHeaders(connection), ...(input ? { 'Content-Type': 'application/json' } : {}) },
    ...(input ? { body: JSON.stringify(input) } : {}),
  })
  const payload = await response.json().catch(() => null) as { status: boolean; message?: string; data: Result } | null
  if (!response.ok || !payload?.status) throw new Error(payload?.message || `2FA 请求失败（HTTP ${response.status}），请确认服务已更新并登录。`)
  return payload.data
}
