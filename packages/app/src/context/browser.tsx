import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createContext, createEffect, createMemo, For, onCleanup, type ParentProps, useContext } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useLayout } from "@/context/layout"

const DEFAULT_URL = "about:blank"
const PARTITION = "persist:opencode-browser"

type ChromeState = {
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

type Rect = {
  top: number
  left: number
  width: number
  height: number
}

type BrowserContext = {
  state: (dir: string) => ChromeState
  register: (dir: string, el: HTMLElement) => void
  setActive: (dir: string, active: boolean) => void
  navigate: (dir: string, url: string) => void
  back: (dir: string) => void
  forward: (dir: string) => void
  reload: (dir: string) => void
}

const defaultChrome = { loading: false, canGoBack: false, canGoForward: false }
const Browser = createContext<BrowserContext>()

function BrowserWebview(props: {
  dir: string
  active: () => boolean
  viewport: () => HTMLElement | undefined
  chrome: (state: ChromeState) => void
  bind: (dir: string, webview: WebViewTag | undefined) => void
}) {
  const layout = useLayout()
  const view = createMemo(() => layout.view(props.dir))
  const url = createMemo(() => view().browser.url() ?? DEFAULT_URL)
  const [rect, setRect] = createStore<Rect>({ top: 0, left: -10000, width: 1, height: 1 })
  let webview: WebViewTag | undefined

  const updateRect = () => {
    const el = props.viewport()
    if (!el) return
    const next = el.getBoundingClientRect()
    setRect({ top: next.top, left: next.left, width: next.width, height: next.height })
  }

  createEffect(() => {
    const el = props.viewport()
    if (!el) return
    updateRect()
    createResizeObserver(el, updateRect)
  })

  makeEventListener(window, "resize", updateRect)
  makeEventListener(window, "scroll", updateRect, { capture: true })

  const syncChrome = (loading = false) => {
    if (!webview) return
    props.chrome({ loading, canGoBack: webview.canGoBack(), canGoForward: webview.canGoForward() })
  }

  const setUrl = (next: string) => {
    view().browser.setUrl(next)
  }

  const bind = (node: WebViewTag) => {
    webview = node
    props.bind(props.dir, node)

    makeEventListener(node, "did-start-loading", () => syncChrome(true))
    makeEventListener(node, "did-stop-loading", () => {
      syncChrome(false)
      setUrl(node.getURL())
    })
    makeEventListener(node, "did-navigate", (event) => {
      setUrl((event as WebViewNavigationEvent).url ?? node.getURL())
      syncChrome()
    })
    makeEventListener(node, "did-navigate-in-page", (event) => {
      setUrl((event as WebViewNavigationEvent).url ?? node.getURL())
      syncChrome()
    })
    makeEventListener(node, "dom-ready", () => syncChrome())

    onCleanup(() => {
      props.bind(props.dir, undefined)
      if (webview === node) webview = undefined
    })
  }

  const visible = createMemo(() => props.active() && !!props.viewport() && url() !== DEFAULT_URL)

  return (
    <webview
      ref={bind}
      src={url()}
      partition={PARTITION}
      allowpopups
      webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
      class="fixed bg-white"
      style={{
        top: `${visible() ? rect.top : 0}px`,
        left: `${visible() ? rect.left : -10000}px`,
        width: `${visible() ? rect.width : 1}px`,
        height: `${visible() ? rect.height : 1}px`,
        opacity: visible() ? 1 : 0,
        "pointer-events": visible() ? "auto" : "none",
        "z-index": 35,
      }}
    />
  )
}

export function BrowserProvider(props: ParentProps) {
  const layout = useLayout()
  const webviews = new Map<string, WebViewTag>()
  const [store, setStore] = createStore({
    dirs: [] as string[],
    viewport: {} as Record<string, HTMLElement | undefined>,
    active: {} as Record<string, boolean>,
    chrome: {} as Record<string, ChromeState>,
  })

  const ensure = (dir: string) => {
    if (!dir || store.dirs.includes(dir)) return
    setStore("dirs", store.dirs.length, dir)
  }

  const api: BrowserContext = {
    state(dir) {
      return store.chrome[dir] ?? defaultChrome
    },
    register(dir, el) {
      ensure(dir)
      setStore("viewport", dir, el)
      onCleanup(() => {
        if (store.viewport[dir] === el) setStore("viewport", dir, undefined)
      })
    },
    setActive(dir, active) {
      ensure(dir)
      setStore("active", dir, active)
    },
    navigate(dir, url) {
      ensure(dir)
      layout.view(dir).browser.setUrl(url)
      webviews.get(dir)?.loadURL(url)
    },
    back(dir) {
      webviews.get(dir)?.goBack()
    },
    forward(dir) {
      webviews.get(dir)?.goForward()
    },
    reload(dir) {
      webviews.get(dir)?.reload()
    },
  }

  return (
    <Browser.Provider value={api}>
      {props.children}
      <For each={store.dirs}>
        {(dir) => (
          <BrowserWebview
            dir={dir}
            active={() => store.active[dir] ?? false}
            viewport={() => store.viewport[dir]}
            chrome={(chrome) => setStore("chrome", dir, chrome)}
            bind={(key, webview) => {
              if (webview) {
                webviews.set(key, webview)
                return
              }
              webviews.delete(key)
              setStore(
                "chrome",
                produce((draft) => {
                  delete draft[key]
                }),
              )
            }}
          />
        )}
      </For>
    </Browser.Provider>
  )
}

export function useBrowser() {
  const value = useContext(Browser)
  if (!value) throw new Error("Browser context must be used within a context provider")
  return value
}