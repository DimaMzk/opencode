import type { BrowserAnnotation } from "../preload/types"

export const BROWSER_ANNOTATION_SCRIPT = `
(() => new Promise((resolve) => {
  try {
  const existing = document.getElementById("opencode-browser-annotation-root")
  if (existing) existing.remove()

  const limit = (value, max) => {
    const text = String(value || "").replace(/\s+/g, " ").trim()
    return text.length > max ? text.slice(0, max) + "..." : text
  }
  const cssEscape = (value) => globalThis.CSS?.escape ? globalThis.CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&")
  const attrsFor = (el) => {
    const out = {}
    for (const attr of Array.from(el.attributes || [])) {
      if (attr.name === "style" || attr.name.startsWith("on")) continue
      if (attr.value.length > 240) continue
      if (attr.name === "class" && attr.value.length > 160) continue
      out[attr.name] = attr.value
    }
    return out
  }
  const selectorFor = (node) => {
    if (!(node instanceof Element)) return ""
    if (node.id) return "#" + cssEscape(node.id)
    const stable = ["data-testid", "data-test", "data-cy", "data-qa", "aria-label", "name"]
    for (const name of stable) {
      const value = node.getAttribute(name)
      if (value) return node.localName + "[" + name + '=\"' + cssEscape(value) + '\"]'
    }
    const parts = []
    let el = node
    while (el && el.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
      let part = el.localName
      for (const name of stable) {
        const value = el.getAttribute(name)
        if (value) {
          part += "[" + name + '=\"' + cssEscape(value) + '\"]'
          parts.unshift(part)
          return parts.join(" > ")
        }
      }
      const parent = el.parentElement
      if (parent) {
        const same = Array.from(parent.children).filter((child) => child.localName === el.localName)
        if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(el) + 1) + ")"
      }
      parts.unshift(part)
      el = parent
    }
    return parts.join(" > ")
  }
  const xpathFor = (node) => {
    if (!(node instanceof Element)) return ""
    const parts = []
    let el = node
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      const parent = el.parentElement
      if (!parent) {
        parts.unshift("/" + el.localName)
        break
      }
      const same = Array.from(parent.children).filter((child) => child.localName === el.localName)
      parts.unshift(el.localName + "[" + (same.indexOf(el) + 1) + "]")
      el = parent
    }
    return "/" + parts.join("/").replace(/^\\/+/, "")
  }
  const nameFor = (el) => {
    if (!(el instanceof Element)) return undefined
    return limit(el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("title") || el.getAttribute("placeholder") || el.textContent, 180) || undefined
  }
  const closestHeading = (el) => {
    const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']"))
    const rect = el.getBoundingClientRect()
    return headings
      .map((heading) => ({ heading, rect: heading.getBoundingClientRect() }))
      .filter((item) => item.rect.top <= rect.top && item.rect.width > 0 && item.rect.height > 0)
      .sort((a, b) => b.rect.top - a.rect.top)
      .map((item) => limit(item.heading.textContent, 180))
      .find(Boolean)
  }
  const describe = (el) => {
    const rect = el.getBoundingClientRect()
    const parentText = el.parentElement ? limit(el.parentElement.textContent, 500) : undefined
    return {
      selector: selectorFor(el) || undefined,
      xpath: xpathFor(el) || undefined,
      tag: el.localName,
      role: el.getAttribute("role") || undefined,
      name: nameFor(el),
      text: limit(el.textContent, 500) || undefined,
      attributes: attrsFor(el),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY),
        devicePixelRatio: window.devicePixelRatio || 1,
      },
      ancestry: Array.from(function* () {
        let current = el.parentElement
        let count = 0
        while (current && count < 5) {
          yield {
            tag: current.localName,
            selector: selectorFor(current) || undefined,
            text: limit(current.textContent, 180) || undefined,
            attributes: attrsFor(current),
          }
          current = current.parentElement
          count++
        }
      }()),
      nearbyText: parentText || undefined,
      closestHeading: closestHeading(el) || undefined,
    }
  }

  const root = document.createElement("div")
  root.id = "opencode-browser-annotation-root"
  root.style.position = "fixed"
  root.style.inset = "0"
  root.style.zIndex = "2147483647"
  root.style.pointerEvents = "none"
  root.style.fontFamily = "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"

  const hint = document.createElement("div")
  hint.textContent = "Click an element to annotate. Esc cancels."
  hint.style.position = "fixed"
  hint.style.top = "12px"
  hint.style.left = "50%"
  hint.style.transform = "translateX(-50%)"
  hint.style.padding = "7px 10px"
  hint.style.borderRadius = "6px"
  hint.style.background = "rgba(17, 24, 39, 0.94)"
  hint.style.color = "white"
  hint.style.fontSize = "12px"
  hint.style.boxShadow = "0 8px 30px rgba(0,0,0,0.25)"
  root.appendChild(hint)

  const outline = document.createElement("div")
  outline.style.position = "fixed"
  outline.style.border = "2px solid #0ea5e9"
  outline.style.background = "rgba(14, 165, 233, 0.12)"
  outline.style.boxShadow = "0 0 0 1px rgba(255,255,255,0.8), 0 0 0 99999px rgba(0,0,0,0.08)"
  outline.style.borderRadius = "4px"
  outline.style.display = "none"
  root.appendChild(outline)

  const popover = document.createElement("form")
  popover.style.position = "fixed"
  popover.style.width = "280px"
  popover.style.padding = "10px"
  popover.style.borderRadius = "7px"
  popover.style.background = "white"
  popover.style.boxShadow = "0 18px 50px rgba(0,0,0,0.32)"
  popover.style.border = "1px solid rgba(15,23,42,0.14)"
  popover.style.display = "none"
  popover.style.pointerEvents = "auto"

  const label = document.createElement("label")
  label.textContent = "Annotate element"
  label.style.display = "block"
  label.style.fontSize = "12px"
  label.style.fontWeight = "600"
  label.style.color = "#111827"
  label.style.marginBottom = "6px"

  const textarea = document.createElement("textarea")
  textarea.rows = 4
  textarea.placeholder = "What should the agent know?"
  textarea.style.boxSizing = "border-box"
  textarea.style.width = "100%"
  textarea.style.resize = "vertical"
  textarea.style.border = "1px solid #cbd5e1"
  textarea.style.borderRadius = "6px"
  textarea.style.padding = "7px"
  textarea.style.font = "12px ui-sans-serif,system-ui"
  textarea.style.color = "#111827"
  textarea.style.outline = "none"

  const actions = document.createElement("div")
  actions.style.display = "flex"
  actions.style.justifyContent = "flex-end"
  actions.style.gap = "6px"
  actions.style.marginTop = "8px"

  const cancelButton = document.createElement("button")
  cancelButton.type = "button"
  cancelButton.textContent = "Cancel"
  cancelButton.style.border = "0"
  cancelButton.style.background = "transparent"
  cancelButton.style.color = "#475569"
  cancelButton.style.font = "12px ui-sans-serif,system-ui"
  cancelButton.style.padding = "5px 8px"
  cancelButton.style.borderRadius = "5px"

  const submitButton = document.createElement("button")
  submitButton.type = "submit"
  submitButton.textContent = "Add"
  submitButton.style.border = "0"
  submitButton.style.background = "#0f172a"
  submitButton.style.color = "white"
  submitButton.style.font = "12px ui-sans-serif,system-ui"
  submitButton.style.padding = "5px 9px"
  submitButton.style.borderRadius = "5px"

  actions.append(cancelButton, submitButton)
  popover.append(label, textarea, actions)
  root.appendChild(popover)
  document.documentElement.appendChild(root)

  let selected
  let done = false
  const cleanup = (value) => {
    if (done) return
    done = true
    document.removeEventListener("mousemove", onMove, true)
    document.removeEventListener("click", onClick, true)
    document.removeEventListener("keydown", onKey, true)
    root.remove()
    resolve(value)
  }
  const targetFrom = (event) => {
    const target = event.target
    if (!(target instanceof Element)) return undefined
    if (root.contains(target)) return undefined
    return target.closest("a,button,input,textarea,select,[role='button'],[role='link'],[role='textbox'],[tabindex]") || target
  }
  const showOutline = (el) => {
    const rect = el.getBoundingClientRect()
    outline.style.display = "block"
    outline.style.left = Math.round(rect.left) + "px"
    outline.style.top = Math.round(rect.top) + "px"
    outline.style.width = Math.max(1, Math.round(rect.width)) + "px"
    outline.style.height = Math.max(1, Math.round(rect.height)) + "px"
  }
  const showPopover = (el) => {
    selected = el
    showOutline(el)
    const rect = el.getBoundingClientRect()
    popover.style.display = "block"
    popover.style.left = Math.min(window.innerWidth - 292, Math.max(12, rect.left)) + "px"
    popover.style.top = Math.min(window.innerHeight - 170, Math.max(12, rect.bottom + 8)) + "px"
    textarea.focus()
  }
  const onMove = (event) => {
    if (selected) return
    const el = targetFrom(event)
    if (el) showOutline(el)
  }
  const onClick = (event) => {
    const target = event.target
    if (target instanceof Element && root.contains(target)) return
    const el = targetFrom(event)
    if (!el) return
    event.preventDefault()
    event.stopPropagation()
    showPopover(el)
  }
  const onKey = (event) => {
    if (event.key !== "Escape") return
    event.preventDefault()
    cleanup(null)
  }
  cancelButton.addEventListener("click", () => cleanup(null))
  popover.addEventListener("submit", (event) => {
    event.preventDefault()
    if (!selected) return
    const comment = textarea.value.trim()
    if (!comment) return
    cleanup({ url: location.href, title: document.title, comment, element: describe(selected) })
  })
  document.addEventListener("mousemove", onMove, true)
  document.addEventListener("click", onClick, true)
  document.addEventListener("keydown", onKey, true)
  } catch (error) {
    console.warn("[opencode] Browser annotation failed", error)
    resolve(null)
  }
}))()
`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function string(value: unknown) {
  return typeof value === "string" && value ? value : undefined
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function stringMap(value: unknown) {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

export function parseBrowserAnnotation(value: unknown): BrowserAnnotation | null {
  if (!isRecord(value) || !isRecord(value.element)) return null

  const url = string(value.url)
  const title = typeof value.title === "string" ? value.title : ""
  const comment = string(value.comment)
  const tag = string(value.element.tag)
  if (!url || !comment || !tag) return null

  const rect = isRecord(value.element.rect) ? value.element.rect : {}
  const viewport = isRecord(value.element.viewport) ? value.element.viewport : {}
  const ancestry = Array.isArray(value.element.ancestry) ? value.element.ancestry : []

  return {
    url,
    title,
    comment,
    element: {
      selector: string(value.element.selector),
      xpath: string(value.element.xpath),
      tag,
      role: string(value.element.role),
      name: string(value.element.name),
      text: string(value.element.text),
      attributes: stringMap(value.element.attributes),
      rect: {
        x: number(rect.x) ?? 0,
        y: number(rect.y) ?? 0,
        width: number(rect.width) ?? 0,
        height: number(rect.height) ?? 0,
      },
      viewport: {
        width: number(viewport.width) ?? 0,
        height: number(viewport.height) ?? 0,
        scrollX: number(viewport.scrollX) ?? 0,
        scrollY: number(viewport.scrollY) ?? 0,
        devicePixelRatio: number(viewport.devicePixelRatio) ?? 1,
      },
      ancestry: ancestry.flatMap((item) => {
        if (!isRecord(item)) return []
        const tag = string(item.tag)
        if (!tag) return []
        return [
          {
            tag,
            selector: string(item.selector),
            text: string(item.text),
            attributes: stringMap(item.attributes),
          },
        ]
      }),
      nearbyText: string(value.element.nearbyText),
      closestHeading: string(value.element.closestHeading),
    },
  }
}
