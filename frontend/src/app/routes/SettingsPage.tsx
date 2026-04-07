import { useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeft, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const SP_KEY = 'ccs_system_prompt'
const ASP_KEY = 'ccs_append_system_prompt'

function loadPromptSettings() {
  return {
    systemPrompt: localStorage.getItem(SP_KEY) || '',
    appendSystemPrompt: localStorage.getItem(ASP_KEY) || '',
  }
}

function savePromptSettings(systemPrompt: string, appendSystemPrompt: string) {
  if (systemPrompt) localStorage.setItem(SP_KEY, systemPrompt)
  else localStorage.removeItem(SP_KEY)
  if (appendSystemPrompt) localStorage.setItem(ASP_KEY, appendSystemPrompt)
  else localStorage.removeItem(ASP_KEY)
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const initial = loadPromptSettings()
  const [systemPrompt, setSystemPrompt] = useState(initial.systemPrompt)
  const [appendSystemPrompt, setAppendSystemPrompt] = useState(initial.appendSystemPrompt)

  const handleSave = () => {
    savePromptSettings(systemPrompt.trim(), appendSystemPrompt.trim())
    toast.success('Settings saved')
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 pt-16">
        <div className="flex items-center gap-3 mb-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            aria-label="Back"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-2xl font-semibold">Settings</h1>
        </div>

        <Tabs defaultValue="prompt">
          <TabsList>
            <TabsTrigger value="prompt">System Prompt</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>

          <TabsContent value="prompt" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>System Prompt</CardTitle>
                <CardDescription>
                  Configure how Claude behaves. Override or extend the default system prompt.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="sp">
                    System Prompt{' '}
                    <span className="text-destructive/70 font-normal">
                      (replaces CC default — loses built-in tools)
                    </span>
                  </Label>
                  <Textarea
                    id="sp"
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="Leave empty to use CC default system prompt"
                    rows={4}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="asp">
                    Append System Prompt{' '}
                    <span className="text-emerald-600 dark:text-emerald-400 font-normal">
                      (keeps CC tools + adds your rules)
                    </span>
                  </Label>
                  <Textarea
                    id="asp"
                    value={appendSystemPrompt}
                    onChange={(e) => setAppendSystemPrompt(e.target.value)}
                    placeholder="e.g. Always reply in Chinese"
                    rows={4}
                  />
                </div>
                <div className="flex justify-end">
                  <Button onClick={handleSave}>
                    <Save className="size-4" />
                    Save
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="about" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>About</CardTitle>
                <CardDescription>Claude Code Server</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-2">
                <p>A web UI for interacting with the Claude Code agent.</p>
                <p>
                  Source:{' '}
                  <a
                    href="https://github.com/KenyonY/claude-code-server"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    github.com/KenyonY/claude-code-server
                  </a>
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
