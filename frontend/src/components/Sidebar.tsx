import { useState, useRef, useEffect } from 'react'
import { Plus, Trash2, MessageSquare, PanelLeftClose, PanelLeft, Bot, Menu, Search } from 'lucide-react'
import { useChatStore } from '../store/chat'
import {
  useSessions,
  useRenameSession,
  useDeleteSession,
} from '../app/hooks/sessions'
import type { Conversation } from '../types'

export interface SidebarProps {
  collapsed?: boolean
  onToggle?: () => void
  /** Brand name shown in header */
  brandName?: string
  /** Mobile mode: overlay instead of pushing content */
  mobile?: boolean
}

/* ==================== Date Grouping ==================== */

function groupByDate(conversations: Conversation[]): { label: string; items: Conversation[] }[] {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const lastWeek = new Date(today.getTime() - 7 * 86400000)

  const groups: { label: string; items: Conversation[] }[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Last 7 days', items: [] },
    { label: 'Earlier', items: [] },
  ]

  conversations.forEach(conv => {
    const d = new Date(conv.createdAt)
    if (d >= today) groups[0].items.push(conv)
    else if (d >= yesterday) groups[1].items.push(conv)
    else if (d >= lastWeek) groups[2].items.push(conv)
    else groups[3].items.push(conv)
  })

  return groups.filter(g => g.items.length > 0)
}

/* ==================== Component ==================== */

export default function Sidebar({ collapsed = false, onToggle, brandName = 'Claude Code', mobile = false }: SidebarProps) {
  const conversations = useChatStore((s) => s.conversations)
  const activeId = useChatStore((s) => s.activeId)
  const messages = useChatStore((s) => s.messages)
  const createConversation = useChatStore((s) => s.createConversation)
  const switchConversation = useChatStore((s) => s.switchConversation)
  const removeConversation = useChatStore((s) => s.removeConversation)
  const renameConversationLocal = useChatStore((s) => s.renameConversation)
  const setConversationsFromBackend = useChatStore((s) => s.setConversationsFromBackend)

  // Hydrate from backend.
  const { data: backendSessions } = useSessions()
  useEffect(() => {
    if (backendSessions) setConversationsFromBackend(backendSessions)
  }, [backendSessions, setConversationsFromBackend])

  const renameMutation = useRenameSession()
  const deleteMutation = useDeleteSession()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const visible = conversations.filter(c => {
    const show = c.id === activeId || c.name !== 'New Chat' || (c.id === activeId && messages.length > 0)
    if (!show) return false
    if (searchQuery) return c.name.toLowerCase().includes(searchQuery.toLowerCase())
    return true
  })
  const grouped = groupByDate(visible)

  const handleNewChat = () => {
    createConversation()
    if (mobile) onToggle?.()  // Close on mobile after action
  }

  const handleSelect = (id: string) => {
    switchConversation(id)
    if (mobile) onToggle?.()  // Close on mobile after selecting
  }

  const handleDoubleClick = (id: string, name: string) => {
    setEditingId(id)
    setEditName(name)
  }

  const handleRenameSubmit = (id: string) => {
    const name = editName.trim()
    setEditingId(null)
    if (!name) return
    // Optimistic local update; persist to backend if it's not a draft conversation.
    renameConversationLocal(id, name)
    const isPersisted = (backendSessions ?? []).some((s) => s.id === id)
    if (isPersisted) {
      renameMutation.mutate({ sid: id, title: name })
    }
  }

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setDeleteTargetId(id)
  }

  const confirmDelete = () => {
    if (!deleteTargetId) return
    const id = deleteTargetId
    setDeleteTargetId(null)
    const isPersisted = (backendSessions ?? []).some((s) => s.id === id)
    removeConversation(id)
    if (isPersisted) {
      deleteMutation.mutate(id)
    }
  }

  /* --- Collapsed (desktop only, mobile uses overlay) --- */
  if (collapsed && !mobile) {
    return (
      <div className="flex flex-col items-center py-4 border-r bg-muted/20 w-14 shrink-0">
        <button onClick={onToggle} className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors" title="Expand">
          <PanelLeft className="size-5" />
        </button>
        <button onClick={handleNewChat} className="p-2 mt-3 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors" title="New chat">
          <Plus className="size-5" />
        </button>
      </div>
    )
  }

  /* --- Mobile collapsed: just show hamburger --- */
  if (collapsed && mobile) {
    return (
      <button
        onClick={onToggle}
        className="fixed top-3 left-3 z-30 p-2 bg-background border rounded-lg shadow-sm text-muted-foreground hover:text-foreground transition-colors"
        title="Open menu"
      >
        <Menu className="size-5" />
      </button>
    )
  }

  const sidebarContent = (
    <div className={`flex flex-col bg-background border-r h-full ${mobile ? 'w-72' : 'w-72 shrink-0'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2.5">
          <div className="size-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
            <Bot className="size-4.5 text-white" />
          </div>
          <span className="text-base font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            {brandName}
          </span>
        </div>
        <button onClick={onToggle} className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors" title="Close">
          <PanelLeftClose className="size-4" />
        </button>
      </div>

      {/* New Chat Button */}
      <div className="px-4 pb-4">
        <button
          onClick={handleNewChat}
          className="w-full px-4 py-2.5 bg-muted/50 text-foreground/80 rounded-full hover:bg-muted transition-colors flex items-center justify-center gap-2 text-sm"
        >
          <Plus className="size-4" />
          New Chat
        </button>
      </div>

      {/* Search */}
      {conversations.length > 3 && (
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-muted/30 border rounded-lg focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
            />
          </div>
        </div>
      )}

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto">
        {grouped.length === 0 && (
          <div className="text-center text-muted-foreground/50 py-8 text-sm">No conversations yet</div>
        )}
        {grouped.map(group => (
          <div key={group.label} className="mb-1">
            <div className="px-4 py-2 text-[11px] text-muted-foreground/60 font-medium uppercase tracking-wider">
              {group.label}
            </div>
            {group.items.map(conv => (
              <div
                key={conv.id}
                onClick={() => handleSelect(conv.id)}
                onDoubleClick={() => handleDoubleClick(conv.id, conv.name)}
                className={`group flex items-center gap-2 px-4 py-2.5 cursor-pointer transition-colors ${
                  conv.id === activeId
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-muted/50 text-foreground/70'
                }`}
              >
                <MessageSquare className="size-3.5 shrink-0 text-muted-foreground/50" />
                <div className="flex-1 min-w-0">
                  {editingId === conv.id ? (
                    <input
                      ref={inputRef}
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onBlur={() => handleRenameSubmit(conv.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRenameSubmit(conv.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      className="w-full text-sm bg-background border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring"
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <span className="text-sm truncate block">{conv.name}</span>
                  )}
                </div>
                <button
                  onClick={e => handleDelete(e, conv.id)}
                  className="p-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all rounded"
                  title="Delete"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Delete confirmation dialog */}
      {deleteTargetId && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30">
          <div className="bg-popover border rounded-lg shadow-xl p-4 mx-4 max-w-[240px] w-full">
            <p className="text-sm text-foreground mb-4">Delete this conversation?</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteTargetId(null)}
                className="px-3 py-1.5 text-xs rounded-md border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="px-3 py-1.5 text-xs rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  /* --- Mobile: overlay with backdrop --- */
  if (mobile) {
    return (
      <div className="fixed inset-0 z-40 flex">
        {sidebarContent}
        {/* Backdrop */}
        <div className="flex-1 bg-black/40" onClick={onToggle} />
      </div>
    )
  }

  /* --- Desktop: inline --- */
  return sidebarContent
}
