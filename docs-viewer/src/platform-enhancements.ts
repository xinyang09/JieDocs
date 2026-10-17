import type { LucideIcon } from 'lucide-react'
import { Send, ShieldCheck } from 'lucide-react'

export type PlatformPluginId = 'fns.transfer' | 'fns.twofa'

export type PlatformEnhancementDefinition = {
  id: PlatformPluginId
  name: string
  description: string
  icon: LucideIcon
  mode: 'platform-enhancement'
  surface: 'docs-viewer'
  permissions: string[]
}

export const platformEnhancements: PlatformEnhancementDefinition[] = [
  {
    id: 'fns.twofa',
    name: '2FA 验证码',
    description: '安全保存验证器密钥并生成动态验证码。',
    icon: ShieldCheck,
    mode: 'platform-enhancement',
    surface: 'docs-viewer',
    permissions: ['twofa_r', 'twofa_w'],
  },
  {
    id: 'fns.transfer',
    name: '外部文档发布',
    description: '通过 Transfer 将 Markdown 笔记创建到飞书或 Notion。',
    icon: Send,
    mode: 'platform-enhancement',
    surface: 'docs-viewer',
    permissions: ['transfer_r', 'transfer_w', 'note_r'],
  },
]
