import { createEffect, createMemo, createSignal, For, onCleanup, Show, type Accessor } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useBrowser } from "@/context/browser"
import type { BrowserDevToolsMode } from "@/context/browser"
import { useLanguage } from "@/context/language"
import { useSessionLayout } from "@/pages/session/session-layout"

const DEFAULT_URL = "about:blank"

type DevToolsOption = {
  mode: BrowserDevToolsMode
  label: "browser.devTools.right" | "browser.devTools.bottom" | "browser.devTools.window"
}

const DEVTOOLS_OPTIONS: DevToolsOption[] = [
  { mode: "right", label: "browser.devTools.right" },
  { mode: "bottom", label: "browser.devTools.bottom" },
  { mode: "detach", label: "browser.devTools.window" },
]

const normalizeUrl = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return DEFAULT_URL
  if (URL.canParse(trimmed)) return trimmed
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(trimmed)) return `http://${trimmed}`
  if (/^[\w.-]+(:\d+)?(\/|$)/.test(trimmed)) return `https://${trimmed}`
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

export function BrowserPanel(props: { active: Accessor<boolean> }) {
  const browser = useBrowser()
  const language = useLanguage()
  const { params, view } = useSessionLayout()
  const [input, setInput] = createSignal(DEFAULT_URL)
  const [devToolsMenuOpen, setDevToolsMenuOpen] = createSignal(false)
  let viewport: HTMLDivElement | undefined

  const dir = createMemo(() => params.dir ?? "")
  const url = createMemo(() => view().browser.url() ?? DEFAULT_URL)
  const state = createMemo(() => browser.state(dir()))

  createEffect(() => {
    setInput(url())
  })

  createEffect(() => {
    const key = dir()
    const el = viewport
    if (!key || !el) return
    browser.register(key, el)
  })

  createEffect(() => {
    const key = dir()
    if (!key) return
    browser.setActive(key, props.active())
    onCleanup(() => browser.setActive(key, false))
  })

  createEffect(() => {
    const key = dir()
    if (!key) return
    browser.setOccluded(key, "devtools-menu", devToolsMenuOpen())
    onCleanup(() => browser.setOccluded(key, "devtools-menu", false))
  })

  const navigate = () => {
    const next = normalizeUrl(input())
    view().browser.setUrl(next)
    setInput(next)
    browser.navigate(dir(), next)
  }

  return (
    <div id="browser-panel" class="flex flex-col h-full overflow-hidden bg-background-stronger contain-strict">
      <div class="h-10 flex items-center gap-1 px-2 border-b border-border-weaker-base bg-background-stronger">
        <Tooltip placement="bottom" value={language.t("browser.back")}>
          <Button
            variant="ghost"
            class="w-7 h-7 p-0 shrink-0"
            disabled={!state().canGoBack}
            onClick={() => browser.back(dir())}
            aria-label={language.t("browser.back")}
          >
            <Icon name="arrow-left" size="small" />
          </Button>
        </Tooltip>
        <Tooltip placement="bottom" value={language.t("browser.forward")}>
          <Button
            variant="ghost"
            class="w-7 h-7 p-0 shrink-0"
            disabled={!state().canGoForward}
            onClick={() => browser.forward(dir())}
            aria-label={language.t("browser.forward")}
          >
            <Icon name="arrow-right" size="small" />
          </Button>
        </Tooltip>
        <Tooltip placement="bottom" value={language.t("browser.reload")}>
          <Button
            variant="ghost"
            class="w-7 h-7 p-0 shrink-0"
            onClick={() => browser.reload(dir())}
            aria-label={language.t("browser.reload")}
          >
            <Icon name="reset" size="small" classList={{ "animate-spin": state().loading }} />
          </Button>
        </Tooltip>
        <DropdownMenu gutter={4} placement="bottom-end" open={devToolsMenuOpen()} onOpenChange={setDevToolsMenuOpen}>
          <DropdownMenu.Trigger
            as={Button}
            variant="ghost"
            class="w-7 h-7 p-0 shrink-0 data-[expanded]:bg-surface-raised-base-active"
            aria-label={language.t("browser.devTools")}
          >
            <Icon name="code" size="small" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content>
              <DropdownMenu.Group>
                <DropdownMenu.GroupLabel>{language.t("browser.devTools")}</DropdownMenu.GroupLabel>
                <For each={DEVTOOLS_OPTIONS}>
                  {(option) => (
                    <DropdownMenu.Item
                      onSelect={() => {
                        setDevToolsMenuOpen(false)
                        browser.devTools(dir(), option.mode)
                      }}
                    >
                      <DropdownMenu.ItemLabel>{language.t(option.label)}</DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  )}
                </For>
              </DropdownMenu.Group>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
        <form
          class="flex-1 min-w-0"
          onSubmit={(event) => {
            event.preventDefault()
            navigate()
          }}
        >
          <input
            class="w-full h-7 rounded-md border border-border-weak-base bg-surface-panel px-2 text-12-regular text-text-strong outline-none focus:border-border-strong-base"
            value={input()}
            onInput={(event) => setInput(event.currentTarget.value)}
            placeholder={language.t("browser.url.placeholder")}
            aria-label={language.t("browser.url.placeholder")}
          />
        </form>
        <Tooltip placement="bottom" value={language.t("browser.go")}>
          <Button variant="ghost" class="w-7 h-7 p-0 shrink-0" onClick={navigate} aria-label={language.t("browser.go")}>
            <Icon name="enter" size="small" />
          </Button>
        </Tooltip>
      </div>
      <div ref={viewport} class="relative flex-1 min-h-0 bg-background-base">
        <Show when={url() === DEFAULT_URL}>
          <div class="absolute inset-0 pointer-events-none flex items-center justify-center bg-background-base text-text-weak">
            <Icon name="browser" size="large" />
          </div>
        </Show>
      </div>
    </div>
  )
}
