"""Pydantic models for claude-code-server."""

from __future__ import annotations

from pydantic import BaseModel


class AgentConfig(BaseModel):
    """Configuration for the Claude Code agent.

    working_dir: Directory where claude CLI runs (picks up CLAUDE.md automatically)
    system_prompt: Override CC's default system prompt (replaces entirely, loses built-in tool definitions)
    append_system_prompt: Append to CC's default system prompt (keeps tools/rules, adds custom instructions)
    max_turns: Maximum agent turns per request
    permission_mode: Claude Code permission mode
    env: Extra environment variables passed to the claude subprocess
    """

    working_dir: str = "."
    system_prompt: str | None = None
    append_system_prompt: str | None = None
    max_turns: int = 20
    permission_mode: str = "bypassPermissions"
    env: dict[str, str] | None = None


class ChatRequest(BaseModel):
    """Incoming chat request."""

    prompt: str
    session_id: str | None = None
    system_prompt: str | None = None
    append_system_prompt: str | None = None
