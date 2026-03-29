// Styles
import './style.css'

// Components
export { default as Chat } from './components/Chat'
export { default as ChatMessages, CostBadge } from './components/ChatMessages'
export { default as ChatInput, parseLoopCommand } from './components/ChatInput'
export { default as Sidebar } from './components/Sidebar'
export { default as ToastContainer } from './components/Toast'

// Hooks
export { useChat } from './hooks/useChat'

// Store
export { useChatStore, readConversationMessages, writeConversationMessages } from './store/chat'
export { useToastStore, addToast } from './store/toast'

// Types
export type {
  ChatMessage,
  ChatFileAttachment,
  UploadedFile,
  SlashCommand,
  CostInfo,
  ChatConfig,
  Conversation,
  SSEEvent,
} from './types'
export { DEFAULT_SLASH_COMMANDS, isImageFile, parseSSEEvent } from './types'

// Hook return type
export type { UseChatReturn } from './hooks/useChat'

// Component prop types
export type { ChatProps } from './components/Chat'
export type { ChatMessagesProps } from './components/ChatMessages'
export type { ChatInputProps } from './components/ChatInput'
export type { SidebarProps } from './components/Sidebar'
