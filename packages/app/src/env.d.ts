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

declare global {
  interface Window {
    api?: {
      setTitlebar?: (theme: { mode: "light" | "dark" }) => Promise<void>
      browserEnsure?: (dir: string, url?: string) => Promise<void>
      browserSetBounds?: (dir: string, rect: BrowserRect) => Promise<void>
      browserSetActive?: (dir: string, active: boolean) => Promise<void>
      browserNavigate?: (dir: string, url: string) => Promise<void>
      browserBack?: (dir: string) => Promise<void>
      browserForward?: (dir: string) => Promise<void>
      browserReload?: (dir: string) => Promise<void>
      browserToggleDevTools?: (dir: string) => Promise<void>
      onBrowserState?: (cb: (state: BrowserState) => void) => () => void
    }
  }
}

export { }
