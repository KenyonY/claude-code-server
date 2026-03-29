import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
// Note: consumers must import 'katex/dist/katex.min.css' in their app
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import {
  ChevronRight, Loader2, AlertCircle, CheckCircle2,
  Paperclip, ChevronDown, ChevronUp, Terminal, FileText,
  Search, Brain, Copy, Check, X,
} from 'lucide-react'
import type { ChatMessage, ChatFileAttachment, CostInfo } from '../types'

/* ==================== Utilities ==================== */

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function useCopyButton() {
  const [copied, setCopied] = useState(false)
  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [])
  return { copied, copy }
}

/** Preprocess LaTeX: convert \[...\] → $$...$$ and \(...\) → $...$ */
function preprocessLatex(text: string): string {
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, p1) => `$$${p1}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, p1) => `$${p1}$`)
}

/* ==================== Code Block ==================== */

function CodeBlock({ language, children }: { language?: string; children: string }) {
  const { copied, copy } = useCopyButton()
  const lang = language || 'text'

  return (
    <div className="rounded-lg overflow-hidden border border-border/30 my-2 not-prose">
      <div className="flex items-center justify-between px-3 py-1 bg-[#1e1e2e] border-b border-border/20">
        <span className="text-[11px] text-zinc-500 font-mono">{lang}</span>
        <button onClick={() => copy(children)} className="text-zinc-500 hover:text-zinc-300 transition-colors p-0.5" title="Copy">
          {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      <SyntaxHighlighter
        style={oneDark}
        language={lang}
        showLineNumbers
        lineNumberStyle={{ minWidth: '2em', paddingRight: '1em', color: '#555', userSelect: 'none' }}
        customStyle={{ margin: 0, padding: '12px', fontSize: '13px', background: '#1e1e2e' }}
        wrapLongLines
      >
        {children}
      </SyntaxHighlighter>
    </div>
  )
}

/* ==================== Image Lightbox ==================== */

function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 text-white/70 hover:text-white p-2">
        <X className="size-6" />
      </button>
      <img src={src} alt={alt} className="max-h-[90vh] max-w-[90vw] object-contain" onClick={e => e.stopPropagation()} />
    </div>
  )
}

/* ==================== File Attachment Card ==================== */

function FileAttachmentCard({ file }: { file: ChatFileAttachment }) {
  const [expanded, setExpanded] = useState(false)
  const [lightbox, setLightbox] = useState(false)
  const hasPreview = file.preview && file.preview.length > 0

  if (file.isImage && file.imageUrl) {
    return (
      <>
        <div className="rounded-lg border bg-background/80 overflow-hidden text-foreground inline-block cursor-pointer" onClick={() => setLightbox(true)}>
          <img src={file.imageUrl} alt={file.name} className="max-h-48 max-w-xs rounded object-contain hover:opacity-90 transition-opacity" />
        </div>
        {lightbox && <ImageLightbox src={file.imageUrl} alt={file.name} onClose={() => setLightbox(false)} />}
      </>
    )
  }

  return (
    <div className="rounded-lg border bg-background/80 overflow-hidden text-foreground">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50">
        <Paperclip className="size-3 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium truncate">{file.name}</span>
        <span className="text-xs text-muted-foreground shrink-0">
          {formatFileSize(file.size)}
          {file.total_lines != null && ` · ${file.total_lines.toLocaleString()} rows`}
        </span>
        {hasPreview && (
          <button onClick={() => setExpanded(!expanded)} className="ml-auto text-muted-foreground hover:text-foreground transition-colors p-0.5">
            {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
        )}
      </div>
      {hasPreview && expanded && (
        <div className="max-h-40 overflow-auto border-t">
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 bg-muted">
              <tr>
                {Object.keys(file.preview![0]).map(key => (
                  <th key={key} className="px-2 py-1 text-left font-medium whitespace-nowrap">{key}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {file.preview!.map((row, i) => (
                <tr key={i} className="border-t border-border">
                  {Object.values(row).map((v, j) => {
                    const text = typeof v === 'string' ? v : JSON.stringify(v)
                    return <td key={j} className="px-2 py-1 max-w-[160px] truncate" title={text ?? undefined}>{text}</td>
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

/* ==================== Thinking Block ==================== */

function ThinkingBlock({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  const [open, setOpen] = useState(false)

  if (isStreaming) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground py-1">
        <Brain className="size-3 animate-pulse" />
        <span className="animate-pulse">Thinking...</span>
      </div>
    )
  }

  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors py-1">
        <ChevronRight className={`size-3 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
        <Brain className="size-3" />
        <span>Thinking</span>
      </button>
      {open && (
        <div className="mt-1 ml-1.5 pl-3 border-l-2 border-muted text-xs text-muted-foreground/80 whitespace-pre-wrap max-h-[300px] overflow-auto leading-relaxed">
          {content}
        </div>
      )}
    </div>
  )
}

