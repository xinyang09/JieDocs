import React, { cloneElement, isValidElement, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ClipboardEvent as ReactClipboardEvent, ComponentPropsWithoutRef, CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import XdbPage from './XdbPage'
import AiChatWorkspace from './AiChatWorkspace'
import AiSurface from './AiSurface'
import AiProviderSettings from './AiProviderSettings'
import { CloudSyncClient, CloudSyncError, type CloudSyncDevice } from './cloud-sync-client'
import type { InlineAiRequest } from './InlineAiAssistant'
import TwoFAPage from './TwoFAPage'
import remarkGfm from 'remark-gfm'
import type { WorkBook } from 'xlsx'
import type { LucideIcon } from 'lucide-react'
import {
  cleanCodeLanguage,
  inferCodeLanguage,
  highlightCode,
  renderCodeBlockHtml,
} from './syntax-highlight'
import { CodeBlockComponent } from './CodeBlock'
import { DocumentOutline } from './DocumentOutline'
import { codeLanguageLabel, openCodeLanguageMenu } from './code-language-menu'
import { slugify, extractHeadings, getNodeText } from './markdown-outline'
import { makeDocumentTabKey, readDocumentTabs, saveDocumentTabs, restoredActiveTab, type SavedDocumentTab } from './document-tabs'
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ArrowRight,
  AlignCenter,
  AlignLeft,
  AlignRight,
  CalendarDays,
  ChartNoAxesGantt,
  BookOpenText,
  Bold,
  Check,
  ClipboardCopy,
  ClipboardPaste,
  Columns3,
  Command,
  ListChecks,
  List,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Brain,
  Bot,
  CircleAlert,
  Copy,
  Database,
  Download,
  Eraser,
  Eye,
  File,
  FilePlus2,
  Image,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Grid3X3,
  Italic,
  KeyRound,
  Lock,
  Unlock,
  LayoutPanelLeft,
  LogIn,
  LogOut,
  LoaderCircle,
  ListOrdered,
  Maximize2,
  MessageCircle,
  MessageCirclePlus,
  MoreHorizontal,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PaintBucket,
  Percent,
  Presentation,
  Scissors,
  Strikethrough,
  Redo2,
  RefreshCw,
  Save,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  Plus,
  Settings2,
  Smile,
  Sun,
  Star,
  Type,
  Clock3,
  Trash2,
  Undo2,
  Underline,
  Upload,
  UserRound,
  WrapText,
  ZoomIn,
  ZoomOut,
  Puzzle,
  X,
} from 'lucide-react'
import { format as formatSpreadsheetNumber } from 'ssf'
import { fileEndpoint, filePreviewEndpoint, fnsHeaders, FnsApiError, fnsApi, getAIModels, getAvailableSkills, installSkill, runPiAssistant, uploadFile, type SkillItem } from './api'
import { commitAIProposal } from './ai-stream'
import { configStorage } from './storage'
import { appendMarkdownTask, nextTaskDocumentPath } from './task-create'
import { readTaskDates, toggleMarkdownTaskLine, type TaskSchedule } from './task-dates'
import { searchTaskDocuments, taskDocumentPickerPosition as positionTaskDocumentPicker } from './task-document-picker'
import { cleanMarkdownText, applyDocumentInstruction, isDocumentEditIntent, parseDocumentCreateIntent, parseDocumentDeleteIntent, prepareDocumentEdit, splitFrontmatter } from './ai-edit'
import { rawNoteSelectionRange } from './ai-selection'
import { VaultSwitcher } from './VaultSwitcher'
import { createBlankFile, newFileTypeOptions, type NewFileType } from './file-create'
import { chatDocumentKey, loadChatDocumentContext, type ChatDocument } from './chat-documents'
import { chatModelKey, chatModelLabel, chatModelProviderLabel, readChatHistory, readChatModel, type ChatModel, type ChatSession } from './ai-chat'
import { ChatDocumentChips, ChatDocumentPicker } from './ChatDocumentPicker'
import { groupTaskBoard, type TaskBoardGrouping, type TaskBoardPriority } from './task-board'
import { coverUploadPath, updateFrontmatterCover } from './document-cover'
import { DOCUMENT_ICONS_STORAGE_KEY, documentIconCategoryTabs, findDocumentIconOptions, getDocumentIconFromMap, loadDocumentIcons, migrateDocumentIconInMap, normalizeDocumentIcon, persistDocumentIcons, removeDocumentIconsUnderPath, writeDocumentIcon, type DocumentIconKind, type DocumentIconMap } from './document-icon'
import type { Connection, FileSummary, FolderNode, LibraryItem, Note, NoteSummary, Share, Vault } from './types'
import { platformEnhancements, type PlatformPluginId } from './platform-enhancements'
import TransferPluginPanel from './TransferPluginPanel'

const UniverFileEditor = lazy(() => import('./UniverFileEditor'))

const STORAGE_KEY = 'fns-docs-viewer.connection'
const SETTINGS_STORAGE_KEY = 'fns-docs-viewer.settings'
const WORKSPACE_STORAGE_KEY = 'fns-docs-viewer.workspace'
const FAVORITES_STORAGE_KEY = 'fns-docs-viewer.favorites'
const RECENTS_STORAGE_KEY = 'fns-docs-viewer.recents'
const QUICK_LINKS_STORAGE_KEY = 'fns-docs-viewer.quick-links'

const sampleDocument = `# 欢迎使用文档台

登录 Fast Note Sync Service 账号后，即可在这里管理你的 Vault 文档。

## 阅读方式

- 在左侧按目录浏览
- 新建、编辑、重命名或删除 Markdown 文档
- 为单篇文档创建带访问密码的分享链接

\`\`\`text
GET /api/vault
GET /api/notes?vault={vault}
GET /api/note?vault={vault}&path={path}
\`\`\`
`

type DesktopRuntime = { isDesktop?: boolean; isLocal?: boolean; localAgent?: boolean; baseUrl?: string; token?: string; localVault?: string; localRoot?: string; openLocalFolder?: () => Promise<unknown>; listLocalAgents?: () => Promise<unknown>; getLocalAgentState?: () => Promise<unknown>; selectLocalAgent?: (command: string) => Promise<unknown> }

function getDesktopRuntime(): DesktopRuntime {
  return (window as Window & { fnsDesktop?: DesktopRuntime }).fnsDesktop || {}
}

function loadConnection(): Connection {
  const desktopRuntime = getDesktopRuntime()
  const defaultBaseUrl = desktopRuntime.baseUrl || window.location.origin
  try {
    const stored = JSON.parse(configStorage.getItem(STORAGE_KEY) || '{}') as Partial<Connection>
    const storedLocal = stored.clientType === 'desktop-local'
    return {
      baseUrl: defaultBaseUrl,
      token: (!desktopRuntime.isLocal && storedLocal) ? desktopRuntime.token || '' : stored.token || desktopRuntime.token || (desktopRuntime.isLocal ? 'local' : ''),
      clientType: (!desktopRuntime.isLocal && storedLocal) ? 'webgui' : stored.clientType || (desktopRuntime.isLocal ? 'desktop-local' : 'webgui'),
      defaultVault: stored.defaultVault || desktopRuntime.localVault || import.meta.env.VITE_FNS_VAULT || '',
      user: desktopRuntime.isLocal ? undefined : (!desktopRuntime.isLocal && storedLocal) ? undefined : stored.user,
    }
  } catch {
    return { baseUrl: import.meta.env.VITE_FNS_BASE_URL || defaultBaseUrl, token: desktopRuntime.isLocal ? 'local' : '', clientType: desktopRuntime.isLocal ? 'desktop-local' : 'webgui', defaultVault: desktopRuntime.localVault || '', user: undefined }
  }
}

type ThemePreference = 'light' | 'dark' | 'system'
type ReaderFontSize = 'small' | 'medium' | 'large'
type AuthState = 'checking' | 'authenticated' | 'signed-out'

type SystemSettings = {
  theme: ThemePreference
  density: 'comfortable' | 'compact'
  readerFontSize: ReaderFontSize
  showOutline: boolean
  sidebarOpen: boolean
  directorySort: DirectorySortMode
  useFolderCache: boolean
  searchShortcut: string
}

const defaultSystemSettings: SystemSettings = {
  theme: 'light',
  density: 'comfortable',
  readerFontSize: 'medium',
  showOutline: true,
  sidebarOpen: true,
  directorySort: 'name-asc',
  useFolderCache: true,
  searchShortcut: 'k',
}

function loadSystemSettings(): SystemSettings {
  try {
    const stored = JSON.parse(configStorage.getItem(SETTINGS_STORAGE_KEY) || '{}') as Partial<SystemSettings>
    return { ...defaultSystemSettings, ...stored }
  } catch {
    return defaultSystemSettings
  }
}

type WorkspaceState = {
  expandedFolders: string[]
  folderPath: string
  vaultName?: string
  activeSidebarTab?: SidebarTab
  selectedKind?: LibraryItem['kind']
  selectedPath?: string
  openTabs?: SavedDocumentTab[]
  activeTabKey?: string
}

function loadWorkspaceState(): WorkspaceState {
  if (getDesktopRuntime().isLocal) return { expandedFolders: [], folderPath: '' }
  try {
    const stored = JSON.parse(configStorage.getItem(WORKSPACE_STORAGE_KEY) || '{}') as Partial<WorkspaceState>
    return {
      expandedFolders: Array.isArray(stored.expandedFolders) ? stored.expandedFolders.filter((path): path is string => typeof path === 'string') : [],
      folderPath: typeof stored.folderPath === 'string' ? stored.folderPath : '',
      vaultName: typeof stored.vaultName === 'string' ? stored.vaultName : undefined,
      activeSidebarTab: stored.activeSidebarTab === 'files' || stored.activeSidebarTab === 'search' || stored.activeSidebarTab === 'favorites' || stored.activeSidebarTab === 'recents' || stored.activeSidebarTab === 'tasks' || stored.activeSidebarTab === 'platform-enhancements' || stored.activeSidebarTab === 'skills' || stored.activeSidebarTab === 'ai-chat' || stored.activeSidebarTab === 'twofa' ? stored.activeSidebarTab : undefined,
      selectedKind: stored.selectedKind === 'file' || stored.selectedKind === 'note' ? stored.selectedKind : undefined,
      selectedPath: typeof stored.selectedPath === 'string' ? stored.selectedPath : undefined,
      openTabs: readDocumentTabs(stored.openTabs),
      activeTabKey: typeof stored.activeTabKey === 'string' ? stored.activeTabKey : undefined,
    }
  } catch {
    return { expandedFolders: [], folderPath: '' }
  }
}

type LocalDocumentRef = { vault: string; kind: LibraryItem['kind']; path: string; title: string; visitedAt: number }

function WorkspaceHome({
  vaultName,
  noteCount,
  openTaskCount,
  favoriteCount,
  enabledSkillCount,
  recents,
  onOpenRecent,
  onOpenLocal,
  onCreate,
  onSearch,
  onTasks,
  onFavorites,
  onSkills,
  getIcon,
}: {
  vaultName: string
  noteCount: number
  openTaskCount: number
  favoriteCount: number
  enabledSkillCount: number
  recents: LocalDocumentRef[]
  onOpenRecent: (item: LocalDocumentRef) => void
  onOpenLocal?: () => void
  onCreate: () => void
  onSearch: () => void
  onTasks: () => void
  onFavorites: () => void
  onSkills: () => void
  getIcon: (kind: DocumentIconKind, path: string, vault?: string) => string | undefined
}) {
  const recentItems = recents.filter((item) => item.vault === vaultName).slice(0, 4)
  return (
    <div className="workspace-home" aria-label="文档工作台">
      <section className="workspace-home-hero">
        <div>
          <span className="workspace-home-kicker"><FolderOpen size={14} />{vaultName || '知识库'}</span>
          <h1>工作台</h1>
          <p>{vaultName ? `正在使用「${vaultName}」知识库。选择一篇文档开始阅读，或直接创建新的记录。` : onOpenLocal ? '打开一个本地 Markdown 文件夹，文档会出现在这里。' : '连接 FNS 服务后，你的文档、任务和 AI 工具会在这里汇聚。'}</p>
        </div>
        {vaultName ? (
          <div className="workspace-home-actions">
            <button type="button" className="workspace-home-primary" onClick={onCreate}><Plus size={16} />新建文档</button>
            {onOpenLocal ? <button type="button" className="secondary-button" onClick={onOpenLocal}><FolderOpen size={15} />切换本地目录</button> : null}
          </div>
        ) : onOpenLocal ? (
          <button type="button" className="workspace-home-primary" onClick={onOpenLocal}><FolderOpen size={16} />打开本地目录</button>
        ) : null}
      </section>

      <section className="workspace-home-metrics" aria-label="工作区概览">
        <button type="button" className="workspace-home-metric" onClick={onSearch}>
          <span className="workspace-home-metric-icon"><FileText size={16} /></span>
          <span><strong>{noteCount}</strong><small>篇文档</small></span>
          <ArrowRight size={15} />
        </button>
        <button type="button" className="workspace-home-metric" onClick={onTasks}>
          <span className="workspace-home-metric-icon is-warning"><ListChecks size={16} /></span>
          <span><strong>{openTaskCount}</strong><small>项待办</small></span>
          <ArrowRight size={15} />
        </button>
        <button type="button" className="workspace-home-metric" onClick={onFavorites}>
          <span className="workspace-home-metric-icon is-accent"><Star size={16} /></span>
          <span><strong>{favoriteCount}</strong><small>个收藏</small></span>
          <ArrowRight size={15} />
        </button>
        <button type="button" className="workspace-home-metric" onClick={onSkills}>
          <span className="workspace-home-metric-icon is-ai"><Sparkles size={16} /></span>
          <span><strong>{enabledSkillCount}</strong><small>项 AI 技能</small></span>
          <ArrowRight size={15} />
        </button>
      </section>

      <section className="workspace-home-grid">
        <div className="workspace-home-panel workspace-home-recent-panel">
          <header className="workspace-home-panel-heading">
            <div><h2><Clock3 size={16} />最近访问</h2></div>
            <button type="button" className="workspace-home-link" onClick={onSearch}>查看全部<ArrowRight size={14} /></button>
          </header>
          {recentItems.length ? (
            <div className="workspace-home-recent-list">
              {recentItems.map((item) => (
                <button type="button" className="workspace-home-recent-item" key={`${item.vault}:${item.path}`} onClick={() => onOpenRecent(item)} title={item.path}>
                  <span className="workspace-home-recent-icon"><DocumentRefIcon kind={item.kind} path={item.path} icon={getIcon(item.kind, item.path, item.vault)} /></span>
                  <span className="workspace-home-recent-copy">
                    <span className="workspace-home-recent-title-line">
                      <strong>{documentDisplayTitle(item.kind, item.path)}</strong>
                      <DocumentTypeTag kind={item.kind} path={item.path} />
                    </span>
                    <small>{parentPath(item.path) || '根目录'}</small>
                  </span>
                  <ArrowRight size={14} />
                </button>
              ))}
            </div>
          ) : (
            <div className="workspace-home-empty"><Clock3 size={20} /><p>还没有最近访问记录</p><span>打开一篇文档后，它会出现在这里。</span></div>
          )}
        </div>

        <div className="workspace-home-panel workspace-home-command-panel">
          <h2><Command size={16} />快速开始</h2>
          <div className="workspace-home-command-list">
            <button type="button" onClick={onSearch}><Search size={15} /><span><strong>检索知识库</strong><small>跨目录查找标题和正文</small></span><kbd>⌘ K</kbd></button>
            <button type="button" onClick={onTasks}><ListChecks size={15} /><span><strong>查看任务</strong><small>按列表、看板或日历整理待办</small></span><kbd>G T</kbd></button>
            <button type="button" onClick={onCreate} disabled={!vaultName}><Plus size={15} /><span><strong>创建文档</strong><small>从空白 Markdown 开始记录</small></span><kbd>⌘ N</kbd></button>
          </div>
        </div>
      </section>
    </div>
  )
}

type DocumentTab = SavedDocumentTab & {
  note?: Note
  file?: FileSummary
  skill?: SkillItem
}

function loadLocalRefs(key: string): LocalDocumentRef[] {
  try {
    const value = JSON.parse(configStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value.filter((item): item is LocalDocumentRef => item && typeof item.vault === 'string' && typeof item.path === 'string' && (item.kind === 'note' || item.kind === 'file')) : []
  } catch {
    return []
  }
}

type QuickLinksState = {
  favoritesOpen: boolean
  recentsOpen: boolean
}

function loadQuickLinksState(): QuickLinksState {
  try {
    const stored = JSON.parse(configStorage.getItem(QUICK_LINKS_STORAGE_KEY) || '{}') as Partial<QuickLinksState>
    return {
      favoritesOpen: stored.favoritesOpen !== false,
      recentsOpen: stored.recentsOpen !== false,
    }
  } catch {
    return { favoritesOpen: true, recentsOpen: true }
  }
}

function documentTitle(path: string) {
  return path.split('/').pop()?.replace(/\.md$/i, '') || path
}

function documentDisplayTitle(kind: 'note' | 'file', path: string) {
  const name = path.split('/').pop() || path
  const extension = (kind === 'note' ? /\.md$/i : /\.[a-z0-9]+$/i).exec(name)
  return extension && extension.index > 0 ? name.slice(0, extension.index) : name
}

function documentDisplayPath(kind: 'note' | 'file', path: string) {
  const folder = parentPath(path)
  const title = documentDisplayTitle(kind, path)
  return folder ? `${folder}/${title}` : title
}

function documentTypeLabel(kind: 'note' | 'file', path: string) {
  if (kind === 'note') return 'MD'
  const fileName = path.split('/').pop() || ''
  const extension = /\.([a-z0-9]+)$/i.exec(fileName)
  return extension && extension.index > 0 ? extension[1].toUpperCase() : 'FILE'
}

function DocumentTypeTag({ kind, path }: { kind: 'note' | 'file'; path: string }) {
  const label = documentTypeLabel(kind, path)
  return <span className={`document-type-tag type-${label.toLowerCase()}`} title={`文件类型：${label}`} aria-label={`文件类型：${label}`}>{label}</span>
}

function isUniverFilePath(path: string) {
  return /\.(?:doc|docx|xls|xlsx|xlsm|csv|tsv|ppt|pptx)$/i.test(path.split('?')[0])
}

function isYamlPath(path: string) {
  return /\.(?:yaml|yml)$/i.test(path.split('?')[0])
}

type SidebarTab = 'files' | 'search' | 'favorites' | 'recents' | 'tasks' | 'platform-enhancements' | 'skills' | 'ai-chat' | 'twofa'

function formatTime(value?: number | string) {
  if (!value) return '未记录'
  const timestamp = typeof value === 'string' ? Date.parse(value) : value
  if (!Number.isFinite(timestamp)) return String(value)
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
}

type TaskItem = {
  id: string
  path: string
  title: string
  lineIndex: number
  text: string
  rawText: string
  completed: boolean
  priority: TaskPriority
  dueDate?: string
  startTime?: string
  endTime?: string
  createdDate?: string
  completedDate?: string
}

type TaskMarkdownEditState = {
  task: TaskItem
  note: Note | null
  isLoading: boolean
  error: string
}

type TaskView = 'list' | 'board' | 'calendar' | 'gantt'
type TaskPriority = TaskBoardPriority
type CalendarRange = 'day' | 'week' | 'month'

function startOfTaskWeek(date: Date) {
  const weekStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))
  return weekStart
}

function taskDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

type CalendarTaskDay = { date: Date; key: string; tasks: TaskItem[] }

function taskTimeMinutes(value?: string) {
  if (!value) return null
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return minutes >= 0 && minutes < 24 * 60 ? minutes : null
}

function timedTasksForHour(day: CalendarTaskDay, hour: number) {
  return day.tasks
    .filter((task) => {
      const start = taskTimeMinutes(task.startTime)
      return start !== null && Math.floor(start / 60) === hour
    })
    .sort((left, right) => (taskTimeMinutes(left.startTime) || 0) - (taskTimeMinutes(right.startTime) || 0))
}

function timedTaskStyle(task: TaskItem, hour: number, index: number) {
  const start = taskTimeMinutes(task.startTime) ?? hour * 60
  const end = taskTimeMinutes(task.endTime) ?? start + 60
  const duration = Math.max(30, end - start)
  return {
    top: `${((start - hour * 60) / 60) * 52 + 4}px`,
    height: `${Math.max(42, (duration / 60) * 52 - 8)}px`,
    zIndex: 10 + index,
  }
}

const taskPriorityMarkers: Record<TaskPriority, string> = {
  urgent: '🔺',
  high: '⏫',
  medium: '🔼',
  normal: '',
  low: '🔽',
  lowest: '⏬',
}
const taskPriorityLabels: Record<TaskPriority, string> = {
  urgent: '紧急',
  high: '高',
  medium: '中',
  normal: '普通',
  low: '低',
  lowest: '最低',
}
const taskPriorityMarkerPattern = /(?:^|\s)(🔺|⏫|🔼|🔽|⏬|🔻)\s*$/u

function parseTaskPriority(text: string): TaskPriority {
  const marker = taskPriorityMarkerPattern.exec(text)?.[1]
  if (marker === '🔺') return 'urgent'
  if (marker === '⏫') return 'high'
  if (marker === '🔼') return 'medium'
  if (marker === '🔽') return 'low'
  if (marker === '⏬' || marker === '🔻') return 'lowest'
  return 'normal'
}

function stripTaskPriority(text: string) {
  return text.replace(taskPriorityMarkerPattern, '').trimEnd()
}

function extractMarkdownTasks(path: string, content: string): TaskItem[] {
  const tasks: TaskItem[] = []
  let fence: { character: string; length: number } | null = null
  content.replace(/\r\n/g, '\n').split('\n').forEach((line, lineIndex) => {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fenceMatch) {
      if (!fence) {
        fence = { character: fenceMatch[1][0], length: fenceMatch[1].length }
      } else if (fenceMatch[1][0] === fence.character && fenceMatch[1].length >= fence.length && !fenceMatch[2].trim()) {
        fence = null
      }
      return
    }
    if (fence) return
    if (/^(?: {4}|\t)/.test(line)) return
    const match = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*?)\s*$/)
    if (!match) return
    const rawText = match[2]
    const dates = readTaskDates(rawText, path)
    tasks.push({
      id: `${path}:${lineIndex}`,
      path,
      title: documentTitle(path),
      lineIndex,
      rawText,
      text: stripTaskPriority(dates.text),
      completed: match[1].toLowerCase() === 'x',
      priority: parseTaskPriority(rawText),
      dueDate: dates.dueDate,
      startTime: dates.startTime,
      endTime: dates.endTime,
      createdDate: dates.createdDate,
      completedDate: dates.completedDate,
    })
  })
  return tasks
}

function TaskPanel({
  folders: _folders,
  tasks,
  scope = '',
  status,
  query,
  isLoading,
  progress,
  onScopeChange: _onScopeChange,
  onStatusChange,
  onQueryChange,
  onOpen,
  onToggle,
  onPriorityChange,
  taskDocuments,
  onAddTask,
}: {
  folders?: FolderNode[]
  tasks: TaskItem[]
  scope?: string
  status: 'all' | 'open' | 'done'
  query: string
  isLoading: boolean
  progress: string
  onScopeChange?: (scope: string) => void
  onStatusChange: (status: 'all' | 'open' | 'done') => void
  onQueryChange: (query: string) => void
  onOpen: (task: TaskItem) => void
  onToggle: (task: TaskItem) => void
  onPriorityChange: (task: TaskItem, priority: TaskPriority) => void
  taskDocuments: string[]
  onAddTask: (text: string, targetPath: string, folder: string, schedule?: TaskSchedule) => Promise<string>
}) {
  // Open the task workspace on the schedule view so the weekly timeline is
  // immediately visible when the Vault already has scheduled tasks. A task
  // workspace with only undated tasks is more useful in the grouped list;
  // users can still switch to the calendar at any time.
  const [view, setView] = useState<TaskView>('calendar')
  const viewTouchedRef = useRef(false)
  const [collapsedTaskPaths, setCollapsedTaskPaths] = useState<Set<string>>(() => new Set())
  const [boardGrouping, setBoardGrouping] = useState<TaskBoardGrouping>(() => {
    try { return localStorage.getItem('fns-docs-viewer.task-board-grouping') === 'status' ? 'status' : 'priority' } catch { return 'priority' }
  })
  const [priorityMenu, setPriorityMenu] = useState<{ taskId: string; top: number; left: number; activeIndex: number } | null>(null)
  const [isAddTaskOpen, setIsAddTaskOpen] = useState(false)
  const [newTaskText, setNewTaskText] = useState('')
  const [newTaskDueDate, setNewTaskDueDate] = useState('')
  const [newTaskStartTime, setNewTaskStartTime] = useState('09:00')
  const [newTaskEndTime, setNewTaskEndTime] = useState('10:00')
  const [newTaskTarget, setNewTaskTarget] = useState('')
  const [isAddingTask, setIsAddingTask] = useState(false)
  const [newTaskError, setNewTaskError] = useState('')
  const [isDocumentPickerOpen, setIsDocumentPickerOpen] = useState(false)
  const [newTaskDocumentQuery, setNewTaskDocumentQuery] = useState('')
  const [activeDocumentIndex, setActiveDocumentIndex] = useState(0)
  const [taskDocumentPickerPosition, setTaskDocumentPickerPosition] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)
  const taskAddButtonRef = useRef<HTMLButtonElement>(null)
  const taskDialogRef = useRef<HTMLFormElement>(null)
  const taskDocumentPickerRef = useRef<HTMLDivElement>(null)
  const calendarFilterRef = useRef<HTMLDivElement>(null)
  const priorityMenuRef = useRef<HTMLDivElement>(null)
  const priorityAnchorRef = useRef<HTMLButtonElement | null>(null)
  const newTaskFolder = scope
  const tasksViewRef = useRef<HTMLDivElement>(null)
  function changeBoardGrouping(grouping: TaskBoardGrouping) {
    setBoardGrouping(grouping)
    try { localStorage.setItem('fns-docs-viewer.task-board-grouping', grouping) } catch {}
  }
  const [calendarRange, setCalendarRange] = useState<CalendarRange>('week')
  const [calendarDate, setCalendarDate] = useState(() => new Date())
  const [selectedCalendarDateKey, setSelectedCalendarDateKey] = useState(() => taskDateKey(new Date()))
  const [isCalendarFilterOpen, setIsCalendarFilterOpen] = useState(false)
  const needle = query.trim().toLowerCase()
  const visibleTasks = tasks.filter((task) => {
    if (status === 'open' && task.completed) return false
    if (status === 'done' && !task.completed) return false
    return !needle || `${task.text} ${task.path}`.toLowerCase().includes(needle)
  })
  const taskDocumentOptions = useMemo(() => Array.from(new Set(taskDocuments)).sort((left, right) => directoryCollator.compare(documentTitle(left), documentTitle(right))), [taskDocuments])
  const taskDocumentSearch = useMemo(() => searchTaskDocuments(taskDocumentOptions, newTaskDocumentQuery), [newTaskDocumentQuery, taskDocumentOptions])
  const filteredTaskDocumentOptions = taskDocumentSearch.paths
  const newTaskTimeError = newTaskStartTime && newTaskEndTime && newTaskEndTime <= newTaskStartTime ? '结束时间必须晚于开始时间。' : ''
  const canSubmitNewTask = Boolean(newTaskText.trim()) && !newTaskTimeError && !isAddingTask && (!newTaskDocumentQuery.trim() || Boolean(newTaskTarget))
  const filteredTasks = visibleTasks
  const openCount = tasks.filter((task) => !task.completed).length
  const doneCount = tasks.length - openCount
  const groupedTasks = Array.from(filteredTasks.reduce((groups, task) => {
    const group = groups.get(task.path) || { path: task.path, tasks: [] as TaskItem[] }
    group.tasks.push(task)
    groups.set(task.path, group)
    return groups
  }, new Map<string, { path: string; tasks: TaskItem[] }>()).values())
  function toggleTaskGroup(path: string) {
    priorityAnchorRef.current = null
    setPriorityMenu(null)
    setCollapsedTaskPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const overdueTasks = filteredTasks.filter((task) => !task.completed && Boolean(task.dueDate && task.dueDate < todayKey))
  const dueTodayTasks = filteredTasks.filter((task) => !task.completed && task.dueDate === todayKey)
  const priorityRank: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, normal: 3, low: 4, lowest: 5 }
  const sortBoardTasks = (boardTasks: TaskItem[]) => [...boardTasks].sort((left, right) => {
    if (!left.completed && !right.completed) {
      const leftOverdue = Boolean(left.dueDate && left.dueDate < todayKey)
      const rightOverdue = Boolean(right.dueDate && right.dueDate < todayKey)
      if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1
      if (left.dueDate !== right.dueDate) return (left.dueDate || '9999-99-99').localeCompare(right.dueDate || '9999-99-99')
      if (priorityRank[left.priority] !== priorityRank[right.priority]) return priorityRank[left.priority] - priorityRank[right.priority]
    }
    if (left.completed !== right.completed) return left.completed ? 1 : -1
    return left.text.localeCompare(right.text, 'zh-CN')
  })
  const completedCount = filteredTasks.filter((task) => task.completed).length
  const boardColumns = groupTaskBoard(filteredTasks, boardGrouping).map((column) => ({ ...column, tasks: sortBoardTasks(column.tasks) }))
  const boardColumnLabel = (key: 'open' | 'done' | TaskPriority) => key === 'open' ? '待办' : key === 'done' ? '已完成' : taskPriorityLabels[key]
  const boardColumnDescription = (key: 'open' | 'done' | TaskPriority) => {
    if (boardGrouping === 'status') return key === 'open' ? (overdueTasks.length ? `${overdueTasks.length} 项逾期优先` : '按优先级和到期日排序') : '已完成的任务'
    return key === 'urgent' ? '需要立即处理' : key === 'high' ? '重要任务' : key === 'medium' ? '近期推进' : key === 'normal' ? '常规任务' : key === 'low' ? '低优先级' : '可延后处理'
  }
  const scheduledTasks = filteredTasks.filter((task) => task.dueDate)
  const unscheduledTasks = filteredTasks.filter((task) => !task.dueDate)
  const offGridTimedTasks = scheduledTasks.filter((task) => {
    const start = taskTimeMinutes(task.startTime)
    return start !== null && (start < 8 * 60 || start >= 21 * 60)
  })
  const calendarWeekStart = startOfTaskWeek(calendarDate)
  const weekDates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(calendarWeekStart.getFullYear(), calendarWeekStart.getMonth(), calendarWeekStart.getDate() + index)
    const key = taskDateKey(date)
    return { date, key, tasks: sortBoardTasks(scheduledTasks.filter((task) => task.dueDate === key)) }
  })
  const weekEnd = weekDates[weekDates.length - 1].date
  const weekTaskList = weekDates.flatMap((day) => day.tasks)
  const calendarDateKey = taskDateKey(calendarDate)
  const calendarMonthStart = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1)
  const calendarMonthEnd = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 0)
  const calendarMonthLeadingDays = (calendarMonthStart.getDay() + 6) % 7
  const calendarMonthCellCount = Math.ceil((calendarMonthLeadingDays + calendarMonthEnd.getDate()) / 7) * 7
  const calendarMonthDays = Array.from({ length: calendarMonthCellCount }, (_, index) => {
    if (index < calendarMonthLeadingDays || index >= calendarMonthLeadingDays + calendarMonthEnd.getDate()) return null
    const date = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), index - calendarMonthLeadingDays + 1)
    const key = taskDateKey(date)
    return { date, key, tasks: sortBoardTasks(scheduledTasks.filter((task) => task.dueDate === key)) }
  })
  const selectedCalendarDate = weekDates.find((day) => day.key === selectedCalendarDateKey) || weekDates[0]
  const selectedCalendarTasks = calendarRange === 'day'
    ? sortBoardTasks(scheduledTasks.filter((task) => task.dueDate === calendarDateKey))
    : selectedCalendarDate.tasks
  const calendarTaskList = calendarRange === 'day' ? selectedCalendarTasks : calendarRange === 'month' ? calendarMonthDays.flatMap((day) => day?.tasks || []) : weekTaskList
  const weekLabel = calendarWeekStart.getFullYear() === weekEnd.getFullYear() && calendarWeekStart.getMonth() === weekEnd.getMonth()
    ? `${calendarWeekStart.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })} ${calendarWeekStart.getDate()} — ${weekEnd.getDate()}日`
    : `${calendarWeekStart.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })} — ${weekEnd.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })}`
  const taskWeekdays = ['一', '二', '三', '四', '五', '六', '日']
  const taskWeekHours = Array.from({ length: 13 }, (_, index) => index + 8)
  const timelineDates = scheduledTasks.length ? scheduledTasks.map((task) => task.dueDate!).sort() : []
  const timelineStart = timelineDates[0] || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
  const timelineEnd = timelineDates[timelineDates.length - 1] || timelineStart
  const startMs = Date.parse(`${timelineStart}T00:00:00`)
  const endMs = Date.parse(`${timelineEnd}T00:00:00`)
  const timelineSpan = Math.max(1, Math.round((endMs - startMs) / 86400000))
  const ganttScale = timelineSpan > 42 ? 'month' : 'day'
  const ganttStartDate = new Date(`${timelineStart}T00:00:00`)
  const ganttEndDate = new Date(`${timelineEnd}T00:00:00`)
  const ganttTicks = (() => {
    const dates: Date[] = []
    if (ganttScale === 'day') {
      for (let index = 0; index <= timelineSpan; index += 1) {
        dates.push(new Date(ganttStartDate.getFullYear(), ganttStartDate.getMonth(), ganttStartDate.getDate() + index))
      }
    } else {
      let cursor = new Date(ganttStartDate.getFullYear(), ganttStartDate.getMonth(), 1)
      while (cursor <= ganttEndDate) {
        dates.push(cursor)
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
      }
    }
    return dates.length ? dates : [ganttStartDate]
  })()
  const ganttTickCount = ganttTicks.length
  const priorityValues = Object.keys(taskPriorityLabels) as TaskPriority[]
  useEffect(() => {
    // The initial task scan is asynchronous. Once it finishes, avoid opening
    // an empty time grid when the current date range has no scheduled tasks;
    // the grouped list gives the user an immediately useful overview. Respect
    // an explicit user choice made while the scan was running.
    if (viewTouchedRef.current || isLoading || !tasks.length || calendarTaskList.length) return
    setView('list')
  }, [calendarTaskList.length, isLoading, tasks])

  function selectTaskView(next: TaskView) {
    viewTouchedRef.current = true
    setView(next)
  }

  function moveCalendar(delta: number) {
    const nextDate = calendarRange === 'day'
      ? new Date(calendarDate.getFullYear(), calendarDate.getMonth(), calendarDate.getDate() + delta)
      : calendarRange === 'month'
        ? new Date(calendarDate.getFullYear(), calendarDate.getMonth() + delta, 1)
        : new Date(calendarDate.getFullYear(), calendarDate.getMonth(), calendarDate.getDate() + (delta * 7))
    setCalendarDate(nextDate)
    setSelectedCalendarDateKey(taskDateKey(nextDate))
  }
  function changeCalendarRange(range: CalendarRange) {
    setCalendarRange(range)
    setSelectedCalendarDateKey(taskDateKey(calendarDate))
    setIsCalendarFilterOpen(false)
  }
  function priorityMenuPosition(target: HTMLElement) {
    const rect = target.getBoundingClientRect()
    const menuHeight = 232
    const top = rect.bottom + 6 + menuHeight > window.innerHeight - 12 ? Math.max(12, rect.top - menuHeight - 6) : rect.bottom + 6
    return { top, left: Math.max(8, Math.min(window.innerWidth - 132, rect.right - 118)) }
  }
  function movePriorityMenu(task: TaskItem, target: HTMLButtonElement, delta: number) {
    const currentIndex = priorityMenu?.taskId === task.id ? priorityMenu.activeIndex : priorityValues.indexOf(task.priority)
    const activeIndex = Math.max(0, Math.min(priorityValues.length - 1, currentIndex + delta))
    priorityAnchorRef.current = target
    setPriorityMenu((current) => current?.taskId === task.id
      ? { ...current, activeIndex }
      : { taskId: task.id, ...priorityMenuPosition(target), activeIndex })
  }
  function togglePriorityMenu(task: TaskItem, target: HTMLButtonElement) {
    if (priorityMenu?.taskId === task.id) {
      setPriorityMenu(null)
      return
    }
    priorityAnchorRef.current = target
    setPriorityMenu({ taskId: task.id, ...priorityMenuPosition(target), activeIndex: Math.max(0, priorityValues.indexOf(task.priority)) })
  }
  const renderTask = (task: TaskItem, compact = false, board = false) => (
    <div key={task.id} className={`task-card task-card-priority-${task.priority} ${task.startTime ? 'is-timed' : ''} ${task.completed ? 'is-completed' : ''} ${compact ? 'is-compact' : ''}`}>
      <input type="checkbox" checked={task.completed} onChange={() => onToggle(task)} aria-label={`${task.completed ? '标记未完成' : '完成'}：${task.text}`} />
      <button type="button" className="task-card-main" onClick={() => onOpen(task)} title={`${task.path} · 第 ${task.lineIndex + 1} 行`}>
        <span className="task-card-text">{task.text}</span>
        {!board ? <span className="task-card-meta">{task.title !== task.dueDate ? <span>{task.title}</span> : null}{task.dueDate ? <time dateTime={task.dueDate}>{task.dueDate}</time> : null}{task.startTime ? <span className="task-time-range">{task.startTime}{task.endTime ? `–${task.endTime}` : ''}</span> : null}{task.createdDate ? <time className="task-created-date" dateTime={task.createdDate}>{`创建于 ${task.createdDate}`}</time> : <span className="task-created-date">创建日期未记录</span>}{task.completed ? (task.completedDate ? <time className="task-completed-date" dateTime={task.completedDate}>{`完成于 ${task.completedDate}`}</time> : <span className="task-completed-date">已完成</span>) : null}</span> : null}
        {board ? <span className="task-card-board-info">{task.dueDate ? <span className={task.dueDate < todayKey && !task.completed ? 'is-overdue' : task.dueDate === todayKey && !task.completed ? 'is-today' : ''}>{task.dueDate === todayKey ? '今天到期' : task.dueDate < todayKey && !task.completed ? '已逾期' : `到期 ${task.dueDate}`}</span> : <span>未设置日期</span>}<span className="task-board-source">{task.title}</span></span> : null}
      </button>
      <button type="button" className={`task-priority-picker is-${task.priority}`} data-task-id={task.id} onClick={(event) => { event.stopPropagation(); togglePriorityMenu(task, event.currentTarget) }} onKeyDown={(event) => {
        if (event.key === 'Escape' && priorityMenu?.taskId === task.id) {
          event.preventDefault()
          setPriorityMenu(null)
          return
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          event.stopPropagation()
          movePriorityMenu(task, event.currentTarget, event.key === 'ArrowDown' ? 1 : -1)
        }
      }} aria-expanded={priorityMenu?.taskId === task.id} aria-haspopup="listbox" aria-label={`设置优先级：${task.text}`} title={`优先级：${taskPriorityLabels[task.priority]}`}>
        <span aria-hidden="true">{taskPriorityLabels[task.priority]}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
    </div>
  )
  useEffect(() => {
    if (tasksViewRef.current) tasksViewRef.current.scrollTop = 0
    // A filter or view change invalidates the anchored task row. Close the
    // portal before the old trigger disappears so focus never lands on stale UI.
    setPriorityMenu(null)
    setIsCalendarFilterOpen(false)
  }, [view, calendarDate, calendarRange, query, status, tasks.length])
  function openTaskComposer() {
    setNewTaskTarget('')
    setNewTaskDocumentQuery('')
    setActiveDocumentIndex(0)
    setIsDocumentPickerOpen(false)
    setNewTaskText('')
    setNewTaskDueDate(view === 'calendar' ? taskDateKey(calendarDate) : '')
    setNewTaskStartTime('09:00')
    setNewTaskEndTime('10:00')
    setNewTaskError('')
    setIsAddTaskOpen(true)
  }

  function closeTaskComposer() {
    if (isAddingTask) return
    setIsAddTaskOpen(false)
    setIsDocumentPickerOpen(false)
    setTaskDocumentPickerPosition(null)
    setNewTaskText('')
    setNewTaskDueDate('')
    setNewTaskStartTime('09:00')
    setNewTaskEndTime('10:00')
    setNewTaskError('')
  }

  function chooseTaskDocument(path: string) {
    setNewTaskTarget(path)
    setNewTaskDocumentQuery(path)
    setIsDocumentPickerOpen(false)
    setTaskDocumentPickerPosition(null)
    setNewTaskError('')
  }

  function chooseNewTaskDocument() {
    setNewTaskTarget('')
    setNewTaskDocumentQuery('')
    setIsDocumentPickerOpen(false)
    setTaskDocumentPickerPosition(null)
    setNewTaskError('')
  }

  async function submitNewTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = newTaskText.trim()
    if (!canSubmitNewTask) return
    setIsDocumentPickerOpen(false)
    setIsAddingTask(true)
    try {
      const createdPath = await onAddTask(text, newTaskTarget || '', newTaskFolder, {
        dueDate: newTaskDueDate || undefined,
        startTime: newTaskDueDate ? newTaskStartTime || undefined : undefined,
        endTime: newTaskDueDate ? newTaskEndTime || undefined : undefined,
      })
      onStatusChange('all')
      onQueryChange('')
      selectTaskView('list')
      setNewTaskText('')
      setNewTaskDueDate('')
      setNewTaskStartTime('09:00')
      setNewTaskEndTime('10:00')
      setNewTaskError('')
      setNewTaskDocumentQuery('')
      setIsAddTaskOpen(false)
    } catch (reason) {
      setNewTaskError(reason instanceof Error ? reason.message : '任务添加失败，请稍后重试。')
    } finally {
      setIsAddingTask(false)
    }
  }
  useEffect(() => {
    if (!isAddTaskOpen) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (isDocumentPickerOpen) setIsDocumentPickerOpen(false)
        else closeTaskComposer()
      }
      if (event.key !== 'Tab') return
      const controls = taskDialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')
      if (!controls?.length) { event.preventDefault(); return }
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isAddTaskOpen, isAddingTask, isDocumentPickerOpen])
  const taskDialogWasOpen = useRef(false)
  useEffect(() => {
    if (!isAddTaskOpen) {
      if (taskDialogWasOpen.current) {
        taskDialogWasOpen.current = false
        taskAddButtonRef.current?.focus()
      }
      return
    }
    taskDialogWasOpen.current = true
    const root = document.getElementById('root')
    const wasInert = root?.inert ?? false
    const previousOverflow = document.body.style.overflow
    if (root) root.inert = true
    document.body.style.overflow = 'hidden'
    return () => {
      if (root) root.inert = wasInert
      document.body.style.overflow = previousOverflow
    }
  }, [isAddTaskOpen])
  useEffect(() => {
    if (!isDocumentPickerOpen) {
      setTaskDocumentPickerPosition(null)
      return
    }
    const updatePosition = () => {
      const input = taskDocumentPickerRef.current?.querySelector('input')
      if (!input) return
      const rect = input.getBoundingClientRect()
      setTaskDocumentPickerPosition(positionTaskDocumentPicker({ top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width }, { width: window.innerWidth, height: window.innerHeight }))
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    const close = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.task-document-picker, .task-document-options')) setIsDocumentPickerOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      document.removeEventListener('mousedown', close)
    }
  }, [isDocumentPickerOpen, newTaskDocumentQuery, filteredTaskDocumentOptions.length])
  useEffect(() => {
    if (!isDocumentPickerOpen) return
    document.getElementById(`task-document-option-${activeDocumentIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeDocumentIndex, isDocumentPickerOpen])
  useEffect(() => {
    setActiveDocumentIndex((current) => Math.min(current, filteredTaskDocumentOptions.length))
  }, [filteredTaskDocumentOptions.length])
  useEffect(() => {
    if (!priorityMenu) return
    const close = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.task-priority-menu, .task-priority-picker')) setPriorityMenu(null)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPriorityMenu(null) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [priorityMenu])
  useEffect(() => {
    if (priorityMenu) {
      priorityMenuRef.current?.querySelector<HTMLButtonElement>(`[data-priority-index="${priorityMenu.activeIndex}"]`)?.focus()
      return
    }
    priorityAnchorRef.current?.focus()
    priorityAnchorRef.current = null
  }, [priorityMenu])
  useEffect(() => {
    if (!isCalendarFilterOpen) return
    const close = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !calendarFilterRef.current?.contains(event.target)) setIsCalendarFilterOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setIsCalendarFilterOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [isCalendarFilterOpen])
  return (
    <>
      <div className="sidebar-header tasks-header">
        <div className="tasks-header-main">
          <span className="sidebar-header-title"><ListChecks size={15} aria-hidden="true" />任务日程</span>
        </div>
      </div>
      <div className={`sidebar-panel-content tasks-panel-view ${view === 'calendar' ? 'is-calendar-panel' : ''}`}>
        <div className="tasks-toolbar">
          <div className="tasks-status-filters" role="tablist" aria-label="任务状态">
            {([['all', `全部 ${tasks.length}`], ['open', `待办 ${openCount}`], ['done', `已完成 ${doneCount}`]] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={status === value} className={status === value ? 'is-active' : ''} onClick={() => onStatusChange(value)}>{label}</button>)}
          </div>
          <label className="sidebar-search-box"><Search size={14} className="sidebar-search-icon" /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索任务或文档" aria-label="搜索任务或文档" />{query ? <button type="button" className="sidebar-search-clear" onClick={() => onQueryChange('')} aria-label="清空任务搜索"><X size={13} /></button> : null}</label>
        </div>
        <div className="tasks-layout">
          <section className="task-results">
            <div className="task-view-tabs" role="tablist" aria-label="任务视图">
          {([
            ['list', '列表', List],
            ['board', '看板', Columns3],
            ['calendar', '日历', CalendarDays],
            ['gantt', '甘特图', ChartNoAxesGantt],
          ] as const).map(([value, label, Icon]) => <button key={value} type="button" role="tab" aria-selected={view === value} className={view === value ? 'is-active' : ''} onClick={() => selectTaskView(value)}><Icon size={14} />{label}</button>)}
          <button ref={taskAddButtonRef} type="button" className="task-add-button" onClick={openTaskComposer} disabled={isAddingTask} aria-haspopup="dialog"><Plus size={14} />添加任务</button>
        </div>

        {isLoading && !tasks.length ? <div className="sidebar-empty-tip tasks-loading"><LoaderCircle size={24} className="spin" /><p>正在扫描任务</p><span>{progress}</span></div> : null}
        {!isLoading && !filteredTasks.length && view !== 'calendar' ? <div className="sidebar-empty-tip task-empty-state"><ListChecks size={30} className="empty-tip-icon" /><p>{tasks.length ? '当前筛选没有匹配的任务' : '暂无任务'}</p><span>{tasks.length ? '调整搜索、状态或筛选条件' : '先创建一条任务，再用日历、看板和时间轴安排它。'}</span>{!tasks.length ? <button type="button" className="primary-button task-empty-action" onClick={openTaskComposer} disabled={isAddingTask} aria-haspopup="dialog"><Plus size={14} />创建第一条任务</button> : null}</div> : null}
        {filteredTasks.length || view === 'calendar' ? <div ref={tasksViewRef} className={`tasks-view tasks-view-${view}`}>
          {view === 'list' ? <div className="task-groups">{groupedTasks.map((group) => {
            const isExpanded = !collapsedTaskPaths.has(group.path)
            return <section className="task-group" key={group.path}>
              <header>
                <button type="button" className="task-group-toggle" aria-expanded={isExpanded} onClick={() => toggleTaskGroup(group.path)} title={group.path}>
                  {isExpanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                  <FileText size={14} aria-hidden="true" />
                  <strong className="task-group-path">{group.path}</strong>
                  <span aria-label={`${group.tasks.length} 项任务`}>{group.tasks.length}</span>
                </button>
              </header>
              {isExpanded ? group.tasks.map((task) => renderTask(task)) : null}
            </section>
          })}</div> : null}
          {view === 'board' ? <div className="task-board-wrap">
            <div className="task-board-summary" aria-label="任务概览">
              <div><span>当前任务</span><strong>{filteredTasks.length}</strong></div>
              <div className={overdueTasks.length ? 'has-warning' : ''}><span>已逾期</span><strong>{overdueTasks.length}</strong></div>
              <div className={dueTodayTasks.length ? 'has-warning' : ''}><span>今日到期</span><strong>{dueTodayTasks.length}</strong></div>
              <div className="is-success"><span>完成率</span><strong>{filteredTasks.length ? `${Math.round((completedCount / filteredTasks.length) * 100)}%` : '—'}</strong></div>
            </div>
            <div className="task-board-toolbar"><span>看板分类</span><div className="task-board-grouping" role="group" aria-label="看板分类方式">
              <button type="button" className={boardGrouping === 'status' ? 'is-active' : ''} aria-pressed={boardGrouping === 'status'} onClick={() => changeBoardGrouping('status')}>按状态</button>
              <button type="button" className={boardGrouping === 'priority' ? 'is-active' : ''} aria-pressed={boardGrouping === 'priority'} onClick={() => changeBoardGrouping('priority')}>按优先级</button>
            </div><small>{boardGrouping === 'priority' ? '可在任务卡右侧直接调整优先级' : '完成任务后会自动进入已完成列'}</small></div>
            <div className={`task-board-scroll ${boardGrouping === 'priority' ? 'is-priority' : ''}`} role="region" aria-label="任务看板" tabIndex={0}><div className={`task-board is-${boardGrouping}`}>{boardColumns.map((column) => {
              const columnLabel = boardColumnLabel(column.key)
              // Each column's progress bar represents the share of tasks in that
              // column. The previous status-board branch used the completed
              // count for the open column too, which made the bar look full when
              // the open/done distribution was the opposite.
              const completionRate = filteredTasks.length ? Math.round((column.tasks.length / filteredTasks.length) * 100) : 0
              return <section className={`task-board-column is-${column.key}`} key={column.key}>
                <header><div><span>{columnLabel}</span><small>{boardColumnDescription(column.key)}</small></div><strong>{column.tasks.length}</strong></header>
                <div className="task-board-progress" aria-label={`${columnLabel}占比 ${completionRate}%`}><span style={{ width: `${completionRate}%` }} /></div>
                <div className="task-board-list">{column.tasks.length ? column.tasks.map((task) => renderTask(task, true, true)) : <p className="task-board-empty">{boardGrouping === 'priority' ? '暂无此优先级任务' : column.key === 'open' ? '暂无待办任务' : '还没有完成任务'}</p>}</div>
              </section>
            })}</div></div>
          </div> : null}
          {view === 'calendar' ? <div className="task-calendar task-week-calendar">
            <div className="task-calendar-heading">
              <div className="task-calendar-heading-main">
                <div className="task-calendar-title">
                  <button type="button" className="icon-button compact" onClick={() => moveCalendar(-1)} aria-label="上一个日期范围" title="上一个日期范围"><ChevronLeft size={15} /></button>
                  <strong>{calendarRange === 'day' ? calendarDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) : calendarRange === 'month' ? calendarMonthStart.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' }) : weekLabel}</strong>
                  <button type="button" className="icon-button compact" onClick={() => moveCalendar(1)} aria-label="下一个日期范围" title="下一个日期范围"><ChevronRight size={15} /></button>
                  <button type="button" className="task-calendar-today" onClick={() => { const nextDate = new Date(); setCalendarDate(nextDate); setSelectedCalendarDateKey(taskDateKey(nextDate)) }}>今天</button>
                </div>
                <div className="task-calendar-range-switch" role="group" aria-label="日历范围">
                  {(['day', 'week', 'month'] as const).map((range) => <button type="button" key={range} className={calendarRange === range ? 'is-active' : ''} aria-pressed={calendarRange === range} onClick={() => changeCalendarRange(range)}>{range === 'day' ? '日' : range === 'week' ? '周' : '月'}</button>)}
                </div>
              </div>
              <div className="task-calendar-heading-actions">
                <div className="task-calendar-filter-wrap" ref={calendarFilterRef}>
                  <button type="button" className={`task-calendar-filter ${isCalendarFilterOpen ? 'is-open' : ''}`} aria-expanded={isCalendarFilterOpen} aria-haspopup="menu" onClick={() => setIsCalendarFilterOpen((open) => !open)}><Settings2 size={14} />筛选</button>
                  {isCalendarFilterOpen ? <div className="task-calendar-filter-menu" role="menu" aria-label="任务过滤器">
                    {([['all', '全部任务'], ['open', '待办任务'], ['done', '已完成']] as const).map(([value, label]) => <button type="button" role="menuitemradio" aria-checked={status === value} className={status === value ? 'is-active' : ''} key={value} onClick={() => { onStatusChange(value); setIsCalendarFilterOpen(false) }}>{label}<span>{value === 'all' ? tasks.length : value === 'open' ? openCount : doneCount}</span></button>)}
                  </div> : null}
                </div>
                <button ref={taskAddButtonRef} type="button" className="task-calendar-add" onClick={openTaskComposer} disabled={isAddingTask} aria-haspopup="dialog"><Plus size={14} />添加任务</button>
              </div>
            </div>
            {!filteredTasks.length ? <div className="task-calendar-empty"><ListChecks size={24} className="empty-tip-icon" /><strong>{tasks.length ? '当前筛选没有匹配的任务' : '暂无任务'}</strong><span>{tasks.length ? '调整搜索、状态或筛选条件' : '先创建一条任务，再用日历、看板和时间轴安排它。'}</span>{!tasks.length ? <button type="button" className="primary-button task-empty-action" onClick={openTaskComposer} disabled={isAddingTask} aria-haspopup="dialog"><Plus size={14} />创建第一条任务</button> : null}</div> : null}
            <div className="task-calendar-caption">{calendarRange === 'day' ? '当天任务' : calendarRange === 'month' ? '按月查看任务排期' : '按周查看任务排期'} · {calendarTaskList.length} 项已排期</div>
            {calendarRange === 'month' ? <div className="task-month-calendar">
              <div className="task-month-weekdays">{taskWeekdays.map((weekday) => <span key={weekday}>周{weekday}</span>)}</div>
              <div className="task-month-grid">{calendarMonthDays.map((day, index) => day ? <div className={`task-month-day ${day.key === todayKey ? 'is-today' : ''} ${day.tasks.length ? 'has-tasks' : ''}`} key={day.key}><span>{day.date.getDate()}</span>{day.tasks.slice(0, 3).map((task) => renderTask(task, true))}{day.tasks.length > 3 ? <small>+{day.tasks.length - 3} 个</small> : null}</div> : <div className="task-month-day is-empty" key={`month-empty-${index}`} aria-hidden="true" />)}</div>
            </div> : <div className="task-week-layout">
              <div className="task-week-main">
                <div className={`task-week-grid ${calendarRange === 'day' ? 'is-day' : ''}`} role="grid" aria-label={`${calendarRange === 'day' ? '日' : '周'}视图：${calendarRange === 'day' ? calendarDate.toLocaleDateString('zh-CN') : weekLabel}`}>
                  <div className="task-week-corner" role="columnheader">时间</div>
                  {(calendarRange === 'day' ? [calendarDateKey] : weekDates.map((day) => day.key)).map((key, index) => { const day = calendarRange === 'day' ? { date: calendarDate, key, tasks: selectedCalendarTasks } : weekDates[index]; return <div className={`task-week-day-head ${day.key === todayKey ? 'is-today' : ''} ${day.key === selectedCalendarDateKey ? 'is-selected' : ''}`} key={day.key} role="columnheader"><span>{calendarRange === 'day' ? '今天' : `周${taskWeekdays[index]}`}</span><strong>{day.date.getDate()}</strong><small>{day.date.toLocaleDateString('zh-CN', { month: 'short' })}</small></div> })}
                  <div className="task-week-all-day-label" role="rowheader">全天</div>
                  {(calendarRange === 'day' ? [{ date: calendarDate, key: calendarDateKey, tasks: selectedCalendarTasks }] : weekDates).map((day) => {
                    const allDayTasks = day.tasks.filter((task) => !task.startTime)
                    return <div className={`task-week-all-day ${day.key === todayKey ? 'is-today' : ''} ${day.key === selectedCalendarDateKey ? 'is-selected' : ''} ${allDayTasks.length ? 'has-tasks' : ''}`} key={`all-day-${day.key}`} role="gridcell">{allDayTasks.length ? allDayTasks.map((task) => renderTask(task, true)) : <span className="task-week-empty">—</span>}</div>
                  })}
                  {taskWeekHours.map((hour) => <React.Fragment key={hour}><div className="task-week-time" role="rowheader">{String(hour).padStart(2, '0')}:00</div>{(calendarRange === 'day' ? [{ date: calendarDate, key: calendarDateKey, tasks: selectedCalendarTasks }] : weekDates).map((day) => {
                    const timedTasks = timedTasksForHour(day, hour)
                    return <div className={`task-week-slot ${day.key === todayKey ? 'is-today' : ''}`} key={`${day.key}-${hour}`} role="gridcell" aria-label={`${day.key} ${String(hour).padStart(2, '0')}:00`}><div className="task-week-timed-events">{timedTasks.map((task, index) => <div className="task-week-timed-task" key={task.id} style={timedTaskStyle(task, hour, index)}>{renderTask(task, true)}</div>)}</div></div>
                  })}</React.Fragment>)}
                </div>
              </div>
              <aside className="task-week-side-panel" aria-label="本周任务列表">
                <div className="task-week-side-heading"><div><span>{calendarRange === 'day' ? '日程详情' : '日程列表'}</span><strong>{selectedCalendarTasks.length}</strong></div><button type="button" className="icon-button compact" aria-label="更多日程操作" title="更多日程操作"><MoreHorizontal size={15} /></button></div>
                <div className="task-week-side-day-strip" aria-label="日期摘要"><button type="button" className="task-week-side-day-nav" onClick={() => moveCalendar(-1)} aria-label="上一周" title="上一周"><ChevronLeft size={13} /></button><div className="task-week-side-days">{weekDates.map((day, index) => <button type="button" className={`task-week-side-day-chip ${day.key === todayKey ? 'is-today' : ''} ${day.key === selectedCalendarDate.key ? 'is-selected' : ''} ${day.tasks.length ? 'has-tasks' : ''}`} key={`chip-${day.key}`} onClick={() => { setSelectedCalendarDateKey(day.key); setCalendarDate(day.date) }}><span>周{taskWeekdays[index]}</span><strong>{day.date.getDate()}</strong></button>)}</div><button type="button" className="task-week-side-day-nav" onClick={() => moveCalendar(1)} aria-label="下一周" title="下一周"><ChevronRight size={13} /></button></div>
                <div className="task-week-side-list">{selectedCalendarTasks.length ? <section className="task-week-side-group"><header><span>{selectedCalendarDate.key === todayKey ? '今天' : `周${taskWeekdays[weekDates.findIndex((day) => day.key === selectedCalendarDate.key)]}`}</span><strong>{selectedCalendarDate.date.getMonth() + 1}月{selectedCalendarDate.date.getDate()}日</strong><small>{selectedCalendarTasks.length} 项</small></header>{selectedCalendarTasks.map((task) => renderTask(task, true))}</section> : <div className="task-week-side-empty"><CalendarDays size={18} /><span>{calendarRange === 'day' ? '当天暂无日程' : '本日暂无日程'}</span></div>}</div>
              </aside>
            </div>}
            {unscheduledTasks.length ? <div className="task-unscheduled"><strong>未排期 · {unscheduledTasks.length}</strong>{unscheduledTasks.slice(0, 6).map((task) => renderTask(task, true))}</div> : null}
            {offGridTimedTasks.length ? <div className="task-unscheduled task-off-grid"><strong>时间轴外 · {offGridTimedTasks.length}</strong>{offGridTimedTasks.slice(0, 6).map((task) => renderTask(task, true))}</div> : null}
          </div> : null}
          {view === 'gantt' ? <div className="task-gantt">
            <div className="task-gantt-heading">
              <div className="task-gantt-heading-main">
                <strong>任务时间轴</strong>
                <span>{scheduledTasks.length ? `${timelineStart} — ${timelineEnd}` : '任务中未识别到日期'}</span>
              </div>
              <div className="task-gantt-heading-actions">
                <span className="task-gantt-view-label">{ganttScale === 'day' ? '按日' : '按月'}</span>
                <button type="button" className="task-gantt-add" onClick={openTaskComposer} disabled={isAddingTask}><Plus size={13} />添加任务</button>
              </div>
            </div>
            {scheduledTasks.length ? <div className="task-gantt-shell">
              <div className="task-gantt-table-head">
                <div className="task-gantt-name-heading"><span>任务</span><small>{scheduledTasks.length} 项排期</small></div>
                <div className="task-gantt-timeline-head" style={{ '--gantt-columns': ganttTickCount } as CSSProperties}>
                  <div className="task-gantt-month-row">{ganttTicks.map((date, index) => <span key={`month-${date.toISOString()}`} style={{ gridColumn: index + 1 }}>{ganttScale === 'month' ? date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' }) : date.toLocaleDateString('zh-CN', { month: 'short' })}</span>)}</div>
                  <div className="task-gantt-date-row">{ganttTicks.map((date, index) => <span key={`date-${date.toISOString()}`} style={{ gridColumn: index + 1 }}>{ganttScale === 'month' ? date.getFullYear() : date.getDate()}</span>)}</div>
                </div>
              </div>
              <div className="task-gantt-list">{scheduledTasks.map((task) => {
                const offset = Math.max(0, Math.round((Date.parse(`${task.dueDate}T00:00:00`) - startMs) / 86400000))
                // A dated task occupies one day on the timeline. When the range
                // spans months, widen the marker to roughly a month so it stays
                // visible in the same compact schedule language as the reference.
                const width = ganttScale === 'day'
                  ? Math.max(5, 100 / (timelineSpan + 1))
                  : Math.max(2.4, (30 * 100) / (timelineSpan + 1))
                const left = Math.min(100 - width, Math.max(0, (offset / timelineSpan) * 100))
                return <div className="task-gantt-row" key={task.id}>
                  <div className="task-gantt-label">{renderTask(task, true)}</div>
                  <div className="task-gantt-track" style={{ '--gantt-columns': ganttTickCount } as CSSProperties}>
                    <span className={`task-gantt-bar ${task.completed ? 'is-completed' : ''} task-card-priority-${task.priority}`} style={{ left: `${left}%`, width: `${width}%` }} title={`${task.text} · ${task.dueDate}`}>{task.startTime ? <small>{task.startTime}{task.endTime ? `–${task.endTime}` : ''}</small> : null}</span>
                  </div>
                </div>
              })}</div>
            </div> : <div className="task-gantt-empty"><ChartNoAxesGantt size={22} /><strong>还没有排期任务</strong><span>给任务添加日期后，会在这里形成时间轴。</span></div>}
            {unscheduledTasks.length ? <div className="task-unscheduled"><strong>未排期 · {unscheduledTasks.length}</strong>{unscheduledTasks.slice(0, 6).map((task) => renderTask(task, true))}</div> : null}
          </div> : null}
        </div> : null}
        {isLoading && tasks.length ? <p className="tasks-progress" role="status"><LoaderCircle size={13} className="spin" />{progress}</p> : null}
          </section>
        </div>
        {priorityMenu ? createPortal(<div ref={priorityMenuRef} className="task-priority-menu" role="listbox" aria-label="任务优先级" style={{ top: priorityMenu.top, left: priorityMenu.left }} onKeyDown={(event) => {
          const task = visibleTasks.find((item) => item.id === priorityMenu.taskId)
          if (!task) return
          if (event.key === 'Escape') {
            event.preventDefault()
            setPriorityMenu(null)
            return
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
            event.preventDefault()
            const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
            const activeIndex = event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? priorityValues.length - 1
                : Math.max(0, Math.min(priorityValues.length - 1, priorityMenu.activeIndex + delta))
            setPriorityMenu((current) => current ? { ...current, activeIndex } : current)
            return
          }
          if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof HTMLButtonElement) {
            event.preventDefault()
            onPriorityChange(task, priorityValues[priorityMenu.activeIndex])
            setPriorityMenu(null)
          }
        }}>
          {priorityValues.map((priority, index) => {
            const task = visibleTasks.find((item) => item.id === priorityMenu.taskId)
            if (!task) return null
            return <button type="button" role="option" data-priority-index={index} tabIndex={priorityMenu.activeIndex === index ? 0 : -1} aria-selected={task.priority === priority} className={`task-priority-option is-${priority} ${task.priority === priority ? 'is-selected' : ''}`} key={priority} onClick={() => { onPriorityChange(task, priority); setPriorityMenu(null) }}><span className="task-priority-option-dot" aria-hidden="true" />{taskPriorityLabels[priority]}{task.priority === priority ? <Check size={13} aria-hidden="true" /> : null}</button>
          })}
        </div>, document.body) : null}
        {isAddTaskOpen ? createPortal(
          <div className="dialog-backdrop task-add-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeTaskComposer() }}>
            <form ref={taskDialogRef} className="connection-dialog task-add-dialog" onSubmit={submitNewTask} role="dialog" aria-modal="true" aria-labelledby="task-add-title" aria-busy={isAddingTask}>
              <div className="dialog-heading task-add-heading">
                <div>
                  <h2 id="task-add-title">添加任务</h2>
                  <p className="dialog-copy">写下待办，选择保存的文档。</p>
                </div>
                <button type="button" className="icon-button compact" onClick={closeTaskComposer} disabled={isAddingTask} aria-label="关闭添加任务" title="关闭"><X size={17} /></button>
              </div>
              {newTaskError ? <div className="dialog-error" role="alert">{newTaskError}</div> : null}
              <div className="task-add-fields">
                <label>
                  <span>任务内容</span>
                  <textarea value={newTaskText} onChange={(event) => { setNewTaskText(event.target.value); if (newTaskError) setNewTaskError('') }} placeholder="例如：整理本周项目进度" rows={4} autoFocus disabled={isAddingTask} />
                </label>
                <div className="task-schedule-fields">
                  <label>
                    <span>日期</span>
                    <input type="date" value={newTaskDueDate} onChange={(event) => setNewTaskDueDate(event.target.value)} disabled={isAddingTask} />
                  </label>
                  <label>
                    <span>开始时间</span>
                    <input type="time" value={newTaskStartTime} onChange={(event) => setNewTaskStartTime(event.target.value)} disabled={isAddingTask || !newTaskDueDate} />
                  </label>
                  <label>
                    <span>结束时间</span>
                    <input type="time" value={newTaskEndTime} onChange={(event) => setNewTaskEndTime(event.target.value)} disabled={isAddingTask || !newTaskDueDate} />
                  </label>
                </div>
                <p className="task-add-hint">选择日期后，任务会按开始和结束时分落在周视图时间轴；08:00–20:59 之外的时分会显示在“时间轴外”；不选日期则保存为未排期任务。</p>
                {newTaskTimeError ? <p className="task-time-error" role="alert">{newTaskTimeError}</p> : null}
                <label className="task-document-field">
                  <span>目标文档</span>
                  <div ref={taskDocumentPickerRef} className="task-document-picker">
                    <input
                      value={newTaskDocumentQuery}
                      onChange={(event) => { setNewTaskDocumentQuery(event.target.value); setNewTaskTarget(''); setActiveDocumentIndex(event.target.value.trim() ? 1 : 0); setIsDocumentPickerOpen(true); if (newTaskError) setNewTaskError('') }}
                      onFocus={() => setIsDocumentPickerOpen(true)}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing) return
                        if (event.key === 'Tab') setIsDocumentPickerOpen(false)
                        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                          event.preventDefault()
                          setIsDocumentPickerOpen(true)
                          const total = filteredTaskDocumentOptions.length + 1
                          setActiveDocumentIndex((current) => event.key === 'ArrowDown' ? Math.min(total - 1, current + 1) : Math.max(0, current - 1))
                        }
                        if (event.key === 'Escape' && isDocumentPickerOpen) { event.preventDefault(); event.stopPropagation(); setIsDocumentPickerOpen(false) }
                        if (event.key === 'Enter' && isDocumentPickerOpen) {
                          event.preventDefault()
                          event.stopPropagation()
                          if (activeDocumentIndex === 0) chooseNewTaskDocument()
                          else if (filteredTaskDocumentOptions[activeDocumentIndex - 1]) chooseTaskDocument(filteredTaskDocumentOptions[activeDocumentIndex - 1])
                        }
                      }}
                      placeholder="搜索文档标题或路径"
                      role="combobox"
                      aria-expanded={isDocumentPickerOpen}
                      aria-controls="task-document-options"
                      aria-autocomplete="list"
                      aria-activedescendant={isDocumentPickerOpen && taskDocumentPickerPosition ? `task-document-option-${activeDocumentIndex}` : undefined}
                      aria-label="搜索并选择目标文档"
                      disabled={isAddingTask}
                    />
                    {newTaskDocumentQuery ? <button type="button" className="task-document-clear" onClick={chooseNewTaskDocument} disabled={isAddingTask} aria-label="清空文档选择" title="清空文档选择"><X size={14} /></button> : null}
                  </div>
                </label>
                <p className="task-add-hint">{newTaskDocumentQuery && !newTaskTarget ? '请从搜索结果中选择文档；清空搜索即可新建任务文档。' : newTaskTarget ? `任务将追加至「${newTaskTarget}」，原有内容保持不变。` : `将在「${newTaskFolder || '根目录'}」创建任务文档，重名时自动递增。`}</p>
              </div>
              <div className="dialog-actions">
                <button type="button" className="secondary-button" onClick={closeTaskComposer} disabled={isAddingTask}>取消</button>
                <button type="submit" className="primary-button" disabled={!canSubmitNewTask}>{isAddingTask ? <><LoaderCircle size={14} className="spin" />保存中…</> : <><Plus size={14} />添加任务</>}</button>
              </div>
            </form>
            {isDocumentPickerOpen && taskDocumentPickerPosition ? createPortal(<div id="task-document-options" className="task-document-options is-portal" role="listbox" aria-label="目标文档" style={{ top: taskDocumentPickerPosition.top, left: taskDocumentPickerPosition.left, width: taskDocumentPickerPosition.width, maxHeight: taskDocumentPickerPosition.maxHeight }}>
              <button id="task-document-option-0" type="button" role="option" tabIndex={-1} aria-selected={!newTaskTarget && !newTaskDocumentQuery} className={`task-document-create-option ${activeDocumentIndex === 0 ? 'is-highlighted' : ''}`} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveDocumentIndex(0)} onClick={chooseNewTaskDocument}>
                <FilePlus2 size={15} aria-hidden="true" />
                <span><strong>新建任务文档</strong><small>在「{newTaskFolder || '根目录'}」创建</small></span>
                {!newTaskDocumentQuery ? <Check size={14} aria-hidden="true" /> : null}
              </button>
              {filteredTaskDocumentOptions.map((path, index) => <button id={`task-document-option-${index + 1}`} type="button" role="option" tabIndex={-1} title={path} aria-selected={newTaskTarget === path} className={`task-document-option ${newTaskTarget === path ? 'is-selected' : ''} ${activeDocumentIndex === index + 1 ? 'is-highlighted' : ''}`} key={path} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveDocumentIndex(index + 1)} onClick={() => chooseTaskDocument(path)}>
                <FileText size={15} aria-hidden="true" />
                <span><strong>{documentTitle(path)}</strong><small>{parentPath(path) || '根目录'}</small></span>
                {newTaskTarget === path ? <Check size={14} aria-hidden="true" /> : null}
              </button>)}
              {!filteredTaskDocumentOptions.length ? <p className="task-document-empty">没有匹配的文档，请继续输入或选择新建。</p> : null}
              {taskDocumentSearch.total > filteredTaskDocumentOptions.length ? <p className="task-document-count">显示前 {filteredTaskDocumentOptions.length} 个匹配结果，共 {taskDocumentSearch.total} 篇</p> : filteredTaskDocumentOptions.length ? <p className="task-document-count">匹配 {filteredTaskDocumentOptions.length} 篇文档</p> : null}
            </div>, document.body) : null}
          </div>, document.body,
        ) : null}
      </div>
    </>
  )
}

function TaskMarkdownDialog({
  task,
  note,
  isLoading,
  error,
  connection,
  vault,
  onClose,
  onSave,
  onOpenDocument,
}: {
  task: TaskItem
  note: Note | null
  isLoading: boolean
  error: string
  connection: Connection
  vault: string
  onClose: () => void
  onSave: (content: string) => Promise<void>
  onOpenDocument: () => void
}) {
  const [saveStatusTarget, setSaveStatusTarget] = useState<HTMLElement | null>(null)
  const parsed = useMemo(() => {
    if (!note) return { body: '', data: {} as Frontmatter }
    const document = parseFrontmatter(note.content)
    return { ...document, body: normalizeMarkdown(document.body, note.fileLinks) }
  }, [note])
  const saveBody = useCallback(async (nextBody: string) => {
    if (!note) return
    const frontmatter = /^---\s*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(note.content)?.[0] || ''
    await onSave(`${frontmatter}${nextBody}`)
  }, [note, onSave])

  return createPortal(
    <div className="dialog-backdrop task-markdown-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <article className="connection-dialog task-markdown-dialog" role="dialog" aria-modal="true" aria-labelledby="task-markdown-title" aria-busy={isLoading}>
        <div className="dialog-heading task-markdown-heading">
          <div>
            <p>任务 Markdown</p>
            <h2 id="task-markdown-title">编辑任务原文</h2>
            <span className="task-markdown-path" title={task.path}>{task.path} · 第 {task.lineIndex + 1} 行</span>
          </div>
          <button type="button" className="icon-button compact" onClick={onClose} disabled={isLoading} aria-label="关闭 Markdown 编辑" title="关闭"><X size={17} /></button>
        </div>
        {error ? <div className="dialog-error" role="alert">{error}</div> : null}
        {isLoading ? (
          <div className="task-markdown-loading"><LoaderCircle size={20} className="spin" /><span>正在读取文档 Markdown…</span></div>
        ) : note ? <>
          <div className="task-markdown-editor-bar">
            <span>所见所得编辑</span>
            <span ref={setSaveStatusTarget} className="reader-meta-save-status" aria-live="polite" />
          </div>
          <div className="task-markdown-editor-surface">
            <InlineMarkdownEditor
              key={note.path}
              content={parsed.body}
              frontmatter={parsed.data}
              connection={connection}
              vault={vault}
              notePath={note.path}
              fileLinks={note.fileLinks}
              saveStatusTarget={saveStatusTarget}
              onSave={saveBody}
            />
          </div>
        </> : null}
        <div className="dialog-actions task-markdown-actions">
          <button type="button" className="secondary-button" onClick={onOpenDocument} disabled={isLoading || !note}>打开原文</button>
          <span className="task-markdown-actions-spacer" />
          <button type="button" className="primary-button" onClick={onClose} disabled={isLoading}>关闭</button>
        </div>
      </article>
    </div>,
    document.body,
  )
}

function formatRelativeTime(value?: number | string) {
  if (!value) return ''
  const timestamp = typeof value === 'string' ? Date.parse(value) : value
  if (!Number.isFinite(timestamp)) return ''
  const diff = Math.floor((Date.now() - timestamp) / 1000)
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}天前`
  const d = new Date(timestamp)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function formatSize(size?: number) {
  if (!size) return '0 B'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}



function normalizeMarkdown(content: string, links?: Record<string, string>) {
  return content
    .replace(/!\[\[([^\]]+)\]\]/g, (_, rawName: string) => {
      const [name, size] = rawName.split("|")
      const target = links?.[rawName] || links?.[name] || links?.[links?.[name] ? name : `!\[\[${name}\]\]`] || links?.[name]
      const sizeSuffix = size ? `|${size}` : ""
      return target ? `![${name}${sizeSuffix}](#fns-media:${encodeURIComponent(target)})` : `*附件：${name}*`
    })
    .replace(/(?<!!)!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, label?: string) => `[${label || target}](#fns-note:${encodeURIComponent(target)})`)
    .replace(/^>\s*\[!([\w-]+)\]\s*(.*)$/gm, (_, type: string, title: string) => `> **${title || type}**`)
}

type Frontmatter = Record<string, string | string[]>

function frontmatterTagLabel(value: string) {
  const wikiLink = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(value.trim())
  if (wikiLink) return wikiLink[2] || wikiLink[1]
  const parsedWikiLink = /^\[([^\[\]|]+)(?:\|([^\]]+))?\]$/.exec(value.trim())
  return parsedWikiLink ? parsedWikiLink[2] || parsedWikiLink[1] : value
}

function parseFrontmatter(content: string): { body: string; data: Frontmatter } {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(content)
  if (!match || !/^[\w-]+\s*:/m.test(match[1])) return { body: content, data: {} }

  const data: Frontmatter = {}
  let currentKey = ''
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([\w-]+):\s*(.*)$/.exec(line)
    if (field) {
      const [, key, rawValue] = field
      currentKey = key
      const value = rawValue.trim().replace(/^['"]|['"]$/g, '')
      const inlineList = /^\[(.*)\]$/.exec(value)
      data[key] = inlineList
        ? inlineList[1].split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
        : value || []
      continue
    }
    const listItem = /^\s+-\s+(.+)$/.exec(line)
    if (listItem && currentKey) {
      const current = data[currentKey]
      const nextItem = listItem[1].trim().replace(/^['"]|['"]$/g, '')
      data[currentKey] = [...(Array.isArray(current) ? current : current ? [current] : []), nextItem]
    }
  }
  return { body: content.slice(match[0].length), data }
}

function DocumentProperties({ data }: { data: Frontmatter }) {
  const title = typeof data.title === 'string' ? data.title : ''
  const entries = Object.entries(data).filter(([key]) => key !== 'title' && !/^(?:cover(?:Image)?|image)$/i.test(key))
  if (!title && entries.length === 0) return null

  return (
    <section className="document-properties" aria-label="文档属性">
      {title ? <h1>{title}</h1> : null}
      {entries.length ? (
        <dl>
          {entries.map(([key, value]) => (
            <div key={key} className={key === 'description' ? 'property-wide' : ''}>
              <dt>{key}</dt>
              <dd>
                {key === 'source' && typeof value === 'string' && /^https?:\/\//.test(value) ? (
                  <a className="property-link" href={value} target="_blank" rel="noreferrer">{value}</a>
                ) : (key === 'tags' || key === 'categories') && (Array.isArray(value) || typeof value === 'string') ? (
                  <span className="tag-list">
                    {(Array.isArray(value) ? value : [value]).map((tag) => <span className="property-tag" key={tag}>{frontmatterTagLabel(tag)}</span>)}
                  </span>
                ) : <span className="property-value">{Array.isArray(value) ? value.join('、') : value || '—'}</span>}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  )
}

function ReaderLoading() {
  return (
    <div className="reader-loading" aria-live="polite" aria-label="正在读取文档">
      <div className="reader-loading-inner">
        <span className="skeleton skeleton-kicker" />
        <span className="skeleton skeleton-title" />
        <span className="skeleton skeleton-title short" />
        <span className="skeleton skeleton-line" />
        <span className="skeleton skeleton-line" />
        <span className="skeleton skeleton-line medium" />
        <span className="skeleton skeleton-block" />
        <span className="reader-loading-label"><LoaderCircle className="spin" size={15} />正在读取文档</span>
      </div>
    </div>
  )
}

function displayError(error: string) {
  if (error === 'The local proxy could not reach the FNS service.') {
    return '无法连接到文档服务，请检查服务地址和网络状态。'
  }
  if (/auth token ip restricted|ip mismatch/i.test(error)) {
    return '当前 Auth Token 绑定了固定 IP，但本机出口 IP 已变化或代理链路不一致。请关闭 VPN/代理后重试，或在 FNS 管理端重新生成并绑定当前出口 IP 的 Token。'
  }
  return error
}

type JsonRecord = Record<string, unknown>

type RealtimeMessage = {
  action: string
  envelope: JsonRecord
}

type SpreadsheetCell = {
  text?: unknown
  value?: unknown
  formula?: unknown
  v?: unknown
  f?: unknown
  p?: unknown
  body?: unknown
  dataStream?: unknown
  s?: unknown
  merge?: unknown
}

type SpreadsheetSheet = JsonRecord & {
  name?: string
  rows?: unknown
  cellData?: unknown
  rowData?: unknown
  columnData?: unknown
  mergeData?: unknown
}

const MAX_SPREADSHEET_PREVIEW_ROWS = 200
const MAX_SPREADSHEET_PREVIEW_COLUMNS = 50
const DEFAULT_SPREADSHEET_PREVIEW_COLUMNS = 26
const MAX_FILE_PREVIEW_CACHE_ENTRIES = 8
const MAX_FILE_PREVIEW_CACHE_BYTES = 20 * 1024 * 1024

type XlsxModule = typeof import('xlsx')

let xlsxModulePromise: Promise<XlsxModule> | undefined
const filePreviewCache = new Map<string, Promise<Blob>>()

function loadXlsxModule() {
  return xlsxModulePromise ||= import('xlsx')
}

function filePreviewCacheKey(connection: Connection, vault: string, path: string) {
  return [connection.baseUrl, connection.token, vault, path].join('\u0000')
}

function loadPreviewBlob(connection: Connection, vault: string, path: string) {
  const key = filePreviewCacheKey(connection, vault, path)
  const cached = filePreviewCache.get(key)
  if (cached) {
    filePreviewCache.delete(key)
    filePreviewCache.set(key, cached)
    return cached
  }

  const pending = fetch(fileEndpoint(connection, vault, path), { headers: fnsHeaders(connection) })
    .then((response) => {
      if (!response.ok) throw new Error('attachment request failed')
      return response.blob()
    })
    .then((blob) => {
      if (blob.size > MAX_FILE_PREVIEW_CACHE_BYTES) filePreviewCache.delete(key)
      return blob
    })
    .catch((reason) => {
      filePreviewCache.delete(key)
      throw reason
    })

  filePreviewCache.set(key, pending)
  while (filePreviewCache.size > MAX_FILE_PREVIEW_CACHE_ENTRIES) {
    const oldestKey = filePreviewCache.keys().next().value
    if (!oldestKey) break
    filePreviewCache.delete(oldestKey)
  }
  return pending
}

function clearFilePreviewCache() {
  filePreviewCache.clear()
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseRealtimeMessage(raw: string): RealtimeMessage | null {
  const separator = raw.indexOf('|')
  if (separator <= 0) return null
  try {
    const envelope = JSON.parse(raw.slice(separator + 1)) as unknown
    return isRecord(envelope) ? { action: raw.slice(0, separator), envelope } : null
  } catch {
    return null
  }
}

function columnName(index: number) {
  let value = index + 1
  let label = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    label = String.fromCharCode(65 + remainder) + label
    value = Math.floor((value - 1) / 26)
  }
  return label
}

function spreadsheetValueText(value: unknown, depth = 0): string {
  if (value === null || value === undefined || depth > 4) return ''
  if (value instanceof Date) return value.toLocaleDateString('zh-CN')
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  if (Array.isArray(value)) return value.map((item) => spreadsheetValueText(item, depth + 1)).join('')
  if (!isRecord(value)) return ''

  for (const key of ['text', 'value', 'v', 'f', 'formula', 't', 'dataStream', 'body', 'p']) {
    const text = spreadsheetValueText(value[key], depth + 1)
    if (text) return text
  }
  return ''
}

function spreadsheetCellText(cell?: SpreadsheetCell) {
  for (const value of [cell?.text, cell?.value, cell?.v, cell?.formula, cell?.f, cell?.dataStream, cell?.body, cell?.p]) {
    const text = spreadsheetValueText(value)
    if (text) return text.replace(/\r?\n$/, '')
  }
  return ''
}

function spreadsheetCellFormula(cell?: SpreadsheetCell) {
  for (const formula of [cell?.formula, cell?.f]) {
    if (typeof formula !== 'string' || !formula) continue
    return formula.startsWith('=') ? formula : `=${formula}`
  }
  return ''
}

function spreadsheetCellCoordinate(value: string) {
  const match = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(value.trim().toUpperCase())
  if (!match) return null
  let column = 0
  for (const character of match[1]) column = column * 26 + character.charCodeAt(0) - 64
  return { row: Number(match[2]) - 1, column: column - 1 }
}

function spreadsheetNumber(value: string) {
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : null
}

function spreadsheetArithmetic(value: string) {
  const parsedTokens = value.match(/\d+(?:\.\d+)?|[()+\-*/]/g)
  if (!parsedTokens || parsedTokens.join('') !== value.replace(/\s+/g, '')) return null
  const tokens = parsedTokens
  let index = 0

  function parseFactor(): number | null {
    const token = tokens[index]
    if (token === '(') {
      index += 1
      const result = parseSum()
      if (tokens[index] !== ')') return null
      index += 1
      return result
    }
    if (token === '+' || token === '-') {
      index += 1
      const result = parseFactor()
      return result === null ? null : token === '-' ? -result : result
    }
    if (!token || !/^\d/.test(token)) return null
    index += 1
    return Number(token)
  }

  function parseProduct(): number | null {
    let result = parseFactor()
    while (result !== null && (tokens[index] === '*' || tokens[index] === '/')) {
      const operator = tokens[index]
      index += 1
      const right = parseFactor()
      if (right === null || (operator === '/' && right === 0)) return null
      result = operator === '*' ? result * right : result / right
    }
    return result
  }

  function parseSum(): number | null {
    let result = parseProduct()
    while (result !== null && (tokens[index] === '+' || tokens[index] === '-')) {
      const operator = tokens[index]
      index += 1
      const right = parseProduct()
      if (right === null) return null
      result = operator === '+' ? result + right : result - right
    }
    return result
  }

  const result = parseSum()
  return result !== null && index === tokens.length && Number.isFinite(result) ? result : null
}

function spreadsheetFormulaResult(formula: string, cellMap: Map<string, SpreadsheetCell>, depth = 0): string {
  if (!formula.startsWith('=') || depth > 4) return ''
  const expression = formula.slice(1).trim()
  const getCellValue = (coordinate: string) => {
    const position = spreadsheetCellCoordinate(coordinate)
    if (!position) return null
    const cell = cellMap.get(`${position.row}:${position.column}`)
    if (!cell) return null
    const nestedFormula = spreadsheetCellFormula(cell)
    const text = nestedFormula ? spreadsheetFormulaResult(nestedFormula, cellMap, depth + 1) || spreadsheetCellText(cell) : spreadsheetCellText(cell)
    return text.trim() ? spreadsheetNumber(text) : null
  }

  const functionMatch = /^([A-Z]+)\((.*)\)$/i.exec(expression)
  if (functionMatch) {
    const name = functionMatch[1].toUpperCase()
    const values = functionMatch[2].split(',').flatMap((part) => {
      const range = /^(\$?[A-Z]{1,3}\$?\d+):(\$?[A-Z]{1,3}\$?\d+)$/i.exec(part.trim())
      if (!range) {
        const value = getCellValue(part.trim())
        return value === null ? [] : [value]
      }
      const start = spreadsheetCellCoordinate(range[1])
      const end = spreadsheetCellCoordinate(range[2])
      if (!start || !end) return []
      const numbers: number[] = []
      for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row += 1) {
        for (let column = Math.min(start.column, end.column); column <= Math.max(start.column, end.column); column += 1) {
          const value = getCellValue(`${columnName(column)}${row + 1}`)
          if (value !== null) numbers.push(value)
        }
      }
      return numbers
    })
    if (!values.length) return name === 'SUM' ? '0' : ''
    const result = name === 'SUM'
      ? values.reduce((total, value) => total + value, 0)
      : name === 'AVERAGE'
        ? values.reduce((total, value) => total + value, 0) / values.length
        : name === 'MIN'
          ? Math.min(...values)
          : name === 'MAX'
            ? Math.max(...values)
            : name === 'COUNT'
              ? values.length
              : null
    return result === null ? '' : String(result)
  }

  const replaced = expression.replace(/\$?[A-Z]{1,3}\$?\d+/gi, (coordinate) => String(getCellValue(coordinate) ?? 0))
  const result = spreadsheetArithmetic(replaced)
  return result === null ? '' : String(result)
}

function spreadsheetCellDisplayText(cell: SpreadsheetCell | undefined, cellMap: Map<string, SpreadsheetCell>, styles?: JsonRecord) {
  const formula = spreadsheetCellFormula(cell)
  const value = formula ? spreadsheetFormulaResult(formula, cellMap) || spreadsheetCellText(cell) : spreadsheetCellText(cell)
  const numberFormat = spreadsheetNumberFormat(cell, styles)
  const rawValue = formula ? Number(value) : cell?.v ?? cell?.value
  if (numberFormat && numberFormat !== 'General' && typeof rawValue === 'number' && Number.isFinite(rawValue) && value !== '') {
    try {
      return formatSpreadsheetNumber(numberFormat, rawValue)
    } catch {
      return value
    }
  }
  return value
}

function spreadsheetColor(value: unknown) {
  if (typeof value === 'string') return value
  if (isRecord(value) && typeof value.rgb === 'string') return value.rgb
  return ''
}

function spreadsheetStyleRecord(cell: SpreadsheetCell | undefined, styles?: JsonRecord): JsonRecord {
  if (!cell) return {}
  if (isRecord(cell.s)) return cell.s
  if ((typeof cell.s === 'string' || typeof cell.s === 'number') && isRecord(styles?.[String(cell.s)])) {
    return styles[String(cell.s)] as JsonRecord
  }
  return {}
}

function spreadsheetNumberFormat(cell: SpreadsheetCell | undefined, styles?: JsonRecord) {
  const numberFormat = spreadsheetStyleRecord(cell, styles).n
  if (typeof numberFormat === 'string' || typeof numberFormat === 'number') return numberFormat
  if (isRecord(numberFormat) && (typeof numberFormat.pattern === 'string' || typeof numberFormat.pattern === 'number')) return numberFormat.pattern
  return ''
}

function spreadsheetCellStyle(cell: SpreadsheetCell | undefined, styles?: JsonRecord): CSSProperties {
  const style = spreadsheetStyleRecord(cell, styles)
  if (!cell || !Object.keys(style).length) return {}
  const result: CSSProperties = {}
  const backgroundColor = spreadsheetColor(style.bg)
  const color = spreadsheetColor(style.cl)
  if (backgroundColor) result.backgroundColor = backgroundColor
  if (color) result.color = color
  if (typeof style.ff === 'string' && style.ff) result.fontFamily = style.ff
  if (typeof style.fs === 'number' && style.fs > 0) result.fontSize = `${style.fs}px`
  if (style.bl === 1) result.fontWeight = 600
  if (style.it === 1) result.fontStyle = 'italic'
  const decorations = [
    isRecord(style.ul) && style.ul.s === 1 ? 'underline' : '',
    isRecord(style.st) && style.st.s === 1 ? 'line-through' : '',
  ].filter(Boolean)
  if (decorations.length) result.textDecoration = decorations.join(' ')
  if (style.ht === 2) result.textAlign = 'center'
  else if (style.ht === 3) result.textAlign = 'right'
  else if (style.ht === 1) result.textAlign = 'left'
  if (style.vt === 1) result.verticalAlign = 'top'
  else if (style.vt === 3) result.verticalAlign = 'bottom'
  else if (style.vt === 2) result.verticalAlign = 'middle'
  if (style.tb === 3) {
    result.whiteSpace = 'pre-wrap'
    result.overflowWrap = 'anywhere'
  }
  return result
}

function spreadsheetDimensionValue(collection: unknown, index: number, keys: string[]) {
  const entry = Array.isArray(collection) ? collection[index] : isRecord(collection) ? collection[String(index)] : undefined
  if (!isRecord(entry)) return 0
  for (const key of keys) {
    if (typeof entry[key] === 'number' && entry[key] > 0) return entry[key]
  }
  return 0
}

function spreadsheetTextWidth(value: string) {
  return Array.from(value).reduce((width, character) => width + (/[^\x00-\xff]/.test(character) ? 2 : 1), 0)
}

function collectionEntries(value: unknown): Array<[string, unknown]> {
  if (Array.isArray(value)) return value.map((item, index) => [String(index), item])
  return isRecord(value) ? Object.entries(value) : []
}

function spreadsheetCell(value: unknown): SpreadsheetCell | undefined {
  if (isRecord(value)) return value as SpreadsheetCell
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' || value instanceof Date) {
    return { value }
  }
  return undefined
}

function sheetCells(sheet: SpreadsheetSheet) {
  const rows = sheet.rows
  const rowStore = sheet.cellData ?? (isRecord(rows) && isRecord(rows._) ? rows._ : rows)
  return collectionEntries(rowStore)
    .map(([rowIndex, rowValue]) => ({ rowIndex: Number(rowIndex), rowValue }))
    .flatMap(({ rowIndex, rowValue }) => {
      if (!Number.isInteger(rowIndex) || rowIndex < 0 || (!isRecord(rowValue) && !Array.isArray(rowValue))) return []
      const cells = isRecord(rowValue) && 'cells' in rowValue ? rowValue.cells : rowValue
      return collectionEntries(cells)
        .map(([columnIndex, cell]) => ({ rowIndex, columnIndex: Number(columnIndex), cell: spreadsheetCell(cell) }))
        .filter(({ columnIndex, cell }) => Number.isInteger(columnIndex) && columnIndex >= 0 && cell)
    })
}

function sheetMergeRanges(sheet: SpreadsheetSheet) {
  const ranges = new Map<string, [number, number]>()
  if (!Array.isArray(sheet.mergeData)) return ranges
  for (const range of sheet.mergeData) {
    if (!isRecord(range)) continue
    const startRow = range.startRow
    const endRow = range.endRow
    const startColumn = range.startColumn
    const endColumn = range.endColumn
    if (typeof startRow === 'number' && typeof endRow === 'number' && typeof startColumn === 'number' && typeof endColumn === 'number') {
      ranges.set(`${startRow}:${startColumn}`, [endRow - startRow + 1, endColumn - startColumn + 1])
    }
  }
  return ranges
}

function cloneSpreadsheetSheets(sheets: SpreadsheetSheet[]) {
  return JSON.parse(JSON.stringify(sheets)) as SpreadsheetSheet[]
}

function spreadsheetEditableValue(value: string): string | number | boolean {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^(?:true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true'
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed) && !/^0\d+/.test(trimmed)) return Number(trimmed)
  return value
}

function spreadsheetMutableRow(sheet: SpreadsheetSheet, row: number): JsonRecord {
  const rows = sheet.rows
  let rowStore = sheet.cellData ?? (isRecord(rows) && isRecord(rows._) ? rows._ : rows)
  if (!isRecord(rowStore) && !Array.isArray(rowStore)) {
    rowStore = {}
    sheet.cellData = rowStore
  }
  const store = rowStore as JsonRecord
  if (!isRecord(store[String(row)]) && !Array.isArray(store[String(row)])) store[String(row)] = {}
  const rowValue = store[String(row)] as JsonRecord
  if ('cells' in rowValue) {
    if (!isRecord(rowValue.cells) && !Array.isArray(rowValue.cells)) rowValue.cells = {}
    return rowValue.cells as JsonRecord
  }
  return rowValue
}

function updateSpreadsheetCell(sheets: SpreadsheetSheet[], sheetIndex: number, row: number, column: number, value: string) {
  const nextSheets = cloneSpreadsheetSheets(sheets)
  const sheet = nextSheets[sheetIndex]
  if (!sheet) return nextSheets
  const rowData = spreadsheetMutableRow(sheet, row)
  const current = spreadsheetCell(rowData[String(column)]) || {}
  const formula = value.trim().startsWith('=') ? value.trim() : ''
  if (!formula && !value.trim()) {
    const retained = Object.fromEntries(Object.entries(current).filter(([key]) => !['text', 'value', 'v', 'formula', 'f', 't', 'p', 'body', 'dataStream'].includes(key)))
    if (Object.keys(retained).length === 0) delete rowData[String(column)]
    else rowData[String(column)] = retained
  } else {
    const nextValue = formula ? '' : spreadsheetEditableValue(value)
    const retained = Object.fromEntries(Object.entries(current).filter(([key]) => !['p', 'body', 'dataStream'].includes(key)))
    rowData[String(column)] = {
      ...retained,
      text: formula ? '' : value,
      value: nextValue,
      v: nextValue,
      formula: formula || undefined,
      f: formula ? formula.slice(1) : undefined,
    } satisfies SpreadsheetCell
  }
  return nextSheets
}

type SpreadsheetStylePatch = Record<string, unknown | null>

function updateSpreadsheetRangeStyle(
  sheets: SpreadsheetSheet[],
  sheetIndex: number,
  range: { minRow: number; maxRow: number; minColumn: number; maxColumn: number },
  patch: SpreadsheetStylePatch | null,
  styles?: JsonRecord,
) {
  const nextSheets = cloneSpreadsheetSheets(sheets)
  const sheet = nextSheets[sheetIndex]
  if (!sheet) return nextSheets
  for (let row = range.minRow; row <= range.maxRow; row += 1) {
    const rowData = spreadsheetMutableRow(sheet, row)
    for (let column = range.minColumn; column <= range.maxColumn; column += 1) {
      const current = spreadsheetCell(rowData[String(column)]) || {}
      const nextStyle = patch === null ? {} : { ...spreadsheetStyleRecord(current, styles) }
      Object.entries(patch ?? {}).forEach(([key, value]) => {
        if (value === null) delete nextStyle[key]
        else nextStyle[key] = value
      })
      const nextCell = { ...current }
      if (Object.keys(nextStyle).length) nextCell.s = nextStyle
      else delete nextCell.s
      if (Object.keys(nextCell).length) rowData[String(column)] = nextCell
      else delete rowData[String(column)]
    }
  }
  return nextSheets
}

function translateSpreadsheetFormula(formula: string, rowOffset: number, columnOffset: number) {
  return formula.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/gi, (match, columnAbsolute: string, columnLabel: string, rowAbsolute: string, rowLabel: string) => {
    const position = spreadsheetCellCoordinate(`${columnLabel}${rowLabel}`)
    if (!position) return match
    const nextColumn = columnAbsolute ? position.column : position.column + columnOffset
    const nextRow = rowAbsolute ? position.row : position.row + rowOffset
    if (nextColumn < 0 || nextRow < 0) return match
    return `${columnAbsolute ? '$' : ''}${columnName(nextColumn)}${rowAbsolute ? '$' : ''}${nextRow + 1}`
  })
}

function fillSpreadsheetRange(
  sheets: SpreadsheetSheet[],
  sheetIndex: number,
  sourceRange: { minRow: number; maxRow: number; minColumn: number; maxColumn: number },
  targetRange: { minRow: number; maxRow: number; minColumn: number; maxColumn: number },
  sourceCells: Map<string, SpreadsheetCell>,
) {
  const nextSheets = cloneSpreadsheetSheets(sheets)
  const sheet = nextSheets[sheetIndex]
  if (!sheet) return nextSheets
  const sourceRows = sourceRange.maxRow - sourceRange.minRow + 1
  const sourceColumns = sourceRange.maxColumn - sourceRange.minColumn + 1
  for (let row = targetRange.minRow; row <= targetRange.maxRow; row += 1) {
    const rowData = spreadsheetMutableRow(sheet, row)
    for (let column = targetRange.minColumn; column <= targetRange.maxColumn; column += 1) {
      if (
        row >= sourceRange.minRow && row <= sourceRange.maxRow
        && column >= sourceRange.minColumn && column <= sourceRange.maxColumn
      ) continue
      const sourceRow = sourceRange.minRow + ((row - sourceRange.minRow) % sourceRows + sourceRows) % sourceRows
      const sourceColumn = sourceRange.minColumn + ((column - sourceRange.minColumn) % sourceColumns + sourceColumns) % sourceColumns
      const sourceCell = sourceCells.get(`${sourceRow}:${sourceColumn}`)
      if (!sourceCell) {
        delete rowData[String(column)]
        continue
      }
      const nextCell = JSON.parse(JSON.stringify(sourceCell)) as SpreadsheetCell
      const rowOffset = row - sourceRow
      const columnOffset = column - sourceColumn
      if (typeof nextCell.formula === 'string') nextCell.formula = translateSpreadsheetFormula(nextCell.formula, rowOffset, columnOffset)
      if (typeof nextCell.f === 'string') nextCell.f = translateSpreadsheetFormula(nextCell.f, rowOffset, columnOffset).replace(/^=/, '')
      rowData[String(column)] = nextCell
    }
  }
  return nextSheets
}

function spreadsheetCellInputText(cell?: SpreadsheetCell) {
  return spreadsheetCellFormula(cell) || String(cell?.v ?? cell?.value ?? spreadsheetCellText(cell))
}

function isSpreadsheetSheet(candidate: unknown): candidate is SpreadsheetSheet {
  return isRecord(candidate) && ((Array.isArray(candidate.rows) || isRecord(candidate.rows)) || (Array.isArray(candidate.cellData) || isRecord(candidate.cellData)))
}

function findSheets(workbook: JsonRecord): SpreadsheetSheet[] {
  const candidates: unknown[] = []
  if (Array.isArray(workbook.rows) || isRecord(workbook.rows)) candidates.push(workbook)

  if (Array.isArray(workbook.sheetOrder)) {
    for (const id of workbook.sheetOrder) {
      if (typeof id !== 'string') continue
      candidates.push(workbook[id])
      if (isRecord(workbook.sheets)) candidates.push(workbook.sheets[id])
    }
  }

  if (Array.isArray(workbook.sheets)) candidates.push(...workbook.sheets)
  if (isRecord(workbook.sheets)) candidates.push(...Object.values(workbook.sheets))
  if (Array.isArray(workbook.tabs)) {
    for (const tab of workbook.tabs) {
      if (!isRecord(tab) || tab.type !== 'sheet') continue
      candidates.push(tab.data, tab.value)
      if (typeof tab.key === 'string') {
        candidates.push(workbook[tab.key])
        if (isRecord(workbook.sheets)) candidates.push(workbook.sheets[tab.key])
      }
    }
  }

  const sheets = candidates.filter(isSpreadsheetSheet).filter((sheet, index, allSheets) => allSheets.indexOf(sheet) === index)
  if (sheets.length) return sheets

  const nestedSheets: SpreadsheetSheet[] = []
  function visit(value: unknown, depth: number) {
    if (typeof value === 'string' && depth <= 5) {
      try {
        visit(JSON.parse(value) as unknown, depth + 1)
      } catch {
        // Strings that are not serialized sheet payloads are normal in workbook metadata.
      }
      return
    }
    if (!isRecord(value) || depth > 5) return
    if (isSpreadsheetSheet(value)) {
      nestedSheets.push(value)
      return
    }
    Object.values(value).forEach((child) => visit(child, depth + 1))
  }
  visit(workbook, 0)
  return nestedSheets
}

function spreadsheetWorkbookWithSheets(workbook: JsonRecord, nextSheets: SpreadsheetSheet[]) {
  const nextWorkbook = JSON.parse(JSON.stringify(workbook)) as JsonRecord
  if (isSpreadsheetSheet(nextWorkbook)) return nextSheets[0] || nextWorkbook

  const namedSheets = new Map(nextSheets.flatMap((sheet) => typeof sheet.name === 'string' ? [[sheet.name, sheet] as const] : []))
  let unnamedIndex = 0
  function visit(value: unknown, depth: number): unknown {
    if (depth > 8) return value
    if (isSpreadsheetSheet(value)) {
      const replacement = typeof value.name === 'string' ? namedSheets.get(value.name) : nextSheets[unnamedIndex++]
      return replacement || value
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown
        const replaced = visit(parsed, depth + 1)
        return replaced === parsed ? value : JSON.stringify(replaced)
      } catch {
        return value
      }
    }
    if (Array.isArray(value)) {
      let changed = false
      const nextValue = value.map((child) => {
        const replaced = visit(child, depth + 1)
        if (replaced !== child) changed = true
        return replaced
      })
      return changed ? nextValue : value
    }
    if (isRecord(value)) {
      let changed = false
      const nextValue = { ...value }
      Object.entries(value).forEach(([key, child]) => {
        const replaced = visit(child, depth + 1)
        if (replaced !== child) changed = true
        nextValue[key] = replaced
      })
      return changed ? nextValue : value
    }
    return value
  }
  return visit(nextWorkbook, 0) as JsonRecord
}

type SpreadsheetSaveHandler = (raw: string, nextRaw: string) => Promise<void>
type SpreadsheetSerializer = (sheets: SpreadsheetSheet[]) => string

type SpreadsheetRibbonProps = {
  editable: boolean
  activeTab: 'home' | 'view'
  onTabChange: (tab: 'home' | 'view') => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
  onClearContents: () => void
  onClearFormat: () => void
  onFormat: (patch: SpreadsheetStylePatch) => void
  onToggle: (key: 'bl' | 'it' | 'ul' | 'st') => void
  currentStyle: JsonRecord
  onFillColor: (value: string) => void
  onTextColor: (value: string) => void
  showGridlines: boolean
  onToggleGridlines: () => void
  zoom: number
  onZoomChange: (value: number) => void
  canSave: boolean
  isSaving: boolean
  onSave: () => void
}

function RibbonButton({ icon: Icon, label, onClick, disabled = false, active = false }: {
  icon: LucideIcon
  label: string
  onClick?: () => void
  disabled?: boolean
  active?: boolean
}) {
  return (
    <button
      type="button"
      className={`spreadsheet-ribbon-button${active ? ' is-active' : ''}`}
      onClick={onClick}
      disabled={disabled || !onClick}
      title={label}
      aria-label={label}
      aria-pressed={active ? true : undefined}
    >
      <Icon size={15} />
      <span>{label}</span>
    </button>
  )
}

function SpreadsheetRibbon({
  editable,
  activeTab,
  onTabChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onCopy,
  onCut,
  onPaste,
  onClearContents,
  onClearFormat,
  onFormat,
  onToggle,
  currentStyle,
  onFillColor,
  onTextColor,
  showGridlines,
  onToggleGridlines,
  zoom,
  onZoomChange,
  canSave,
  isSaving,
  onSave,
}: SpreadsheetRibbonProps) {
  const editDisabled = !editable
  const fontFamily = typeof currentStyle.ff === 'string' ? currentStyle.ff : ''
  const fontSize = typeof currentStyle.fs === 'number' ? String(currentStyle.fs) : '12'
  const numberFormat = spreadsheetNumberFormat({ s: currentStyle }, undefined)
  const isBold = currentStyle.bl === 1
  const isItalic = currentStyle.it === 1
  const isUnderline = isRecord(currentStyle.ul) && currentStyle.ul.s === 1
  const isStrikethrough = isRecord(currentStyle.st) && currentStyle.st.s === 1
  return (
    <div className="spreadsheet-ribbon" aria-label="Excel 功能区">
      <div className="spreadsheet-ribbon-head">
        <div className="spreadsheet-ribbon-tabs" role="tablist" aria-label="功能区选项卡">
          <button type="button" role="tab" aria-selected={activeTab === 'home'} className={activeTab === 'home' ? 'is-active' : ''} onClick={() => onTabChange('home')}>开始</button>
          <button type="button" role="tab" aria-selected={activeTab === 'view'} className={activeTab === 'view' ? 'is-active' : ''} onClick={() => onTabChange('view')}>视图</button>
        </div>
        <div className="spreadsheet-ribbon-quick-actions">
          <RibbonButton icon={Undo2} label="撤销" onClick={onUndo} disabled={!canUndo || editDisabled} />
          <RibbonButton icon={Redo2} label="重做" onClick={onRedo} disabled={!canRedo || editDisabled} />
          {editable ? <RibbonButton icon={Save} label={isSaving ? '保存中' : '保存'} onClick={onSave} disabled={!canSave || isSaving} /> : null}
        </div>
      </div>
      {activeTab === 'home' ? (
        <div className="spreadsheet-ribbon-groups">
          <div className="spreadsheet-ribbon-group spreadsheet-ribbon-group-clipboard">
            <div className="spreadsheet-ribbon-controls">
              <RibbonButton icon={Scissors} label="剪切" onClick={onCut} disabled={editDisabled} />
              <RibbonButton icon={ClipboardCopy} label="复制" onClick={onCopy} />
              <RibbonButton icon={ClipboardPaste} label="粘贴" onClick={onPaste} disabled={editDisabled} />
            </div>
            <span>剪贴板</span>
          </div>
          <div className="spreadsheet-ribbon-group spreadsheet-ribbon-group-wide">
            <div className="spreadsheet-ribbon-controls">
              <select className="spreadsheet-ribbon-select spreadsheet-font-family" value={fontFamily} onChange={(event) => onFormat({ ff: event.target.value || null })} disabled={editDisabled} aria-label="字体">
                <option value="">默认字体</option>
                <option value="Arial">Arial</option>
                <option value="Calibri">Calibri</option>
                <option value="Microsoft YaHei">微软雅黑</option>
                <option value="SF Pro Display">SF Pro</option>
              </select>
              <select className="spreadsheet-ribbon-select spreadsheet-font-size" value={fontSize} onChange={(event) => onFormat({ fs: Number(event.target.value) })} disabled={editDisabled} aria-label="字号">
                {[10, 11, 12, 14, 16, 18, 20].map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
              <RibbonButton icon={Bold} label="加粗" onClick={() => onToggle('bl')} disabled={editDisabled} active={isBold} />
              <RibbonButton icon={Italic} label="斜体" onClick={() => onToggle('it')} disabled={editDisabled} active={isItalic} />
              <RibbonButton icon={Underline} label="下划线" onClick={() => onToggle('ul')} disabled={editDisabled} active={isUnderline} />
              <RibbonButton icon={Strikethrough} label="删除线" onClick={() => onToggle('st')} disabled={editDisabled} active={isStrikethrough} />
              <label className="spreadsheet-ribbon-color" title="字体颜色">
                <Type size={15} />
                <input type="color" defaultValue="#252525" onChange={(event) => onTextColor(event.target.value)} disabled={editDisabled} aria-label="字体颜色" />
              </label>
              <label className="spreadsheet-ribbon-color" title="填充颜色">
                <PaintBucket size={15} />
                <input type="color" defaultValue="#fff2cc" onChange={(event) => onFillColor(event.target.value)} disabled={editDisabled} aria-label="填充颜色" />
              </label>
            </div>
            <span>字体</span>
          </div>
          <div className="spreadsheet-ribbon-group spreadsheet-ribbon-group-align">
            <div className="spreadsheet-ribbon-controls">
              <RibbonButton icon={AlignLeft} label="左对齐" onClick={() => onFormat({ ht: 1 })} disabled={editDisabled} />
              <RibbonButton icon={AlignCenter} label="居中" onClick={() => onFormat({ ht: 2 })} disabled={editDisabled} />
              <RibbonButton icon={AlignRight} label="右对齐" onClick={() => onFormat({ ht: 3 })} disabled={editDisabled} />
              <RibbonButton icon={WrapText} label="自动换行" onClick={() => onFormat({ tb: 2 })} disabled={editDisabled} />
            </div>
            <span>对齐方式</span>
          </div>
          <div className="spreadsheet-ribbon-group spreadsheet-ribbon-group-number">
            <div className="spreadsheet-ribbon-controls">
              <select className="spreadsheet-ribbon-select spreadsheet-number-format" value={String(numberFormat || 'General')} onChange={(event) => onFormat({ n: event.target.value === 'General' ? null : { pattern: event.target.value } })} disabled={editDisabled} aria-label="数字格式">
                <option value="General">常规</option>
                <option value="0">整数</option>
                <option value="0.00">两位小数</option>
                <option value="0.00%">百分比</option>
                <option value="$#,##0.00">货币</option>
                <option value="yyyy-mm-dd">日期</option>
              </select>
              <RibbonButton icon={Percent} label="百分比" onClick={() => onFormat({ n: { pattern: '0.00%' } })} disabled={editDisabled} />
            </div>
            <span>数字</span>
          </div>
          <div className="spreadsheet-ribbon-group spreadsheet-ribbon-group-edit">
            <div className="spreadsheet-ribbon-controls">
              <RibbonButton icon={Eraser} label="清除内容" onClick={onClearContents} disabled={editDisabled} />
              <RibbonButton icon={Eraser} label="清除格式" onClick={onClearFormat} disabled={editDisabled} />
            </div>
            <span>编辑</span>
          </div>
        </div>
      ) : (
        <div className="spreadsheet-ribbon-groups">
          <div className="spreadsheet-ribbon-group">
            <div className="spreadsheet-ribbon-controls">
              <RibbonButton icon={Grid3X3} label="显示网格线" onClick={onToggleGridlines} active={showGridlines} />
            </div>
            <span>显示</span>
          </div>
          <div className="spreadsheet-ribbon-group">
            <div className="spreadsheet-ribbon-controls">
              <RibbonButton icon={ZoomOut} label="缩小" onClick={() => onZoomChange(Math.max(75, zoom - 10))} disabled={zoom <= 75} />
              <span className="spreadsheet-zoom-value">{zoom}%</span>
              <RibbonButton icon={ZoomIn} label="放大" onClick={() => onZoomChange(Math.min(150, zoom + 10))} disabled={zoom >= 150} />
            </div>
            <span>缩放</span>
          </div>
        </div>
      )}
    </div>
  )
}

function SpreadsheetGrid({
  sheets,
  styles,
  editable = false,
  raw,
  onSave,
  serialize,
}: {
  sheets: SpreadsheetSheet[]
  styles?: JsonRecord
  editable?: boolean
  raw?: string
  onSave?: SpreadsheetSaveHandler
  serialize?: SpreadsheetSerializer
}) {
  const [activeSheet, setActiveSheet] = useState(0)
  const [selectedCell, setSelectedCell] = useState({ row: 0, column: 0 })
  const [selectionAnchor, setSelectionAnchor] = useState({ row: 0, column: 0 })
  const [selectedDimension, setSelectedDimension] = useState<{ type: 'row' | 'column' | 'all'; index?: number } | null>(null)
  const [sheetHistory, setSheetHistory] = useState(() => ({
    current: cloneSpreadsheetSheets(sheets),
    past: [] as SpreadsheetSheet[][],
    future: [] as SpreadsheetSheet[][],
  }))
  const draftSheets = sheetHistory.current
  const history = sheetHistory
  const [editingCell, setEditingCell] = useState<{ row: number; column: number } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [ribbonTab, setRibbonTab] = useState<'home' | 'view'>('home')
  const [showGridlines, setShowGridlines] = useState(true)
  const [zoom, setZoom] = useState(100)
  const editInputRef = useRef<HTMLInputElement>(null)
  const gridRef = useRef<HTMLTableElement>(null)
  const gridWrapRef = useRef<HTMLDivElement>(null)
  const currentDraftRef = useRef(draftSheets)
  const draggingSelectionRef = useRef(false)
  const draggedSelectionRef = useRef(false)
  const dragPointerRef = useRef({ x: 0, y: 0 })
  const dragAutoScrollFrameRef = useRef<number | null>(null)
  const fillingSelectionRef = useRef(false)
  const fillSourceRangeRef = useRef<{ minRow: number; maxRow: number; minColumn: number; maxColumn: number } | null>(null)
  const fillTargetRef = useRef<{ row: number; column: number } | null>(null)
  const [fillTarget, setFillTarget] = useState<{ row: number; column: number } | null>(null)
  currentDraftRef.current = draftSheets
  const sheet = draftSheets[Math.min(activeSheet, Math.max(draftSheets.length - 1, 0))]
  const cells = useMemo(() => sheet ? sheetCells(sheet) : [], [sheet])
  const mergedRanges = useMemo(() => sheet ? sheetMergeRanges(sheet) : new Map<string, [number, number]>(), [sheet])

  useEffect(() => {
    setSheetHistory({ current: cloneSpreadsheetSheets(sheets), past: [], future: [] })
    setEditingCell(null)
    setSaveError('')
    fillingSelectionRef.current = false
    setFillTarget(null)
  }, [sheets])

  useEffect(() => {
    setSelectedCell({ row: 0, column: 0 })
    setSelectionAnchor({ row: 0, column: 0 })
    setSelectedDimension(null)
    setEditingCell(null)
    fillingSelectionRef.current = false
    setFillTarget(null)
  }, [activeSheet])

  useEffect(() => {
    if (!editingCell) return
    editInputRef.current?.focus()
    editInputRef.current?.select()
  }, [editingCell])

  useEffect(() => {
    if (!draggingSelectionRef.current) return
    const updateDragFromPointer = (clientX: number, clientY: number) => {
      dragPointerRef.current = { x: clientX, y: clientY }
      const cell = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('td[data-cell-key]')
      const key = cell?.dataset.cellKey
      if (!key) return
      const [row, column] = key.split(':').map(Number)
      if (Number.isInteger(row) && Number.isInteger(column)) extendCellDrag(row, column)
    }
    const autoScroll = () => {
      dragAutoScrollFrameRef.current = null
      if (!draggingSelectionRef.current) return
      const wrap = gridWrapRef.current
      if (wrap) {
        const bounds = wrap.getBoundingClientRect()
        const edgeSize = 38
        const maxStep = 24
        const distanceToTop = dragPointerRef.current.y - bounds.top
        const distanceToBottom = bounds.bottom - dragPointerRef.current.y
        const distanceToLeft = dragPointerRef.current.x - bounds.left
        const distanceToRight = bounds.right - dragPointerRef.current.x
        const verticalStep = distanceToTop < edgeSize
          ? -Math.min(maxStep, Math.max(4, edgeSize - distanceToTop))
          : distanceToBottom < edgeSize
            ? Math.min(maxStep, Math.max(4, edgeSize - distanceToBottom))
            : 0
        const horizontalStep = distanceToLeft < edgeSize
          ? -Math.min(maxStep, Math.max(4, edgeSize - distanceToLeft))
          : distanceToRight < edgeSize
            ? Math.min(maxStep, Math.max(4, edgeSize - distanceToRight))
            : 0
        if (verticalStep || horizontalStep) {
          wrap.scrollBy({ left: horizontalStep, top: verticalStep })
          updateDragFromPointer(dragPointerRef.current.x, dragPointerRef.current.y)
        }
      }
      dragAutoScrollFrameRef.current = window.requestAnimationFrame(autoScroll)
    }
    const stopDragging = (event: MouseEvent) => {
      if (!draggingSelectionRef.current) return
      draggingSelectionRef.current = false
      if (!(event.target instanceof Element && event.target.closest('td[data-cell-key]'))) draggedSelectionRef.current = false
      if (dragAutoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(dragAutoScrollFrameRef.current)
        dragAutoScrollFrameRef.current = null
      }
    }
    const handlePointerMove = (event: MouseEvent) => updateDragFromPointer(event.clientX, event.clientY)
    dragAutoScrollFrameRef.current = window.requestAnimationFrame(autoScroll)
    window.addEventListener('mousemove', handlePointerMove)
    window.addEventListener('mouseup', stopDragging)
    return () => {
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('mouseup', stopDragging)
      if (dragAutoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(dragAutoScrollFrameRef.current)
        dragAutoScrollFrameRef.current = null
      }
    }
  })

  useEffect(() => {
    if (!fillingSelectionRef.current) return
    const updateFillTarget = (event: MouseEvent) => {
      const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('td[data-cell-key]')
      const key = cell?.dataset.cellKey
      if (!key) return
      const [row, column] = key.split(':').map(Number)
      if (!Number.isInteger(row) || !Number.isInteger(column)) return
      fillTargetRef.current = { row, column }
      setFillTarget({ row, column })
    }
    const stopFilling = () => {
      const sourceRange = fillSourceRangeRef.current
      const target = fillTargetRef.current
      fillingSelectionRef.current = false
      fillSourceRangeRef.current = null
      fillTargetRef.current = null
      setFillTarget(null)
      if (!sourceRange || !target) return
      const targetRange = {
        minRow: Math.min(sourceRange.minRow, target.row),
        maxRow: Math.max(sourceRange.maxRow, target.row),
        minColumn: Math.min(sourceRange.minColumn, target.column),
        maxColumn: Math.max(sourceRange.maxColumn, target.column),
      }
      if (
        targetRange.minRow === sourceRange.minRow && targetRange.maxRow === sourceRange.maxRow
        && targetRange.minColumn === sourceRange.minColumn && targetRange.maxColumn === sourceRange.maxColumn
      ) return
      applySheetChange((current) => fillSpreadsheetRange(current, activeSheet, sourceRange, targetRange, cellMap))
    }
    window.addEventListener('mousemove', updateFillTarget)
    window.addEventListener('mouseup', stopFilling, { once: true })
    return () => {
      window.removeEventListener('mousemove', updateFillTarget)
      window.removeEventListener('mouseup', stopFilling)
    }
  })

  if (!sheets.length || !sheet) return null

  const maxRow = Math.min(Math.max(...cells.map((item) => item.rowIndex), 0), MAX_SPREADSHEET_PREVIEW_ROWS - 1)
  const dataMaxColumn = Math.min(Math.max(...cells.map((item) => item.columnIndex), 0), MAX_SPREADSHEET_PREVIEW_COLUMNS - 1)
  const maxColumn = Math.max(dataMaxColumn, DEFAULT_SPREADSHEET_PREVIEW_COLUMNS - 1)
  const visibleColumnCount = maxColumn + 1
  const previewRowCount = Math.max(maxRow + 1, 40)
  const previewMaxRow = previewRowCount - 1
  const cellMap = new Map(cells.map((item) => [`${item.rowIndex}:${item.columnIndex}`, item.cell as SpreadsheetCell]))
  const selectedKey = `${selectedCell.row}:${selectedCell.column}`
  const selectedValue = cellMap.get(selectedKey)
  const selectedDisplayValue = spreadsheetCellInputText(selectedValue)
  const selectedFormula = spreadsheetCellFormula(selectedValue)
  const isDirty = JSON.stringify(draftSheets) !== JSON.stringify(sheets)
  const hasPendingEdit = Boolean(editingCell)
  const cellSelectionRange = {
    minRow: Math.min(selectionAnchor.row, selectedCell.row),
    maxRow: Math.max(selectionAnchor.row, selectedCell.row),
    minColumn: Math.min(selectionAnchor.column, selectedCell.column),
    maxColumn: Math.max(selectionAnchor.column, selectedCell.column),
  }
  const selectionRange = selectedDimension?.type === 'all'
    ? { minRow: 0, maxRow: previewMaxRow, minColumn: 0, maxColumn }
    : selectedDimension?.type === 'row'
      ? { minRow: selectedDimension.index ?? 0, maxRow: selectedDimension.index ?? 0, minColumn: 0, maxColumn }
      : selectedDimension?.type === 'column'
        ? { minRow: 0, maxRow: previewMaxRow, minColumn: selectedDimension.index ?? 0, maxColumn: selectedDimension.index ?? 0 }
        : cellSelectionRange
  const fillPreviewRange = fillTarget && !selectedDimension ? {
    minRow: Math.min(selectionRange.minRow, fillTarget.row),
    maxRow: Math.max(selectionRange.maxRow, fillTarget.row),
    minColumn: Math.min(selectionRange.minColumn, fillTarget.column),
    maxColumn: Math.max(selectionRange.maxColumn, fillTarget.column),
  } : null
  const hasSelectionRange = selectionRange.minRow !== selectionRange.maxRow || selectionRange.minColumn !== selectionRange.maxColumn
  const skippedCells = new Set<string>()
  const rowIndexes = Array.from({ length: previewRowCount }, (_, index) => index)
  const columnIndexes = Array.from({ length: visibleColumnCount }, (_, index) => index)
  const columnWidths = columnIndexes.map((column) => {
    const widestCell = cells
      .filter((item) => item.columnIndex === column)
      .reduce((widest, item) => Math.max(widest, spreadsheetTextWidth(spreadsheetCellText(item.cell as SpreadsheetCell))), 0)
    const sourceWidth = spreadsheetDimensionValue(sheet.columnData, column, ['w', 'width'])
    return sourceWidth ? Math.min(420, Math.max(72, sourceWidth)) : Math.min(280, Math.max(92, 28 + Math.min(widestCell, 36) * 7))
  })
  const gridWidth = 48 + columnWidths.reduce((total, width) => total + width, 0)

  function selectCell(row: number, column: number, focus = true, extend = false) {
    const nextRow = Math.max(0, Math.min(previewMaxRow, row))
    const nextColumn = Math.max(0, Math.min(maxColumn, column))
    if (!extend) setSelectionAnchor({ row: nextRow, column: nextColumn })
    setSelectedDimension(null)
    setSelectedCell({ row: nextRow, column: nextColumn })
    if (!focus) return
    requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLElement>(`[data-cell-key="${nextRow}:${nextColumn}"]`)?.focus()
    })
  }

  function beginEdit(row: number, column: number, initialValue?: string) {
    selectCell(row, column, false)
    const cell = cellMap.get(`${row}:${column}`)
    const value = initialValue ?? spreadsheetCellInputText(cell)
    setEditValue(value)
    setEditingCell({ row, column })
  }

  function applySheetChange(change: (current: SpreadsheetSheet[]) => SpreadsheetSheet[]) {
    setSheetHistory((currentHistory) => {
      const next = change(currentHistory.current)
      if (JSON.stringify(next) === JSON.stringify(currentHistory.current)) return currentHistory
      return {
        current: next,
        past: [...currentHistory.past, currentHistory.current].slice(-50),
        future: [],
      }
    })
  }

  function undoChange() {
    if (editingCell) setEditingCell(null)
    setSheetHistory((currentHistory) => {
      const previous = currentHistory.past.at(-1)
      if (!previous) return currentHistory
      return {
        current: previous,
        past: currentHistory.past.slice(0, -1),
        future: [currentHistory.current, ...currentHistory.future].slice(0, 50),
      }
    })
  }

  function redoChange() {
    if (editingCell) setEditingCell(null)
    setSheetHistory((currentHistory) => {
      const next = currentHistory.future[0]
      if (!next) return currentHistory
      return {
        current: next,
        past: [...currentHistory.past, currentHistory.current].slice(-50),
        future: currentHistory.future.slice(1),
      }
    })
  }

  function finishEdit(move?: { row: number; column: number }) {
    if (!editingCell) return
    applySheetChange((current) => updateSpreadsheetCell(current, activeSheet, editingCell.row, editingCell.column, editValue))
    setEditingCell(null)
    if (move) selectCell(move.row, move.column)
  }

  function moveAfterEdit(row: number, column: number, direction: 'down' | 'up' | 'next' | 'previous') {
    if (direction === 'down') return { row: row + 1, column }
    if (direction === 'up') return { row: row - 1, column }
    if (direction === 'previous') return column > 0 ? { row, column: column - 1 } : { row: row - 1, column: maxColumn }
    return column < maxColumn ? { row, column: column + 1 } : { row: row + 1, column: 0 }
  }

  function changeSheet(index: number) {
    if (editingCell) finishEdit()
    setActiveSheet(index)
  }

  function pasteCells(event: ReactClipboardEvent<HTMLTableCellElement>, row: number, column: number) {
    const value = event.clipboardData.getData('text/plain')
    if (!value) return
    event.preventDefault()
    pasteText(value, row, column)
  }

  function pasteText(value: string, row: number, column: number) {
    const rows = value
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .filter((line, index, all) => line || index < all.length - 1)
      .slice(0, previewMaxRow - row + 1)
      .map((line) => line.split('\t').slice(0, maxColumn - column + 1))
      .filter((items) => items.length)
    if (!rows.length) return
    applySheetChange((current) => rows.reduce(
      (result, values, rowOffset) => values.reduce(
        (next, item, columnOffset) => updateSpreadsheetCell(next, activeSheet, row + rowOffset, column + columnOffset, item),
        result,
      ),
      current,
    ))
    const pastedRows = rows.length
    const pastedColumns = Math.max(...rows.map((items) => items.length), 1)
    selectCell(row + pastedRows - 1, column + pastedColumns - 1)
  }

  async function copySelection() {
    const copied = Array.from({ length: selectionRange.maxRow - selectionRange.minRow + 1 }, (_, rowOffset) => (
      Array.from({ length: selectionRange.maxColumn - selectionRange.minColumn + 1 }, (_, columnOffset) => {
        const copiedCell = cellMap.get(`${selectionRange.minRow + rowOffset}:${selectionRange.minColumn + columnOffset}`)
        return editingCell?.row === selectionRange.minRow + rowOffset && editingCell.column === selectionRange.minColumn + columnOffset
          ? editValue : spreadsheetCellInputText(copiedCell)
      }).join('\t')
    )).join('\n')
    try {
      await navigator.clipboard.writeText(copied)
      setSaveError('')
      return true
    } catch {
      setSaveError('无法访问剪贴板')
      return false
    }
  }

  async function pasteFromClipboard() {
    if (!editable || isSaving) return
    try {
      const originalDraft = draftSheets
      const value = await navigator.clipboard.readText()
      if (currentDraftRef.current !== originalDraft) {
        setSaveError('表格已更改，请重新粘贴')
        return
      }
      if (value) {
        setEditingCell(null)
        pasteText(value, selectedCell.row, selectedCell.column)
      }
      setSaveError('')
    } catch {
      setSaveError('无法读取剪贴板')
    }
  }

  async function cutSelection() {
    if (!editable || isSaving) return
    const originalDraft = draftSheets
    if (!await copySelection()) return
    if (currentDraftRef.current !== originalDraft) {
      setSaveError('表格已更改，已复制但未清空原内容')
      return
    }
    clearSelectionContents()
  }

  function formatSelection(patch: SpreadsheetStylePatch | null) {
    if (!editable || isSaving) return
    applySheetChange((current) => {
      const next = editingCell ? updateSpreadsheetCell(current, activeSheet, editingCell.row, editingCell.column, editValue) : current
      return updateSpreadsheetRangeStyle(next, activeSheet, selectionRange, patch, styles)
    })
    setEditingCell(null)
  }

  function toggleCellStyle(key: 'bl' | 'it' | 'ul' | 'st') {
    const currentStyle = spreadsheetStyleRecord(selectedValue, styles)
    const currentValue = key === 'ul' || key === 'st'
      ? isRecord(currentStyle[key]) && currentStyle[key].s === 1
      : currentStyle[key] === 1
    formatSelection({ [key]: currentValue ? null : key === 'ul' || key === 'st' ? { s: 1 } : 1 })
  }

  function clearSelectionContents() {
    if (!editable || isSaving) return
    setEditingCell(null)
    applySheetChange((current) => {
      let next = current
      for (let row = selectionRange.minRow; row <= selectionRange.maxRow; row += 1) {
        for (let column = selectionRange.minColumn; column <= selectionRange.maxColumn; column += 1) {
          next = updateSpreadsheetCell(next, activeSheet, row, column, '')
        }
      }
      return next
    })
  }

  function clearSelectionFormat() {
    formatSelection(null)
  }

  function selectDimension(type: 'row' | 'column' | 'all', index?: number) {
    setEditingCell(null)
    setSelectedDimension({ type, index })
    if (type === 'row' && typeof index === 'number') {
      setSelectedCell({ row: index, column: 0 })
      setSelectionAnchor({ row: index, column: 0 })
    } else if (type === 'column' && typeof index === 'number') {
      setSelectedCell({ row: 0, column: index })
      setSelectionAnchor({ row: 0, column: index })
    } else {
      setSelectedCell({ row: 0, column: 0 })
      setSelectionAnchor({ row: 0, column: 0 })
    }
  }

  function startCellDrag(row: number, column: number, extend: boolean, clientX: number, clientY: number) {
    if (!extend) setSelectionAnchor({ row, column })
    setSelectedDimension(null)
    setSelectedCell({ row, column })
    dragPointerRef.current = { x: clientX, y: clientY }
    draggingSelectionRef.current = true
    draggedSelectionRef.current = false
  }

  function extendCellDrag(row: number, column: number) {
    if (!draggingSelectionRef.current) return
    if (row !== selectedCell.row || column !== selectedCell.column) draggedSelectionRef.current = true
    setSelectedDimension(null)
    setSelectedCell({ row, column })
  }

  function stopCellDrag() {
    draggingSelectionRef.current = false
    if (dragAutoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(dragAutoScrollFrameRef.current)
      dragAutoScrollFrameRef.current = null
    }
  }

  function startFillDrag(sourceRange: { minRow: number; maxRow: number; minColumn: number; maxColumn: number }) {
    if (!editable || isSaving) return
    setEditingCell(null)
    fillingSelectionRef.current = true
    fillSourceRangeRef.current = sourceRange
    fillTargetRef.current = { row: sourceRange.maxRow, column: sourceRange.maxColumn }
    setFillTarget({ row: sourceRange.maxRow, column: sourceRange.maxColumn })
  }

  async function saveChanges() {
    if (!editable || !onSave || !serialize || !raw || (!isDirty && !hasPendingEdit) || isSaving) return
    setIsSaving(true)
    setSaveError('')
    try {
      const sheetsToSave = editingCell ? updateSpreadsheetCell(draftSheets, activeSheet, editingCell.row, editingCell.column, editValue) : draftSheets
      if (editingCell) {
        setSheetHistory((current) => ({ ...current, current: sheetsToSave }))
        setEditingCell(null)
      }
      await onSave(raw, serialize(sheetsToSave))
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : '保存表格失败。')
    } finally {
      setIsSaving(false)
    }
  }

  function handleCellKeyDown(event: ReactKeyboardEvent<HTMLTableCellElement>, row: number, column: number) {
    if (editable && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) redoChange()
      else undoChange()
      return
    }
    if (editable && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      redoChange()
      return
    }
    if (!editable) {
      let nextRow = row
      let nextColumn = column
      if (event.key === 'ArrowUp') nextRow -= 1
      else if (event.key === 'ArrowDown') nextRow += 1
      else if (event.key === 'ArrowLeft') nextColumn -= 1
      else if (event.key === 'ArrowRight') nextColumn += 1
      else if (event.key === 'Tab') {
        if (event.shiftKey) {
          nextColumn -= 1
          if (nextColumn < 0) {
            nextColumn = maxColumn
            nextRow -= 1
          }
        } else {
          nextColumn += 1
          if (nextColumn > maxColumn) {
            nextColumn = 0
            nextRow += 1
          }
        }
      } else if (event.key === 'Enter') {
        nextRow += event.shiftKey ? -1 : 1
      } else {
        return
      }
      event.preventDefault()
      selectCell(nextRow, nextColumn)
      return
    }

    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault()
      beginEdit(row, column)
      return
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) {
      event.preventDefault()
      beginEdit(row, column, event.key)
      return
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      applySheetChange((current) => {
        let next = current
        for (let targetRow = selectionRange.minRow; targetRow <= selectionRange.maxRow; targetRow += 1) {
          for (let targetColumn = selectionRange.minColumn; targetColumn <= selectionRange.maxColumn; targetColumn += 1) {
            next = updateSpreadsheetCell(next, activeSheet, targetRow, targetColumn, '')
          }
        }
        return next
      })
      return
    }
    let nextRow = row
    let nextColumn = column
    if (event.key === 'ArrowUp') nextRow -= 1
    else if (event.key === 'ArrowDown') nextRow += 1
    else if (event.key === 'ArrowLeft') nextColumn -= 1
    else if (event.key === 'ArrowRight') nextColumn += 1
    else if (event.key === 'Tab') {
      if (event.shiftKey) {
        nextColumn -= 1
        if (nextColumn < 0) {
          nextColumn = maxColumn
          nextRow -= 1
        }
      } else {
        nextColumn += 1
        if (nextColumn > maxColumn) {
          nextColumn = 0
          nextRow += 1
        }
      }
    } else {
      return
    }
    event.preventDefault()
    selectCell(nextRow, nextColumn, true, event.shiftKey)
  }

  return (
    <section className={`spreadsheet-preview${editable ? ' is-editable' : ''}`} aria-label="Excel 表格">
      <SpreadsheetRibbon
        editable={editable}
        activeTab={ribbonTab}
        onTabChange={setRibbonTab}
        canUndo={Boolean(history.past.length)}
        canRedo={Boolean(history.future.length)}
        onUndo={undoChange}
        onRedo={redoChange}
        onCopy={() => void copySelection()}
        onCut={() => void cutSelection()}
        onPaste={() => void pasteFromClipboard()}
        onClearContents={clearSelectionContents}
        onClearFormat={clearSelectionFormat}
        onFormat={formatSelection}
        onToggle={toggleCellStyle}
        currentStyle={spreadsheetStyleRecord(selectedValue, styles)}
        onFillColor={(value) => formatSelection({ bg: value })}
        onTextColor={(value) => formatSelection({ cl: value })}
        showGridlines={showGridlines}
        onToggleGridlines={() => setShowGridlines((current) => !current)}
        zoom={zoom}
        onZoomChange={setZoom}
        canSave={isDirty || hasPendingEdit}
        isSaving={isSaving}
        onSave={() => void saveChanges()}
      />
      {sheets.length > 1 ? (
        <div className="sheet-tabs" role="tablist" aria-label="工作表">
          {sheets.map((item, index) => (
            <button
              key={`${item.name || 'Sheet'}-${index}`}
              className={index === activeSheet ? 'is-active' : ''}
              onClick={() => changeSheet(index)}
              role="tab"
              aria-selected={index === activeSheet}
            >
              {item.name || `工作表 ${index + 1}`}
            </button>
          ))}
        </div>
      ) : null}
      <div className="spreadsheet-formula-bar" aria-label="单元格内容">
        <span className="spreadsheet-name-box">{columnName(selectedCell.column)}{selectedCell.row + 1}</span>
        <span className="spreadsheet-formula-mark" aria-hidden="true">fx</span>
        {editingCell?.row === selectedCell.row && editingCell.column === selectedCell.column ? (
          <input
            ref={editInputRef}
            className="spreadsheet-formula-input"
            value={editValue}
            onChange={(event) => setEditValue(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Escape') {
                event.preventDefault()
                setEditingCell(null)
              } else if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault()
                finishEdit(moveAfterEdit(selectedCell.row, selectedCell.column, event.key === 'Tab' ? (event.shiftKey ? 'previous' : 'next') : (event.shiftKey ? 'up' : 'down')))
              }
            }}
            aria-label="编辑单元格内容"
          />
        ) : (
          <span className="spreadsheet-formula-value" title={selectedFormula || selectedDisplayValue}>
            {selectedFormula || selectedDisplayValue}
          </span>
        )}
      </div>
      <div ref={gridWrapRef} className={`spreadsheet-grid-wrap${showGridlines ? '' : ' is-gridlines-hidden'}`}>
        <table ref={gridRef} className="spreadsheet-grid" style={{ width: `${gridWidth}px`, minWidth: `${gridWidth}px`, zoom: zoom / 100 }}>
          <colgroup>
            <col className="spreadsheet-row-number-column" />
            {columnWidths.map((width, index) => <col key={index} style={{ width }} />)}
          </colgroup>
          <thead>
            <tr>
              <th aria-label="行号" className={selectedDimension?.type === 'all' ? 'is-selected' : undefined} onClick={() => selectDimension('all')} />
              {columnIndexes.map((column) => (
                <th
                  key={column}
                  className={selectedDimension?.type === 'all' || (selectedDimension?.type === 'column' && selectedDimension.index === column) || (!selectedDimension && selectedCell.column === column) ? 'is-selected' : ''}
                  onClick={() => selectDimension('column', column)}
                >
                  {columnName(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowIndexes.map((row) => {
              const sourceHeight = spreadsheetDimensionValue(sheet.rowData, row, ['ah', 'h', 'height'])
              return (
              <tr key={row} style={sourceHeight ? { height: `${Math.max(24, sourceHeight)}px` } : undefined}>
                <th
                  scope="row"
                  className={selectedDimension?.type === 'all' || (selectedDimension?.type === 'row' && selectedDimension.index === row) || (!selectedDimension && selectedCell.row === row) ? 'is-selected' : ''}
                  onClick={() => selectDimension('row', row)}
                >
                  {row + 1}
                </th>
                {columnIndexes.map((column) => {
                  const key = `${row}:${column}`
                  if (skippedCells.has(key)) return null
                  const cell = cellMap.get(key)
                  const merge = Array.isArray(cell?.merge) ? cell.merge : []
                  const univerMerge = mergedRanges.get(key)
                  const rowSpan = univerMerge ? Math.min(univerMerge[0], previewMaxRow - row + 1) : typeof merge[0] === 'number' ? Math.min(merge[0] + 1, previewMaxRow - row + 1) : 1
                  const colSpan = univerMerge ? Math.min(univerMerge[1], maxColumn - column + 1) : typeof merge[1] === 'number' ? Math.min(merge[1] + 1, maxColumn - column + 1) : 1
                  if (rowSpan > 1 || colSpan > 1) {
                    for (let nextRow = row; nextRow < row + rowSpan; nextRow += 1) {
                      for (let nextColumn = column; nextColumn < column + colSpan; nextColumn += 1) {
                        if (nextRow !== row || nextColumn !== column) skippedCells.add(`${nextRow}:${nextColumn}`)
                      }
                    }
                  }
                  const displayValue = spreadsheetCellDisplayText(cell, cellMap, styles)
                  const isActive = selectedKey === key
                  const isInSelection = hasSelectionRange
                    && row >= selectionRange.minRow
                    && row <= selectionRange.maxRow
                    && column >= selectionRange.minColumn
                    && column <= selectionRange.maxColumn
                  const isInFillPreview = Boolean(
                    fillPreviewRange
                    && (row < selectionRange.minRow || row > selectionRange.maxRow || column < selectionRange.minColumn || column > selectionRange.maxColumn)
                    && row >= fillPreviewRange.minRow
                    && row <= fillPreviewRange.maxRow
                    && column >= fillPreviewRange.minColumn
                    && column <= fillPreviewRange.maxColumn,
                  )
                  const showFillHandle = editable && !isSaving && !selectedDimension && !editingCell
                    && row === selectionRange.maxRow && column === selectionRange.maxColumn
                  const cellStyle = spreadsheetCellStyle(cell, styles)
                  return (
                    <td
                      key={column}
                      rowSpan={rowSpan}
                      colSpan={colSpan}
                      className={[isActive ? 'is-active' : isInSelection ? 'is-in-selection' : '', isInFillPreview ? 'is-fill-preview' : ''].filter(Boolean).join(' ') || undefined}
                      data-cell-key={key}
                      tabIndex={isActive ? 0 : -1}
                      aria-label={`${columnName(column)}${row + 1}${displayValue ? `，${displayValue}` : ''}`}
                      aria-selected={isActive}
                      title={displayValue || undefined}
                      style={cellStyle}
                      onMouseDown={(event) => {
                        if (event.button !== 0) return
                        event.preventDefault()
                        startCellDrag(row, column, event.shiftKey, event.clientX, event.clientY)
                        if (editingCell && (editingCell.row !== row || editingCell.column !== column)) finishEdit()
                      }}
                      onMouseEnter={() => extendCellDrag(row, column)}
                      onMouseUp={stopCellDrag}
                      onClick={(event) => {
                        if (draggedSelectionRef.current) {
                          draggedSelectionRef.current = false
                          return
                        }
                        selectCell(row, column, true, event.shiftKey)
                      }}
                      onDoubleClick={() => editable ? beginEdit(row, column) : undefined}
                      onCopy={(event) => {
                        event.preventDefault()
                        const copied = Array.from({ length: selectionRange.maxRow - selectionRange.minRow + 1 }, (_, rowOffset) => (
                          Array.from({ length: selectionRange.maxColumn - selectionRange.minColumn + 1 }, (_, columnOffset) => {
                            const copiedCell = cellMap.get(`${selectionRange.minRow + rowOffset}:${selectionRange.minColumn + columnOffset}`)
                            return spreadsheetCellFormula(copiedCell) || spreadsheetCellDisplayText(copiedCell, cellMap, styles)
                          }).join('\t')
                        )).join('\n')
                        event.clipboardData.setData('text/plain', copied)
                      }}
                      onPaste={(event) => editable ? pasteCells(event, row, column) : undefined}
                      onKeyDown={(event) => handleCellKeyDown(event, row, column)}
                    >
                      {editingCell?.row === row && editingCell.column === column ? (
                        <input
                          ref={editInputRef}
                          className="spreadsheet-cell-editor"
                          value={editValue}
                          onChange={(event) => setEditValue(event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                          onDoubleClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            event.stopPropagation()
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              setEditingCell(null)
                            } else if (event.key === 'Enter' || event.key === 'Tab') {
                              event.preventDefault()
                              finishEdit(moveAfterEdit(row, column, event.key === 'Tab' ? (event.shiftKey ? 'previous' : 'next') : (event.shiftKey ? 'up' : 'down')))
                            }
                          }}
                          aria-label={`编辑 ${columnName(column)}${row + 1}`}
                        />
                      ) : <span className="spreadsheet-cell-value">{displayValue}</span>}
                      {showFillHandle ? (
                        <button
                          type="button"
                          className="spreadsheet-fill-handle"
                          title="拖动填充柄"
                          aria-label="拖动填充柄"
                          onMouseDown={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            startFillDrag(selectionRange)
                          }}
                          onClick={(event) => event.stopPropagation()}
                        />
                      ) : null}
                    </td>
                  )
                })}
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <footer className="spreadsheet-status-bar">
        <span>{sheet.name || `工作表 ${activeSheet + 1}`}</span>
        <span>{maxRow + 1} 行 × {dataMaxColumn + 1} 列</span>
        {editable ? <span className={`spreadsheet-status-message${saveError ? ' is-error' : ''}`}>{saveError || (isDirty || hasPendingEdit ? '有未保存修改' : '可编辑')}</span> : <span className="spreadsheet-status-message">只读</span>}
        {editable && onSave ? <button className="secondary-button spreadsheet-save-button" onClick={() => void saveChanges()} disabled={(!isDirty && !hasPendingEdit) || isSaving}><Save size={14} />{isSaving ? '保存中' : '保存表格'}</button> : null}
      </footer>
    </section>
  )
}

function SpreadsheetPreview({ raw, type, editable = false, onSave }: { raw: string; type: string; editable?: boolean; onSave?: SpreadsheetSaveHandler }) {
  const workbook = useMemo(() => {
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return null
    }
  }, [raw])
  const workbookRecord = isRecord(workbook) ? workbook : null
  const sheets = useMemo(() => workbookRecord ? findSheets(workbookRecord) : [], [workbookRecord])

  // Univer sometimes emits a companion multisheet block containing only tab metadata.
  // The preceding sheet block already carries the worksheet cells, so there is nothing to render here.
  if (!sheets.length && type === 'multisheet') return null
  if (!sheets.length) return <span className="spreadsheet-unavailable">无法识别此 {type} 数据块中的工作表数据。</span>
  return <SpreadsheetGrid
    sheets={sheets}
    styles={isRecord(workbookRecord?.styles) ? workbookRecord.styles : undefined}
    editable={editable}
    raw={raw}
    onSave={onSave}
    serialize={(nextSheets) => JSON.stringify(workbookRecord ? spreadsheetWorkbookWithSheets(workbookRecord, nextSheets) : {})}
  />
}

function isSpreadsheetPath(path: string) {
  return /\.(?:xlsx|xls|xlsm|xltx|xltm|csv|ods)$/i.test(path)
}

function isPdfPath(path: string) {
  return /\.pdf$/i.test(path.split('?')[0])
}

function isOfficeDocumentPath(path: string) {
  return /\.(?:doc|docx|ppt|pptx|odt|odp)$/i.test(path.split('?')[0])
}

function spreadsheetBookType(path: string): 'xlsx' | 'xls' | 'xlsm' | 'csv' {
  const extension = path.split('?')[0].toLowerCase().split('.').pop()
  if (extension === 'xls') return 'xls'
  if (extension === 'xlsm') return 'xlsm'
  if (extension === 'csv') return 'csv'
  return 'xlsx'
}

function spreadsheetContentType(path: string) {
  const bookType = spreadsheetBookType(path)
  if (bookType === 'xls') return 'application/vnd.ms-excel'
  if (bookType === 'xlsm') return 'application/vnd.ms-excel.sheet.macroEnabled.12'
  if (bookType === 'csv') return 'text/csv'
  return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

function applySpreadsheetPreviewToWorkbook(workbook: WorkBook, sheets: SpreadsheetSheet[], XLSX: XlsxModule) {
  for (const previewSheet of sheets) {
    if (!previewSheet.name) continue
    const worksheet = workbook.Sheets[previewSheet.name]
    if (!worksheet) continue
    for (const { rowIndex, columnIndex, cell } of sheetCells(previewSheet)) {
      if (!cell) continue
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })
      const formula = spreadsheetCellFormula(cell)
      const value = cell.value ?? cell.v ?? (formula ? undefined : cell.text ?? '')
      if (!formula && (value === '' || value === undefined || value === null)) {
        delete worksheet[address]
        continue
      }
      const nextCell: Record<string, unknown> = { v: value }
      if (formula) nextCell.f = formula.replace(/^=/, '')
      worksheet[address] = nextCell as any
    }
  }
}

function isXdbPath(path: string) {
  return /\.xdb$/i.test(path.split('?')[0])
}

function isImagePath(path: string) {
  return /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(path.split('?')[0])
}

function spreadsheetSheetsFromWorkbook(workbook: WorkBook, utils: typeof import('xlsx').utils): SpreadsheetSheet[] {
  return workbook.SheetNames.map((name) => {
    const worksheet = workbook.Sheets[name]
    const cellData: JsonRecord = {}
    const ref = worksheet?.['!ref']
    let mergeData: Array<{ startRow: number; endRow: number; startColumn: number; endColumn: number }> = []
    if (worksheet && ref) {
      const range = utils.decode_range(ref)
      const lastRow = Math.min(range.e.r, range.s.r + MAX_SPREADSHEET_PREVIEW_ROWS - 1)
      const lastColumn = Math.min(range.e.c, range.s.c + MAX_SPREADSHEET_PREVIEW_COLUMNS - 1)
      for (let row = range.s.r; row <= lastRow; row += 1) {
        const cells: JsonRecord = {}
        for (let column = range.s.c; column <= lastColumn; column += 1) {
          const source = worksheet[utils.encode_cell({ r: row, c: column })]
          if (!source) continue
          cells[String(column - range.s.c)] = { text: source.w, value: source.v, formula: source.f }
        }
        if (Object.keys(cells).length) cellData[String(row - range.s.r)] = cells
      }
      mergeData = (worksheet['!merges'] ?? [])
        .filter((merge) => merge.s.r <= lastRow && merge.e.r >= range.s.r && merge.s.c <= lastColumn && merge.e.c >= range.s.c)
        .map((merge) => ({
          startRow: Math.max(merge.s.r, range.s.r) - range.s.r,
          endRow: Math.min(merge.e.r, lastRow) - range.s.r,
          startColumn: Math.max(merge.s.c, range.s.c) - range.s.c,
          endColumn: Math.min(merge.e.c, lastColumn) - range.s.c,
        }))
    }
    return { name, cellData, mergeData }
  })
}

async function downloadAttachment(connection: Connection, vault: string, path: string) {
  const response = await fetch(fileEndpoint(connection, vault, path), { headers: fnsHeaders(connection) })
  if (!response.ok) throw new Error('attachment request failed')
  const objectUrl = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = documentTitle(path)
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}

function SpreadsheetFilePreview({ path, connection, vault, editable = false, file }: { path: string; connection: Connection; vault: string; editable?: boolean; file?: FileSummary }) {
  const [sheets, setSheets] = useState<SpreadsheetSheet[]>([])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isDownloading, setIsDownloading] = useState(false)
  const workbookRef = useRef<WorkBook | null>(null)

  useEffect(() => {
    let ignore = false
    setSheets([])
    setError('')
    setIsLoading(true)
    const workbookModule = loadXlsxModule()
    const fileData = loadPreviewBlob(connection, vault, path).then((blob) => blob.arrayBuffer())
    Promise.all([fileData, workbookModule])
      .then(([data, XLSX]) => {
        const workbook = XLSX.read(data, { type: 'array', cellDates: true })
        workbookRef.current = workbook
        const nextSheets = spreadsheetSheetsFromWorkbook(workbook, XLSX.utils)
        if (!nextSheets.length) throw new Error('empty workbook')
        if (!ignore) setSheets(nextSheets)
      })
      .catch((reason: unknown) => {
        if (!ignore) setError('无法读取此 Excel 文件。')
      })
      .finally(() => {
        if (!ignore) setIsLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [connection.baseUrl, connection.clientType, connection.token, path, vault])

  async function download() {
    setIsDownloading(true)
    try {
      await downloadAttachment(connection, vault, path)
    } catch {
      setError('下载文件失败，请稍后重试。')
    } finally {
      setIsDownloading(false)
    }
  }

  async function saveSpreadsheet(_raw: string, nextRaw: string) {
    if (!editable || !file || !workbookRef.current) throw new Error('当前 Excel 文件不可编辑。')
    const XLSX = await loadXlsxModule()
    const nextSheets = JSON.parse(nextRaw) as SpreadsheetSheet[]
    applySpreadsheetPreviewToWorkbook(workbookRef.current, nextSheets, XLSX)
    const bookType = spreadsheetBookType(path)
    const bytes = XLSX.write(workbookRef.current, { bookType, type: 'array' }) as ArrayBuffer
    await uploadFile(connection, vault, path, new Blob([bytes], { type: spreadsheetContentType(path) }), Date.now())
    clearFilePreviewCache()
  }

  if (isLoading) return <span className="attachment-loading">正在加载 Excel 文件</span>
  if (error) return <section className="file-preview file-preview-error"><FileSpreadsheet size={22} /><div><strong>{documentTitle(path)}</strong><span>{error}</span></div><button className="secondary-button" onClick={() => void download()} disabled={isDownloading}><Download size={16} />{isDownloading ? '下载中' : '下载文件'}</button></section>
  return <SpreadsheetGrid sheets={sheets} editable={editable && Boolean(file)} raw={JSON.stringify(sheets)} onSave={saveSpreadsheet} serialize={(nextSheets) => JSON.stringify(nextSheets)} />
}

function YamlFilePreview({
  file,
  connection,
  vault,
  onSaved,
}: {
  file: FileSummary
  connection: Connection
  vault: string
  onSaved?: (file: FileSummary) => void
}) {
  const [content, setContent] = useState('')
  const [baseline, setBaseline] = useState('')
  const [contentHash, setContentHash] = useState(file.contentHash || '')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isDirty = content !== baseline

  useEffect(() => {
    let ignore = false
    setIsLoading(true)
    setError('')
    setContent('')
    setBaseline('')
    setContentHash(file.contentHash || '')
    const metadataPromise = file.contentHash ? Promise.resolve(file) : fnsApi.getFile(connection, vault, file.path)
    Promise.all([loadPreviewBlob(connection, vault, file.path), metadataPromise])
      .then(([blob, metadata]) => blob.text().then((text) => ({ metadata, text })))
      .then(({ metadata, text }) => {
        if (ignore) return
        setContent(text)
        setBaseline(text)
        setContentHash(metadata.contentHash || '')
      })
      .catch(() => {
        if (!ignore) setError('无法读取此 YAML 文件。')
      })
      .finally(() => {
        if (!ignore) setIsLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [connection.baseUrl, connection.clientType, connection.token, file.contentHash, file.path, reloadKey, vault])

  async function download() {
    setIsDownloading(true)
    try {
      await downloadAttachment(connection, vault, file.path)
    } catch {
      setError('下载 YAML 文件失败，请稍后重试。')
    } finally {
      setIsDownloading(false)
    }
  }

  async function save() {
    if (!isDirty || isSaving) return
    if (!contentHash) {
      setError('缺少当前文件版本，无法安全保存。请重新打开此文件。')
      return
    }
    setIsSaving(true)
    setError('')
    try {
      const saved = await uploadFile(
        connection,
        vault,
        file.path,
        new Blob([content], { type: 'application/yaml;charset=utf-8' }),
        Date.now(),
        { baseContentHash: contentHash },
      )
      const nextFile: FileSummary = {
        ...file,
        ...(saved || {}),
        path: file.path,
        size: new TextEncoder().encode(content).length,
      }
      setBaseline(content)
      setContentHash(nextFile.contentHash || '')
      clearFilePreviewCache()
      onSaved?.(nextFile)
    } catch (reason) {
      if (reason instanceof FnsApiError && reason.code === '458') {
        setError('远端内容已发生变化，未覆盖当前文件。请重新加载后再编辑。')
      } else {
        setError(reason instanceof Error ? reason.message : '保存 YAML 文件失败，请稍后重试。')
      }
    } finally {
      setIsSaving(false)
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void save()
    }
  }

  if (isLoading) return <span className="attachment-loading">正在加载 YAML 文件</span>
  if (error && !content) {
    return (
      <section className="file-preview file-preview-error" role="alert">
        <FileText size={22} />
        <div><strong>{documentTitle(file.path)}</strong><span>{error}</span></div>
        <button className="secondary-button" onClick={() => setReloadKey((value) => value + 1)}><RefreshCw size={16} />重新加载</button>
      </section>
    )
  }

  return (
    <section className="yaml-file-editor" aria-label={`${documentTitle(file.path)} YAML 编辑器`}>
      <div className="yaml-file-editor-toolbar">
        <div className="yaml-file-editor-title">
          <FileText size={16} />
          <strong>{documentTitle(file.path)}</strong>
          <span className="document-type-tag type-yaml">YAML</span>
          <small>{formatSize(file.size)} · {formatTime(file.updatedAt || file.mtime)}</small>
        </div>
        <div className="yaml-file-editor-actions">
          <span className={`yaml-file-editor-status${error ? ' is-error' : ''}`} role="status" aria-live="polite">
            {error || (isSaving ? '正在保存…' : isDirty ? '有未保存修改' : '已保存')}
          </span>
          <button className="icon-button compact" onClick={() => void download()} disabled={isDownloading} title="下载 YAML 文件" aria-label="下载 YAML 文件"><Download size={16} /></button>
          <button className="primary-button yaml-file-editor-save" onClick={() => void save()} disabled={!isDirty || isSaving} title="保存 YAML 文件（⌘/Ctrl+S）"><Save size={15} />{isSaving ? '保存中…' : '保存'}</button>
        </div>
      </div>
      <div className="yaml-file-editor-surface">
        <textarea
          ref={textareaRef}
          className="yaml-file-editor-input"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          wrap="off"
          aria-label="YAML 文件内容"
        />
      </div>
      <div className="yaml-file-editor-footer">
        <span>保留原始换行与 Unicode 文本</span>
        <span>{content.split(/\r?\n/).length} 行 · {content.length} 字符</span>
      </div>
    </section>
  )
}

function ImageFilePreview({ file, connection, vault }: { file: FileSummary; connection: Connection; vault: string }) {
  const [imageSrc, setImageSrc] = useState('')
  const [error, setError] = useState('')
  const [isDownloading, setIsDownloading] = useState(false)

  useEffect(() => {
    let ignore = false
    let objectUrl = ''
    setImageSrc('')
    setError('')
    loadPreviewBlob(connection, vault, file.path)
      .then((blob) => {
        if (!blob.type.startsWith('image/') && !isImagePath(file.path)) throw new Error('unsupported image type')
        objectUrl = URL.createObjectURL(blob)
        if (!ignore) setImageSrc(objectUrl)
      })
      .catch((reason: unknown) => {
        if (!ignore) setError('无法加载此图片文件。')
      })
    return () => {
      ignore = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [connection.baseUrl, connection.clientType, connection.token, file.path, vault])

  async function download() {
    setIsDownloading(true)
    setError('')
    try {
      await downloadAttachment(connection, vault, file.path)
    } catch {
      setError('下载图片失败，请稍后重试。')
    } finally {
      setIsDownloading(false)
    }
  }

  if (error) return <section className="file-preview file-preview-error"><Image size={22} /><div><strong>{documentTitle(file.path)}</strong><span>{error}</span></div><button className="secondary-button" onClick={() => void download()} disabled={isDownloading}><Download size={16} />{isDownloading ? '下载中' : '下载图片'}</button></section>
  if (!imageSrc) return <span className="attachment-loading">正在加载图片</span>
  return (
    <figure className="file-image-preview">
      <div className="file-image-preview-toolbar">
        <span><Image size={15} />{documentTitle(file.path)}</span>
        <span className="file-image-preview-actions">
          <small>{formatSize(file.size)} · {formatTime(file.updatedAt || file.mtime)}</small>
          <button className="icon-button compact" onClick={() => window.open(imageSrc, '_blank', 'noopener,noreferrer')} title="在新窗口查看图片" aria-label="在新窗口查看图片"><Eye size={16} /></button>
          <button className="icon-button compact" onClick={() => void download()} disabled={isDownloading} title="下载图片" aria-label="下载图片"><Download size={16} /></button>
        </span>
      </div>
      <button type="button" className="file-image-preview-canvas" onClick={() => window.open(imageSrc, '_blank', 'noopener,noreferrer')} title="点击在新窗口查看原图">
        <img src={imageSrc} alt={documentTitle(file.path)} />
      </button>
    </figure>
  )
}

function PdfFilePreview({ file, connection, vault }: { file: FileSummary; connection: Connection; vault: string }) {
  const [pdfSrc, setPdfSrc] = useState('')
  const [error, setError] = useState('')
  const [isDownloading, setIsDownloading] = useState(false)

  useEffect(() => {
    let ignore = false
    let objectUrl = ''
    setPdfSrc('')
    setError('')
    loadPreviewBlob(connection, vault, file.path)
      .then((blob) => {
        objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
        if (!ignore) setPdfSrc(objectUrl)
      })
      .catch(() => { if (!ignore) setError('无法加载此 PDF 文件。') })
    return () => {
      ignore = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [connection.baseUrl, connection.clientType, connection.token, file.path, vault])

  async function download() {
    setIsDownloading(true)
    try { await downloadAttachment(connection, vault, file.path) }
    catch { setError('下载文件失败，请稍后重试。') }
    finally { setIsDownloading(false) }
  }

  if (error) return <section className="file-preview file-preview-error"><FileText size={22} /><div><strong>{documentTitle(file.path)}</strong><span>{error}</span></div><button className="secondary-button" onClick={() => void download()} disabled={isDownloading}><Download size={16} />{isDownloading ? '下载中' : '下载 PDF'}</button></section>
  if (!pdfSrc) return <span className="attachment-loading">正在加载 PDF 文件</span>
  return <section className="file-pdf-preview"><div className="file-image-preview-toolbar"><span><FileText size={15} />{documentTitle(file.path)}</span><button className="secondary-button" onClick={() => void download()} disabled={isDownloading}><Download size={15} />{isDownloading ? '下载中' : '下载 PDF'}</button></div><iframe title={documentTitle(file.path)} src={pdfSrc} /></section>
}

function OfficeFilePreview({ file, connection, vault }: { file: FileSummary; connection: Connection; vault: string }) {
  const [pdfSrc, setPdfSrc] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let ignore = false
    let objectUrl = ''
    setPdfSrc('')
    setError('')
    fetch(filePreviewEndpoint(connection, vault, file.path), { headers: fnsHeaders(connection) })
      .then((response) => {
        if (!response.ok) throw new Error('office preview failed')
        return response.blob()
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
        if (!ignore) setPdfSrc(objectUrl)
      })
      .catch(() => { if (!ignore) setError('无法渲染此 Office 文件，请下载后查看。') })
    return () => {
      ignore = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [connection.baseUrl, connection.clientType, connection.token, file.path, vault])

  if (error) return <section className="file-preview file-preview-error"><FileText size={22} /><div><strong>{documentTitle(file.path)}</strong><span>{error}</span></div></section>
  if (!pdfSrc) return <span className="attachment-loading">正在渲染 Office 文件</span>
  return <section className="file-pdf-preview"><div className="file-image-preview-toolbar"><span><FileText size={15} />{documentTitle(file.path)}</span></div><iframe title={documentTitle(file.path)} src={pdfSrc} /></section>
}

function UniverEditorLoading() {
  return (
    <section className="univer-file-editor" aria-busy="true" aria-label="正在加载文件编辑器">
      <div className="univer-file-editor-loading">正在加载文件编辑器…</div>
    </section>
  )
}

function FilePreview({ file, connection, vault, saveStatusTarget, onSaved }: { file: FileSummary; connection: Connection; vault: string; saveStatusTarget?: HTMLElement | null; onSaved?: (file: FileSummary) => void }) {
  const [error, setError] = useState('')
  const [isDownloading, setIsDownloading] = useState(false)

  async function download() {
    setIsDownloading(true)
    setError('')
    try {
      await downloadAttachment(connection, vault, file.path)
    } catch {
      setError('下载文件失败，请稍后重试。')
    } finally {
      setIsDownloading(false)
    }
  }

  if (isUniverFilePath(file.path)) return <Suspense fallback={<UniverEditorLoading />}><UniverFileEditor file={file} connection={connection} vault={vault} saveStatusTarget={saveStatusTarget} /></Suspense>
  if (isSpreadsheetPath(file.path)) return <SpreadsheetFilePreview path={file.path} connection={connection} vault={vault} editable file={file} />
  if (isYamlPath(file.path)) return <YamlFilePreview file={file} connection={connection} vault={vault} onSaved={onSaved} />
  if (isPdfPath(file.path)) return <PdfFilePreview file={file} connection={connection} vault={vault} />
  if (isOfficeDocumentPath(file.path)) return <OfficeFilePreview file={file} connection={connection} vault={vault} />
  if (isXdbPath(file.path)) return <XdbPage key={`${vault}:${file.path}`} path={file.path} connection={connection} vault={vault} />
  if (isImagePath(file.path)) return <ImageFilePreview file={file} connection={connection} vault={vault} />
  return (
    <section className="file-preview" aria-label="附件预览">
      <File size={24} />
      <div>
        <strong>{documentTitle(file.path)}</strong>
        <span>{formatSize(file.size)} · {formatTime(file.updatedAt || file.mtime)}</span>
        {error ? <em>{error}</em> : null}
      </div>
      <button className="secondary-button" onClick={() => void download()} disabled={isDownloading}><Download size={16} />{isDownloading ? '下载中' : '下载文件'}</button>
    </section>
  )
}

function DocumentAttachment({
  src,
  alt,
  connection,
  vault,
  notePath,
  fileLinks,
}: {
  src?: string
  alt?: string
  connection: Connection
  vault: string
  notePath: string
  fileLinks?: Record<string, string>
}) {
  const sizeMatch = alt ? /\|(\d+)(?:x(\d+))?$/.exec(alt) : null
  const cleanAlt = sizeMatch && alt ? alt.slice(0, sizeMatch.index) : alt
  const specifiedWidth = sizeMatch ? Number(sizeMatch[1]) : undefined
  const attachmentPath = src ? resolveAttachmentPath(src, notePath, connection, fileLinks) : ""
  if (attachmentPath && isUniverFilePath(attachmentPath)) return <Suspense fallback={<UniverEditorLoading />}><UniverFileEditor file={{ id: 0, path: attachmentPath, pathHash: '', mtime: Date.now(), size: 0 }} connection={connection} vault={vault} /></Suspense>
  if (attachmentPath && isSpreadsheetPath(attachmentPath)) return <SpreadsheetFilePreview path={attachmentPath} connection={connection} vault={vault} />
  return <AuthenticatedImage src={src} alt={cleanAlt} width={specifiedWidth} connection={connection} vault={vault} notePath={notePath} fileLinks={fileLinks} />
}

function MarkdownCode({
  className,
  children,
  isBlock: isBlockProp,
  editable = false,
  onSpreadsheetSave,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<'code'> & {
  isBlock?: boolean
  editable?: boolean
  onSpreadsheetSave?: SpreadsheetSaveHandler
  node?: unknown
}) {
  const text = String(children).replace(/\n$/, '')
  const specifiedLanguage = cleanCodeLanguage(className)
  const isBlock = Boolean(isBlockProp || specifiedLanguage || text.includes('\n'))
  const language = specifiedLanguage || (isBlock ? inferCodeLanguage(text) : '')
  if (!isBlock) return <code className={className} {...props}>{children}</code>
  if (language === 'sheet' || language === 'multisheet') {
    return <SpreadsheetPreview raw={text} type={language} editable={editable} onSave={onSpreadsheetSave} />
  }

  return (
    <CodeBlockComponent className={className} isBlock={isBlock} {...props}>
      {children}
    </CodeBlockComponent>
  )
}

function resolveAttachmentPath(src: string, notePath: string, connection: Connection, fileLinks?: Record<string, string>) {
  if (src.startsWith('#fns-media:')) return decodeURIComponent(src.slice('#fns-media:'.length))
  const mapped = fileLinks?.[src]
  if (mapped) return mapped
  if (/^https?:/i.test(src)) {
    try {
      const target = new URL(src)
      const service = new URL(connection.baseUrl)
      if (target.origin === service.origin && target.pathname === '/api/file') return target.searchParams.get('path') || ''
    } catch {
      return ''
    }
    return ''
  }
  if (src.startsWith('/api/file')) {
    try {
      return new URL(src, connection.baseUrl).searchParams.get('path') || ''
    } catch {
      return ''
    }
  }
  if (/^(data:|blob:|#)/i.test(src)) return ''

  const parts = [...notePath.split('/').slice(0, -1), ...decodeURIComponent(src).split('?')[0].split('/')]
  return parts.reduce<string[]>((resolved, part) => {
    if (!part || part === '.') return resolved
    if (part === '..') return resolved.slice(0, -1)
    return [...resolved, part]
  }, []).join('/')
}

function documentCover(data?: Frontmatter) {
  if (!data) return null
  for (const key of ['coverImage', 'cover', 'image']) {
    const value = data[key]
    const cover = Array.isArray(value) ? value[0] : value
    if (typeof cover === 'string' && cover.trim()) return { key, value: cover.trim() }
  }
  return null
}

function documentCoverSource(value: string, notePath: string, connection: Connection, fileLinks?: Record<string, string>) {
  const trimmed = value.trim()
  const markdownImage = /^!\[[^\]]*\]\(([^)]+)\)$/.exec(trimmed)
  const wikiLink = /^!?\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/.exec(trimmed)
  const rawSource = markdownImage?.[1]?.trim().replace(/^<|>$/g, '') || wikiLink?.[1]?.trim() || trimmed
  if (/^(?:https?:|data:|blob:|#fns-media:)/i.test(rawSource)) return rawSource
  const attachmentPath = resolveAttachmentPath(rawSource, notePath, connection, fileLinks)
  return attachmentPath ? `#fns-media:${encodeURIComponent(attachmentPath)}` : rawSource
}

function DocumentCover({
  cover,
  icon,
  connection,
  vault,
  notePath,
  fileLinks,
  editable,
  isBusy,
  onChoose,
  onRandom,
  onRemove,
  onIconClick,
}: {
  cover?: string
  icon?: string
  connection: Connection
  vault: string
  notePath: string
  fileLinks?: Record<string, string>
  editable: boolean
  isBusy?: boolean
  onChoose: () => void
  onRandom: () => void
  onRemove: () => void
  onIconClick?: () => void
}) {
  if (!cover) {
    return editable ? (
      <div className="document-cover-empty">
        <div className="document-cover-empty-actions">
          <button type="button" onClick={onChoose} disabled={isBusy}>
            <Image size={16} aria-hidden="true" />
            {isBusy ? '正在上传题头图…' : '添加题头图'}
          </button>
          <button type="button" onClick={onRandom} disabled={isBusy}>
            <RefreshCw size={16} aria-hidden="true" />
            {isBusy ? '正在获取…' : '随机获取'}
          </button>
        </div>
        <span>支持 JPG、PNG、WEBP 等图片格式；随机图片来自网络，离线时可能无法显示</span>
      </div>
    ) : null
  }

  return (
    <section className="document-cover" aria-label="文档题头图">
      <AuthenticatedImage
        src={documentCoverSource(cover, notePath, connection, fileLinks)}
        alt="文档题头图"
        connection={connection}
        vault={vault}
        notePath={notePath}
        fileLinks={fileLinks}
      />
      {onIconClick ? (
        <button
          type="button"
          className={`document-cover-icon${icon ? ' has-icon' : ''}`}
          onClick={onIconClick}
          aria-label={icon ? '更换文档表情图标' : '添加文档表情图标'}
          title={icon ? '更换表情图标' : '添加表情图标'}
        >
          {icon ? <span className="document-emoji-icon" aria-hidden="true">{icon}</span> : <FileText size={28} aria-hidden="true" />}
        </button>
      ) : null}
      {editable ? (
        <div className="document-cover-actions" role="toolbar" aria-label="题头图操作">
          <button type="button" onClick={onChoose} disabled={isBusy}>{isBusy ? '上传中…' : '更换'}</button>
          <button type="button" onClick={onRandom} disabled={isBusy}>{isBusy ? '获取中…' : '随机换图'}</button>
          <button type="button" onClick={onRemove} disabled={isBusy}>移除</button>
        </div>
      ) : null}
    </section>
  )
}

function AuthenticatedImage({
  src,
  alt,
  width,
  connection,
  vault,
  notePath,
  fileLinks,
}: {
  src?: string
  alt?: string
  width?: number
  connection: Connection
  vault: string
  notePath: string
  fileLinks?: Record<string, string>
}) {
  const [imageSrc, setImageSrc] = useState("")
  const [failed, setFailed] = useState(false)
  const attachmentPath = src ? resolveAttachmentPath(src, notePath, connection, fileLinks) : ""

  useEffect(() => {
    if (!src || !attachmentPath || !connection.baseUrl || !connection.token || !vault) {
      setImageSrc(src || "")
      return
    }

    let ignore = false
    let objectUrl = ""
    setFailed(false)
    setImageSrc("")
    loadPreviewBlob(connection, vault, attachmentPath)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        if (!ignore) setImageSrc(objectUrl)
      })
      .catch(() => {
        if (!ignore) setFailed(true)
      })

    return () => {
      ignore = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachmentPath, connection.baseUrl, connection.clientType, connection.token, src, vault])

  if (failed) return <span className="attachment-failed">附件无法加载：{alt || "未知文件"}</span>
  if (!imageSrc) return <span className="attachment-loading">正在加载附件</span>
  const figureStyle = width ? { maxWidth: `min(100%, ${width}px)`, width: `${width}px` } : undefined
  return (
    <figure className="document-image" style={figureStyle}>
      <button type="button" className="image-preview-button" onClick={() => window.open(imageSrc, "_blank", "noopener,noreferrer")} title="在新窗口查看图片">
        <img src={imageSrc} alt={alt || ""} loading="lazy" />
      </button>
      {alt ? <figcaption>{alt}</figcaption> : null}
    </figure>
  )
}

function parentPath(path: string) {
  return path.split('/').slice(0, -1).join('/')
}

function noteSummary(note: Note): NoteSummary {
  return {
    id: note.id,
    path: note.path,
    pathHash: note.pathHash,
    mtime: note.mtime,
    size: note.size || new Blob([note.content || '']).size,
    updatedAt: note.updatedAt,
  }
}

function libraryNote(note: NoteSummary): LibraryItem {
  return { ...note, kind: 'note' }
}

function libraryFile(file: FileSummary): LibraryItem {
  return { ...file, kind: 'file' }
}

function normalizeDocumentPath(path: string) {
  const normalized = path.trim().replace(/^\/+/, '')
  if (!normalized) return ''
  return /\.md$/i.test(normalized) ? normalized : `${normalized}.md`
}

function publicShareUrl(share: Share) {
  return `${share.baseUrl.replace(/\/$/, '')}/share/${share.id}/${share.token}`
}

function dateInputValue(value?: string) {
  if (!value) return ''
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
  return new Date(timestamp).toISOString().slice(0, 10)
}

function expireAtFromDate(value: string) {
  if (!value) return 0
  const timestamp = Date.parse(`${value}T23:59:59`)
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0
}

type DirectorySortMode = 'name-asc' | 'name-desc' | 'count-desc'

const directoryCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
const directorySortLabels: Record<DirectorySortMode, string> = {
  'name-asc': '名称 A-Z',
  'name-desc': '名称 Z-A',
  'count-desc': '文档数',
}

function sortFolders(nodes: FolderNode[], mode: DirectorySortMode) {
  return [...nodes].sort((left, right) => {
    const leftCount = left.noteCount + left.fileCount
    const rightCount = right.noteCount + right.fileCount
    if (mode === 'count-desc' && rightCount !== leftCount) return rightCount - leftCount
    const comparison = directoryCollator.compare(left.name || left.path, right.name || right.path)
    return mode === 'name-desc' ? -comparison : comparison
  })
}

function sortFolderItems(items: LibraryItem[], mode: DirectorySortMode) {
  return [...items].sort((left, right) => {
    if (mode === 'count-desc') return right.mtime - left.mtime
    const comparison = directoryCollator.compare(documentTitle(left.path), documentTitle(right.path))
    return mode === 'name-desc' ? -comparison : comparison
  })
}

function LibraryItemIcon({ item, icon, size = 15 }: { item: LibraryItem; icon?: string; size?: number }) {
  if (icon) return <span className="document-emoji-icon tree-item-icon" aria-hidden="true">{icon}</span>
  const Icon = item.kind === 'file'
    ? (isSpreadsheetPath(item.path) ? FileSpreadsheet : isImagePath(item.path) ? Image : File)
    : FileText
  return <Icon className="tree-item-icon" size={size} aria-hidden="true" />
}

function DocumentRefIcon({ kind, path, icon, size = 15 }: { kind: 'note' | 'file'; path: string; icon?: string; size?: number }) {
  if (icon) return <span className="document-emoji-icon tree-item-icon" aria-hidden="true">{icon}</span>
  const Icon = kind === 'file' ? (isSpreadsheetPath(path) ? FileSpreadsheet : isImagePath(path) ? Image : File) : FileText
  return <Icon className="tree-item-icon" size={size} aria-hidden="true" />
}

function FolderItemIcon({ icon, expanded, size = 16 }: { icon?: string; expanded?: boolean; size?: number }) {
  if (icon) return <span className="document-emoji-icon tree-item-icon" aria-hidden="true">{icon}</span>
  const Icon = expanded ? FolderOpen : Folder
  return <Icon className="tree-item-icon" size={size} aria-hidden="true" />
}

type TreeMenuState = {
  type: "folder"
  path: string
  rect: { top: number; bottom: number; left: number; right: number }
} | {
  type: "item"
  item: LibraryItem
  rect: { top: number; bottom: number; left: number; right: number }
}

type IconPickerTarget = { kind: DocumentIconKind; path: string; vault: string }

function DocumentIconPicker({ target, currentIcon, onChoose, onClose }: {
  target: IconPickerTarget
  currentIcon?: string
  onChoose: (icon?: string) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState('all')
  const [validationError, setValidationError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef(document.activeElement as HTMLElement | null)
  const options = useMemo(() => findDocumentIconOptions(query, categoryId), [categoryId, query])
  const categoryLabel = documentIconCategoryTabs.find((category) => category.id === categoryId)?.label || '全部'

  useEffect(() => {
    const focusTarget = dialogRef.current?.querySelector<HTMLButtonElement>('.document-icon-grid button[aria-pressed="true"], .document-icon-grid button')
    focusTarget?.focus()
    return () => {
      if (previousFocus.current?.isConnected) previousFocus.current.focus()
    }
  }, [])

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
    const grid = dialogRef.current?.querySelector<HTMLElement>('.document-icon-grid')
    const buttons = Array.from(grid?.querySelectorAll<HTMLButtonElement>('button') || [])
    const currentIndex = buttons.indexOf(event.target as HTMLButtonElement)
    const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(/\s+/).length : 6
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key]
    if (offset !== undefined && currentIndex >= 0) {
      event.preventDefault()
      buttons[(currentIndex + offset + buttons.length) % buttons.length].focus()
    }
    if (event.key === 'Tab') {
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button, input') || [])
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }

  function chooseCustomIcon(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const icon = normalizeDocumentIcon(draft)
    if (!icon) { setValidationError('请输入一个表情符号。'); return }
    onChoose(icon)
  }

  return createPortal(
    <div className="dialog-backdrop document-icon-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} className="document-icon-dialog" role="dialog" aria-modal="true" aria-labelledby="document-icon-title" onKeyDown={handleKeyDown}>
        <div className="document-icon-heading">
          <div><h2 id="document-icon-title">设置表情图标</h2><p title={target.path}>{documentTitle(target.path) || '根目录'}</p></div>
          <button type="button" className="icon-button" aria-label="关闭图标选择" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="document-icon-controls">
          <label className="document-icon-search-label" htmlFor="document-icon-search">搜索表情</label>
          <div className="document-icon-search">
            <Search size={15} aria-hidden="true" />
            <input id="document-icon-search" type="search" value={query} placeholder="搜索名称，如：书、办公、花" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
          </div>
          <div className="document-icon-categories" role="group" aria-label="表情分类">
            {documentIconCategoryTabs.map((category) => <button key={category.id} type="button" aria-pressed={!query && categoryId === category.id} className={!query && categoryId === category.id ? 'is-selected' : ''} onClick={() => { setQuery(''); setCategoryId(category.id) }}>{category.label}</button>)}
          </div>
        </div>
        <div className="document-icon-grid" role="group" aria-label={`${query ? '搜索结果' : categoryLabel}表情`}>
          {options.length ? options.map(([icon, name]) => <button key={icon} type="button" title={name} className={currentIcon === icon ? 'is-selected' : ''} aria-label={`使用${name}${icon}图标`} aria-pressed={currentIcon === icon} onClick={() => onChoose(icon)}>{icon}</button>) : <p className="document-icon-empty">没有匹配的表情，可以输入或粘贴自定义表情。</p>}
        </div>
        <form className="document-icon-custom" onSubmit={chooseCustomIcon}>
          <label htmlFor="document-icon-input">自定义表情</label>
          <div><input id="document-icon-input" value={draft} placeholder="输入或粘贴一个表情" autoComplete="off" aria-describedby={validationError ? 'document-icon-error' : undefined} onChange={(event) => { setDraft(event.target.value); setValidationError('') }} /><button type="submit" className="secondary-button">使用</button></div>
          {validationError ? <p id="document-icon-error" className="dialog-error" role="alert">{validationError}</p> : null}
        </form>
        <div className="document-icon-footer"><span>保存在当前浏览器</span><button type="button" className="secondary-button" disabled={!currentIcon} onClick={() => onChoose()}>清除图标</button></div>
      </div>
    </div>, document.body,
  )
}

function TreeContextMenu({
  menu,
  onClose,
  onCreateNoteInFolder,
  onCreateFileInFolder,
  onCreateFolderInFolder,
  onUploadFileInFolder,
  onDeleteFolder,
  onRenameItem,
  onDeleteItem,
  onMoveItem,
  onShareItem,
  onDownloadItem,
  onCopyPath,
  onChooseIcon,
  getIcon,
}: {
  menu: TreeMenuState
  onClose: () => void
  onCreateNoteInFolder: (folderPath: string) => void
  onCreateFileInFolder: (folderPath: string, type: NewFileType) => void
  onCreateFolderInFolder: (folderPath: string) => void
  onUploadFileInFolder: (folderPath: string) => void
  onDeleteFolder: (folderPath: string) => void
  onRenameItem: (item: LibraryItem) => void
  onDeleteItem: (item: LibraryItem) => void
  onMoveItem: (item: LibraryItem) => void
  onShareItem: (item: LibraryItem) => void
  onDownloadItem: (item: LibraryItem) => void
  onCopyPath: (path: string) => void
  onChooseIcon: (kind: DocumentIconKind, path: string) => void
  getIcon: (kind: DocumentIconKind, path: string) => string | undefined
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") onClose()
        return
      }
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose()
      }
    }
    window.addEventListener("pointerdown", handleClickOutside)
    window.addEventListener("keydown", handleClickOutside)
    return () => {
      window.removeEventListener("pointerdown", handleClickOutside)
      window.removeEventListener("keydown", handleClickOutside)
    }
  }, [onClose])

  const menuHeight = menu.type === "folder" ? 458 : 294
  const top = menu.rect.bottom + 4 + menuHeight > window.innerHeight
    ? Math.max(8, menu.rect.top - menuHeight - 4)
    : menu.rect.bottom + 4
  const left = Math.max(8, Math.min(menu.rect.left, window.innerWidth - 224))

  return (
    <div
      ref={menuRef}
      className="tree-context-menu"
      style={{ top: `${top}px`, left: `${left}px` }}
      role="menu"
    >
      {menu.type === "folder" ? (
        <>
          <button
            role="menuitem"
            onPointerDown={(e) => {
              e.stopPropagation()
              onCreateNoteInFolder(menu.path)
              onClose()
            }}
          >
            <FilePlus2 size={14} />新建 Markdown 文档
          </button>
          {newFileTypeOptions.map((option) => (
            <button
              key={option.value}
              role="menuitem"
              onPointerDown={(e) => {
                e.stopPropagation()
                onCreateFileInFolder(menu.path, option.value)
                onClose()
              }}
            >
              {option.value === 'xlsx' ? <FileSpreadsheet size={14} /> : option.value === 'pptx' ? <Presentation size={14} /> : <FileText size={14} />}
              新建{option.label}
            </button>
          ))}
          <button
            role="menuitem"
            onPointerDown={(e) => {
              e.stopPropagation()
              onCreateFolderInFolder(menu.path)
              onClose()
            }}
          >
            <FolderPlus size={14} />新建子目录
          </button>
          <button
            role="menuitem"
            onPointerDown={(e) => {
              e.stopPropagation()
              onUploadFileInFolder(menu.path)
              onClose()
            }}
          >
            <Upload size={14} />上传文件
          </button>
          <button
            role="menuitem"
            onPointerDown={(e) => {
              e.stopPropagation()
              onCopyPath(menu.path)
              onClose()
            }}
          >
            <Copy size={14} />复制路径
          </button>
          <button
            role="menuitem"
            onClick={() => { onChooseIcon('folder', menu.path); onClose() }}
          >
            <Smile size={14} />{getIcon('folder', menu.path) ? '更换表情图标' : '设置表情图标'}
          </button>
          <div className="tree-context-menu-divider" />
          <button
            className="is-danger"
            role="menuitem"
            onPointerDown={(e) => {
              e.stopPropagation()
              onDeleteFolder(menu.path)
              onClose()
            }}
          >
            <Trash2 size={14} />删除目录
          </button>
        </>
      ) : (
        <>
          <button
            role="menuitem"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation()
              const item = menu.item
              onRenameItem(item)
              onClose()
            }}
          >
            <FileText size={14} />重命名
          </button>
          <button
            role="menuitem"
            onPointerDown={(e) => {
              e.stopPropagation()
              onMoveItem(menu.item)
              onClose()
            }}
          >
            <Folder size={14} />移动到目录
          </button>
          <button
            role="menuitem"
            onPointerDown={(e) => {
              e.stopPropagation()
              onCopyPath(menu.item.path)
              onClose()
            }}
          >
            <Copy size={14} />复制路径
          </button>
          <button
            role="menuitem"
            onClick={() => { onChooseIcon(menu.item.kind, menu.item.path); onClose() }}
          >
            <Smile size={14} />{getIcon(menu.item.kind, menu.item.path) ? '更换表情图标' : '设置表情图标'}
          </button>
          {menu.item.kind === "file" ? (
            <button
              role="menuitem"
              onPointerDown={(e) => {
                e.stopPropagation()
                onDownloadItem(menu.item)
                onClose()
              }}
            >
              <Download size={14} />下载源文件
            </button>
          ) : null}
          {menu.item.kind === "note" ? (
            <button
              role="menuitem"
              onPointerDown={(e) => {
                e.stopPropagation()
                onShareItem(menu.item)
                onClose()
              }}
            >
              <Share2 size={14} />分享文档
            </button>
          ) : null}
          <div className="tree-context-menu-divider" />
          <button
            className="is-danger"
            role="menuitem"
            onPointerDown={(e) => {
              e.stopPropagation()
              onDeleteItem(menu.item)
              onClose()
            }}
          >
            <Trash2 size={14} />删除{menu.item.kind === "file" ? "文件" : "文档"}
          </button>
        </>
      )}
    </div>
  )
}

function MoveItemDialog({
  item,
  folders,
  onClose,
  onMove,
}: {
  item: LibraryItem
  folders: FolderNode[]
  onClose: () => void
  onMove: (folderPath: string) => Promise<void>
}) {
  const [targetFolder, setTargetFolder] = useState(parentPath(item.path))
  const [filter, setFilter] = useState('')
  const [isMoving, setIsMoving] = useState(false)
  const [error, setError] = useState('')

  const folderOptions = useMemo(() => {
    const options: Array<{ path: string; name: string }> = [{ path: '', name: '根目录' }]
    function visit(nodes: FolderNode[], depth = 0) {
      for (const node of sortFolders(nodes, 'name-asc')) {
        options.push({ path: node.path, name: `${'　'.repeat(depth)}${node.name || node.path}` })
        if (node.children?.length) visit(node.children, depth + 1)
      }
    }
    visit(folders)
    const query = filter.trim().toLocaleLowerCase()
    return query ? options.filter((option) => option.path.toLocaleLowerCase().includes(query) || option.name.toLocaleLowerCase().includes(query)) : options
  }, [filter, folders])

  async function submit() {
    if (targetFolder === parentPath(item.path)) {
      onClose()
      return
    }
    setIsMoving(true)
    setError('')
    try {
      await onMove(targetFolder)
      onClose()
    } catch (reason) {
      setError(reason instanceof FnsApiError ? reason.message : '移动失败，请稍后重试。')
    } finally {
      setIsMoving(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="connection-dialog compact-dialog move-item-dialog" role="dialog" aria-modal="true" aria-labelledby="move-item-title">
        <div className="dialog-heading">
          <div>
            <p>移动{item.kind === 'file' ? '文件' : '文档'}</p>
            <h2 id="move-item-title">选择目标目录</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭移动对话框"><X size={18} /></button>
        </div>
        <p className="dialog-copy move-item-name"><File size={14} />{documentTitle(item.path)}</p>
        <label className="move-folder-search">
          <span>筛选目录</span>
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="搜索目录名称" autoFocus />
        </label>
        <div className="move-folder-list" role="listbox" aria-label="目标目录">
          {folderOptions.map((option) => (
            <button key={option.path || '__root__'} type="button" className={`move-folder-option ${targetFolder === option.path ? 'is-selected' : ''}`} onClick={() => setTargetFolder(option.path)}>
              {targetFolder === option.path ? <Check size={14} /> : <Folder size={14} />}
              <span>{option.name}</span>
            </button>
          ))}
          {folderOptions.length === 0 ? <p className="muted-empty">没有匹配的目录</p> : null}
        </div>
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={isMoving}>取消</button>
          <button type="button" className="primary-button" onClick={() => void submit()} disabled={isMoving}>{isMoving ? '正在移动' : '移动到这里'}</button>
        </div>
      </section>
    </div>
  )
}

function CreateFolderDialog({
  parentPath,
  onClose,
  onCreate,
}: {
  parentPath: string
  onClose: () => void
  onCreate: (name: string) => Promise<void>
}) {
  const [name, setName] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState("")

  async function save() {
    const trimmed = name.trim().replace(/^\/+|\/+$/g, "")
    if (!trimmed) {
      setError("请填写目录名称。")
      return
    }
    setIsSaving(true)
    setError("")
    try {
      await onCreate(trimmed)
      onClose()
    } catch (reason) {
      setError(reason instanceof FnsApiError ? reason.message : "创建目录失败。")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <form className="connection-dialog compact-dialog" onSubmit={(event) => { event.preventDefault(); void save() }} role="dialog" aria-modal="true" aria-labelledby="create-folder-title">
        <div className="dialog-heading">
          <div>
            <p>{parentPath ? `在「${parentPath}」下新建` : "根目录新建"}</p>
            <h2 id="create-folder-title">新建目录</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭新建目录"><X size={18} /></button>
        </div>
        <label>
          目录名称
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 读书笔记" autoFocus />
        </label>
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose}>取消</button>
          <button className="primary-button" disabled={isSaving}>{isSaving ? "正在创建" : "创建目录"}</button>
        </div>
      </form>
    </div>
  )
}

function CreateVaultDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (name: string) => Promise<void>
}) {
  const [name, setName] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState("")

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError("请填写空间名称。")
      return
    }
    if (trimmed.length > 255) {
      setError("空间名称不能超过 255 个字符。")
      return
    }
    setIsSaving(true)
    setError("")
    try {
      await onCreate(trimmed)
      onClose()
    } catch (reason) {
      setError(reason instanceof FnsApiError ? reason.message : "创建空间失败。")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <form className="connection-dialog compact-dialog" onSubmit={(event) => { event.preventDefault(); void save() }} role="dialog" aria-modal="true" aria-labelledby="create-vault-title">
        <div className="dialog-heading">
          <div>
            <p>空间管理</p>
            <h2 id="create-vault-title">新建空间</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭新建空间"><X size={18} /></button>
        </div>
        <p className="dialog-copy">空间用于隔离一组独立的文档、附件和同步数据。</p>
        <label>
          空间名称
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 vPara" maxLength={255} autoFocus />
        </label>
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={isSaving}>取消</button>
          <button className="primary-button" disabled={isSaving}>{isSaving ? "正在创建" : "创建空间"}</button>
        </div>
      </form>
    </div>
  )
}

function FolderTree({
  nodes,
  notesByFolder,
  sortMode,
  currentPath,
  expandedFolders,
  selectedItemPath,
  onPickFolder,
  onOpenItem,
  onToggleFolder,
  activeTreeMenu,
  onOpenTreeMenu,
  inlineRenamingPath,
  inlineRenamingDraft,
  onChangeInlineDraft,
  onCommitInlineRename,
  onCancelInlineRename,
  getIcon,
}: {
  nodes: FolderNode[]
  notesByFolder: Record<string, LibraryItem[]>
  sortMode: DirectorySortMode
  currentPath: string
  expandedFolders: string[]
  selectedItemPath?: string
  onPickFolder: (path: string) => void
  onOpenItem: (item: LibraryItem) => void
  onToggleFolder: (path: string) => void
  activeTreeMenu?: TreeMenuState | null
  onOpenTreeMenu?: (menu: TreeMenuState) => void
  inlineRenamingPath?: string | null
  inlineRenamingDraft?: string
  onChangeInlineDraft?: (draft: string) => void
  onCommitInlineRename?: (item: LibraryItem) => void
  onCancelInlineRename?: () => void
  getIcon: (kind: DocumentIconKind, path: string) => string | undefined
}) {
  return (
    <ul className="folder-tree">
      {sortFolders(nodes, sortMode).map((node) => (
        <FolderBranch
          key={node.path}
          node={node}
          notesByFolder={notesByFolder}
          sortMode={sortMode}
          currentPath={currentPath}
          expandedFolders={expandedFolders}
          selectedItemPath={selectedItemPath}
          onPickFolder={onPickFolder}
          onOpenItem={onOpenItem}
          onToggleFolder={onToggleFolder}
          activeTreeMenu={activeTreeMenu}
          onOpenTreeMenu={onOpenTreeMenu}
          inlineRenamingPath={inlineRenamingPath}
          inlineRenamingDraft={inlineRenamingDraft}
          onChangeInlineDraft={onChangeInlineDraft}
          onCommitInlineRename={onCommitInlineRename}
          onCancelInlineRename={onCancelInlineRename}
          getIcon={getIcon}
        />
      ))}
    </ul>
  )
}

function FolderBranch({
  node,
  notesByFolder,
  sortMode,
  currentPath,
  expandedFolders,
  selectedItemPath,
  onPickFolder,
  onOpenItem,
  onToggleFolder,
  activeTreeMenu,
  onOpenTreeMenu,
  inlineRenamingPath,
  inlineRenamingDraft,
  onChangeInlineDraft,
  onCommitInlineRename,
  onCancelInlineRename,
  getIcon,
}: {
  node: FolderNode
  notesByFolder: Record<string, LibraryItem[]>
  sortMode: DirectorySortMode
  currentPath: string
  expandedFolders: string[]
  selectedItemPath?: string
  onPickFolder: (path: string) => void
  onOpenItem: (item: LibraryItem) => void
  onToggleFolder: (path: string) => void
  activeTreeMenu?: TreeMenuState | null
  onOpenTreeMenu?: (menu: TreeMenuState) => void
  inlineRenamingPath?: string | null
  inlineRenamingDraft?: string
  onChangeInlineDraft?: (draft: string) => void
  onCommitInlineRename?: (item: LibraryItem) => void
  onCancelInlineRename?: () => void
  getIcon: (kind: DocumentIconKind, path: string) => string | undefined
}) {
  const normalizedPath = node.path.replace(/^\/+|\/+$/g, "")
  const directNotes = notesByFolder[normalizedPath] ?? []
  const hasChildren = Boolean(node.children?.length || node.noteCount || node.fileCount)
  const expanded = expandedFolders.includes(normalizedPath)
  const selected = currentPath === node.path

  function pickFolder() {
    onPickFolder(node.path)
    if (hasChildren) onToggleFolder(normalizedPath)
  }

  return (
    <li>
      <div
        className="tree-row"
        onClick={pickFolder}
        role="treeitem"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            pickFolder()
          }
        }}
        title={node.path}
        onContextMenu={(event) => {
          if (!onOpenTreeMenu) return
          event.preventDefault()
          onOpenTreeMenu({
            type: "folder",
            path: node.path,
            rect: { top: event.clientY, bottom: event.clientY, left: event.clientX, right: event.clientX },
          })
        }}
      >
        <span
          className="tree-toggle"
          aria-hidden={!hasChildren}
          onClick={(e) => {
            if (hasChildren) {
              e.stopPropagation()
              onToggleFolder(normalizedPath)
            }
          }}
        >
          {hasChildren ? (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
        </span>
        <FolderItemIcon icon={getIcon('folder', normalizedPath)} expanded={selected || (hasChildren && expanded)} />
        <span className="tree-row-label">{node.name || node.path}</span>
        {onOpenTreeMenu ? (
          <button
            type="button"
            className={`tree-row-more ${activeTreeMenu?.type === "folder" && activeTreeMenu.path === node.path ? "is-active" : ""}`}
            onClick={(e) => {
              e.stopPropagation()
              const rect = e.currentTarget.getBoundingClientRect()
              onOpenTreeMenu({
                type: "folder",
                path: node.path,
                rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
              })
            }}
            aria-label="目录操作"
            title="更多操作"
          >
            <MoreHorizontal size={14} />
          </button>
        ) : null}
      </div>
      {hasChildren && expanded ? (
        <>
          {node.children?.length ? (
            <FolderTree
              nodes={node.children}
              notesByFolder={notesByFolder}
              sortMode={sortMode}
              currentPath={currentPath}
              expandedFolders={expandedFolders}
              selectedItemPath={selectedItemPath}
              onPickFolder={onPickFolder}
              onOpenItem={onOpenItem}
              onToggleFolder={onToggleFolder}
              activeTreeMenu={activeTreeMenu}
              onOpenTreeMenu={onOpenTreeMenu}
              inlineRenamingPath={inlineRenamingPath}
              inlineRenamingDraft={inlineRenamingDraft}
              onChangeInlineDraft={onChangeInlineDraft}
              onCommitInlineRename={onCommitInlineRename}
              onCancelInlineRename={onCancelInlineRename}
              getIcon={getIcon}
            />
          ) : null}
          {directNotes.length ? (
            <ul className="folder-documents">
              {sortFolderItems(directNotes, sortMode).map((item) => (
                <li key={item.pathHash || item.path}>
                  <div
                    className={`note-row ${selectedItemPath === item.path ? "is-active" : ""}`}
                    onClick={() => onOpenItem(item)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        onOpenItem(item)
                      }
                    }}
                    title={item.path}
                    onContextMenu={(event) => {
                      if (!onOpenTreeMenu) return
                      event.preventDefault()
                      onOpenTreeMenu({
                        type: "item",
                        item,
                        rect: { top: event.clientY, bottom: event.clientY, left: event.clientX, right: event.clientX },
                      })
                    }}
                  >
                    <span className="tree-toggle" aria-hidden="true" />
                    <LibraryItemIcon item={item} icon={getIcon(item.kind, item.path)} />
                    {inlineRenamingPath === item.path ? (
                      <input
                        className="tree-inline-rename-input"
                        value={inlineRenamingDraft}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === "Enter") {
                            onCommitInlineRename?.(item)
                          } else if (e.key === "Escape") {
                            onCancelInlineRename?.()
                          }
                        }}
                        onChange={(e) => onChangeInlineDraft?.(e.target.value)}
                        onBlur={() => {
    // Only commit if still this path
    setTimeout(() => onCommitInlineRename?.(item), 100)
  }}
                      />
                    ) : (
                      <span className="tree-row-label">{documentDisplayTitle(item.kind, item.path)}</span>
                    )}
                    <DocumentTypeTag kind={item.kind} path={item.path} />
                    {onOpenTreeMenu ? (
                      <button
                        type="button"
                        className={`tree-row-more ${activeTreeMenu?.type === "item" && activeTreeMenu.item.path === item.path ? "is-active" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          const rect = e.currentTarget.getBoundingClientRect()
                          onOpenTreeMenu({
                            type: "item",
                            item,
                            rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
                          })
                        }}
                        aria-label="文档操作"
                        title="更多操作"
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </li>
  )
}

function ConnectionDialog({ connection, onClose, onLogin }: { connection: Connection; onClose: () => void; onLogin: (baseUrl: string) => void }) {
  const [draft, setDraft] = useState(connection)
  function updateDraft(changes: Partial<Connection>) {
    const next = { ...draft, ...changes }
    setDraft(next)
    void configStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...next,
      baseUrl: next.baseUrl.replace(/\/$/, ''),
      defaultVault: next.defaultVault.trim(),
    }))
  }
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="connection-dialog" role="dialog" aria-modal="true" aria-labelledby="connection-title">
        <div className="dialog-heading">
          <div>
            <p>FNS 服务</p>
            <h2 id="connection-title">连接设置</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭连接设置"><X size={18} /></button>
        </div>
        <label>
          服务地址
          <input value={draft.baseUrl} onChange={(event) => updateDraft({ baseUrl: event.target.value })} placeholder="http://127.0.0.1:9000" autoFocus />
        </label>
        <div className="connection-account">
          <UserRound size={17} />
          <span>{connection.user?.username || '未登录'}</span>
          <small>文档台使用当前 FNS 账号权限访问</small>
        </div>
        <label>
          默认 Vault
          <input value={draft.defaultVault} onChange={(event) => updateDraft({ defaultVault: event.target.value })} placeholder="例如 vPara" />
        </label>
        <div className="dialog-actions">
          <button className="secondary-button" onClick={() => onLogin(draft.baseUrl)}>重新登录</button>
          <button className="secondary-button" onClick={onClose}>取消</button>
          <button className="primary-button" onClick={() => onLogin(draft.baseUrl)}>登录并连接</button>
        </div>
      </section>
    </div>
  )
}

type SettingsSection = 'account' | 'sync' | 'ai' | 'agent' | 'experience' | 'shortcuts' | 'data'

type LocalAgentInfo = {
  id: string
  label: string
  command: string
  detected: boolean
  supported: boolean
  version?: string
  configured?: boolean
}

function LocalAgentSettings() {
  const runtime = getDesktopRuntime()
  const [agents, setAgents] = useState<LocalAgentInfo[]>([])
  const [selected, setSelected] = useState('')
  const [workspaceRoot, setWorkspaceRoot] = useState(runtime.localRoot || '')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!runtime.listLocalAgents) return
    setLoading(true); setError('')
    try {
      const result = await (runtime.getLocalAgentState ? runtime.getLocalAgentState() : runtime.listLocalAgents()) as { agents?: LocalAgentInfo[]; selected?: string; root?: string }
      setAgents(Array.isArray(result?.agents) ? result.agents : [])
      setSelected(typeof result?.selected === 'string' ? result.selected : '')
      if (typeof result?.root === 'string') setWorkspaceRoot(result.root)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法检查本机智能体。')
    } finally { setLoading(false) }
  }, [runtime.getLocalAgentState, runtime.listLocalAgents])

  useEffect(() => { void refresh() }, [refresh])

  async function selectAgent(agent: LocalAgentInfo) {
    if (!runtime.selectLocalAgent || !agent.supported || saving) return
    setSaving(true); setError('')
    try {
      const result = await runtime.selectLocalAgent(agent.command) as { agent?: string; agents?: LocalAgentInfo[] }
      setSelected(result.agent || agent.command)
      if (Array.isArray(result.agents)) setAgents(result.agents)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法切换本地智能体。')
    } finally { setSaving(false) }
  }

  return <section className="settings-section local-agent-settings" aria-label="智能体设置">
    <div className="settings-section-heading"><div><h3>智能体设置</h3><small>检查本机智能体，并选择桌面端本地 AI 使用的命令</small></div><button type="button" className="secondary-button compact" onClick={() => void refresh()} disabled={loading || saving}><RefreshCw size={14} className={loading ? 'spin' : undefined} />重新检查</button></div>
    <div className="local-agent-workspace"><span className="settings-row-icon"><FolderOpen size={18} /></span><div><strong>当前工作目录</strong><small title={workspaceRoot}>{workspaceRoot || '尚未选择本地目录'}</small></div></div>
    {loading && !agents.length ? <p className="cloud-sync-status">正在检查本机智能体…</p> : null}
    {!loading && !agents.length ? <div className="local-agent-empty"><CircleAlert size={18} /><span>没有检测到可用的本地智能体。请安装 Pi，或配置 FNS_LOCAL_AGENT／PI_BIN。</span></div> : null}
    {agents.length ? <div className="local-agent-list">{agents.map((agent) => <article className={`local-agent-row${selected === agent.command ? ' is-selected' : ''}${!agent.supported ? ' is-unsupported' : ''}`} key={`${agent.id}:${agent.command}`}><div className="local-agent-main"><span className="local-agent-icon"><Bot size={16} /></span><div><strong>{agent.label}</strong><small title={agent.command}>{agent.version || '版本未知'} · {agent.command}</small></div></div><div className="local-agent-actions">{selected === agent.command ? <span className="local-agent-state"><Check size={13} />当前使用</span> : agent.supported ? <button type="button" className="secondary-button compact" onClick={() => void selectAgent(agent)} disabled={saving}>使用</button> : <span className="local-agent-state is-muted">仅检测</span>}</div></article>)}</div> : null}
    <p className="settings-help">当前桌面适配器使用 Pi JSON 协议；其它命令会显示为已检测，但需要后续适配后才能选择。</p>
    {error ? <p className="dialog-error" role="alert">{error}</p> : null}
  </section>
}

function CloudSyncSettings({ connection, vault }: { connection: Connection; vault: string }) {
  const [devices, setDevices] = useState<CloudSyncDevice[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [deviceId] = useState(() => {
    const key = 'fns-docs-viewer.cloud-sync-device-id'
    try {
      const stored = window.localStorage.getItem(key)
      if (stored) return stored
      const next = `web-${crypto.randomUUID()}`
      window.localStorage.setItem(key, next)
      return next
    } catch {
      return `web-${Date.now()}`
    }
  })

  const client = useMemo(() => new CloudSyncClient(connection, vault, deviceId), [connection, vault, deviceId])
  const refresh = useCallback(async () => {
    if (!connection.token || !vault) { setDevices([]); return }
    setLoading(true); setError('')
    try { setDevices(await client.listDevices()) } catch (reason) { setError(reason instanceof CloudSyncError ? reason.message : '无法读取同步设备。') } finally { setLoading(false) }
  }, [client, connection.token, vault])

  useEffect(() => { void refresh() }, [refresh])

  async function register() {
    setLoading(true); setError('')
    try { await client.createSession('文档台', 'web', '2'); await refresh() } catch (reason) { setError(reason instanceof CloudSyncError ? reason.message : '设备注册失败。') } finally { setLoading(false) }
  }

  async function rename(device: CloudSyncDevice) {
    const name = window.prompt('新的设备名称', device.clientName || device.deviceId)?.trim()
    if (!name || name === device.clientName) return
    setLoading(true); setError('')
    try { await client.renameDevice(device.deviceId, device.version, name); await refresh() } catch (reason) { setError(reason instanceof CloudSyncError ? reason.message : '设备重命名失败。') } finally { setLoading(false) }
  }

  async function revoke(device: CloudSyncDevice) {
    if (!window.confirm(`撤销设备「${device.clientName || device.deviceId}」？它的同步会话会立即失效。`)) return
    setLoading(true); setError('')
    try { await client.revokeDevice(device.deviceId, device.version); await refresh() } catch (reason) { setError(reason instanceof CloudSyncError ? reason.message : '设备撤销失败。') } finally { setLoading(false) }
  }

  return <section className="settings-section cloud-sync-settings" aria-label="同步设备">
    <div className="settings-section-heading"><div><h3>同步设备</h3><small>管理当前知识库的独立云同步客户端</small></div><button type="button" className="secondary-button compact" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} />刷新</button></div>
    {!connection.token || !vault ? <div className="cloud-sync-empty"><strong>先连接服务并选择知识库</strong><span>登录后可以注册桌面、移动或浏览器同步设备。</span></div> : null}
    {connection.token && vault && !devices.length && !loading ? <div className="cloud-sync-empty"><strong>还没有同步设备</strong><span>注册当前浏览器后，其他客户端可使用同一套云同步协议。</span><button type="button" className="primary-button" onClick={() => void register()}>注册此设备</button></div> : null}
    {loading && !devices.length ? <p className="cloud-sync-status">正在读取设备…</p> : null}
    {devices.length ? <div className="cloud-sync-device-list">{devices.map((device) => <article key={`${device.deviceId}:${device.id}`} className={`cloud-sync-device-row ${device.revoked ? 'is-revoked' : ''}`}><div className="cloud-sync-device-main"><strong>{device.clientName || device.deviceId}</strong><span>{device.clientType} · {device.clientVersion || '未知版本'}</span><small>最后访问：{device.lastSeen ? new Date(device.lastSeen).toLocaleString('zh-CN') : '未知'} · 版本 {device.version}</small></div><div className="cloud-sync-device-actions">{device.revoked ? <span className="cloud-sync-device-state">已撤销</span> : <><button type="button" className="secondary-button compact" onClick={() => void rename(device)} disabled={loading}>重命名</button><button type="button" className="secondary-button compact is-danger" onClick={() => void revoke(device)} disabled={loading}>撤销</button></>}</div></article>)}</div> : null}
    {error ? <p className="dialog-error" role="alert">{error}</p> : null}
  </section>
}

function SettingSwitch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button className={`setting-switch ${checked ? 'is-on' : ''}`} type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}>
      <span aria-hidden="true" />
    </button>
  )
}

function SystemSettingsDialog({
  connection,
  currentVault,
  settings,
  vaults,
  onClose,
  onClearCache,
  onOpenConnection,
  onRefresh,
  onReset,
  onUpdateConnection,
  onUpdateSettings,
}: {
  connection: Connection
  currentVault: string
  settings: SystemSettings
  vaults: Vault[]
  onClose: () => void
  onClearCache: () => void
  onOpenConnection: () => void
  onRefresh: () => void
  onReset: () => void
  onUpdateConnection: (connection: Connection) => void
  onUpdateSettings: (settings: Partial<SystemSettings>) => void
}) {
  const [section, setSection] = useState<SettingsSection>('account')
  const [issuedToken, setIssuedToken] = useState('')
  const [isIssuingToken, setIsIssuingToken] = useState(false)
  const [tokenError, setTokenError] = useState('')
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false)
  const vaultOptions = [...new Set(vaults.length ? vaults.map((vault) => vault.vault) : [currentVault, connection.defaultVault].filter(Boolean))]

  function selectDefaultVault(value: string) {
    onUpdateConnection({ ...connection, defaultVault: value })
  }

  async function issueBrowserToken() {
    setIsIssuingToken(true)
    setTokenError('')
    try {
      const result = await fnsApi.issueApiToken(connection, {
        clientType: 'browser-extension',
        expiredDays: 365,
        vaults: currentVault || connection.defaultVault,
      })
      setIssuedToken(result.token)
    } catch (reason) {
      setTokenError(reason instanceof FnsApiError ? reason.message : 'Token 生成失败，请稍后重试。')
    } finally {
      setIsIssuingToken(false)
    }
  }

  async function copyIssuedToken() {
    if (!issuedToken) return
    await navigator.clipboard.writeText(issuedToken)
  }

  return (
    <div className="dialog-backdrop settings-backdrop" role="presentation">
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-label="系统设置">
        <button className="icon-button settings-close-button" onClick={onClose} aria-label="关闭系统设置" title="关闭"><X size={18} /></button>
        <div className="settings-dialog-body">
          <nav className="settings-nav" aria-label="设置分类" role="tablist">
            <button className={section === 'account' ? 'is-active' : ''} role="tab" aria-selected={section === 'account'} onClick={() => setSection('account')}><KeyRound size={17} /><span>账号与服务</span></button>
            <button className={section === 'sync' ? 'is-active' : ''} role="tab" aria-selected={section === 'sync'} onClick={() => setSection('sync')}><RefreshCw size={17} /><span>同步设备</span></button>
            <button className={section === 'ai' ? 'is-active' : ''} role="tab" aria-selected={section === 'ai'} onClick={() => setSection('ai')}><Bot size={17} /><span>AI 模型</span></button>
            {getDesktopRuntime().isLocal ? <button className={section === 'agent' ? 'is-active' : ''} role="tab" aria-selected={section === 'agent'} onClick={() => setSection('agent')}><Sparkles size={17} /><span>智能体</span></button> : null}
            <button className={section === 'experience' ? 'is-active' : ''} role="tab" aria-selected={section === 'experience'} onClick={() => setSection('experience')}><Eye size={17} /><span>阅读与界面</span></button>
            <button className={section === 'shortcuts' ? 'is-active' : ''} role="tab" aria-selected={section === 'shortcuts'} onClick={() => setSection('shortcuts')}><Command size={17} /><span>快捷键</span></button>
            <button className={section === 'data' ? 'is-active' : ''} role="tab" aria-selected={section === 'data'} onClick={() => setSection('data')}><Database size={17} /><span>数据与性能</span></button>
          </nav>
          <div className="settings-content">
            {section === 'account' ? (
              <section className="settings-section" aria-label="账号与服务">
                <div className="settings-section-heading"><h3>服务连接</h3><span className={`settings-status ${connection.user && connection.token ? 'is-connected' : ''}`}>{connection.user && connection.token ? '已连接' : '未登录'}</span></div>
                <label className="settings-field"><span>服务地址</span><input value={connection.baseUrl} readOnly placeholder="未配置服务地址" /></label>
                <label className="settings-field"><span>默认知识库</span>
                  <select value={connection.defaultVault} onChange={(event) => selectDefaultVault(event.target.value)}>
                    <option value="">跟随上次选择</option>
                    {vaultOptions.map((vault) => <option key={vault} value={vault}>{vault}</option>)}
                  </select>
                </label>
                <div className="settings-account-row">
                  <span className="settings-row-icon"><UserRound size={18} /></span>
                  <div><strong>{getDesktopRuntime().isDesktop ? (getDesktopRuntime().isLocal ? '本地模式' : '云端模式') : connection.user?.username || '未登录'}</strong><small>{getDesktopRuntime().isDesktop ? '桌面端不需要账号登录' : connection.user?.email || '需要使用 FNS 账号登录'}</small></div>
                  {!getDesktopRuntime().isDesktop ? <button className="secondary-button" onClick={onOpenConnection}><Settings2 size={16} />管理连接</button> : null}
                </div>
                <div className="settings-account-row token-issue-row">
                  <span className="settings-row-icon"><KeyRound size={18} /></span>
                  <div><strong>浏览器剪藏 Token</strong><small>生成一个仅用于浏览器剪藏的 API Token，有效期 365 天。</small></div>
                  <button className="secondary-button" onClick={() => void issueBrowserToken()} disabled={isIssuingToken}>{isIssuingToken ? '生成中…' : '生成 Token'}</button>
                </div>
                {issuedToken ? <div className="issued-token-panel"><label><span>请立即复制 Token</span><input value={issuedToken} readOnly onFocus={(event) => event.currentTarget.select()} /></label><button className="primary-button" onClick={() => void copyIssuedToken()}><ClipboardCopy size={16} />复制 Token</button><small>Token 只在生成时显示，关闭此窗口后不会再次回显。</small></div> : null}
                {tokenError ? <p className="dialog-error token-error" role="alert">{tokenError}</p> : null}
              </section>
            ) : null}

            {section === 'ai' ? <AiProviderSettings connection={connection} /> : null}

            {section === 'agent' ? <LocalAgentSettings /> : null}

            {section === 'sync' ? <CloudSyncSettings connection={connection} vault={currentVault || connection.defaultVault} /> : null}

            {section === 'experience' ? (
              <section className="settings-section" aria-label="阅读与界面">
                <div className="settings-section-heading"><h3>外观</h3></div>
                <div className="settings-control-row"><span>主题</span><div className="segmented-control" role="group" aria-label="主题">
                  {([{ value: 'light', label: '浅色', icon: Sun }, { value: 'dark', label: '深色', icon: Moon }, { value: 'system', label: '系统', icon: Monitor }] as const).map(({ value, label, icon: Icon }) => <button key={value} className={settings.theme === value ? 'is-active' : ''} onClick={() => onUpdateSettings({ theme: value })}><Icon size={15} />{label}</button>)}
                </div></div>
                <div className="settings-control-row"><span>阅读字号</span><div className="segmented-control" role="group" aria-label="阅读字号">
                  {([{ value: 'small', label: '小' }, { value: 'medium', label: '中' }, { value: 'large', label: '大' }] as const).map(({ value, label }) => <button key={value} className={settings.readerFontSize === value ? 'is-active' : ''} onClick={() => onUpdateSettings({ readerFontSize: value })}>{label}</button>)}
                </div></div>
                <div className="settings-control-row"><span>界面密度</span><div className="segmented-control" role="group" aria-label="界面密度">
                  {([{ value: 'comfortable', label: '舒适' }, { value: 'compact', label: '紧凑' }] as const).map(({ value, label }) => <button key={value} className={settings.density === value ? 'is-active' : ''} onClick={() => onUpdateSettings({ density: value })}>{label}</button>)}
                </div></div>
                <div className="settings-section-heading settings-subheading"><h3>布局</h3></div>
                <div className="settings-toggle-row"><span className="settings-row-icon"><LayoutPanelLeft size={18} /></span><div><strong>默认展开目录</strong><small>在宽屏设备上默认显示左侧目录</small></div><SettingSwitch label="默认展开目录" checked={settings.sidebarOpen} onChange={(sidebarOpen) => onUpdateSettings({ sidebarOpen })} /></div>
                <div className="settings-toggle-row"><span className="settings-row-icon"><ListOrdered size={18} /></span><div><strong>显示文档目录</strong><small>阅读文档时在右侧显示章节导航</small></div><SettingSwitch label="显示文档目录" checked={settings.showOutline} onChange={(showOutline) => onUpdateSettings({ showOutline })} /></div>
                <label className="settings-field"><span>目录排序</span>
                  <select value={settings.directorySort} onChange={(event) => onUpdateSettings({ directorySort: event.target.value as DirectorySortMode })}>
                    {(Object.keys(directorySortLabels) as DirectorySortMode[]).map((mode) => <option key={mode} value={mode}>{directorySortLabels[mode]}</option>)}
                  </select>
                </label>
              </section>
            ) : null}

            {section === 'shortcuts' ? (
              <section className="settings-section" aria-label="快捷键">
                <div className="settings-section-heading"><h3>快捷键</h3></div>
                <div className="settings-field">
                  <span>全局搜索</span>
                  <button
                    type="button"
                    className={`shortcut-recorder ${isRecordingShortcut ? 'is-recording' : ''}`}
                    onClick={() => setIsRecordingShortcut(true)}
                    onBlur={() => setIsRecordingShortcut(false)}
                    onKeyDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      if (event.key === 'Escape') {
                        setIsRecordingShortcut(false)
                        return
                      }
                      if (event.key === 'Backspace' || event.key === 'Delete') {
                        onUpdateSettings({ searchShortcut: '' })
                        setIsRecordingShortcut(false)
                        return
                      }
                      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
                        onUpdateSettings({ searchShortcut: event.key.toLowerCase() })
                        setIsRecordingShortcut(false)
                      }
                    }}
                    aria-label="设置全局搜索快捷键"
                    aria-live="polite"
                  >
                    {isRecordingShortcut ? '请按下按键…' : (settings.searchShortcut ? `⌘ ${settings.searchShortcut.toUpperCase()}` : '点击后按键')}
                  </button>
                </div>
              </section>
            ) : null}

            {section === 'data' ? (
              <section className="settings-section" aria-label="数据与性能">
                <div className="settings-section-heading"><h3>目录加载</h3></div>
                <div className="settings-toggle-row"><span className="settings-row-icon"><Database size={18} /></span><div><strong>使用目录缓存</strong><small>重复展开文件夹时优先使用本次会话的已加载数据</small></div><SettingSwitch label="使用目录缓存" checked={settings.useFolderCache} onChange={(useFolderCache) => onUpdateSettings({ useFolderCache })} /></div>
                <div className="settings-action-row"><div><strong>清除目录缓存</strong><small>保留当前文档，下一次打开目录时重新读取服务数据</small></div><button className="secondary-button" onClick={onClearCache}>清除缓存</button></div>
                <div className="settings-action-row"><div><strong>刷新文档索引</strong><small>重新获取当前知识库的目录和文档列表</small></div><button className="secondary-button" onClick={onRefresh}><RefreshCw size={16} />立即刷新</button></div>
              </section>
            ) : null}
          </div>
        </div>
        <footer className="settings-dialog-footer"><button className="secondary-button" onClick={onReset}>恢复默认</button><button className="primary-button" onClick={onClose}>完成</button></footer>
      </section>
    </div>
  )
}

function LoginDialog({ onClose, onLogin, required = false }: { onClose: () => void; onLogin: (credentials: string, password: string) => Promise<void>; required?: boolean }) {
  const [credentials, setCredentials] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!credentials.trim() || !password) {
      setError('请填写账号和密码。')
      return
    }
    setIsSubmitting(true)
    setError('')
    try {
      await onLogin(credentials, password)
      onClose()
    } catch (reason) {
      setError(reason instanceof FnsApiError ? reason.message : '登录失败，请稍后再试。')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <form className="connection-dialog login-dialog" onSubmit={(event) => { event.preventDefault(); void submit() }} role="dialog" aria-modal="true" aria-labelledby="login-title">
        <div className="login-brand-panel" aria-hidden="true">
          <span className="login-brand-mark"><BookOpenText size={20} /></span>
          <span><strong>文档台</strong><small>把知识放在一个清晰的地方</small></span>
        </div>
        <div className="dialog-heading">
          <div>
            <p>FNS 账号</p>
            <h2 id="login-title">登录文档台</h2>
          </div>
          {!required ? <button type="button" className="icon-button" onClick={onClose} aria-label="关闭登录"><X size={18} /></button> : null}
        </div>
        {required ? <p className="dialog-copy login-required-copy">请使用 FNS 账号登录后继续访问文档。</p> : null}
        <label>
          账号或邮箱
          <input value={credentials} onChange={(event) => setCredentials(event.target.value)} placeholder="输入账号或邮箱" autoFocus autoComplete="username" />
        </label>
        <label>
          密码
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="输入登录密码" autoComplete="current-password" />
        </label>
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          {!required ? <button type="button" className="secondary-button" onClick={onClose}>取消</button> : null}
          <button className="primary-button" disabled={isSubmitting}>{isSubmitting ? '正在登录' : '登录'}</button>
        </div>
      </form>
    </div>
  )
}

function DocumentEditorDialog({
  note,
  initialPath,
  onClose,
  onSave,
}: {
  note: Note | null
  initialPath: string
  onClose: () => void
  onSave: (draft: { path: string; content: string; createOnly: boolean }) => Promise<void>
}) {
  const isNew = !note
  const [path, setPath] = useState(note?.path || initialPath)
  const [content, setContent] = useState(note?.content || '')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    const nextPath = normalizeDocumentPath(path)
    if (!nextPath) {
      setError('请填写文档路径。')
      return
    }
    setIsSaving(true)
    setError('')
    try {
      await onSave({ path: nextPath, content, createOnly: isNew })
      onClose()
    } catch (reason) {
      setError(reason instanceof FnsApiError ? reason.message : '保存文档失败。')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <form className="connection-dialog editor-dialog" onSubmit={(event) => { event.preventDefault(); void save() }} role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <div className="dialog-heading">
          <div>
            <p>{isNew ? '新建文档' : '编辑文档'}</p>
            <h2 id="editor-title">{isNew ? '创建 Markdown 文档' : documentTitle(note.path)}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭编辑器"><X size={18} /></button>
        </div>
        <label>
          文档路径
          <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="例如 工作/会议记录.md" disabled={!isNew} autoFocus={isNew} />
        </label>
        <label className="editor-content-field">
          Markdown 内容
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                void save()
              }
            }}
            placeholder="# 文档标题"
            autoFocus={!isNew}
            spellCheck={false}
          />
        </label>
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose}>取消</button>
          <button className="primary-button" disabled={isSaving}>{isSaving ? '正在保存' : isNew ? '创建文档' : '保存修改'}</button>
        </div>
      </form>
    </div>
  )
}

function isTableRow(line: string) {
  const trimmed = line.trim()
  return trimmed.includes("|") && (trimmed.startsWith("|") || trimmed.endsWith("|") || (trimmed.split("|").length >= 3))
}

function isTableSeparator(line: string) {
  const trimmed = line.trim()
  return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(trimmed)
}

function parseTableRow(line: string) {
  let trimmed = line.trim()
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1)
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1)
  return trimmed.split("|").map((cell) => cell.trim())
}

function parseTableAlignments(sepLine: string) {
  const parts = parseTableRow(sepLine)
  return parts.map((part) => {
    const left = part.startsWith(":")
    const right = part.endsWith(":")
    if (left && right) return "center"
    if (right) return "right"
    if (left) return "left"
    return ""
  })
}

function tableToMarkdown(tableEl: HTMLElement, inlineFn: (node: Node) => string): string {
  const rows: string[] = []
  const alignList: string[] = []

  const ths = Array.from(tableEl.querySelectorAll("thead th")) as HTMLElement[]
  if (ths.length > 0) {
    const headerCells = ths.map((th) => {
      const align = th.style.textAlign || th.getAttribute("align") || ""
      if (align === "center") alignList.push(":---:")
      else if (align === "right") alignList.push("---:")
      else if (align === "left") alignList.push(":---")
      else alignList.push("---")
      return Array.from(th.childNodes).map(inlineFn).join("").trim()
    })
    rows.push(`| ${headerCells.join(" | ")} |`)
    rows.push(`| ${alignList.join(" | ")} |`)
  }

  const trs = Array.from(tableEl.querySelectorAll("tbody tr")) as HTMLElement[]
  const allTrs = trs.length ? trs : (Array.from(tableEl.querySelectorAll("tr")) as HTMLElement[]).slice(ths.length ? 1 : 0)

  for (const tr of allTrs) {
    const tds = Array.from(tr.querySelectorAll("td, th")) as HTMLElement[]
    const cells = tds.map((td) => Array.from(td.childNodes).map(inlineFn).join("").trim())
    if (cells.length > 0) {
      rows.push(`| ${cells.join(" | ")} |`)
    }
  }

  return rows.join("\n")
}

function markdownToEditableHtml(markdown: string) {
  const inline = (value: string) => value
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, rawName: string, size?: string) => {
      const match = size ? /\|?(\d+%?)(?:x(\d+))?$/.exec(size) : null
      const widthVal = match ? match[1] : ""
      const heightVal = match && match[2] ? match[2] : ""
      let styleAttr = ""
      if (widthVal) {
        if (widthVal.endsWith("%")) {
          styleAttr = ` style="max-width: 100%; width: ${widthVal};" data-specified-width="${widthVal}"`
        } else {
          styleAttr = ` style="max-width: min(100%, ${widthVal}px); width: ${widthVal}px;${heightVal ? ` height: ${heightVal}px;` : ""}" data-specified-width="${widthVal}"`
        }
      }
      return `<img alt="${rawName}" src="#fns-media:${encodeURIComponent(rawName)}"${styleAttr} />`
    })
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, altText: string, src: string) => {
      const match = /\|(\d+%?)(?:x(\d+))?$/.exec(altText)
      const cleanAlt = match ? altText.slice(0, match.index) : altText
      const widthVal = match ? match[1] : ""
      const heightVal = match && match[2] ? match[2] : ""
      let styleAttr = ""
      if (widthVal) {
        if (widthVal.endsWith("%")) {
          styleAttr = ` style="max-width: 100%; width: ${widthVal};" data-specified-width="${widthVal}"`
        } else {
          styleAttr = ` style="max-width: min(100%, ${widthVal}px); width: ${widthVal}px;${heightVal ? ` height: ${heightVal}px;` : ""}" data-specified-width="${widthVal}"`
        }
      }
      return `<img alt="${cleanAlt}" src="${src}"${styleAttr} />`
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<a href=\"$2\">$1</a>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")

  let inCode = false
  let codeLang = ""
  let codeLines: string[] = []
  let fenceChar = ""
  let fenceLength = 0
  let fenceIndent = ""
  let inIndentedCode = false
  let indentedCodeLines: string[] = []
  const out: string[] = []
  const lines = markdown.split(/\r?\n/)

  const appendCodeBlock = (language: string, text: string) => {
    out.push(renderCodeBlockHtml(text, language, true))
  }

  const flushIndentedCode = () => {
    if (!inIndentedCode) return
    appendCodeBlock("", indentedCodeLines.join("\n").replace(/\n+$/, ""))
    inIndentedCode = false
    indentedCodeLines = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Markdown fences may be indented (common when clipped from a numbered list)
    // and may use either backticks or tildes. Only treat a complete fence line
    // as a block boundary so inline backticks inside prose remain untouched.
    const fenceMatch = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line)
    if (fenceMatch) {
      if (!inCode) {
        inCode = true
        fenceChar = fenceMatch[2][0]
        fenceLength = fenceMatch[2].length
        fenceIndent = fenceMatch[1]
        codeLang = (fenceMatch[3] || "").trim()
        codeLines = []
      } else if (fenceMatch[2][0] === fenceChar && fenceMatch[2].length >= fenceLength && !fenceMatch[3].trim()) {
        inCode = false
        appendCodeBlock(codeLang, codeLines.join("\n"))
        fenceChar = ""
        fenceLength = 0
        fenceIndent = ""
        codeLang = ""
      }
      continue
    }
    if (inCode) {
      codeLines.push(fenceIndent && line.startsWith(fenceIndent) ? line.slice(fenceIndent.length) : line)
      continue
    }

    // Support classic four-space/tab indented code blocks as well as fenced blocks.
    const indentedCodeMatch = /^( {4}|\t)(.*)$/.exec(line)
    if (inIndentedCode) {
      if (!line.trim()) {
        indentedCodeLines.push("")
        continue
      }
      if (indentedCodeMatch) {
        indentedCodeLines.push(indentedCodeMatch[2])
        continue
      }
      flushIndentedCode()
    }
    if (indentedCodeMatch) {
      inIndentedCode = true
      indentedCodeLines = [indentedCodeMatch[2]]
      continue
    }

    // Markdown Table Detection
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headerRow = line
      const sepRow = lines[i + 1]
      const bodyRows: string[] = []
      i += 1
      while (i + 1 < lines.length && isTableRow(lines[i + 1]) && !isTableSeparator(lines[i + 1])) {
        i += 1
        bodyRows.push(lines[i])
      }
      const aligns = parseTableAlignments(sepRow)
      const headers = parseTableRow(headerRow)
      const getAlignStyle = (idx: number) => {
        const align = aligns[idx]
        return align ? ` style="text-align: ${align};"` : ""
      }
      const theadHtml = `<thead><tr>${headers.map((h, idx) => `<th${getAlignStyle(idx)}>${inline(h.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))}</th>`).join("")}</tr></thead>`
      const tbodyHtml = `<tbody>${bodyRows.map((row) => `<tr>${parseTableRow(row).map((cell, idx) => `<td${getAlignStyle(idx)}>${inline(cell.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))}</td>`).join("")}</tr>`).join("")}</tbody>`
      out.push(`<div class="table-wrap"><table>${theadHtml}${tbodyHtml}</table></div>`)
      continue
    }

    const listMatch = /^(\s*)([-+*]|\d+[.)])\s+(.*)$/.exec(line)
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[2])
      const items: string[] = []
      const firstNumber = ordered ? Number.parseInt(listMatch[2], 10) : 1
      while (i < lines.length) {
        const itemMatch = /^(\s*)([-+*]|\d+[.)])\s+(.*)$/.exec(lines[i])
        if (!itemMatch || /^\d/.test(itemMatch[2]) !== ordered) break
        const itemContent = itemMatch[3]
        const taskMatch = /^\[([ xX])\]\s+(.*)$/.exec(itemContent)
        if (taskMatch) {
          const checked = taskMatch[1].toLowerCase() === "x"
          const escapedItem = taskMatch[2].replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          items.push(`<li><input type="checkbox"${checked ? " checked" : ""} />${inline(escapedItem)}</li>`)
        } else {
          const escapedItem = itemContent.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          items.push(`<li>${inline(escapedItem)}</li>`)
        }
        i += 1
      }
      i -= 1
      const startAttribute = ordered && firstNumber !== 1 ? ` start="${firstNumber}"` : ""
      out.push(`<${ordered ? "ol" : "ul"}${startAttribute}>${items.join("")}</${ordered ? "ol" : "ul"}>`)
      continue
    }

    if (!line.trim()) continue
    const escaped = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    if (/^###### /.test(line)) { const cleanH = line.slice(7).replace(/[ \t]+#+[ \t]*$/, "").replace(/[*_`]/g, "").trim(); out.push(`<h6 id="${slugify(cleanH)}">${inline(escaped.slice(7))}</h6>`); continue }
    if (/^##### /.test(line)) { const cleanH = line.slice(6).replace(/[ \t]+#+[ \t]*$/, "").replace(/[*_`]/g, "").trim(); out.push(`<h5 id="${slugify(cleanH)}">${inline(escaped.slice(6))}</h5>`); continue }
    if (/^#### /.test(line)) { const cleanH = line.slice(5).replace(/[ \t]+#+[ \t]*$/, "").replace(/[*_`]/g, "").trim(); out.push(`<h4 id="${slugify(cleanH)}">${inline(escaped.slice(5))}</h4>`); continue }
    if (/^### /.test(line)) { const cleanH = line.slice(4).replace(/[ \t]+#+[ \t]*$/, "").replace(/[*_`]/g, "").trim(); out.push(`<h3 id="${slugify(cleanH)}">${inline(escaped.slice(4))}</h3>`); continue }
    if (/^## /.test(line)) { const cleanH = line.slice(3).replace(/[ \t]+#+[ \t]*$/, "").replace(/[*_`]/g, "").trim(); out.push(`<h2 id="${slugify(cleanH)}">${inline(escaped.slice(3))}</h2>`); continue }
    if (/^# /.test(line)) { const cleanH = line.slice(2).replace(/[ \t]+#+[ \t]*$/, "").replace(/[*_`]/g, "").trim(); out.push(`<h1 id="${slugify(cleanH)}">${inline(escaped.slice(2))}</h1>`); continue }
    if (/^> /.test(line)) { out.push(`<blockquote>${inline(escaped.slice(2))}</blockquote>`); continue }
    if (/^---+$/.test(line.trim())) { out.push("<hr />"); continue }
    out.push(`<p>${inline(escaped)}</p>`)
  }
  if (inCode) {
    appendCodeBlock(codeLang, codeLines.join("\n"))
  }
  flushIndentedCode()
  return out.join("")
}

function inlineNodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || ""
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement
    const tag = el.tagName.toLowerCase()
    if (tag === "img") {
      const img = el as HTMLImageElement
      const alt = img.alt || ""
      const originalSrc = img.dataset?.originalSrc
      const src = originalSrc || img.getAttribute("src") || ""
      const width = img.dataset?.specifiedWidth || (img.style.width ? (img.style.width.endsWith("%") ? img.style.width : img.style.width.replace(/px$/, "")) : "")
      
      if (src.startsWith("#fns-media:")) {
        const decoded = decodeURIComponent(src.slice("#fns-media:".length))
        const fileName = decoded.split("/").pop() || decoded
        const widthPart = width ? `|${width}` : ""
        return `![[${fileName}${widthPart}]]`
      }

      const altWithWidth = width ? `${alt}|${width}` : alt
      return `![${altWithWidth}](${src})`
    }
    if (tag === "a") {
      const href = el.getAttribute("href") || ""
      const childrenMd = Array.from(el.childNodes).map(inlineNodeToMarkdown).join("")
      return `[${childrenMd}](${href})`
    }
    if (tag === "strong" || tag === "b") {
      const childrenMd = Array.from(el.childNodes).map(inlineNodeToMarkdown).join("")
      return `**${childrenMd}**`
    }
    if (tag === "em" || tag === "i") {
      const childrenMd = Array.from(el.childNodes).map(inlineNodeToMarkdown).join("")
      return `*${childrenMd}*`
    }
    if (tag === "code") {
      return `\`${el.textContent || ""}\``
    }
    if (tag === "br") {
      return "\n"
    }
    return Array.from(el.childNodes).map(inlineNodeToMarkdown).join("")
  }
  return ""
}

function editableHtmlToMarkdown(root: HTMLElement) {
  return Array.from(root.childNodes).map((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent?.trim() || ""
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return ""
    const el = node as HTMLElement
    const tag = el.tagName.toUpperCase()
    if (el.classList?.contains("code-block")) {
      const lang = el.dataset?.lang || ""
      const codeEl = el.querySelector("code") || el.querySelector("pre")
      const codeText = codeEl ? (codeEl.textContent || "") : (el.textContent || "")
      const cleanText = codeText.replace(/\r\n/g, "\n").replace(/\n+$/, "")
      return `\`\`\`${lang}\n${cleanText}\n\`\`\``
    }
    if (tag === "PRE") {
      const lang = el.dataset?.lang || ""
      const codeEl = el.querySelector("code") || el
      const codeText = codeEl.textContent || ""
      const cleanText = codeText.replace(/\r\n/g, "\n").replace(/\n+$/, "")
      return `\`\`\`${lang}\n${cleanText}\n\`\`\``
    }
    if (el.classList?.contains("table-wrap") || tag === "TABLE") {
      const tableEl = tag === "TABLE" ? el : el.querySelector("table")
      if (tableEl) return tableToMarkdown(tableEl, inlineNodeToMarkdown)
    }
    const inlineContent = Array.from(el.childNodes).map(inlineNodeToMarkdown).join("")
    if (tag === "H1") return `# ${inlineContent}`
    if (tag === "H2") return `## ${inlineContent}`
    if (tag === "H3") return `### ${inlineContent}`
    if (tag === "H4") return `#### ${inlineContent}`
    if (tag === "H5") return `##### ${inlineContent}`
    if (tag === "H6") return `###### ${inlineContent}`
    if (tag === "BLOCKQUOTE") return `> ${inlineContent}`
    if (tag === "LI") return `- ${inlineContent}`
    if (tag === "UL" || tag === "OL") {
      return Array.from(el.children).map((item) => `- ${Array.from(item.childNodes).map(inlineNodeToMarkdown).join("")}`).join("\n")
    }
    if (tag === "HR") return "---"
    if (tag === "P") return inlineContent
    if (tag === "DIV") return inlineContent
    return inlineContent
  }).filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n").trim()
}

function getDraftStorageKey(vault?: string, notePath?: string) {
  if (!vault || !notePath) return null
  return `fns:draft:${vault}:${notePath}`
}

function saveLocalDraft(vault?: string, notePath?: string, content?: string, synced = false) {
  const key = getDraftStorageKey(vault, notePath)
  if (!key || content === undefined) return
  try {
    if (synced) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, JSON.stringify({ content, updatedAt: Date.now(), synced: false }))
    }
  } catch {
    // Quota or privacy mode fallback
  }
}

function loadLocalDraft(vault?: string, notePath?: string): { content: string; updatedAt: number; synced: boolean } | null {
  const key = getDraftStorageKey(vault, notePath)
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function clearLocalDraft(vault?: string, notePath?: string) {
  const key = getDraftStorageKey(vault, notePath)
  if (!key) return
  try {
    localStorage.removeItem(key)
  } catch {}
}

type AutoSaveStatus = 'saved' | 'saving' | 'unsaved' | 'offline' | 'error'

export function InlineMarkdownEditor({
  content,
  onSave,
  connection,
  vault,
  notePath,
  fileLinks,
  frontmatter,
  saveStatusTarget,
  onSelectionAI,
}: {
  content: string
  onSave: (content: string) => Promise<void>
  connection?: Connection
  vault?: string
  notePath?: string
  fileLinks?: Record<string, string>
  frontmatter?: Frontmatter
  saveStatusTarget: HTMLElement | null
  onSelectionAI?: (request: { text: string; start: number; end: number; action: 'ask' | 'rewrite' | 'shorten' | 'translate' }) => void
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const closeLanguageMenu = useRef<ReturnType<typeof openCodeLanguageMenu> | undefined>(undefined)
  useEffect(() => () => closeLanguageMenu.current?.(), [vault, notePath])
  const [saveStatus, setSaveStatus] = useState<AutoSaveStatus>('saved')
  const isDirtyRef = useRef(false)
  const isSavingRef = useRef(false)
  // Keep this null until the first DOM hydration. Initialising it with `content`
  // makes the first effect think the editor is already rendered and leaves the
  // contentEditable surface empty in the default edit mode.
  const lastSavedContentRef = useRef<string | null>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  const [selectedImage, setSelectedImage] = useState<{
    element: HTMLImageElement
    rect: { top: number; left: number; width: number }
    width: string
  } | null>(null)
  const [aiSelection, setAiSelection] = useState<{ text: string; start: number; end: number; rect: DOMRect } | null>(null)

  const updateAiSelection = useCallback(() => {
    if (!onSelectionAI || !editorRef.current) return
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setAiSelection(null)
      return
    }
    const range = selection.getRangeAt(0)
    if (!editorRef.current.contains(range.commonAncestorContainer)) {
      setAiSelection(null)
      return
    }
    const rawText = range.toString()
    const text = rawText.trim()
    if (text.length < 2) {
      setAiSelection(null)
      return
    }
    const rect = range.getBoundingClientRect()
    if (!rect.width && !rect.height) {
      setAiSelection(null)
      return
    }
    // Range offsets are JavaScript UTF-16 positions, matching the AI
    // proposal contract. Keep the range on the untrimmed text, then shift it
    // to the visible selection text so surrounding whitespace is preserved.
    const startRange = range.cloneRange()
    startRange.selectNodeContents(editorRef.current)
    startRange.setEnd(range.startContainer, range.startOffset)
    const rawStart = startRange.toString().length
    const leadingWhitespace = Math.max(0, rawText.indexOf(text))
    const start = rawStart + leadingWhitespace
    const visibleText = text.slice(0, 6000)
    setAiSelection({ text: visibleText, start, end: start + visibleText.length, rect })
  }, [onSelectionAI])

  useEffect(() => {
    if (!aiSelection) return
    const clearOnOutsideSelection = () => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || !editorRef.current?.contains(selection.anchorNode)) setAiSelection(null)
    }
    document.addEventListener('selectionchange', clearOnOutsideSelection)
    return () => document.removeEventListener('selectionchange', clearOnOutsideSelection)
  }, [aiSelection])
  const performSave = useCallback(async () => {
    if (!editorRef.current || isSavingRef.current) return
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }

    editorRef.current.querySelectorAll("img.is-selected-image").forEach((el) => el.classList.remove("is-selected-image"))
    const nextMarkdown = editableHtmlToMarkdown(editorRef.current)

    // Instantly persist locally to guarantee no data loss
    saveLocalDraft(vault, notePath, nextMarkdown, false)

    if (nextMarkdown.trim() === (lastSavedContentRef.current || '').trim()) {
      isDirtyRef.current = false
      clearLocalDraft(vault, notePath)
      setSaveStatus('saved')
      return
    }

    isSavingRef.current = true
    setSaveStatus('saving')
    try {
      lastSavedContentRef.current = nextMarkdown
      await onSaveRef.current(nextMarkdown)
      isDirtyRef.current = false
      clearLocalDraft(vault, notePath)
      setSaveStatus('saved')
    } catch {
      // Network failed or offline: keep draft in localStorage, update UI status
      saveLocalDraft(vault, notePath, nextMarkdown, false)
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setSaveStatus('offline')
      } else {
        setSaveStatus('error')
      }
      // Auto-retry in 3 seconds
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = setTimeout(() => {
        if (isDirtyRef.current) void performSave()
      }, 3000)
    } finally {
      isSavingRef.current = false
    }
  }, [vault, notePath])

  const triggerDirty = useCallback(() => {
    isDirtyRef.current = true
    setSaveStatus('unsaved')
    if (editorRef.current) {
      const currentText = editableHtmlToMarkdown(editorRef.current)
      saveLocalDraft(vault, notePath, currentText, false)
    }
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
    }
    // Snappy 400ms debounce for lightning fast auto-save
    autoSaveTimerRef.current = setTimeout(() => {
      void performSave()
    }, 400)
  }, [performSave, vault, notePath])

  // Flush pending auto-save on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
      if (isDirtyRef.current && editorRef.current) {
        const nextMarkdown = editableHtmlToMarkdown(editorRef.current)
        saveLocalDraft(vault, notePath, nextMarkdown, false)
        void onSaveRef.current(nextMarkdown)
      }
    }
  }, [vault, notePath])

  // Network & beforeunload listeners for maximum offline resilience
  useEffect(() => {
    function handleOnline() {
      if (isDirtyRef.current) {
        void performSave()
      }
    }
    function handleBeforeUnload() {
      if (isDirtyRef.current && editorRef.current) {
        const nextMarkdown = editableHtmlToMarkdown(editorRef.current)
        saveLocalDraft(vault, notePath, nextMarkdown, false)
      }
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [performSave, vault, notePath])

  useEffect(() => {
    if (!editorRef.current) return
    if (lastSavedContentRef.current !== null && lastSavedContentRef.current.trim() === content.trim()) {
      return
    }
    if (isDirtyRef.current) {
      return
    }

    // Check if there is an unsynced local draft for this note
    const draft = loadLocalDraft(vault, notePath)
    let initialContent = content
    if (draft && !draft.synced && draft.content && draft.content.trim() !== content.trim()) {
      initialContent = draft.content
      isDirtyRef.current = true
      setSaveStatus('offline')
      setTimeout(() => void performSave(), 400)
    } else {
      setSaveStatus('saved')
    }

    editorRef.current.innerHTML = markdownToEditableHtml(initialContent)
    lastSavedContentRef.current = initialContent

    if (!connection?.baseUrl || !connection?.token || !vault || !notePath) return
    const mediaImgs = Array.from(editorRef.current.querySelectorAll<HTMLImageElement>("img[src^=\"#fns-media:\"]"))
    const createdUrls: string[] = []

    for (const img of mediaImgs) {
      const rawSrc = img.getAttribute("src") || ""
      const attachmentPath = resolveAttachmentPath(rawSrc, notePath, connection, fileLinks)
      if (!attachmentPath) continue
      img.dataset.originalSrc = rawSrc
      loadPreviewBlob(connection, vault, attachmentPath)
        .then((blob) => {
          const url = URL.createObjectURL(blob)
          createdUrls.push(url)
          img.src = url
        })
        .catch(() => {})
    }

    return () => {
      for (const url of createdUrls) URL.revokeObjectURL(url)
    }
  }, [content, connection, vault, notePath, fileLinks, performSave])

  useEffect(() => {
    if (!selectedImage) return
    function updatePos() {
      if (!selectedImage || !document.body.contains(selectedImage.element)) {
        setSelectedImage(null)
        return
      }
      const r = selectedImage.element.getBoundingClientRect()
      setSelectedImage((prev) => (prev ? { ...prev, rect: { top: r.top, left: r.left, width: r.width } } : null))
    }
    window.addEventListener("scroll", updatePos, true)
    window.addEventListener("resize", updatePos)
    return () => {
      window.removeEventListener("scroll", updatePos, true)
      window.removeEventListener("resize", updatePos)
    }
  }, [selectedImage?.element])

  function handleEditorClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement

    const openLanguageButton = target.closest<HTMLButtonElement>('button[data-action="open-code-language"]')
    if (openLanguageButton) {
      event.preventDefault()
      event.stopPropagation()
      if (openLanguageButton.getAttribute('aria-expanded') === 'true') {
        closeLanguageMenu.current?.()
        return
      }
      const block = openLanguageButton.closest<HTMLElement>('.code-block')
      if (!block) return
      closeLanguageMenu.current = openCodeLanguageMenu(openLanguageButton, block.dataset.lang || 'text', (language) => {
        const codeEl = block.querySelector('code')
        if (!codeEl || !editorRef.current?.contains(block)) return
        block.dataset.lang = language
        const label = openLanguageButton.querySelector('[data-code-language-label]')
        if (label) label.textContent = codeLanguageLabel(language)
        codeEl.className = `language-${language}`
        const codeText = codeEl.textContent || ''
        const highlighted = language === 'text' ? '' : highlightCode(codeText, language)
        if (highlighted) codeEl.innerHTML = highlighted
        else codeEl.textContent = codeText
        triggerDirty()
      })
      return
    }

    const copyBtn = target.closest<HTMLButtonElement>("button.code-block-copy-btn")
    if (copyBtn) {
      event.preventDefault()
      event.stopPropagation()
      const block = copyBtn.closest<HTMLElement>(".code-block")
      if (block) {
        const codeEl = block.querySelector("code") || block.querySelector("pre")
        const codeText = (codeEl?.textContent || "").replace(/\n$/, "")
        if (codeText) {
          navigator.clipboard.writeText(codeText).then(() => {
            copyBtn.classList.add("is-copied")
            const textSpan = copyBtn.querySelector("span")
            if (textSpan) textSpan.textContent = "已复制"
            window.setTimeout(() => {
              copyBtn.classList.remove("is-copied")
              if (textSpan) textSpan.textContent = "复制"
            }, 1600)
          }).catch(() => {})
        }
      }
      return
    }

    if (target.tagName.toLowerCase() === "img") {
      const img = target as HTMLImageElement
      editorRef.current?.querySelectorAll("img.is-selected-image").forEach((el) => el.classList.remove("is-selected-image"))
      img.classList.add("is-selected-image")
      const r = img.getBoundingClientRect()
      const currentWidth = img.dataset.specifiedWidth || (img.style.width ? (img.style.width.endsWith("%") ? img.style.width : img.style.width.replace(/px$/, "")) : "auto")
      setSelectedImage({
        element: img,
        rect: { top: r.top, left: r.left, width: r.width },
        width: currentWidth,
      })
    } else {
      editorRef.current?.querySelectorAll("img.is-selected-image").forEach((el) => el.classList.remove("is-selected-image"))
      setSelectedImage(null)
    }
  }

  function setImageSize(size: "200" | "380" | "540" | "100%" | "auto") {
    if (!selectedImage) return
    const img = selectedImage.element
    if (size === "auto") {
      img.style.width = ""
      img.style.maxWidth = "min(100%, 540px)"
      img.style.height = "auto"
      img.removeAttribute("data-specified-width")
    } else if (size === "100%") {
      img.style.width = "100%"
      img.style.maxWidth = "100%"
      img.style.height = "auto"
      img.setAttribute("data-specified-width", "100%")
    } else {
      img.style.width = `${size}px`
      img.style.maxWidth = `min(100%, ${size}px)`
      img.style.height = "auto"
      img.setAttribute("data-specified-width", size)
    }
    const r = img.getBoundingClientRect()
    setSelectedImage({
      element: img,
      rect: { top: r.top, left: r.left, width: r.width },
      width: size,
    })
    triggerDirty()
  }

  function deleteImage() {
    if (!selectedImage) return
    selectedImage.element.remove()
    setSelectedImage(null)
    triggerDirty()
  }

  function runSelectionAction(action: 'ask' | 'rewrite' | 'shorten' | 'translate') {
    if (!aiSelection || !onSelectionAI) return
    onSelectionAI({ text: aiSelection.text, start: aiSelection.start, end: aiSelection.end, action })
    setAiSelection(null)
    window.getSelection()?.removeAllRanges()
  }

  return (
    <div className="inline-editor-shell">
      {saveStatusTarget ? createPortal(
        <span className="inline-editor-autosave-status" role="status" aria-live="polite">
          {saveStatus === 'saving' ? (
            <span className="status-badge is-saving"><LoaderCircle size={13} className="spin" /> 正在保存...</span>
          ) : saveStatus === 'unsaved' ? (
            <span className="status-badge is-unsaved"><span className="status-dot" /> 正在输入...</span>
          ) : saveStatus === 'offline' ? (
            <span className="status-badge is-offline" onClick={() => void performSave()} title="网络断开，内容已即时保存在本地，恢复后自动同步。点击可立即重试"><Database size={13} /> 已本地暂存（离线）</span>
          ) : saveStatus === 'error' ? (
            <span className="status-badge is-error" onClick={() => void performSave()} title="保存受阻，内容已安全保存在本地。点击重试"><CircleAlert size={13} /> 网络异常，已本地暂存 (点击重试)</span>
          ) : (
            <span className="status-badge is-saved"><Check size={13} /> 已自动保存</span>
          )}
        </span>,
        saveStatusTarget,
      ) : null}

      {selectedImage && selectedImage.rect.top > 0 ? (
        <div
          className="inline-editor-image-toolbar"
          style={{
            position: "fixed",
            top: `${Math.max(60, selectedImage.rect.top - 46)}px`,
            left: `${selectedImage.rect.left + selectedImage.rect.width / 2}px`,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span className="image-toolbar-label"><Image size={13} /> 尺寸:</span>
          <button
            type="button"
            className={selectedImage.width === "200" ? "is-active" : ""}
            onClick={(e) => { e.stopPropagation(); setImageSize("200"); }}
            title="小图 (200px)"
          >
            小 (25%)
          </button>
          <button
            type="button"
            className={selectedImage.width === "380" ? "is-active" : ""}
            onClick={(e) => { e.stopPropagation(); setImageSize("380"); }}
            title="适中 (380px)"
          >
            中 (50%)
          </button>
          <button
            type="button"
            className={selectedImage.width === "540" ? "is-active" : ""}
            onClick={(e) => { e.stopPropagation(); setImageSize("540"); }}
            title="大图 (540px)"
          >
            大 (75%)
          </button>
          <button
            type="button"
            className={selectedImage.width === "100%" ? "is-active" : ""}
            onClick={(e) => { e.stopPropagation(); setImageSize("100%"); }}
            title="全宽 (100%)"
          >
            全宽
          </button>
          <button
            type="button"
            className={selectedImage.width === "auto" ? "is-active" : ""}
            onClick={(e) => { e.stopPropagation(); setImageSize("auto"); }}
            title="默认大小"
          >
            默认
          </button>
          <span className="toolbar-divider" />
          <button
            type="button"
            className="delete-btn"
            onClick={(e) => { e.stopPropagation(); deleteImage(); }}
            title="删除图片"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ) : null}

      {frontmatter && Object.keys(frontmatter).length > 0 ? (
        <div className="inline-editor-properties-wrapper" contentEditable={false}>
          <DocumentProperties data={frontmatter} />
        </div>
      ) : null}
      {aiSelection ? createPortal(
        <div
          className="editor-ai-selection-menu"
          role="toolbar"
          aria-label="选中文本的 AI 操作"
          style={{
            top: `${Math.max(60, aiSelection.rect.top - 48)}px`,
            left: `${Math.min(Math.max(12, window.innerWidth - 328), Math.max(12, aiSelection.rect.left + aiSelection.rect.width / 2 - 156))}px`,
          }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <span className="editor-ai-selection-label"><Sparkles size={13} />AI</span>
          <span className="editor-ai-selection-divider" aria-hidden="true" />
          <button type="button" onClick={() => runSelectionAction('ask')}>问 AI</button>
          <button type="button" onClick={() => runSelectionAction('rewrite')}>改写</button>
          <button type="button" onClick={() => runSelectionAction('shorten')}>精简</button>
          <button type="button" onClick={() => runSelectionAction('translate')}>翻译</button>
        </div>,
        document.body,
      ) : null}
      <div
        ref={editorRef}
        className="document-reader inline-editor-content"
        contentEditable
        suppressContentEditableWarning
        onInput={triggerDirty}
        onMouseUp={() => window.setTimeout(updateAiSelection, 0)}
        onKeyUp={() => window.setTimeout(updateAiSelection, 0)}
        onBlur={(event) => {
          if (event.relatedTarget instanceof Element && event.relatedTarget.closest('.code-language-floating')) return
          if (isDirtyRef.current) {
            void performSave()
          }
        }}
        onClick={handleEditorClick}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && (event.key === "Enter" || event.key.toLowerCase() === "s")) {
            event.preventDefault()
            void performSave()
          }
        }}
      />
    </div>
  )
}

interface PiAssistantProps {
  note: Note
  connection: Connection
  vaultName: string
  onClose: () => void
  onReplace: (content: string) => Promise<void>
  onCreateDocument: (path: string, content: string) => Promise<Note>
  onDeleteDocument: (path: string) => Promise<void>
  availableSkills?: SkillItem[]
  enabledSkillIds?: string[]
  setEnabledSkillIds?: React.Dispatch<React.SetStateAction<string[]>>
  onToggleSkill?: (skillId: string) => void
  onSelectAllSkills?: () => void
  onClearAllSkills?: () => void
  onInspectSkill?: (skill: SkillItem) => void
}

function formatSkillMarkdown(content: string): string {
  return content.replace(/^---[\s\S]*?---\s*/, "")
}

type PiMessage = {
  role: 'user' | 'assistant'
  content: string
  withThinking?: boolean
  skills?: string[]
  tools?: string[]
  sources?: string[]
  process?: string[]
  kind?: 'status' | 'answer'
}

type PiEditProposal = {
  snapshot: string
  content: string
  summary?: string
}

type PiHistorySession = {
  id: string
  title: string
  updatedAt: number
  messages: PiMessage[]
  vault?: string
  notePath?: string
  source?: 'pi' | 'ai-chat'
}

type PiHistoryState = {
  activeId: string
  sessions: PiHistorySession[]
}

function newPiHistorySession(title = '新对话', context?: Pick<PiHistorySession, 'vault' | 'notePath'>): PiHistorySession {
  return { id: crypto.randomUUID(), title, updatedAt: Date.now(), messages: [], ...context }
}

function readPiMessages(value: unknown): PiMessage[] {
  if (!Array.isArray(value)) return []
  return value.filter((message): message is PiMessage => Boolean(message) && typeof message === 'object' && ((message as PiMessage).role === 'user' || (message as PiMessage).role === 'assistant') && typeof (message as PiMessage).content === 'string').slice(-40)
}

function isPiHistorySession(value: unknown): value is PiHistorySession {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<PiHistorySession>
  return typeof session.id === 'string'
    && typeof session.title === 'string'
    && Number.isFinite(session.updatedAt)
    && Array.isArray(session.messages)
}

function convertChatSessionToPiHistory(session: ChatSession): PiHistorySession {
  const firstDocument = session.documents?.[0] || session.messages.flatMap((message) => message.documents || [])[0]
  return {
    id: `ai-chat:${session.id}`,
    title: session.title,
    updatedAt: session.updatedAt,
    messages: session.messages.map((message) => ({
      role: message.role,
      content: message.content,
      tools: message.tools,
      process: message.process,
      sources: message.documents?.map((document) => `${document.vault}/${document.path}`),
      kind: message.status === 'error' || message.status === 'stopped' ? 'status' : 'answer',
    })),
    vault: firstDocument?.vault,
    notePath: firstDocument?.path,
    source: 'ai-chat',
  }
}

function readAiChatHistory(raw: string | null): { sessions: PiHistorySession[]; activeId: string } {
  const history = readChatHistory(raw)
  return {
    sessions: history.sessions.map(convertChatSessionToPiHistory),
    activeId: history.activeId ? `ai-chat:${history.activeId}` : '',
  }
}

function readPiHistory(raw: string | null, legacyRaw: string | null, legacyHistoryRaws: string[] = [], aiChatRaw: string | null = null): PiHistoryState {
  const readStoredSessions = (source: string | null): PiHistorySession[] => {
    if (!source) return []
    try {
      const value = JSON.parse(source)
      if (!Array.isArray(value?.sessions)) return []
      return (value.sessions as unknown[])
        .filter(isPiHistorySession)
        .map((session) => ({
          ...session,
          messages: readPiMessages(session.messages),
        }))
        .slice(0, 30)
    } catch {
      return []
    }
  }
  const storedSessions = readStoredSessions(raw)
  const migratedSessions = legacyHistoryRaws
    .flatMap((source) => readStoredSessions(source))
    .filter((session, index, all) => all.findIndex((candidate) => candidate.id === session.id) === index)
    .slice(0, 30)
  const aiChatHistory = readAiChatHistory(aiChatRaw)
  const baseSessions = storedSessions.length ? storedSessions : migratedSessions
  const mergedById = new Map<string, PiHistorySession>()
  for (const session of baseSessions) mergedById.set(session.id, session)
  for (const session of aiChatHistory.sessions) mergedById.set(session.id, session)
  const sessions = Array.from(mergedById.values()).sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 30)
  if (sessions.length) {
    const activeId = (() => {
      try {
        const value = raw ? JSON.parse(raw) : null
        if (sessions.some((session) => session.id === value?.activeId)) return value.activeId
      } catch {}
      return sessions.some((session) => session.id === aiChatHistory.activeId) ? aiChatHistory.activeId : sessions[0].id
    })()
    return { sessions, activeId }
  }
  const legacyMessages = (() => { try { return readPiMessages(legacyRaw ? JSON.parse(legacyRaw) : null) } catch { return [] } })()
  const legacyTitle = legacyMessages.find((message) => message.role === 'user')?.content.trim().slice(0, 28) || '新对话'
  const session = { ...newPiHistorySession(legacyTitle), messages: legacyMessages, updatedAt: legacyMessages.length ? Date.now() : 0 }
  return { activeId: session.id, sessions: [session] }
}

function PiAssistantDialog({
  note,
  connection,
  vaultName,
  onClose,
  onReplace,
  onCreateDocument,
  onDeleteDocument,
  availableSkills: propAvailableSkills,
  enabledSkillIds: propEnabledSkillIds,
  setEnabledSkillIds: propSetEnabledSkillIds,
  onToggleSkill: propToggleSkill,
  onSelectAllSkills: propSelectAllSkills,
  onClearAllSkills: propClearAllSkills,
  onInspectSkill: propInspectSkill,
}: PiAssistantProps) {
  const [layoutMode, setLayoutMode] = useState<'docked' | 'modal'>('docked')
  const [draft, setDraft] = useState('')
  const currentNoteDocument = { vault: vaultName, path: note.path }
  const [selectedDocuments, setSelectedDocuments] = useState<ChatDocument[]>([currentNoteDocument])
  const [isThinkingMode, setIsThinkingMode] = useState(() => {
    try { return localStorage.getItem("fns-pi-thinking-mode") === "true" } catch { return false }
  })
  const [undoSnapshot, setUndoSnapshot] = useState<string | null>(null)
  const [undoAppliedContent, setUndoAppliedContent] = useState<string | null>(null)
  const [editProposal, setEditProposal] = useState<PiEditProposal | null>(null)
  const accountHistoryId = `${connection.baseUrl}:${connection.user?.uid}`
  const [models, setModels] = useState<ChatModel[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const [modelsError, setModelsError] = useState('')
  const [modelsRevision, setModelsRevision] = useState(0)
  const [selectedModel, setSelectedModel] = useState<ChatModel>()
  const [isModelPopoverOpen, setIsModelPopoverOpen] = useState(false)
  const [modelQuery, setModelQuery] = useState('')
  const modelPopoverRef = useRef<HTMLDivElement>(null)
  const selectedModelKey = chatModelKey(selectedModel)
  const modelUnavailable = Boolean(selectedModel && !modelsLoading && !modelsError && !models.some((model) => chatModelKey(model) === selectedModelKey))
  const historyStorageKey = `fns-pi-history:${accountHistoryId}`
  const aiChatStorageKey = `fns-docs-viewer.ai-chat:${accountHistoryId}`
  const legacyChatStorageKey = `fns-pi-chat:${note.path}`
  const [historyState, setHistoryState] = useState<PiHistoryState>(() => {
    try {
      const legacyHistoryRaws: string[] = []
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index)
        if (key?.startsWith('fns-pi-history:') && key !== historyStorageKey) {
          const value = localStorage.getItem(key)
          if (value) legacyHistoryRaws.push(value)
        }
      }
      return readPiHistory(localStorage.getItem(historyStorageKey), localStorage.getItem(legacyChatStorageKey), legacyHistoryRaws, localStorage.getItem(aiChatStorageKey))
    } catch {
      return readPiHistory(null, null)
    }
  })
  const activeHistorySession = historyState.sessions.find((session) => session.id === historyState.activeId)
  const activeHistoryTitle = activeHistorySession?.title.trim() || '新对话'
  const messages = activeHistorySession?.messages || []
  const [isHistoryMenuOpen, setIsHistoryMenuOpen] = useState(false)
  const [historyQuery, setHistoryQuery] = useState('')
  const historyMenuRef = useRef<HTMLDivElement>(null)
  const visibleHistorySessions = historyState.sessions.filter((session) => {
    const query = historyQuery.trim().toLowerCase()
    if (!query) return true
    return `${session.title} ${session.notePath || ''} ${session.messages.map((message) => message.content).join(' ')}`.toLowerCase().includes(query)
  })
  function setMessages(next: React.SetStateAction<PiMessage[]>) {
    setHistoryState((current) => {
      const active = current.sessions.find((session) => session.id === current.activeId) || current.sessions[0] || newPiHistorySession()
      const nextMessages = typeof next === 'function' ? next(active.messages) : next
      const firstUser = nextMessages.find((message) => message.role === 'user')?.content.trim()
      const title = active.title === '新对话' && firstUser ? firstUser.slice(0, 28) : active.title
      const updated = {
        ...active,
        vault: active.vault || vaultName,
        notePath: active.notePath || note.path,
        title,
        messages: nextMessages.slice(-40),
        updatedAt: Date.now(),
      }
      const sessions = current.sessions.some((session) => session.id === active.id)
        ? current.sessions.map((session) => session.id === active.id ? updated : session)
        : [updated, ...current.sessions]
      return { activeId: active.id, sessions }
    })
  }
  const [localAvailableSkills, setLocalAvailableSkills] = useState<SkillItem[]>([])
  const [localEnabledSkillIds, setLocalEnabledSkillIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('fns-pi-enabled-skills')
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string')
      }
    } catch {}
    return []
  })
  const [isSkillsPanelOpen, setIsSkillsPanelOpen] = useState(false)
  const [skillFilter, setSkillFilter] = useState('')
  const [skillCategory, setSkillCategory] = useState<'all' | 'codex' | 'system' | 'agents'>('all')
  useEffect(() => { setSelectedDocuments([{ vault: vaultName, path: note.path }]) }, [note.path, vaultName])

  const setEnabledSkillIds = propSetEnabledSkillIds ?? setLocalEnabledSkillIds
  const availableSkills = propAvailableSkills ?? localAvailableSkills
  const enabledSkillIds = propEnabledSkillIds ?? localEnabledSkillIds
  useEffect(() => {
    try { localStorage.setItem(historyStorageKey, JSON.stringify(historyState)) } catch {}
  }, [historyStorageKey, historyState])
  useEffect(() => {
    if (!isHistoryMenuOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!historyMenuRef.current?.contains(event.target as Node)) setIsHistoryMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [isHistoryMenuOpen])

  useEffect(() => {
    try {
      setSelectedModel(readChatModel(JSON.parse(localStorage.getItem(`fns-pi-model:${accountHistoryId}`) || 'null')))
    } catch {
      setSelectedModel(undefined)
    }
  }, [accountHistoryId])

  useEffect(() => {
    const controller = new AbortController()
    setModelsLoading(true)
    setModelsError('')
    void getAIModels(connection, controller.signal).then((available) => {
      if (!controller.signal.aborted) setModels(available)
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setModelsError(reason instanceof Error ? reason.message : '无法加载模型列表。')
    }).finally(() => {
      if (!controller.signal.aborted) setModelsLoading(false)
    })
    return () => controller.abort()
  }, [connection, modelsRevision])

  useEffect(() => {
    const refresh = () => setModelsRevision((current) => current + 1)
    window.addEventListener('ai-providers-changed', refresh)
    return () => window.removeEventListener('ai-providers-changed', refresh)
  }, [])

  useEffect(() => {
    if (!isModelPopoverOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!modelPopoverRef.current?.contains(event.target as Node)) setIsModelPopoverOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [isModelPopoverOpen])

  function changeModel(key: string) {
    if (isRunning || isReplacing) return
    const nextModel = models.find((model) => chatModelKey(model) === key)
    setSelectedModel(nextModel)
    try {
      if (nextModel) localStorage.setItem(`fns-pi-model:${accountHistoryId}`, JSON.stringify(nextModel))
      else localStorage.removeItem(`fns-pi-model:${accountHistoryId}`)
    } catch {}
    setIsModelPopoverOpen(false)
    setModelQuery('')
  }

  useEffect(() => {
    if (propAvailableSkills) return
    let isMounted = true
    void getAvailableSkills(connection).then((items) => {
      if (isMounted) setLocalAvailableSkills(items)
    }).catch(() => {})
    return () => { isMounted = false }
  }, [connection, propAvailableSkills])

  function toggleSkill(skillId: string) {
    if (propToggleSkill) {
      propToggleSkill(skillId)
    } else {
      setEnabledSkillIds((current) => {
        const next = current.includes(skillId)
          ? current.filter((id) => id !== skillId)
          : [...current, skillId]
        try { localStorage.setItem('fns-pi-enabled-skills', JSON.stringify(next)) } catch {}
        return next
      })
    }
  }

  function selectAllSkills() {
    if (propSelectAllSkills) {
      propSelectAllSkills()
    } else {
      const allIds = availableSkills.map((s) => s.id)
      setEnabledSkillIds(allIds)
      try { localStorage.setItem('fns-pi-enabled-skills', JSON.stringify(allIds)) } catch {}
    }
  }

  function clearAllSkills() {
    if (propClearAllSkills) {
      propClearAllSkills()
    } else {
      setEnabledSkillIds([])
      try { localStorage.setItem('fns-pi-enabled-skills', JSON.stringify([])) } catch {}
    }
  }

  function applySkillBundle(skillKeys: string[]) {
    const matchedIds = availableSkills
      .filter((s) => skillKeys.some((k) => s.key === k || s.name === k))
      .map((s) => s.id)
    if (matchedIds.length === 0) return
    setEnabledSkillIds((current) => {
      const set = new Set([...current, ...matchedIds])
      const next = Array.from(set)
      try { localStorage.setItem('fns-pi-enabled-skills', JSON.stringify(next)) } catch {}
      return next
    })
  }

  const filteredSkills = useMemo(() => {
    return availableSkills.filter((s) => {
      if (skillCategory !== 'all' && s.source !== skillCategory) return false
      if (!skillFilter.trim()) return true
      const q = skillFilter.toLowerCase()
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.key.toLowerCase().includes(q)
    })
  }, [availableSkills, skillCategory, skillFilter])
  const [isRunning, setIsRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const [isReplacing, setIsReplacing] = useState(false)
  const [error, setError] = useState('')
  const [copiedMessage, setCopiedMessage] = useState<number | null>(null)
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)
  const busy = useRef(false)
  const chatRef = useRef<HTMLDivElement>(null)
  const shouldStickToBottom = useRef(true)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    return () => { previousFocus?.focus(); abortRef.current?.abort() }
  }, [])

  useEffect(() => {
    const chat = chatRef.current
    if (!chat) return
    const updateScrollState = () => {
      const distanceFromBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight
      const atLatest = distanceFromBottom <= 56
      shouldStickToBottom.current = atLatest
      setShowScrollToLatest(!atLatest)
    }
    setShowScrollToLatest(false)
    chat.addEventListener('scroll', updateScrollState, { passive: true })
    return () => chat.removeEventListener('scroll', updateScrollState)
  }, [])

  useEffect(() => {
    const chat = chatRef.current
    if (chat && shouldStickToBottom.current) {
      chat.scrollTop = chat.scrollHeight
      setShowScrollToLatest(false)
    }
  }, [messages, isRunning])

  function scrollToLatest() {
    const chat = chatRef.current
    if (!chat) return
    shouldStickToBottom.current = true
    chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' })
    setShowScrollToLatest(false)
  }

  function toggleLayoutMode() {
    setLayoutMode((current) => {
      const next = current === 'docked' ? 'modal' : 'docked'
      try { localStorage.setItem('fns-pi-assistant-mode', next) } catch {}
      return next
    })
  }

  function toggleThinkingMode() {
    setIsThinkingMode((prev) => {
      const next = !prev
      try { localStorage.setItem("fns-pi-thinking-mode", String(next)) } catch {}
      return next
    })
  }

  function createHistoryConversation() {
    if (isRunning || isReplacing) return
    const session = newPiHistorySession('新对话', { vault: vaultName, notePath: note.path })
    setHistoryState((current) => ({ activeId: session.id, sessions: [session, ...current.sessions].slice(0, 30) }))
    setDraft('')
    setError('')
    setEditProposal(null)
    setIsSkillsPanelOpen(false)
    setIsHistoryMenuOpen(false)
    setHistoryQuery('')
    composerRef.current?.focus()
  }

  function switchHistoryConversation(session: PiHistorySession) {
    if (isRunning || isReplacing || session.id === historyState.activeId) return
    setHistoryState((current) => ({ ...current, activeId: session.id }))
    setDraft('')
    setError('')
    setUndoSnapshot(null)
    setUndoAppliedContent(null)
    setEditProposal(null)
    setIsSkillsPanelOpen(false)
    setIsHistoryMenuOpen(false)
    setHistoryQuery('')
    composerRef.current?.focus()
  }

  function deleteHistoryConversation(session: PiHistorySession) {
    if (isRunning || isReplacing || !window.confirm(`删除“${session.title}”及其全部消息？此操作无法撤销。`)) return
    setHistoryState((current) => {
      const remaining = current.sessions.filter((candidate) => candidate.id !== session.id)
      if (remaining.length === 0) {
        const replacement = newPiHistorySession('新对话', { vault: vaultName, notePath: note.path })
        return { activeId: replacement.id, sessions: [replacement] }
      }
      const activeId = current.activeId === session.id ? remaining[0].id : current.activeId
      return { activeId, sessions: remaining }
    })
    setDraft('')
    setError('')
    setUndoSnapshot(null)
    setUndoAppliedContent(null)
    setEditProposal(null)
    setHistoryQuery('')
  }

  function stopGeneration() { abortRef.current?.abort() }

  function updateAssistantMessage(index: number, patch: Partial<PiMessage>) {
    setMessages((current) => current.map((message, messageIndex) => (
      messageIndex === index && message.role === 'assistant' ? { ...message, ...patch } : message
    )))
  }

  function appendProposalToEnd(snapshot: string, generated: string) {
    const lineEnding = snapshot.includes('\r\n') ? '\r\n' : '\n'
    const normalizedSnapshot = snapshot.replace(/\r\n/g, '\n')
    const normalizedGenerated = generated.replace(/\r\n/g, '\n')
    const originalBody = splitFrontmatter(normalizedSnapshot).body
    const generatedBody = splitFrontmatter(normalizedGenerated).body
    let addition = normalizedGenerated

    if (normalizedGenerated.startsWith(normalizedSnapshot)) {
      addition = normalizedGenerated.slice(normalizedSnapshot.length)
    } else if (generatedBody.startsWith(originalBody)) {
      addition = generatedBody.slice(originalBody.length)
    } else if (splitFrontmatter(normalizedGenerated).frontmatter) {
      addition = generatedBody
    }

    addition = cleanMarkdownText(addition).trim()
    if (!addition) return snapshot
    const separator = snapshot.endsWith('\n') || snapshot.endsWith('\r') ? '' : lineEnding
    return `${snapshot}${separator}${addition.replace(/\n/g, lineEnding)}${lineEnding}`
  }

  async function applyEditProposal(mode: 'replace' | 'append', messageIndex: number) {
    const currentProposal = editProposal
    if (!currentProposal || isReplacing || busy.current) return
    if (note.content !== currentProposal.snapshot) {
      setError('笔记内容已发生变化，已取消写入，避免覆盖后续编辑。请重新生成修改建议。')
      return
    }
    const nextContent = mode === 'replace'
      ? currentProposal.content
      : appendProposalToEnd(currentProposal.snapshot, currentProposal.content)
    if (!nextContent.trim() || nextContent === note.content) {
      setError('修改建议没有可写入的变化。')
      return
    }

    setIsReplacing(true)
    setError('')
    try {
      await onReplace(nextContent)
      setUndoSnapshot(currentProposal.snapshot)
      setUndoAppliedContent(nextContent)
      setEditProposal(null)
      const process = messages[messageIndex]?.process || []
      updateAssistantMessage(messageIndex, {
        process: [...process, mode === 'replace' ? '接受替换' : '追加到文末', '已保存'],
        content: mode === 'replace'
          ? '✅ 已按修改建议更新文档，未修改部分已保留。可点击下方“撤销改动”恢复。'
          : '✅ 已将修改建议追加到文档末尾。可点击下方“撤销改动”恢复。',
        kind: 'status',
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法写入文档。')
    } finally {
      setIsReplacing(false)
    }
  }

  function discardEditProposal(messageIndex: number) {
    if (!editProposal || isReplacing || isRunning) return
    setEditProposal(null)
    const process = messages[messageIndex]?.process || []
    updateAssistantMessage(messageIndex, {
      process: [...process, '已放弃'],
      content: '已放弃本次修改建议，文档没有变化。',
      kind: 'status',
    })
  }

  async function send(instruction = draft.trim(), retryFromIndex?: number) {
    const content = instruction.trim()
    if (!content || busy.current || isReplacing) return
    busy.current = true
    setEditProposal(null)
    const createIntent = parseDocumentCreateIntent(content)
    const deleteIntent = parseDocumentDeleteIntent(content)
    const willLiveEdit = !createIntent && !deleteIntent && isDocumentEditIntent(content)
    const snapshot = note.content
    const { frontmatter, body: originalBody } = splitFrontmatter(snapshot)
    const historyMessages = retryFromIndex === undefined ? messages : messages.slice(0, retryFromIndex)
    const history = historyMessages.slice(-6).map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content.slice(0, 1_000)}`).join("\n")
    const activeSkills = availableSkills.filter((s) => enabledSkillIds.includes(s.id))
    // The unified AI API accepts stable skill IDs only. Filesystem paths are
    // server-owned and must never cross the browser/API boundary.
    const activeSkillIds = activeSkills.map((s) => s.id)
    const activeSkillNames = activeSkills.map((s) => s.name)
    const usedTools = createIntent
      ? [createIntent.content ? '文档创建' : 'AI 生成内容', '文档创建']
      : deleteIntent
        ? ['文档删除']
        : willLiveEdit
          ? ['文档修改', 'AI 模型']
          : [selectedDocuments.length ? '引用文档' : '知识库检索', 'AI 模型']
    const initialProcess = createIntent
      ? ['准备请求', '分析创建指令', '准备新文档']
      : deleteIntent
        ? ['准备请求', '定位目标文档']
        : willLiveEdit
          ? ['准备请求', '读取当前文档', '分析修改指令']
          : selectedDocuments.length
            ? ['准备请求', '读取引用文档']
            : ['准备请求', '分析问题']
    setIsRunning(true)
    setError("")
    setDraft("")
    setMessages((current) => [
      ...(retryFromIndex === undefined ? current : current.slice(0, retryFromIndex)),
      { role: "user", content },
      { role: "assistant", content: "", withThinking: isThinkingMode, skills: activeSkillNames, tools: usedTools, process: initialProcess, kind: willLiveEdit || createIntent || deleteIntent ? 'status' : 'answer' },
    ])

    function updateLastAssistant(patch: Partial<{ process: string[]; content: string; kind: 'status' | 'answer'; sources: string[] }>) {
      setMessages((current) => {
        const next = [...current]
        const lastIdx = next.length - 1
        if (lastIdx >= 0 && next[lastIdx]?.role === 'assistant') next[lastIdx] = { ...next[lastIdx], ...patch }
        return next
      })
    }

    const directEdit = willLiveEdit ? applyDocumentInstruction(snapshot, content) : { status: 'unsupported' as const }
    updateLastAssistant({ process: [...initialProcess, createIntent ? '生成文章' : deleteIntent ? '准备删除' : '整理上下文', willLiveEdit ? '生成修改建议' : createIntent || deleteIntent ? '执行操作' : '生成回答'], sources: selectedDocuments.map((document) => document.path) })

    let promptInstruction = content
    if (willLiveEdit) {
      promptInstruction = `你是一个专业的 Markdown 笔记智能编辑助手。
用户需要你直接对当前文档正文进行修改。

【用户修改指令】
${content}

【当前文档正文】
${originalBody || "(正文为空)"}

【严格要求】
1. 直接输出修改后的完整 Markdown 正文内容。
2. 严禁输出任何解释、客套话、确认提示或前缀（如“好的”、“已为您修改如下”等），直接从修改后的正文第一字符开始输出。
3. 严禁在最外层包裹 \`\`\`markdown 代码块，直接输出纯 Markdown 文本。
4. 严格保留文档中未被要求修改的内容、原有 Markdown 标题结构、代码块与链接。`
    }

    try {
      abortRef.current = new AbortController()
      let finalResult = ""
      if (createIntent) {
        let createdContent = createIntent.content || ''
        if (!createdContent) {
          updateLastAssistant({ process: [...initialProcess, '读取引用文档', '生成文章'] })
          const documentContext = selectedDocuments.length
            ? await loadChatDocumentContext(selectedDocuments, async (document) => document.vault === currentNoteDocument.vault && document.path === currentNoteDocument.path
              ? { content: snapshot }
              : fnsApi.getNote(connection, document.vault, document.path), abortRef.current.signal)
            : ''
          createdContent = await runPiAssistant(
            `${history ? `${history}\n` : ''}请创建一篇 Markdown 文章，文件名为“${createIntent.path}”。${content}\n只输出文章正文，不要输出解释或代码围栏。`,
            documentContext,
            createIntent.path,
            undefined,
            { thinking: isThinkingMode, skills: activeSkillIds, signal: abortRef.current.signal, model: selectedModel, connection, vault: vaultName },
          )
        }
        if (!createdContent.trim()) throw new FnsApiError('AI 没有生成可保存的文章内容。')
        const created = await onCreateDocument(createIntent.path, cleanMarkdownText(createdContent))
        updateLastAssistant({ process: [...initialProcess, createIntent.content ? '整理正文' : '读取引用文档', '生成文章', '写入新文档', '已完成'], content: `✅ 已创建文章“${created.path}”。` })
        return
      }
      if (deleteIntent) {
        const targetLabel = deleteIntent.path || note.path
        await onDeleteDocument(deleteIntent.path)
        updateLastAssistant({ process: [...initialProcess, '确认目标', '删除文档', '已完成'], content: `✅ 已删除文章“${targetLabel}”。` })
        return
      }
      if (directEdit.status === 'changed') {
        setEditProposal({ snapshot, content: directEdit.content, summary: directEdit.summary })
        updateLastAssistant({
          process: [...initialProcess, '整理上下文', '生成修改建议'],
          kind: 'status',
          content: '✨ 修改建议已生成。请检查前后内容后确认写入。',
        })
        return
      }
      const documentContext = selectedDocuments.length
        ? await loadChatDocumentContext(selectedDocuments, async (document) => document.vault === currentNoteDocument.vault && document.path === currentNoteDocument.path
          ? { content: snapshot }
          : fnsApi.getNote(connection, document.vault, document.path), abortRef.current.signal)
        : ''
      const result = await runPiAssistant(
        `${history ? `${history}\n` : ""}User: ${promptInstruction}\nAssistant:`,
        willLiveEdit ? '' : documentContext,
        documentTitle(note.path),
        (streamedText) => {
          if (willLiveEdit) {
            setMessages((current) => {
              if (current.length === 0) return current
              const next = [...current]
              const lastIdx = next.length - 1
              if (next[lastIdx]?.role === "assistant") {
                next[lastIdx] = {
                  ...next[lastIdx],
                  content: '⚡ 正在生成文档修改…',
                }
              }
              return next
            })
          } else {
            setMessages((current) => {
              if (current.length === 0) return current
              const next = [...current]
              const lastIdx = next.length - 1
              if (next[lastIdx]?.role === "assistant") {
                next[lastIdx] = { ...next[lastIdx], content: streamedText }
              }
              return next
            })
          }
        },
        { thinking: isThinkingMode, skills: activeSkillIds, signal: abortRef.current.signal, model: selectedModel, connection, vault: vaultName }
      )
      finalResult = result
      if (willLiveEdit) {
        const proposal = prepareDocumentEdit(snapshot, finalResult)
        if (proposal.status === 'changed') {
          setEditProposal({ snapshot, content: proposal.content })
        }
        setMessages((current) => {
          if (current.length === 0) return current
          const next = [...current]
          const lastIdx = next.length - 1
          if (next[lastIdx]?.role === "assistant") {
            next[lastIdx] = {
              ...next[lastIdx],
              kind: 'status',
              process: proposal.status === 'changed'
                ? [...initialProcess, '整理上下文', '生成回答', '生成修改建议']
                : [...initialProcess, '整理上下文', '生成回答'],
              content: proposal.status === 'changed'
                ? `✨ 修改建议已生成。请检查前后内容后确认写入。`
                : proposal.status === 'empty'
                  ? 'AI 没有返回有效的文档内容，请调整修改指令后重试。'
                  : 'AI 没有生成可应用的变化，请调整修改指令后重试。',
            }
          }
          return next
        })
        if (proposal.status !== 'changed') setEditProposal(null)
      } else {
        setMessages((current) => {
          if (current.length === 0) return current
          const next = [...current]
          const lastIdx = next.length - 1
          if (next[lastIdx]?.role === "assistant") {
            next[lastIdx] = { ...next[lastIdx], process: [...initialProcess, '整理上下文', '生成回答', '已完成'], content: result }
          }
          return next
        })
      }
    } catch (reason) {
      const stopped = abortRef.current?.signal.aborted || (reason instanceof DOMException && reason.name === 'AbortError')
      updateLastAssistant({
        process: [...initialProcess, stopped ? '已停止' : '请求失败'],
        content: stopped ? '生成已停止。' : `请求失败：${reason instanceof Error ? reason.message : 'AI 请求失败。'}`,
        kind: 'status',
      })
      setDraft(content)
      setError(stopped ? '' : reason instanceof Error ? reason.message : "AI 请求失败。")
    } finally { busy.current = false; setIsRunning(false); abortRef.current = null; composerRef.current?.focus() }
  }

  function retryMessage(index: number) {
    if (isRunning || isReplacing) return
    let userIndex = -1
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (messages[cursor]?.role === 'user') {
        userIndex = cursor
        break
      }
    }
    const userMessage = userIndex >= 0 ? messages[userIndex] : null
    if (!userMessage || userMessage.role !== 'user') return
    void send(userMessage.content, userIndex)
  }

  async function handleUndo() {
    if (undoSnapshot === null || undoAppliedContent === null || isReplacing) return
    if (note.content !== undoAppliedContent) {
      setError('笔记内容已发生变化，已取消撤销，避免覆盖后续编辑。')
      setUndoSnapshot(null)
      setUndoAppliedContent(null)
      return
    }
    setIsReplacing(true)
    setError('')
    try {
      await onReplace(undoSnapshot)
      setUndoSnapshot(null)
      setUndoAppliedContent(null)
      setMessages((current) => [...current, { role: 'assistant', content: '↩ 已撤销本次 AI 修改，文档恢复到写入前版本。' }])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '撤销恢复失败。')
    } finally { setIsReplacing(false) }
  }

  async function copy(content: string, index: number) {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedMessage(index)
      setTimeout(() => setCopiedMessage((prev) => prev === index ? null : prev), 2200)
    } catch {
      setError('无法复制结果。')
    }
  }

  async function replace(content: string) {
    if (isReplacing || busy.current) return
    const previousContent = note.content
    if (!content.trim() || content === previousContent) return
    setIsReplacing(true)
    setError('')
    try {
      await onReplace(content)
      setUndoSnapshot(previousContent)
      setUndoAppliedContent(content)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法写入文档。') } finally { setIsReplacing(false) }
  }

  return <div
    className={`pi-assistant-backdrop ${layoutMode === 'docked' ? 'is-docked' : 'dialog-backdrop is-modal'}`}
    role="presentation"
    onClick={(event) => {
      if (layoutMode === 'modal' && event.target === event.currentTarget && !isReplacing) {
        onClose()
      }
    }}
  >
    <section ref={dialogRef} className={`pi-assistant-dialog ${layoutMode === 'docked' ? 'is-docked' : 'is-modal'}`} role="dialog" aria-modal={layoutMode === 'modal'} aria-labelledby="pi-assistant-title" onKeyDown={(event) => {
      if (event.key === 'Escape' && !isReplacing) {
        event.stopPropagation()
        if (isSkillsPanelOpen) { setIsSkillsPanelOpen(false); return }
        if (isHistoryMenuOpen) { setIsHistoryMenuOpen(false); return }
        onClose()
      }
      if (layoutMode === 'modal' && event.key === 'Tab') {
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), a[href]') || [])
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}>
      <header className="pi-dialog-header">
        <div ref={historyMenuRef} className="pi-dialog-title-switch-wrap">
        <button type="button" className="pi-dialog-title-switch" onClick={() => setIsHistoryMenuOpen((current) => !current)} disabled={isRunning || isReplacing} aria-label={`${activeHistoryTitle}，切换 AI 历史会话`} aria-expanded={isHistoryMenuOpen} title={`${activeHistoryTitle} · 点击切换会话`}>
          <span className="pi-dialog-title-group">
            <span className="pi-dialog-headings">
              <span className="pi-dialog-title-row">
                <span id="pi-assistant-title" className="pi-dialog-title-heading" role="heading" aria-level={2}>{activeHistoryTitle}</span>
                <ChevronDown size={13} aria-hidden="true" />
              </span>
            </span>
          </span>
        </button>
        {isHistoryMenuOpen ? <div className="pi-history-popover" role="listbox" aria-label="AI 历史会话">
          <div className="pi-history-popover-header"><strong>AI 历史会话 <span className="pi-history-count">{historyState.sessions.length}</span></strong><button type="button" className="pi-history-new" onClick={createHistoryConversation}><Plus size={12} />新建</button></div>
          <label className="pi-history-search"><Search size={13} /><input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="搜索会话或消息" aria-label="搜索 AI 历史会话" /></label>
          <div className="pi-history-list">{visibleHistorySessions.map((session) => <div role="option" aria-selected={session.id === historyState.activeId} className={`pi-history-item-row${session.id === historyState.activeId ? ' is-active' : ''}`} key={session.id}>
            <button type="button" className="pi-history-item" onClick={() => switchHistoryConversation(session)}>
              <span className="pi-history-item-title">{session.title}</span>
              <span className="pi-history-item-meta">{session.messages.length ? `${session.messages.length} 条消息` : '空对话'} · {new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(session.updatedAt || Date.now()))} · {session.source === 'ai-chat' ? 'AI 对话' : session.notePath || 'AI 助手'}</span>
            </button>
            <button type="button" className="icon-button compact pi-history-delete" onClick={() => deleteHistoryConversation(session)} disabled={isRunning || isReplacing} title={`删除对话：${session.title}`} aria-label={`删除对话：${session.title}`}><Trash2 size={13} /></button>
          </div>)}</div>
          {!visibleHistorySessions.length ? <p className="pi-history-empty">没有匹配的历史会话</p> : null}
        </div> : null}
        </div>
        <div className="pi-dialog-header-actions">
          {messages.length > 0 ? (
            <button
              className="icon-button compact pi-header-btn"
              onClick={createHistoryConversation}
              disabled={isRunning || isReplacing}
              aria-label="新建 AI 对话"
              title="新建 AI 对话"
            >
              <MessageCirclePlus size={16} aria-hidden="true" />
            </button>
          ) : null}
          <button
            className="icon-button compact pi-header-btn"
            onClick={toggleLayoutMode}
            disabled={isReplacing}
            aria-label={layoutMode === 'docked' ? '切换为居中浮窗' : '停靠为右侧边栏'}
            title={layoutMode === 'docked' ? '切换为居中浮窗' : '停靠为右侧边栏 (可并排查看文档)'}
          >
            {layoutMode === 'docked' ? <Maximize2 size={14} /> : <PanelRightClose size={14} />}
          </button>
          <button
            className="icon-button compact pi-close-button"
            onClick={onClose}
            disabled={isReplacing}
            aria-label="关闭 AI 助手"
            title="关闭 (Esc)"
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <div ref={chatRef} className="pi-chat" role="log" aria-label="与 AI 的对话" aria-live="polite">
        {messages.length === 0 ? (
          <div className="pi-chat-empty">
            <div className="pi-chat-empty-icon"><Sparkles size={24} /></div>
            <h3>需要我如何协助这篇笔记？</h3>
            <p>输入问题或修改指令，AI 将结合当前笔记上下文进行分析与处理。</p>
          </div>
        ) : null}
        {messages.map((message, index) => {
          const isCurrentStreaming = isRunning && index === messages.length - 1 && message.role === "assistant"
          const isRetryable = message.role === 'assistant' && message.kind === 'status' && /^(请求失败：|生成已停止。|AI 没有返回有效的文档内容|AI 没有生成可应用的变化)/.test(message.content)
          return (
            <div key={`${message.role}-${index}`} className={`pi-message pi-message-${message.role}`}>
              {message.role === "assistant" ? (
                <div className={`pi-message-avatar ${isCurrentStreaming && !message.content ? "spin-slow" : ""}`} aria-hidden="true">
                  <Sparkles size={13} />
                </div>
              ) : null}
              <div className="pi-message-body">
                <div className="pi-message-content">
                  {message.role === "assistant" && message.process && message.process.length > 0 ? (
                    <div className={`pi-execution-process${isCurrentStreaming ? ' is-running' : ''}`} aria-label="AI 执行过程">
                      <div className="pi-execution-process-heading"><Sparkles size={12} /><span>执行过程</span></div>
                      <ol>
                        {message.process.map((step, stepIndex) => (
                          <li key={`${step}-${stepIndex}`} className={isCurrentStreaming && stepIndex === message.process!.length - 1 ? 'is-active' : 'is-done'}>
                            <span className="pi-execution-process-marker">{isCurrentStreaming && stepIndex === message.process!.length - 1 ? <LoaderCircle size={11} className="spin" /> : <Check size={11} />}</span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                  {message.role === "assistant" && !message.content ? (
                    <div className="pi-thinking-pill">
                      <span className="pi-thinking-brain" aria-hidden="true">{message.withThinking ? "🧠" : "✨"}</span>
                      <span className="pi-thinking-dots"><span /><span /><span /></span>
                      <span>{message.withThinking ? "AI 正在深度思考并组织回答…" : "AI 正在思考并组织回答…"}</span>
                    </div>
                  ) : (
                    <>
                      {message.role === "assistant" && message.withThinking ? (
                        <div className="pi-thought-badge" title="本回答已通过深度思考模型生成">
                          <Brain size={11} />
                          <span>已深度思考</span>
                        </div>
                      ) : null}
                      {message.role === "assistant" && message.skills && message.skills.length > 0 ? (
                        <div className="pi-skill-tag-pill" title={`挂载技能: ${message.skills.join(', ')}`}>
                          <Puzzle size={10} />
                          <span>技能: {message.skills.slice(0, 2).join(', ')}{message.skills.length > 2 ? ` +${message.skills.length - 2}` : ''}</span>
                        </div>
                      ) : null}
                      {message.role === "assistant" && message.tools && message.tools.length > 0 ? (
                        <div className="pi-tools-used" title={`本次使用工具: ${message.tools.join('、')}`}>
                          <Settings2 size={10} />
                          <span>使用工具</span>
                          {message.tools.map((tool) => <span className="pi-tool-chip" key={tool}>{tool}</span>)}
                        </div>
                      ) : null}
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          pre: ({ children }) => {
                            const child = Array.isArray(children) ? children[0] : children
                            return isValidElement(child) ? cloneElement(child, { isBlock: true } as any) : <pre>{children}</pre>
                          },
                          code: (props) => <CodeBlockComponent {...props} />,
                          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
                          table: ({ children }) => <div className="table-wrap"><table>{children}</table></div>,
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                      {isCurrentStreaming ? (
                        <span className="pi-streaming-cursor" aria-hidden="true">▍</span>
                      ) : null}
                      {message.role === 'assistant' && message.sources && message.sources.length > 0 ? (
                        <div className="pi-source-list" aria-label="回答来源"><span>参考来源</span>{message.sources.map((source) => <span className="pi-source-chip" key={source} title={source}>{source}</span>)}</div>
                      ) : null}
                    </>
                  )}
                </div>
                {message.role === 'assistant' && editProposal && index === messages.length - 1 ? (
                  <section className="pi-edit-proposal" aria-label="文档修改建议">
                    <header className="pi-edit-proposal-header">
                      <div>
                        <strong>修改建议</strong>
                        <span>{editProposal.summary || 'AI 已生成文档修改，请检查前后内容后决定是否写入。'}</span>
                      </div>
                      <Sparkles size={14} aria-hidden="true" />
                    </header>
                    <div className="pi-edit-proposal-previews">
                      <details>
                        <summary>查看原文</summary>
                        <pre>{editProposal.snapshot}</pre>
                      </details>
                      <details open>
                        <summary>查看修改后内容</summary>
                        <pre>{editProposal.content}</pre>
                      </details>
                    </div>
                    <div className="pi-edit-proposal-actions">
                      <button type="button" className="pi-edit-proposal-accept" onClick={() => void applyEditProposal('replace', index)} disabled={isReplacing || isRunning}>
                        <Check size={13} />接受替换
                      </button>
                      <button type="button" onClick={() => void applyEditProposal('append', index)} disabled={isReplacing || isRunning}>
                        <ArrowRight size={13} />追加到文末
                      </button>
                      <button type="button" onClick={() => { setEditProposal(null); retryMessage(index) }} disabled={isReplacing || isRunning}>
                        <RefreshCw size={13} />重新生成
                      </button>
                      <button type="button" className="pi-edit-proposal-dismiss" onClick={() => discardEditProposal(index)} disabled={isReplacing || isRunning}>
                        <X size={13} />放弃
                      </button>
                    </div>
                  </section>
                ) : null}
                {message.role === "assistant" && message.content && !isCurrentStreaming && (message.kind !== 'status' || isRetryable) ? (
                  <div className="pi-message-actions">
                    {isRetryable ? (
                      <button
                        type="button"
                        onClick={() => retryMessage(index)}
                        disabled={isReplacing || isRunning}
                        title="使用相同指令重新生成"
                      >
                        <RefreshCw size={12} />
                        <span>重试</span>
                      </button>
                    ) : null}
                    {message.kind !== 'status' ? <>
                    <button
                      type="button"
                      className={copiedMessage === index ? "is-copied" : ""}
                      onClick={() => void copy(message.content, index)}
                      title="复制到剪贴板"
                    >
                      {copiedMessage === index ? <Check size={12} /> : <Copy size={12} />}
                      <span>{copiedMessage === index ? "已复制" : "复制"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void replace(message.content)}
                      disabled={isReplacing || isRunning}
                      title="立即将回答写入文档"
                    >
                      <FileText size={12} />
                      <span>写入文档</span>
                    </button>
                    </> : null}
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
        {showScrollToLatest ? <button type="button" className="pi-scroll-latest" onClick={scrollToLatest} aria-label="回到最新消息"><ChevronDown size={14} />回到最新</button> : null}
      </div>

      {error ? (
        <div className="pi-dialog-error" role="alert">
          <CircleAlert size={15} />
          <span>{error}</span>
        </div>
      ) : null}

      {undoSnapshot !== null ? (
        <div className="pi-undo-banner">
          <div className="pi-undo-text"><Sparkles size={13} /><span>AI 修改已写入文档</span></div>
          <button type="button" className="pi-undo-btn" onClick={() => void handleUndo()} disabled={isReplacing}>
            {isReplacing ? '正在还原…' : '撤销改动'}
          </button>
        </div>
      ) : null}



    <footer className="pi-composer-footer">
        <div className="pi-composer-shell">
          <ChatDocumentChips documents={selectedDocuments} disabled={isRunning || isReplacing} label="" onRemove={(document) => setSelectedDocuments((current) => current.filter((item) => chatDocumentKey(item) !== chatDocumentKey(document)))} />
          <textarea
            ref={composerRef}
            value={draft}
            maxLength={2000}
            rows={1}
            readOnly={isRunning || isReplacing}
            aria-label="发送给 AI 的指令或问题"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                event.preventDefault()
                void send()
              }
            }}
            placeholder="向 AI 提问当前笔记，或直接输入修改指令（如「第一行增加 123」、「润色正文」）…"
            autoFocus
          />
          <div className="pi-composer-bar">
            <div className="pi-composer-options">
              <ChatDocumentPicker connection={connection} vault={vaultName} documents={selectedDocuments} disabled={isRunning || isReplacing} onChange={setSelectedDocuments} onOpen={() => setIsSkillsPanelOpen(false)} iconOnly />
              <button
                type="button"
                className="pi-skills-toggle pi-icon-only-control"
                onClick={() => setIsSkillsPanelOpen((prev) => !prev)}
                aria-label="选择技能"
                title={enabledSkillIds.length > 0 ? `已挂载 ${enabledSkillIds.length} 个技能 (点击配置)` : '配置与挂载本地技能 (Skills)'}
              >
                <Puzzle size={12} />
              </button>
              <button
                type="button"
                className={`pi-thinking-toggle pi-icon-only-control ${isThinkingMode ? "is-active" : ""}`}
                onClick={toggleThinkingMode}
                aria-label={isThinkingMode ? "关闭深度思考" : "开启深度思考"}
                title={isThinkingMode ? "当前已开启深度思考：AI 将进行充分推演分析后再生成回答" : "点击开启深度思考模式"}
              >
                <Brain size={12} />
              </button>
              <div className="pi-model-picker" ref={modelPopoverRef}>
                <button
                  type="button"
                  className="ai-model-inline-trigger pi-model-trigger"
                  disabled={isRunning || isReplacing || modelsLoading}
                  onClick={() => setIsModelPopoverOpen((current) => !current)}
                  aria-label={`选择 AI 模型${selectedModel ? `：${chatModelLabel(selectedModel)}` : '：自动'}`}
                  title={`当前模型：${modelsLoading ? '加载中' : selectedModel ? chatModelLabel(selectedModel) : '自动'}，点击切换`}
                  aria-expanded={isModelPopoverOpen}
                >
                  <Bot size={14} />
                  <span>{modelsLoading ? '加载中…' : selectedModel ? chatModelLabel(selectedModel) : '自动'}</span>
                  <ChevronDown size={14} />
                </button>
                {isModelPopoverOpen ? (
                  <div className="ai-model-popover pi-model-popover" role="dialog" aria-label="选择模型">
                    <div className="ai-model-popover-heading">
                      <strong>选择模型</strong>
                      <button type="button" className="icon-button compact" onClick={() => setIsModelPopoverOpen(false)} aria-label="关闭模型选择"><X size={14} /></button>
                    </div>
                    <label className="ai-model-dialog-search">
                      <Search size={14} />
                      <input autoFocus value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder="搜索模型" aria-label="搜索模型" />
                    </label>
                    {modelsError ? <p className="ai-model-dialog-empty">{modelsError}</p> : (
                      <div className="ai-model-options">
                        <button type="button" className={`ai-model-option ${!selectedModel ? 'is-selected' : ''}`} onClick={() => changeModel('')}>
                          <div className="ai-model-option-mark">{!selectedModel ? '✓' : ''}</div>
                          <span><strong>自动</strong></span>
                        </button>
                        {Array.from(new Set(models.filter((model) => `${chatModelProviderLabel(model)} ${model.id}`.toLowerCase().includes(modelQuery.trim().toLowerCase())).map((model) => chatModelProviderLabel(model)))).map((provider) => (
                          <div className="ai-model-group" key={provider}>
                            <h3>{provider}</h3>
                            {models.filter((model) => chatModelProviderLabel(model) === provider && `${chatModelProviderLabel(model)} ${model.id}`.toLowerCase().includes(modelQuery.trim().toLowerCase())).map((model) => (
                              <button type="button" className={`ai-model-option ${chatModelKey(model) === selectedModelKey ? 'is-selected' : ''}`} key={chatModelKey(model)} onClick={() => changeModel(chatModelKey(model))}>
                                <div className="ai-model-option-mark">{chatModelKey(model) === selectedModelKey ? '✓' : ''}</div>
                                <span><strong>{chatModelLabel(model)}</strong>{chatModelLabel(model) !== model.id ? <small>{model.id}</small> : null}</span>
                              </button>
                            ))}
                          </div>
                        ))}
                        {!models.length ? <p className="ai-model-dialog-empty">暂无可用模型</p> : null}
                      </div>
                    )}
                    <button type="button" className="ai-model-popover-refresh" onClick={() => setModelsRevision((current) => current + 1)} disabled={isRunning || isReplacing}>刷新模型列表</button>
                  </div>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              className={`pi-send-button ${draft.trim() ? 'is-active' : ''}`}
              onClick={() => isRunning ? stopGeneration() : void send()}
              disabled={isReplacing || modelUnavailable || (!isRunning && !draft.trim())}
              aria-label={isRunning ? '停止生成' : '发送消息'}
              title={isRunning ? '停止生成' : '发送 (Enter)'}
            >
              {isRunning ? <span className="pi-stop-icon" aria-hidden="true" /> : <Send size={14} />}
            </button>
          </div>
        </div>
      </footer>

      {isSkillsPanelOpen ? (
        <div className="pi-skills-popover" role="region" aria-label="技能库挂载管理" onClick={(e) => e.stopPropagation()}>
          <div className="pi-skills-popover-header">
            <div className="pi-skills-header-info">
              <span className="pi-skills-header-icon" aria-hidden="true"><Puzzle size={14} /></span>
              <div className="pi-skills-header-text">
                <h4>技能库挂载 (Skills)</h4>
                <p>已启用 <strong>{enabledSkillIds.length}</strong> / {availableSkills.length} 个本地专业技能</p>
              </div>
            </div>
            <div className="pi-skills-header-actions">
              <button type="button" className="pi-skills-action-link" onClick={selectAllSkills}>全选</button>
              <button type="button" className="pi-skills-action-link" onClick={clearAllSkills} disabled={enabledSkillIds.length === 0}>清空</button>
              <button type="button" className="icon-button compact pi-skills-close-btn" onClick={(e) => { e.stopPropagation(); setIsSkillsPanelOpen(false) }} aria-label="关闭技能面板"><X size={14} /></button>
            </div>
          </div>

          <div className="pi-skills-filter-row">
            <div className="pi-skills-search-bar">
              <Search size={13} className="pi-skills-search-icon" />
              <input
                type="text"
                value={skillFilter}
                onChange={(e) => setSkillFilter(e.target.value)}
                placeholder="搜索技能名称或功能描述…"
                aria-label="搜索技能"
              />
              {skillFilter ? (
                <button type="button" className="pi-skills-clear-search" onClick={() => setSkillFilter('')} aria-label="清除搜索"><X size={12} /></button>
              ) : null}
            </div>
            <div className="pi-skills-cat-chips">
              {(['all', 'codex', 'agents', 'system'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`pi-skills-cat-chip ${skillCategory === cat ? 'is-active' : ''}`}
                  onClick={() => setSkillCategory(cat)}
                >
                  {cat === 'all' ? '全部' : cat === 'codex' ? 'Codex' : cat === 'agents' ? 'Agents' : '系统'}
                </button>
              ))}
            </div>
          </div>

          <div className="pi-skills-presets">
            <span className="pi-skills-presets-label">推荐组合:</span>
            <button
              type="button"
              className="pi-skills-preset-chip"
              onClick={() => applySkillBundle(['ui-ux-pro-max', 'impeccable', 'frontend-style-maintenance'])}
            >
              🎨 UI/UX 增强
            </button>
            <button
              type="button"
              className="pi-skills-preset-chip"
              onClick={() => applySkillBundle(['karpathy-guidelines', 'executing-plans', 'writing-plans'])}
            >
              📐 严谨规范
            </button>
            <button
              type="button"
              className="pi-skills-preset-chip"
              onClick={() => applySkillBundle(['admin-table-design'])}
            >
              📊 后台与表格
            </button>
          </div>

          <div className="pi-skills-list-container">
            {filteredSkills.length === 0 ? (
              <div className="pi-skills-empty">
                <p>未找到匹配的技能</p>
              </div>
            ) : (
              filteredSkills.map((skill) => {
                const isSelected = enabledSkillIds.includes(skill.id)
                return (
                  <div
                    key={skill.id}
                    className={`pi-skill-item-card ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => toggleSkill(skill.id)}
                  >
                    <div className="pi-skill-item-header">
                      <div className="pi-skill-checkbox-wrapper">
                        <span className={`pi-skill-checkbox-box ${isSelected ? 'is-checked' : ''}`}>
                          {isSelected ? '✓' : ''}
                        </span>
                      </div>
                      <strong className="pi-skill-item-name">{skill.name}</strong>
                      <span className={`pi-skill-source-tag is-${skill.source}`}>
                        {skill.source === 'workspace' ? '项目' : skill.source === 'custom' ? '自定义' : skill.source}
                      </span>
                      {propInspectSkill ? (
                        <button
                          type="button"
                          className="pi-skill-detail-btn"
                          title="查看技能详细文档"
                          onClick={(e) => {
                            e.stopPropagation()
                            propInspectSkill(skill)
                          }}
                        >
                          <Eye size={13} />
                        </button>
                      ) : null}
                    </div>
                    {skill.description ? (
                      <p className="pi-skill-item-desc" title={skill.description}>
                        {skill.description}
                      </p>
                    ) : null}
                  </div>
                )
              })
            )}
          </div>

          <div className="pi-skills-popover-footer">
            <span>勾选的技能将在提问与修改正文时自动加载给 AI 模型。</span>
          </div>
        </div>
      ) : null}
    </section>
  </div>
}



interface CuratedSkillMarketItem {
  name: string
  title: string
  description: string
  category: 'dev' | 'writing' | 'office' | 'arch'
  tag: string
  author: string
  version: string
  content: string
}

const CURATED_NETWORK_SKILLS: CuratedSkillMarketItem[] = [
  {
    name: 'code-reviewer',
    title: '代码审查与架构重构指导',
    description: '深度审查代码安全性、性能瓶颈、潜在内存泄漏与异味，并提供工业级重构优化对比。',
    category: 'dev',
    tag: '代码开发',
    author: 'Codex Team',
    version: '1.2.0',
    content: `# 代码审查与重构规范 (Code Reviewer)

当用户提供代码片段或要求审查代码时执行以下分析：

## 1. 核心审查维度
- **安全性 (Security)**：排查 SQL 注入、XSS、未授权访问、硬编码密钥与敏感信息泄漏。
- **性能与并发 (Performance)**：检查高开销循环嵌套、未缓存查询、并发竞争与锁粒度。
- **架构健壮性 (Robustness)**：遵循单一职责与开闭原则，合理设计异常降级与边界防御。

## 2. 结构化输出要求
- **风险评级与问题概要**：分为高危、中危、建议优化三个层级。
- **重构后代码**：提供符合工业级规范的完整重构代码块，关键改动附带行内说明。
- **优化对比**：清晰说明前后性能与维护成本收益。
`,
  },
  {
    name: 'tech-translator',
    title: '专业技术文档双语翻译',
    description: '面向中英文技术文档的高保真翻译，保护技术专有名词、代码块与 Markdown 链接。',
    category: 'writing',
    tag: '文档翻译',
    author: 'i18n Community',
    version: '1.1.0',
    content: `# 专业技术文档双语翻译规范 (Tech Translator)

当用户需要翻译技术文章、API 文档或技术规范时遵循：

## 1. 翻译准则
- **专有名词保护**：保留通用技术术语（如 Runtime, Goroutine, Middleware, SSE, Virtual DOM, Vector DB）。
- **结构与代码保护**：严禁翻译代码块、文件路径、URL 锚点及 Frontmatter 元数据。
- **信达雅**：采用中文技术社区自然的行文习惯，严禁机器翻译生硬腔调。
`,
  },
  {
    name: 'weekly-reporter',
    title: '结构化工作周报与进展汇报',
    description: '将琐碎的工作笔记、代码提交与任务清单快速提炼为高管友好的结构化周报。',
    category: 'office',
    tag: '效能办公',
    author: 'Agile Ops',
    version: '1.0.0',
    content: `# 结构化工作周报规范 (Weekly Reporter)

当用户要求整理本周工作或生成周报时遵循：

## 1. 周报结构
- **本周重点成果 (Highlights)**：列出 2-3 个核心交付物与关键业务价值。
- **任务进展明细 (Task Breakdown)**：按项目维度罗列已完成事项与进展百分比。
- **风险与阻塞点 (Risks & Blockers)**：若有阻碍及时暴露并提供切实可行的解决方案。
- **下周计划 (Next Week Plan)**：明确列出下周预计完成的目标与前置依赖。
`,
  },
  {
    name: 'commit-spec',
    title: 'Conventional Commits 提交规范生成',
    description: '根据代码改动或工作描述，自动生成标准的 feat/fix/docs/refactor 格式提交信息。',
    category: 'dev',
    tag: '工程规范',
    author: 'Git Workflow',
    version: '1.0.2',
    content: `# Git Commit 规范生成器 (Commit Spec)

根据用户提供的改动描述生成符合 Conventional Commits 规范的提交信息：

## 1. 提交格式
\`<type>(<scope>): <subject>\`

- **feat**: 新增功能特性
- **fix**: 修复缺陷或 Bug
- **docs**: 仅涉及文档变动
- **refactor**: 重构（既非新增特性也非修复缺陷）
- **perf**: 提升性能的代码改动
- **test**: 增加或完善测试用例
- **chore**: 构建流程或工具配置变动
`,
  },
  {
    name: 'sql-optimizer',
    title: 'SQL 查询与索引调优顾问',
    description: '分析复杂 SQL 语句、解析 EXPLAIN 执行计划、识别全表扫描并提供高性能索引设计建议。',
    category: 'arch',
    tag: '数据库',
    author: 'DBA Squad',
    version: '1.1.0',
    content: `# SQL 查询与索引调优顾问 (SQL Optimizer)

当用户提供 SQL 语句或查询慢日志时执行：

## 1. 调优策略
- **执行计划解读**：重点排查 ALL 全表扫描、Using filesort、Using temporary。
- **复合索引设计**：严格遵循最左匹配原则，合理安排过滤列与排序列顺序。
- **分页性能优化**：大偏移量分页（LIMIT offset, count）改写为延迟关联或子查询。
`,
  },
  {
    name: 'prompt-craftsman',
    title: '大模型 Prompt 提示词优化专家',
    description: '将用户的模糊口语需求重构为包含角色定义、背景、约束、少样本提示的高质量 Prompt。',
    category: 'office',
    tag: 'Prompt工程',
    author: 'PromptHub',
    version: '2.0.0',
    content: `# Prompt 提示词优化专家 (Prompt Craftsman)

当用户输入一段简短要求让优化为完整 Prompt 时执行：

## 1. 提示词工程结构
- **Role (角色定义)**：赋予模型专业背景与身份。
- **Context & Goal (背景与目标)**：说明任务上下文和期望解决的核心问题。
- **Workflow & Rules (工作流与约束)**：分步骤指导执行，明确负向约束 (Negative Constraints)。
- **Output Format (输出格式)**：指定 JSON, Markdown 表格或结构化标题形式。
`,
  },
  {
    name: 'api-designer',
    title: 'RESTful / OpenAPI 接口设计顾问',
    description: '指导设计符合业界最高标准的高可用、幂等、安全、版本化的 HTTP API 接口规范。',
    category: 'arch',
    tag: '架构设计',
    author: 'API Guild',
    version: '1.0.1',
    content: `# RESTful API 接口设计规范 (API Designer)

设计或评审 HTTP API 接口时执行：

## 1. 资源命名与动词规范
- 统一使用复数名词表示资源集合（如 /api/v1/users）。
- 严禁在 URI 中出现动词，使用 GET/POST/PUT/PATCH/DELETE 表意。
- 涉及批量、状态流转（如发布、归档）采用子资源或特定动宾动词（/api/v1/articles/:id/publish）。

## 2. 响应格式与错误码
- 统一业务包裹结构（code, message, data, timestamp）。
- 错误信息包含具体错误码 (err_code) 与可供排错的 trace_id。
`,
  },
  {
    name: 'meeting-minutes',
    title: '会议纪要与行动项 (Action Items) 提炼',
    description: '快速将口语化会议记录、讨论稿提炼为目标明确、责任到人、截止时间清晰的高效纪要。',
    category: 'office',
    tag: '会议纪要',
    author: 'Productivity Labs',
    version: '1.0.0',
    content: `# 会议纪要与行动项提炼 (Meeting Minutes)

当用户输入会议文字记录或讨论内容时执行：

## 1. 纪要结构
- **会议主题与参会人**：提炼会议核心议题。
- **核心结论与共识**：列出会议达成一致的决策，避免冗长争论细节。
- **行动项表格 (Action Items)**：
  | 待办事项 | 负责人 | 期望完成时间 | 验收标准 |
`,
  },
]

function InstallSkillDialog({
  availableSkills,
  onClose,
  onInstalled,
}: {
  availableSkills: SkillItem[]
  onClose: () => void
  onInstalled: (skill: SkillItem, allSkills: SkillItem[]) => void
}) {
  const [tab, setTab] = useState<'market' | 'custom'>('market')
  const [marketCategory, setMarketCategory] = useState<string>('all')
  const [marketSearch, setMarketSearch] = useState('')
  const [previewSkill, setPreviewSkill] = useState<CuratedSkillMarketItem | null>(null)

  const [customName, setCustomName] = useState('')
  const [customTitle, setCustomTitle] = useState('')
  const [customDesc, setCustomDesc] = useState('')
  const [customContent, setCustomContent] = useState('')

  const [installingKey, setInstallingKey] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (previewSkill) setPreviewSkill(null)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, previewSkill])

  async function handleInstallMarketItem(item: CuratedSkillMarketItem) {
    setInstallingKey(item.name)
    setError('')
    try {
      const res = await installSkill({
        name: item.name,
        title: item.title,
        description: item.description,
        content: item.content,
      })
      onInstalled(res.skill, res.skills)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '安装失败')
    } finally {
      setInstallingKey(null)
    }
  }

  async function handleInstallCustom(e: React.FormEvent) {
    e.preventDefault()
    const name = customName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
    if (!name) {
      setError('请输入英文技能标识（仅允许字母、数字和短横线）')
      return
    }
    if (!customContent.trim()) {
      setError('请输入技能规范 Markdown 内容')
      return
    }
    setInstallingKey(name)
    setError('')
    try {
      const res = await installSkill({
        name,
        title: customTitle.trim() || undefined,
        description: customDesc.trim() || undefined,
        content: customContent.trim(),
      })
      onInstalled(res.skill, res.skills)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '安装失败')
    } finally {
      setInstallingKey(null)
    }
  }

  const filteredMarketSkills = useMemo(() => {
    return CURATED_NETWORK_SKILLS.filter((item) => {
      if (marketCategory !== 'all' && item.category !== marketCategory) return false
      if (marketSearch.trim()) {
        const q = marketSearch.toLowerCase()
        return (
          item.name.toLowerCase().includes(q) ||
          item.title.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.tag.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [marketCategory, marketSearch])

  return (
    <div className="dialog-backdrop install-skill-backdrop" role="presentation" onClick={onClose}>
      <section
        className="install-skill-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="联网技能中心"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="install-skill-header">
          <div className="install-skill-title-row">
            <div className="install-skill-icon-box">
              <Puzzle size={20} />
            </div>
            <div>
              <h2 className="install-skill-title">联网技能中心 (Online Skills Hub)</h2>
              <p className="install-skill-sub">探索云端与开源技能市场，一键联网挂载专业工作流</p>
            </div>
          </div>
          <button type="button" className="icon-button compact" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <div className="install-skill-tabs">
          <button
            type="button"
            className={`install-tab-btn ${tab === 'market' ? 'is-active' : ''}`}
            onClick={() => { setTab('market'); setError('') }}
          >
            🌐 联网技能市场 ({CURATED_NETWORK_SKILLS.length})
          </button>
          <button
            type="button"
            className={`install-tab-btn ${tab === 'custom' ? 'is-active' : ''}`}
            onClick={() => { setTab('custom'); setError('') }}
          >
            ✍️ 自定义编写技能
          </button>
        </div>

        {error ? <div className="install-skill-error">{error}</div> : null}

        <div className="install-skill-body">
          {tab === 'market' ? (
            <div className="market-view-wrapper">
              <div className="market-filter-bar">
                <div className="market-search-box">
                  <Search size={14} className="market-search-icon" />
                  <input
                    type="text"
                    placeholder="搜索联网技能名称、分类或描述..."
                    value={marketSearch}
                    onChange={(e) => setMarketSearch(e.target.value)}
                  />
                  {marketSearch ? (
                    <button type="button" className="market-search-clear" onClick={() => setMarketSearch('')}>
                      <X size={12} />
                    </button>
                  ) : null}
                </div>
                <div className="market-cat-pills">
                  {[
                    { id: 'all', label: '全部' },
                    { id: 'dev', label: '开发编程' },
                    { id: 'writing', label: '文本创作' },
                    { id: 'office', label: '效能办公' },
                    { id: 'arch', label: '架构规范' },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      className={`market-cat-pill ${marketCategory === cat.id ? 'is-active' : ''}`}
                      onClick={() => setMarketCategory(cat.id)}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {previewSkill ? (
                <div className="market-preview-pane">
                  <div className="market-preview-header">
                    <div className="market-preview-title-row">
                      <strong className="market-preview-name">{previewSkill.name}</strong>
                      <span className="curated-skill-tag">{previewSkill.tag}</span>
                      <span className="market-preview-version">v{previewSkill.version}</span>
                    </div>
                    <button
                      type="button"
                      className="secondary-button compact"
                      onClick={() => setPreviewSkill(null)}
                    >
                      返回列表
                    </button>
                  </div>
                  <div className="markdown-body market-preview-content">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        pre: ({ children }) => {
                          const child = Array.isArray(children) ? children[0] : children
                          return isValidElement(child) ? cloneElement(child, { isBlock: true } as any) : <pre>{children}</pre>
                        },
                        code: (props) => <CodeBlockComponent {...props} />,
                      }}
                    >{previewSkill.content}</ReactMarkdown>
                  </div>
                  <div className="market-preview-footer">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setPreviewSkill(null)}
                    >
                      返回列表
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={availableSkills.some((s) => s.key === previewSkill.name || s.name === previewSkill.name) || Boolean(installingKey)}
                      onClick={() => void handleInstallMarketItem(previewSkill)}
                    >
                      {availableSkills.some((s) => s.key === previewSkill.name || s.name === previewSkill.name) ? '已在本地安装' : '立即安装此技能'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="curated-skills-list">
                  {filteredMarketSkills.map((item) => {
                    const isInstalled = availableSkills.some((s) => s.key === item.name || s.name === item.name)
                    const isCurrentInstalling = installingKey === item.name
                    return (
                      <div key={item.name} className={`curated-skill-card ${isInstalled ? 'is-installed' : ''}`}>
                        <div className="curated-skill-info">
                          <div className="curated-skill-top-row">
                            <strong className="curated-skill-name">{item.name}</strong>
                            <span className="curated-skill-tag">{item.tag}</span>
                            <span className="curated-skill-author">by {item.author}</span>
                          </div>
                          <h3 className="curated-skill-title-text">{item.title}</h3>
                          <p className="curated-skill-desc">{item.description}</p>
                          <div className="curated-skill-bottom-row">
                            <button
                              type="button"
                              className="curated-skill-preview-link"
                              onClick={() => setPreviewSkill(item)}
                            >
                              <Eye size={12} /> 查看规范预览
                            </button>
                          </div>
                        </div>
                        <div className="curated-skill-action">
                          {isInstalled ? (
                            <span className="curated-installed-badge">
                              <Check size={14} /> 已安装
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="primary-button install-btn"
                              disabled={Boolean(installingKey)}
                              onClick={() => void handleInstallMarketItem(item)}
                            >
                              {isCurrentInstalling ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}
                              一键安装
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={(e) => void handleInstallCustom(e)} className="custom-skill-form">
              <div className="form-group">
                <label>技能唯一标识 (ID / 目录名) <span className="req">*</span></label>
                <input
                  type="text"
                  placeholder="例如: api-designer (英文、数字、短横线)"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  required
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>显示名称 (可选)</label>
                  <input
                    type="text"
                    placeholder="例如: RESTful API 设计规范"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>简要描述 (可选)</label>
                  <input
                    type="text"
                    placeholder="一句话介绍技能核心职责"
                    value={customDesc}
                    onChange={(e) => setCustomDesc(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>SKILL.md 规范内容 (Markdown) <span className="req">*</span></label>
                <textarea
                  rows={8}
                  placeholder="# 技能规范名称\n\n当用户要求进行 XX 时，严格按照以下步骤执行：\n- 规则 1\n- 规则 2"
                  value={customContent}
                  onChange={(e) => setCustomContent(e.target.value)}
                  required
                />
              </div>
              <div className="form-actions">
                <button type="button" className="secondary-button" onClick={onClose}>取消</button>
                <button type="submit" className="primary-button" disabled={Boolean(installingKey)}>
                  {installingKey ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}
                  保存并安装
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  )
}

function RenameDocumentDialog({ note, onClose, onRename }: { note: { path: string; kind?: string }; onClose: () => void; onRename: (path: string) => Promise<void> }) {
  const [path, setPath] = useState(note.path)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState("")

  async function save() {
    const nextPath = normalizeDocumentPath(path)
    if (!nextPath) {
      setError("请填写新的文档路径。")
      return
    }
    if (nextPath === note.path) {
      onClose()
      return
    }
    setIsSaving(true)
    setError("")
    try {
      await onRename(nextPath)
      onClose()
    } catch (reason) {
      setError(reason instanceof FnsApiError ? reason.message : "重命名失败。")
    } finally {
      setIsSaving(false)
    }
  }

  const isFile = note.kind === "file"

  return (
    <div className="dialog-backdrop" role="presentation">
      <form className="connection-dialog compact-dialog" onSubmit={(event) => { event.preventDefault(); void save() }} role="dialog" aria-modal="true" aria-labelledby="rename-title">
        <div className="dialog-heading">
          <div>
            <p>{isFile ? "文件操作" : "文档操作"}</p>
            <h2 id="rename-title">重命名{isFile ? "文件" : "文档"}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭重命名"><X size={18} /></button>
        </div>
        <label>
          新路径
          <input value={path} onChange={(event) => setPath(event.target.value)} autoFocus />
        </label>
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose}>取消</button>
          <button className="primary-button" disabled={isSaving}>{isSaving ? "正在重命名" : "确认重命名"}</button>
        </div>
      </form>
    </div>
  )
}

function DeleteDocumentDialog({ note, onClose, onDelete }: { note: { path: string; kind?: string; name?: string }; onClose: () => void; onDelete: () => Promise<void> }) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState("")

  async function remove() {
    setIsDeleting(true)
    setError("")
    try {
      await onDelete()
      onClose()
    } catch (reason) {
      setError(reason instanceof FnsApiError ? reason.message : "删除失败。")
    } finally {
      setIsDeleting(false)
    }
  }

  const isFolder = note.kind === "folder"
  const title = note.name || documentTitle(note.path)

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="connection-dialog compact-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <div className="dialog-heading">
          <div>
            <p>{isFolder ? "目录操作" : note.kind === "file" ? "文件操作" : "文档操作"}</p>
            <h2 id="delete-title">删除{isFolder ? "目录" : note.kind === "file" ? "文件" : "文档"}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭删除确认"><X size={18} /></button>
        </div>
        <p className="dialog-copy">
          {isFolder ? `“${title}” 目录及其内部所有内容将被删除。` : `“${title}” 将移入回收站。` }
        </p>
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose}>取消</button>
          <button type="button" className="danger-button" onClick={() => void remove()} disabled={isDeleting}>{isDeleting ? "正在删除" : "确认删除"}</button>
        </div>
      </section>
    </div>
  )
}

function ShareDialog({ connection, vaultName, note, onClose }: { connection: Connection; vaultName: string; note: Note; onClose: () => void }) {
  const [share, setShare] = useState<Share | null>(null)
  const [password, setPassword] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [isChecking, setIsChecking] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isCreatingShortLink, setIsCreatingShortLink] = useState(false)
  const [copied, setCopied] = useState<'link' | 'short' | ''>('')
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [error, setError] = useState('')
  const shareUrl = share ? publicShareUrl(share) : ''

  useEffect(() => {
    let isActive = true
    setIsChecking(true)
    setError('')
    void fnsApi.queryShare(connection, vaultName, note.path, note.pathHash)
      .then((currentShare) => {
        if (!isActive) return
        setShare(currentShare)
        setExpiresOn(dateInputValue(currentShare.expiresAt))
      })
      .catch(() => {
        if (isActive) setShare(null)
      })
      .finally(() => {
        if (isActive) setIsChecking(false)
      })
    return () => { isActive = false }
  }, [connection, note.path, note.pathHash, vaultName])

  async function save() {
    setIsSaving(true)
    setError('')
    try {
      const payload = {
        vault: vaultName,
        path: note.path,
        pathHash: note.pathHash,
        password,
        expireAt: expireAtFromDate(expiresOn),
      }
      if (share) {
        await fnsApi.updateSharePassword(connection, payload)
        const refreshedShare = await fnsApi.queryShare(connection, vaultName, note.path, note.pathHash)
        setShare(refreshedShare)
      } else {
        setShare(await fnsApi.createShare(connection, payload))
      }
      setPassword('')
      setConfirmingCancel(false)
    } catch (reason) {
      setError(reason instanceof FnsApiError ? reason.message : '保存分享设置失败。')
    } finally {
      setIsSaving(false)
    }
  }

  async function copy(value: string, kind: 'link' | 'short') {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      window.setTimeout(() => setCopied(''), 1600)
    } catch {
      setError('无法访问剪贴板，请手动复制链接。')
    }
  }

  async function createShortLink() {
    if (!share || !shareUrl) return
    setIsCreatingShortLink(true)
    setError('')
    try {
      const shortLink = await fnsApi.createShortLink(connection, { vault: vaultName, path: note.path, pathHash: note.pathHash, url: shareUrl })
      setShare({ ...share, shortLink })
    } catch (reason) {
      setError(reason instanceof FnsApiError ? reason.message : '生成短链接失败。')
    } finally {
      setIsCreatingShortLink(false)
    }
  }

  async function cancelShare() {
    if (!share) return
    if (!confirmingCancel) {
      setConfirmingCancel(true)
      return
    }
    setIsSaving(true)
    setError('')
    try {
      await fnsApi.cancelShare(connection, { vault: vaultName, path: note.path, pathHash: note.pathHash })
      setShare(null)
      setPassword('')
      setExpiresOn('')
      setConfirmingCancel(false)
    } catch (reason) {
      setError(reason instanceof FnsApiError ? reason.message : '取消分享失败。')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="connection-dialog share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <div className="dialog-heading">
          <div>
            <p>文档分享</p>
            <h2 id="share-title">{documentTitle(note.path)}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭分享"><X size={18} /></button>
        </div>
        {isChecking ? <p className="dialog-copy dialog-loading"><LoaderCircle className="spin" size={16} />正在检查分享状态</p> : null}
        {!isChecking && share ? (
          <div className="share-status">
            <span className="status-pill"><KeyRound size={14} />{share.isPassword ? '访问密码保护中' : '任何持有链接的人可访问'}</span>
            <label>
              分享链接
              <div className="copy-field"><input value={shareUrl} readOnly aria-label="分享链接" /><button type="button" className="icon-button" onClick={() => void copy(shareUrl, 'link')} aria-label="复制分享链接" title="复制分享链接">{copied === 'link' ? <Check size={17} /> : <Copy size={17} />}</button></div>
            </label>
            {share.shortLink ? <label>短链接<div className="copy-field"><input value={share.shortLink} readOnly aria-label="短链接" /><button type="button" className="icon-button" onClick={() => void copy(share.shortLink || '', 'short')} aria-label="复制短链接" title="复制短链接">{copied === 'short' ? <Check size={17} /> : <Copy size={17} />}</button></div></label> : null}
          </div>
        ) : null}
        {!isChecking ? (
          <>
            <label>
              访问密码
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder={share?.isPassword ? '输入新密码以更新，留空移除密码' : '留空表示不设密码'} autoComplete="new-password" />
            </label>
            <label>
              过期时间
              <input value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} type="date" min={new Date().toISOString().slice(0, 10)} />
            </label>
          </>
        ) : null}
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        {!isChecking ? (
          <div className="dialog-actions share-actions">
            {share ? <button type="button" className="secondary-button" onClick={() => void createShortLink()} disabled={isSaving || isCreatingShortLink}>{isCreatingShortLink ? '生成中' : '生成短链接'}</button> : null}
            {share ? <button type="button" className="danger-button" onClick={() => void cancelShare()} disabled={isSaving}>{confirmingCancel ? '确认取消分享' : '取消分享'}</button> : null}
            <button type="button" className="primary-button" onClick={() => void save()} disabled={isSaving}>{isSaving ? '正在保存' : share ? '更新分享' : '创建分享'}</button>
          </div>
        ) : null}
      </section>
    </div>
  )
}

export default function App() {
  const initialWorkspaceState = useRef(loadWorkspaceState())
  const [connection, setConnection] = useState<Connection>(loadConnection)
  const [authState, setAuthState] = useState<AuthState>(() => getDesktopRuntime().isLocal ? 'authenticated' : connection.user && connection.token ? 'checking' : 'signed-out')
  const [settings, setSettings] = useState<SystemSettings>(loadSystemSettings)
  const [showSettings, setShowSettings] = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  const [showCreateVault, setShowCreateVault] = useState(false)
  const [editorMode, setEditorMode] = useState<'create' | null>(null)
  const [isLocked, setIsLocked] = useState(false)
  const [showRename, setShowRename] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [showPiAssistant, setShowPiAssistant] = useState(false)
  const [inlineAiRequest, setInlineAiRequest] = useState<InlineAiRequest | null>(null)
  const [activeTreeMenu, setActiveTreeMenu] = useState<TreeMenuState | null>(null)
  const [documentIcons, setDocumentIcons] = useState<DocumentIconMap>(() => loadDocumentIcons(configStorage))
  const [iconPickerTarget, setIconPickerTarget] = useState<IconPickerTarget | null>(null)
  const [uploadTargetFolder, setUploadTargetFolder] = useState<string | null>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const [isCoverBusy, setIsCoverBusy] = useState(false)
  const [createFolderParentPath, setCreateFolderParentPath] = useState<string | null>(null)
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<string | null>(null)
  const [renameItemTarget, setRenameItemTarget] = useState<LibraryItem | null>(null)
  const [inlineRenamingPath, setInlineRenamingPath] = useState<string | null>(null)
  const [inlineRenamingDraft, setInlineRenamingDraft] = useState("")
  const [isReaderRenaming, setIsReaderRenaming] = useState(false)
  const [editorSaveStatusTarget, setEditorSaveStatusTarget] = useState<HTMLSpanElement | null>(null)
  const [readerRenamingDraft, setReaderRenamingDraft] = useState("")
  const [deleteItemTarget, setDeleteItemTarget] = useState<LibraryItem | null>(null)
  const [moveItemTarget, setMoveItemTarget] = useState<LibraryItem | null>(null)
  const [shareItemTarget, setShareItemTarget] = useState<Note | null>(null)
  const [createInitialPath, setCreateInitialPath] = useState<string | null>(null)
  const [vaults, setVaults] = useState<Vault[]>([])
  const [vaultName, setVaultName] = useState('')
  const [notes, setNotes] = useState<LibraryItem[]>([])
  const [folderNotes, setFolderNotes] = useState<Record<string, LibraryItem[]>>({})
  const [tree, setTree] = useState<FolderNode[]>([])
  const [folderPath, setFolderPath] = useState(initialWorkspaceState.current.folderPath)
  const [expandedFolders, setExpandedFolders] = useState<string[]>(initialWorkspaceState.current.expandedFolders)
  const [selectedNote, setSelectedNote] = useState<Note | null>(null)
  const [selectedFile, setSelectedFile] = useState<FileSummary | null>(null)
  useEffect(() => {
    setInlineAiRequest(null)
  }, [selectedNote?.path])
  const [openTabs, setOpenTabs] = useState<DocumentTab[]>([])
  const [activeTabKey, setActiveTabKey] = useState('')
  const [activeHeadingId, setActiveHeadingId] = useState('')
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<LibraryItem[] | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isDocumentLoading, setIsDocumentLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(settings.sidebarOpen)
  const [navigationCollapsed, setNavigationCollapsed] = useState(false)
  const [directorySort, setDirectorySort] = useState<DirectorySortMode>(settings.directorySort)
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false)
  const [isDocumentActionMenuOpen, setIsDocumentActionMenuOpen] = useState(false)
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const [favorites, setFavorites] = useState<LocalDocumentRef[]>(() => loadLocalRefs(FAVORITES_STORAGE_KEY))
  const [recents, setRecents] = useState<LocalDocumentRef[]>(() => loadLocalRefs(RECENTS_STORAGE_KEY))
  const [quickLinksOpen, setQuickLinksOpen] = useState<QuickLinksState>(loadQuickLinksState)
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>(initialWorkspaceState.current.activeSidebarTab || 'files')
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [taskDocuments, setTaskDocuments] = useState<string[]>([])
  const [taskScope, setTaskScope] = useState('')
  const [taskStatus, setTaskStatus] = useState<'all' | 'open' | 'done'>('all')
  const [taskQuery, setTaskQuery] = useState('')
  const [isTaskLoading, setIsTaskLoading] = useState(false)
  const [taskProgress, setTaskProgress] = useState('等待扫描')
  const [taskMarkdownEdit, setTaskMarkdownEdit] = useState<TaskMarkdownEditState | null>(null)
  const taskMarkdownEditRequest = useRef(0)
  const [availableSkills, setAvailableSkills] = useState<SkillItem[]>([])
  const [enabledSkillIds, setEnabledSkillIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('fns-pi-enabled-skills')
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string')
      }
    } catch {}
    return []
  })
  const [sidebarSkillFilter, setSidebarSkillFilter] = useState('')
  const [sidebarSkillCategory, setSidebarSkillCategory] = useState<string>('all')
  const [showInstallSkill, setShowInstallSkill] = useState(false)
  const [activeSkill, setActiveSkill] = useState<SkillItem | null>(null)
  const [activePlatformPlugin, setActivePlatformPlugin] = useState<PlatformPluginId | null>(null)
  const [copiedSkillPath, setCopiedSkillPath] = useState(false)

  function getIcon(kind: DocumentIconKind, path: string, vault = vaultName) {
    return getDocumentIconFromMap(documentIcons, vault, kind, path)
  }

  async function openLocalFolder() {
    const runtime = getDesktopRuntime()
    if (!runtime.isLocal || !runtime.openLocalFolder) return
    try {
      const result = await runtime.openLocalFolder()
      if (result) window.location.reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '切换本地工作空间失败，请稍后重试。')
    }
  }

  function chooseDocumentIcon(kind: DocumentIconKind, path: string, icon?: string, vault = vaultName) {
    const next = writeDocumentIcon(documentIcons, vault, kind, path, icon)
    if (next === documentIcons) {
      if (icon) setError('请输入一个有效的表情符号。')
      return
    }
    if (!persistDocumentIcons(configStorage, next)) {
      setError('图标偏好无法保存，已恢复当前显示。')
      return
    }
    setDocumentIcons(next)
    setIconPickerTarget(null)
  }

  function migrateIcon(kind: DocumentIconKind, previousPath: string, nextPath: string) {
    const next = migrateDocumentIconInMap(documentIcons, vaultName, kind, previousPath, nextPath)
    if (next === documentIcons) return
    if (persistDocumentIcons(configStorage, next)) setDocumentIcons(next)
    else setError('图标偏好无法保存。')
  }

  function removeIconsUnderPath(path: string) {
    const next = removeDocumentIconsUnderPath(documentIcons, vaultName, path)
    if (next === documentIcons) return
    if (persistDocumentIcons(configStorage, next)) setDocumentIcons(next)
    else setError('图标偏好无法保存。')
  }

  useEffect(() => {
    let isMounted = true
    void getAvailableSkills(connection).then((items) => {
      if (!isMounted) return
      setAvailableSkills(items)
      const stored = localStorage.getItem('fns-pi-enabled-skills')
      if (stored) {
        try {
          const parsed = JSON.parse(stored)
          if (Array.isArray(parsed)) {
            // Filter out stale skill IDs that no longer exist in availableSkills
            const valid = parsed.filter((id: string) => items.some((s) => s.id === id))
            setEnabledSkillIds(valid)
            localStorage.setItem('fns-pi-enabled-skills', JSON.stringify(valid))
          }
        } catch {}
      } else if (items.length > 0) {
        const defaults = items.filter((s) => ['markdown-polisher', 'doc-summary'].includes(s.key || s.name)).map((s) => s.id)
        if (defaults.length > 0) {
          setEnabledSkillIds(defaults)
          localStorage.setItem('fns-pi-enabled-skills', JSON.stringify(defaults))
        }
      }
    }).catch(() => {})
    return () => { isMounted = false }
  }, [connection.baseUrl, connection.clientType, connection.token])

  function toggleSkill(skillId: string) {
    setEnabledSkillIds((current) => {
      const next = current.includes(skillId) ? current.filter((id) => id !== skillId) : [...current, skillId]
      try { localStorage.setItem('fns-pi-enabled-skills', JSON.stringify(next)) } catch {}
      return next
    })
  }

  function selectAllSkills() {
    const allIds = availableSkills.map((s) => s.id)
    setEnabledSkillIds(allIds)
    try { localStorage.setItem('fns-pi-enabled-skills', JSON.stringify(allIds)) } catch {}
  }

  function clearAllSkills() {
    setEnabledSkillIds([])
    try { localStorage.setItem('fns-pi-enabled-skills', JSON.stringify([])) } catch {}
  }

  const filteredSkills = useMemo(() => {
    return availableSkills.filter((s) => {
      if (sidebarSkillCategory !== 'all' && s.source !== sidebarSkillCategory) return false
      if (sidebarSkillFilter.trim()) {
        const q = sidebarSkillFilter.toLowerCase()
        return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
      }
      return true
    })
  }, [availableSkills, sidebarSkillCategory, sidebarSkillFilter])

  useEffect(() => {
    function openPluginFromHash() {
      const match = window.location.hash.match(/^#platform-plugin=(.+)$/)
      const pluginID = match?.[1] as PlatformPluginId | undefined
      if (!pluginID || !platformEnhancements.some((plugin) => plugin.id === pluginID)) return
      setActivePlatformPlugin(pluginID)
      setActiveSidebarTab('platform-enhancements')
      setSidebarOpen(true)
      setActiveSkill(null)
      setSelectedFile(null)
      setIsLocked(true)
    }

    openPluginFromHash()
    window.addEventListener('hashchange', openPluginFromHash)
    return () => window.removeEventListener('hashchange', openPluginFromHash)
  }, [])

  // Migrate the pre-plugin 2FA workspace state saved by older builds.
  useEffect(() => {
    if (activeSidebarTab !== 'twofa' || activePlatformPlugin) return
    setActivePlatformPlugin('fns.twofa')
    setActiveSidebarTab('platform-enhancements')
    setSidebarOpen(true)
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#platform-plugin=fns.twofa`)
  }, [activePlatformPlugin, activeSidebarTab])

  function handleTabClick(tab: SidebarTab) {
    if (tab === 'twofa') {
      openPlatformPlugin('fns.twofa')
      return
    }
    if (tab === 'ai-chat') {
      setActiveSidebarTab(tab)
      setShowPiAssistant(false)
      return
    }
    if (activeSidebarTab === tab && sidebarOpen) {
      updateSystemSettings({ sidebarOpen: false })
    } else {
      setActiveSidebarTab(tab)
      if (!sidebarOpen) {
        updateSystemSettings({ sidebarOpen: true })
      }
    }
  }

  useEffect(() => {
    const onGlobalShortcut = (event: KeyboardEvent) => {
      const shortcut = settings.searchShortcut.trim().toLowerCase()
      if (!shortcut || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== shortcut) return
      event.preventDefault()
      event.stopPropagation()
      handleTabClick('search')
    }
    window.addEventListener('keydown', onGlobalShortcut)
    return () => window.removeEventListener('keydown', onGlobalShortcut)
  }, [settings.searchShortcut, sidebarOpen, activeSidebarTab])

  const hasLoadedInitialConnection = useRef(false)
  const folderNoteCache = useRef<Record<string, LibraryItem[]>>({})
  const noteDetailCache = useRef<Map<string, Note>>(new Map())
  const noteLoadRequest = useRef(0)
  const folderLoadRequest = useRef(0)
  const searchRequest = useRef(0)
  const taskScanRequest = useRef(0)
  const sortMenuRef = useRef<HTMLDivElement>(null)
  const documentActionMenuRef = useRef<HTMLSpanElement>(null)
  const readerAreaRef = useRef<HTMLElement>(null)
  const selectedNoteRef = useRef<Note | null>(null)
  const folderPathRef = useRef(folderPath)
  const hasRestoredWorkspace = useRef(false)
  selectedNoteRef.current = selectedNote
  folderPathRef.current = folderPath

  useEffect(() => {
    const kind: DocumentTab['kind'] | null = activeSkill ? 'skill' : selectedNote ? 'note' : selectedFile ? 'file' : null
    const current = activeSkill || selectedNote || selectedFile
    if (!kind || !current) return
    const currentPath = selectedNote?.path || current.path
    const currentKey = makeDocumentTabKey(vaultName, kind, currentPath)
    if (!activeTabKey) {
      const restoredTab: DocumentTab = {
        key: currentKey,
        vault: vaultName,
        kind,
        path: currentPath,
        title: activeSkill?.name || documentTitle(currentPath),
        note: kind === 'note' ? selectedNote || undefined : undefined,
        file: kind === 'file' ? selectedFile || undefined : undefined,
        skill: kind === 'skill' ? activeSkill || undefined : undefined,
      }
      setOpenTabs((tabs) => tabs.some((tab) => tab.key === currentKey) ? tabs : [...tabs, restoredTab])
      setActiveTabKey(currentKey)
      return
    }
    if (currentKey !== activeTabKey) return
    setOpenTabs((tabs) => tabs.map((tab) => tab.key === activeTabKey ? {
      ...tab,
      kind,
      path: currentPath,
      title: activeSkill?.name || documentTitle(currentPath),
      note: kind === 'note' ? selectedNote || undefined : undefined,
      file: kind === 'file' ? selectedFile || undefined : undefined,
      skill: kind === 'skill' ? activeSkill || undefined : undefined,
    } : tab))
  }, [activeSkill, activeTabKey, selectedFile, selectedNote, vaultName])

  function clearLocalSession() {
    const nextConnection: Connection = {
      ...connection,
      token: '',
      clientType: 'FNS Docs Viewer',
      user: undefined,
    }
    setConnection(nextConnection)
    void configStorage.setItem(STORAGE_KEY, JSON.stringify(nextConnection))
    void configStorage.removeItem(WORKSPACE_STORAGE_KEY)
    initialWorkspaceState.current = { expandedFolders: [], folderPath: '' }
    hasRestoredWorkspace.current = false
    hasLoadedInitialConnection.current = false
    clearFilePreviewCache()
    setAuthState('signed-out')
    setVaults([])
    setVaultName('')
    setNotes([])
    setFolderNotes({})
    setTree([])
    clearNoteDetailCache()
    setSelectedNote(null)
    setSelectedFile(null)
    setOpenTabs([])
    setActiveTabKey('')
    setError('')
    setShowLogin(false)
  }

  function updateSystemSettings(changes: Partial<SystemSettings>) {
    const next = { ...settings, ...changes }
    setSettings(next)
    void configStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next))
    if (changes.sidebarOpen !== undefined) setSidebarOpen(changes.sidebarOpen)
    if (changes.directorySort !== undefined) setDirectorySort(changes.directorySort)
  }

  function updateStoredConnection(nextConnection: Connection) {
    const normalized: Connection = {
      ...connection,
      ...nextConnection,
      baseUrl: nextConnection.baseUrl.replace(/\/$/, ''),
      defaultVault: nextConnection.defaultVault.trim(),
    }
    if (normalized.baseUrl !== connection.baseUrl || normalized.token !== connection.token || normalized.clientType !== connection.clientType) {
      clearFilePreviewCache()
    }
    setConnection(normalized)
    void configStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  }

  function resetSystemSettings() {
    setSettings(defaultSystemSettings)
    void configStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(defaultSystemSettings))
    setSidebarOpen(defaultSystemSettings.sidebarOpen)
    setDirectorySort(defaultSystemSettings.directorySort)
  }

  function clearNoteDetailCache(vault?: string) {
    if (!vault) {
      noteDetailCache.current.clear()
      return
    }
    const prefix = `${vault}\u0000`
    for (const key of noteDetailCache.current.keys()) {
      if (key.startsWith(prefix)) noteDetailCache.current.delete(key)
    }
  }

  function clearFolderCache() {
    folderNoteCache.current = {}
    clearNoteDetailCache()
    setFolderNotes({})
  }

  function toggleFolder(path: string) {
    setExpandedFolders((current) => current.includes(path) ? current.filter((item) => item !== path) : [...current, path])
  }

  useEffect(() => {
    if (!hasRestoredWorkspace.current) return
    const selectedItem = selectedNote || selectedFile
    void configStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({
      expandedFolders,
      folderPath,
      vaultName,
      activeSidebarTab,
      selectedKind: selectedFile ? 'file' : selectedNote ? 'note' : undefined,
      selectedPath: selectedItem?.path,
      openTabs: saveDocumentTabs(openTabs),
      activeTabKey,
    } satisfies WorkspaceState))
  }, [activeSidebarTab, expandedFolders, folderPath, selectedFile, selectedNote, vaultName, openTabs, activeTabKey])

  useEffect(() => {
    void configStorage.setItem(QUICK_LINKS_STORAGE_KEY, JSON.stringify(quickLinksOpen))
  }, [quickLinksOpen])

  useEffect(() => {
    if (!isSortMenuOpen) return
    function closeSortMenu(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') setIsSortMenuOpen(false)
        return
      }
      if (!sortMenuRef.current?.contains(event.target as Node)) setIsSortMenuOpen(false)
    }
    window.addEventListener('pointerdown', closeSortMenu)
    window.addEventListener('keydown', closeSortMenu)
    return () => {
      window.removeEventListener('pointerdown', closeSortMenu)
      window.removeEventListener('keydown', closeSortMenu)
    }
  }, [isSortMenuOpen])

  useEffect(() => {
    if (!isUserMenuOpen) return
    function closeUserMenu(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') setIsUserMenuOpen(false)
        return
      }
      if (!userMenuRef.current?.contains(event.target as Node)) setIsUserMenuOpen(false)
    }
    window.addEventListener('pointerdown', closeUserMenu)
    window.addEventListener('keydown', closeUserMenu)
    return () => {
      window.removeEventListener('pointerdown', closeUserMenu)
      window.removeEventListener('keydown', closeUserMenu)
    }
  }, [isUserMenuOpen])

  useEffect(() => {
    if (!isDocumentActionMenuOpen) return
    function closeDocumentActionMenu(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') setIsDocumentActionMenuOpen(false)
        return
      }
      if (!documentActionMenuRef.current?.contains(event.target as Node)) {
        setIsDocumentActionMenuOpen(false)
      }
    }
    window.addEventListener('pointerdown', closeDocumentActionMenu)
    window.addEventListener('keydown', closeDocumentActionMenu)
    return () => {
      window.removeEventListener('pointerdown', closeDocumentActionMenu)
      window.removeEventListener('keydown', closeDocumentActionMenu)
    }
  }, [isDocumentActionMenuOpen])

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    if (searchParams.get('ai') === '1' && selectedNote) {
      setShowPiAssistant(true)
    }
  }, [selectedNote])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      document.documentElement.dataset.theme = settings.theme === 'system'
        ? (media.matches ? 'dark' : 'light')
        : settings.theme
    }
    applyTheme()
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [settings.theme])

  useEffect(() => {
    let ignore = false
    if (getDesktopRuntime().isLocal) {
      setAuthState('authenticated')
      return () => { ignore = true }
    }
    if (!connection.baseUrl || !connection.token || !connection.user) {
      setAuthState('signed-out')
      return () => {
        ignore = true
      }
    }

    setAuthState('checking')
    void fnsApi.getUserInfo(connection).then((profile) => {
      if (ignore) return
      setConnection((current) => ({
        ...current,
        user: current.user ? { ...current.user, ...profile } : profile,
      }))
      setAuthState('authenticated')
    }).catch(() => {
      if (ignore) return
      if (connection.user && connection.token) setAuthState('authenticated')
      else clearLocalSession()
    })

    return () => {
      ignore = true
    }
  }, [connection.baseUrl, connection.token])

  useEffect(() => setIsDocumentActionMenuOpen(false), [selectedNote?.path])

  useEffect(() => {
    const narrowViewport = window.matchMedia('(max-width: 820px)')
    function closeSidebarOnNarrowViewport() {
      if (narrowViewport.matches) setSidebarOpen(false)
    }
    closeSidebarOnNarrowViewport()
    narrowViewport.addEventListener('change', closeSidebarOnNarrowViewport)
    return () => narrowViewport.removeEventListener('change', closeSidebarOnNarrowViewport)
  }, [])

  const visibleFolderNotes = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return folderNotes
    return Object.fromEntries(Object.entries(folderNotes).map(([path, items]) => [path, items.filter((note) => note.path.toLowerCase().includes(needle))]))
  }, [folderNotes, query])

  const searchActive = Boolean(query.trim())
  const rootNotes = visibleFolderNotes[''] ?? []
  const selectedItem = selectedNote || selectedFile
  const readerIconKind: 'note' | 'file' | null = selectedFile ? 'file' : selectedNote ? 'note' : null
  const readerIcon = selectedItem && readerIconKind ? getIcon(readerIconKind, selectedItem.path) : undefined
  const selectedRef = selectedItem ? { vault: vaultName, kind: selectedNote ? 'note' as const : 'file' as const, path: selectedItem.path, title: documentTitle(selectedItem.path), visitedAt: Date.now() } : null
  const favoriteKey = selectedRef ? `${selectedRef.vault}\u0000${selectedRef.kind}\u0000${selectedRef.path}` : ''
  const readerStyle = { '--reader-font-size': settings.readerFontSize === 'small' ? '15px' : settings.readerFontSize === 'large' ? '17px' : '16px' } as CSSProperties

  const parsedDocument = useMemo(() => {
    if (!selectedNote) return { body: sampleDocument, data: {} as Frontmatter }
    const parsed = parseFrontmatter(selectedNote.content)
    return { ...parsed, body: normalizeMarkdown(parsed.body, selectedNote.fileLinks) }
  }, [selectedNote])
  const currentMarkdown = parsedDocument.body
  const hasSpreadsheetPreview = /(?:```|~~~)\s*(?:sheet|multisheet)\b/i.test(currentMarkdown)
  const isSpreadsheetContent = hasSpreadsheetPreview || Boolean(selectedFile && isSpreadsheetPath(selectedFile.path))
  const isEditing = !isLocked && Boolean(selectedNote) && !activeSkill && !hasSpreadsheetPreview
  const headings = useMemo(() => extractHeadings(currentMarkdown), [currentMarkdown])

  useEffect(() => {
    setActiveHeadingId(headings[0]?.id || '')
    const readerArea = readerAreaRef.current
    if (!readerArea || headings.length === 0) return
    const scrollContainer = readerArea

    function updateActiveHeading() {
      const readerTop = scrollContainer.getBoundingClientRect().top
      const visibleHeadings = headings.filter((heading) => {
        const element = document.getElementById(heading.id)
        return element && element.getBoundingClientRect().top - readerTop <= 130
      })
      setActiveHeadingId((visibleHeadings.at(-1) || headings[0]).id)
    }

    updateActiveHeading()
    scrollContainer.addEventListener('scroll', updateActiveHeading, { passive: true })
    return () => scrollContainer.removeEventListener('scroll', updateActiveHeading)
  }, [headings])

  useEffect(() => {
    const keyword = query.trim()
    if (authState !== 'authenticated' || !keyword || !vaultName || !connection.baseUrl || !connection.token) {
      setSearchResults(null)
      setIsSearching(false)
      return
    }

    const requestID = ++searchRequest.current
    setIsSearching(true)
    setSearchResults(null)
    const timeoutID = window.setTimeout(() => {
      void Promise.all([
        fnsApi.searchNotes(connection, vaultName, keyword),
        fnsApi.getFiles(connection, vaultName, keyword).catch(() => []),
      ]).then(([matchedNotes, matchedFiles]) => {
        if (requestID !== searchRequest.current) return
        setSearchResults(sortFolderItems([
          ...matchedNotes.map(libraryNote),
          ...matchedFiles.map(libraryFile),
        ], directorySort))
      }).catch((reason) => {
        if (requestID !== searchRequest.current) return
        setSearchResults([])
        setError(reason instanceof FnsApiError ? reason.message : '搜索文档时出现未知错误。')
      }).finally(() => {
        if (requestID === searchRequest.current) setIsSearching(false)
      })
    }, 260)

    return () => window.clearTimeout(timeoutID)
  }, [authState, connection, directorySort, query, vaultName])

  useEffect(() => {
    if (authState !== 'authenticated' || !selectedNote || !isLocked || !vaultName || !connection.baseUrl || !connection.token) return
    const path = selectedNote.path
    const timer = window.setInterval(() => {
      void fnsApi.getNote(connection, vaultName, path).then((remoteNote) => {
        if (remoteNote.content === selectedNoteRef.current?.content) return
        const nextNote = { ...selectedNoteRef.current, ...remoteNote } as Note
        cacheNote(vaultName, nextNote)
        updateCachedNote(nextNote, path)
        setSelectedNote(nextNote)
      }).catch(() => undefined)
    }, 10000)
    return () => window.clearInterval(timer)
  }, [authState, connection, isLocked, selectedNote, vaultName])

  function jumpToHeading(id: string) {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    setActiveHeadingId(id)
    window.history.replaceState(null, '', `#${encodeURIComponent(id)}`)
  }

  useEffect(() => {
    function scrollToHash() {
      const rawHash = window.location.hash.slice(1)
      if (!rawHash) return
      if (rawHash.startsWith('platform-plugin=')) return
      const targetId = decodeURIComponent(rawHash)
      const el = document.getElementById(targetId)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        setActiveHeadingId(targetId)
      }
    }

    const timer = window.setTimeout(scrollToHash, 200)
    window.addEventListener('hashchange', scrollToHash)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('hashchange', scrollToHash)
    }
  }, [selectedNote?.path, currentMarkdown])

  function openLinkedNote(target: string) {
    const normalized = target.replace(/^\/+|\.md$/g, '')
    const match = Object.values(folderNotes).flat().find((item) => item.path.replace(/^\/+|\.md$/g, '') === normalized || item.path.replace(/\.md$/i, '').endsWith(`/${normalized}`))
    if (match) void openLibraryItem(match)
  }

  async function connect(nextConnection: Connection) {
    const clientType = nextConnection.clientType.trim() || 'FNS Docs Viewer'
    const normalized: Connection = {
      baseUrl: nextConnection.baseUrl.replace(/\/$/, ''),
      token: nextConnection.token.trim(),
      clientType,
      defaultVault: nextConnection.defaultVault.trim(),
      user: clientType.toLowerCase() === 'webgui' ? nextConnection.user : undefined,
    }
    clearFilePreviewCache()
    await configStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    setConnection(normalized)
    setAuthState(normalized.user && normalized.token ? 'checking' : 'signed-out')
    hasLoadedInitialConnection.current = false
    folderNoteCache.current = {}
    clearNoteDetailCache()
    setFolderNotes({})
    setVaultName('')
    setSelectedNote(null)
    setSelectedFile(null)
    setOpenTabs([])
    setActiveTabKey('')
    setError('')
  }

  async function login(credentials: string, password: string) {
    const canRotate = connection.clientType.toLowerCase() === 'webgui'
    const loginConnection: Connection = {
      baseUrl: connection.baseUrl,
      token: '',
      clientType: 'webgui',
      defaultVault: connection.defaultVault,
      user: canRotate ? connection.user : undefined,
    }
    const user = await fnsApi.login(loginConnection, credentials.trim(), password)
    if (!user.token) throw new FnsApiError('登录成功但未收到访问 Token。')
    const { token, ...profile } = user
    await connect({ ...loginConnection, token, user: profile })
  }

  async function logout() {
    try {
      await fnsApi.logout(connection)
    } catch {
      // Clear a local session even when the server is unavailable or the token is already revoked.
    }
    clearLocalSession()
  }

  async function loadVaults(activeConnection = connection) {
    setIsLoading(true)
    setError('')
    try {
      const result = await fnsApi.getVaults(activeConnection)
      setVaults(result)
      const nextVault = result.find((vault) => vault.vault === vaultName)?.vault || result.find((vault) => vault.vault === initialWorkspaceState.current.vaultName)?.vault || result[0]?.vault || ''
      setVaultName(nextVault)
      // A persisted connection can point at a vault that was deleted, renamed,
      // or is no longer granted to this user. Keep the selected vault inside
      // the accessible list so task scans and writes do not continue against
      // a stale vault name on every reload.
      if (nextVault && nextVault !== activeConnection.defaultVault) {
        const nextConnection = { ...activeConnection, defaultVault: nextVault }
        setConnection((current) => current.baseUrl === activeConnection.baseUrl && current.token === activeConnection.token
          ? { ...current, defaultVault: nextVault }
          : current)
        void configStorage.setItem(STORAGE_KEY, JSON.stringify(nextConnection))
      }
      if (!nextVault) {
        setNotes([])
        setFolderNotes({})
      }
    } catch (reason) {
      setError(reason instanceof FnsApiError ? reason.message : '连接服务时出现未知错误。')
      setVaults([])
    } finally {
      setIsLoading(false)
    }
  }

  async function createVault(name: string) {
    const created = await fnsApi.createVault(connection, name)
    setVaults((current) => [...current.filter((vault) => vault.id !== created.id && vault.vault !== created.vault), created])
    initialWorkspaceState.current = {
      expandedFolders: [],
      folderPath: '',
      vaultName: created.vault,
    }
    setExpandedFolders([])
    setFolderPath('')
    setNotes([])
    setFolderNotes({})
    setTree([])
    setSelectedNote(null)
    setSelectedFile(null)
    setOpenTabs([])
    setActiveTabKey('')
    setVaultName(created.vault)
  }

  async function loadFolderItems(vault: string, path = '', activeConnection = connection) {
    const [folderNotes, folderFiles] = await Promise.all([
      fnsApi.getFolderNotes(activeConnection, vault, path),
      fnsApi.getFolderFiles(activeConnection, vault, path).catch(() => []),
    ])
    return [...folderNotes.map(libraryNote), ...folderFiles.map(libraryFile)]
  }

  async function scanTasks(scope = taskScope) {
    if (!vaultName || !connection.token) {
      setTasks([])
      setTaskProgress('请先连接并登录 FNS 服务')
      return
    }
    const requestID = ++taskScanRequest.current
    setIsTaskLoading(true)
    setTaskProgress('正在读取笔记列表…')
    setTasks([])
    setTaskDocuments([])
    try {
      const summaries = await fnsApi.getNotes(connection, vaultName)
      const scoped = summaries.filter((note) => !scope || note.path.startsWith(`${scope}/`))
      setTaskDocuments(scoped.map((note) => note.path))
      const collected: TaskItem[] = []
      for (let index = 0; index < scoped.length; index += 8) {
        if (requestID !== taskScanRequest.current) return
        const batch = scoped.slice(index, index + 8)
        const batchTasks = await Promise.all(batch.map(async (summary) => {
          const cached = noteDetailCache.current.get(noteCacheKey(vaultName, summary.path))
          const detail = cached || await fnsApi.getNote(connection, vaultName, summary.path)
          if (!cached) cacheNote(vaultName, detail)
          return extractMarkdownTasks(summary.path, detail.content)
        }))
        collected.push(...batchTasks.flat())
        setTasks([...collected])
        setTaskProgress(`已扫描 ${Math.min(index + batch.length, scoped.length)} / ${scoped.length} 篇笔记`)
      }
      setTaskProgress(`共找到 ${collected.length} 个任务`)
    } catch (reason) {
      if (requestID === taskScanRequest.current) {
        setTasks([])
        setTaskProgress('扫描失败')
        setError(reason instanceof FnsApiError ? reason.message : '无法扫描任务，请稍后重试。')
      }
    } finally {
      if (requestID === taskScanRequest.current) setIsTaskLoading(false)
    }
  }

  async function openTask(task: TaskItem) {
    const requestID = ++taskMarkdownEditRequest.current
    setTaskMarkdownEdit({ task, note: null, isLoading: true, error: '' })
    try {
      const cached = noteDetailCache.current.get(noteCacheKey(vaultName, task.path))
      const note = cached || await fnsApi.getNote(connection, vaultName, task.path)
      if (requestID !== taskMarkdownEditRequest.current) return
      if (!cached) cacheNote(vaultName, note)
      setTaskMarkdownEdit({ task, note, isLoading: false, error: '' })
    } catch (reason) {
      if (requestID !== taskMarkdownEditRequest.current) return
      setTaskMarkdownEdit({ task, note: null, isLoading: false, error: reason instanceof FnsApiError ? reason.message : '无法读取任务所在文档。' })
    }
  }

  function openTaskDocument(task: TaskItem) {
    taskMarkdownEditRequest.current += 1
    setTaskMarkdownEdit(null)
    openLocalRef({ vault: vaultName, kind: 'note', path: task.path, title: task.title, visitedAt: Date.now() })
  }

  async function saveTaskMarkdown(content: string) {
    const edit = taskMarkdownEdit
    if (!edit?.note) throw new FnsApiError('任务文档尚未读取完成。')
    const newline = edit.note.content.includes('\r\n') ? '\r\n' : '\n'
    const normalizedContent = newline === '\r\n' ? content.replace(/\r?\n/g, '\r\n') : content.replace(/\r\n/g, '\n')
    const saved = await fnsApi.saveNote(connection, vaultName, edit.task.path, normalizedContent, { pathHash: edit.note.pathHash })
    const nextNote: Note = { ...edit.note, ...saved, content: normalizedContent, size: saved.size || new Blob([normalizedContent]).size }
    cacheNote(vaultName, nextNote)
    updateCachedNote(nextNote, edit.task.path)
    if (selectedNote?.path === edit.task.path) setSelectedNote(nextNote)
    setTaskMarkdownEdit((current) => current && current.task.id === edit.task.id
      ? { ...current, note: nextNote, isLoading: false, error: '' }
      : current)
    await scanTasks(taskScope)
  }

  async function toggleTask(task: TaskItem) {
    try {
      const cached = noteDetailCache.current.get(noteCacheKey(vaultName, task.path))
      const note = cached || await fnsApi.getNote(connection, vaultName, task.path)
      const isCrlf = note.content.includes('\r\n')
      const newline = isCrlf ? '\r\n' : '\n'
      const lines = note.content.split(/\r?\n/)
      const line = lines[task.lineIndex]
      if (!line || !/^\s*[-*+]\s+\[[ xX]\]\s*/.test(line)) throw new FnsApiError('任务所在笔记已发生变化，请刷新任务列表。')
      const nextCompleted = !task.completed
      lines[task.lineIndex] = toggleMarkdownTaskLine(line, nextCompleted)
      const content = lines.join(newline)
      const saved = await fnsApi.saveNote(connection, vaultName, task.path, content, { pathHash: note.pathHash })
      const nextNote: Note = { ...note, ...saved, content, size: saved.size || new Blob([content]).size }
      cacheNote(vaultName, nextNote)
      updateCachedNote(nextNote, task.path)
      if (selectedNote?.path === task.path) setSelectedNote(nextNote)
      const reParsedTasks = extractMarkdownTasks(task.path, content)
      const updatedTask = reParsedTasks.find((item) => item.lineIndex === task.lineIndex)
      setTasks((current) => current.map((item) => item.id === task.id ? (updatedTask || { ...item, completed: nextCompleted }) : item))
    } catch (reason) {
      setError(reason instanceof FnsApiError ? reason.message : '任务状态保存失败，请稍后重试。')
    }
  }

  async function setTaskPriority(task: TaskItem, priority: TaskPriority) {
    if (task.priority === priority) return
    try {
      const cached = noteDetailCache.current.get(noteCacheKey(vaultName, task.path))
      const note = cached || await fnsApi.getNote(connection, vaultName, task.path)
      const sourceTask = extractMarkdownTasks(task.path, note.content).find((item) => item.id === task.id)
      if (!sourceTask) throw new FnsApiError('任务所在笔记已发生变化，请刷新任务列表。')
      const lines = note.content.replace(/\r\n/g, '\n').split('\n')
      const line = lines[task.lineIndex]
      const lineMatch = line?.match(/^(\s*[-*+]\s+\[[ xX]\]\s+)(.*?)(\s*)$/)
      if (!lineMatch) throw new FnsApiError('任务所在笔记已发生变化，请刷新任务列表。')
      const marker = taskPriorityMarkers[priority]
      const nextRawText = marker ? `${stripTaskPriority(sourceTask.rawText)} ${marker}` : stripTaskPriority(sourceTask.rawText)
      lines[task.lineIndex] = `${lineMatch[1]}${nextRawText}${lineMatch[3]}`
      const content = lines.join('\n')
      const saved = await fnsApi.saveNote(connection, vaultName, task.path, content, { pathHash: note.pathHash })
      const nextNote: Note = { ...note, ...saved, content, size: saved.size || new Blob([content]).size }
      cacheNote(vaultName, nextNote)
      updateCachedNote(nextNote, task.path)
      if (selectedNote?.path === task.path) setSelectedNote(nextNote)
      const updatedDates = readTaskDates(nextRawText, task.path)
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, priority, rawText: nextRawText, text: stripTaskPriority(updatedDates.text), createdDate: updatedDates.createdDate, completedDate: updatedDates.completedDate, dueDate: updatedDates.dueDate, startTime: updatedDates.startTime, endTime: updatedDates.endTime } : item))
    } catch (reason) {
      setError(reason instanceof FnsApiError ? reason.message : '任务优先级保存失败，请稍后重试。')
    }
  }

  async function addTask(text: string, targetPath: string, folder: string, schedule?: TaskSchedule): Promise<string> {
    if (!vaultName || !connection.token) throw new FnsApiError('请先连接并登录 FNS 服务。')
    const path = normalizeDocumentPath(targetPath || nextTaskDocumentPath(folder, taskDocuments))
    if (!path) throw new FnsApiError('请选择或输入有效的目标文档。')
    try {
      const note = taskDocuments.includes(path) ? await fnsApi.getNote(connection, vaultName, path) : null
      const content = appendMarkdownTask(note?.content || '', text, new Date(), schedule)
      const saved = await fnsApi.saveNote(connection, vaultName, path, content, { createOnly: !note, pathHash: note?.pathHash })
      const nextNote: Note = { ...(note || {} as Note), ...saved, path, content, size: saved.size || new Blob([content]).size }
      cacheNote(vaultName, nextNote)
      updateCachedNote(nextNote, path)
      if (selectedNote?.path === path) setSelectedNote(nextNote)
      await scanTasks(taskScope)
      return path
    } catch (reason) {
      const message = reason instanceof FnsApiError ? reason.message : '任务添加失败，请稍后重试。'
      setError(message)
      throw reason
    }
  }

  useEffect(() => {
    if (activeSidebarTab === 'tasks' && vaultName) void scanTasks(taskScope)
  }, [activeSidebarTab, taskScope, vaultName])

  async function loadVaultContent(name: string, activeConnection = connection) {
    if (!name) return
    setIsLoading(true)
    setError('')
    const requestID = ++folderLoadRequest.current
    const isCurrentRequest = () => requestID === folderLoadRequest.current
    const workspace: WorkspaceState = hasRestoredWorkspace.current && initialWorkspaceState.current.vaultName === name
      ? {
          expandedFolders,
          folderPath,
          selectedKind: selectedFile ? 'file' : selectedNote ? 'note' : undefined,
          selectedPath: (selectedNote || selectedFile)?.path,
        }
      : initialWorkspaceState.current
    try {
      const [rootFolderItems, folderResponse] = await Promise.all([
        loadFolderItems(name, '', activeConnection),
        fnsApi.getFolderTree(activeConnection, name).catch(() => null),
      ])
      if (!isCurrentRequest()) return

      const restorePaths = [...new Set([
        ...workspace.expandedFolders,
        workspace.folderPath,
        workspace.selectedPath ? parentPath(workspace.selectedPath) : '',
      ].map((path) => path.replace(/^\/+|\/+$/g, '')).filter(Boolean))]
      const priorityPath = (workspace.selectedPath ? parentPath(workspace.selectedPath) : workspace.folderPath).replace(/^\/+|\/+$/g, '')
      let priorityItems: LibraryItem[] | undefined
      if (priorityPath) {
        try {
          priorityItems = await loadFolderItems(name, priorityPath, activeConnection)
        } catch {
          priorityItems = []
        }
      }
      if (!isCurrentRequest()) return

      const nextFolderItems: Record<string, LibraryItem[]> = {
        '': rootFolderItems,
        ...(priorityPath ? { [priorityPath]: priorityItems || [] } : {}),
      }
      const restoredFolderPath = nextFolderItems[workspace.folderPath] ? workspace.folderPath : ''
      const restoredItem = workspace.selectedPath
        ? Object.values(nextFolderItems).flat().find((item) => item.path === workspace.selectedPath && item.kind === workspace.selectedKind)
        : undefined

      folderNoteCache.current = nextFolderItems
      setNotes(nextFolderItems[restoredFolderPath])
      setFolderNotes(nextFolderItems)
      setTree(folderResponse?.folders ?? [])
      setExpandedFolders(workspace.expandedFolders)
      setFolderPath(restoredFolderPath)
      setSelectedNote(null)
      setSelectedFile(null)

      if (!hasRestoredWorkspace.current && workspace.openTabs !== undefined) {
        const tabs = workspace.openTabs
        setOpenTabs(tabs)
        const activeTab = restoredActiveTab(tabs, workspace.activeTabKey)
        const pluginMatch = window.location.hash.match(/^#platform-plugin=(.+)$/)
        const pluginID = pluginMatch?.[1] as PlatformPluginId | undefined
        if (activeTab && pluginID && platformEnhancements.some((plugin) => plugin.id === pluginID)) {
          // A plugin hash is the explicit entry point and must win over restoring
          // the last document tab, whose activation would clear the plugin view.
          setActiveTabKey(activeTab.key)
          setActivePlatformPlugin(pluginID)
          setActiveSidebarTab('platform-enhancements')
          setSidebarOpen(true)
          setActiveSkill(null)
          setSelectedNote(null)
          setSelectedFile(null)
          setIsLocked(true)
        } else if (activeTab) activateDocumentTab(activeTab)
        else {
          setActiveTabKey('')
          setActiveSkill(null)
        }
      } else if (restoredItem?.kind === 'file') {
        setSelectedFile(restoredItem)
      } else if (restoredItem?.kind === 'note') {
        try {
          const detail = await fnsApi.getNote(activeConnection, name, restoredItem.path)
          if (!isCurrentRequest()) return
          const restoredNote = { ...restoredItem, ...detail, size: detail.size || restoredItem.size }
          cacheNote(name, restoredNote)
          setSelectedNote(restoredNote)
          setIsLocked(false)
        } catch (reason) {
          setError(reason instanceof FnsApiError ? reason.message : '无法恢复上次阅读的文档。')
        }
      }
      hasRestoredWorkspace.current = true
      setIsLoading(false)

      const backgroundPaths = restorePaths.filter((path) => path !== priorityPath)
      if (backgroundPaths.length) {
        const restoredFolders = await Promise.all(backgroundPaths.map(async (path) => {
          try {
            return [path, await loadFolderItems(name, path, activeConnection)] as const
          } catch {
            return [path, []] as const
          }
        }))
        if (!isCurrentRequest()) return
        const mergedFolderItems = {
          ...folderNoteCache.current,
          ...Object.fromEntries(restoredFolders),
        }
        folderNoteCache.current = mergedFolderItems
        setFolderNotes(mergedFolderItems)
        if (mergedFolderItems[folderPath]) setNotes(mergedFolderItems[folderPath])
      }
    } catch (reason) {
      setError(reason instanceof FnsApiError ? reason.message : '无法读取文档列表。')
      setNotes([])
      setFolderNotes({})
      setTree([])
    } finally {
      setIsLoading(false)
    }
  }

  async function pickFolder(path: string) {
    const normalizedPath = path.replace(/^\/+|\/+$/g, '')
    setFolderPath(normalizedPath)
    const cachedItems = folderNoteCache.current[normalizedPath]
    if (settings.useFolderCache && cachedItems) {
      setNotes(cachedItems)
      return
    }

    const requestID = ++folderLoadRequest.current
    setNotes([])
    try {
      const nextItems = await loadFolderItems(vaultName, normalizedPath)
      folderNoteCache.current[normalizedPath] = nextItems
      setFolderNotes((current) => ({ ...current, [normalizedPath]: nextItems }))
      if (requestID === folderLoadRequest.current) setNotes(nextItems)
    } catch (reason) {
      if (requestID === folderLoadRequest.current) {
        setError(reason instanceof FnsApiError ? reason.message : '无法读取目录内容。')
      }
    }
  }

  function noteCacheKey(vault: string, path: string) {
    return `${vault}\u0000${path}`
  }

  function cacheNote(vault: string, note: Note) {
    if (!settings.useFolderCache) return
    const key = noteCacheKey(vault, note.path)
    noteDetailCache.current.delete(key)
    noteDetailCache.current.set(key, note)
    while (noteDetailCache.current.size > 30) {
      const oldestKey = noteDetailCache.current.keys().next().value
      if (!oldestKey) break
      noteDetailCache.current.delete(oldestKey)
    }
  }

  function closeDocumentTab(key: string) {
      const index = openTabs.findIndex((tab) => tab.key === key)
      const nextTabs = openTabs.filter((tab) => tab.key !== key)
      setOpenTabs(nextTabs)
      if (key !== activeTabKey) return
      const nextTab = nextTabs[index] || nextTabs[index - 1]
      if (nextTab) {
        activateDocumentTab(nextTab)
      } else {
        noteLoadRequest.current += 1
        setIsDocumentLoading(false)
        setActiveTabKey('')
        setActiveSkill(null)
        setSelectedNote(null)
        setSelectedFile(null)
      }
  }

  function activateDocumentTab(tab: DocumentTab) {
    const requestID = ++noteLoadRequest.current
    setActiveTabKey(tab.key)
    setActivePlatformPlugin(null)
    setActiveSkill(tab.kind === 'skill' ? tab.skill || null : null)
    setSelectedNote(tab.kind === 'note' || tab.kind === 'skill' ? tab.note || null : null)
    setSelectedFile(tab.kind === 'file' ? tab.file || null : null)
    setIsLocked(tab.kind === 'skill')
    setEditorMode(null)
    setError('')
    if (tab.note || tab.file) {
      setIsDocumentLoading(false)
      return
    }
    setIsDocumentLoading(true)
    void loadDocumentTab(tab).then((loadedTab) => {
      if (requestID !== noteLoadRequest.current) return
      setOpenTabs((tabs) => tabs.map((item) => item.key === tab.key ? loadedTab : item))
      setSelectedNote(loadedTab.note || null)
      setSelectedFile(loadedTab.file || null)
      setActiveSkill(loadedTab.skill || null)
    }).catch(() => {
      if (requestID === noteLoadRequest.current) setError('无法恢复此标签页，文档可能已移动或暂时无法访问。点击标签可重试。')
    }).finally(() => {
      if (requestID === noteLoadRequest.current) setIsDocumentLoading(false)
    })
  }

  async function loadDocumentTab(tab: DocumentTab): Promise<DocumentTab> {
    if (tab.kind === 'note') {
      const note = await fnsApi.getNote(connection, tab.vault, tab.path)
      cacheNote(tab.vault, note)
      return { ...tab, note }
    }
    if (tab.kind === 'file') {
      const files = await fnsApi.getFolderFiles(connection, tab.vault, parentPath(tab.path))
      const file = files.find((item) => item.path === tab.path)
      if (!file) throw new Error('File not found')
      return { ...tab, file }
    }
    const skills = await getAvailableSkills(connection)
    const skill = skills.find((item) => item.id === tab.skillId)
    if (!skill) throw new Error('Skill not found')
    const content = skill.content || `# ${skill.name}\n\n> ${skill.description}\n\n暂无详细 SKILL.md 规范说明。`
    return { ...tab, skill, note: {
      id: -1, path: tab.path, pathHash: `skill_${skill.id}`, content, contentHash: '',
      version: 1, ctime: 0, mtime: 0, size: content.length, fileLinks: {},
    } }
  }

  function ensureDocumentTab(item: LibraryItem) {
    const key = makeDocumentTabKey(vaultName, item.kind, item.path)
    const existing = openTabs.find((tab) => tab.key === key)
    if (existing) {
      activateDocumentTab(existing)
      return existing
    }
    const nextTab: DocumentTab = {
      key,
      vault: vaultName,
      kind: item.kind,
      path: item.path,
      title: documentTitle(item.path),
      file: item.kind === 'file' ? item : undefined,
    }
    setOpenTabs((tabs) => [...tabs, nextTab])
    setActiveTabKey(key)
    return nextTab
  }

  async function openNote(note: NoteSummary) {
    setActivePlatformPlugin(null)
    setActiveSkill(null)
    if (window.matchMedia('(max-width: 820px)').matches) setSidebarOpen(false)
    setIsLocked(false)
    const requestID = ++noteLoadRequest.current
    const cached = settings.useFolderCache ? noteDetailCache.current.get(noteCacheKey(vaultName, note.path)) : undefined
    setError('')
    setSelectedFile(null)

    if (cached && cached.mtime === note.mtime) {
      setSelectedNote({ ...note, ...cached, size: cached.size || note.size })
      setIsDocumentLoading(false)
      return
    }

    setSelectedNote(null)
    setIsDocumentLoading(true)
    try {
      const detail = await fnsApi.getNote(connection, vaultName, note.path)
      const nextNote = { ...note, ...detail, size: detail.size || note.size }
      cacheNote(vaultName, nextNote)
      if (requestID === noteLoadRequest.current) setSelectedNote(nextNote)
    } catch (reason) {
      if (requestID === noteLoadRequest.current) {
        setError(reason instanceof FnsApiError ? reason.message : '无法读取文档。')
      }
    } finally {
      if (requestID === noteLoadRequest.current) setIsDocumentLoading(false)
    }
  }

  function openFile(file: FileSummary) {
    clearPlatformPluginHash()
    setActivePlatformPlugin(null)
    setActiveSkill(null)
    if (window.matchMedia('(max-width: 820px)').matches) setSidebarOpen(false)
    noteLoadRequest.current += 1
    setIsDocumentLoading(false)
    setError('')
    setSelectedNote(null)
    setSelectedFile(file)
    setEditorMode(null)
  }

  function openSkill(skill: SkillItem) {
    clearPlatformPluginHash()
    setActivePlatformPlugin(null)
    if (window.matchMedia('(max-width: 820px)').matches) setSidebarOpen(false)
    noteLoadRequest.current += 1
    setIsDocumentLoading(false)
    setError('')
    setSelectedFile(null)
    setIsLocked(true)
    setActiveSkill(skill)

    const skillContent = skill.content || `# ${skill.name}\n\n> ${skill.description}\n\n暂无详细 SKILL.md 规范说明。`
    const skillNote: Note = {
      id: -Math.abs(skill.id.split('').reduce((acc, c) => ((acc << 5) - acc) + c.charCodeAt(0) | 0, 0)) || -1,
      path: `技能库/${skill.name}.md`,
      pathHash: `skill_${skill.id}`,
      content: skillContent,
      contentHash: '',
      version: 1,
      ctime: Date.now(),
      mtime: Date.now(),
      size: skillContent.length,
      updatedAt: new Date().toISOString(),
      fileLinks: {},
    }
    const key = makeDocumentTabKey(vaultName, 'skill', skillNote.path)
    const skillTab: DocumentTab = { key, vault: vaultName, kind: 'skill', path: skillNote.path, title: skill.name, skill, note: skillNote }
    setOpenTabs((tabs) => tabs.some((tab) => tab.key === key) ? tabs.map((tab) => tab.key === key ? skillTab : tab) : [...tabs, skillTab])
    setActiveTabKey(key)
    setSelectedNote(skillNote)
    setEditorMode(null)
  }

  function clearPlatformPluginHash() {
    if (window.location.hash.startsWith('#platform-plugin=')) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    }
  }

  function openPlatformPlugin(pluginID: PlatformPluginId) {
    noteLoadRequest.current += 1
    setActivePlatformPlugin(pluginID)
    setActiveSidebarTab('platform-enhancements')
    updateSystemSettings({ sidebarOpen: true })
    setActiveSkill(null)
    setSelectedFile(null)
    setIsLocked(true)
    setEditorMode(null)
    setShowPiAssistant(false)
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#platform-plugin=${pluginID}`)
  }

  function closePlatformPlugin() {
    setActivePlatformPlugin(null)
    setActiveSidebarTab('platform-enhancements')
    setIsLocked(false)
    clearPlatformPluginHash()
  }

  function openLibraryItem(item: LibraryItem) {
    const ref: LocalDocumentRef = { vault: vaultName, kind: item.kind, path: item.path, title: documentTitle(item.path), visitedAt: Date.now() }
    const nextRecents = [ref, ...recents.filter((entry) => `${entry.vault}\u0000${entry.kind}\u0000${entry.path}` !== `${ref.vault}\u0000${ref.kind}\u0000${ref.path}`)].slice(0, 30)
    setRecents(nextRecents)
    void configStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(nextRecents))
    const key = makeDocumentTabKey(vaultName, item.kind, item.path)
    const existing = openTabs.find((tab) => tab.key === key)
    if (existing) {
      activateDocumentTab(existing)
      return
    }
    ensureDocumentTab(item)
    if (item.kind === 'file') openFile(item)
    else void openNote(item)
  }

  function toggleFavorite() {
    if (!selectedRef) return
    const next = favorites.some((entry) => `${entry.vault}\u0000${entry.kind}\u0000${entry.path}` === favoriteKey)
      ? favorites.filter((entry) => `${entry.vault}\u0000${entry.kind}\u0000${entry.path}` !== favoriteKey)
      : [selectedRef, ...favorites].slice(0, 50)
    setFavorites(next)
    void configStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next))
  }

  function openLocalRef(ref: LocalDocumentRef) {
    if (ref.vault !== vaultName) setVaultName(ref.vault)
    const item = Object.values(folderNotes).flat().find((entry) => entry.kind === ref.kind && entry.path === ref.path)
    if (item) {
      openLibraryItem(item)
    } else if (ref.kind === 'note') {
      const item = { kind: 'note' as const, path: ref.path, title: ref.title, mtime: 0, id: 0, pathHash: '', size: 0 } as NoteSummary & { kind: 'note' }
      ensureDocumentTab(item)
      void openNote(item)
    }
  }

  function updateLocalRefPath(kind: LocalDocumentRef['kind'], previousPath: string, nextPath: string) {
    const update = (refs: LocalDocumentRef[]) => refs.map((ref) => ref.kind === kind && ref.vault === vaultName && ref.path === previousPath
      ? { ...ref, path: nextPath, title: documentTitle(nextPath) }
      : ref)
    setRecents((current) => {
      const next = update(current)
      void configStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(next))
      return next
    })
    setFavorites((current) => {
      const next = update(current)
      void configStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  function updateDocumentTabsPath(kind: DocumentTab['kind'], previousPath: string, nextPath: string, nextNote?: Note, nextFile?: FileSummary) {
    const previousKey = makeDocumentTabKey(vaultName, kind, previousPath)
    const nextKey = makeDocumentTabKey(vaultName, kind, nextPath)
    setOpenTabs((tabs) => tabs.map((tab) => tab.key === previousKey ? {
      ...tab,
      key: nextKey,
      path: nextPath,
      title: documentTitle(nextPath),
      note: nextNote || tab.note,
      file: nextFile || (tab.file ? { ...tab.file, path: nextPath } : tab.file),
    } : tab))
    setActiveTabKey((current) => current === previousKey ? nextKey : current)
  }

  function updateCachedNote(nextNote: Note, previousPath = nextNote.path) {
    const previousFolder = parentPath(previousPath)
    const nextFolder = parentPath(nextNote.path)
    const cache = { ...folderNoteCache.current }
    if (!cache[previousFolder] && folderPath === previousFolder) cache[previousFolder] = []
    if (!cache[nextFolder]) cache[nextFolder] = []

    for (const folder of new Set([previousFolder, nextFolder])) {
      if (!cache[folder]) continue
      const remaining = cache[folder].filter((item) => item.path !== previousPath && item.path !== nextNote.path)
      cache[folder] = folder === nextFolder ? [...remaining, libraryNote(noteSummary(nextNote))] : remaining
    }

    folderNoteCache.current = cache
    setFolderNotes(cache)
    if (folderPath === nextFolder) setNotes(cache[nextFolder] || [])
    if (folderPath === previousFolder && previousFolder !== nextFolder) setNotes(cache[previousFolder] || [])
  }

  function removeCachedNote(path: string) {
    const folder = parentPath(path)
    const cache = { ...folderNoteCache.current }
    if (cache[folder]) cache[folder] = cache[folder].filter((item) => item.path !== path)
    folderNoteCache.current = cache
    setFolderNotes(cache)
    if (folderPath === folder) setNotes(cache[folder] || [])
  }

  function updateCachedFile(file: FileSummary, previousPath = file.path) {
    const previousFolder = parentPath(previousPath)
    const nextFolder = parentPath(file.path)
    const cache = { ...folderNoteCache.current }
    if (!cache[previousFolder] && folderPath === previousFolder) cache[previousFolder] = []
    if (!cache[nextFolder]) cache[nextFolder] = []
    for (const folder of new Set([previousFolder, nextFolder])) {
      if (!cache[folder]) continue
      const remaining = cache[folder].filter((entry) => entry.path !== previousPath && entry.path !== file.path)
      cache[folder] = folder === nextFolder ? [...remaining, libraryFile(file)] : remaining
    }
    folderNoteCache.current = cache
    setFolderNotes(cache)
    if (folderPath === nextFolder) setNotes(cache[nextFolder] || [])
    if (folderPath === previousFolder && previousFolder !== nextFolder) setNotes(cache[previousFolder] || [])
  }

  async function refreshTree() {
    if (!vaultName) return
    try {
      const result = await fnsApi.getFolderTree(connection, vaultName)
      setTree(result.folders)
    } catch {
      // A stale tree is still usable when a background refresh cannot complete.
    }
  }

  async function saveDocument(draft: { path: string; content: string; createOnly: boolean }): Promise<Note> {
    if (!vaultName) throw new FnsApiError('请先选择一个 Vault。')
    const saved = await fnsApi.saveNote(connection, vaultName, draft.path, draft.content, {
      createOnly: draft.createOnly,
      pathHash: draft.createOnly ? undefined : selectedNote?.pathHash,
    })
    const nextNote: Note = {
      ...(selectedNote?.path === saved.path ? selectedNote : {}),
      ...saved,
      content: saved.content || draft.content,
      size: saved.size || new Blob([draft.content]).size,
    }
    cacheNote(vaultName, nextNote)
    updateCachedNote(nextNote, draft.createOnly ? nextNote.path : selectedNote?.path || nextNote.path)
    if (draft.createOnly || !activeTabKey) {
      const nextKey = makeDocumentTabKey(vaultName, 'note', nextNote.path)
      const nextTab: DocumentTab = { key: nextKey, vault: vaultName, kind: 'note', path: nextNote.path, title: documentTitle(nextNote.path), note: nextNote }
      setOpenTabs((tabs) => tabs.some((tab) => tab.key === nextKey) ? tabs.map((tab) => tab.key === nextKey ? nextTab : tab) : [...tabs, nextTab])
      setActiveTabKey(nextKey)
    }
    setSelectedNote(nextNote)
    setSelectedFile(null)
    const nextFolder = parentPath(nextNote.path)
    setFolderPath(nextFolder)
    setNotes(folderNoteCache.current[nextFolder] || [libraryNote(noteSummary(nextNote))])
    void refreshTree()
    return nextNote
  }

  async function persistCoverFile(file: Blob, fileName: string, modifiedAt = Date.now()) {
    if (!selectedNote || !vaultName) throw new FnsApiError('当前没有可编辑的 Markdown 文档。')
    const note = selectedNote
    const targetPath = coverUploadPath(note.path, fileName)
    const savedFile = await uploadFile(connection, vaultName, targetPath, file, modifiedAt)
    if (!selectedNote || selectedNote.path !== note.path) {
      throw new FnsApiError('文档已切换，题头图未写入当前文档。')
    }
    updateCachedFile(savedFile)
    const folder = parentPath(note.path)
    const storedPath = folder && savedFile.path.startsWith(`${folder}/`)
      ? savedFile.path.slice(folder.length + 1)
      : savedFile.path
    const nextContent = updateFrontmatterCover(note.content, storedPath)
    await saveDocument({
      path: note.path,
      content: nextContent,
      createOnly: false,
    })
    await refreshTree()
  }

  async function saveDocumentCoverReference(coverPath: string) {
    if (!selectedNote) throw new FnsApiError('当前没有可编辑的 Markdown 文档。')
    const nextContent = updateFrontmatterCover(selectedNote.content, coverPath)
    await saveDocument({
      path: selectedNote.path,
      content: nextContent,
      createOnly: false,
    })
  }

  async function verifyRemoteCover(url: string) {
    await new Promise<void>((resolve, reject) => {
      const image = new window.Image()
      let settled = false
      const timeout = window.setTimeout(() => finish(new Error('timeout')), 8000)
      const finish = (reason?: Error) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        image.onload = null
        image.onerror = null
        image.src = ''
        if (reason) reject(reason)
        else resolve()
      }
      image.onload = () => finish()
      image.onerror = () => finish(new Error('image-load-failed'))
      image.referrerPolicy = 'no-referrer'
      image.src = url
    })
  }

  async function handleCoverUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !selectedNote || !vaultName) return

    const looksLikeImage = file.type.startsWith('image/') || /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(file.name)
    if (!looksLikeImage) {
      setError('题头图需要使用 JPG、PNG、WEBP、GIF、AVIF 或 SVG 图片。')
      return
    }

    setIsCoverBusy(true)
    setError('')
    try {
      await persistCoverFile(file, file.name, file.lastModified || Date.now())
    } catch (reason) {
      setError(reason instanceof FnsApiError ? reason.message : '题头图保存失败，请稍后重试。')
    } finally {
      setIsCoverBusy(false)
    }
  }

  async function handleRandomCover() {
    if (!selectedNote || !vaultName) return
    setIsCoverBusy(true)
    setError('')
    try {
      const seed = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const randomUrl = `https://picsum.photos/seed/${encodeURIComponent(seed)}/1600/480`
      await verifyRemoteCover(randomUrl)
      await saveDocumentCoverReference(randomUrl)
    } catch (reason) {
      setError(reason instanceof FnsApiError ? reason.message : '随机图片获取失败，请检查网络后重试。')
    } finally {
      setIsCoverBusy(false)
    }
  }

  async function removeDocumentCover() {
    if (!selectedNote) return
    setIsCoverBusy(true)
    setError('')
    try {
      const nextContent = updateFrontmatterCover(selectedNote.content)
      await saveDocument({
        path: selectedNote.path,
        content: nextContent,
        createOnly: false,
      })
    } catch (reason) {
      setError(reason instanceof FnsApiError ? reason.message : '移除题头图失败，请稍后重试。')
    } finally {
      setIsCoverBusy(false)
    }
  }

  function resolveAiDocumentPath(rawPath: string) {
    const cleaned = rawPath.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    const baseFolder = selectedNote ? parentPath(selectedNote.path) : folderPath
    const candidate = cleaned.includes('/') || !baseFolder ? cleaned : `${baseFolder}/${cleaned}`
    const segments: string[] = []
    for (const segment of candidate.split('/')) {
      if (!segment || segment === '.') continue
      if (segment === '..') throw new FnsApiError('文章路径不能包含上级目录。')
      segments.push(segment)
    }
    if (segments.length === 0) throw new FnsApiError('请提供要操作的文章名称。')
    const path = segments.join('/')
    return /\.md$/i.test(path) ? path : `${path}.md`
  }

  async function handleAiCreateDocument(path: string, content: string) {
    return saveDocument({ path: resolveAiDocumentPath(path), content, createOnly: true })
  }

  async function handleInlineAiReplaceSelection(selected: string, replacement: string): Promise<void> {
    if (!selectedNote) throw new FnsApiError('当前没有可编辑的文章。')
    const source = selectedNote.content
    const exactStart = source.indexOf(selected)
    const match = exactStart >= 0 ? { index: exactStart, length: selected.length } : (() => {
      const tokens = selected.trim().split(/\s+/).filter(Boolean).map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      if (!tokens.length) return null
      const found = new RegExp(tokens.join('\\s+'), 'm').exec(source)
      return found ? { index: found.index, length: found[0].length } : null
    })()
    if (!match) throw new FnsApiError('选中文本已发生变化，请重新选择后再试。')
    const nextContent = `${source.slice(0, match.index)}${replacement}${source.slice(match.index + match.length)}`
    await saveDocument({ path: selectedNote.path, content: nextContent, createOnly: false })
  }

  async function handleInlineAiAppend(content: string): Promise<void> {
    if (!selectedNote) throw new FnsApiError('当前没有可编辑的文章。')
    const source = selectedNote.content.trimEnd()
    const nextContent = `${source}${source ? '\n\n' : ''}${content.trim()}\n`
    await saveDocument({ path: selectedNote.path, content: nextContent, createOnly: false })
  }

  async function handleAiDeleteDocument(rawPath: string) {
    const path = rawPath ? resolveAiDocumentPath(rawPath) : selectedNote?.path
    if (!path) throw new FnsApiError('当前没有可删除的文章。')
    const target = selectedNote?.path === path ? selectedNote : await fnsApi.getNote(connection, vaultName, path)
    await fnsApi.deleteNote(connection, vaultName, path, target.pathHash)
    noteDetailCache.current.delete(noteCacheKey(vaultName, path))
    removeCachedNote(path)
    closeDocumentTab(makeDocumentTabKey(vaultName, 'note', path))
    void refreshTree()
  }

  async function saveSpreadsheetBlock(originalRaw: string, nextRaw: string) {
    if (!selectedNote) throw new FnsApiError('当前文档不可编辑。')
    const blockPattern = /(^|\r?\n)(`{3,}|~{3,})([ \t]*)(sheet|multisheet)([^\r\n]*)\r?\n([\s\S]*?)\r?\n\2(?=\r?\n|$)/g
    const normalizedOriginal = originalRaw.replace(/\r\n/g, '\n')
    let replaced = false
    const nextContent = selectedNote.content.replace(blockPattern, (full, prefix: string, fence: string, spacing: string, language: string, suffix: string, block: string) => {
      if (replaced || block.replace(/\r\n/g, '\n') !== normalizedOriginal) return full
      replaced = true
      return `${prefix}${fence}${spacing}${language}${suffix}\n${nextRaw}\n${fence}`
    })
    if (!replaced) throw new FnsApiError('没有找到要保存的表格数据，请刷新文档后重试。')
    await saveDocument({ path: selectedNote.path, content: nextContent, createOnly: false })
  }

  async function renameDocument(path: string) {
    if (!selectedNote) return
    const previousNote = selectedNote
    const saved = await fnsApi.renameNote(connection, vaultName, previousNote.path, path, previousNote.pathHash)
    const detail = await fnsApi.getNote(connection, vaultName, saved.path)
    const nextNote: Note = { ...saved, ...detail, size: saved.size || detail.size || previousNote.size }
    clearNoteDetailCache(vaultName)
    cacheNote(vaultName, nextNote)
    updateCachedNote(nextNote, previousNote.path)
    const previousKey = makeDocumentTabKey(vaultName, 'note', previousNote.path)
    const nextKey = makeDocumentTabKey(vaultName, 'note', nextNote.path)
    setOpenTabs((tabs) => tabs.map((tab) => tab.key === previousKey ? { ...tab, key: nextKey, path: nextNote.path, title: documentTitle(nextNote.path), note: nextNote } : tab))
    setActiveTabKey(nextKey)
    setSelectedNote(nextNote)
    setSelectedFile(null)
    const nextFolder = parentPath(nextNote.path)
    setFolderPath(nextFolder)
    setNotes(folderNoteCache.current[nextFolder] || [libraryNote(noteSummary(nextNote))])
    migrateIcon('note', previousNote.path, nextNote.path)
    void refreshTree()
  }

  async function deleteDocument() {
    if (!selectedNote) return
    const note = selectedNote
    await fnsApi.deleteNote(connection, vaultName, note.path, note.pathHash)
    removeIconsUnderPath(note.path)
    noteDetailCache.current.delete(noteCacheKey(vaultName, note.path))
    removeCachedNote(note.path)
    closeDocumentTab(makeDocumentTabKey(vaultName, 'note', note.path))
    void refreshTree()
  }

  function beginUploadInFolder(targetFolder: string) {
    if (!vaultName) return
    setUploadTargetFolder(targetFolder)
    uploadInputRef.current?.click()
  }

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    const targetFolder = uploadTargetFolder
    event.target.value = ''
    setUploadTargetFolder(null)
    if (!file || targetFolder === null || !vaultName) return

    const filePath = targetFolder ? `${targetFolder}/${file.name}` : file.name
    try {
      const saved = await uploadFile(connection, vaultName, filePath, file, file.lastModified || Date.now())
      updateCachedFile(saved)
      await refreshTree()
      if (!expandedFolders.includes(targetFolder) && targetFolder) {
        setExpandedFolders((prev) => [...prev, targetFolder])
      }
      openFile(saved)
    } catch (reason) {
      setError(reason instanceof FnsApiError ? reason.message : '上传文件失败。')
    }
  }

  async function handleCreateInlineDocument(targetFolder?: string) {
    if (!vaultName) return
    const folder = targetFolder !== undefined ? targetFolder : folderPath
    const existingInFolder = (folderNoteCache.current[folder] || []).map((i) => i.path)
    let candidateName = "未命名.md"
    let candidatePath = folder ? folder + "/" + candidateName : candidateName
    let counter = 1
    while (existingInFolder.includes(candidatePath)) {
      candidateName = "未命名 " + counter + ".md"
      candidatePath = folder ? folder + "/" + candidateName : candidateName
      counter++
    }

    try {
      const saved = await fnsApi.saveNote(connection, vaultName, candidatePath, "", { createOnly: true })
      const detail = await fnsApi.getNote(connection, vaultName, saved.path)
      const nextNote: Note = { ...saved, ...detail, content: "", size: 0 }
      cacheNote(vaultName, nextNote)
      updateCachedNote(nextNote)
      setSelectedNote(nextNote)
      setSelectedFile(null)
      setIsLocked(false)
      setFolderPath(folder)
      if (folder && !expandedFolders.includes(folder)) {
        setExpandedFolders((prev) => [...prev, folder])
      }
      await refreshTree()
    } catch (err) {
      setError(err instanceof FnsApiError ? err.message : "创建文档失败")
    }
  }

  async function handleCreateFile(targetFolder: string, name: string, type: NewFileType) {
    if (!vaultName) throw new FnsApiError('请先选择一个 Vault。')
    const option = newFileTypeOptions.find((item) => item.value === type)
    if (!option) throw new FnsApiError('不支持此文件类型。')
    const folder = targetFolder.replace(/^\/+|\/+$/g, '')
    const baseName = name.replace(/[\\/]+/g, '-').replace(/\.[^.]+$/i, '').trim()
    if (!baseName) throw new FnsApiError('请填写文件名称。')
    const existingInFolder = (folderNoteCache.current[folder] || []).map((item) => item.path)
    const extension = option.extension
    let candidateName = `${baseName}${extension}`
    let candidatePath = folder ? `${folder}/${candidateName}` : candidateName
    let counter = 1
    while (existingInFolder.includes(candidatePath)) {
      candidateName = `${baseName} ${counter}${extension}`
      candidatePath = folder ? `${folder}/${candidateName}` : candidateName
      counter += 1
    }

    const blob = await createBlankFile(type)
    const saved = await uploadFile(connection, vaultName, candidatePath, blob, Date.now())
    updateCachedFile(saved)
    await refreshTree()
    if (folder && !expandedFolders.includes(folder)) {
      setExpandedFolders((prev) => [...prev, folder])
    }
    setFolderPath(folder)
    openFile(saved)
  }

  async function handleCreateInlineFile(targetFolder: string, type: NewFileType) {
    try {
      await handleCreateFile(targetFolder, '未命名', type)
    } catch (err) {
      setError(err instanceof FnsApiError ? err.message : '创建文件失败。')
    }
  }

  async function handleCreateFolder(name: string) {
    if (createFolderParentPath === null) return
    const fullPath = createFolderParentPath ? `${createFolderParentPath}/${name}` : name
    await fnsApi.createFolder(connection, vaultName, fullPath)
    await refreshTree()
    if (createFolderParentPath && !expandedFolders.includes(createFolderParentPath)) {
      setExpandedFolders((prev) => [...prev, createFolderParentPath])
    }
  }

  async function handleDeleteFolder() {
    if (!deleteFolderTarget) return
    const path = deleteFolderTarget
    await fnsApi.deleteFolder(connection, vaultName, path)
    delete folderNoteCache.current[path]
    await refreshTree()
    if (folderPath === path || folderPath.startsWith(`${path}/`)) {
      setFolderPath("")
    }
    if (selectedNote && selectedNote.path.startsWith(`${path}/`)) {
      setSelectedNote(null)
    }
    if (selectedFile && selectedFile.path.startsWith(`${path}/`)) {
      setSelectedFile(null)
    }
    removeIconsUnderPath(path)
  }

  async function executeRename(item: { path: string; kind?: "note" | "file"; pathHash?: string; size?: number }, newNameOrPath: string) {
    const trimmed = newNameOrPath.trim()
    if (!trimmed) return
    const dir = parentPath(item.path)
    const isFull = trimmed.includes("/")
    let newPath = isFull ? normalizeDocumentPath(trimmed) : (dir ? `${dir}/${trimmed}` : trimmed)
    if (item.kind === "note" && !newPath.endsWith(".md")) {
      newPath += ".md"
    }
    if (newPath === item.path) return

    try {
      if (item.kind === "file") {
        await fnsApi.renameFile(connection, vaultName, item.path, newPath, item.pathHash)
        migrateIcon('file', item.path, newPath)
        if (selectedFile?.path === item.path) {
          setSelectedFile((prev) => (prev ? { ...prev, path: newPath } : null))
        }
      } else {
        const saved = await fnsApi.renameNote(connection, vaultName, item.path, newPath, item.pathHash)
        const detail = await fnsApi.getNote(connection, vaultName, saved.path)
        const nextNote: Note = { ...saved, ...detail, size: saved.size || detail.size || item.size || 0 }
        clearNoteDetailCache(vaultName)
        cacheNote(vaultName, nextNote)
        updateCachedNote(nextNote, item.path)
        migrateIcon('note', item.path, newPath)
        if (selectedNote?.path === item.path) {
          setSelectedNote(nextNote)
        }
      }
      await refreshTree()
    } catch (reason) {
      setError(reason instanceof FnsApiError ? reason.message : "重命名失败")
    }
  }

  async function handleRenameItem(newPath: string) {
    if (!renameItemTarget) return
    const item = renameItemTarget
    if (item.kind === "file") {
      await fnsApi.renameFile(connection, vaultName, item.path, newPath, item.pathHash)
      migrateIcon('file', item.path, newPath)
      if (selectedFile?.path === item.path) {
        setSelectedFile((prev) => (prev ? { ...prev, path: newPath } : null))
      }
    } else {
      const saved = await fnsApi.renameNote(connection, vaultName, item.path, newPath, item.pathHash)
      const detail = await fnsApi.getNote(connection, vaultName, saved.path)
      const nextNote: Note = { ...saved, ...detail, size: saved.size || detail.size || item.size }
      clearNoteDetailCache(vaultName)
      cacheNote(vaultName, nextNote)
      updateCachedNote(nextNote, item.path)
      migrateIcon('note', item.path, newPath)
      if (selectedNote?.path === item.path) {
        setSelectedNote(nextNote)
      }
    }
    await refreshTree()
  }

  async function handleMoveItem(item: LibraryItem, targetFolder: string) {
    const fileName = item.path.split('/').pop() || item.path
    const newPath = targetFolder ? `${targetFolder}/${fileName}` : fileName
    if (newPath === item.path) return
    if (item.kind === 'file') {
      await fnsApi.renameFile(connection, vaultName, item.path, newPath, item.pathHash)
      migrateIcon('file', item.path, newPath)
      const nextFile: FileSummary = { ...item, path: newPath }
      updateCachedFile(nextFile, item.path)
      if (selectedFile?.path === item.path) setSelectedFile(nextFile)
      updateDocumentTabsPath('file', item.path, newPath, undefined, nextFile)
    } else {
      const saved = await fnsApi.renameNote(connection, vaultName, item.path, newPath, item.pathHash)
      const detail = await fnsApi.getNote(connection, vaultName, saved.path)
      const nextNote: Note = { ...saved, ...detail, size: saved.size || detail.size || item.size || 0 }
      clearNoteDetailCache(vaultName)
      cacheNote(vaultName, nextNote)
      updateCachedNote(nextNote, item.path)
      migrateIcon('note', item.path, newPath)
      if (selectedNote?.path === item.path) setSelectedNote(nextNote)
      updateDocumentTabsPath('note', item.path, newPath, nextNote)
    }
    updateLocalRefPath(item.kind, item.path, newPath)
    await refreshTree()
  }

  async function handleDeleteItem() {
    if (!deleteItemTarget) return
    const item = deleteItemTarget
    if (item.kind === "file") {
      await fnsApi.deleteFile(connection, vaultName, item.path, item.pathHash)
      removeIconsUnderPath(item.path)
      if (selectedFile?.path === item.path) {
        setSelectedFile(null)
      }
    } else {
      await fnsApi.deleteNote(connection, vaultName, item.path, item.pathHash)
      removeIconsUnderPath(item.path)
      noteDetailCache.current.delete(noteCacheKey(vaultName, item.path))
      removeCachedNote(item.path)
      if (selectedNote?.path === item.path) {
        setSelectedNote(null)
      }
    }
    await refreshTree()
  }

  async function handleShareItem(item: LibraryItem) {
    if (item.kind !== "note") return
    try {
      const note = await fnsApi.getNote(connection, vaultName, item.path)
      setShareItemTarget(note)
    } catch {
      if (selectedNote?.path === item.path) setShareItemTarget(selectedNote)
    }
  }

  async function handleDownloadItem(item: LibraryItem) {
    if (item.kind !== 'file') return
    try {
      await downloadAttachment(connection, vaultName, item.path)
    } catch {
      setError('下载文件失败，请稍后重试。')
    }
  }

  async function refresh() {
    setIsRefreshing(true)
    clearNoteDetailCache(vaultName)
    if (vaultName) await loadVaultContent(vaultName)
    else await loadVaults()
    setIsRefreshing(false)
  }

  useEffect(() => {
    if (authState === 'authenticated' && !hasLoadedInitialConnection.current && connection.baseUrl && connection.token) {
      hasLoadedInitialConnection.current = true
      // Resolve the persisted vault against the server before loading content.
      // A stale default vault otherwise makes every task request fail with
      // “Note Vault does not exist” and leaves the task workspace unusable.
      setVaultName('')
      void loadVaults(connection)
    }
  }, [authState, connection])

  useEffect(() => {
    if (authState !== 'authenticated' || !vaultName || !connection.baseUrl || !connection.token) return
    void loadVaultContent(vaultName)
    // Loading relies on an explicit vault change or successful connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, vaultName])

  useEffect(() => {
    if (authState !== 'authenticated' || !connection.baseUrl || !connection.token || !vaultName || typeof WebSocket === 'undefined') return

    const activeConnection = connection
    const activeVault = vaultName
    let socket: WebSocket | null = null
    let reconnectTimer = 0
    let reconnectAttempt = 0
    let stopped = false
    let polling = false

    function refreshRealtimeTree() {
      void fnsApi.getFolderTree(activeConnection, activeVault)
        .then((result) => setTree(result.folders))
        .catch(() => {
          // A stale directory tree is preferable to surfacing a transient background error.
        })
    }

    async function refreshRealtimeSnapshot() {
      if (stopped || polling) return
      polling = true
      try {
        const currentFolder = folderPathRef.current
        const items = await loadFolderItems(activeVault, currentFolder, activeConnection)
        if (stopped) return
        const cache = { ...folderNoteCache.current, [currentFolder]: items }
        folderNoteCache.current = cache
        setFolderNotes(cache)
        if (folderPathRef.current === currentFolder) setNotes(items)

        const current = selectedNoteRef.current
        const summary = items.find((item) => item.kind === 'note' && item.path === current?.path)
        if (current && summary?.kind === 'note' && summary.mtime !== current.mtime) {
          const detail = await fnsApi.getNote(activeConnection, activeVault, current.path)
          if (stopped) return
          noteDetailCache.current.set(noteCacheKey(activeVault, current.path), detail)
          setSelectedNote((note) => note?.path === current.path ? { ...note, ...detail } : note)
          setOpenTabs((tabs) => tabs.map((tab) => tab.path === current.path && tab.note ? { ...tab, note: { ...tab.note, ...detail } } : tab))
        }
      } catch {
        // Realtime refresh is best effort; keep the currently displayed data on transient failures.
      } finally {
        polling = false
      }
    }

    function updateRemoteNote(data: JsonRecord) {
      const path = typeof data.path === 'string' ? data.path : ''
      if (!path) return

      const currentNote = selectedNoteRef.current?.path === path ? selectedNoteRef.current : null
      const cachedSummary = Object.values(folderNoteCache.current)
        .flat()
        .find((item) => item.kind === 'note' && item.path === path)
      const content = typeof data.content === 'string' ? data.content : currentNote?.content || ''
      const nextNote: Note = {
        id: typeof data.id === 'number' ? data.id : cachedSummary?.id || currentNote?.id || 0,
        path,
        pathHash: typeof data.pathHash === 'string' ? data.pathHash : cachedSummary?.pathHash || currentNote?.pathHash || '',
        content,
        contentHash: typeof data.contentHash === 'string' ? data.contentHash : currentNote?.contentHash || '',
        version: typeof data.version === 'number' ? data.version : currentNote?.version || 0,
        ctime: typeof data.ctime === 'number' ? data.ctime : currentNote?.ctime || 0,
        mtime: typeof data.mtime === 'number' ? data.mtime : cachedSummary?.mtime || currentNote?.mtime || 0,
        size: typeof data.size === 'number' ? data.size : new Blob([content]).size,
        updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : currentNote?.updatedAt,
        fileLinks: currentNote?.fileLinks,
      }
      const folder = parentPath(path)
      const cache = { ...folderNoteCache.current }
      if (cache[folder]) {
        cache[folder] = [
          ...cache[folder].filter((item) => item.path !== path),
          libraryNote(noteSummary(nextNote)),
        ]
      }
      folderNoteCache.current = cache
      setFolderNotes(cache)
      if (folderPathRef.current === folder) setNotes(cache[folder] || [])
      if (currentNote) setSelectedNote((current) => current?.path === path ? nextNote : current)
      noteDetailCache.current.set(noteCacheKey(activeVault, path), nextNote)
      refreshRealtimeTree()
    }

    function removeRemoteNote(data: JsonRecord) {
      const path = typeof data.path === 'string' ? data.path : ''
      if (!path) return
      const cache = { ...folderNoteCache.current }
      Object.keys(cache).forEach((folder) => {
        cache[folder] = cache[folder].filter((item) => item.path !== path)
      })
      folderNoteCache.current = cache
      setFolderNotes(cache)
      const folder = parentPath(path)
      if (folderPathRef.current === folder) setNotes(cache[folder] || [])
      noteDetailCache.current.delete(noteCacheKey(activeVault, path))
      if (selectedNoteRef.current?.path === path) setSelectedNote(null)
      refreshRealtimeTree()
    }

    function renameRemoteNote(data: JsonRecord) {
      const oldPath = typeof data.oldPath === 'string' ? data.oldPath : ''
      const path = typeof data.path === 'string' ? data.path : ''
      if (!oldPath || !path) return
      const existing = Object.values(folderNoteCache.current)
        .flat()
        .find((item) => item.kind === 'note' && item.path === oldPath)
      const cache = { ...folderNoteCache.current }
      Object.keys(cache).forEach((folder) => {
        cache[folder] = cache[folder].filter((item) => item.path !== oldPath && item.path !== path)
      })
      const nextFolder = parentPath(path)
      if (existing && cache[nextFolder]) {
        cache[nextFolder] = [
          ...cache[nextFolder],
          libraryNote({
            ...existing,
            path,
            pathHash: typeof data.pathHash === 'string' ? data.pathHash : existing.pathHash,
            mtime: typeof data.mtime === 'number' ? data.mtime : existing.mtime,
            size: typeof data.size === 'number' ? data.size : existing.size,
            updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : existing.updatedAt,
          }),
        ]
      }
      folderNoteCache.current = cache
      setFolderNotes(cache)
      if (folderPathRef.current === parentPath(oldPath) || folderPathRef.current === nextFolder) {
        setNotes(cache[folderPathRef.current] || [])
      }
      noteDetailCache.current.delete(noteCacheKey(activeVault, oldPath))

      if (selectedNoteRef.current?.path === oldPath) {
        void fnsApi.getNote(activeConnection, activeVault, path)
          .then((detail) => {
            const nextNote = { ...detail, size: detail.size || existing?.size || 0 }
            noteDetailCache.current.set(noteCacheKey(activeVault, path), nextNote)
            setSelectedNote((current) => current?.path === oldPath ? nextNote : current)
          })
          .catch(() => {
            setSelectedNote((current) => current?.path === oldPath ? null : current)
          })
      }
      refreshRealtimeTree()
    }

    function handleMessage(event: MessageEvent) {
      if (typeof event.data !== 'string') return
      const message = parseRealtimeMessage(event.data)
      if (!message) return
      if (message.action === 'Authorization') {
        if (message.envelope.status === true) reconnectAttempt = 0
        return
      }
      const messageVault = typeof message.envelope.vault === 'string' ? message.envelope.vault : ''
      if (messageVault !== activeVault) return
      const data = isRecord(message.envelope.data) ? message.envelope.data : {}

      if (message.action === 'NoteSyncModify') updateRemoteNote(data)
      else if (message.action === 'NoteSyncDelete') removeRemoteNote(data)
      else if (message.action === 'NoteSyncRename') renameRemoteNote(data)
      else if (message.action.startsWith('FolderSync')) refreshRealtimeTree()
    }

    function scheduleReconnect() {
      if (stopped || reconnectTimer) return
      const delay = Math.min(30000, 1000 * 2 ** reconnectAttempt)
      reconnectAttempt += 1
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = 0
        connectRealtime()
      }, delay)
    }

    function connectRealtime() {
      if (stopped) return
      let url: URL
      try {
        url = new URL(`${activeConnection.baseUrl.replace(/\/$/, '')}/api/user/sync`)
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        url.searchParams.set('client', activeConnection.clientType || 'webgui')
        url.searchParams.set('clientName', 'FNS Docs Viewer')
        url.searchParams.set('clientVersion', '0.1.0')
      } catch {
        return
      }

      const nextSocket = new WebSocket(url.toString())
      socket = nextSocket
      nextSocket.onopen = () => {
        nextSocket.send(`ClientInfo|${JSON.stringify({
          name: 'FNS Docs Viewer',
          version: '0.1.0',
          type: activeConnection.clientType || 'webgui',
          isDesktop: true,
        })}`)
        nextSocket.send(`Authorization|${activeConnection.token.trim()}`)
      }
      nextSocket.onmessage = handleMessage
      nextSocket.onerror = () => nextSocket.close()
      nextSocket.onclose = () => {
        if (socket === nextSocket) socket = null
        scheduleReconnect()
      }
    }

    connectRealtime()
    const pollTimer = window.setInterval(() => { void refreshRealtimeSnapshot() }, 5000)
    return () => {
      stopped = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      window.clearInterval(pollTimer)
      if (socket) socket.close()
      socket = null
    }
  }, [authState, connection.baseUrl, connection.clientType, connection.token, vaultName])

  if (authState === 'checking') {
    return (
      <main className="auth-checking">
        <div className="auth-checking-card">
          <BookOpenText size={28} />
          <strong>正在验证登录</strong>
          <span>请稍候...</span>
        </div>
      </main>
    )
  }

  if (authState !== 'authenticated') {
    return <LoginDialog onClose={() => undefined} onLogin={login} required />
  }

  return (
    <main className={`app-shell density-${settings.density}`} style={readerStyle}>
      <input ref={uploadInputRef} className="visually-hidden" type="file" onChange={(event) => void handleFileUpload(event)} aria-label="选择要上传的文件" />
      <input ref={coverInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/svg+xml" onChange={(event) => void handleCoverUpload(event)} aria-label="选择 Markdown 题头图" />
      <div className={`platform-container ${navigationCollapsed ? 'is-navigation-collapsed' : ''}`}>
        {/* Left Feature Activity Bar */}
        <nav className="platform-activity-bar" aria-label="主功能导航">
          <div className="activity-bar-top">
            <div className="activity-brand-row">
            <button
              type="button"
              className="activity-brand"
              onClick={() => handleTabClick('files')}
              title={`${getDesktopRuntime().isDesktop ? 'JieDocs' : '文档台'} - 知识库工作台`}
              aria-label={`${getDesktopRuntime().isDesktop ? 'JieDocs' : '文档台'} - 知识库工作台`}
            >
              {!getDesktopRuntime().isDesktop ? <div className="activity-brand-icon"><BookOpenText size={20} /></div> : null}
              <span className="activity-brand-copy"><strong>{getDesktopRuntime().isDesktop ? 'JieDocs' : '文档台'}</strong>{!getDesktopRuntime().isDesktop ? <small>知识工作空间</small> : null}</span>
            </button>
            <button
              type="button"
              className="activity-collapse-button"
              onClick={() => setNavigationCollapsed((value) => !value)}
              aria-label={navigationCollapsed ? '展开主导航' : '收起主导航'}
              aria-expanded={!navigationCollapsed}
              title={navigationCollapsed ? '展开主导航' : '收起主导航'}
            >
              {navigationCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
            </div>

            <div className="activity-bar-divider" />

            <div className="activity-nav-group" role="tablist" aria-label="主功能视图">
              <span className="activity-nav-heading" aria-hidden="true">工作空间</span>
              <button
                type="button"
                className={`activity-nav-item ${activeSidebarTab === 'files' && sidebarOpen ? 'is-active' : ''}`}
                onClick={() => handleTabClick('files')}
                role="tab"
                aria-selected={activeSidebarTab === 'files' && sidebarOpen}
                aria-label="文档知识库"
                title="文档知识库"
              >
                <FolderOpen size={19} />
                <span className="activity-nav-tooltip">文档知识库</span>
              </button>

              <button
                type="button"
                className={`activity-nav-item ${activeSidebarTab === 'search' && sidebarOpen ? 'is-active' : ''}`}
                onClick={() => handleTabClick('search')}
                role="tab"
                aria-selected={activeSidebarTab === 'search' && sidebarOpen}
                aria-label="全局检索"
                title="全局检索"
              >
                <Search size={19} />
                <span className="activity-nav-tooltip">全局检索</span>
              </button>

              <button
                type="button"
                className={`activity-nav-item ${activeSidebarTab === 'favorites' && sidebarOpen ? 'is-active' : ''}`}
                onClick={() => handleTabClick('favorites')}
                role="tab"
                aria-selected={activeSidebarTab === 'favorites' && sidebarOpen}
                aria-label="我的收藏"
                title={`我的收藏 (${favorites.length})`}
              >
                <Star size={19} fill={favorites.length > 0 ? 'currentColor' : 'none'} />
                {favorites.length > 0 ? (
                  <span className="activity-nav-badge">{favorites.length > 99 ? '99+' : favorites.length}</span>
                ) : null}
                <span className="activity-nav-tooltip">我的收藏</span>
              </button>

              <button
                type="button"
                className={`activity-nav-item ${activeSidebarTab === 'recents' && sidebarOpen ? 'is-active' : ''}`}
                onClick={() => handleTabClick('recents')}
                role="tab"
                aria-selected={activeSidebarTab === 'recents' && sidebarOpen}
                aria-label="最近访问"
                title={`最近访问 (${recents.length})`}
              >
                <Clock3 size={19} />
                {recents.length > 0 ? (
                  <span className="activity-nav-badge">{recents.length > 99 ? '99+' : recents.length}</span>
                ) : null}
                <span className="activity-nav-tooltip">最近访问</span>
              </button>

              <button
                type="button"
                className={`activity-nav-item ${activeSidebarTab === 'tasks' && sidebarOpen ? 'is-active' : ''}`}
                onClick={() => handleTabClick('tasks')}
                role="tab"
                aria-selected={activeSidebarTab === 'tasks' && sidebarOpen}
                aria-label="任务"
                title="任务"
              >
                <ListChecks size={19} />
                {tasks.filter((task) => !task.completed).length > 0 ? <span className="activity-nav-badge">{tasks.filter((task) => !task.completed).length > 99 ? '99+' : tasks.filter((task) => !task.completed).length}</span> : null}
                <span className="activity-nav-tooltip">任务</span>
              </button>

              <span className="activity-nav-heading is-tools" aria-hidden="true">扩展与工具</span>
              <button
                type="button"
                className={`activity-nav-item ${activeSidebarTab === 'platform-enhancements' && sidebarOpen ? 'is-active' : ''}`}
                onClick={() => handleTabClick('platform-enhancements')}
                role="tab"
                aria-selected={activeSidebarTab === 'platform-enhancements' && sidebarOpen}
                aria-label="插件"
                title={`插件 (${platformEnhancements.length} 个)`}
              >
                <Puzzle size={19} />
                {platformEnhancements.length > 0 ? (
                  <span className="activity-nav-badge is-accent">{platformEnhancements.length}</span>
                ) : null}
                <span className="activity-nav-tooltip">插件</span>
              </button>

              <button
                type="button"
                className={`activity-nav-item ${activeSidebarTab === 'skills' && sidebarOpen ? 'is-active' : ''}`}
                onClick={() => handleTabClick('skills')}
                role="tab"
                aria-selected={activeSidebarTab === 'skills' && sidebarOpen}
                aria-label="AI 技能库"
                title={`AI 技能库 (已启用 ${enabledSkillIds.length})`}
              >
                <Brain size={19} />
                {enabledSkillIds.length > 0 ? (
                  <span className="activity-nav-badge">{enabledSkillIds.length}</span>
                ) : null}
                <span className="activity-nav-tooltip">AI 技能库</span>
              </button>

              <button
                type="button"
                className={`activity-nav-item ${activeSidebarTab === 'ai-chat' ? 'is-active is-sparkle' : ''}`}
                onClick={() => handleTabClick('ai-chat')}
                role="tab"
                aria-selected={activeSidebarTab === 'ai-chat'}
                aria-label="AI 对话"
                title="AI 对话"
              >
                <MessageCircle size={19} />
                <span className="activity-nav-tooltip">AI 对话</span>
              </button>
            </div>
          </div>

          <div className="activity-bar-bottom">
            <button
              type="button"
              className="activity-nav-item is-utility"
              onClick={() => {
                const nextTheme = settings.theme === 'dark' ? 'light' : 'dark'
                updateSystemSettings({ theme: nextTheme })
              }}
              aria-label="切换浅色/深色主题"
              title={`切换主题 (当前: ${settings.theme === 'dark' ? '深色' : '浅色'})`}
            >
              {settings.theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
              <span className="activity-nav-tooltip">切换主题</span>
            </button>

            <button
              type="button"
              className="activity-nav-item is-utility"
              onClick={() => setShowSettings(true)}
              aria-label="系统偏好设置"
              title="系统设置"
            >
              <Settings2 size={19} />
              <span className="activity-nav-tooltip">系统设置</span>
            </button>

            <div className="activity-bar-divider" />

            <div className="activity-user-wrapper" ref={userMenuRef}>
              <button
                type="button"
                className={`activity-user-btn ${isUserMenuOpen ? 'is-open' : ''}`}
                onClick={() => setIsUserMenuOpen((prev) => !prev)}
                aria-label="用户中心与设置"
                aria-expanded={isUserMenuOpen}
                aria-haspopup="menu"
                title={getDesktopRuntime().isDesktop ? '桌面模式与设置' : connection.user ? `${connection.user.username} (点击打开用户中心与设置)` : '账号与设置'}
              >
                <div className="activity-avatar-circle">
                  {getDesktopRuntime().isDesktop ? <Database size={15} /> : connection.user?.username ? connection.user.username.charAt(0).toUpperCase() : <UserRound size={15} />}
                </div>
                <span className="activity-account-copy"><strong>{getDesktopRuntime().isDesktop ? (vaultName || '空间') : connection.user?.username || '账号与设置'}</strong><small>{getDesktopRuntime().isDesktop ? (vaultName ? '当前空间' : '未选择空间') : connection.user ? '已登录' : '未连接'}</small></span>
                <ChevronDown size={14} className="activity-account-chevron" aria-hidden="true" />
                <span className={`activity-status-dot ${connection.baseUrl && connection.token ? 'is-online' : 'is-offline'}`} />
              </button>

              {isUserMenuOpen ? (
                <div className="user-profile-dropdown activity-user-dropdown" role="menu">
                  <div className="user-dropdown-header">
                    <div className="user-dropdown-profile">
                      <span className="user-dropdown-avatar">
                        {getDesktopRuntime().isDesktop ? <Database size={18} /> : connection.user?.username ? connection.user.username.charAt(0).toUpperCase() : <UserRound size={18} />}
                      </span>
                      <div className="user-dropdown-meta">
                        <span className="user-dropdown-name">{getDesktopRuntime().isDesktop ? (vaultName || '空间') : connection.user?.username || '访客模式'}</span>
                        <span className="user-dropdown-email">
                          {getDesktopRuntime().isDesktop ? '本地 Markdown · 云同步按需开启' : connection.user?.email || (connection.baseUrl ? '自建同步服务' : '未连接服务')}
                        </span>
                      </div>
                    </div>
                    {!getDesktopRuntime().isDesktop ? <div className="user-dropdown-status-row">
                      <span className={`user-status-badge ${connection.baseUrl && connection.token ? 'is-connected' : ''}`}>
                        <span className="status-indicator-dot" />
                        {getDesktopRuntime().isDesktop ? (vaultName ? '空间已打开' : '未选择空间') : connection.user ? '已登录' : connection.baseUrl && connection.token ? '已连接' : '未连接'}
                      </span>
                      {connection.baseUrl ? (
                        <span className="user-service-url" title={connection.baseUrl}>
                          {connection.baseUrl.replace(/^https?:\/\//, '')}
                        </span>
                      ) : null}
                    </div> : null}
                  </div>

                  <div className="user-dropdown-divider" />

                  <div className="user-dropdown-body">
                    <button
                      type="button"
                      className="user-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setIsUserMenuOpen(false)
                        setShowSettings(true)
                      }}
                    >
                      <Settings2 size={16} className="user-item-icon" />
                      <div className="user-item-text">
                        <span className="user-item-title">系统设置</span>
                        <span className="user-item-desc">外观排版、目录排序与同步配置</span>
                      </div>
                    </button>
                  </div>

                  <div className="user-dropdown-divider" />

                  <div className="user-dropdown-footer">
                    {getDesktopRuntime().isDesktop ? (
                      <div className="user-menu-item"><Database size={16} className="user-item-icon" /><div className="user-item-text"><span className="user-item-title">空间管理</span><span className="user-item-desc">打开本地目录，云同步按需开启</span></div></div>
                    ) : connection.user ? (
                      <button
                        type="button"
                        className="user-menu-item is-danger"
                        role="menuitem"
                        onClick={() => {
                          setIsUserMenuOpen(false)
                          clearLocalSession()
                        }}
                      >
                        <LogOut size={16} className="user-item-icon" />
                        <div className="user-item-text">
                          <span className="user-item-title">退出登录</span>
                          <span className="user-item-desc">清除当前设备登录态与凭据</span>
                        </div>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="user-menu-item is-primary"
                        role="menuitem"
                        onClick={() => {
                          setIsUserMenuOpen(false)
                          setShowLogin(true)
                        }}
                      >
                        <LogIn size={16} className="user-item-icon" />
                        <div className="user-item-text">
                          <span className="user-item-title">账号登录</span>
                          <span className="user-item-desc">登录后开启云端同步与多端协作</span>
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </nav>

        {/* Platform Main Area */}
        <div className={`platform-main ${activeSidebarTab === 'tasks' ? 'is-task-main' : ''} ${activeSidebarTab === 'ai-chat' ? 'is-ai-main' : ''}`}>
          <header className="topbar">
            <div className={`topbar-breadcrumb ${openTabs.length ? 'has-document-tabs' : ''}`}>
              {activeSidebarTab === 'twofa' ? <span className="breadcrumb-vault"><ShieldCheck size={14} /><span>2FA 验证码</span></span> : activePlatformPlugin ? (
                <>
                  <span className="breadcrumb-vault" title="平台增强"><Puzzle size={14} /><span>平台增强</span></span>
                  <span className="breadcrumb-separator" aria-hidden="true">/</span>
                  <span className="breadcrumb-note">
                    {activePlatformPlugin === 'fns.twofa' ? <ShieldCheck size={14} /> : <Send size={14} />}
                    <span>{activePlatformPlugin === 'fns.twofa' ? '2FA 验证码' : '外部文档发布'}</span>
                  </span>
                </>
              ) : openTabs.length ? (
                <div className="document-tabs" role="tablist" aria-label="打开的文档">
                  {openTabs.map((tab) => (
                    <div
                      key={tab.key}
                      className={`document-tab ${tab.key === activeTabKey ? 'is-active' : ''}`}
                      role="tab"
                      aria-selected={tab.key === activeTabKey}
                      tabIndex={tab.key === activeTabKey ? 0 : -1}
                      title={tab.path}
                      onClick={() => activateDocumentTab(tab)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          activateDocumentTab(tab)
                        }
                      }}
                    >
                      {tab.kind === 'skill' ? <Puzzle size={14} /> : <DocumentRefIcon kind={tab.kind} path={tab.path} icon={getIcon(tab.kind, tab.path, tab.vault)} size={14} />}
                      <span className="document-tab-title">{tab.title}</span>
                      <button
                        type="button"
                        className="document-tab-close"
                        aria-label={`关闭 ${tab.title}`}
                        title={`关闭 ${tab.title}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          closeDocumentTab(tab.key)
                        }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : activeSkill ? (
                <>
                  <span className="breadcrumb-vault" title="技能库" onClick={() => handleTabClick('skills')} style={{ cursor: 'pointer' }}>
                    <Puzzle size={14} />
                    <span>技能库</span>
                  </span>
                  <span className="breadcrumb-separator" aria-hidden="true">/</span>
                  <span className="breadcrumb-note" title={activeSkill.path}>
                    <FileText size={14} />
                    <span>{activeSkill.name}.md</span>
                  </span>
                </>
              ) : (
                <>
                  <span className="breadcrumb-vault" title={`当前知识库: ${vaultName}`}>
                    <Folder size={14} />
                    <span>{vaultName || '知识库'}</span>
                  </span>
                  {selectedNote ? (
                    <>
                      <span className="breadcrumb-separator" aria-hidden="true">/</span>
                      <span className="breadcrumb-note" title={selectedNote.path}>
                        <DocumentRefIcon kind="note" path={selectedNote.path} icon={getIcon('note', selectedNote.path)} size={14} />
                        <span>{documentTitle(selectedNote.path)}</span>
                      </span>
                    </>
                  ) : null}
                </>
              )}
              <button
                type="button"
                className="document-tab-add"
                hidden={activeSidebarTab === 'twofa' || Boolean(activePlatformPlugin)}
                onClick={() => void handleCreateInlineDocument()}
                disabled={!vaultName || isLoading}
                aria-label="新建文档"
                title="新建文档"
              >
                <Plus size={17} />
              </button>
            </div>
            <button
              type="button"
              className="topbar-command-button"
              onClick={() => handleTabClick('search')}
              aria-label="打开全局检索"
              title="打开全局检索"
            >
              <Search size={15} />
              <span>搜索文档、任务或技能</span>
              <kbd>⌘ K</kbd>
            </button>
          </header>

          <div className={activeSidebarTab === 'twofa' ? 'workspace is-twofa-workspace' : activeSidebarTab === 'ai-chat' ? 'workspace is-ai-chat-workspace' : `workspace ${!activePlatformPlugin && activeSidebarTab !== 'tasks' && settings.showOutline && selectedNote && headings.length ? 'has-outline' : ''} ${isEditing ? 'is-editing' : ''} ${sidebarOpen ? '' : 'is-sidebar-collapsed'} ${activeSidebarTab === 'tasks' ? 'is-tasks-workspace' : ''}`}>
            {activeSidebarTab === 'twofa' ? <TwoFAPage key={`${connection.baseUrl}:${connection.user?.uid}:${connection.token}`} connection={connection} /> : activeSidebarTab === 'ai-chat' ? <AiChatWorkspace key={`${connection.baseUrl}:${connection.user?.uid}`} storageKey={`fns-docs-viewer.ai-chat:${connection.baseUrl}:${connection.user?.uid}`} connection={connection} vault={vaultName} /> : <>
            <aside className={`sidebar ${sidebarOpen ? '' : 'is-collapsed'}`}>
              {/* Conditional views in sidebar based on activeSidebarTab */}
              {activeSidebarTab === 'files' ? (
                <>
                  <div className="sidebar-header">
                    <label className="sidebar-search-box sidebar-header-search">
                      <Search size={14} className="sidebar-search-icon" aria-hidden="true" />
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="搜索标题和正文"
                        aria-label="搜索标题和正文"
                      />
                      {query ? <button type="button" className="sidebar-search-clear" onClick={() => setQuery('')} aria-label="清空搜索"><X size={13} /></button> : null}
                    </label>
                    <div className="sidebar-header-actions">
                      <button
                        type="button"
                        className="sidebar-upload-button"
                        onClick={() => beginUploadInFolder(folderPath)}
                        disabled={!vaultName || isLoading}
                        aria-label="上传文件"
                        title={folderPath ? `上传文件到 ${folderPath}` : '上传文件到知识库根目录'}
                      >
                        <Upload size={15} />
                        <span>上传</span>
                      </button>
                      <div className="sidebar-sort" ref={sortMenuRef}>
                        <button className="icon-button compact" onClick={() => setIsSortMenuOpen((value) => !value)} aria-label="目录排序" aria-haspopup="listbox" aria-expanded={isSortMenuOpen} title="目录排序">
                          {directorySort === 'name-asc' ? <ArrowDownAZ size={16} /> : directorySort === 'name-desc' ? <ArrowUpAZ size={16} /> : <ListOrdered size={16} />}
                        </button>
                        {isSortMenuOpen ? (
                          <div className="sidebar-sort-options" role="listbox" aria-label="目录排序方式">
                            {(Object.keys(directorySortLabels) as DirectorySortMode[]).map((mode) => (
                              <button
                                key={mode}
                                className={mode === directorySort ? 'is-selected' : ''}
                                role="option"
                                aria-selected={mode === directorySort}
                                onClick={() => {
                                  updateSystemSettings({ directorySort: mode })
                                  setIsSortMenuOpen(false)
                                }}
                              >
                                <span>{directorySortLabels[mode]}</span>
                                {mode === directorySort ? <Check size={15} /> : null}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <button className="icon-button compact" onClick={() => updateSystemSettings({ sidebarOpen: false })} aria-label="收起搜索" title="收起搜索"><PanelLeftClose size={17} /></button>
                    </div>
                  </div>
                  <nav
                    className="library-nav"
                    aria-label="搜索"
                    onContextMenu={(event) => {
                      const target = event.target as HTMLElement
                      if (target.closest('.tree-row, .note-row, .tree-row-more')) return
                      event.preventDefault()
                      const rect = event.currentTarget.getBoundingClientRect()
                      setActiveTreeMenu({
                        type: "folder",
                        path: "",
                        rect: { top: event.clientY, bottom: event.clientY, left: event.clientX, right: event.clientX },
                      })
                    }}
                  >
                    {!searchActive && favorites.length ? (
                      <div className="quick-links">
                        <section>
                          <h3>
                            <button className="quick-links-toggle" onClick={() => setQuickLinksOpen((current) => ({ ...current, favoritesOpen: !current.favoritesOpen }))} aria-expanded={quickLinksOpen.favoritesOpen}>
                              {quickLinksOpen.favoritesOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                              <Star size={14} />
                              <span>收藏</span>
                            </button>
                          </h3>
                          {quickLinksOpen.favoritesOpen ? (
                            <ul className="folder-documents quick-links-items">
                              {favorites.filter((item) => item.vault === vaultName).slice(0, 6).map((item) => (
                                <li key={`fav-${item.path}`}>
                                  <button className="note-row" onClick={() => openLocalRef(item)} title={item.path}>
                                    <span className="tree-toggle" aria-hidden="true" />
                                    <DocumentRefIcon kind={item.kind} path={item.path} icon={getIcon(item.kind, item.path, item.vault)} size={14} />
                                    <span className="tree-row-label">{documentDisplayTitle(item.kind, item.path)}</span>
                                    <DocumentTypeTag kind={item.kind} path={item.path} />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </section>
                      </div>
                    ) : null}
                    {searchActive ? (
                      <div className="search-results" aria-live="polite">
                        <div className="search-results-heading"><span>搜索结果</span><small>{isSearching ? '搜索中' : `${searchResults?.length ?? 0} 项`}</small></div>
                        {isSearching && searchResults === null ? <p className="muted-empty">正在搜索整个知识库...</p> : null}
                        {!isSearching && searchResults?.length === 0 ? <p className="muted-empty">没有找到匹配的文档</p> : null}
                        {searchResults?.length ? (
                          <ul className="folder-documents search-result-list">
                            {searchResults.map((item) => (
                              <li key={item.pathHash || item.path}>
                                <button className={`note-row ${selectedItem?.path === item.path ? 'is-active' : ''}`} onClick={() => openLibraryItem(item)} title={item.path}>
                                  <span className="tree-toggle" aria-hidden="true" />
                                  <LibraryItemIcon item={item} icon={getIcon(item.kind, item.path)} />
                                <span>{documentDisplayPath(item.kind, item.path)}</span>
                                  <DocumentTypeTag kind={item.kind} path={item.path} />
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : (
                      <>
                        {!connection.baseUrl || !connection.token ? (
                          <div className="sidebar-empty">连接 FNS 服务后<br />这里会显示你的 Vault 目录</div>
                        ) : null}
                        {tree.length > 0 ? (
                          <FolderTree
                            nodes={tree}
                            notesByFolder={visibleFolderNotes}
                            sortMode={directorySort}
                            currentPath={folderPath}
                            expandedFolders={expandedFolders}
                            selectedItemPath={selectedItem?.path}
                            onPickFolder={(path) => void pickFolder(path)}
                            onOpenItem={openLibraryItem}
                            onToggleFolder={toggleFolder}
                            activeTreeMenu={activeTreeMenu}
                            onOpenTreeMenu={setActiveTreeMenu}
                            inlineRenamingPath={inlineRenamingPath}
                            inlineRenamingDraft={inlineRenamingDraft}
                            onChangeInlineDraft={setInlineRenamingDraft}
                            onCommitInlineRename={(item) => {
                              void executeRename(item, inlineRenamingDraft)
                              setInlineRenamingPath(null)
                            }}
                            onCancelInlineRename={() => setInlineRenamingPath(null)}
                            getIcon={(kind, path) => getIcon(kind, path)}
                          />
                        ) : null}
                        {rootNotes.length ? (
                          <ul className="folder-documents root-documents">
                            {sortFolderItems(rootNotes, directorySort).map((item) => (
                              <li key={item.pathHash || item.path}>
                                <div
                                  className={`note-row ${selectedItem?.path === item.path ? "is-active" : ""}`}
                                  onClick={() => openLibraryItem(item)}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault()
                                      openLibraryItem(item)
                                    }
                                  }}
                                  title={item.path}
                                >
                                  <span className="tree-toggle" aria-hidden="true" />
                                  <LibraryItemIcon item={item} icon={getIcon(item.kind, item.path)} />
                                  {inlineRenamingPath === item.path ? (
                                    <input
                                      className="tree-inline-rename-input"
                                      value={inlineRenamingDraft}
                                      autoFocus
                                      onClick={(e) => e.stopPropagation()}
                                      onKeyDown={(e) => {
                                        e.stopPropagation()
                                        if (e.key === "Enter") {
                                          void executeRename(item, inlineRenamingDraft)
                                          setInlineRenamingPath(null)
                                        } else if (e.key === "Escape") {
                                          setInlineRenamingPath(null)
                                        }
                                      }}
                                      onChange={(e) => setInlineRenamingDraft(e.target.value)}
                                      onBlur={() => {
                                        setTimeout(() => {
                                          void executeRename(item, inlineRenamingDraft)
                                          setInlineRenamingPath(null)
                                        }, 100)
                                      }}
                                    />
                                  ) : (
                                    <span>{documentDisplayTitle(item.kind, item.path)}</span>
                                  )}
                                  <DocumentTypeTag kind={item.kind} path={item.path} />
                                  <button
                                    type="button"
                                    className={`tree-row-more ${activeTreeMenu?.type === "item" && activeTreeMenu.item.path === item.path ? "is-active" : ""}`}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      const rect = e.currentTarget.getBoundingClientRect()
                                      setActiveTreeMenu({
                                        type: "item",
                                        item,
                                        rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
                                      })
                                    }}
                                    aria-label="文档操作"
                                    title="更多操作"
                                  >
                                    <MoreHorizontal size={14} />
                                  </button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </>
                    )}
                  </nav>
                  <div className="note-list" aria-label="文档列表">
                    {!searchActive && !isLoading && vaultName && tree.length === 0 && rootNotes.length === 0 ? <p className="muted-empty">没有匹配的文档</p> : null}
                  </div>
                  {!getDesktopRuntime().isDesktop ? <VaultSwitcher value={vaultName} names={vaults.map((vault) => vault.vault)} onChange={setVaultName} onCreate={() => setShowCreateVault(true)} /> : null}
                </>
              ) : activeSidebarTab === 'search' ? (
                <>
                  <div className="sidebar-header">
                    <span className="sidebar-header-title"><Search size={15} aria-hidden="true" />全局检索</span>
                    <div className="sidebar-header-actions">
                      <button className="icon-button compact" onClick={() => updateSystemSettings({ sidebarOpen: false })} aria-label="收起侧栏" title="收起侧栏"><PanelLeftClose size={17} /></button>
                    </div>
                  </div>
                  <div className="sidebar-panel-content search-panel-view">
                    <div className="sidebar-search-box">
                      <Search size={14} className="sidebar-search-icon" />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="检索标题与正文..."
                        autoFocus
                      />
                      {query ? <button type="button" className="sidebar-search-clear" onClick={() => setQuery('')} aria-label="清空输入"><X size={13} /></button> : null}
                    </div>
                    <div className="search-results" aria-live="polite">
                      <div className="search-results-heading">
                        <span>{query.trim() ? `搜索结果 (${searchResults?.length ?? 0})` : '输入关键词检索知识库'}</span>
                        {isSearching ? <small>检索中...</small> : null}
                      </div>
                      {isSearching && searchResults === null ? <p className="muted-empty">正在搜索整个知识库...</p> : null}
                      {!isSearching && query.trim() && searchResults?.length === 0 ? <p className="muted-empty">没有找到包含 “{query}” 的文档</p> : null}
                      {!query.trim() ? (
                        <div className="sidebar-empty-tip">
                          <Search size={28} className="empty-tip-icon" />
                          <p>即时搜索标题与正文</p>
                          <span>输入任意关键词即可跨目录快速匹配</span>
                        </div>
                      ) : null}
                      {searchResults?.length ? (
                        <ul className="folder-documents search-result-list">
                          {searchResults.map((item) => (
                            <li key={item.pathHash || item.path}>
                              <button className={`note-row ${selectedItem?.path === item.path ? 'is-active' : ''}`} onClick={() => openLibraryItem(item)} title={item.path}>
                                <span className="tree-toggle" aria-hidden="true" />
                                <LibraryItemIcon item={item} icon={getIcon(item.kind, item.path)} />
                                <span>{documentDisplayPath(item.kind, item.path)}</span>
                                <DocumentTypeTag kind={item.kind} path={item.path} />
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : activeSidebarTab === 'favorites' ? (
                <>
                  <div className="sidebar-header">
                    <span className="sidebar-header-title">
                      <Star size={15} aria-hidden="true" />已收藏文档
                      {favorites.length > 0 ? <span className="sidebar-count-badge">{favorites.length}</span> : null}
                    </span>
                    <div className="sidebar-header-actions">
                      <button className="icon-button compact" onClick={() => updateSystemSettings({ sidebarOpen: false })} aria-label="收起侧栏" title="收起侧栏"><PanelLeftClose size={17} /></button>
                    </div>
                  </div>
                  <div className="sidebar-panel-content favorites-panel-view">
                    {favorites.length === 0 ? (
                      <div className="sidebar-empty-tip">
                        <Star size={30} className="empty-tip-icon" />
                        <p>暂无收藏文档</p>
                        <span>阅读文档时，在标题栏右上角点击星标即可快速加入收藏</span>
                      </div>
                    ) : (
                      <ul className="folder-documents favorites-list">
                        {favorites.map((item) => {
                          const isActive = selectedItem?.path === item.path && vaultName === item.vault
                          return (
                            <li key={`fav-all-${item.vault}-${item.path}`} className="favorite-item-wrap">
                              <button className={`note-row favorite-row ${isActive ? 'is-active' : ''}`} onClick={() => openLocalRef(item)} title={`${item.vault} / ${item.path}`}>
                                <DocumentRefIcon kind={item.kind} path={item.path} icon={getIcon(item.kind, item.path, item.vault)} size={14} />
                                <div className="favorite-text">
                                  <span className="favorite-title-line">
                                    <span className="favorite-title">{documentDisplayTitle(item.kind, item.path)}</span>
                                    <DocumentTypeTag kind={item.kind} path={item.path} />
                                  </span>
                                  <span className="favorite-meta">{item.vault} · {parentPath(item.path) || '根目录'}</span>
                                </div>
                              </button>
                              <button
                                type="button"
                                className="favorite-remove-btn"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  const key = `${item.vault}\u0000${item.kind}\u0000${item.path}`
                                  const next = favorites.filter((f) => `${f.vault}\u0000${f.kind}\u0000${f.path}` !== key)
                                  setFavorites(next)
                                  void configStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next))
                                }}
                                title="取消收藏"
                                aria-label="取消收藏"
                              >
                                <X size={13} />
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                </>
              ) : activeSidebarTab === 'recents' ? (
                <>
                  <div className="sidebar-header">
                    <span className="sidebar-header-title">
                      <Clock3 size={15} aria-hidden="true" />最近访问
                      {recents.length > 0 ? <span className="sidebar-count-badge">{recents.length}</span> : null}
                    </span>
                    <div className="sidebar-header-actions">
                      {recents.length > 0 ? (
                        <button
                          type="button"
                          className="sidebar-action-text-btn"
                          onClick={() => {
                            setRecents([])
                            void configStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify([]))
                          }}
                          title="清空访问历史"
                        >
                          清空
                        </button>
                      ) : null}
                      <button className="icon-button compact" onClick={() => updateSystemSettings({ sidebarOpen: false })} aria-label="收起侧栏" title="收起侧栏"><PanelLeftClose size={17} /></button>
                    </div>
                  </div>
                  <div className="sidebar-panel-content recents-panel-view">
                    {recents.length === 0 ? (
                      <div className="sidebar-empty-tip">
                        <Clock3 size={30} className="empty-tip-icon" />
                        <p>暂无浏览历史</p>
                        <span>打开文档后会自动记录在此处，方便快速回访</span>
                      </div>
                    ) : (
                      <ul className="folder-documents recents-list">
                        {recents.map((item) => {
                          const isActive = selectedItem?.path === item.path && vaultName === item.vault
                          const timeText = item.visitedAt ? formatRelativeTime(item.visitedAt) : ""
                          const dirPath = parentPath(item.path)
                          return (
                            <li key={`rec-all-${item.vault}-${item.path}`} className="recent-item-wrap">
                              <button className={`note-row recent-row ${isActive ? "is-active" : ""}`} onClick={() => openLocalRef(item)} title={`${item.vault} / ${item.path}`}>
                                <div className="recent-row-icon">
                                  <DocumentRefIcon kind={item.kind} path={item.path} icon={getIcon(item.kind, item.path, item.vault)} />
                                </div>
                                <span className="recent-title-line">
                                  <span className="recent-title">{documentDisplayTitle(item.kind, item.path)}</span>
                                  <DocumentTypeTag kind={item.kind} path={item.path} />
                                  {timeText ? <span className="recent-time-badge">{timeText}</span> : null}
                                </span>
                              </button>
                              <button
                                type="button"
                                className="recent-remove-btn"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  const key = `${item.vault}\u0000${item.kind}\u0000${item.path}`
                                  const next = recents.filter((r) => `${r.vault}\u0000${r.kind}\u0000${r.path}` !== key)
                                  setRecents(next)
                                  void configStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(next))
                                }}
                                title="从访问历史移除"
                                aria-label="移除记录"
                              >
                                <X size={13} />
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                </>
              ) : activeSidebarTab === 'tasks' ? (
                <TaskPanel
                  folders={tree}
                  tasks={tasks}
                  scope={taskScope}
                  status={taskStatus}
                  query={taskQuery}
                  isLoading={isTaskLoading}
                  progress={taskProgress}
                  onScopeChange={setTaskScope}
                  onStatusChange={setTaskStatus}
                  onQueryChange={setTaskQuery}
                  onOpen={openTask}
                  onToggle={(task) => void toggleTask(task)}
                  onPriorityChange={(task, priority) => void setTaskPriority(task, priority)}
                  taskDocuments={taskDocuments}
                  onAddTask={addTask}
                />
              ) : activeSidebarTab === 'platform-enhancements' ? (
                <>
                  <div className="sidebar-header">
                    <span className="sidebar-header-title">
                      <Puzzle size={15} aria-hidden="true" />插件中心
                      <span className="sidebar-count-badge is-accent">{platformEnhancements.length}</span>
                    </span>
                    <div className="sidebar-header-actions">
                      <button className="icon-button compact" onClick={() => updateSystemSettings({ sidebarOpen: false })} aria-label="收起侧栏" title="收起侧栏"><PanelLeftClose size={17} /></button>
                    </div>
                  </div>
                  <div className="sidebar-panel-content skills-panel-view">
                    <div className="sidebar-section-label">可用插件</div>
                    <div className="sidebar-platform-plugin-list">
                      {platformEnhancements.map((plugin) => {
                        const PluginIcon = plugin.icon
                        return (
                          <button
                            type="button"
                            key={plugin.id}
                            className={`sidebar-platform-plugin-card ${activePlatformPlugin === plugin.id ? 'is-selected' : ''}`}
                            onClick={(event) => {
                              // Keep plugin activation inside the current docs workbench. These cards
                              // are controls rather than links, so never allow a surrounding browser
                              // handler to turn a click into navigation.
                              event.preventDefault()
                              event.stopPropagation()
                              openPlatformPlugin(plugin.id)
                            }}
                          >
                            <span className="sidebar-platform-plugin-icon"><PluginIcon size={15} /></span>
                            <span className="sidebar-platform-plugin-copy">
                              <strong>{plugin.name}</strong>
                              <small>{plugin.description}</small>
                            </span>
                            <ChevronRight size={15} />
                          </button>
                        )
                      })}
                    </div>
                    <div className="sidebar-empty-tip platform-plugin-empty-tip">
                      <Puzzle size={24} className="empty-tip-icon" />
                      <p>插件在当前工作台内运行</p>
                      <span>配置、发布和任务状态不会跳转到独立页面。</span>
                    </div>
                  </div>
                </>
              ) : activeSidebarTab === 'skills' ? (
                <>
                  <div className="sidebar-header">
                    <span className="sidebar-header-title">
                      <Brain size={15} aria-hidden="true" />AI 技能库
                      <span className="sidebar-count-badge is-accent">{enabledSkillIds.filter((id) => availableSkills.some((s) => s.id === id)).length}/{availableSkills.length}</span>
                    </span>
                    <div className="sidebar-header-actions">
                      <button
                        type="button"
                        className="sidebar-action-text-btn sidebar-install-skill-btn"
                        onClick={() => setShowInstallSkill(true)}
                        title="安装新技能 (精选库或自定义)"
                      >
                        <Plus size={13} /> 安装
                      </button>
                      <button
                        type="button"
                        className="sidebar-action-text-btn"
                        onClick={selectAllSkills}
                        title="启用所有技能"
                      >
                        全选
                      </button>
                      <button
                        type="button"
                        className="sidebar-action-text-btn"
                        onClick={clearAllSkills}
                        disabled={enabledSkillIds.length === 0}
                        title="清空选中的技能"
                      >
                        清空
                      </button>
                      <button className="icon-button compact" onClick={() => updateSystemSettings({ sidebarOpen: false })} aria-label="收起侧栏" title="收起侧栏"><PanelLeftClose size={17} /></button>
                    </div>
                  </div>
                  <div className="sidebar-panel-content skills-panel-view">
                    <div className="sidebar-section-label">可挂载技能</div>
                    <div className="sidebar-search-box">
                      <Search size={14} className="sidebar-search-icon" />
                      <input
                        value={sidebarSkillFilter}
                        onChange={(e) => setSidebarSkillFilter(e.target.value)}
                        placeholder="搜索技能名称或描述..."
                      />
                      {sidebarSkillFilter ? (
                        <button type="button" className="sidebar-search-clear" onClick={() => setSidebarSkillFilter('')} aria-label="清空">
                          <X size={13} />
                        </button>
                      ) : null}
                    </div>

                    <div className="sidebar-skills-cats">
                      {[
                        { id: 'all', label: `全部 (${availableSkills.length})` },
                        { id: 'workspace', label: `项目内建 (${availableSkills.filter((s) => s.source === 'workspace').length})` },
                        { id: 'custom', label: `自定义 (${availableSkills.filter((s) => s.source === 'custom').length})` },
                        { id: 'codex', label: `Codex (${availableSkills.filter((s) => s.source === 'codex').length})` },
                        { id: 'agents', label: `Agents (${availableSkills.filter((s) => s.source === 'agents').length})` },
                        { id: 'system', label: `系统 (${availableSkills.filter((s) => s.source === 'system').length})` },
                      ].filter((cat) => cat.id === 'all' || availableSkills.some((s) => s.source === cat.id)).map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          className={`sidebar-cat-pill ${sidebarSkillCategory === cat.id ? 'is-active' : ''}`}
                          onClick={() => setSidebarSkillCategory(cat.id as any)}
                        >
                          {cat.label}
                        </button>
                      ))}
                    </div>

                    <div className="sidebar-skills-list">
                      {filteredSkills.length === 0 ? (
                        <div className="sidebar-empty-tip">
                          <Puzzle size={28} className="empty-tip-icon" />
                          <p>{availableSkills.length === 0 ? '服务器暂未检测到 Skill 技能' : '未找到匹配技能'}</p>
                          {availableSkills.length === 0 && (
                            <span className="sidebar-empty-subtext" style={{ fontSize: 11, color: 'var(--shell-muted)', textAlign: 'center', marginTop: 4, lineHeight: 1.4 }}>
                              可存放在仓库 <code>skills/</code> 目录，或配置 <code>SKILLS_DIR</code> 环境变量挂载。
                            </span>
                          )}
                        </div>
                      ) : (
                        filteredSkills.map((skill) => {
                          const isEnabled = enabledSkillIds.includes(skill.id)
                          const isSelected = activeSkill?.id === skill.id
                          return (
                            <div
                              key={skill.id}
                              className={`sidebar-skill-card ${isEnabled ? 'is-enabled' : ''} ${isSelected ? 'is-selected' : ''}`}
                              onClick={() => openSkill(skill)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openSkill(skill) }}
                              title="点击在主区域查看 Skill Markdown 规范"
                            >
                              <div className="sidebar-skill-card-top">
                                <div className="sidebar-skill-name-row">
                                  <strong className="sidebar-skill-name">{skill.name}</strong>
                                  <span className={`sidebar-skill-source-tag is-${skill.source}`}>
                                    {skill.source === 'workspace' ? '项目' : skill.source === 'custom' ? '自定义' : skill.source === 'system' ? '内置' : skill.source === 'codex' ? 'Codex' : 'Agents'}
                                  </span>
                                </div>
                                <div className="sidebar-skill-switch-wrap" onClick={(e) => e.stopPropagation()}>
                                  <label className="sidebar-skill-switch" title={isEnabled ? '点击禁用' : '点击启用'}>
                                    <input
                                      type="checkbox"
                                      checked={isEnabled}
                                      onChange={() => toggleSkill(skill.id)}
                                    />
                                    <span className="slider" />
                                  </label>
                                </div>
                              </div>
                              <p className="sidebar-skill-desc">{skill.description}</p>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </aside>

        {sidebarOpen ? <button className="sidebar-scrim" onClick={() => updateSystemSettings({ sidebarOpen: false })} aria-label="关闭目录" /> : null}

        {!sidebarOpen ? <button className="reopen-sidebar" onClick={() => updateSystemSettings({ sidebarOpen: true })} title="展开目录" aria-label="展开目录"><PanelLeftOpen size={18} /></button> : null}

        <section className={`reader-area${isSpreadsheetContent ? ' reader-area-spreadsheet' : ''}${selectedFile && isUniverFilePath(selectedFile.path) ? ' reader-area-office' : ''}${activePlatformPlugin === 'fns.twofa' ? ' reader-area-twofa' : ''}`} ref={readerAreaRef}>
          {error ? <div className="error-banner"><span className="error-banner-message"><CircleAlert size={17} /><span>{displayError(error)}</span></span></div> : null}
          {isLoading || isDocumentLoading ? <ReaderLoading /> : null}
          {!isLoading && !isDocumentLoading ? (
            <>
              {activePlatformPlugin === 'fns.transfer' ? (
                <TransferPluginPanel
                  connection={connection}
                  vaults={vaults}
                  initialVault={vaultName}
                  selectedNote={selectedNote}
                  onClose={closePlatformPlugin}
                />
              ) : activePlatformPlugin === 'fns.twofa' ? (
                <TwoFAPage
                  key={`${connection.baseUrl}:${connection.user?.uid}:${connection.token}`}
                  connection={connection}
                  onClose={closePlatformPlugin}
                />
              ) : (
                <>
              {selectedItem ? (
                <div className={`document-meta reader-meta${selectedFile && isUniverFilePath(selectedFile.path) ? ' reader-meta-spreadsheet' : ''}`}>
                  <div className="reader-meta-inner">
                    <div className="reader-meta-title-group">
                      {readerIconKind && selectedItem && !(selectedNote && documentCover(parsedDocument.data)?.value) ? (
                        <button
                          type="button"
                          className={`reader-document-icon-trigger${readerIcon ? ' has-icon' : ''}`}
                          onClick={() => setIconPickerTarget({ kind: readerIconKind, path: selectedItem.path, vault: vaultName })}
                          aria-label={readerIcon ? '更换文档表情图标' : '添加文档表情图标'}
                          title={readerIcon ? '更换表情图标' : '添加表情图标'}
                        >
                          <DocumentRefIcon kind={readerIconKind} path={selectedItem.path} icon={readerIcon} size={20} />
                        </button>
                      ) : null}
                      {!activeSkill && selectedNote && isReaderRenaming ? (
                        <input
                          className="reader-meta-name-input"
                          value={readerRenamingDraft}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              void executeRename(selectedNote, readerRenamingDraft)
                              setIsReaderRenaming(false)
                            } else if (e.key === "Escape") {
                              setIsReaderRenaming(false)
                            }
                          }}
                          onChange={(e) => setReaderRenamingDraft(e.target.value)}
                          onBlur={() => {
                            void executeRename(selectedNote, readerRenamingDraft)
                            setIsReaderRenaming(false)
                          }}
                        />
                      ) : (
                        <span
                          className="reader-meta-name"
                          title={activeSkill ? activeSkill.path : selectedItem.path}
                          onDoubleClick={() => {
                            if (!activeSkill && selectedNote) {
                              setReaderRenamingDraft(documentTitle(selectedNote.path))
                              setIsReaderRenaming(true)
                            }
                          }}
                        >
                          {activeSkill ? activeSkill.name : documentTitle(selectedItem.path)}
                        </span>
                      )}
                      {activeSkill ? (
                        <span className="reader-meta-path" title={activeSkill.name}>
                          <span className={`sidebar-skill-source-tag is-${activeSkill.source}`} style={{ marginRight: 6 }}>
                            {activeSkill.source === 'workspace' ? '项目' : activeSkill.source === 'custom' ? '自定义' : '内置'}
                          </span>
                        </span>
                      ) : null}
                    </div>
                    <span className="reader-meta-actions">
                      <span className="reader-meta-save-status" ref={setEditorSaveStatusTarget} />
                      {activeSkill ? (
                        <>
                          <span className="reader-meta-details">{formatSize(activeSkill.content?.length || 0)} · Markdown 规范</span>
                          <button
                            type="button"
                            className={`reader-skill-toggle-pill ${enabledSkillIds.includes(activeSkill.id) ? 'is-enabled' : ''}`}
                            onClick={() => toggleSkill(activeSkill.id)}
                            title={enabledSkillIds.includes(activeSkill.id) ? '点击在 AI 助手禁用' : '点击在 AI 助手启用'}
                          >
                            {enabledSkillIds.includes(activeSkill.id) ? <Check size={13} /> : <Plus size={13} />}
                            <span>{enabledSkillIds.includes(activeSkill.id) ? '已在 AI 助手启用' : '在 AI 助手启用'}</span>
                          </button>
                          <button
                            type="button"
                            className="icon-button compact reader-action"
                            onClick={() => {
                              void navigator.clipboard.writeText(activeSkill.path)
                              setCopiedSkillPath(true)
                              setTimeout(() => setCopiedSkillPath(false), 2000)
                            }}
                            title={copiedSkillPath ? '已复制物理路径' : '复制物理路径'}
                            aria-label="复制物理路径"
                          >
                            {copiedSkillPath ? <Check size={15} color="#10b981" /> : <Copy size={15} />}
                          </button>
                          <button
                            type="button"
                            className={`icon-button compact reader-action ${showPiAssistant ? 'is-active' : ''}`}
                            onClick={() => { setShowPiAssistant((prev) => !prev) }}
                            title={showPiAssistant ? '关闭 AI 助手' : '打开 AI 助手'}
                            aria-label="AI 助手"
                          >
                            <Sparkles size={15} />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="reader-meta-details">{formatTime(selectedItem.updatedAt || selectedItem.mtime)} · {formatSize(selectedItem.size)}</span>
                          {selectedNote ? (
                            <>
                              <button className={`icon-button compact reader-action ${favoriteKey && favorites.some((entry) => `${entry.vault}\u0000${entry.kind}\u0000${entry.path}` === favoriteKey) ? 'is-favorite' : ''}`} onClick={toggleFavorite} aria-label="收藏文档" title="收藏文档"><Star size={16} fill={favorites.some((entry) => `${entry.vault}\u0000${entry.kind}\u0000${entry.path}` === favoriteKey) ? 'currentColor' : 'none'} /></button>
                              <button className={`icon-button compact reader-action ${isLocked ? 'is-active is-locked' : ''}`} onClick={() => setIsLocked((prev) => !prev)} aria-label={isLocked ? '已锁定（点击解锁编辑）' : '未锁定（点击锁定文档）'} title={isLocked ? '已锁定（禁止修改），点击解锁' : '未锁定，点击锁定文档（禁止修改）'}>{isLocked ? <Lock size={16} /> : <Unlock size={16} />}</button>
                              <span className="reader-action-menu" ref={documentActionMenuRef}>
                                <button className="icon-button compact reader-action" onClick={() => setIsDocumentActionMenuOpen((value) => !value)} aria-label="更多文档操作" title="更多文档操作" aria-haspopup="menu" aria-expanded={isDocumentActionMenuOpen}><MoreHorizontal size={17} /></button>
                                {isDocumentActionMenuOpen ? (
                                  <span className="reader-action-menu-options" role="menu" aria-label="更多文档操作">
                                    <button role="menuitem" onClick={() => { setShowPiAssistant((prev) => !prev); setIsDocumentActionMenuOpen(false) }}>
                                      <Sparkles size={15} />{showPiAssistant ? "关闭 AI 助手" : "AI 助手"}
                                    </button>
                                    <button role="menuitem" onClick={() => { setShowShare(true); setIsDocumentActionMenuOpen(false) }}>
                                      <Share2 size={15} />分享文档
                                    </button>
                                    <button role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={(e) => {
                                      e.stopPropagation()
                                      if (selectedNote) {
                                        setReaderRenamingDraft(documentTitle(selectedNote.path))
                                        setIsReaderRenaming(true)
                                      }
                                      setIsDocumentActionMenuOpen(false)
                                    }}>
                                      <FileText size={15} />重命名
                                    </button>
                                    <button role="menuitem" onClick={() => {
                                      if (selectedNote) setMoveItemTarget(libraryNote(noteSummary(selectedNote)))
                                      setIsDocumentActionMenuOpen(false)
                                    }}>
                                      <Folder size={15} />移动到目录
                                    </button>
                                    <button role="menuitem" onClick={() => {
                                      if (selectedNote) setIconPickerTarget({ kind: 'note', path: selectedNote.path, vault: vaultName })
                                      setIsDocumentActionMenuOpen(false)
                                    }}>
                                      <Smile size={15} />{getIcon('note', selectedNote.path) ? '更换表情图标' : '设置表情图标'}
                                    </button>
                                    <button role="menuitem" onClick={() => {
                                      if (selectedNote) {
                                        navigator.clipboard.writeText(selectedNote.path)
                                      }
                                      setIsDocumentActionMenuOpen(false)
                                    }}>
                                      <Copy size={15} />复制路径
                                    </button>
                                    <button role="menuitem" onClick={() => { toggleFavorite(); setIsDocumentActionMenuOpen(false) }}>
                                      <Star size={15} fill={favoriteKey && favorites.some((entry) => `${entry.vault}\u0000${entry.kind}\u0000${entry.path}` === favoriteKey) ? "currentColor" : "none"} />
                                      {favoriteKey && favorites.some((entry) => `${entry.vault}\u0000${entry.kind}\u0000${entry.path}` === favoriteKey) ? "取消收藏" : "收藏文档"}
                                    </button>
                                    <div className="reader-action-menu-divider" />
                                    <button className="is-danger" role="menuitem" onClick={() => { setShowDelete(true); setIsDocumentActionMenuOpen(false) }}>
                                      <Trash2 size={15} />删除文档
                                    </button>
                                  </span>
                                ) : null}
                              </span>
                            </>
                          ) : null}
                        </>
                      )}
                    </span>
                  </div>
                </div>
              ) : null}
              {selectedNote && !activeSkill && !hasSpreadsheetPreview ? (
                <DocumentCover
                  cover={documentCover(parsedDocument.data)?.value}
                  icon={readerIcon}
                  connection={connection}
                  vault={vaultName}
                  notePath={selectedNote.path}
                  fileLinks={selectedNote.fileLinks}
                  editable={isEditing}
                  isBusy={isCoverBusy}
                  onChoose={() => coverInputRef.current?.click()}
                  onRandom={() => void handleRandomCover()}
                  onRemove={() => void removeDocumentCover()}
                  onIconClick={() => selectedNote && setIconPickerTarget({ kind: 'note', path: selectedNote.path, vault: vaultName })}
                />
              ) : null}
              {!isLocked && selectedNote && !activeSkill && !hasSpreadsheetPreview ? (
                <InlineMarkdownEditor
                  key={selectedNote.path}
                  saveStatusTarget={editorSaveStatusTarget}
                  content={currentMarkdown}
                  frontmatter={parsedDocument.data}
                  connection={connection}
                  vault={vaultName}
                  notePath={selectedNote.path}
                  fileLinks={selectedNote.fileLinks}
                  onSelectionAI={(request) => {
                    setInlineAiRequest({ ...request, id: Date.now() })
                  }}
                  onSave={async (nextContent) => {
                    const frontmatterMatch = /^---\s*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(selectedNote.content)
                    const fullContent = frontmatterMatch ? `${frontmatterMatch[0]}${nextContent}` : nextContent
                    await saveDocument({ path: selectedNote.path, content: fullContent, createOnly: false })
                  }}
                />
              ) : <article className={`document-reader${selectedItem ? '' : ' is-empty-preview'}${isSpreadsheetContent ? ' document-reader-spreadsheet' : ''}${selectedFile && isUniverFilePath(selectedFile.path) ? ' document-reader-univer' : ''}`}>
              {selectedFile ? <FilePreview file={selectedFile} connection={connection} vault={vaultName} saveStatusTarget={editorSaveStatusTarget} onSaved={(nextFile) => { setSelectedFile(nextFile); updateCachedFile(nextFile) }} /> : (
                <>
                  {!hasSpreadsheetPreview ? <DocumentProperties data={parsedDocument.data} /> : null}
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h1: ({ children }) => <h1 id={slugify(getNodeText(children))}>{children}</h1>,
                      h2: ({ children }) => <h2 id={slugify(getNodeText(children))}>{children}</h2>,
                      h3: ({ children }) => <h3 id={slugify(getNodeText(children))}>{children}</h3>,
                      h4: ({ children }) => <h4 id={slugify(getNodeText(children))}>{children}</h4>,
                      h5: ({ children }) => <h5 id={slugify(getNodeText(children))}>{children}</h5>,
                      h6: ({ children }) => <h6 id={slugify(getNodeText(children))}>{children}</h6>,
                      pre: ({ children }) => {
                        const child = Array.isArray(children) ? children[0] : children
                        return isValidElement(child) ? cloneElement(child, { isBlock: true } as any) : <pre>{children}</pre>
                      },
                      code: (props) => <MarkdownCode {...props} editable={Boolean(selectedNote) && !isLocked} onSpreadsheetSave={saveSpreadsheetBlock} />,
                      table: ({ children }) => <div className="table-wrap"><table>{children}</table></div>,
                      a: ({ href, children }) => {
                        if (href?.startsWith('#fns-note:')) {
                          const target = decodeURIComponent(href.slice('#fns-note:'.length))
                          return <button className="document-link" onClick={() => openLinkedNote(target)}>{children}</button>
                        }
                        return <a href={href} target={href?.startsWith('http') ? '_blank' : undefined} rel={href?.startsWith('http') ? 'noreferrer' : undefined}>{children}</a>
                      },
                      img: ({ src, alt }) => (
                        <DocumentAttachment
                          src={src}
                          alt={alt}
                          connection={connection}
                          vault={vaultName}
                          notePath={selectedNote?.path || ''}
                          fileLinks={selectedNote?.fileLinks}
                        />
                      ),
                    }}
                  >
                    {currentMarkdown}
                  </ReactMarkdown>
                </>
              )}
              </article>}
              {!selectedItem && activeSidebarTab === 'files' && !activePlatformPlugin ? (
                <WorkspaceHome
                  vaultName={vaultName}
                  noteCount={vaults.find((vault) => vault.vault === vaultName)?.noteCount || 0}
                  openTaskCount={tasks.filter((task) => !task.completed).length}
                  favoriteCount={favorites.filter((item) => item.vault === vaultName).length}
                  enabledSkillCount={enabledSkillIds.length}
                  recents={recents}
                  onOpenRecent={openLocalRef}
                  onOpenLocal={getDesktopRuntime().isLocal ? () => void openLocalFolder() : undefined}
                  onCreate={() => void handleCreateInlineDocument()}
                  onSearch={() => handleTabClick('search')}
                  onTasks={() => handleTabClick('tasks')}
                  onFavorites={() => handleTabClick('favorites')}
                  onSkills={() => handleTabClick('skills')}
                  getIcon={getIcon}
                />
              ) : null}
                </>
              )}
            </>
          ) : null}
        </section>

        {!activePlatformPlugin && activeSidebarTab !== 'tasks' && settings.showOutline && selectedNote && headings.length ? (
          <DocumentOutline headings={headings} activeId={activeHeadingId} onJump={jumpToHeading} />
        ) : null}
            </>}
          </div>
        </div>
      </div>
      {showSettings ? <SystemSettingsDialog connection={connection} currentVault={vaultName} settings={settings} vaults={vaults} onClose={() => setShowSettings(false)} onClearCache={clearFolderCache} onOpenConnection={() => { setShowSettings(false); setShowLogin(true) }} onRefresh={() => void refresh()} onReset={resetSystemSettings} onUpdateConnection={updateStoredConnection} onUpdateSettings={updateSystemSettings} /> : null}
      {!getDesktopRuntime().isDesktop && showLogin ? <LoginDialog onClose={() => setShowLogin(false)} onLogin={login} /> : null}
      {editorMode === "create" ? <DocumentEditorDialog key={`create-${createInitialPath || folderPath}`} note={null} initialPath={createInitialPath || (folderPath ? `${folderPath}/未命名.md` : "未命名.md")} onClose={() => { setEditorMode(null); setCreateInitialPath(null); }} onSave={async (draft) => { await saveDocument(draft); setEditorMode(null); setCreateInitialPath(null); setIsLocked(false); }} /> : null}
      {showCreateVault ? <CreateVaultDialog onClose={() => setShowCreateVault(false)} onCreate={createVault} /> : null}
      {taskMarkdownEdit ? (
        <TaskMarkdownDialog
          task={taskMarkdownEdit.task}
          note={taskMarkdownEdit.note}
          isLoading={taskMarkdownEdit.isLoading}
          error={taskMarkdownEdit.error}
          connection={connection}
          vault={vaultName}
          onClose={() => { taskMarkdownEditRequest.current += 1; setTaskMarkdownEdit(null) }}
          onSave={saveTaskMarkdown}
          onOpenDocument={() => openTaskDocument(taskMarkdownEdit.task)}
        />
      ) : null}
      {/* showRename removed - now inline */}
      {showDelete && selectedNote ? <DeleteDocumentDialog note={selectedNote} onClose={() => setShowDelete(false)} onDelete={deleteDocument} /> : null}
      {showShare && selectedNote ? <ShareDialog connection={connection} vaultName={vaultName} note={selectedNote} onClose={() => setShowShare(false)} /> : null}
      {showInstallSkill ? (
        <InstallSkillDialog
          availableSkills={availableSkills}
          onClose={() => setShowInstallSkill(false)}
          onInstalled={(newSkill, allSkills) => {
            setAvailableSkills(allSkills)
            setEnabledSkillIds((prev) => Array.from(new Set([...prev, newSkill.id])))
            try {
              const updated = Array.from(new Set([...enabledSkillIds, newSkill.id]))
              localStorage.setItem('fns-pi-enabled-skills', JSON.stringify(updated))
            } catch {}
            openSkill(newSkill)
          }}
        />
      ) : null}
      {/* renameItemTarget removed - now inline */}
      {deleteItemTarget ? <DeleteDocumentDialog note={deleteItemTarget} onClose={() => setDeleteItemTarget(null)} onDelete={handleDeleteItem} /> : null}
      {moveItemTarget ? <MoveItemDialog item={moveItemTarget} folders={tree} onClose={() => setMoveItemTarget(null)} onMove={(folder) => handleMoveItem(moveItemTarget, folder)} /> : null}
      {deleteFolderTarget ? <DeleteDocumentDialog note={{ path: deleteFolderTarget, kind: "folder" }} onClose={() => setDeleteFolderTarget(null)} onDelete={handleDeleteFolder} /> : null}
      {createFolderParentPath !== null ? <CreateFolderDialog parentPath={createFolderParentPath} onClose={() => setCreateFolderParentPath(null)} onCreate={handleCreateFolder} /> : null}
      {shareItemTarget ? <ShareDialog connection={connection} vaultName={vaultName} note={shareItemTarget} onClose={() => setShareItemTarget(null)} /> : null}
      {activeTreeMenu ? (
        <TreeContextMenu
          menu={activeTreeMenu}
          onClose={() => setActiveTreeMenu(null)}
          onCreateNoteInFolder={(folder) => {
            void handleCreateInlineDocument(folder)
          }}
          onCreateFileInFolder={(folder, type) => { void handleCreateInlineFile(folder, type) }}
          onCreateFolderInFolder={(folder) => setCreateFolderParentPath(folder)}
          onUploadFileInFolder={beginUploadInFolder}
          onDeleteFolder={(folder) => setDeleteFolderTarget(folder)}
          onRenameItem={(item) => {
            setInlineRenamingDraft(documentTitle(item.path))
            setInlineRenamingPath(item.path)
          }}
          onDeleteItem={(item) => setDeleteItemTarget(item)}
          onMoveItem={(item) => setMoveItemTarget(item)}
          onShareItem={(item) => void handleShareItem(item)}
          onDownloadItem={(item) => void handleDownloadItem(item)}
          onCopyPath={(path) => { void navigator.clipboard.writeText(path) }}
          onChooseIcon={(kind, path) => setIconPickerTarget({ kind, path, vault: vaultName })}
          getIcon={getIcon}
        />
      ) : null}
      {iconPickerTarget ? (
        <DocumentIconPicker
          target={iconPickerTarget}
          currentIcon={getIcon(iconPickerTarget.kind, iconPickerTarget.path, iconPickerTarget.vault)}
          onChoose={(icon) => chooseDocumentIcon(iconPickerTarget.kind, iconPickerTarget.path, icon, iconPickerTarget.vault)}
          onClose={() => setIconPickerTarget(null)}
        />
      ) : null}
      {showPiAssistant && selectedNote && !activePlatformPlugin && activeSidebarTab !== 'ai-chat' && activeSidebarTab !== 'twofa' ? (
        <PiAssistantDialog
          key={`${vaultName}:${selectedNote.path}`}
          note={selectedNote}
          connection={connection}
          vaultName={vaultName}
          onClose={() => setShowPiAssistant(false)}
          onReplace={async (content) => { await saveDocument({ path: selectedNote.path, content, createOnly: false }) }}
          onCreateDocument={handleAiCreateDocument}
          onDeleteDocument={handleAiDeleteDocument}
          availableSkills={availableSkills}
          enabledSkillIds={enabledSkillIds}
          setEnabledSkillIds={setEnabledSkillIds}
          onToggleSkill={toggleSkill}
          onSelectAllSkills={selectAllSkills}
          onClearAllSkills={clearAllSkills}
          onInspectSkill={openSkill}
        />
      ) : null}
      {inlineAiRequest && selectedNote && !activePlatformPlugin && !isLocked ? (
        <AiSurface
          connection={connection}
          vault={vaultName}
          note={{ path: selectedNote.path, content: selectedNote.content, contentHash: selectedNote.contentHash, version: selectedNote.version }}
          selection={(() => {
            const range = rawNoteSelectionRange(selectedNote.content, inlineAiRequest)
            return { text: inlineAiRequest.text, start: range.start, end: range.end }
          })()}
          selectionAction={inlineAiRequest.action}
          entrypoint="selection"
          onCommit={async (proposal) => {
            if (!proposal.confirmToken) throw new FnsApiError('修改确认令牌已失效，请重新生成。')
            await commitAIProposal(connection, proposal.id, {
              targets: proposal.base,
              confirmToken: proposal.confirmToken,
              idempotencyKey: `commit:${proposal.id}:${Date.now()}`,
            })
            await refresh()
            setInlineAiRequest(null)
          }}
          onAppend={handleInlineAiAppend}
          onClose={() => setInlineAiRequest(null)}
        />
      ) : null}

      {/* Floating Bottom-Right AI Assistant Button */}
      <button
        className={`floating-ai-button ${selectedNote ? 'has-note' : ''} ${showPiAssistant ? 'is-active' : ''} ${activePlatformPlugin || activeSidebarTab === 'ai-chat' || activeSidebarTab === 'twofa' ? 'is-chat-hidden' : ''}`}
        onClick={() => { if (selectedNote) { setShowPiAssistant((prev) => !prev) } }}
        disabled={!selectedNote || isLoading}
        aria-label="AI 助手"
        title={selectedNote ? 'AI 笔记助手 (与当前笔记对话)' : '在左侧选择一篇 Markdown 笔记后使用 AI 助手'}
      >
        <Sparkles size={17} className="floating-ai-icon" />
      </button>
    </main>
  )
}
