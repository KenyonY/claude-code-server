import { create } from 'zustand'
import type { ChatMessage, CostInfo, Conversation } from '../types'
import { addToast } from './toast'

const MSG_PREFIX = 'ccs_msg'
const CONV_KEY = 'ccs_conversations'

/* ==================== Message Storage (sessionStorage) ==================== */

function loadMessages(convId: string): { messages: ChatMessage[]; sessionId: string | null } {
  try {
    const raw = sessionStorage.getItem(`${MSG_PREFIX}_${convId}`)
    if (raw) {
      const parsed = JSON.parse(raw)
      return { messages: parsed.messages || [], sessionId: parsed.sessionId || null }
    }
  } catch {
    addToast({ type: 'warning', message: 'Failed to load conversation history' })
  }
  return { messages: [], sessionId: null }
}

function saveMessages(convId: string, messages: ChatMessage[], sessionId: string | null) {
  const cleaned = messages.map(({ isStreaming: _, ...rest }) => rest)
  try {
    sessionStorage.setItem(`${MSG_PREFIX}_${convId}`, JSON.stringify({ messages: cleaned, sessionId }))
  } catch {
    addToast({ type: 'error', message: 'Storage quota exceeded — conversation may not be saved' })
  }
}

function removeMessages(convId: string) {
  sessionStorage.removeItem(`${MSG_PREFIX}_${convId}`)
}

/* ==================== Conversation Storage (localStorage) ==================== */

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONV_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    addToast({ type: 'warning', message: 'Failed to load conversation list' })
  }
  return []
}

function saveConversations(convs: Conversation[]) {
  try {
    localStorage.setItem(CONV_KEY, JSON.stringify(convs))
  } catch {
    addToast({ type: 'error', message: 'Storage quota exceeded — conversations may not be saved' })
  }
}

/* ==================== Background SSE helpers ==================== */

/** Read messages for a conversation (for background SSE callbacks) */
export function readConversationMessages(convId: string): { messages: ChatMessage[]; sessionId: string | null } {
  return loadMessages(convId)
}

/** Write messages for a conversation (for background SSE callbacks) */
export function writeConversationMessages(convId: string, messages: ChatMessage[], sessionId: string | null) {
  saveMessages(convId, messages, sessionId)
}

/* ==================== Store ==================== */

function genId(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)
}

export interface ChatState {
  // Multi-conversation
  conversations: Conversation[]
  activeId: string | null

  // Active conversation state
  messages: ChatMessage[]
  sessionId: string | null
  cancelFn: (() => void) | null
  costInfo: CostInfo | null

  // Conversation management
  createConversation: (name?: string) => string
  switchConversation: (id: string) => void
  deleteConversation: (id: string) => void
  renameConversation: (id: string, name: string) => void

  // Message operations (scoped to active conversation)
  setMessages: (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void
  setSessionId: (id: string | null) => void
  setCostInfo: (data: { cost?: number; duration_ms?: number; num_turns?: number; input_tokens?: number; output_tokens?: number; context_window?: number }) => void
  registerCancel: (fn: (() => void) | null) => void
  clear: () => void
}

// Load initial state
const initialConversations = loadConversations()
const initialActiveId = initialConversations.length > 0 ? initialConversations[0].id : null
const initialData = initialActiveId ? loadMessages(initialActiveId) : { messages: [], sessionId: null }

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: initialConversations,
  activeId: initialActiveId,
  messages: initialData.messages,
  sessionId: initialData.sessionId,
  cancelFn: null,
  costInfo: null,

  createConversation: (name) => {
    const id = genId()
    const conv: Conversation = {
      id,
      name: name || 'New Chat',
      sessionId: null,
      createdAt: Date.now(),
    }
    const { conversations, activeId, messages, sessionId } = get()

    // Save current conversation messages before switching
    if (activeId && messages.length > 0) {
      saveMessages(activeId, messages, sessionId)
    }

    const next = [conv, ...conversations]
    saveConversations(next)
    set({
      conversations: next,
      activeId: id,
      messages: [],
      sessionId: null,
      cancelFn: null,
      costInfo: null,
    })
    return id
  },

  switchConversation: (id) => {
    const { activeId, messages, sessionId, conversations } = get()
    if (id === activeId) return

    // Verify conversation exists
    if (!conversations.find(c => c.id === id)) return

    // Save current messages
    if (activeId && messages.length > 0) {
      saveMessages(activeId, messages, sessionId)
    }

    // Load target messages
    const loaded = loadMessages(id)
    const targetConv = conversations.find(c => c.id === id)
    set({
      activeId: id,
      messages: loaded.messages,
      sessionId: loaded.sessionId ?? targetConv?.sessionId ?? null,
      cancelFn: null,
      costInfo: null,
    })
  },

  deleteConversation: (id) => {
    const { conversations, activeId } = get()
    const next = conversations.filter(c => c.id !== id)
    saveConversations(next)
    removeMessages(id)

    if (id === activeId) {
      // Switch to first remaining, or empty state
      if (next.length > 0) {
        const loaded = loadMessages(next[0].id)
        set({
          conversations: next,
          activeId: next[0].id,
          messages: loaded.messages,
          sessionId: loaded.sessionId,
          cancelFn: null,
          costInfo: null,
        })
      } else {
        set({
          conversations: next,
          activeId: null,
          messages: [],
          sessionId: null,
          cancelFn: null,
          costInfo: null,
        })
      }
    } else {
      set({ conversations: next })
    }
  },

  renameConversation: (id, name) => {
    const { conversations } = get()
    const next = conversations.map(c => c.id === id ? { ...c, name } : c)
    saveConversations(next)
    set({ conversations: next })
  },

  setMessages: (updater) => {
    const { messages: prev, activeId } = get()
    if (!activeId) return
    const next = typeof updater === 'function' ? updater(prev) : updater
    set({ messages: next })

    // Auto-name conversation from first user message
    const { conversations } = get()
    const conv = conversations.find(c => c.id === activeId)
    if (conv && conv.name === 'New Chat') {
      const firstUser = next.find(m => m.role === 'user' && m.content)
      if (firstUser) {
        const name = firstUser.content.slice(0, 30) + (firstUser.content.length > 30 ? '...' : '')
        const updated = conversations.map(c => c.id === activeId ? { ...c, name } : c)
        saveConversations(updated)
        set({ conversations: updated })
      }
    }

    // Persist when not streaming
    const last = next[next.length - 1]
    if (!last?.isStreaming) {
      saveMessages(activeId, next, get().sessionId)
    }
  },

  setSessionId: (id) => {
    const { activeId, conversations } = get()
    if (!activeId) return
    set({ sessionId: id })
    saveMessages(activeId, get().messages, id)
    // Also update conversation metadata
    const next = conversations.map(c => c.id === activeId ? { ...c, sessionId: id } : c)
    saveConversations(next)
    set({ conversations: next })
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
    const { cancelFn, activeId } = get()
    cancelFn?.()
    if (activeId) {
      removeMessages(activeId)
    }
    set({ messages: [], sessionId: null, cancelFn: null, costInfo: null })
  },
}))
