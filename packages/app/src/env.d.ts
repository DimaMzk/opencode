declare global {
  interface ImportMetaEnv {
    readonly VITE_OPENCODE_SERVER_HOST: string
    readonly VITE_OPENCODE_SERVER_PORT: string
    readonly VITE_OPENCODE_CHANNEL?: "dev" | "beta" | "prod"

    readonly VITE_SENTRY_DSN?: string
    readonly VITE_SENTRY_ENVIRONMENT?: string
    readonly VITE_SENTRY_RELEASE?: string
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv
  }
}

declare module "solid-js" {
  namespace JSX {
    interface Directives {
      sortable: true
    }
  }
}

type BrowserRect = {
  top: number
  left: number
  width: number
  height: number
}

type BrowserState = {
  dir: string
  url: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

type BrowserAnnotationAttributeMap = Record<string, string>

type BrowserAnnotationRect = {
  x: number
  y: number
  width: number
  height: number
}

type BrowserAnnotationViewport = {
  width: number
  height: number
  scrollX: number
  scrollY: number
  devicePixelRatio: number
}

type BrowserAnnotationAncestor = {
  tag: string
  selector?: string
  text?: string
  attributes: BrowserAnnotationAttributeMap
}

type BrowserAnnotationElement = {
  selector?: string
  xpath?: string
  tag: string
  role?: string
  name?: string
  text?: string
  attributes: BrowserAnnotationAttributeMap
  rect: BrowserAnnotationRect
  viewport: BrowserAnnotationViewport
  ancestry: BrowserAnnotationAncestor[]
  nearbyText?: string
  closestHeading?: string
}

type BrowserAnnotation = {
  url: string
  title: string
  comment: string
  element: BrowserAnnotationElement
}

type BrowserDevToolsMode = "right" | "bottom" | "detach"

declare global {
  interface Window {
    api?: {
      setTitlebar?: (theme: { mode: "light" | "dark" }) => Promise<void>
      browserEnsure?: (dir: string, url?: string, options?: { userAgent?: string }) => Promise<void>
      browserSetBounds?: (dir: string, rect: BrowserRect) => Promise<void>
      browserCapture?: (dir: string) => Promise<string | null>
      browserCopyScreenshot?: (dir: string) => Promise<boolean>
      browserSetActive?: (dir: string, active: boolean) => Promise<void>
      browserNavigate?: (dir: string, url: string) => Promise<void>
      browserBack?: (dir: string) => Promise<void>
      browserForward?: (dir: string) => Promise<void>
      browserReload?: (dir: string) => Promise<void>
      browserOpenDevTools?: (dir: string, mode: BrowserDevToolsMode) => Promise<void>
      browserAnnotate?: (dir: string) => Promise<BrowserAnnotation | null>
      onBrowserState?: (cb: (state: BrowserState) => void) => () => void
    }
  }
}

export { }
