"""Pydantic models for claude-code-server."""

from __future__ import annotations

from typing import Any

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
    password: str = "yao"


class ChatRequest(BaseModel):
    """Incoming chat request."""

    prompt: str
    session_id: str | None = None
    system_prompt: str | None = None
    append_system_prompt: str | None = None


class LoginRequest(BaseModel):
    password: str


class SessionMetadata(BaseModel):
    """Persisted session metadata returned by /api/sessions."""

    id: str
    title: str
    working_dir: str
    owner_id: str | None = None
    created_at: float
    last_active_at: float
    message_count: int
    total_input_tokens: int
    total_output_tokens: int
    total_cost_usd: float


class SessionListResponse(BaseModel):
    sessions: list[SessionMetadata]
    total: int


class UpdateSessionRequest(BaseModel):
    title: str | None = None


class MessageRecord(BaseModel):
    """One persisted message in a session."""

    id: int
    seq: int
    role: str
    content: list[dict[str, Any]]
    is_partial: bool
    created_at: float


class MessagesResponse(BaseModel):
    session_id: str
    messages: list[MessageRecord]
