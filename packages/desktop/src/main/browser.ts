import { BrowserWindow, WebContentsView, shell } from "electron"
import type { IpcMainInvokeEvent } from "electron"
import type { BrowserDevToolsMode, BrowserRect, BrowserState } from "../preload/types"
import { BROWSER_ANNOTATION_SCRIPT, parseBrowserAnnotation } from "./browser-annotation"

const DEFAULT_URL = "about:blank"
const PARTITION = "persist:opencode-browser"

const windows = new WeakMap<BrowserWindow, Map<string, WebContentsView>>()
const windowBounds = new WeakMap<BrowserWindow, Map<string, BrowserRect>>()
const activeWindows = new Set<BrowserWindow>()

export type BrowserAutomationTarget = {
  dir: string
  directory?: string
  view: WebContentsView
}

type BrowserMcpRegistration = {
  register: (target: { dir: string; directory: string }) => Promise<void>
}

let mcpRegistration: BrowserMcpRegistration | undefined
const mcpRegisteredDirs = new Set<string>()

function decodeDirKey(dir: string) {
  try {
    const binary = atob(dir.replace(/-/g, "+").replace(/_/g, "/"))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return undefined
  }
}

function maybeRegisterMcp(dir: string) {
  if (!mcpRegistration || mcpRegisteredDirs.has(dir)) return

  const directory = decodeDirKey(dir)
  if (!directory) return

  mcpRegisteredDirs.add(dir)
  void mcpRegistration.register({ dir, directory }).catch(() => {
    mcpRegisteredDirs.delete(dir)
  })
}

function applyBounds(view: WebContentsView, rect: BrowserRect, zoom: number) {
  view.setBounds({
    x: Math.round(rect.left * zoom),
    y: Math.round(rect.top * zoom),
    width: Math.max(1, Math.round(rect.width * zoom)),
    height: Math.max(1, Math.round(rect.height * zoom)),
  })
}

function bounds(win: BrowserWindow) {
  const existing = windowBounds.get(win)
  if (existing) return existing

  const next = new Map<string, BrowserRect>()
  windowBounds.set(win, next)
  return next
}

function state(dir: string, view: WebContentsView, loading = false): BrowserState {
  return {
    dir,
    url: view.webContents.getURL() || DEFAULT_URL,
    loading,
    canGoBack: view.webContents.navigationHistory.canGoBack(),
    canGoForward: view.webContents.navigationHistory.canGoForward(),
  }
}

function send(win: BrowserWindow, dir: string, view: WebContentsView, loading = false) {
  win.webContents.send("browser-state", state(dir, view, loading))
}

function views(win: BrowserWindow) {
  const existing = windows.get(win)
  if (existing) return existing

  const next = new Map<string, WebContentsView>()
  activeWindows.add(win)
  windows.set(win, next)
  win.on("closed", () => {
    activeWindows.delete(win)
    for (const view of next.values()) view.webContents.close()
    next.clear()
    windowBounds.get(win)?.clear()
  })
  return next
}

function ensure(win: BrowserWindow, dir: string) {
  const map = views(win)
  const existing = map.get(dir)
  if (existing) return existing

  const view = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  view.setBackgroundColor("#ffffff")
  view.setVisible(false)
  view.webContents.setZoomFactor(win.webContents.getZoomFactor())
  view.webContents.setWindowOpenHandler((details) => {
    if (URL.canParse(details.url)) {
      const url = new URL(details.url)
      if (["http:", "https:", "mailto:"].includes(url.protocol)) void shell.openExternal(url.toString())
    }
    return { action: "deny" }
  })
  view.webContents.on("did-start-loading", () => send(win, dir, view, true))
  view.webContents.on("did-stop-loading", () => send(win, dir, view))
  view.webContents.on("did-navigate", () => send(win, dir, view))
  view.webContents.on("did-navigate-in-page", (_event, _url, isMainFrame) => {
    if (!isMainFrame) return
    send(win, dir, view)
  })
  view.webContents.on("dom-ready", () => send(win, dir, view))
  view.webContents.on("destroyed", () => {
    map.delete(dir)
    windowBounds.get(win)?.delete(dir)
  })

  win.contentView.addChildView(view)
  map.set(dir, view)
  maybeRegisterMcp(dir)
  return view
}

