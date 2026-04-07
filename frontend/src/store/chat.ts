/* Chat state store.
 *
 * Truth source: backend SQLite via /api/sessions.
 * This Zustand store holds:
 *   - the current conversation list (mirrored from React Query)
 *   - the active conversation's in-memory messages (rendered live during SSE)
 *   - background scratch maps for conversations the user navigated away from
 *     mid-stream (so we don't lose tokens when switching tabs)
 *
 * Nothing here writes to localStorage or sessionStorage anymore.
 * Page refresh repopulates from /api/sessions/{id}/messages via React Query.
 */

import { create } from 'zustand'
import type { ChatMessage, CostInfo, Conversation } from '../types'

/* ==================== Background scratch (in-memory only) ==================== */
/*
 * When a stream is in flight and the user switches conversations, we keep
 * accumulating messages for the original conversation here, then commit them
 * back into the store on switch-back. Scratch is wiped when the conversation
 * list reloads, since at that point the backend snapshot is authoritative.
 */
const bgMessages = new Map<string, ChatMessage[]>()
const bgSessionIds = new Map<string, string | null>()

export function readConversationMessages(convId: string): {
  messages: ChatMessage[]
  sessionId: string | null
} {
  const state = useChatStore.getState()
  if (state.activeId === convId) {
    return { messages: state.messages, sessionId: state.sessionId }
  }
  return {
    messages: bgMessages.get(convId) ?? [],
    sessionId: bgSessionIds.get(convId) ?? null,
  }
}

export function writeConversationMessages(
  convId: string,
  messages: ChatMessage[],
  sessionId: string | null,
) {
  const state = useChatStore.getState()
  if (state.activeId === convId) {
    useChatStore.setState({ messages, sessionId })
  } else {
    bgMessages.set(convId, messages)
    bgSessionIds.set(convId, sessionId)
  }
}

/* ==================== Helpers ==================== */

function genId(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)
}

/** Convert a backend MessageRecord block list into UI ChatMessages. */
export function blocksToChatMessages(
  blocks: Array<{
    role: string
    content: Array<Record<string, unknown>>
    created_at: number
  }>,
): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const m of blocks) {
    const ts = Math.round(m.created_at * 1000)
    if (m.role === 'user') {
      const text = m.content
        .filter((b) => b.type === 'text')
        .map((b) => (b.text as string) ?? '')
        .join('')
      out.push({ role: 'user', content: text, timestamp: ts })
      continue
    }
    if (m.role !== 'assistant') continue
    for (const b of m.content) {
      const t = b.type as string
      if (t === 'thinking') {
        out.push({ role: 'thinking', content: (b.text as string) ?? '', timestamp: ts })
      } else if (t === 'text') {
        out.push({ role: 'assistant', content: (b.text as string) ?? '', timestamp: ts })
      } else if (t === 'tool_use') {
        out.push({
          role: 'tool_call',
          content: '',
          toolCallId: (b.id as string) ?? '',
          toolName: (b.name as string) ?? '',
          toolArgs: (b.input as Record<string, unknown>) ?? {},
          timestamp: ts,
        })
      } else if (t === 'tool_result') {
        out.push({
          role: 'tool_result',
          content: '',
          toolCallId: (b.tool_use_id as string) ?? '',
          toolName: '',
          toolResult: (b.content as string) ?? '',
          isError: b.is_error === true,
          timestamp: ts,
        })
      }
    }
  }
  return out
}

/* ==================== Store ==================== */

export interface ChatState {
  conversations: Conversation[]
  activeId: string | null

  // Active conversation runtime state
  messages: ChatMessage[]
  sessionId: string | null
  cancelFn: (() => void) | null
  costInfo: CostInfo | null

  /** Replace local conversation list (called from React Query data sync) */
  setConversationsFromBackend: (sessions: Array<{
    id: string
    title: string
    last_active_at: number
    created_at: number
  }>) => void

  /** Replace messages for the active conversation (called when query loads from backend) */
  setActiveMessagesFromBackend: (convId: string, messages: ChatMessage[], sessionId: string) => void

  /** Create a draft conversation that lives only in memory until first send. */
  createConversation: () => string

  /** Switch active conversation. Caller must trigger backend message fetch separately. */
  switchConversation: (id: string) => void

  /** Optimistically remove a conversation from local state (after server delete confirms). */
  removeConversation: (id: string) => void

  /** Optimistically rename a conversation locally. */
  renameConversation: (id: string, name: string) => void

  /* ----- streaming-time mutations (called by useChat) ----- */

