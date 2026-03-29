import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { Send, Plus, Square, X, Loader2, Paperclip, ChevronDown, ChevronUp, ImageIcon, Mic, MicOff } from 'lucide-react'
import type { SlashCommand, UploadedFile } from '../types'
import { DEFAULT_SLASH_COMMANDS } from '../types'

/* ==================== Speech Recognition ==================== */

type SpeechRecognitionInstance = InstanceType<typeof SpeechRecognition>

function useSpeechRecognition(onResult: (text: string) => void) {
  const [isListening, setIsListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)

  // Check API exists + secure context (HTTPS or localhost required)
  const isSecure = typeof window !== 'undefined' && (window.isSecureContext ?? (location.protocol === 'https:' || location.hostname === 'localhost'))
  const hasAPI = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
  const isSupported = hasAPI && isSecure

  const toggle = useCallback(() => {
    if (!hasAPI) { setError('Browser does not support speech recognition'); return }
    if (!isSecure) { setError('Speech recognition requires HTTPS or localhost'); return }

    if (isListening) {
      recognitionRef.current?.stop()
      setIsListening(false)
      return
    }

    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition
      const recognition = new SR()
      recognition.continuous = false
      recognition.interimResults = false
      recognition.lang = navigator.language || 'en-US'

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const transcript = event.results[0]?.[0]?.transcript
        if (transcript) onResult(transcript)
      }
      recognition.onend = () => setIsListening(false)
      recognition.onerror = (e: Event & { error?: string }) => {
        setIsListening(false)
        if (e.error === 'not-allowed') setError('Microphone access denied')
      }

      recognitionRef.current = recognition
      recognition.start()
      setIsListening(true)
      setError(null)
    } catch {
      setError('Speech recognition failed to start')
    }
  }, [hasAPI, isSecure, isListening, onResult])

  // Cleanup on unmount
  useEffect(() => {
    return () => recognitionRef.current?.stop()
  }, [])

  return { isListening, toggle, isSupported, error }
}

/* ==================== Loop Command Parser ==================== */

function parseTimeUnit(s: string): number | null {
  const m = s.match(/^(\d+)(m|h)$/i)
  if (!m) return null
  const val = parseInt(m[1], 10)
  if (val < 1) return null
  return m[2].toLowerCase() === 'h' ? val * 60 : val
}