export function browserAutomationTargets(): BrowserAutomationTarget[] {
  const result: BrowserAutomationTarget[] = []
  for (const win of activeWindows) {
    const map = windows.get(win)
    if (!map) continue
    for (const [dir, view] of map) {
      if (view.webContents.isDestroyed()) continue
      result.push({ dir, directory: decodeDirKey(dir), view })
    }
  }
  return result
}

export function browserAutomationTarget(dir: string): BrowserAutomationTarget | undefined {
  for (const target of browserAutomationTargets()) {
    if (target.dir === dir || target.directory === dir) return target
  }
}

export function browserSetMcpRegistration(registration: BrowserMcpRegistration | undefined) {
  mcpRegistration = registration
  mcpRegisteredDirs.clear()
  if (!registration) return
  for (const target of browserAutomationTargets()) maybeRegisterMcp(target.dir)
}

function windowFrom(event: IpcMainInvokeEvent) {
  return BrowserWindow.fromWebContents(event.sender)
}

export function browserEnsure(event: IpcMainInvokeEvent, dir: string, url?: string) {
  const win = windowFrom(event)
  if (!win || !dir) return

  const view = ensure(win, dir)
  if (url && url !== DEFAULT_URL && view.webContents.getURL() !== url) void view.webContents.loadURL(url)
  send(win, dir, view, view.webContents.isLoading())
}

export function browserSetBounds(event: IpcMainInvokeEvent, dir: string, rect: BrowserRect) {
  const win = windowFrom(event)
  if (!win || !dir) return

  bounds(win).set(dir, rect)
  applyBounds(ensure(win, dir), rect, win.webContents.getZoomFactor())
}

export async function browserCapture(event: IpcMainInvokeEvent, dir: string) {
  const win = windowFrom(event)
  const view = win && views(win).get(dir)
  if (!view) return null

  return (await view.webContents.capturePage()).toDataURL()
}

export function browserSetZoomFactor(win: BrowserWindow, factor = win.webContents.getZoomFactor()) {
  for (const [dir, view] of views(win)) {
    view.webContents.setZoomFactor(factor)
    const rect = bounds(win).get(dir)
    if (rect) applyBounds(view, rect, factor)
  }
}

export function browserSetActive(event: IpcMainInvokeEvent, dir: string, active: boolean) {
  const win = windowFrom(event)
  if (!win || !dir) return

  const map = views(win)
  const view = ensure(win, dir)
  if (!active) {
    view.setVisible(false)
    return
  }

  for (const [key, item] of map) item.setVisible(key === dir)
  send(win, dir, view, view.webContents.isLoading())
}

export function browserNavigate(event: IpcMainInvokeEvent, dir: string, url: string) {
  const win = windowFrom(event)
  if (!win || !dir || !url || url === DEFAULT_URL) return

  const view = ensure(win, dir)
  if (view.webContents.getURL() === url) return
  void view.webContents.loadURL(url)
}

export function browserBack(event: IpcMainInvokeEvent, dir: string) {
  const win = windowFrom(event)
  const view = win && views(win).get(dir)
  if (!view?.webContents.navigationHistory.canGoBack()) return
  view.webContents.navigationHistory.goBack()
}

export function browserForward(event: IpcMainInvokeEvent, dir: string) {
  const win = windowFrom(event)
  const view = win && views(win).get(dir)
  if (!view?.webContents.navigationHistory.canGoForward()) return
  view.webContents.navigationHistory.goForward()
}

export function browserReload(event: IpcMainInvokeEvent, dir: string) {
  const win = windowFrom(event)
  if (!win) return
  views(win).get(dir)?.webContents.reload()
}

export function browserOpenDevTools(event: IpcMainInvokeEvent, dir: string, mode: BrowserDevToolsMode) {
  const win = windowFrom(event)
  const view = win && views(win).get(dir)
  if (!view) return

  if (view.webContents.isDevToolsOpened()) view.webContents.closeDevTools()

  view.webContents.openDevTools({ mode })
}

export async function browserAnnotate(event: IpcMainInvokeEvent, dir: string) {
  const win = windowFrom(event)
  const view = win && views(win).get(dir)
  if (!view || view.webContents.isDestroyed()) return null

  const result = await view.webContents.executeJavaScript(BROWSER_ANNOTATION_SCRIPT, true).catch((error) => {
    console.warn("[opencode] Browser annotation script failed", error)
    return null
  })
  return parseBrowserAnnotation(result)
}
