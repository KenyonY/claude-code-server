/* ==================== Chat Message Types ==================== */

export interface ChatFileAttachment {
  name: string
  size: number
  preview?: Record<string, unknown>[]
  total_lines?: number
  /** True for image files (png, jpg, etc.) */
  isImage?: boolean
  /** Server URL for image (e.g. "/files/xxx.png"), persists across sessions */
  imageUrl?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'thinking'
  content: string
  files?: ChatFileAttachment[]
  toolCallId?: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  toolResult?: string
  isError?: boolean
  isStreaming?: boolean
  /** Timestamp when message was created (ms since epoch) */
  timestamp?: number
}

/* ==================== Uploaded File ==================== */

export interface UploadedFile {
  name: string
  path: string
  size: number
  preview?: Record<string, unknown>[]
  total_lines?: number
  /** True for image files */
  isImage?: boolean
  /** Server URL for image (e.g. "/api/files/xxx.png") */
  imageUrl?: string
}

/* ==================== Conversation ==================== */

export interface Conversation {
  id: string
  name: string
  sessionId: string | null
  createdAt: number
}

/* ==================== Slash Commands ==================== */

export interface SlashCommand {
  name: string
  description: string
  type: 'prompt' | 'action'
  prompt?: string
  usage?: string
}

/* ==================== Cost Info ==================== */

export interface CostInfo {
  cost: number | null
  durationMs: number | null
  numTurns?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  contextWindow?: number | null
}

/* ==================== Chat Config ==================== */

export interface ChatConfig {
  /** API base URL for chat endpoint (e.g., "/api/agent" or "http://localhost:8333") */
  apiBase: string
  /** Upload endpoint URL. If not provided, upload button is hidden. */
  uploadUrl?: string
  /** Callback to get HTTP headers (auth, etc.) */
  getHeaders?: () => Record<string, string>
  /** Accepted file types for upload */
  acceptFileTypes?: string
  /** Override CC's default system prompt (replaces entirely) */
  systemPrompt?: string
  /** Append to CC's default system prompt (keeps tools/rules) */
  appendSystemPrompt?: string
}

/* ==================== Default Slash Commands ==================== */

export const DEFAULT_SLASH_COMMANDS: SlashCommand[] = [
  { name: 'new', description: 'New conversation', type: 'action' },
  { name: 'compact', description: 'Summarize & start fresh', type: 'action' },
  { name: 'loop', description: 'Repeat on interval', type: 'action', usage: '/loop 5m <command> [--max <days>]' },
]

/* ==================== SSE Event Types ==================== */

export type SSEEvent =
  | { type: 'session'; session_id: string }
  | { type: 'thinking'; content: string }
  | { type: 'text'; content: string }
  | { type: 'tool_call'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; result: string; is_error?: boolean }
  | { type: 'done'; cost?: number; duration_ms?: number; num_turns?: number; input_tokens?: number; output_tokens?: number; context_window?: number }
  | { type: 'error'; message: string }

/** Parse raw SSE data into a typed event. Returns null if invalid. */
export function parseSSEEvent(eventType: string, raw: unknown): SSEEvent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const data = raw as Record<string, unknown>

  switch (eventType) {
    case 'session':
      if (typeof data.session_id === 'string') return { type: 'session', session_id: data.session_id }
      break
    case 'thinking':
    case 'text':
      if (typeof data.content === 'string') return { type: eventType, content: data.content }
      break
    case 'tool_call':
      if (typeof data.id === 'string' && typeof data.name === 'string')
        return { type: 'tool_call', id: data.id, name: data.name, arguments: (data.arguments as Record<string, unknown>) ?? {} }
      break
    case 'tool_result':
      if (typeof data.id === 'string')
        return { type: 'tool_result', id: data.id, name: (data.name as string) ?? '', result: (data.result as string) ?? '', is_error: data.is_error === true }
      break
    case 'done':
      return {
        type: 'done',
        cost: typeof data.cost === 'number' ? data.cost : undefined,
        duration_ms: typeof data.duration_ms === 'number' ? data.duration_ms : undefined,
        num_turns: typeof data.num_turns === 'number' ? data.num_turns : undefined,
        input_tokens: typeof data.input_tokens === 'number' ? data.input_tokens : undefined,
        output_tokens: typeof data.output_tokens === 'number' ? data.output_tokens : undefined,
        context_window: typeof data.context_window === 'number' ? data.context_window : undefined,
      }
    case 'error':
      if (typeof data.message === 'string') return { type: 'error', message: data.message }
      break
  }
  return null
}

/* ==================== Utilities ==================== */

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])

export function isImageFile(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTS.has(ext)
}
