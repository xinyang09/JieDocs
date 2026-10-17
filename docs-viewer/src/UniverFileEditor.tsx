import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import '@univerjs/preset-docs-core/lib/index.css'
import '@univerjs/preset-docs-drawing/lib/index.css'
import '@univerjs/preset-docs-hyper-link/lib/index.css'
import '@univerjs/preset-docs-thread-comment/lib/index.css'
import '@univerjs/preset-sheets-core/lib/index.css'
import '@univerjs/preset-sheets-find-replace/lib/index.css'
import '@univerjs/preset-sheets-note/lib/index.css'
import '@univerjs/preset-sheets-thread-comment/lib/index.css'
import '@univerjs/sheets-conditional-formatting-ui/lib/index.css'
import '@univerjs/sheets-data-validation-ui/lib/index.css'
import '@univerjs/sheets-drawing-ui/lib/index.css'
import '@univerjs/sheets-filter-ui/lib/index.css'
import '@univerjs/sheets-hyper-link-ui/lib/index.css'
import '@univerjs/sheets-sort-ui/lib/index.css'
import '@univerjs/sheets-table-ui/lib/index.css'
import '@univerjs/slides-ui/lib/index.css'
import { createUniver } from '@univerjs/presets'
import DocsLocale from '@univerjs/preset-docs-core/locales/zh-CN'
import DocsDrawingLocale from '@univerjs/preset-docs-drawing/locales/zh-CN'
import DocsHyperLinkLocale from '@univerjs/preset-docs-hyper-link/locales/zh-CN'
import DocsThreadCommentLocale from '@univerjs/preset-docs-thread-comment/locales/zh-CN'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import SheetsLocale from '@univerjs/preset-sheets-core/locales/zh-CN'
import SheetsFindReplaceLocale from '@univerjs/preset-sheets-find-replace/locales/zh-CN'
import SheetsNoteLocale from '@univerjs/preset-sheets-note/locales/zh-CN'
import SheetsThreadCommentLocale from '@univerjs/preset-sheets-thread-comment/locales/zh-CN'
import SheetsConditionalFormattingLocale from '@univerjs/sheets-conditional-formatting-ui/locale/zh-CN'
import SheetsDataValidationLocale from '@univerjs/sheets-data-validation-ui/locale/zh-CN'
import SheetsDrawingLocale from '@univerjs/sheets-drawing-ui/locale/zh-CN'
import SheetsFilterLocale from '@univerjs/sheets-filter-ui/locale/zh-CN'
import SheetsHyperLinkLocale from '@univerjs/sheets-hyper-link-ui/locale/zh-CN'
import SheetsSortLocale from '@univerjs/sheets-sort-ui/locale/zh-CN'
import SheetsTableLocale from '@univerjs/sheets-table-ui/locale/zh-CN'
import { CommandType, IUniverInstanceService, ICommandService, UniverInstanceType } from '@univerjs/core'
import { DocSelectionManagerService, UniverDocsPlugin } from '@univerjs/docs'
import { DocCanvasPopManagerService, DocParagraphMenuService, UniverDocsUIPlugin } from '@univerjs/docs-ui'
import { UniverDrawingPlugin } from '@univerjs/drawing'
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula'
import { IRenderManagerService, UniverRenderEnginePlugin } from '@univerjs/engine-render'
import type { IRender } from '@univerjs/engine-render'
import { UniverNetworkPlugin } from '@univerjs/network'
import { UniverDataValidationPlugin } from '@univerjs/data-validation'
import { UniverSheetsConditionalFormattingPlugin } from '@univerjs/sheets-conditional-formatting'
import { UniverSheetsConditionalFormattingUIPlugin } from '@univerjs/sheets-conditional-formatting-ui'
import { UniverSheetsDataValidationPlugin } from '@univerjs/sheets-data-validation'
import { UniverSheetsDataValidationUIPlugin } from '@univerjs/sheets-data-validation-ui'
import { UniverSheetsDrawingPlugin } from '@univerjs/sheets-drawing'
import { UniverSheetsDrawingUIPlugin } from '@univerjs/sheets-drawing-ui'
import { UniverSheetsFilterPlugin } from '@univerjs/sheets-filter'
import { UniverSheetsFilterUIPlugin } from '@univerjs/sheets-filter-ui'
import { UniverSheetsHyperLinkPlugin } from '@univerjs/sheets-hyper-link'
import { UniverSheetsHyperLinkUIPlugin } from '@univerjs/sheets-hyper-link-ui'
import { UniverSheetsSortPlugin } from '@univerjs/sheets-sort'
import { UniverSheetsSortUIPlugin } from '@univerjs/sheets-sort-ui'
import { UniverSheetsTablePlugin } from '@univerjs/sheets-table'
import { UniverSheetsTableUIPlugin } from '@univerjs/sheets-table-ui'
import { SLIDE_KEY, UniverSlidesPlugin } from '@univerjs/slides'
import { UniverSlidesUIPlugin } from '@univerjs/slides-ui'
import SlidesLocale from '@univerjs/slides-ui/locale/zh-CN'
import { UniverUIPlugin } from '@univerjs/ui'
import { UniverSheetsFindReplacePreset } from '@univerjs/preset-sheets-find-replace'
import { UniverSheetsNotePreset } from '@univerjs/preset-sheets-note'
import { UniverSheetsThreadCommentPreset } from '@univerjs/preset-sheets-thread-comment'
import { UniverDocsDrawingPreset } from '@univerjs/preset-docs-drawing'
import { UniverDocsHyperLinkPreset } from '@univerjs/preset-docs-hyper-link'
import { UniverDocsThreadCommentPreset } from '@univerjs/preset-docs-thread-comment'
import '@univerjs/network/facade'
import '@univerjs/docs-ui/facade'
import '@univerjs/sheets-filter/facade'
import '@univerjs/sheets-drawing/facade'
import { exportUniverFile, importUniverFile, uploadFile } from './api'
import type { Connection, FileSummary } from './types'
import { installWhenUniverRendered } from './univer-lifecycle'

