/**
 * Chat component — main conversation area.
 * Works with Sidebar for multi-conversation management.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Timer, X, Wifi, WifiOff, Download, Settings } from 'lucide-react'
import ChatMessages from './ChatMessages'
import ChatInput from './ChatInput'
import ToastContainer from './Toast'
import { useChat } from '../hooks/useChat'
import type { ChatConfig, SlashCommand } from '../types'

/* ==================== System Prompt Storage ==================== */

const SP_KEY = 'ccs_system_prompt'
const ASP_KEY = 'ccs_append_system_prompt'

function loadPromptSettings(): { systemPrompt: string; appendSystemPrompt: string } {
  return {
    systemPrompt: localStorage.getItem(SP_KEY) || '',
    appendSystemPrompt: localStorage.getItem(ASP_KEY) || '',
  }
}

function savePromptSettings(systemPrompt: string, appendSystemPrompt: string) {
  if (systemPrompt) localStorage.setItem(SP_KEY, systemPrompt)
  else localStorage.removeItem(SP_KEY)
  if (appendSystemPrompt) localStorage.setItem(ASP_KEY, appendSystemPrompt)
  else localStorage.removeItem(ASP_KEY)
}

export interface ChatProps extends ChatConfig {
  slashCommands?: SlashCommand[]
  welcomeMessage?: string
  acceptFileTypes?: string
  placeholder?: string
  /** Callback to toggle sidebar (for Ctrl+/ shortcut) */
  onToggleSidebar?: () => void
  /**
   * Override the gear-icon click. When provided, the inline settings modal
   * is bypassed entirely (use this to navigate to a dedicated settings route).
   * When omitted, the inline modal is shown for backward compatibility.
   */
  onOpenSettings?: () => void
}

/** Poll backend health every 15s */
function useConnectionStatus(apiBase: string) {
  const [connected, setConnected] = useState(true)

  const check = useCallback(async () => {
    try {
      const resp = await fetch(apiBase.replace(/\/$/, '') + '/health', { signal: AbortSignal.timeout(3000) })
      setConnected(resp.ok)
    } catch {
      setConnected(false)
    }
  }, [apiBase])

  useEffect(() => {
    check()
    const id = setInterval(check, 15000)
    return () => clearInterval(id)
  }, [check])

  return connected
}

