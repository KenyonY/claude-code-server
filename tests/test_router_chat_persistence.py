"""End-to-end tests for /api/chat persistence behavior.

The real ClaudeAgent is replaced with a fake that yields a synthetic SSE
event sequence, so we can assert exactly how the router accumulates blocks
and writes them to the SessionStore.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import AsyncIterator, Iterable

import anyio
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from claude_code_server import router as router_module
from claude_code_server.models import AgentConfig, ChatRequest
from claude_code_server.router import create_router
from claude_code_server.store import SessionStore


# ----- fake agent ------------------------------------------------------------


class FakeAgent:
    """Stand-in for ClaudeAgent that replays a fixed event script."""

    script: list[dict] = []
    last_kwargs: dict = {}
    cancel_called: bool = False

    def __init__(self) -> None:
        FakeAgent.cancel_called = False

    async def chat(self, **kwargs) -> AsyncIterator[dict]:
        FakeAgent.last_kwargs = kwargs
        for evt in FakeAgent.script:
            yield evt

    async def cancel(self) -> None:
        FakeAgent.cancel_called = True


@pytest.fixture(autouse=True)
def patch_agent(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(router_module, "ClaudeAgent", FakeAgent)
    FakeAgent.script = []
    FakeAgent.last_kwargs = {}
    FakeAgent.cancel_called = False


# ----- fixtures --------------------------------------------------------------


@pytest.fixture
def store(tmp_path: Path) -> SessionStore:
    return SessionStore(tmp_path / "chat.db")


@pytest.fixture
def client(store: SessionStore, tmp_path: Path) -> TestClient:
    config = AgentConfig(working_dir=str(tmp_path), password="pw")
    app = FastAPI()
    app.include_router(create_router(config=config, store=store), prefix="/api")
    return TestClient(app)


@pytest.fixture
def auth(client: TestClient) -> dict[str, str]:
    token = client.post("/api/login", json={"password": "pw"}).json()["token"]
    return {"Authorization": f"Bearer {token}"}


# ----- helpers ---------------------------------------------------------------


def _consume_sse(resp) -> list[tuple[str, dict]]:
    """Parse an SSE response body into a list of (event, data) pairs."""
    events: list[tuple[str, dict]] = []
    cur_event: str | None = None
    for raw_line in resp.iter_lines():
        line = raw_line if isinstance(raw_line, str) else raw_line.decode("utf-8")
        if not line:
            cur_event = None
            continue
        if line.startswith("event: "):
            cur_event = line[len("event: "):]
        elif line.startswith("data: ") and cur_event:
            events.append((cur_event, json.loads(line[len("data: "):])))
    return events


def _script(events: Iterable[tuple[str, dict]]) -> list[dict]:
    return [{"event": e, "data": d} for e, d in events]


# ----- tests -----------------------------------------------------------------


def test_chat_persists_user_and_assistant_with_merged_text(
    client: TestClient,
    auth: dict[str, str],
    store: SessionStore,
) -> None:
    """Two consecutive text deltas merge into one block."""
    FakeAgent.script = _script([
        ("session", {"session_id": "sid-1"}),
        ("text", {"content": "Hello "}),
        ("text", {"content": "world"}),
        ("done", {
            "cost": 0.0125,
            "duration_ms": 1234,
            "num_turns": 1,
            "input_tokens": 100,
            "output_tokens": 50,
            "context_window": 200000,
        }),
    ])

    resp = client.post(
        "/api/chat",
        json={"prompt": "say hi", "session_id": "sid-1"},
        headers=auth,
    )
    assert resp.status_code == 200
    events = _consume_sse(resp)
    assert [e for e, _ in events] == ["session", "text", "text", "done"]

    # FakeAgent received the right context
    assert FakeAgent.last_kwargs["session_id"] == "sid-1"
    assert FakeAgent.last_kwargs["is_new"] is True
    assert FakeAgent.last_kwargs["prompt"] == "say hi"

    # Session row created with prompt as title
    import asyncio
    s = asyncio.run(store.get_session("sid-1"))
    assert s is not None
    assert s["title"] == "say hi"
    assert s["message_count"] == 2
    assert s["total_input_tokens"] == 100
    assert s["total_output_tokens"] == 50
    assert s["total_cost_usd"] == pytest.approx(0.0125)

    msgs = asyncio.run(store.list_messages("sid-1"))
    assert len(msgs) == 2

    user_msg = msgs[0]
    assert user_msg["role"] == "user"
    assert user_msg["content"] == [{"type": "text", "text": "say hi"}]
    assert user_msg["is_partial"] is False

    asst_msg = msgs[1]
    assert asst_msg["role"] == "assistant"
    assert asst_msg["is_partial"] is False
    # Two text deltas merged into one block
    assert asst_msg["content"] == [{"type": "text", "text": "Hello world"}]


def test_chat_thinking_and_tool_blocks(
    client: TestClient,
    auth: dict[str, str],
    store: SessionStore,
) -> None:
    """thinking deltas merge; tool_use/tool_result append fresh blocks."""
    FakeAgent.script = _script([
        ("session", {"session_id": "sid-2"}),
        ("thinking", {"content": "let me "}),
        ("thinking", {"content": "think..."}),
        ("text", {"content": "I'll read the file."}),
        ("tool_call", {"id": "tu_1", "name": "Read", "arguments": {"path": "/x"}}),
        ("tool_result", {"id": "tu_1", "name": "", "result": "file content", "is_error": False}),
        ("text", {"content": "Done."}),
        ("done", {"input_tokens": 10, "output_tokens": 5, "cost": 0.001}),
    ])

    resp = client.post(
        "/api/chat",
        json={"prompt": "read /x", "session_id": "sid-2"},
        headers=auth,
    )
    assert resp.status_code == 200
    _consume_sse(resp)

    import asyncio
    msgs = asyncio.run(store.list_messages("sid-2"))
    asst_blocks = msgs[1]["content"]
    assert asst_blocks == [
        {"type": "thinking", "text": "let me think..."},
        {"type": "text", "text": "I'll read the file."},
        {
            "type": "tool_use",
            "id": "tu_1",
            "name": "Read",
            "input": {"path": "/x"},
        },
        {
            "type": "tool_result",
            "tool_use_id": "tu_1",
            "content": "file content",
            "is_error": False,
        },
        {"type": "text", "text": "Done."},
    ]


def test_chat_creates_session_when_id_missing(
    client: TestClient,
    auth: dict[str, str],
    store: SessionStore,
) -> None:
    FakeAgent.script = _script([
        ("session", {"session_id": "ignored"}),
        ("text", {"content": "ok"}),
        ("done", {"input_tokens": 1, "output_tokens": 1, "cost": 0}),
    ])

    resp = client.post(
        "/api/chat",
        json={"prompt": "first message that is fairly long " * 3},
        headers=auth,
    )
    assert resp.status_code == 200
    _consume_sse(resp)

    # Router generated a sid and used it for the agent
    sid = FakeAgent.last_kwargs["session_id"]
    assert FakeAgent.last_kwargs["is_new"] is True

    import asyncio
    s = asyncio.run(store.get_session(sid))
    assert s is not None
    # Title truncated to 50 chars
    assert len(s["title"]) <= 50
    assert s["title"].startswith("first message")
    assert s["message_count"] == 2


def test_chat_resume_existing_session_marks_is_new_false(
    client: TestClient,
    auth: dict[str, str],
    store: SessionStore,
) -> None:
    import asyncio

    asyncio.run(store.create_session("sid-3", "Existing", "/proj"))

    FakeAgent.script = _script([
        ("session", {"session_id": "sid-3"}),
        ("text", {"content": "follow-up"}),
        ("done", {"input_tokens": 5, "output_tokens": 2, "cost": 0}),
    ])

    resp = client.post(
        "/api/chat",
        json={"prompt": "follow up", "session_id": "sid-3"},
        headers=auth,
    )
    assert resp.status_code == 200
    _consume_sse(resp)

    assert FakeAgent.last_kwargs["is_new"] is False
    assert FakeAgent.last_kwargs["session_id"] == "sid-3"

    msgs = asyncio.run(store.list_messages("sid-3"))
    # One user + one assistant (not 2 user msgs — title was set at create)
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"
    assert msgs[1]["content"] == [{"type": "text", "text": "follow-up"}]
    # Title was NOT overwritten
    s = asyncio.run(store.get_session("sid-3"))
    assert s["title"] == "Existing"


def test_chat_works_without_store(tmp_path: Path) -> None:
    """store=None falls back to streaming-only behavior, no persistence errors."""
    config = AgentConfig(working_dir=str(tmp_path), password="pw")
    app = FastAPI()
    app.include_router(create_router(config=config, store=None), prefix="/api")
    no_store_client = TestClient(app)

    token = no_store_client.post("/api/login", json={"password": "pw"}).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    FakeAgent.script = _script([
        ("session", {"session_id": "x"}),
        ("text", {"content": "hi"}),
        ("done", {"input_tokens": 1, "output_tokens": 1, "cost": 0}),
    ])

    resp = no_store_client.post(
        "/api/chat", json={"prompt": "hi"}, headers=headers
    )
    assert resp.status_code == 200
    events = _consume_sse(resp)
    assert any(e == "text" for e, _ in events)


@pytest.mark.asyncio
async def test_chat_cancel_persists_partial_assistant(
    store: SessionStore,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Cancellation mid-stream must persist accumulated blocks as is_partial=1.

    Regression test for the D9 bug where the CancelledError handler's
    `await store.append_message(...)` was itself cancelled before the
    SQLite commit landed, silently dropping the partial reply. Fix is the
    `asyncio.shield()` wrap around `_flush_assistant(is_partial=True)`.
    """

    class HangingAgent:
        cancel_called: bool = False

        def __init__(self) -> None:
            HangingAgent.cancel_called = False

        async def chat(self, **kwargs) -> AsyncIterator[dict]:
            yield {"event": "session", "data": {"session_id": kwargs["session_id"]}}
            yield {"event": "text", "data": {"content": "partial "}}
            yield {"event": "text", "data": {"content": "reply"}}
            # Simulate a long-running generation that gets cancelled.
            await asyncio.sleep(60)
            yield {"event": "done", "data": {"input_tokens": 1, "output_tokens": 1, "cost": 0}}

        async def cancel(self) -> None:
            HangingAgent.cancel_called = True

    monkeypatch.setattr(router_module, "ClaudeAgent", HangingAgent)

    config = AgentConfig(working_dir=str(tmp_path), password="pw")
    router = create_router(config=config, store=store)

    # Pull the chat endpoint function out of the router. We call it directly
    # so we can capture the StreamingResponse and own the body iterator —
    # FastAPI's TestClient is sync and httpx ASGITransport doesn't surface
    # client disconnects, so neither can drive a real CancelledError.
    chat_endpoint = next(
        (r.endpoint for r in router.routes if getattr(r, "path", None) == "/chat"),
        None,
    )
    assert chat_endpoint is not None, "chat endpoint not found on router"

    req = ChatRequest(prompt="long task", session_id="sid-cancel")
    resp = await chat_endpoint(req, _=None)  # _require_auth dep bypassed

    chunks: list[str] = []

    async def _drain() -> None:
        async for chunk in resp.body_iterator:
            chunks.append(chunk if isinstance(chunk, str) else chunk.decode("utf-8"))

    # Reproduce starlette/uvicorn's sticky cancellation: an anyio cancel
    # scope, when cancelled, makes EVERY subsequent await inside the scope
    # raise CancelledError until control leaves the scope. That's the
    # condition the unshielded flush failed under in real uvicorn runs;
    # asyncio.Task.cancel() alone doesn't trigger it.
    with anyio.move_on_after(3.0) as outer:
        async with anyio.create_task_group() as tg:
            tg.start_soon(_drain)
            while sum(c.count("event: text") for c in chunks) < 2:
                await anyio.sleep(0.005)
            tg.cancel_scope.cancel()
    assert not outer.cancelled_caught, "drain timed out before producing 2 text events"

    assert HangingAgent.cancel_called, "agent.cancel() should have run"

    s = await store.get_session("sid-cancel")
    assert s is not None
    msgs = await store.list_messages("sid-cancel")
    assert len(msgs) == 2, f"expected user + partial assistant, got {len(msgs)}"

    user_msg, asst_msg = msgs
    assert user_msg["role"] == "user"
    assert user_msg["is_partial"] is False

    assert asst_msg["role"] == "assistant"
    assert asst_msg["is_partial"] is True
    # Both deltas should be merged into a single text block.
    assert asst_msg["content"] == [{"type": "text", "text": "partial reply"}]


def test_chat_stats_accumulate_across_turns(
    client: TestClient,
    auth: dict[str, str],
    store: SessionStore,
) -> None:
    import asyncio

    # Turn 1
    FakeAgent.script = _script([
        ("session", {"session_id": "sid-acc"}),
        ("text", {"content": "a"}),
        ("done", {"input_tokens": 100, "output_tokens": 20, "cost": 0.01}),
    ])
    client.post(
        "/api/chat",
        json={"prompt": "p1", "session_id": "sid-acc"},
        headers=auth,
    )

    # Turn 2
    FakeAgent.script = _script([
        ("session", {"session_id": "sid-acc"}),
        ("text", {"content": "b"}),
        ("done", {"input_tokens": 200, "output_tokens": 30, "cost": 0.02}),
    ])
    client.post(
        "/api/chat",
        json={"prompt": "p2", "session_id": "sid-acc"},
        headers=auth,
    )

    s = asyncio.run(store.get_session("sid-acc"))
    assert s is not None
    assert s["total_input_tokens"] == 300
    assert s["total_output_tokens"] == 50
    assert s["total_cost_usd"] == pytest.approx(0.03)
    assert s["message_count"] == 4  # 2 user + 2 assistant
