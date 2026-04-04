import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { Chat } from './index'
import './style.css'

const TOKEN_KEY = 'ccs_auth_token'

function App() {
  const [token, setToken] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
      if (!resp.ok) { setError('密码错误'); return }
      const { token: t } = await resp.json()
      localStorage.setItem(TOKEN_KEY, t)
      setToken(t)
    } catch { setError('连接失败') }
    finally { setLoading(false) }
  }

  if (checking) return null

  if (!token) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#1a1a2e]">
        <form onSubmit={handleLogin} className="w-80 p-6 bg-[#16213e] rounded-xl shadow-2xl">
          <h1 className="text-xl font-semibold text-center text-white mb-6">Claude Code Server</h1>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="输入密码"
            autoFocus
            className="w-full px-4 py-2.5 bg-[#0f3460] border border-[#533483]/30 rounded-lg text-white placeholder:text-gray-400 focus:outline-none focus:border-[#533483] transition-colors"
          />
          {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full mt-4 py-2.5 bg-[#533483] hover:bg-[#533483]/80 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
          >
            {loading ? '...' : '登录'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="h-screen">
      <Chat
        apiBase="/api"
        uploadUrl="/api/upload"
        getHeaders={() => ({ Authorization: `Bearer ${token}` })}
      />
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
