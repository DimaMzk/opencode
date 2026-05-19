import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  type ParentProps,
  useContext,
} from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Portal } from "solid-js/web"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLayout } from "@/context/layout"
import type { BrowserAnnotation } from "@/context/prompt"
import { useSettings } from "@/context/settings"

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

export type BrowserDevToolsMode = "right" | "bottom" | "detach"
type BrowserOcclusionSource = "devtools-menu" | "open-menu" | "status-popover"

type BrowserContext = {
  state: (dir: string) => ChromeState
  register: (dir: string, el: HTMLElement) => void
  setActive: (dir: string, active: boolean) => void
  setOccluded: (dir: string, source: BrowserOcclusionSource, occluded: boolean) => void
  navigate: (dir: string, url: string) => void
  back: (dir: string) => void
  forward: (dir: string) => void
  reload: (dir: string) => void
  screenshot: (dir: string) => Promise<boolean>
  devTools: (dir: string, mode: BrowserDevToolsMode) => void
  annotate: (dir: string) => Promise<BrowserAnnotation | null>
}

const defaultChrome = { loading: false, canGoBack: false, canGoForward: false }
const Browser = createContext<BrowserContext>()

function BrowserNativeView(props: {
  dir: string
  active: () => boolean
  occluded: () => boolean
  loading: () => boolean
  viewport: () => HTMLElement | undefined
}) {
  const layout = useLayout()
  const settings = useSettings()
  const view = createMemo(() => layout.view(props.dir))
  const url = createMemo(() => view().browser.url() ?? DEFAULT_URL)
  const [snapshot, setSnapshot] = createSignal<string | undefined>()
  let lastRect: Rect | undefined
  let loadedUrl: string | undefined
  let captureRequest = 0

  const api = () => window.api

  const setBounds = (rect: Rect) => {
    if (!settings.browser.enabled()) return
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
    if (!settings.browser.enabled()) return
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

  const usable = createMemo(() => settings.browser.enabled() && props.active() && !!props.viewport() && url() !== DEFAULT_URL)

  const refreshSnapshot = async () => {
    const request = ++captureRequest
    const next = await api()?.browserCapture?.(props.dir)
    if (request !== captureRequest || !next) return
    setSnapshot(next)
  }

  createEffect(() => {
    if (!props.dir) return
    if (!settings.browser.enabled()) {
      void api()?.browserSetActive?.(props.dir, false)
      return
    }
    void api()?.browserEnsure?.(props.dir, url(), { userAgent: settings.browser.userAgent() })
  })

  createEffect(() => {
    updateRect()
    if (usable() && props.occluded() && !snapshot()) void refreshSnapshot()
    void api()?.browserSetActive?.(props.dir, usable() && !props.occluded())
  })

  createEffect(() => {
    if (!settings.browser.enabled()) return
    loadUrl(url())
  })

  createEffect(() => {
    if (!usable()) {
      captureRequest++
      setSnapshot(undefined)
      return
    }

    if (props.occluded()) return

    if (props.loading()) return
    void refreshSnapshot()
  })

  onCleanup(() => {
    captureRequest++
    void api()?.browserSetActive?.(props.dir, false)
  })

  return (
    <Show when={props.occluded() && snapshot() ? props.viewport() : undefined}>
      {(el) => (
        <Portal mount={el()}>
          <img
            src={snapshot()}
            alt=""
            aria-hidden="true"
            class="absolute inset-0 h-full w-full object-fill pointer-events-none select-none"
          />
        </Portal>
      )}
    </Show>
  )
}

export function BrowserProvider(props: ParentProps) {
  const layout = useLayout()
  const dialog = useDialog()
  const [store, setStore] = createStore({
    dirs: [] as string[],
    viewport: {} as Record<string, HTMLElement | undefined>,
    active: {} as Record<string, boolean>,
    occluded: {} as Record<string, Partial<Record<BrowserOcclusionSource, boolean>>>,
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
      setStore(
        "chrome",
        state.dir,
        reconcile({
          loading: state.loading,
          canGoBack: state.canGoBack,
          canGoForward: state.canGoForward,
        }),
      )
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
    setOccluded(dir, source, occluded) {
      if (!store.occluded[dir]) setStore("occluded", dir, {})
      setStore("occluded", dir, source, occluded)
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
    screenshot(dir) {
      return window.api?.browserCopyScreenshot?.(dir) ?? Promise.resolve(false)
    },
    devTools(dir, mode) {
      void window.api?.browserOpenDevTools?.(dir, mode)
    },
    annotate(dir) {
      return window.api?.browserAnnotate?.(dir) ?? Promise.resolve(null)
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
            occluded={() => !!dialog.active || Object.values(store.occluded[dir] ?? {}).some(Boolean)}
            loading={() => store.chrome[dir]?.loading ?? false}
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
