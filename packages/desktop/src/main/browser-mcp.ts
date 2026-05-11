import { randomUUID } from "node:crypto"
import { createServer } from "node:http"
import type { IncomingMessage, Server as HttpServer, ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { browserAutomationTarget, browserAutomationTargets } from "./browser"

type JsonRpcId = string | number

type JsonRpcRequest = {
  jsonrpc?: "2.0"
  id?: JsonRpcId
  method?: string
  params?: Record<string, unknown>
}

type JsonRpcResponse = {
  jsonrpc: "2.0"
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string }
}

type JsonSchema = {
  type: "object"
  properties?: Record<string, object>
  required?: string[]
  additionalProperties?: boolean
}

type Tool = {
  name: string
  title?: string
  description?: string
  inputSchema: JsonSchema
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
}

type CallToolResult = {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>
  isError?: boolean
}

type BrowserMcpBridge = {
  token: string
  urlFor: (dir: string) => string
  stop: () => Promise<void>
}

const VERSION = "1.0.0"
const TOOL_SCHEMAS = {
  empty: schema({}),
  navigate: schema(
    {
      url: { type: "string", description: "Absolute URL to load in the embedded browser." },
    },
    ["url"],
  ),
  click: schema({
    selector: { type: "string", description: "CSS selector to click. Prefer this when available." },
    x: { type: "number", description: "X coordinate in the browser viewport." },
    y: { type: "number", description: "Y coordinate in the browser viewport." },
  }),
  type: schema(
    {
      text: { type: "string", description: "Text to type into the focused element or selector." },
      selector: { type: "string", description: "Optional CSS selector to focus before typing." },
    },
    ["text"],
  ),
  press: schema(
    {
      key: { type: "string", description: "Electron key code to press, such as Enter, Tab, Escape, or ArrowDown." },
    },
    ["key"],
  ),
  scroll: schema({
    deltaX: { type: "number", description: "Horizontal scroll delta. Defaults to 0." },
    deltaY: { type: "number", description: "Vertical scroll delta. Defaults to 600." },
  }),
} satisfies Record<string, JsonSchema>

const TOOLS: Tool[] = [
  {
    name: "browser_info",
    title: "Browser Info",
    description: "Get the current embedded browser target, URL, title, loading state, and navigation state.",
    inputSchema: TOOL_SCHEMAS.empty,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "browser_snapshot",
    title: "Browser Snapshot",
    description: "Return a compact text and interactive-element snapshot of the embedded browser page.",
    inputSchema: TOOL_SCHEMAS.empty,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "browser_screenshot",
    title: "Browser Screenshot",
    description: "Capture a PNG screenshot of the embedded browser page.",
    inputSchema: TOOL_SCHEMAS.empty,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "browser_navigate",
    title: "Browser Navigate",
    description: "Navigate the embedded browser to an absolute URL.",
    inputSchema: TOOL_SCHEMAS.navigate,
    annotations: { openWorldHint: true },
  },
  {
    name: "browser_click",
    title: "Browser Click",
    description: "Click an element by CSS selector, or click viewport coordinates.",
    inputSchema: TOOL_SCHEMAS.click,
    annotations: { openWorldHint: true },
  },
  {
    name: "browser_type",
    title: "Browser Type",
    description: "Type text into the focused element, optionally focusing a CSS selector first.",
    inputSchema: TOOL_SCHEMAS.type,
    annotations: { openWorldHint: true },
  },
  {
    name: "browser_press",
    title: "Browser Press Key",
    description: "Press a keyboard key in the embedded browser.",
    inputSchema: TOOL_SCHEMAS.press,
    annotations: { openWorldHint: true },
  },
  {
    name: "browser_scroll",
    title: "Browser Scroll",
    description: "Scroll the embedded browser viewport.",
    inputSchema: TOOL_SCHEMAS.scroll,
    annotations: { openWorldHint: true },
  },
]