/* ==================== Bash Terminal Block ==================== */

function BashToolBlock({ msg, resultMsg }: { msg: ChatMessage; resultMsg?: ChatMessage }) {
  const [showOutput, setShowOutput] = useState(false)
  const isRunning = !resultMsg
  const isError = resultMsg?.isError
  const command = (msg.toolArgs?.command as string) || ''
  const description = (msg.toolArgs?.description as string) || ''
  const resultText = resultMsg?.toolResult || ''
  const lineCount = resultText ? resultText.split('\n').length : 0

  return (
    <div className="rounded-lg overflow-hidden border border-zinc-700/30">
      <div className="flex items-center gap-2 px-3 py-1 bg-[#1a1b26] border-b border-zinc-700/30">
        <Terminal className="size-3 text-zinc-500" />
        <span className="text-[11px] text-zinc-500 truncate flex-1 font-mono">{description || 'Terminal'}</span>
        {isRunning ? <Loader2 className="size-3 animate-spin text-blue-400" /> :
         isError ? <AlertCircle className="size-3 text-red-400" /> :
         <CheckCircle2 className="size-3 text-emerald-400" />}
      </div>
      <div className="bg-[#1e1e2e] px-3 py-2">
        <pre className="text-[13px] font-mono leading-relaxed whitespace-pre-wrap break-all">
          <span className="text-emerald-400 select-none">$ </span>
          <span className="text-zinc-200">{command}</span>
        </pre>
      </div>
      {resultMsg && resultText && (
        <>
          <button onClick={() => setShowOutput(!showOutput)} className="w-full px-3 py-1 text-[11px] text-zinc-500 hover:text-zinc-300 bg-[#1a1b26] border-t border-zinc-700/30 flex items-center gap-1 transition-colors">
            <ChevronRight className={`size-3 transition-transform duration-150 ${showOutput ? 'rotate-90' : ''}`} />
            <span>Output{lineCount > 1 ? ` (${lineCount} lines)` : ''}</span>
          </button>
          {showOutput && (
            <div className="bg-[#16161e] px-3 py-2 border-t border-zinc-700/20 max-h-[400px] overflow-auto">
              <pre className="text-xs font-mono text-zinc-400 whitespace-pre-wrap break-all leading-relaxed">{resultText}</pre>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ==================== Edit Tool Block (Diff View) ==================== */

function EditToolBlock({ msg, resultMsg }: { msg: ChatMessage; resultMsg?: ChatMessage }) {
  const [open, setOpen] = useState(true)
  const isRunning = !resultMsg
  const isError = resultMsg?.isError
  const filePath = (msg.toolArgs?.file_path as string) || ''
  const oldStr = (msg.toolArgs?.old_string as string) || ''
  const newStr = (msg.toolArgs?.new_string as string) || ''
  const detail = filePath ? filePath.split('/').slice(-2).join('/') : ''

  return (
    <div className="rounded-lg overflow-hidden border border-border/50">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full text-left px-3 py-1.5 bg-muted/30 hover:bg-muted/50 text-sm transition-colors">
        <ChevronRight className={`size-3 shrink-0 text-muted-foreground transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Edit</span>
        {detail && <span className="text-xs font-mono truncate text-foreground/70">{detail}</span>}
        <span className="ml-auto">
          {isRunning ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> :
           isError ? <AlertCircle className="size-3 text-destructive" /> :
           <CheckCircle2 className="size-3 text-emerald-500" />}
        </span>
      </button>
      {open && (
        <div className="border-t border-border/30 overflow-hidden">
          {oldStr && (
            <div className="bg-red-50 dark:bg-red-950/20 px-3 py-1.5 border-b border-border/20">
              <div className="text-[10px] text-red-600 dark:text-red-400 font-medium mb-0.5">- removed</div>
              <pre className="text-xs font-mono whitespace-pre-wrap break-all text-red-700 dark:text-red-300/80">{oldStr}</pre>
            </div>
          )}
          {newStr && (
            <div className="bg-emerald-50 dark:bg-emerald-950/20 px-3 py-1.5">
              <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium mb-0.5">+ added</div>
              <pre className="text-xs font-mono whitespace-pre-wrap break-all text-emerald-700 dark:text-emerald-300/80">{newStr}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ==================== File Tool Block ==================== */

function FileToolBlock({ msg, resultMsg }: { msg: ChatMessage; resultMsg?: ChatMessage }) {
  const [open, setOpen] = useState(false)
  const isRunning = !resultMsg
  const isError = resultMsg?.isError
  const toolName = msg.toolName || ''
  const filePath = (msg.toolArgs?.file_path as string) || ''
  const pattern = (msg.toolArgs?.pattern as string) || ''

  const labels: Record<string, string> = { Read: 'Read', Write: 'Write', Glob: 'Search files', Grep: 'Search content' }
  const label = labels[toolName] || toolName
  const detail = filePath ? filePath.split('/').slice(-2).join('/') : pattern || ''
  const Icon = ['Glob', 'Grep'].includes(toolName) ? Search : FileText

  return (
    <div className="rounded-lg overflow-hidden border border-border/50">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full text-left px-3 py-1.5 bg-muted/30 hover:bg-muted/50 text-sm transition-colors">
        <ChevronRight className={`size-3 shrink-0 text-muted-foreground transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{label}</span>
        {detail && <span className="text-xs font-mono truncate text-foreground/70">{detail}</span>}
        <span className="ml-auto">
          {isRunning ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> :
           isError ? <AlertCircle className="size-3 text-destructive" /> :
           <CheckCircle2 className="size-3 text-emerald-500" />}
        </span>
      </button>
      {open && (
        <div className="px-3 py-2 bg-muted/10 border-t border-border/30 space-y-2 overflow-hidden">
          {msg.toolArgs && Object.keys(msg.toolArgs).length > 0 && (
            <div>
              <div className="text-[11px] text-muted-foreground mb-1 font-medium">Args</div>
              <pre className="text-xs font-mono whitespace-pre-wrap break-all text-foreground/80">{JSON.stringify(msg.toolArgs, null, 2)}</pre>
            </div>
          )}
          {resultMsg && (
            <div>
              <div className="text-[11px] text-muted-foreground mb-1 font-medium">Result</div>
              <pre className="text-xs font-mono whitespace-pre-wrap break-all max-h-[300px] overflow-auto text-foreground/80">{resultMsg.toolResult}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ==================== Generic Tool Block ==================== */

function GenericToolBlock({ msg, resultMsg }: { msg: ChatMessage; resultMsg?: ChatMessage }) {
  const [open, setOpen] = useState(false)
  const isRunning = !resultMsg
  const isError = resultMsg?.isError

  return (
    <div className="rounded-lg overflow-hidden border border-border/50">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full text-left px-3 py-1.5 bg-muted/30 hover:bg-muted/50 text-sm transition-colors">
        <ChevronRight className={`size-3 shrink-0 text-muted-foreground transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
        <span className="text-xs font-medium">{msg.toolName || 'Tool'}</span>
        <span className="ml-auto">
          {isRunning ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> :
           isError ? <AlertCircle className="size-3 text-destructive" /> :
           <CheckCircle2 className="size-3 text-emerald-500" />}
        </span>
      </button>
      {open && (
        <div className="px-3 py-2 bg-muted/10 border-t border-border/30 space-y-2 overflow-hidden">
          {msg.toolArgs && Object.keys(msg.toolArgs).length > 0 && (
            <div>
              <div className="text-[11px] text-muted-foreground mb-1 font-medium">Args</div>
              <pre className="text-xs font-mono whitespace-pre-wrap break-all text-foreground/80">{JSON.stringify(msg.toolArgs, null, 2)}</pre>
            </div>
          )}
          {resultMsg && (
            <div>
              <div className="text-[11px] text-muted-foreground mb-1 font-medium">Result</div>
              <pre className="text-xs font-mono whitespace-pre-wrap break-all max-h-[300px] overflow-auto text-foreground/80">{resultMsg.toolResult}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ==================== Tool Call Dispatch ==================== */

function ToolCallBlock({ msg, resultMsg }: { msg: ChatMessage; resultMsg?: ChatMessage }) {
  if (msg.toolName === 'Bash') return <BashToolBlock msg={msg} resultMsg={resultMsg} />
  if (msg.toolName === 'Edit') return <EditToolBlock msg={msg} resultMsg={resultMsg} />
  if (['Read', 'Write', 'Glob', 'Grep'].includes(msg.toolName || '')) return <FileToolBlock msg={msg} resultMsg={resultMsg} />
  return <GenericToolBlock msg={msg} resultMsg={resultMsg} />
}

/* ==================== Cost Badge ==================== */

export function CostBadge({ cost, durationMs, inputTokens, outputTokens, contextWindow }: {
  cost?: number | null; durationMs?: number | null
  inputTokens?: number | null; outputTokens?: number | null; contextWindow?: number | null
}) {
  if (!cost && !durationMs) return null
  const parts: string[] = []
  if (durationMs) {
    const sec = durationMs / 1000
    parts.push(sec >= 60 ? `${(sec / 60).toFixed(1)}min` : `${sec.toFixed(1)}s`)
  }
  if (cost != null && cost > 0) parts.push(`$${cost.toFixed(4)}`)
  if (inputTokens || outputTokens) {
    const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
    const tokParts = []
    if (inputTokens) tokParts.push(`${fmt(inputTokens)} in`)
    if (outputTokens) tokParts.push(`${fmt(outputTokens)} out`)
    parts.push(tokParts.join(' / '))
  }
  if (contextWindow && inputTokens) {
    const pct = ((inputTokens / contextWindow) * 100).toFixed(1)
    parts.push(`ctx ${pct}%`)
  }
  if (parts.length === 0) return null

  return <div className="text-[11px] text-muted-foreground/50 text-center py-1 select-none">{parts.join(' · ')}</div>
}

/* ==================== Markdown Renderer ==================== */

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '')
          const code = String(children).replace(/\n$/, '')
          if (match) {
            return <CodeBlock language={match[1]}>{code}</CodeBlock>
          }
          // Inline code
          return <code className="bg-muted px-1.5 py-0.5 rounded text-[13px] font-mono" {...props}>{children}</code>
        },
      }}
    >
      {preprocessLatex(content)}
    </ReactMarkdown>
  )
}

/* ==================== Main Component ==================== */

export interface ChatMessagesProps {
  messages: ChatMessage[]
  isLoading: boolean
  scrollKey?: number
  costInfo?: CostInfo | null
}

export default function ChatMessages({ messages, isLoading, scrollKey, costInfo }: ChatMessagesProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const userScrolledRef = useRef(false)
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const scrolledUp = el.scrollHeight - el.scrollTop - el.clientHeight > 100
    userScrolledRef.current = scrolledUp
    setShowScrollBtn(scrolledUp)
  }, [])

  useEffect(() => {
    userScrolledRef.current = false
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [scrollKey])

  useEffect(() => {
    if (!userScrolledRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const toolResults = useMemo(() => {
    const map = new Map<string, ChatMessage>()
    for (const msg of messages) {
      if (msg.role === 'tool_result' && msg.toolCallId) map.set(msg.toolCallId, msg)
    }
    return map
  }, [messages])

  const hasStreamingMsg = messages.length > 0 && messages[messages.length - 1]?.isStreaming

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto relative" onScroll={handleScroll}>
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-3">
        {messages.map((msg, i) => {
          if (msg.role === 'tool_result') return null

          if (msg.role === 'thinking') {
            return (
              <div key={i} className="flex gap-3">
                <div className="size-8 shrink-0" />
                <div className="flex-1"><ThinkingBlock content={msg.content} isStreaming={msg.isStreaming} /></div>
              </div>
            )
          }

          if (msg.role === 'user') {
            const hasFiles = msg.files && msg.files.length > 0
            return (
              <div key={i} className="flex gap-3 justify-end">
                <div className="max-w-[80%] space-y-2">
                  {hasFiles && (
                    <div className="space-y-1.5">
                      {msg.files!.map((f, fi) => <FileAttachmentCard key={fi} file={f} />)}
                    </div>
                  )}
                  {msg.content && (
                    <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2.5">
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  )}
                  {msg.timestamp && (
                    <div className="text-[10px] text-muted-foreground/40 text-right pr-1">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>
                <div className="flex items-start">
                  <div className="size-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shrink-0">
                    <svg className="size-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                </div>
              </div>
            )
          }

          if (msg.role === 'tool_call') {
            const result = msg.toolCallId ? toolResults.get(msg.toolCallId) : undefined
            return (
              <div key={i} className="flex gap-3">
                <div className="size-8 shrink-0" />
                <div className="flex-1"><ToolCallBlock msg={msg} resultMsg={result} /></div>
              </div>
            )
          }

          if (msg.role === 'assistant') {
            return <AssistantMessage key={i} msg={msg} />
          }

          return null
        })}

        {costInfo && !isLoading && <CostBadge cost={costInfo.cost} durationMs={costInfo.durationMs} inputTokens={costInfo.inputTokens} outputTokens={costInfo.outputTokens} contextWindow={costInfo.contextWindow} />}

        {isLoading && !hasStreamingMsg && messages.length > 0 && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex gap-3">
            <div className="size-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shrink-0">
              <svg className="size-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
              </svg>
            </div>
            <div className="flex items-center gap-1 pt-2">
              <span className="size-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0ms]" />
              <span className="size-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:150ms]" />
              <span className="size-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Scroll to bottom FAB */}
      {showScrollBtn && (
        <button
          onClick={() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); setShowScrollBtn(false) }}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-primary text-primary-foreground rounded-full shadow-lg text-xs flex items-center gap-1 hover:bg-primary/90 transition-colors"
        >
          <svg className="size-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
          Bottom
        </button>
      )}
    </div>
  )
}

/* ==================== Assistant Message with hover actions ==================== */

function AssistantMessage({ msg }: { msg: ChatMessage }) {
  const { copied, copy } = useCopyButton()
  const [hovered, setHovered] = useState(false)

  return (
    <div className="flex gap-3 group" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div className="flex items-start">
        <div className="size-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shrink-0">
          <svg className="size-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
          </svg>
        </div>
      </div>
      <div className="flex-1 min-w-0 relative">
        <div className="prose prose-sm dark:prose-invert max-w-none break-words [&_pre]:overflow-x-auto [&_table]:text-xs">
          <MarkdownContent content={msg.content} />
        </div>
        {msg.isStreaming && <span className="inline-block w-1.5 h-4 bg-foreground/60 animate-pulse rounded-sm ml-0.5 align-text-bottom" />}
        {/* Hover action buttons */}
        {hovered && !msg.isStreaming && msg.content && (
          <div className="absolute -bottom-6 left-0 flex items-center gap-1">
            <button
              onClick={() => copy(msg.content)}
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground bg-background border rounded-md shadow-sm transition-colors"
              title="Copy message"
            >
              {copied ? <><Check className="size-3 text-emerald-500" /> Copied</> : <><Copy className="size-3" /> Copy</>}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
