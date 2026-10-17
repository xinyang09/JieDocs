/**
 * Local document icons.
 *
 * Icons are deliberately kept in browser storage instead of the document
 * body. They are presentation preferences, and the document identity is the
 * complete vault/kind/path tuple. This also means a document with the same
 * path in another vault (or a note and a binary file with the same path) can
 * have different icons.
 */

export type DocumentIconKind = 'note' | 'file' | 'folder' | 'skill'

export type DocumentIconMap = Record<string, string>

export type DocumentIconRef = {
  vault: string
  kind: DocumentIconKind
  path: string
}

export type DocumentIconStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const DOCUMENT_ICON_STORAGE_KEY = 'fns-docs-viewer.document-icons'
export const DOCUMENT_ICONS_STORAGE_KEY = DOCUMENT_ICON_STORAGE_KEY

export type DocumentIconOption = readonly [icon: string, name: string]
export type DocumentIconCategory = {
  id: string
  label: string
  icons: readonly DocumentIconOption[]
}

// A compact, locally available catalog keeps the picker useful offline. Names
// also provide Chinese keyword search without sending document data anywhere.
export const documentIconCategories: readonly DocumentIconCategory[] = [
  { id: 'common', label: '常用', icons: [
    ['📄', '文档'], ['📝', '笔记'], ['📚', '书籍'], ['📖', '阅读'], ['📒', '记事本'], ['📋', '清单'], ['🗂️', '归档'], ['📁', '文件夹'],
    ['💡', '想法'], ['⭐', '星标'], ['🎯', '目标'], ['✅', '完成'], ['📌', '固定'], ['🔖', '书签'], ['🧠', '思考'], ['💬', '对话'],
    ['🚀', '启动'], ['🛠️', '工具'], ['💻', '电脑'], ['📊', '数据'], ['🗓️', '日历'], ['🎨', '设计'], ['🎵', '音乐'], ['🌿', '植物'],
    ['☕', '咖啡'], ['🌈', '彩虹'], ['❤️', '爱心'], ['😊', '微笑'], ['🏠', '家'], ['🌍', '地球'], ['🔒', '锁定'], ['✨', '闪光'],
  ] },
  { id: 'faces', label: '表情', icons: [
    ['😀', '笑脸'], ['😃', '开心'], ['😄', '大笑'], ['😁', '笑容'], ['😆', '眯眼笑'], ['😅', '汗笑'], ['🤣', '笑翻'], ['😂', '笑哭'],
    ['🙂', '微笑'], ['🙃', '倒脸'], ['😉', '眨眼'], ['😊', '害羞'], ['😇', '天使'], ['🥰', '喜爱'], ['😍', '爱慕'], ['🤩', '星星眼'],
    ['😘', '飞吻'], ['😋', '美味'], ['😛', '吐舌'], ['🤔', '思考'], ['🧐', '观察'], ['🤓', '书呆子'], ['😎', '酷'], ['🥳', '派对'],
    ['😏', '得意'], ['😐', '平静'], ['😶', '无语'], ['🙄', '白眼'], ['😬', '尴尬'], ['😮', '惊讶'], ['😴', '睡觉'], ['😷', '口罩'],
    ['🤒', '生病'], ['🤯', '震惊'], ['😢', '伤心'], ['😭', '大哭'], ['😤', '不满'], ['😡', '愤怒'], ['👻', '幽灵'], ['🤖', '机器人'],
  ] },
  { id: 'people', label: '人物', icons: [
    ['👍', '赞'], ['👎', '反对'], ['👏', '鼓掌'], ['🙌', '庆祝'], ['🫶', '比心'], ['🤝', '握手'], ['🙏', '感谢'], ['💪', '力量'],
    ['✍️', '写作'], ['👋', '挥手'], ['👌', '好的'], ['✌️', '胜利'], ['🤞', '祝愿'], ['🤟', '爱你'], ['🤘', '摇滚'], ['🤙', '联系'],
    ['👈', '向左'], ['👉', '向右'], ['👆', '向上'], ['👇', '向下'], ['🖐️', '手掌'], ['👤', '个人'], ['👥', '团队'], ['🗣️', '演讲'],
    ['🧑‍💻', '程序员'], ['👩‍💻', '女程序员'], ['👨‍💻', '男程序员'], ['🧑‍🎨', '艺术家'], ['🧑‍🔬', '科学家'], ['🧑‍🏫', '教师'], ['🧑‍🍳', '厨师'], ['🧑‍🚀', '宇航员'],
    ['👩‍⚕️', '医生'], ['👨‍👩‍👧‍👦', '家庭'], ['🚶', '步行'], ['🏃', '跑步'], ['🧘', '冥想'],
  ] },
  { id: 'nature', label: '自然', icons: [
    ['🌱', '幼苗'], ['🌿', '植物'], ['🍀', '幸运草'], ['🌵', '仙人掌'], ['🌴', '棕榈树'], ['🌲', '松树'], ['🌳', '大树'], ['🪴', '盆栽'],
    ['🌺', '花朵'], ['🌸', '樱花'], ['🌼', '雏菊'], ['🌻', '向日葵'], ['🌹', '玫瑰'], ['🍁', '枫叶'], ['🍂', '落叶'], ['🍃', '绿叶'],
    ['🌾', '稻穗'], ['🍄', '蘑菇'], ['🐶', '狗'], ['🐱', '猫'], ['🐻', '熊'], ['🦊', '狐狸'], ['🐼', '熊猫'], ['🐨', '考拉'],
    ['🦁', '狮子'], ['🐯', '老虎'], ['🐸', '青蛙'], ['🐧', '企鹅'], ['🐦', '小鸟'], ['🦋', '蝴蝶'], ['🐝', '蜜蜂'], ['🐢', '乌龟'],
    ['🐬', '海豚'], ['🐳', '鲸鱼'], ['🌊', '海浪'], ['🌙', '月亮'], ['☀️', '太阳'], ['⛅', '多云'], ['🌧️', '雨天'], ['⚡', '闪电'],
    ['❄️', '雪花'], ['🌈', '彩虹'], ['🌍', '地球'], ['🌎', '美洲'], ['🌏', '亚洲'],
  ] },
  { id: 'food', label: '食物', icons: [
    ['🍎', '苹果'], ['🍐', '梨'], ['🍊', '橙子'], ['🍋', '柠檬'], ['🍌', '香蕉'], ['🍉', '西瓜'], ['🍇', '葡萄'], ['🍓', '草莓'],
    ['🫐', '蓝莓'], ['🍒', '樱桃'], ['🍑', '桃子'], ['🥭', '芒果'], ['🍍', '菠萝'], ['🥑', '牛油果'], ['🥕', '胡萝卜'], ['🌽', '玉米'],
    ['🥦', '西兰花'], ['🍞', '面包'], ['🥐', '牛角包'], ['🥨', '椒盐卷饼'], ['🧀', '奶酪'], ['🍕', '披萨'], ['🍔', '汉堡'], ['🍟', '薯条'],
    ['🌮', '塔可'], ['🍜', '面条'], ['🍣', '寿司'], ['🍱', '便当'], ['🍰', '蛋糕'], ['🧁', '纸杯蛋糕'], ['🍫', '巧克力'], ['🍿', '爆米花'],
    ['☕', '咖啡'], ['🍵', '茶'], ['🥤', '饮料'], ['🍷', '红酒'], ['🍺', '啤酒'],
  ] },
  { id: 'activity', label: '活动', icons: [
    ['🎯', '目标'], ['🏆', '奖杯'], ['🥇', '金牌'], ['⚽', '足球'], ['🏀', '篮球'], ['🏈', '橄榄球'], ['🎾', '网球'], ['🏐', '排球'],
    ['🏓', '乒乓球'], ['🏸', '羽毛球'], ['🥊', '拳击'], ['⛳', '高尔夫'], ['🎮', '游戏'], ['🕹️', '摇杆'], ['🎲', '骰子'], ['🧩', '拼图'],
    ['🎨', '设计'], ['🖌️', '画笔'], ['🎭', '戏剧'], ['🎬', '电影'], ['🎤', '唱歌'], ['🎧', '耳机'], ['🎵', '音乐'], ['🎹', '钢琴'],
    ['🎸', '吉他'], ['🥁', '鼓'], ['📷', '相机'], ['📸', '摄影'], ['🎥', '摄像'], ['🎟️', '门票'], ['🚲', '自行车'], ['🏕️', '露营'],
    ['🎉', '庆祝'], ['🎊', '彩纸'], ['🎁', '礼物'], ['🎈', '气球'], ['🎂', '生日'],
  ] },
  { id: 'objects', label: '物品', icons: [
    ['📄', '文档'], ['📝', '笔记'], ['📚', '书籍'], ['📖', '阅读'], ['📒', '记事本'], ['📔', '封面笔记'], ['📓', '笔记本'], ['📕', '红色书'],
    ['📗', '绿色书'], ['📘', '蓝色书'], ['📙', '橙色书'], ['📜', '卷轴'], ['📃', '文件页'], ['📑', '书签页'], ['📋', '清单'], ['📌', '图钉'],
    ['📍', '位置'], ['🗂️', '归档'], ['📁', '文件夹'], ['📂', '打开文件夹'], ['🗄️', '档案柜'], ['🗃️', '卡片盒'], ['🧾', '收据'], ['✉️', '信件'],
    ['📨', '邮件'], ['📦', '包裹'], ['🧰', '工具箱'], ['🔧', '扳手'], ['🪛', '螺丝刀'], ['🔨', '锤子'], ['⚙️', '齿轮'], ['🛠️', '工具'],
    ['💻', '笔记本电脑'], ['🖥️', '显示器'], ['⌨️', '键盘'], ['🖱️', '鼠标'], ['📱', '手机'], ['☎️', '电话'], ['📺', '电视'], ['📻', '收音机'],
    ['💡', '灯泡'], ['🔦', '手电筒'], ['🕯️', '蜡烛'], ['🔍', '放大镜'], ['🔎', '搜索'], ['🔒', '锁定'], ['🔓', '解锁'], ['🔑', '钥匙'],
    ['🧲', '磁铁'], ['🧪', '实验'], ['🧬', '基因'], ['🔬', '显微镜'], ['📊', '数据'], ['📈', '增长'], ['📉', '下降'], ['🗓️', '日历'],
    ['⏰', '闹钟'], ['⌛', '沙漏'], ['💾', '磁盘'], ['🧭', '指南针'],
  ] },
  { id: 'places', label: '地点', icons: [
    ['🏠', '家'], ['🏡', '住宅'], ['🏢', '办公楼'], ['🏛️', '建筑'], ['🏫', '学校'], ['🏥', '医院'], ['🏦', '银行'], ['🏭', '工厂'],
    ['🏰', '城堡'], ['🗼', '高塔'], ['🗽', '雕像'], ['⛪', '教堂'], ['🕌', '清真寺'], ['🌆', '黄昏城市'], ['🌇', '日落'], ['🌃', '夜景'],
    ['🏙️', '城市'], ['🏞️', '风景'], ['🏖️', '海滩'], ['🏜️', '沙漠'], ['🏔️', '雪山'], ['⛰️', '山'], ['🌋', '火山'], ['🚉', '车站'],
    ['🚆', '火车'], ['🚇', '地铁'], ['🚢', '轮船'], ['✈️', '飞机'], ['🛫', '起飞'], ['🛬', '降落'], ['🗺️', '地图'],
  ] },
  { id: 'symbols', label: '符号', icons: [
    ['⭐', '星标'], ['🌟', '闪亮星星'], ['✨', '闪光'], ['💫', '眩晕'], ['🔥', '火焰'], ['❤️', '爱心'], ['🧡', '橙色爱心'], ['💛', '黄色爱心'],
    ['💚', '绿色爱心'], ['💙', '蓝色爱心'], ['💜', '紫色爱心'], ['🖤', '黑色爱心'], ['🤍', '白色爱心'], ['🤎', '棕色爱心'], ['💖', '闪亮爱心'], ['💯', '满分'],
    ['✅', '完成'], ['☑️', '复选'], ['❌', '错误'], ['⚠️', '警告'], ['❗', '感叹号'], ['❓', '问号'], ['ℹ️', '信息'], ['🔔', '通知'],
    ['🔕', '静音'], ['📣', '广播'], ['💬', '对话'], ['💭', '思考气泡'], ['🔖', '书签'], ['🏷️', '标签'], ['🧠', '头脑'], ['🔗', '链接'],
    ['➕', '加号'], ['➖', '减号'], ['➗', '除号'], ['💲', '货币'], ['#️⃣', '井号'], ['1️⃣', '数字一'], ['2️⃣', '数字二'], ['3️⃣', '数字三'],
    ['🔴', '红色'], ['🟠', '橙色'], ['🟡', '黄色'], ['🟢', '绿色'], ['🔵', '蓝色'], ['🟣', '紫色'], ['⚫', '黑色'], ['⚪', '白色'],
    ['🔶', '橙色菱形'], ['🔷', '蓝色菱形'],
  ] },
]

