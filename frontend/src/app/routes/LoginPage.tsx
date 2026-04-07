import { useState } from 'react'
import { useNavigate } from 'react-router'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useLogin } from '../hooks/api'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const navigate = useNavigate()
  const login = useLogin()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await login.mutateAsync(password)
      navigate('/', { replace: true })
    } catch {
      // error surfaced via login.isError below
    }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="w-full max-w-sm"
      >
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Claude Code Server</CardTitle>
            <CardDescription>Enter your password to continue</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoFocus
                  disabled={login.isPending}
                />
              </div>
              {login.isError && (
                <p className="text-destructive text-sm">
                  {login.error instanceof Error ? login.error.message : 'Login failed'}
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={login.isPending || !password}
              >
                {login.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Signing in
                  </>
                ) : (
                  'Login'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
