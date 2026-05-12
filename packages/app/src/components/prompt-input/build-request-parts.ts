import { getFilename } from "@opencode-ai/core/util/path"
import { type AgentPartInput, type FilePartInput, type Part, type TextPartInput } from "@opencode-ai/sdk/v2/client"
import type { FileSelection } from "@/context/file"
import { encodeFilePath } from "@/context/file/path"
import type { AgentPart, ContextItem, FileAttachmentPart, ImageAttachmentPart, Prompt } from "@/context/prompt"
import { Identifier } from "@/utils/id"
import { createCommentMetadata, formatCommentNote } from "@/utils/comment-note"

type PromptRequestPart = (TextPartInput | FilePartInput | AgentPartInput) & { id: string }

type BuildRequestPartsInput = {
  prompt: Prompt
  context: (ContextItem & { key: string })[]
  images: ImageAttachmentPart[]
  text: string
  messageID: string
  sessionID: string
  sessionDirectory: string
}

const absolute = (directory: string, path: string) => {
  if (path.startsWith("/")) return path
  if (/^[A-Za-z]:[\\/]/.test(path) || /^[A-Za-z]:$/.test(path)) return path
  if (path.startsWith("\\\\") || path.startsWith("//")) return path
  return `${directory.replace(/[\\/]+$/, "")}/${path}`
}

const fileQuery = (selection: FileSelection | undefined) =>
  selection ? `?start=${selection.startLine}&end=${selection.endLine}` : ""