const editorCounter = { value: 0 }

type EditorKind = 'sheet' | 'doc' | 'slide'
type UniverRuntime = ReturnType<typeof createUniver>

type Props = {
  file: FileSummary
  connection: Connection
  vault: string
  saveStatusTarget?: HTMLElement | null
}

function nextContainerId() {
  editorCounter.value += 1
  return `fns-univer-editor-${editorCounter.value}`
}

function slidesPreset(container: string) {
  return {
    plugins: [
      UniverRenderEnginePlugin,
      UniverFormulaEnginePlugin,
      [UniverUIPlugin, { container, header: true, toolbar: true, footer: true }],
      UniverDocsPlugin,
      UniverDocsUIPlugin,
      UniverDrawingPlugin,
      UniverSlidesPlugin,
      UniverSlidesUIPlugin,
    ] as never,
  }
}

function createRuntime(kind: EditorKind, container: string) {
  if (kind === 'sheet') {
    const corePreset = UniverSheetsCorePreset({
      container,
      header: true,
      toolbar: true,
      footer: { sheetBar: true, statisticBar: true, zoomSlider: true },
    })
    return createUniver({
      locale: 'zhCN' as never,
      locales: {
        zhCN: {
          ...SheetsLocale,
          ...SheetsConditionalFormattingLocale,
          ...SheetsDrawingLocale,
          ...SheetsFilterLocale,
          ...SheetsHyperLinkLocale,
          ...SheetsSortLocale,
          ...SheetsTableLocale,
          ...SheetsFindReplaceLocale,
          ...SheetsNoteLocale,
          ...SheetsThreadCommentLocale,
        },
      },
      presets: [{
        plugins: [
          ...corePreset.plugins,
          UniverDrawingPlugin,
          UniverSheetsDrawingPlugin,
          UniverSheetsDrawingUIPlugin,
          UniverDataValidationPlugin,
          UniverSheetsDataValidationPlugin,
          UniverSheetsDataValidationUIPlugin,
          UniverSheetsConditionalFormattingPlugin,
          UniverSheetsConditionalFormattingUIPlugin,
          UniverSheetsFilterPlugin,
          UniverSheetsFilterUIPlugin,
          UniverSheetsHyperLinkPlugin,
          UniverSheetsHyperLinkUIPlugin,
          UniverSheetsSortPlugin,
          UniverSheetsSortUIPlugin,
          UniverSheetsTablePlugin,
          UniverSheetsTableUIPlugin,
          ...UniverSheetsFindReplacePreset().plugins,
          ...UniverSheetsNotePreset().plugins,
          ...UniverSheetsThreadCommentPreset().plugins,
        ],
      }],
    })
  }
  if (kind === 'doc') {
    return createUniver({
      locale: 'zhCN' as never,
      locales: {
        zhCN: {
          ...DocsLocale,
          ...DocsDrawingLocale,
          ...DocsHyperLinkLocale,
          ...DocsThreadCommentLocale,
        },
      },
      presets: [
        {
          plugins: [
            UniverNetworkPlugin,
            UniverDocsPlugin,
            UniverRenderEnginePlugin,
            [UniverUIPlugin, { container, header: true, toolbar: true, footer: true }],
            [
              UniverDocsUIPlugin,
              {
                container,
                fitToWidth: {
                  mode: 'fit-width',
                  target: 'container',
                  paddingX: 24,
                  minScale: 0,
                  maxScale: 1,
                  align: 'center',
                },
              },
            ],
            UniverFormulaEnginePlugin,
            ...UniverDocsDrawingPreset().plugins,
            ...UniverDocsHyperLinkPreset().plugins,
            ...UniverDocsThreadCommentPreset().plugins,
          ],
        },
      ],
    })
  }
  return createUniver({
    locale: 'zhCN' as never,
    locales: { zhCN: { ...DocsLocale, ...SlidesLocale } },
    presets: [slidesPreset(container)],
  })
}

