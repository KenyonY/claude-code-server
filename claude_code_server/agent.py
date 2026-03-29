"""Claude Code CLI agent — subprocess management + JSON stream parsing.

Wraps the `claude` CLI as an async generator of SSE events.
No project-specific logic — all context is injected via AgentConfig.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from pathlib import Path
from typing import AsyncGenerator

from .models import AgentConfig

_DEFAULT_CONFIG = AgentConfig()

# Tool results longer than this are truncated (e.g. base64 image data)
_MAX_RESULT_LEN = 10000


class ClaudeAgent:
    """Claude Code CLI wrapper."""

    def __init__(self) -> None:
        self._process: asyncio.subprocess.Process | None = None

    async def chat(
        self,
        prompt: str,
        session_id: str | None = None,
        config: AgentConfig | None = None,
    ) -> AsyncGenerator[dict, None]:
        """Run an agent conversation, yielding SSE events."""
        cfg = config or _DEFAULT_CONFIG
        is_resume = session_id is not None
        sid = session_id or str(uuid.uuid4())

        try:
            cmd = _build_command(prompt, sid, cfg, resume=is_resume)

            env = os.environ.copy()
            if cfg.env:
                env.update(cfg.env)

            working_dir = str(Path(cfg.working_dir).resolve())

            self._process = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=working_dir,
                env=env,
            )

            emitted_tool_calls: set[str] = set()
            emitted_tool_results: set[str] = set()
            session_emitted = False

            # Read by chunks instead of readline — no buffer limit issues
            # even when Claude Code outputs very long lines (base64 images, etc.)
            buf = b""
            stdout = self._process.stdout
            assert stdout is not None

            while True:
                chunk = await stdout.read(65536)
                if not chunk:
                    break
                buf += chunk

                # Process complete lines, keep partial last line in buf
                while b"\n" in buf:
                    line_bytes, buf = buf.split(b"\n", 1)
                    line_str = line_bytes.decode("utf-8", errors="replace").strip()
                    if not line_str:
                        continue
                    try:
                        data = json.loads(line_str)
                    except json.JSONDecodeError:
                        continue

                    # --- Dispatch by message type ---
                    msg_type = data.get("type")

                    if msg_type == "system" and data.get("subtype") == "init":
                        actual_sid = data.get("session_id", sid)
                        if not session_emitted:
                            yield {"event": "session", "data": {"session_id": actual_sid}}
                            session_emitted = True

                    elif msg_type == "stream_event":
                        evt = data.get("event", {})
                        if evt.get("type") == "content_block_delta":
                            delta = evt.get("delta", {})
                            delta_type = delta.get("type")
                            if delta_type == "text_delta" and delta.get("text"):
                                yield {"event": "text", "data": {"content": delta["text"]}}
                            elif delta_type == "thinking_delta" and delta.get("thinking"):
                                yield {"event": "thinking", "data": {"content": delta["thinking"]}}

                    elif msg_type == "assistant":
                        for block in data.get("message", {}).get("content", []):
                            if block.get("type") == "tool_use":
                                tc_id = block.get("id", "")
                                if tc_id and tc_id not in emitted_tool_calls:
                                    emitted_tool_calls.add(tc_id)
                                    yield {
                                        "event": "tool_call",
                                        "data": {
                                            "id": tc_id,
                                            "name": block.get("name", ""),
                                            "arguments": block.get("input", {}),
                                        },
                                    }

                    elif msg_type == "user":
                        content = data.get("message", {}).get("content", [])
                        if isinstance(content, list):
                            for block in content:
                                if block.get("type") == "tool_result":
                                    tr_id = block.get("tool_use_id", "")
                                    if tr_id and tr_id not in emitted_tool_results:
                                        emitted_tool_results.add(tr_id)
                                        result_text = _extract_tool_result_text(block)
                                        # Truncate large results (base64 images, huge outputs)
                                        if len(result_text) > _MAX_RESULT_LEN:
                                            result_text = result_text[:500] + f"\n... (truncated, {len(result_text)} chars total)"
                                        yield {
                                            "event": "tool_result",
                                            "data": {
                                                "id": tr_id,
                                                "name": "",
                                                "result": result_text,
                                                "is_error": block.get("is_error", False),
                                            },
                                        }

                    elif msg_type == "result":
                        if data.get("is_error"):
                            yield {"event": "error", "data": {"message": data.get("result", "Unknown error")}}
                        else:
                            # Extract token usage for context display
                            usage = data.get("usage", {})
                            model_usage = data.get("modelUsage", {})
                            first_model = next(iter(model_usage.values()), {}) if model_usage else {}
                            yield {
                                "event": "done",
                                "data": {
                                    "cost": data.get("total_cost_usd"),
                                    "duration_ms": data.get("duration_ms"),
                                    "num_turns": data.get("num_turns"),
                                    "input_tokens": usage.get("input_tokens", 0)
                                        + usage.get("cache_read_input_tokens", 0)
                                        + usage.get("cache_creation_input_tokens", 0),
                                    "output_tokens": usage.get("output_tokens", 0),
                                    "context_window": first_model.get("contextWindow"),
                                },
                            }

            await self._process.wait()

            stderr = await self._process.stderr.read()  # type: ignore[union-attr]
            if stderr and self._process.returncode != 0:
                err_msg = stderr.decode("utf-8", errors="replace").strip()[:500]
                if not session_emitted:
                    yield {"event": "session", "data": {"session_id": sid}}
                yield {"event": "error", "data": {"message": err_msg}}

        except asyncio.CancelledError:
            await self.cancel()
            raise
        except Exception as e:
            yield {"event": "error", "data": {"message": str(e)}}

    async def cancel(self) -> None:
        """Terminate the claude subprocess."""
        if self._process and self._process.returncode is None:
            try:
                self._process.terminate()
                await asyncio.wait_for(self._process.wait(), timeout=5)
            except (ProcessLookupError, asyncio.TimeoutError):
                try:
                    self._process.kill()
                except ProcessLookupError:
                    pass


def _extract_tool_result_text(block: dict) -> str:
    """Extract text content from a tool_result block."""
    raw = block.get("content", "")
    if isinstance(raw, list):
        parts = [
            c.get("text", "")
            for c in raw
            if isinstance(c, dict) and c.get("type") == "text"
        ]
        return "\n".join(parts)
    return str(raw)


def _build_command(
    prompt: str,
    session_id: str,
    config: AgentConfig,
    resume: bool = False,
) -> list[str]:
    """Build the claude CLI command."""
    cmd = [
        "claude",
        "-p", prompt,
        "--output-format", "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--max-turns", str(config.max_turns),
        "--permission-mode", config.permission_mode,
    ]

    if resume:
        cmd.extend(["--resume", session_id])
    else:
        cmd.extend(["--session-id", session_id])
        if config.system_prompt:
            cmd.extend(["--system-prompt", config.system_prompt])

    if config.append_system_prompt:
        cmd.extend(["--append-system-prompt", config.append_system_prompt])

    return cmd
