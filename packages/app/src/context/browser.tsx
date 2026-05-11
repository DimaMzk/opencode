import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createContext, createEffect, createMemo, For, onCleanup, type ParentProps, useContext } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useLayout } from "@/context/layout"

const DEFAULT_URL = "about:blank"

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
  devTools: (dir: string) => void
}

const defaultChrome = { loading: false, canGoBack: false, canGoForward: false }
const Browser = createContext<BrowserContext>()

function BrowserNativeView(props: {
  dir: string
  active: () => boolean
  viewport: () => HTMLElement | undefined
}) {
  const layout = useLayout()
  const view = createMemo(() => layout.view(props.dir))
  const url = createMemo(() => view().browser.url() ?? DEFAULT_URL)
  let lastRect: Rect | undefined
  let loadedUrl: string | undefined

  const api = () => window.api

  const setBounds = (rect: Rect) => {
    if (
      lastRect &&
      lastRect.top === rect.top &&
      lastRect.left === rect.left &&
      lastRect.width === rect.width &&
      lastRect.height === rect.height
    )
      return

    lastRect = rect
    void api()?.browserSetBounds?.(props.dir, rect)
  }

  const updateRect = () => {
    const el = props.viewport()
    if (!el) return
    const next = el.getBoundingClientRect()
    setBounds({ top: next.top, left: next.left, width: next.width, height: next.height })
  }

  createEffect(() => {
    const el = props.viewport()
    if (!el) return
    updateRect()
    createResizeObserver(el, updateRect)
  })

  makeEventListener(window, "resize", updateRect)
  makeEventListener(window, "scroll", updateRect, { capture: true })

  const loadUrl = (next: string) => {
    if (next === DEFAULT_URL) return
    if (loadedUrl === next) return
    loadedUrl = next
    void api()?.browserNavigate?.(props.dir, next)
  }

  createEffect(() => {
    if (!props.dir) return
    void api()?.browserEnsure?.(props.dir, url())
  })

  createEffect(() => {
    updateRect()
    void api()?.browserSetActive?.(props.dir, props.active() && !!props.viewport() && url() !== DEFAULT_URL)
  })

  createEffect(() => loadUrl(url()))

  onCleanup(() => {
    void api()?.browserSetActive?.(props.dir, false)
  })

  return null
}

export function BrowserProvider(props: ParentProps) {
  const layout = useLayout()
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

  if (window.api?.onBrowserState) {
    const cleanup = window.api.onBrowserState((state) => {
      ensure(state.dir)
      layout.view(state.dir).browser.setUrl(state.url)
      setStore("chrome", state.dir, reconcile({
        loading: state.loading,
        canGoBack: state.canGoBack,
        canGoForward: state.canGoForward,
      }))
    })
    onCleanup(cleanup)
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
    },
    back(dir) {
      void window.api?.browserBack?.(dir)
    },
    forward(dir) {
      void window.api?.browserForward?.(dir)
    },
    reload(dir) {
      void window.api?.browserReload?.(dir)
    },
    devTools(dir) {
      void window.api?.browserToggleDevTools?.(dir)
    },
  }

  return (
    <Browser.Provider value={api}>
      {props.children}
      <For each={store.dirs}>
        {(dir) => (
          <BrowserNativeView
            dir={dir}
            active={() => store.active[dir] ?? false}
            viewport={() => store.viewport[dir]}
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