function createUnit(runtime: UniverRuntime, kind: EditorKind, unitData: Record<string, unknown>) {
  if (kind === 'sheet') return runtime.univerAPI.createWorkbook(unitData as never)
  if (kind === 'doc') return runtime.univerAPI.createDocument(unitData as never)
  return runtime.univer.createUnit(UniverInstanceType.UNIVER_SLIDE, normalizeSlideUnitData(unitData) as never)
}

function saveUnit(runtime: UniverRuntime, kind: EditorKind) {
  if (kind === 'sheet') return runtime.univerAPI.getActiveWorkbook()?.save()
  if (kind === 'doc') return runtime.univerAPI.getActiveDocument()?.save()
  const service = runtime.univer.__getInjector().get(IUniverInstanceService)
  const slide = service.getCurrentUnitOfType(UniverInstanceType.UNIVER_SLIDE) as { getSnapshot?: () => unknown } | null
  return slide?.getSnapshot?.()
}

function centerSlideViewport(runtime: UniverRuntime, containerId: string) {
  const injector = runtime.univer.__getInjector()
  const instanceService = injector.get(IUniverInstanceService)
  const renderManager = injector.get(IRenderManagerService)
  const slideUnit = instanceService.getCurrentUnitOfType(UniverInstanceType.UNIVER_SLIDE)
  if (!slideUnit) return false
  const renderer = renderManager.getRenderUnitById(slideUnit.getUnitId())
  const scene = renderer?.scene
  const engine = renderer?.engine
  const container = document.getElementById(containerId)
  const canvasElement = engine?.getCanvasElement()
  if (!scene || !engine || !container || !canvasElement) return false

  const slideComponent = scene.getObject(SLIDE_KEY.COMPONENT) as {
    transformByState?: (state: { left?: number; top?: number; scaleX?: number; scaleY?: number }) => unknown
    makeDirtyNoParent?: (state?: boolean) => unknown
  } | null
  const viewport = scene.getViewport(SLIDE_KEY.VIEW)
  if (!slideComponent || !viewport) return false

  const canvasRect = canvasElement.getBoundingClientRect()
  const viewportWidth = canvasRect.width || engine.width || 0
  const viewportHeight = canvasRect.height || engine.height || 0
  if (viewportWidth < 320 || viewportHeight < 320) return false

  const pageSize = (slideUnit as { getPageSize?: () => { width?: number; height?: number } }).getPageSize?.()
  const pageWidth = Number(pageSize?.width) || 0
  const pageHeight = Number(pageSize?.height) || 0
  if (pageWidth < 1 || pageHeight < 1 || !slideComponent.transformByState) return false

  const fitScale = Math.min(
    1.25,
    Math.max(0.1, Math.min((viewportWidth - 48) / pageWidth, (viewportHeight - 48) / pageHeight)),
  )
  const scaledPageWidth = pageWidth * fitScale
  const scaledPageHeight = pageHeight * fitScale
  const horizontalOffset = Math.max(24, (viewportWidth - scaledPageWidth) / 2)
  const verticalOffset = Math.max(24, (viewportHeight - scaledPageHeight) / 2)

  scene.transformByState({ width: viewportWidth, height: viewportHeight, scaleX: 1, scaleY: 1 })
  slideComponent.transformByState({
    left: horizontalOffset,
    top: verticalOffset,
    scaleX: fitScale,
    scaleY: fitScale,
  })
  viewport.scrollToViewportPos({ viewportScrollX: 0, viewportScrollY: 0 })
  slideComponent.makeDirtyNoParent?.(true)
  scene.makeDirtyNoParent(true)
  return true
}

