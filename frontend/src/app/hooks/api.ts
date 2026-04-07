import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { authHeaders, setToken, clearToken } from '../queryClient'

/* ==================== Auth ==================== */

export const AUTH_QUERY_KEY = ['auth'] as const

async function fetchAuthCheck(): Promise<{ ok: boolean }> {
  const headers = authHeaders()
  if (!headers.Authorization) return { ok: false }
  const r = await fetch('/api/auth/check', { headers })
  return { ok: r.ok }
}

export function useAuthCheck() {
  return useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: fetchAuthCheck,
    staleTime: Infinity, // token validity changes only via login/logout
    gcTime: Infinity,
    retry: false,
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (password: string): Promise<string> => {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!r.ok) throw new Error('Wrong password')
      const { token } = (await r.json()) as { token: string }
      return token
    },
    onSuccess: (token) => {
      setToken(token)
      // Pre-seed the auth cache so the next loader call is instant
      qc.setQueryData(AUTH_QUERY_KEY, { ok: true })
    },
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return () => {
    clearToken()
    qc.setQueryData(AUTH_QUERY_KEY, { ok: false })
    qc.invalidateQueries({ queryKey: AUTH_QUERY_KEY })
  }
}

/* ==================== Health ==================== */

export type HealthStatus = 'connected' | 'disconnected'

async function fetchHealth(): Promise<HealthStatus> {
  try {
    const r = await fetch('/api/health')
    return r.ok ? 'connected' : 'disconnected'
  } catch {
    return 'disconnected'
  }
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 15_000,
    staleTime: 0,
    retry: false,
  })
}