const SNAPSHOT_SCRIPT = `
(() => {
  const limit = (value, max) => {
    const text = String(value || "").replace(/\s+/g, " ").trim()
    return text.length > max ? text.slice(0, max) + "..." : text
  }
  const cssEscape = (value) => globalThis.CSS?.escape ? globalThis.CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&")
  const selectorFor = (node) => {
    if (!(node instanceof Element)) return ""
    if (node.id) return "#" + cssEscape(node.id)
    const parts = []
    let el = node
    while (el && el.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
      let part = el.localName
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
  const visible = (el) => {
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
  }
  const candidates = Array.from(document.querySelectorAll('a,button,input,textarea,select,summary,[role="button"],[role="link"],[contenteditable="true"],[tabindex]'))
    .filter(visible)
    .slice(0, 100)
    .map((el, index) => {
      const rect = el.getBoundingClientRect()
      return {
        index,
        tag: el.localName,
        selector: selectorFor(el),
        text: limit(el.innerText || el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || el.value, 140),
        role: el.getAttribute("role") || undefined,
        type: el.getAttribute("type") || undefined,
        href: el instanceof HTMLAnchorElement ? el.href : undefined,
        disabled: Boolean(el.disabled || el.getAttribute("aria-disabled") === "true"),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      }
    })
  return {
    url: location.href,
    title: document.title,
    text: limit(document.body?.innerText || "", 6000),
    elements: candidates,
  }
})()
`

export async function startBrowserMcpBridge(): Promise<BrowserMcpBridge> {
  const token = randomUUID()
  const http = createServer(async (req, res) => {
    try {
      if (!authorized(req, token)) {
        res.writeHead(401, { "content-type": "text/plain; charset=utf-8" })
        res.end("Unauthorized")
        return
      }

      const dir = routeDir(req)
      if (!dir) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
        res.end("Not found")
        return
      }

      if (req.method === "GET" || req.method === "DELETE") {
        res.writeHead(405, { allow: "POST", "content-type": "text/plain; charset=utf-8" })
        res.end("Method not allowed")
        return
      }

      if (req.method !== "POST") {
        res.writeHead(405, { allow: "POST", "content-type": "text/plain; charset=utf-8" })
        res.end("Method not allowed")
        return
      }

      const body = await readJson(req)
      const messages = Array.isArray(body) ? body : [body]
      const responses = (await Promise.all(messages.map((message) => handleMessage(dir, message)))).filter(
        (message): message is JsonRpcResponse => Boolean(message),
      )
      if (responses.length === 0) {
        res.writeHead(202)
        res.end()
        return
      }
      writeJson(res, Array.isArray(body) ? responses : responses[0])
    } catch (error) {
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" })
      res.end(error instanceof Error ? error.message : String(error))
    }
  })

  const port = await listen(http)
  return {
    token,
    urlFor: (dir) => `http://127.0.0.1:${port}/mcp/${encodeURIComponent(dir)}`,
    stop: async () => {
      await new Promise<void>((resolve, reject) => http.close((error) => (error ? reject(error) : resolve())))
    },
  }
}

function schema(properties: Record<string, object>, required: string[] = []): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false }
}

async function handleMessage(dir: string, message: unknown): Promise<JsonRpcResponse | undefined> {
  if (!isJsonRpcRequest(message)) return rpcError(0, -32600, "Invalid Request")
  if (message.id === undefined) return undefined

  try {
    switch (message.method) {
      case "initialize":
        return rpcResult(message.id, {
          protocolVersion:
            typeof message.params?.protocolVersion === "string" ? message.params.protocolVersion : "2025-11-25",
          capabilities: { tools: {} },
          serverInfo: { name: "opencode-desktop-browser", version: VERSION },
          instructions: "Controls the OpenCode desktop embedded browser preview for the current workspace.",
        })
      case "ping":
        return rpcResult(message.id, {})
      case "tools/list":
        return rpcResult(message.id, { tools: TOOLS })
      case "tools/call": {
        const params = message.params ?? {}
        const name = typeof params.name === "string" ? params.name : ""
        const args = isRecord(params.arguments) ? params.arguments : {}
        return rpcResult(message.id, await callTool(dir, name, args))
      }
      default:
        return rpcError(message.id, -32601, `Method not found: ${message.method}`)
    }
  } catch (error) {
    return rpcError(message.id, -32000, error instanceof Error ? error.message : String(error))
  }
}

