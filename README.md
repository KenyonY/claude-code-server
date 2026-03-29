# claude-code-server

Claude Code CLI wrapped as HTTP SSE server + reusable React chat UI.

## Install

```bash
pip install claude-code-server
```

## Quick Start

```bash
claude-code-server --working-dir /path/to/project --port 8333
# Open http://localhost:8333 for the Web UI
# API available at http://localhost:8333/api/*
```

### Embed in existing FastAPI app

```python
from claude_code_server import create_router, AgentConfig

router = create_router(AgentConfig(working_dir="/path/to/project"))
app.include_router(router, prefix="/api")
```

### Dynamic config per request

```python
from claude_code_server import create_router, AgentConfig, ChatRequest

def config_factory(req: ChatRequest) -> AgentConfig:
    return AgentConfig(
        working_dir="/path/to/project",
        system_prompt="You are a helpful assistant for ...",
        env={"MY_VAR": "value"},
    )

router = create_router(config_factory=config_factory)
```

### Frontend component library (npm)

```bash
npm install claude-code-chat
```

```tsx
import { Chat } from 'claude-code-chat'

<Chat
  apiBase="/api"
  uploadUrl="/api/upload"
  getHeaders={() => ({ Authorization: `Bearer ${token}` })}
  slashCommands={[
    { name: 'status', description: 'Check status', type: 'prompt', prompt: 'Show status' },
  ]}
/>
```

Or use individual components:

```tsx
import { useChat, ChatMessages, ChatInput } from 'claude-code-chat'

const { messages, send, cancel, isLoading, costInfo, uploadFile } = useChat({
  apiBase: '/api',
  uploadUrl: '/api/upload',
})

<ChatMessages messages={messages} isLoading={isLoading} costInfo={costInfo} />
<ChatInput onSend={send} isLoading={isLoading} onCancel={cancel} onUploadFile={uploadFile} />
```

> Note: Import the bundled CSS in your app entry:
> ```ts
> import 'claude-code-chat/style.css'
> ```

## SSE Event Protocol

| Event | Data | Description |
|-------|------|-------------|
| `session` | `{session_id}` | Session created/resumed |
| `text` | `{content}` | Text delta |
| `thinking` | `{content}` | Thinking delta |
| `tool_call` | `{id, name, arguments}` | Tool invocation |
| `tool_result` | `{id, name, result, is_error}` | Tool result |
| `done` | `{cost, duration_ms}` | Turn complete |
| `error` | `{message}` | Error |

## API

### Backend

- `ClaudeAgent` — Core agent class
- `AgentConfig` — Configuration (working_dir, system_prompt, env, max_turns, ...)
- `ChatRequest` — Request model (prompt, session_id)
- `create_router(config?, config_factory?)` — FastAPI router factory
- `create_app(config?)` — Standalone FastAPI app

### Frontend

- `<Chat>` — Complete chat page (drop-in)
- `<ChatMessages>` — Message renderer
- `<ChatInput>` — Input with slash commands + file upload
- `useChat(config)` — SSE streaming hook
- `useChatStore` — Zustand store
