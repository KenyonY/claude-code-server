import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router'
import Chat from '@/components/Chat'
import { useChatStore, blocksToChatMessages } from '@/store/chat'
import { useSessionMessages, type MessageRecord } from '../hooks/sessions'
import { useIsMobile } from '../hooks/useIsMobile'
import { authHeaders } from '../queryClient'

export default function ChatPage() {
  const { conversationId } = useParams()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const switchConversation = useChatStore((s) => s.switchConversation)
  const conversations = useChatStore((s) => s.conversations)
  const activeId = useChatStore((s) => s.activeId)
  const setActiveMessagesFromBackend = useChatStore((s) => s.setActiveMessagesFromBackend)

  // Sync URL → store. switchConversation guards no-op switches, so the
  // AppLayout's reverse sync (store → URL) won't ping-pong.
  useEffect(() => {
    if (!conversationId) return
    if (!conversations.some((c) => c.id === conversationId)) return
    switchConversation(conversationId)
  }, [conversationId, conversations, switchConversation])

  // If the requested id isn't in the (already-hydrated) list, bounce home.
  useEffect(() => {
    if (!conversationId || conversations.length === 0) return
    if (!conversations.some((c) => c.id === conversationId)) {
      navigate('/', { replace: true })
    }
  }, [conversationId, conversations, navigate])

  // Lazy-load backend messages on switch. Skipped for drafts (no backend row
  // yet) by checking the conversations list.
  const isPersisted = !!activeId && conversations.some((c) => c.id === activeId && c.sessionId === activeId)
  const { data: backendMessages } = useSessionMessages(isPersisted ? activeId : null)

  useEffect(() => {
    if (!activeId || !backendMessages) return
    // Don't clobber an in-flight stream.
    const local = useChatStore.getState().messages
    if (local.some((m) => m.isStreaming)) return
    // Only adopt the backend snapshot when local is empty — otherwise the
    // active in-memory state is the freshest copy.
    if (local.length === 0) {
      const ui = blocksToChatMessages(backendMessages as MessageRecord[])
      setActiveMessagesFromBackend(activeId, ui, activeId)
    }
  }, [activeId, backendMessages, setActiveMessagesFromBackend])

  return (
    <Chat
      apiBase="/api"
      uploadUrl="/api/upload"
      getHeaders={authHeaders}
      welcomeMessage="Hello, how can I help you?"
      placeholder={
        isMobile
          ? 'Type a message...'
          : 'Type a message... Type / for commands, Ctrl+V to paste images'
      }
      onAuthError={() => navigate('/login', { replace: true })}
      onOpenSettings={() => navigate('/settings')}
    />
  )
}
