import { useState, useRef, useCallback, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ChatMessage, ChatConfig, UploadedFile, CostInfo } from '../types'
import { parseSSEEvent } from '../types'
import { useChatStore, readConversationMessages, writeConversationMessages } from '../store/chat'
import { addToast } from '../store/toast'

/* ==================== Background Notification ==================== */

const originalTitle = typeof document !== 'undefined' ? document.title : ''
let titleFlashTimer: ReturnType<typeof setInterval> | null = null

function notifyIfHidden() {
  if (typeof document === 'undefined' || document.visibilityState === 'visible') return

  // Flash tab title
  let on = true
  titleFlashTimer = setInterval(() => {
    document.title = on ? '✅ Response ready' : originalTitle
    on = !on
  }, 1000)

  // Stop flashing when tab becomes visible
  const stop = () => {
    if (titleFlashTimer) { clearInterval(titleFlashTimer); titleFlashTimer = null }
    document.title = originalTitle
    document.removeEventListener('visibilitychange', stop)
  }
  document.addEventListener('visibilitychange', stop)
}

interface LoopState {
  intervalMinutes: number
  prompt: string
  convId: string | null
  timerId: ReturnType<typeof setInterval>
  stopTimerId: ReturnType<typeof setTimeout>
  nextRunAt: number
  expiresAt: number
}

export interface UseChatReturn {
  messages: ChatMessage[]
  isLoading: boolean
  costInfo: CostInfo | null
  scrollKey: number
  loopState: LoopState | null
  loopCountdown: string
  activeConversationId: string | null
  canRetry: boolean
  send: (text: string, files?: UploadedFile[]) => Promise<void>
  retry: () => void
  cancel: () => void
  clear: () => void
  newChat: () => void
  compact: () => void
  startLoop: (intervalMinutes: number, prompt: string, maxDays: number) => void
  stopLoop: () => void
  uploadFile: (file: File) => Promise<UploadedFile | null>
  exportMarkdown: () => void
}