const allDocumentIconOptions = Array.from(
  new Map(documentIconCategories.flatMap((category) => category.icons).map(([icon, name]) => [icon, [icon, name] as DocumentIconOption])).values(),
)

export const documentIconCategoryTabs = [
  { id: 'all', label: '全部' },
  ...documentIconCategories.map(({ id, label }) => ({ id, label })),
] as const

export function findDocumentIconOptions(query: string, categoryId: string): readonly DocumentIconOption[] {
  const search = query.trim().toLocaleLowerCase()
  if (search) return allDocumentIconOptions.filter(([icon, name]) => `${icon} ${name}`.toLocaleLowerCase().includes(search))
  if (categoryId === 'all') return allDocumentIconOptions
  return documentIconCategories.find((category) => category.id === categoryId)?.icons || documentIconCategories[0].icons
}

const EXTENDED_PICTOGRAPHIC = /\p{Extended_Pictographic}/u
const REGIONAL_INDICATOR_FLAG = /^\p{Regional_Indicator}{2}$/u
const KEYPAD_EMOJI = /^[#*0-9]\uFE0F?\u20E3$/u
const ASCII_DIGIT_OR_SYMBOL = /^[#*0-9]$/u

type SegmenterLike = {
  segment(input: string): Iterable<unknown>
}

function createSegmenter(): SegmenterLike | undefined {
  const IntlWithSegmenter = Intl as typeof Intl & {
    Segmenter?: new (locales?: string | string[], options?: { granularity: 'grapheme' }) => SegmenterLike
  }
  if (!IntlWithSegmenter.Segmenter) return undefined
  return new IntlWithSegmenter.Segmenter(undefined, { granularity: 'grapheme' })
}

const graphemeSegmenter = createSegmenter()

function graphemeCount(value: string): number {
  if (graphemeSegmenter) return Array.from(graphemeSegmenter.segment(value)).length
  // Modern browsers expose Intl.Segmenter. This fallback keeps the helper
  // usable in older embedded runtimes while still rejecting obvious strings
  // containing more than one code point.
  return Array.from(value).length
}

/**
 * Return the trimmed value when it is exactly one emoji grapheme.
 *
 * A plain ASCII digit or `#`/`*` is not accepted even though Unicode marks it
 * as Emoji; the keycap form (for example `1️⃣`) is accepted. Regional flags,
 * skin-tone sequences and ZWJ families are handled as one grapheme by
 * Intl.Segmenter.
 */
export function normalizeDocumentIcon(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized || graphemeCount(normalized) !== 1 || ASCII_DIGIT_OR_SYMBOL.test(normalized)) return null
  if (KEYPAD_EMOJI.test(normalized) || REGIONAL_INDICATOR_FLAG.test(normalized)) return normalized
  return EXTENDED_PICTOGRAPHIC.test(normalized) ? normalized : null
}

export function isDocumentIcon(value: unknown): value is string {
  return normalizeDocumentIcon(value) !== null
}

/** Stable, collision-free identity for a document icon entry. */
export function documentIconKey(ref: DocumentIconRef): string {
  return `${ref.vault}\u0000${ref.kind}\u0000${normalizeIconPath(ref.path)}`
}

function normalizeIconPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

function getDefaultStorage(): DocumentIconStorage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

function readIconMap(storage: DocumentIconStorage | null): DocumentIconMap {
  if (!storage) return {}
  let raw: string | null = null
  try {
    raw = storage.getItem(DOCUMENT_ICON_STORAGE_KEY)
  } catch {
    return {}
  }
  if (!raw) return {}

  try {
    const parsed: unknown = JSON.parse(raw)
    // The persisted value is intentionally a plain map so older viewers can
    // inspect it. Be liberal when reading a future versioned `{ entries }`
    // wrapper, but only keep valid emoji values.
    const source = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && 'entries' in parsed && parsed.entries && typeof parsed.entries === 'object'
      ? parsed.entries
      : parsed
    if (!source || typeof source !== 'object' || Array.isArray(source)) return {}

    const entries: DocumentIconMap = {}
    for (const [key, value] of Object.entries(source)) {
      const icon = normalizeDocumentIcon(value)
      if (icon) entries[key] = icon
    }
    return entries
  } catch {
    return {}
  }
}

function writeIconMap(storage: DocumentIconStorage | null, entries: DocumentIconMap): boolean {
  if (!storage) return false
  try {
    if (Object.keys(entries).length === 0) storage.removeItem(DOCUMENT_ICON_STORAGE_KEY)
    else storage.setItem(DOCUMENT_ICON_STORAGE_KEY, JSON.stringify(entries))
    return true
  } catch {
    return false
  }
}

/** Read an icon, returning null for missing or invalid persisted values. */
export function getDocumentIcon(ref: DocumentIconRef, storage?: DocumentIconStorage): string | null {
  const entries = readIconMap(storage || getDefaultStorage())
  return entries[documentIconKey(ref)] || null
}

/**
 * Store an emoji icon. Invalid values leave storage untouched and return
 * false, which lets the UI keep the previous icon while reporting validation
 * feedback to the user.
 */
export function setDocumentIcon(ref: DocumentIconRef, value: unknown, storage?: DocumentIconStorage): boolean {
  const icon = normalizeDocumentIcon(value)
  if (!icon) return false
  const target = storage || getDefaultStorage()
  const entries = readIconMap(target)
  entries[documentIconKey(ref)] = icon
  return writeIconMap(target, entries)
}

/** Remove an icon and clean up the storage key when it becomes empty. */
export function clearDocumentIcon(ref: DocumentIconRef, storage?: DocumentIconStorage): boolean {
  const target = storage || getDefaultStorage()
  const entries = readIconMap(target)
  const key = documentIconKey(ref)
  if (!(key in entries)) return true
  delete entries[key]
  return writeIconMap(target, entries)
}

/**
 * Move an icon when a document is renamed or moved. The destination entry is
 * replaced by the source icon so a stale entry from a previous rename cannot
 * keep showing the wrong emoji. The source is always removed.
 */
export function migrateDocumentIcon(from: DocumentIconRef, to: DocumentIconRef, storage?: DocumentIconStorage): string | null {
  const target = storage || getDefaultStorage()
  const entries = readIconMap(target)
  const sourceKey = documentIconKey(from)
  const destinationKey = documentIconKey(to)
  const icon = entries[sourceKey] || null

  if (sourceKey === destinationKey || !icon) return icon
  delete entries[sourceKey]
  entries[destinationKey] = icon
  return writeIconMap(target, entries) ? icon : null
}

/** Load the local preference map for use in frontend state. */
export function loadDocumentIcons(storage?: DocumentIconStorage): DocumentIconMap {
  return readIconMap(storage || getDefaultStorage())
}

/** Persist frontend state; return false when browser storage is unavailable. */
export function persistDocumentIcons(storage: DocumentIconStorage, entries: DocumentIconMap): boolean {
  return writeIconMap(storage, entries)
}

export function getDocumentIconFromMap(entries: DocumentIconMap, vault: string, kind: DocumentIconKind, path: string): string | undefined {
  return normalizeDocumentIcon(entries[documentIconKey({ vault, kind, path })]) || undefined
}

/** Immutable state update. An absent/empty icon means restore the default. */
export function writeDocumentIcon(entries: DocumentIconMap, vault: string, kind: DocumentIconKind, path: string, value?: string): DocumentIconMap {
  const key = documentIconKey({ vault, kind, path })
  if (value === undefined || !value.trim()) {
    if (!(key in entries)) return entries
    const next = { ...entries }
    delete next[key]
    return next
  }
  const icon = normalizeDocumentIcon(value)
  if (!icon || entries[key] === icon) return entries
  return { ...entries, [key]: icon }
}

/** Move a local preference after the service confirms a rename/move. */
export function migrateDocumentIconInMap(entries: DocumentIconMap, vault: string, kind: DocumentIconKind, fromPath: string, toPath: string): DocumentIconMap {
  const from = documentIconKey({ vault, kind, path: fromPath })
  const to = documentIconKey({ vault, kind, path: toPath })
  if (from === to || !(from in entries)) return entries
  const next = { ...entries }
  const icon = normalizeDocumentIcon(next[from])
  delete next[from]
  if (icon) next[to] = icon
  return next
}

/** Remove a deleted document/folder and its descendants only in one vault. */
export function removeDocumentIconsUnderPath(entries: DocumentIconMap, vault: string, path: string): DocumentIconMap {
  const normalizedPath = normalizeIconPath(path)
  const next = { ...entries }
  let changed = false
  for (const key of Object.keys(next)) {
    const [entryVault, , entryPath] = key.split('\u0000')
    if (entryVault === vault && typeof entryPath === 'string'
      && (!normalizedPath || entryPath === normalizedPath || entryPath.startsWith(`${normalizedPath}/`))) {
      delete next[key]
      changed = true
    }
  }
  return changed ? next : entries
}