export default function Chat({
  slashCommands,
  welcomeMessage = 'Hello, how can I help you?',
  acceptFileTypes,
  placeholder,
  onToggleSidebar,
  onOpenSettings,
  ...config
}: ChatProps) {
  const [showSettings, setShowSettings] = useState(false)
  const [spDraft, setSpDraft] = useState('')
  const [aspDraft, setAspDraft] = useState('')
  const [promptSettings, setPromptSettings] = useState(loadPromptSettings)

  // Merge localStorage prompt settings with config props (props take precedence)
  const mergedConfig = useMemo<ChatConfig>(() => ({
    ...config,
    systemPrompt: config.systemPrompt || promptSettings.systemPrompt || undefined,
    appendSystemPrompt: config.appendSystemPrompt || promptSettings.appendSystemPrompt || undefined,
  }), [config, promptSettings])

  const {
    messages, isLoading, costInfo, scrollKey,
    loopState, loopCountdown, canRetry,
    send, retry, cancel, newChat, compact,
    startLoop, stopLoop, uploadFile, exportMarkdown,
  } = useChat(mergedConfig)

  const openSettings = () => {
    if (onOpenSettings) {
      onOpenSettings()
      return
    }
    setSpDraft(promptSettings.systemPrompt)
    setAspDraft(promptSettings.appendSystemPrompt)
    setShowSettings(true)
  }

  const saveSettings = () => {
    savePromptSettings(spDraft.trim(), aspDraft.trim())
    setPromptSettings({ systemPrompt: spDraft.trim(), appendSystemPrompt: aspDraft.trim() })
    setShowSettings(false)
  }

  const connected = useConnectionStatus(config.apiBase)

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'k') { e.preventDefault(); newChat() }
      if (mod && e.key === '/') { e.preventDefault(); onToggleSidebar?.() }
      if (e.key === 'Escape' && isLoading) { cancel() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [newChat, cancel, isLoading, onToggleSidebar])

  // Global drag & drop
  const [dragOver, setDragOver] = useState(false)

  const handleGlobalDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (!uploadFile) return
    for (const file of Array.from(e.dataTransfer.files)) {
      const result = await uploadFile(file)
      if (result) {
        send('', [result])
      }
    }
  }, [uploadFile, send])

  return (
    <div
      className="relative flex flex-col h-full bg-background"
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleGlobalDrop}
    >
      {/* Drop overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-50 bg-primary/5 border-2 border-dashed border-primary/30 rounded-xl flex items-center justify-center pointer-events-none">
          <div className="text-primary font-medium text-lg">Drop files here</div>
        </div>
      )}
      {/* Settings modal */}
      {showSettings && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowSettings(false)}>
          <div className="bg-popover border rounded-xl shadow-2xl p-5 mx-4 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-4">System Prompt Settings</h3>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  System Prompt <span className="text-destructive/60">(replaces CC default — loses built-in tools)</span>
                </label>
                <textarea
                  value={spDraft}
                  onChange={e => setSpDraft(e.target.value)}
                  placeholder="Leave empty to use CC default system prompt"
                  rows={3}
                  className="w-full text-sm bg-muted/30 border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring resize-none placeholder:text-muted-foreground/40"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Append System Prompt <span className="text-emerald-600 dark:text-emerald-400">(keeps CC tools + adds your rules)</span>
                </label>
                <textarea
                  value={aspDraft}
                  onChange={e => setAspDraft(e.target.value)}
                  placeholder="e.g. Always reply in Chinese"
                  rows={3}
                  className="w-full text-sm bg-muted/30 border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring resize-none placeholder:text-muted-foreground/40"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowSettings(false)} className="px-3 py-1.5 text-xs rounded-md border hover:bg-muted transition-colors">
                Cancel
              </button>
              <button onClick={saveSettings} className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Status bar */}
      <div className="absolute top-3 right-4 z-10 flex items-center gap-1.5">
        {/* Settings */}
        <button
          onClick={openSettings}
          className={`size-7 inline-flex items-center justify-center rounded-md transition-colors hover:bg-muted ${promptSettings.systemPrompt || promptSettings.appendSystemPrompt ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          title="System Prompt Settings"
        >
          <Settings className="size-4" />
        </button>

        {/* Export */}
        {messages.length > 0 && (
          <button
            onClick={exportMarkdown}
            className="size-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Export as Markdown"
          >
            <Download className="size-4" />
          </button>
        )}

        {/* Connection status */}
        <div
          className={`size-7 inline-flex items-center justify-center rounded-md ${connected ? 'text-emerald-500' : 'text-destructive'}`}
          title={connected ? 'Connected' : 'Disconnected'}
        >
          {connected ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
        </div>

        {/* Loop indicator */}
        {loopState && (
          <div className="flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/20 rounded-lg px-2.5 py-1 text-xs">
            <Timer className="size-3.5 animate-pulse" />
            <span className="font-mono">{loopCountdown}</span>
            <span className="text-primary/70 max-w-[150px] truncate">· {loopState.prompt}</span>
            <button onClick={stopLoop} className="ml-1 text-primary/60 hover:text-destructive transition-colors" title="Stop loop">
              <X className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-4 pb-16">
          <h1 className="text-2xl font-semibold mb-8">{welcomeMessage}</h1>
          <div className="w-full max-w-2xl">
            <ChatInput
              onSend={(text, files) => send(text, files)}
              isLoading={isLoading}
              onCancel={cancel}
              onNewChat={newChat}
              onLoop={startLoop}
              onCompact={compact}
              slashCommands={slashCommands}
              onUploadFile={config.uploadUrl ? uploadFile : undefined}
              acceptFileTypes={acceptFileTypes}
              placeholder={placeholder}
              large
            />
          </div>
        </div>
      ) : (
        <>
          <ChatMessages messages={messages} isLoading={isLoading} scrollKey={scrollKey} costInfo={costInfo} canRetry={canRetry} onRetry={retry} />
          <ChatInput
            onSend={(text, files) => send(text, files)}
            isLoading={isLoading}
            onCancel={cancel}
            onNewChat={newChat}
            onLoop={startLoop}
            onCompact={compact}
            slashCommands={slashCommands}
            onUploadFile={config.uploadUrl ? uploadFile : undefined}
            acceptFileTypes={acceptFileTypes}
            placeholder={placeholder}
          />
        </>
      )}
      <ToastContainer />
    </div>
  )
}
