import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { Sun, Moon, Monitor } from 'lucide-react'
import Chat from './components/Chat'
import Sidebar from './components/Sidebar'
import './app.css'

/* ==================== Auth ==================== */

const TOKEN_KEY = 'ccs_auth_token'

/* ==================== Theme ==================== */

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

/* ==================== Responsive ==================== */

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint)

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [breakpoint])

  return isMobile
}

/* ==================== App ==================== */

function App() {
  const [token, setToken] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const { theme, setTheme } = useTheme()
  const isMobile = useIsMobile()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(isMobile)

  useEffect(() => {
    if (isMobile) setSidebarCollapsed(true)
  }, [isMobile])

  // Check existing token on mount
  useEffect(() => {
    const saved = localStorage.getItem(TOKEN_KEY)
    if (!saved) { setChecking(false); return }
    fetch('/api/auth/check', { headers: { Authorization: `Bearer ${saved}` } })
      .then(r => { if (r.ok) setToken(saved); else localStorage.removeItem(TOKEN_KEY) })
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setChecking(false))
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const resp = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!resp.ok) { setError('Wrong password'); return }
      const { token: t } = await resp.json()
      localStorage.setItem(TOKEN_KEY, t)
      setToken(t)
    } catch { setError('Connection failed') }
    finally { setLoading(false) }
  }

  const handleAuthError = () => {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setPassword('')
  }

  if (checking) return null

  // Login page
  if (!token) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <form onSubmit={handleLogin} className="w-80 p-6 bg-card border rounded-xl shadow-lg">
          <h1 className="text-xl font-semibold text-center mb-6">Claude Code Server</h1>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Enter password"
            autoFocus
            className="w-full px-4 py-2.5 bg-muted/30 border rounded-lg focus:outline-none focus:ring-1 focus:ring-ring transition-colors placeholder:text-muted-foreground/50"
          />
          {error && <p className="text-destructive text-sm mt-2">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full mt-4 py-2.5 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 rounded-lg font-medium transition-colors"
          >
            {loading ? '...' : 'Login'}
          </button>
        </form>
      </div>
    )
  }

  // Main app
  const themeOptions: { value: Theme; icon: typeof Sun; label: string }[] = [
    { value: 'light', icon: Sun, label: 'Light' },
    { value: 'dark', icon: Moon, label: 'Dark' },
    { value: 'system', icon: Monitor, label: 'System' },
  ]

  return (
    <div className="h-screen flex">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        mobile={isMobile}
      />

      <div className="flex-1 flex flex-col min-w-0 relative bg-background">
        {/* Theme toggle */}
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
              <Icon className="size-4" />
            </button>
          ))}
        </div>

        <Chat
          apiBase="/api"
          uploadUrl="/api/upload"
          getHeaders={() => ({ Authorization: `Bearer ${token}` })}
          welcomeMessage="Hello, how can I help you?"
          placeholder={isMobile ? 'Type a message...' : 'Type a message... Type / for commands, Ctrl+V to paste images'}
          onToggleSidebar={() => setSidebarCollapsed(p => !p)}
          onAuthError={handleAuthError}
        />
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