function scheduleSlideViewportCenter(runtime: UniverRuntime, containerId: string) {
  let frame = 0
  let resizeFrame = 0
  let retryTimer = 0
  let attempts = 0
  let cancelled = false
  const container = document.getElementById(containerId)
  let resizeObserver: ResizeObserver | null = null

  const observeCanvas = () => {
    const canvas = container?.querySelector('canvas')
    if (canvas) resizeObserver?.observe(canvas)
  }

  const align = () => {
    if (cancelled) return
    observeCanvas()
    frame = window.requestAnimationFrame(() => {
      if (cancelled) return
      const aligned = centerSlideViewport(runtime, containerId)
      attempts += 1
      if (attempts < 16) retryTimer = window.setTimeout(align, aligned ? 100 : 50)
    })
  }

  const realign = () => {
    if (cancelled) return
    window.cancelAnimationFrame(resizeFrame)
    window.clearTimeout(retryTimer)
    attempts = 0
    resizeFrame = window.requestAnimationFrame(align)
  }

  resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(realign)
  if (resizeObserver && container) resizeObserver.observe(container)
  window.addEventListener('resize', realign)
  align()
  return () => {
    cancelled = true
    window.cancelAnimationFrame(frame)
    window.cancelAnimationFrame(resizeFrame)
    window.clearTimeout(retryTimer)
    resizeObserver?.disconnect()
    window.removeEventListener('resize', realign)
  }
}

type CanvasBound = { left: number; right: number; top: number; bottom: number }

function canvasBoundToViewport(bound: CanvasBound, render: IRender): CanvasBound | null {
  const canvas = render.engine.getCanvasElement()
  if (!canvas) return null
  const canvasRect = canvas.getBoundingClientRect()
  const logicalWidth = Number.parseFloat(canvas.style.width)
  const scaleAdjust = logicalWidth > 0 ? canvasRect.width / logicalWidth : 1
  const { scaleX, scaleY } = render.scene.getAncestorScale()
  const viewport = render.scene.getViewport('viewMain')
  const scrollX = viewport?.viewportScrollX ?? 0
  const scrollY = viewport?.viewportScrollY ?? 0
  const toViewport = (x: number, y: number) => ({
    x: (x - scrollX) * scaleX * scaleAdjust + canvasRect.left,
    y: (y - scrollY) * scaleY * scaleAdjust + canvasRect.top,
  })
  const topLeft = toViewport(bound.left, bound.top)
  const bottomRight = toViewport(bound.right, bound.bottom)
  return { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y }
}