async function callTool(dir: string, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const target = browserAutomationTarget(dir)
  if (!target) return errorResult(`No embedded browser target is registered for workspace ${dir}.`)

  const { view } = target
  switch (name) {
    case "browser_info": {
      return jsonResult({
        dir: target.dir,
        directory: target.directory,
        url: view.webContents.getURL(),
        title: view.webContents.getTitle(),
        loading: view.webContents.isLoading(),
        canGoBack: view.webContents.navigationHistory.canGoBack(),
        canGoForward: view.webContents.navigationHistory.canGoForward(),
        targets: browserAutomationTargets().map((item) => ({ dir: item.dir, directory: item.directory })),
      })
    }
    case "browser_snapshot": {
      const snapshot = await view.webContents.executeJavaScript(SNAPSHOT_SCRIPT, true)
      return jsonResult(snapshot)
    }
    case "browser_screenshot": {
      const png = (await view.webContents.capturePage()).toPNG().toString("base64")
      return { content: [{ type: "image", data: png, mimeType: "image/png" }] }
    }
    case "browser_navigate": {
      const url = requireString(args, "url")
      if (!URL.canParse(url)) return errorResult(`Invalid URL: ${url}`)
      await view.webContents.loadURL(url)
      return textResult(`Navigated to ${url}`)
    }
    case "browser_click": {
      const selector = optionalString(args, "selector")
      if (selector) {
        const result = await view.webContents.executeJavaScript(
          `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { ok: false, error: "Selector not found" }; el.scrollIntoView({ block: "center", inline: "center" }); el.click(); return { ok: true }; })()`,
          true,
        )
        if (!result?.ok) return errorResult(result?.error ?? "Click failed")
        return textResult(`Clicked ${selector}`)
      }

      const x = requireNumber(args, "x")
      const y = requireNumber(args, "y")
      view.webContents.sendInputEvent({
        type: "mouseDown",
        x: Math.round(x),
        y: Math.round(y),
        button: "left",
        clickCount: 1,
      })
      view.webContents.sendInputEvent({
        type: "mouseUp",
        x: Math.round(x),
        y: Math.round(y),
        button: "left",
        clickCount: 1,
      })
      return textResult(`Clicked ${Math.round(x)},${Math.round(y)}`)
    }
    case "browser_type": {
      const selector = optionalString(args, "selector")
      if (selector) {
        const focused = await view.webContents.executeJavaScript(
          `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.scrollIntoView({ block: "center", inline: "center" }); el.focus(); return true; })()`,
          true,
        )
        if (!focused) return errorResult(`Selector not found: ${selector}`)
      }
      const text = requireString(args, "text")
      await view.webContents.insertText(text)
      return textResult(`Typed ${text.length} characters`)
    }
    case "browser_press": {
      const key = requireString(args, "key")
      view.webContents.sendInputEvent({ type: "keyDown", keyCode: key })
      view.webContents.sendInputEvent({ type: "keyUp", keyCode: key })
      return textResult(`Pressed ${key}`)
    }
    case "browser_scroll": {
      const deltaX = optionalNumber(args, "deltaX") ?? 0
      const deltaY = optionalNumber(args, "deltaY") ?? 600
      view.webContents.sendInputEvent({ type: "mouseWheel", x: 1, y: 1, deltaX, deltaY })
      return textResult(`Scrolled by ${deltaX},${deltaY}`)
    }
    default:
      return errorResult(`Unknown tool: ${name}`)
  }
}

function routeDir(req: IncomingMessage) {
  if (!req.url) return
  const url = new URL(req.url, "http://127.0.0.1")
  const match = url.pathname.match(/^\/mcp\/([^/]+)$/)
  return match ? decodeURIComponent(match[1]) : undefined
}

function authorized(req: IncomingMessage, token: string) {
  return req.headers.authorization === `Bearer ${token}`
}

function listen(server: HttpServer) {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo | null
      if (!address) {
        reject(new Error("Browser MCP bridge did not bind to a port"))
        return
      }
      resolve(address.port)
    })
  })
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!isRecord(value)) return false
  if (typeof value.method !== "string") return false
  return value.id === undefined || typeof value.id === "string" || typeof value.id === "number"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function rpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result }
}

function rpcError(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } }
}

function readJson(req: IncomingMessage) {
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("error", reject)
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      } catch (error) {
        reject(error)
      }
    })
  })
}

function writeJson(res: ServerResponse, value: unknown) {
  res.writeHead(200, { "content-type": "application/json" })
  res.end(JSON.stringify(value))
}

function jsonResult(value: unknown): CallToolResult {
  return textResult(JSON.stringify(value, null, 2))
}

function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] }
}

function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] }
}

function requireString(args: Record<string, unknown>, key: string) {
  const value = args[key]
  if (typeof value !== "string" || !value) throw new Error(`Missing required string argument: ${key}`)
  return value
}

function optionalString(args: Record<string, unknown>, key: string) {
  const value = args[key]
  return typeof value === "string" && value ? value : undefined
}

function requireNumber(args: Record<string, unknown>, key: string) {
  const value = args[key]
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Missing required number argument: ${key}`)
  return value
}

function optionalNumber(args: Record<string, unknown>, key: string) {
  const value = args[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export type { BrowserMcpBridge }
