import { useState, useEffect } from 'react'
import { Chat, Sidebar } from 'claude-code-chat'
import { Sun, Moon, Monitor } from './icons'

type Theme = 'light' | 'dark' | 'system'

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    (localStorage.getItem('theme') as Theme) || 'system'
  )

  useEffect(() => {
    const root = document.documentElement
    localStorage.setItem('theme', theme)
    if (theme === 'system') {
      root.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches)
    } else {
      root.classList.toggle('dark', theme === 'dark')
    }
  }, [theme])

  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => document.documentElement.classList.toggle('dark', e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  return { theme, setTheme }
}

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint)

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [breakpoint])

  return isMobile
}


export default function App() {
  const { theme, setTheme } = useTheme()
  const isMobile = useIsMobile()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(isMobile)

  // Auto-collapse when switching to mobile
  useEffect(() => {
    if (isMobile) setSidebarCollapsed(true)
  }, [isMobile])

  const themeOptions: { value: Theme; icon: typeof Sun; label: string }[] = [
    { value: 'light', icon: Sun, label: 'Light' },
    { value: 'dark', icon: Moon, label: 'Dark' },
    { value: 'system', icon: Monitor, label: 'System' },
  ]

  return (
    <div className="h-screen flex">
      {/* Sidebar */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        mobile={isMobile}
      />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 relative bg-background">
        {/* Theme toggle — shift right on mobile to avoid overlap with hamburger */}
        <div className={`absolute top-3 z-20 flex items-center gap-1 bg-muted/50 rounded-lg p-0.5 ${isMobile ? 'left-14' : 'left-3'}`}>
          {themeOptions.map(({ value, icon: Icon, label }) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              className={`p-1.5 rounded-md transition-colors ${
                theme === value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title={label}
            >
              <Icon />
            </button>
          ))}
        </div>

        <Chat
          apiBase="/api"
          uploadUrl="/api/upload"
          welcomeMessage="Hello, how can I help you?"
          placeholder={isMobile ? 'Type a message...' : 'Type a message... Type / for commands, Ctrl+V to paste images'}
          onToggleSidebar={() => setSidebarCollapsed(p => !p)}
        />
      </div>
    </div>
  )
}