function repairDocSlashMenuPosition(runtime: UniverRuntime, kind: EditorKind) {
  if (kind !== 'doc') return () => {}
  return installWhenUniverRendered(runtime.univerAPI, () => {
    const injector = runtime.univer.__getInjector()
    const instanceService = injector.get(IUniverInstanceService)
    const renderManager = injector.get(IRenderManagerService)
    const document = instanceService.getCurrentUnitOfType(UniverInstanceType.UNIVER_DOC)
    if (!document) return () => {}
    const render = renderManager.getRenderUnitById(document.getUnitId())
    if (!render) return () => {}

    const paragraphMenu = render.with(DocParagraphMenuService)
    const popupManager = injector.get(DocCanvasPopManagerService)
    const selectionManager = injector.get(DocSelectionManagerService)
    const subscription = paragraphMenu.slashMenuRequest$.subscribe((request) => {
      if (!request) return
      const activeRange = selectionManager.getActiveTextRange()
      const startOffset = activeRange?.startOffset
      let rangeBounds: CanvasBound | null = null
      if (activeRange != null && startOffset != null) {
        try {
          rangeBounds = popupManager.getRangeBounds({
            startOffset,
            endOffset: startOffset,
            collapsed: true,
            segmentId: activeRange.segmentId,
            segmentPage: activeRange.segmentPage,
          }, render.unitId)?.[0] ?? null
        } catch {
          rangeBounds = null
        }
      }
      const viewportBound = rangeBounds ?? canvasBoundToViewport(request.anchorRect, render)
      if (viewportBound) request.anchorRect = viewportBound
    })
    return () => subscription.unsubscribe()
  })
}

export function isUniverFilePath(path: string) {
  return /\.(?:doc|docx|xls|xlsx|xlsm|csv|tsv|ppt|pptx)$/i.test(path.split('?')[0])
}

function kindForPath(path: string): EditorKind {
  const extension = path.split('?')[0].toLowerCase().split('.').pop()
  if (extension === 'doc' || extension === 'docx') return 'doc'
  if (extension === 'ppt' || extension === 'pptx') return 'slide'
  return 'sheet'
}