const mention = /(^|[\s([{"'])@(\S+)/g

const parseCommentMentions = (comment: string) => {
  return Array.from(comment.matchAll(mention)).flatMap((match) => {
    const path = (match[2] ?? "").replace(/[.,!?;:)}\]"']+$/, "")
    if (!path) return []
    return [path]
  })
}

const isFileAttachment = (part: Prompt[number]): part is FileAttachmentPart => part.type === "file"
const isAgentAttachment = (part: Prompt[number]): part is AgentPart => part.type === "agent"

const formatBrowserAnnotationNote = (item: Extract<ContextItem, { type: "browser" }>) => {
  const attributes = Object.entries(item.element.attributes)
    .filter((entry) =>
      ["id", "class", "role", "aria-label", "data-testid", "data-test", "data-cy", "data-qa"].includes(entry[0]),
    )
    .map((entry) => `${entry[0]}=${JSON.stringify(entry[1])}`)
    .join(" ")
  return [
    "The user annotated an element in the embedded browser.",
    `URL: ${item.url}`,
    item.title ? `Page title: ${item.title}` : undefined,
    `Element: ${item.element.tag}`,
    item.element.role ? `Role: ${item.element.role}` : undefined,
    item.element.name ? `Accessible name: ${item.element.name}` : undefined,
    item.element.text ? `Visible text: ${item.element.text}` : undefined,
    item.element.selector ? `CSS selector: ${item.element.selector}` : undefined,
    item.element.xpath ? `XPath: ${item.element.xpath}` : undefined,
    attributes ? `Attributes: ${attributes}` : undefined,
    item.element.closestHeading ? `Nearest heading: ${item.element.closestHeading}` : undefined,
    item.element.nearbyText ? `Nearby text: ${item.element.nearbyText}` : undefined,
    `Viewport rect: x=${item.element.rect.x}, y=${item.element.rect.y}, width=${item.element.rect.width}, height=${item.element.rect.height}`,
    `User comment: ${item.comment}`,
    "Use the URL, route, text, accessibility labels, data attributes, and selector to locate the corresponding frontend code.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n")
}

const toOptimisticPart = (part: PromptRequestPart, sessionID: string, messageID: string): Part => {
  if (part.type === "text") {
    return {
      id: part.id,
      type: "text",
      text: part.text,
      synthetic: part.synthetic,
      ignored: part.ignored,
      time: part.time,
      metadata: part.metadata,
      sessionID,
      messageID,
    }
  }
  if (part.type === "file") {
    return {
      id: part.id,
      type: "file",
      mime: part.mime,
      filename: part.filename,
      url: part.url,
      source: part.source,
      sessionID,
      messageID,
    }
  }
  return {
    id: part.id,
    type: "agent",
    name: part.name,
    source: part.source,
    sessionID,
    messageID,
  }
}

export function buildRequestParts(input: BuildRequestPartsInput) {
  const requestParts: PromptRequestPart[] = [
    {
      id: Identifier.ascending("part"),
      type: "text",
      text: input.text,
    },
  ]

  const files = input.prompt.filter(isFileAttachment).map((attachment) => {
    const path = absolute(input.sessionDirectory, attachment.path)
    return {
      id: Identifier.ascending("part"),
      type: "file",
      mime: "text/plain",
      url: `file://${encodeFilePath(path)}${fileQuery(attachment.selection)}`,
      filename: getFilename(attachment.path),
      source: {
        type: "file",
        text: {
          value: attachment.content,
          start: attachment.start,
          end: attachment.end,
        },
        path,
      },
    } satisfies PromptRequestPart
  })

  const agents = input.prompt.filter(isAgentAttachment).map((attachment) => {
    return {
      id: Identifier.ascending("part"),
      type: "agent",
      name: attachment.name,
      source: {
        value: attachment.content,
        start: attachment.start,
        end: attachment.end,
      },
    } satisfies PromptRequestPart
  })

  const used = new Set(files.map((part) => part.url))
  const context: PromptRequestPart[] = input.context.flatMap((item): PromptRequestPart[] => {
    if (item.type === "browser") {
      const mentions = parseCommentMentions(item.comment).flatMap((path) => {
        const url = `file://${encodeFilePath(absolute(input.sessionDirectory, path))}`
        if (used.has(url)) return []
        used.add(url)
        return [
          {
            id: Identifier.ascending("part"),
            type: "file",
            mime: "text/plain",
            url,
            filename: getFilename(path),
          } satisfies PromptRequestPart,
        ]
      })

      return [
        {
          id: Identifier.ascending("part"),
          type: "text",
          text: formatBrowserAnnotationNote(item),
          synthetic: true,
          metadata: { opencodeBrowserAnnotation: item },
        } satisfies PromptRequestPart,
        ...mentions,
      ]
    }

    const path = absolute(input.sessionDirectory, item.path)
    const url = `file://${encodeFilePath(path)}${fileQuery(item.selection)}`
    const comment = item.comment?.trim()
    if (!comment && used.has(url)) return []
    used.add(url)

    const filePart = {
      id: Identifier.ascending("part"),
      type: "file",
      mime: "text/plain",
      url,
      filename: getFilename(item.path),
    } satisfies PromptRequestPart

    if (!comment) return [filePart]

    const mentions = parseCommentMentions(comment).flatMap((path) => {
      const url = `file://${encodeFilePath(absolute(input.sessionDirectory, path))}`
      if (used.has(url)) return []
      used.add(url)
      return [
        {
          id: Identifier.ascending("part"),
          type: "file",
          mime: "text/plain",
          url,
          filename: getFilename(path),
        } satisfies PromptRequestPart,
      ]
    })

    return [
      {
        id: Identifier.ascending("part"),
        type: "text",
        text: formatCommentNote({ path: item.path, selection: item.selection, comment }),
        synthetic: true,
        metadata: createCommentMetadata({
          path: item.path,
          selection: item.selection,
          comment,
          preview: item.preview,
          origin: item.commentOrigin,
        }),
      } satisfies PromptRequestPart,
      filePart,
      ...mentions,
    ]
  })

  const images = input.images.map((attachment) => {
    return {
      id: Identifier.ascending("part"),
      type: "file",
      mime: attachment.mime,
      url: attachment.dataUrl,
      filename: attachment.filename,
    } satisfies PromptRequestPart
  })

  requestParts.push(...files, ...context, ...agents, ...images)

  return {
    requestParts,
    optimisticParts: requestParts.map((part) => toOptimisticPart(part, input.sessionID, input.messageID)),
  }
}