  setMessages: (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void
  setSessionId: (id: string | null) => void
  setCostInfo: (data: { cost?: number; duration_ms?: number; num_turns?: number; input_tokens?: number; output_tokens?: number; context_window?: number }) => void
  registerCancel: (fn: (() => void) | null) => void
  clear: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeId: null,
  messages: [],
  sessionId: null,
  cancelFn: null,
  costInfo: null,

  setConversationsFromBackend: (sessions) => {
    const { activeId, conversations: prev } = get()
    const draftIds = new Set(
      prev.filter((c) => !sessions.some((s) => s.id === c.id)).map((c) => c.id),
    )
    // Drop background scratch for any conversation no longer present.
    const valid = new Set([...sessions.map((s) => s.id), ...draftIds])
    for (const k of bgMessages.keys()) if (!valid.has(k)) bgMessages.delete(k)
    for (const k of bgSessionIds.keys()) if (!valid.has(k)) bgSessionIds.delete(k)

    const fromBackend: Conversation[] = sessions.map((s) => ({
      id: s.id,
      name: s.title,
      sessionId: s.id,
      createdAt: Math.round(s.created_at * 1000),
    }))
    // Preserve in-memory drafts (not yet persisted) at the top.
    const drafts = prev.filter((c) => draftIds.has(c.id))
    const next = [...drafts, ...fromBackend]
    set({ conversations: next })

    // If the active conversation was deleted server-side, drop it.
    if (activeId && !next.some((c) => c.id === activeId)) {
      set({ activeId: null, messages: [], sessionId: null, costInfo: null })
    }
  },

  setActiveMessagesFromBackend: (convId, messages, sessionId) => {
    if (get().activeId !== convId) return  // user navigated away
    set({ messages, sessionId, costInfo: null })
  },

  createConversation: () => {
    const id = genId()
    const draft: Conversation = {
      id,
      name: 'New Chat',
      sessionId: id, // we use the same id end-to-end
      createdAt: Date.now(),
    }
    set((s) => ({
      conversations: [draft, ...s.conversations],
      activeId: id,
      messages: [],
      sessionId: null, // not yet confirmed by backend
      cancelFn: null,
      costInfo: null,
    }))
    return id
  },

  switchConversation: (id) => {
    const { activeId, conversations, messages, sessionId } = get()
    if (id === activeId) return
    if (!conversations.find((c) => c.id === id)) return

    // Stash current active conversation's in-flight state into background.
    if (activeId) {
      bgMessages.set(activeId, messages)
      bgSessionIds.set(activeId, sessionId)
    }

    // Restore from background if we have it; otherwise leave empty until
    // React Query fetches /messages.
    const stashed = bgMessages.get(id)
    const stashedSid = bgSessionIds.get(id)
    set({
      activeId: id,
      messages: stashed ?? [],
      sessionId: stashedSid ?? null,
      cancelFn: null,
      costInfo: null,
    })
  },

  removeConversation: (id) => {
    const { conversations, activeId } = get()
    bgMessages.delete(id)
    bgSessionIds.delete(id)
    const next = conversations.filter((c) => c.id !== id)
    if (id === activeId) {
      const fallback = next[0]
      set({
        conversations: next,
        activeId: fallback?.id ?? null,
        messages: [],
        sessionId: fallback?.id ?? null,
        cancelFn: null,
        costInfo: null,
      })
    } else {
      set({ conversations: next })
    }
  },

  renameConversation: (id, name) => {
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, name } : c)),
    }))
  },

  setMessages: (updater) => {
    const { messages: prev, activeId } = get()
    if (!activeId) return
    const next = typeof updater === 'function' ? updater(prev) : updater
    set({ messages: next })

    // Optimistically rename a draft conversation from the first user message.
    const { conversations } = get()
    const conv = conversations.find((c) => c.id === activeId)
    if (conv && conv.name === 'New Chat') {
      const firstUser = next.find((m) => m.role === 'user' && m.content)
      if (firstUser) {
        const name = firstUser.content.slice(0, 30) + (firstUser.content.length > 30 ? '...' : '')
        set({
          conversations: conversations.map((c) => (c.id === activeId ? { ...c, name } : c)),
        })
      }
    }
  },

  setSessionId: (id) => {
    const { activeId } = get()
    if (!activeId) return
    set({ sessionId: id })
  },

  setCostInfo: (data) => {
    set({
      costInfo: {
        cost: data.cost ?? null,
        durationMs: data.duration_ms ?? null,
        numTurns: data.num_turns ?? null,
        inputTokens: data.input_tokens ?? null,
        outputTokens: data.output_tokens ?? null,
        contextWindow: data.context_window ?? null,
      },
    })
  },

  registerCancel: (fn) => set({ cancelFn: fn }),

  clear: () => {
    const { cancelFn } = get()
    cancelFn?.()
    set({ messages: [], sessionId: null, cancelFn: null, costInfo: null })
  },
}))
