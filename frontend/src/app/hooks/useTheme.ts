import { useState, useEffect } from 'react'

export type Theme = 'light' | 'dark' | 'system'

const THEME_KEY = 'theme'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(THEME_KEY) as Theme) || 'system'
  )

  useEffect(() => {
    const root = document.documentElement
    localStorage.setItem(THEME_KEY, theme)
    if (theme === 'system') {
      root.classList.toggle(
        'dark',
        window.matchMedia('(prefers-color-scheme: dark)').matches
      )
    } else {
      root.classList.toggle('dark', theme === 'dark')
    }
  }, [theme])

  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) =>
      document.documentElement.classList.toggle('dark', e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  return { theme, setTheme }
}