export function useChat(config: ChatConfig): UseChatReturn {
  const store = useChatStore()
  const { messages, costInfo, setCostInfo, activeId, createConversation } = store
  const qc = useQueryClient()
  const [isLoading, setIsLoading] = useState(false)
  const [scrollKey, setScrollKey] = useState(0)
  const [loopState, setLoopState] = useState<LoopState | null>(null)
  const [loopCountdown, setLoopCountdown] = useState('')
  const [canRetry, setCanRetry] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const isLoadingRef = useRef(false)
  const lastSentRef = useRef<{ text: string; files: UploadedFile[] } | null>(null)

  useEffect(() => { isLoadingRef.current = isLoading }, [isLoading])

  // Loop countdown timer
  useEffect(() => {
    if (!loopState) { setLoopCountdown(''); return }
    const tick = () => {
      const nextIn = Math.max(0, Math.ceil((loopState.nextRunAt - Date.now()) / 1000))
      const m = Math.floor(nextIn / 60)
      const s = nextIn % 60
      const nextStr = m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`
      const remainDays = Math.max(0, (loopState.expiresAt - Date.now()) / 86400000)
      const expireStr = remainDays >= 1 ? `${Math.ceil(remainDays)}d left` : `${Math.ceil(remainDays * 24)}h left`
      setLoopCountdown(`${nextStr} · ${expireStr}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [loopState])

  useEffect(() => {
    return () => {
      if (loopState) {
        clearInterval(loopState.timerId)
        clearTimeout(loopState.stopTimerId)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setIsLoading(false)
    useChatStore.getState().registerCancel(null)
  }, [])

  const doSend = useCallback(async (text: string, files: UploadedFile[] = [], forceConvId?: string | null) => {
    // Ensure we have an active conversation
    let targetConvId = forceConvId !== undefined ? forceConvId : useChatStore.getState().activeId
    if (!targetConvId) {
      targetConvId = useChatStore.getState().createConversation()
    }

    // Check at call time (not capture time) whether user is still viewing this conversation
    const isActiveNow = () => useChatStore.getState().activeId === targetConvId

    const updateMessages = (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      if (isActiveNow()) {
        // User is viewing this conversation — update store (renders immediately)
        useChatStore.getState().setMessages(updater)
      } else if (targetConvId) {
        // User switched away — write to storage only (no spurious UI update)
        const { messages: prev, sessionId: sid } = readConversationMessages(targetConvId)
        const next = updater(prev)
        writeConversationMessages(targetConvId, next, sid)
      }
    }

    const updateSessionId = (id: string) => {
      if (useChatStore.getState().activeId === targetConvId) {
        useChatStore.getState().setSessionId(id)
      } else if (targetConvId) {
        // Write sessionId to background scratch
        const { messages: msgs } = readConversationMessages(targetConvId)
        writeConversationMessages(targetConvId, msgs, id)
        // Also update conversation metadata so switchConversation picks it up
        useChatStore.setState((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === targetConvId ? { ...c, sessionId: id } : c,
          ),
        }))
      }
    }

    const updateCostInfo = (data: { cost?: number; duration_ms?: number; num_turns?: number; input_tokens?: number; output_tokens?: number; context_window?: number }) => {
      if (useChatStore.getState().activeId === targetConvId) {
        useChatStore.getState().setCostInfo(data)
      }
    }

    // Build agent content with file/image info
    let agentContent = text
    if (files.length > 0) {
      const fileParts = files.map(f => {
        if (f.isImage) {
          return `[Image: ${f.path}]`
        }
        let info = `[File: ${f.name}, path: ${f.path}, size: ${f.size} bytes`
        if (f.total_lines != null) info += `, ${f.total_lines} rows`
        info += ']'
        if (f.preview && f.preview.length > 0) {
          info += `\nPreview (first ${f.preview.length} rows):\n` + JSON.stringify(f.preview, null, 2)
        }
        return info
      })
      const fileInfo = fileParts.join('\n\n')
      agentContent = agentContent ? `${agentContent}\n\n${fileInfo}` : fileInfo
    }

    // Track for retry
    lastSentRef.current = { text, files }
    setCanRetry(false)

    const chatFiles = files.length > 0
      ? files.map(f => ({
          name: f.name, size: f.size, preview: f.preview, total_lines: f.total_lines,
          isImage: f.isImage, imageUrl: f.imageUrl,
        }))
      : undefined
    updateMessages(prev => [...prev, { role: 'user', content: text, files: chatFiles, timestamp: Date.now() }])
    setCostInfo({})
    setIsLoading(true)
    setScrollKey(k => k + 1)

    const controller = new AbortController()
    abortRef.current = controller
    useChatStore.getState().registerCancel(cancel)

    let currentThinkingText = ''
    let currentAssistantText = ''

    const finalizeThinking = () => {
      if (!currentThinkingText) return
      const snap = currentThinkingText
      updateMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.role === 'thinking' && last.isStreaming) {
          return [...prev.slice(0, -1), { role: 'thinking' as const, content: snap }]
        }
        return prev
      })
      currentThinkingText = ''
    }

    const finalizeText = () => {
      if (!currentAssistantText) return
      const snap = currentAssistantText
      updateMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.role === 'assistant' && last.isStreaming) {
          return [...prev.slice(0, -1), { role: 'assistant' as const, content: snap }]
        }
        return prev
      })
      currentAssistantText = ''
    }

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (config.getHeaders) {
        Object.assign(headers, config.getHeaders())
      }

      // Get session ID for the target conversation
      const currentSessionId = (() => {
        if (useChatStore.getState().activeId === targetConvId) {
          return useChatStore.getState().sessionId
        }
        if (targetConvId) {
          return readConversationMessages(targetConvId).sessionId
        }
        return null
      })()

      const chatUrl = config.apiBase.replace(/\/$/, '') + '/chat'
      const timeoutSignal = AbortSignal.timeout(300_000) // 5 minutes
      const combinedSignal = AbortSignal.any([controller.signal, timeoutSignal])

      const resp = await fetch(chatUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prompt: agentContent,
          session_id: currentSessionId,
          ...(config.systemPrompt ? { system_prompt: config.systemPrompt } : {}),
          ...(config.appendSystemPrompt ? { append_system_prompt: config.appendSystemPrompt } : {}),
        }),
        signal: combinedSignal,
      })

      if (!resp.ok) {
        if (resp.status === 401 && config.onAuthError) {
          config.onAuthError()
          return
        }
        const errText = await resp.text()
        updateMessages(prev => [...prev, { role: 'assistant', content: `Request failed: ${errText}` }])
        setCanRetry(true)
        return
      }

      const reader = resp.body?.getReader()
      if (!reader) return
      const decoder = new TextDecoder()
      let buffer = ''
      let eventType = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            let rawData: unknown
            try {
              rawData = JSON.parse(line.slice(6))
            } catch {
              addToast({ type: 'warning', message: 'Received malformed event data from server' })
              eventType = ''
              continue
            }

            const event = parseSSEEvent(eventType, rawData)
            eventType = ''

            if (!event) continue

            switch (event.type) {
              case 'session':
                updateSessionId(event.session_id)
                break

              case 'thinking': {
                currentThinkingText += event.content
                const snap = currentThinkingText
                updateMessages(prev => {
                  const last = prev[prev.length - 1]
                  if (last?.role === 'thinking' && last.isStreaming) {
                    return [...prev.slice(0, -1), { role: 'thinking', content: snap, isStreaming: true }]
                  }
                  return [...prev, { role: 'thinking', content: snap, isStreaming: true }]
                })
                break
              }

              case 'text': {
                finalizeThinking()
                currentAssistantText += event.content
                const snap = currentAssistantText
                updateMessages(prev => {
                  const last = prev[prev.length - 1]
                  if (last?.role === 'assistant' && last.isStreaming) {
                    return [...prev.slice(0, -1), { role: 'assistant', content: snap, isStreaming: true }]
                  }
                  return [...prev, { role: 'assistant', content: snap, isStreaming: true }]
                })
                break
              }

              case 'tool_call': {
                finalizeThinking()
                finalizeText()
                updateMessages(prev => [...prev, {
                  role: 'tool_call', content: '',
                  toolCallId: event.id, toolName: event.name, toolArgs: event.arguments,
                }])
                break
              }

              case 'tool_result':
                updateMessages(prev => [...prev, {
                  role: 'tool_result', content: '',
                  toolCallId: event.id, toolName: event.name, toolResult: event.result, isError: event.is_error,
                }])
                break

              case 'done':
                finalizeThinking()
                finalizeText()
                updateCostInfo(event)
                notifyIfHidden()
                lastSentRef.current = null
                // Refresh the sidebar list (new session row, updated counters).
                qc.invalidateQueries({ queryKey: ['sessions'] })
                break

              case 'error':
                finalizeThinking()
                finalizeText()
                updateMessages(prev => [...prev, { role: 'assistant', content: `Error: ${event.message}` }])
                setCanRetry(true)
                break
            }
          }
        }
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        // Distinguish manual cancel vs timeout
        if (!controller.signal.aborted) {
          addToast({ type: 'error', message: 'Request timed out (5 min)' })
          updateMessages(prev => [...prev, { role: 'assistant', content: 'Request timed out after 5 minutes.' }])
          setCanRetry(true)
        }
        return
      }
      updateMessages(prev => [...prev, { role: 'assistant', content: `Request error: ${e}` }])
      setCanRetry(true)
    } finally {
      // Clean up any stuck streaming state
      updateMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m))
      setIsLoading(false)
      abortRef.current = null
      useChatStore.getState().registerCancel(null)
    }
  }, [config, setCostInfo, cancel, qc])

  const send = useCallback(async (text: string, files: UploadedFile[] = []) => {
    await doSend(text, files)
  }, [doSend])

  const retry = useCallback(() => {
    if (!lastSentRef.current) return
    const { text, files } = lastSentRef.current
    setCanRetry(false)
    // Remove the error message(s) added after the last user message
    useChatStore.getState().setMessages(prev => {
      let lastUserIdx = -1
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === 'user') { lastUserIdx = i; break }
      }
      if (lastUserIdx === -1) return prev
      return prev.slice(0, lastUserIdx) // remove user msg too, doSend will re-add it
    })
    doSend(text, files)
  }, [doSend])

  const newChat = useCallback(() => {
    if (loopState) { clearInterval(loopState.timerId); clearTimeout(loopState.stopTimerId); setLoopState(null) }
    createConversation()
  }, [createConversation, loopState])

  const compact = useCallback(() => {
    const assistantTexts = messages
      .filter(m => m.role === 'assistant' && m.content)
      .map(m => m.content)
    const summary = assistantTexts.length > 0 ? assistantTexts.slice(-3).join('\n\n') : ''
    store.clear()
    if (summary) {
      const compactPrompt = `Summary of previous conversation for context:\n\n${summary.slice(0, 2000)}\n\nPlease confirm you understand this context.`
      setTimeout(() => doSend(compactPrompt), 0)
    }
  }, [messages, store, doSend])

  const startLoop = useCallback((intervalMinutes: number, prompt: string, maxDays: number) => {
    if (loopState) { clearInterval(loopState.timerId); clearTimeout(loopState.stopTimerId) }
    const convId = useChatStore.getState().activeId
    doSend(prompt, [], convId)
    const intervalMs = intervalMinutes * 60 * 1000
    const expiresAt = Date.now() + maxDays * 86400000
    const timerId = setInterval(() => {
      if (isLoadingRef.current) return
      doSend(prompt, [], convId)
      setLoopState(prev => prev ? { ...prev, nextRunAt: Date.now() + intervalMs } : null)
    }, intervalMs)
    const stopTimerId = setTimeout(() => {
      clearInterval(timerId)
      setLoopState(null)
    }, maxDays * 86400000)
    setLoopState({ intervalMinutes, prompt, convId, timerId, stopTimerId, nextRunAt: Date.now() + intervalMs, expiresAt })
  }, [doSend, loopState])

  const stopLoop = useCallback(() => {
    if (loopState) {
      clearInterval(loopState.timerId)
      clearTimeout(loopState.stopTimerId)
      setLoopState(null)
    }
  }, [loopState])

  const uploadFile = useCallback(async (file: File): Promise<UploadedFile | null> => {
    if (!config.uploadUrl) return null
    try {
      const formData = new FormData()
      formData.append('file', file)
      const headers: Record<string, string> = {}
      if (config.getHeaders) {
        const h = config.getHeaders()
        Object.entries(h).forEach(([k, v]) => {
          if (k.toLowerCase() !== 'content-type') headers[k] = v
        })
      }
      const resp = await fetch(config.uploadUrl, { method: 'POST', headers, body: formData })
      if (resp.status === 401 && config.onAuthError) { config.onAuthError(); return null }
      if (!resp.ok) throw new Error('Upload failed')
      const data = await resp.json()
      const uploaded: UploadedFile = {
        name: data.filename,
        path: data.path,
        size: data.size,
        preview: data.preview,
        total_lines: data.total_lines,
        isImage: data.type === 'image',
        imageUrl: data.url ? (() => {
          const base = config.apiBase.replace(/\/$/, '') + data.url
          const t = config.getHeaders?.()?.['Authorization']?.slice(7)
          return t ? `${base}?token=${t}` : base
        })() : undefined,
      }
      return uploaded
    } catch (e) {
      console.error('File upload failed:', e)
      addToast({ type: 'error', message: `File upload failed: ${e instanceof Error ? e.message : 'Unknown error'}` })
      return null
    }
  }, [config.uploadUrl, config.getHeaders])

  const exportMarkdown = useCallback(() => {
    const lines: string[] = []
    const conv = store.conversations.find(c => c.id === store.activeId)
    lines.push(`# ${conv?.name || 'Conversation'}`)
    lines.push('')
    for (const msg of messages) {
      if (msg.role === 'user') {
        const time = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : ''
        lines.push(`## User ${time ? `(${time})` : ''}`)
        lines.push(msg.content)
        lines.push('')
      } else if (msg.role === 'assistant') {
        lines.push(`## Assistant`)
        lines.push(msg.content)
        lines.push('')
      } else if (msg.role === 'tool_call' && msg.toolName === 'Bash') {
        lines.push(`\`\`\`bash\n$ ${(msg.toolArgs?.command as string) || ''}\n\`\`\``)
        lines.push('')
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(conv?.name || 'chat').replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [messages, store.conversations, store.activeId])

  return {
    messages, isLoading, costInfo, scrollKey,
    loopState, loopCountdown,
    activeConversationId: activeId,
    canRetry,
    send, retry, cancel, clear: store.clear, newChat, compact,
    startLoop, stopLoop, uploadFile, exportMarkdown,
  }
}
