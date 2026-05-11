import { BrowserWindow, WebContentsView, shell } from "electron"
import type { IpcMainInvokeEvent } from "electron"
import type { BrowserRect, BrowserState } from "../preload/types"

const DEFAULT_URL = "about:blank"
const PARTITION = "persist:opencode-browser"

const windows = new WeakMap<BrowserWindow, Map<string, WebContentsView>>()

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
    windows.set(win, next)
    win.on("closed", () => {
        for (const view of next.values()) view.webContents.close()
        next.clear()
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
    view.webContents.on("destroyed", () => map.delete(dir))

    win.contentView.addChildView(view)
    map.set(dir, view)
    return view
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

    ensure(win, dir).setBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
    })
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
