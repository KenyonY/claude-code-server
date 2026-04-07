import { useState, useEffect } from 'react'
import { Outlet, useLocation, useNavigate, useParams } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { Sun, Moon, Monitor, LogOut, User } from 'lucide-react'
import Sidebar from '@/components/Sidebar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTheme, type Theme } from '../hooks/useTheme'
import { useIsMobile } from '../hooks/useIsMobile'
import { useLogout } from '../hooks/api'
import { useChatStore } from '@/store/chat'

export default function AppLayout() {
  const { theme, setTheme } = useTheme()
  const isMobile = useIsMobile()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(isMobile)
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams()
  const logout = useLogout()
  const activeId = useChatStore((s) => s.activeId)

  useEffect(() => {
    if (isMobile) setSidebarCollapsed(true)
  }, [isMobile])

  // Sync store activeId → URL.
  // Guard: only navigate when on a chat route (not /settings) and the URL id differs.
  useEffect(() => {
    const isChatRoute = location.pathname === '/' || location.pathname.startsWith('/c/')
    if (!isChatRoute) return
    if (!activeId) return
    if (params.conversationId === activeId) return
    navigate(`/c/${activeId}`, { replace: true })
  }, [activeId, location.pathname, params.conversationId, navigate])

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  const themeOptions: { value: Theme; icon: typeof Sun; label: string }[] = [
    { value: 'light', icon: Sun, label: 'Light' },
    { value: 'dark', icon: Moon, label: 'Dark' },
    { value: 'system', icon: Monitor, label: 'System' },
  ]

  return (
    <div className="h-screen flex">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((p) => !p)}
        mobile={isMobile}
      />

      <div className="flex-1 flex flex-col min-w-0 relative bg-background">
        {/* Shell top-left bar — theme toggle + user menu. Placed here (not on the
            right) so they never collide with Chat's own status bar at top-3 right-4. */}
        <div
          className={`absolute top-3 z-20 flex items-center gap-1.5 ${
            isMobile ? 'left-14' : 'left-3'
          }`}
        >
          <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
            {themeOptions.map(({ value, icon: Icon, label }) => (
              <Tooltip key={value}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setTheme(value)}
                    className={`p-1.5 rounded-md transition-colors ${
                      theme === value
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    aria-label={label}
                  >
                    <Icon className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{label}</TooltipContent>
              </Tooltip>
            ))}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                aria-label="Account"
              >
                <User className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="size-4" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Routed page content with subtle fade transitions */}
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="flex-1 flex flex-col min-h-0"
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
