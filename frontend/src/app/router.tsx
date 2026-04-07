import { createBrowserRouter, redirect } from 'react-router'
import { queryClient } from './queryClient'
import { AUTH_QUERY_KEY } from './hooks/api'
import LoginPage from './routes/LoginPage'
import AppLayout from './routes/AppLayout'
import ChatPage from './routes/ChatPage'
import SettingsPage from './routes/SettingsPage'

async function checkAuth(): Promise<{ ok: boolean }> {
  return queryClient.fetchQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: async () => {
      const token = localStorage.getItem('ccs_auth_token')
      if (!token) return { ok: false }
      try {
        const r = await fetch('/api/auth/check', {
          headers: { Authorization: `Bearer ${token}` },
        })
        return { ok: r.ok }
      } catch {
        return { ok: false }
      }
    },
    staleTime: Infinity,
  })
}

async function requireAuth() {
  const { ok } = await checkAuth()
  if (!ok) throw redirect('/login')
  return null
}

async function rejectIfAuthed() {
  const { ok } = await checkAuth()
  if (ok) throw redirect('/')
  return null
}

export const router = createBrowserRouter([
  {
    path: '/login',
    Component: LoginPage,
    loader: rejectIfAuthed,
  },
  {
    path: '/',
    Component: AppLayout,
    loader: requireAuth,
    children: [
      { index: true, Component: ChatPage },
      { path: 'c/:conversationId', Component: ChatPage },
      { path: 'settings', Component: SettingsPage },
    ],
  },
  {
    path: '*',
    loader: () => redirect('/'),
  },
])
