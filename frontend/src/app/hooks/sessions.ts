import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { authHeaders } from '../queryClient'

/* ==================== Types ==================== */

export interface SessionMetadata {
  id: string
  title: string
  working_dir: string
  owner_id: string | null
  created_at: number
  last_active_at: number
  message_count: number
  total_input_tokens: number
  total_output_tokens: number
  total_cost_usd: number
}

export interface MessageRecord {
  id: number
  seq: number
  role: 'user' | 'assistant' | 'system'
  content: Array<Record<string, unknown>>
  is_partial: boolean
  created_at: number
}

/* ==================== Fetchers ==================== */

async function authedJson<T>(input: string, init?: RequestInit): Promise<T> {
  const r = await fetch(input, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...authHeaders(),
    },
  })
  if (!r.ok) {
    throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status })
  }
  return r.json() as Promise<T>
}

async function fetchSessions(): Promise<SessionMetadata[]> {
  const data = await authedJson<{ sessions: SessionMetadata[]; total: number }>(
    '/api/sessions?limit=200',
  )
  return data.sessions
}

async function fetchSessionMessages(sid: string): Promise<MessageRecord[]> {
  const data = await authedJson<{ session_id: string; messages: MessageRecord[] }>(
    `/api/sessions/${encodeURIComponent(sid)}/messages`,
  )
  return data.messages
}

async function patchSession(sid: string, title: string): Promise<SessionMetadata> {
  return authedJson<SessionMetadata>(`/api/sessions/${encodeURIComponent(sid)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
}

async function deleteSession(sid: string): Promise<void> {
  await authedJson<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(sid)}`, {
    method: 'DELETE',
  })
}

/* ==================== Query keys ==================== */

export const sessionsKey = ['sessions'] as const
export const sessionMessagesKey = (sid: string) => ['sessions', sid, 'messages'] as const

/* ==================== Hooks ==================== */

export function useSessions() {
  return useQuery({
    queryKey: sessionsKey,
    queryFn: fetchSessions,
    staleTime: 10_000,
  })
}

export function useSessionMessages(sid: string | null) {
  return useQuery({
    queryKey: sid ? sessionMessagesKey(sid) : ['sessions', 'none', 'messages'],
    queryFn: () => fetchSessionMessages(sid as string),
    enabled: !!sid,
    staleTime: 5_000,
  })
}

export function useRenameSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sid, title }: { sid: string; title: string }) => patchSession(sid, title),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sessionsKey })
    },
  })
}

export function useDeleteSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sid: string) => deleteSession(sid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sessionsKey })
    },
  })
}