function editorLabel(kind: EditorKind) {
  if (kind === 'doc') return '文档'
  if (kind === 'slide') return '演示文稿'
  return '表格'
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function slideTransform(source: JsonRecord) {
  const transform = asRecord(source.transform) || {}
  return {
    left: asNumber(transform.left),
    top: asNumber(transform.top),
    width: asNumber(transform.width),
    height: asNumber(transform.height),
    angle: asNumber(transform.rotation),
  }
}

function normalizeExchangeElement(id: string, source: JsonRecord): JsonRecord | null {
  const base = {
    id,
    zIndex: 10,
    ...slideTransform(source),
    title: asString(source.name, id),
    description: asString(source.description),
  }
  const sourceType = asString(source.type)
  const shapeData = asRecord(source.shapeData)
  const shapeText = asRecord(shapeData?.shapeText)
  if (sourceType === 'text' || shapeText) {
    const dataModel = asRecord(shapeText?.dataModel)
    const rich = dataModel?.doc
    return {
      ...base,
      type: 2,
      richText: {
        text: asString(source.text, asString(shapeText?.text)),
        ...(rich ? { rich } : {}),
      },
    }
  }
  if (sourceType === 'shape') {
    return {
      ...base,
      type: 0,
      shape: {
        shapeType: asString(shapeData?.shapeType, 'rect'),
        text: '',
        shapeProperties: {
          shapeBackgroundFill: { rgb: 'rgba(255,255,255,1)' },
        },
      },
    }
  }
  return null
}

function normalizeExchangePage(id: string, source: JsonRecord): JsonRecord {
  const elements = asRecord(source.elements) || {}
  const elementOrder = stringArray(source.elementOrder)
  const pageElements: JsonRecord = {}
  for (const elementId of elementOrder) {
    const element = asRecord(elements[elementId])
    if (!element) continue
    const normalized = normalizeExchangeElement(elementId, element)
    if (normalized) pageElements[elementId] = normalized
  }
  return {
    id,
    pageType: 0,
    zIndex: 10,
    title: asString(source.name, id),
    description: asString(source.description),
    pageBackgroundFill: { rgb: 'rgb(255,255,255)' },
    pageElements,
  }
}

function normalizeSlideUnitData(unitData: JsonRecord): JsonRecord {
  const body = asRecord(unitData.body)
  if (body && asRecord(body.pages) && Array.isArray(body.pageOrder)) return unitData
  const slides = asRecord(unitData.slides) || {}
  const pageOrder = stringArray(unitData.slideOrder)
  const normalizedOrder = pageOrder.length ? pageOrder : Object.keys(slides)
  const pages: JsonRecord = {}
  for (const id of normalizedOrder) {
    const source = asRecord(slides[id]) || {}
    pages[id] = normalizeExchangePage(id, source)
  }
  return {
    id: asString(unitData.id, 'slide-document'),
    title: asString(unitData.name, asString(unitData.title, '演示文稿')),
    pageSize: asRecord(unitData.defaultPageSize) || asRecord(unitData.pageSize) || { width: 960, height: 540 },
    body: { pages, pageOrder: normalizedOrder },
  }
}

function exchangeElementFromEditor(id: string, source: JsonRecord): JsonRecord | null {
  const transform = {
    left: asNumber(source.left),
    top: asNumber(source.top),
    width: asNumber(source.width),
    height: asNumber(source.height),
    rotation: asNumber(source.angle),
  }
  const base = { id, transform, name: asString(source.title, id), description: asString(source.description) }
  const type = asNumber(source.type)
  if (type === 2) {
    const richText = asRecord(source.richText) || {}
    const rich = richText.rich
    return {
      ...base,
      type: 'text',
      ...(rich ? { textData: rich } : { text: asString(richText.text) }),
    }
  }
  if (type === 0) {
    const shape = asRecord(source.shape) || {}
    return {
      ...base,
      type: 'shape',
      shapeData: {
        shapeType: asString(shape.shapeType, 'rect'),
        fill: { fillType: 1 },
      },
    }
  }
  return null
}

function exchangePageFromEditor(id: string, source: JsonRecord): JsonRecord {
  const pageElements = asRecord(source.pageElements) || {}
  const pageOrder = Object.keys(pageElements)
  const elements: JsonRecord = {}
  for (const elementId of pageOrder) {
    const element = asRecord(pageElements[elementId])
    if (!element) continue
    const exchanged = exchangeElementFromEditor(elementId, element)
    if (exchanged) elements[elementId] = exchanged
  }
  return {
    id,
    pageType: 'slide',
    name: asString(source.title, id),
    elementOrder: Object.keys(elements),
    elements,
  }
}

function toExchangeSlideUnitData(data: JsonRecord): JsonRecord {
  const body = asRecord(data.body)
  if (!body) return data
  const pages = asRecord(body.pages) || {}
  const slideOrder = stringArray(body.pageOrder)
  const slides: JsonRecord = {}
  for (const id of slideOrder) {
    const page = asRecord(pages[id])
    if (page) slides[id] = exchangePageFromEditor(id, page)
  }
  return {
    id: asString(data.id, 'slide-document'),
    name: asString(data.title, '演示文稿'),
    defaultPageSize: asRecord(data.pageSize) || { width: 960, height: 540 },
    slideOrder,
    slides,
    activeSlideId: slideOrder[0],
  }
}

export default function UniverFileEditor({ file, connection, vault, saveStatusTarget }: Props) {
  const kind = useMemo(() => kindForPath(file.path), [file.path])
  const containerId = useMemo(nextContainerId, [])
  const runtimeRef = useRef<UniverRuntime | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const saveInFlightRef = useRef(false)
  const saveQueuedRef = useRef(false)
  const saveRef = useRef<() => Promise<void>>(async () => {})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function scheduleAutoSave() {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void saveRef.current()
    }, 900)
  }

  useEffect(() => {
    let cancelled = false
    let commandDisposable: { dispose: () => void } | null = null
    let slashMenuDisposable = () => {}
    let cancelSlideViewportCenter = () => {}
    setLoading(true)
    setError('')
    setNotice('')
    const load = async () => {
      try {
        const imported = await importUniverFile(connection, vault, file.path)
        if (cancelled) return
        const runtime = createRuntime(kind, containerId)
        runtimeRef.current = runtime
        createUnit(runtime, kind, imported.unitData)
        slashMenuDisposable = repairDocSlashMenuPosition(runtime, kind)
        if (kind === 'slide') cancelSlideViewportCenter = scheduleSlideViewportCenter(runtime, containerId)
        const commandService = runtime.univer.__getInjector().get(ICommandService)
        commandDisposable = commandService.onCommandExecuted((command) => {
          if (command.type === CommandType.MUTATION) scheduleAutoSave()
        })
        if (!cancelled) setLoading(false)
      } catch (reason) {
        if (!cancelled) {
          setLoading(false)
          setError(reason instanceof Error ? reason.message : `无法加载此 ${editorLabel(kind)} 文件。`)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      commandDisposable?.dispose()
      slashMenuDisposable()
      cancelSlideViewportCenter()
      const runtime = runtimeRef.current
      runtimeRef.current = null
      if (runtime) runtime.univer.dispose()
    }
  }, [connection.baseUrl, connection.clientType, connection.token, containerId, file.path, kind, vault])

  async function save() {
    const runtime = runtimeRef.current
    if (!runtime) return
    if (saveInFlightRef.current) {
      saveQueuedRef.current = true
      return
    }
    const data = saveUnit(runtime, kind)
    if (!data) {
      setError(`无法读取当前 ${editorLabel(kind)} 的编辑内容。`)
      return
    }
    saveInFlightRef.current = true
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const exportData = kind === 'slide' ? toExchangeSlideUnitData(data as JsonRecord) : data
      const exported = await exportUniverFile(connection, { vault, path: file.path, kind, data: exportData })
      await uploadFile(connection, vault, exported.outputPath, exported.blob, Date.now())
      setNotice(exported.outputPath === file.path ? '已自动保存' : `已自动保存为 ${exported.outputPath}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败，请稍后重试。')
    } finally {
      setSaving(false)
      saveInFlightRef.current = false
      if (saveQueuedRef.current) {
        saveQueuedRef.current = false
        scheduleAutoSave()
      }
    }
  }

  saveRef.current = save

  return (
    <section className="univer-file-editor" aria-label={`${editorLabel(kind)}编辑器`}>
      <div className="univer-file-editor-toolbar is-empty" aria-hidden="true" />
      {loading ? <div className="univer-file-editor-loading">正在加载 Univer {editorLabel(kind)}…</div> : null}
      <div id={containerId} className="univer-file-editor-canvas" />
      {saveStatusTarget ? createPortal(
        <span className={`univer-file-editor-status${saving ? ' is-saving' : error ? ' is-error' : ' is-saved'}`} role="status" aria-live="polite">
          {saving ? '自动保存中…' : error ? error : notice || '已自动保存'}
        </span>,
        saveStatusTarget,
      ) : null}
    </section>
  )
}