function formatInterval(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

const DEFAULT_MAX_DAYS = 3

export function parseLoopCommand(text: string): { intervalMinutes: number; prompt: string; maxDays: number } | null {
  const trimmed = text.trim()
  const match = trimmed.match(/^\/loop\s+(\d+[mh])\s+(.+)$/si)
  if (!match) return null
  const intervalMinutes = parseTimeUnit(match[1])
  if (!intervalMinutes) return null
  let prompt = match[2].trim()
  let maxDays = DEFAULT_MAX_DAYS
  const maxMatch = prompt.match(/\s+--max\s+(\d+)\s*$/i)
  if (maxMatch) {
    maxDays = parseInt(maxMatch[1], 10)
    if (maxDays < 1) maxDays = DEFAULT_MAX_DAYS
    prompt = prompt.slice(0, maxMatch.index).trim()
  }
  if (!prompt) return null
  return { intervalMinutes, prompt, maxDays }
}

/* ==================== File/Image Preview ==================== */

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function FilePreview({ file, onRemove }: { file: UploadedFile; onRemove: () => void }) {
  const [expanded, setExpanded] = useState(true)
  const hasPreview = file.preview && file.preview.length > 0

  // Image preview
  if (file.isImage && file.imageUrl) {
    return (
      <div className="border rounded-lg bg-muted/30 overflow-hidden inline-block">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50">
          <ImageIcon className="size-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium truncate">{file.name}</span>
          <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(file.size)}</span>
          <button onClick={onRemove} className="ml-auto text-muted-foreground hover:text-destructive transition-colors p-0.5 shrink-0">
            <X className="size-3.5" />
          </button>
        </div>
        <div className="p-2">
          <img src={file.imageUrl} alt={file.name} className="max-h-40 max-w-xs rounded object-contain" />
        </div>
      </div>
    )
  }

  // Data file preview
  return (
    <div className="border rounded-lg bg-muted/30 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50">
        <Paperclip className="size-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium truncate">{file.name}</span>
        <span className="text-xs text-muted-foreground shrink-0">
          {formatFileSize(file.size)}
          {file.total_lines != null && ` · ${file.total_lines.toLocaleString()} rows`}
        </span>
        {hasPreview && (
          <button onClick={() => setExpanded(!expanded)} className="ml-auto text-muted-foreground hover:text-foreground transition-colors p-0.5" title={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        )}
        <button onClick={onRemove} className="text-muted-foreground hover:text-destructive transition-colors p-0.5 shrink-0">
          <X className="size-3.5" />
        </button>
      </div>
      {hasPreview && expanded && (
        <div className="max-h-48 overflow-auto border-t">
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 bg-muted">
              <tr>
                {Object.keys(file.preview![0]).map(key => (
                  <th key={key} className="px-3 py-1.5 text-left font-medium text-foreground whitespace-nowrap">{key}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-background">
              {file.preview!.map((row, i) => (
                <tr key={i} className="border-t border-border">
                  {Object.values(row).map((v, j) => {
                    const text = typeof v === 'string' ? v : JSON.stringify(v)
                    return <td key={j} className="px-3 py-1.5 text-foreground max-w-[200px] truncate" title={text ?? undefined}>{text}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ==================== Main Component ==================== */

export interface ChatInputProps {
  onSend: (text: string, files: UploadedFile[]) => void
  isLoading: boolean
  onCancel: () => void
  onClear?: () => void
  onNewChat?: () => void
  onLoop?: (intervalMinutes: number, prompt: string, maxDays: number) => void
  onCompact?: () => void
  slashCommands?: SlashCommand[]
  onUploadFile?: (file: File) => Promise<UploadedFile | null>
  acceptFileTypes?: string
  large?: boolean
  placeholder?: string
}

export default function ChatInput({
  onSend, isLoading, onCancel, onClear, onNewChat, onLoop, onCompact,
  slashCommands, onUploadFile,
  acceptFileTypes = '.jsonl,.csv,.json,.xlsx,.xls,.zip,.parquet,.png,.jpg,.jpeg,.gif,.webp',
  large, placeholder = 'Type a message... Type / for commands',
}: ChatInputProps) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { isListening, toggle: toggleSpeech, isSupported: speechSupported, error: speechError } = useSpeechRecognition(
    useCallback((transcript: string) => {
      setText(prev => prev ? `${prev} ${transcript}` : transcript)
    }, [])
  )

  const allCommands = useMemo(() => {
    if (!slashCommands) return DEFAULT_SLASH_COMMANDS
    const customNames = new Set(slashCommands.map(c => c.name))
    return [...slashCommands, ...DEFAULT_SLASH_COMMANDS.filter(c => !customNames.has(c.name))]
  }, [slashCommands])

  const slashState = useMemo(() => {
    const trimmed = text.trimStart()
    if (!trimmed.startsWith('/')) return null
    const filter = trimmed.slice(1).toLowerCase()
    if (filter.includes(' ')) return null
    return filter
  }, [text])

  const filteredCommands = useMemo(() => {
    if (slashState === null) return []
    return allCommands.filter(c => c.name.includes(slashState))
  }, [slashState, allCommands])

  const showCommands = filteredCommands.length > 0

  const executeCommand = useCallback((cmd: SlashCommand) => {
    if (cmd.type === 'prompt' && cmd.prompt) {
      setText('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      onSend(cmd.prompt, [])
    } else if (cmd.type === 'action') {
      if (cmd.name === 'clear') { setText(''); onClear?.() }
      else if (cmd.name === 'new') { setText(''); onNewChat?.() }
      else if (cmd.name === 'compact') { setText(''); onCompact?.() }
      else if (cmd.name === 'loop') { setText('/loop '); textareaRef.current?.focus() }
    }
  }, [onSend, onClear, onNewChat, onCompact])

  const uploadFile = useCallback(async (file: File) => {
    if (!onUploadFile) return
    setUploading(true)
    try {
      const result = await onUploadFile(file)
      if (result) setFiles(prev => [...prev, result])
    } finally {
      setUploading(false)
    }
  }, [onUploadFile])

  const handleSend = () => {
    const trimmed = text.trim()
    if (!trimmed && files.length === 0) return
    const loopParsed = parseLoopCommand(trimmed)
    if (loopParsed) {
      setText('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      onLoop?.(loopParsed.intervalMinutes, loopParsed.prompt, loopParsed.maxDays)
      return
    }
    onSend(trimmed, files)
    setText('')
    setFiles([])
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showCommands) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => (i + 1) % filteredCommands.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => (i - 1 + filteredCommands.length) % filteredCommands.length); return }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); executeCommand(filteredCommands[selectedIndex]); return }
      if (e.key === 'Escape') { e.preventDefault(); setText(''); return }
      if (e.key === 'Tab') { e.preventDefault(); executeCommand(filteredCommands[selectedIndex]); return }
    } else {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!isLoading) handleSend() }
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    Array.from(e.dataTransfer.files).forEach(uploadFile)
  }

  /** Handle Ctrl+V paste — intercept image data from clipboard */
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (!onUploadFile) return
    const items = e.clipboardData?.items
    if (!items) return

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const blob = item.getAsFile()
        if (blob) {
          // Generate a filename from type (e.g., "paste_1711234567.png")
          const ext = item.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
          const file = new File([blob], `paste_${Date.now()}.${ext}`, { type: item.type })
          uploadFile(file)
        }
        return
      }
    }
    // If no image found, let default paste behavior handle text
  }, [onUploadFile, uploadFile])

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    setSelectedIndex(0)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  const loopHint = useMemo(() => {
    const trimmed = text.trimStart()
    if (!trimmed.startsWith('/loop ')) return null
    const rest = trimmed.slice(6).trim()
    if (!rest) return 'Format: /loop <time> <command> [--max <days>]  e.g. /loop 5m check status'
    if (/^\d+[mh]?$/.test(rest) && !rest.match(/[mh]$/i)) return 'Add unit: m (minutes) or h (hours), e.g. 5m, 1h'
    if (/^\d+[mh]$/i.test(rest)) return 'Type the command to repeat'
    const parsed = parseLoopCommand(trimmed)
    if (parsed) return `Every ${formatInterval(parsed.intervalMinutes)}: "${parsed.prompt}" (max ${parsed.maxDays} days)`
    return null
  }, [text])

  const hasContent = text.trim() || files.length > 0

  const container = (
    <div className="relative bg-muted rounded-2xl border shadow-sm" onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
      {/* Slash command popup */}
      {showCommands && (
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-popover border rounded-lg shadow-lg overflow-hidden z-10">
          <div className="max-h-64 overflow-y-auto py-1">
            {filteredCommands.map((cmd, i) => (
              <button
                key={cmd.name}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors ${
                  i === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                }`}
                onMouseEnter={() => setSelectedIndex(i)}
                onMouseDown={e => { e.preventDefault(); executeCommand(cmd) }}
              >
                <span className="font-mono text-xs font-medium text-primary min-w-[80px]">/{cmd.name}</span>
                <span className="text-muted-foreground text-xs">{cmd.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loop hint */}
      {loopHint && !showCommands && (
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-popover border rounded-lg shadow-lg z-10 px-3 py-2">
          <span className="text-xs text-muted-foreground">{loopHint}</span>
        </div>
      )}

      {/* File/image previews */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pt-3 pb-2">
          {files.map((f, i) => (
            <FilePreview key={i} file={f} onRemove={() => {
              setFiles(prev => prev.filter((_, j) => j !== i))
            }} />
          ))}
        </div>
      )}

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={placeholder}
        rows={large ? 2 : 1}
        className={`w-full resize-none bg-transparent px-4 text-sm focus:outline-none placeholder:text-muted-foreground/60 ${large ? 'py-4' : 'py-3'}`}
      />

      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 pb-2">
        <div className="flex items-center gap-0.5">
          {onUploadFile && (
            <label className={`p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`} title="Upload file or image">
              {uploading ? <Loader2 className="size-5 animate-spin" /> : <Plus className="size-5" />}
              <input
                type="file"
                accept={acceptFileTypes}
                className="sr-only"
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }}
              />
            </label>
          )}
          {(speechSupported || speechError) && (
            <button
              onClick={toggleSpeech}
              className={`p-1.5 rounded-lg transition-colors ${
                isListening
                  ? 'text-red-500 bg-red-50 dark:bg-red-950/30 animate-pulse'
                  : speechError
                    ? 'text-muted-foreground/30 cursor-not-allowed'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              title={speechError || (isListening ? 'Stop recording' : 'Voice input')}
            >
              {isListening ? <MicOff className="size-5" /> : <Mic className="size-5" />}
            </button>
          )}
        </div>
        <div className="flex items-center">
          {isLoading ? (
            <button onClick={onCancel} className="w-9 h-9 rounded-full bg-muted-foreground/20 text-foreground flex items-center justify-center hover:bg-muted-foreground/30 transition-colors" title="Stop">
              <Square className="size-3.5" fill="currentColor" />
            </button>
          ) : (
            <button onClick={handleSend} disabled={!hasContent} className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" title="Send (Enter)">
              <Send className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )

  if (large) {
    return (
      <div className="w-full">
        {container}
        <p className="text-xs text-center text-muted-foreground/60 mt-3">Enter to send, Shift+Enter for newline, Ctrl+V to paste images</p>
      </div>
    )
  }

  return (
    <div className="pt-4 pb-4 px-4">
      <div className="max-w-3xl mx-auto">{container}</div>
    </div>
  )
}
