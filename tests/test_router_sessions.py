"""Integration tests for /api/sessions endpoints."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from claude_code_server.models import AgentConfig
from claude_code_server.router import create_router
from claude_code_server.store import SessionStore


@pytest.fixture
def store(tmp_path: Path) -> SessionStore:
    return SessionStore(tmp_path / "sessions.db")


@pytest.fixture
def client(store: SessionStore, tmp_path: Path) -> TestClient:
    config = AgentConfig(working_dir=str(tmp_path), password="test-pw")
    app = FastAPI()
    app.include_router(create_router(config=config, store=store), prefix="/api")
    return TestClient(app)


@pytest.fixture
def auth_headers(client: TestClient) -> dict[str, str]:
    resp = client.post("/api/login", json={"password": "test-pw"})
    assert resp.status_code == 200
    return {"Authorization": f"Bearer {resp.json()['token']}"}


# ----- auth ------------------------------------------------------------------


def test_sessions_endpoints_require_auth(client: TestClient) -> None:
    assert client.get("/api/sessions").status_code == 401
    assert client.get("/api/sessions/x").status_code == 401
    assert client.patch("/api/sessions/x", json={"title": "y"}).status_code == 401
    assert client.delete("/api/sessions/x").status_code == 401
    assert client.get("/api/sessions/x/messages").status_code == 401


# ----- list ------------------------------------------------------------------


def test_list_empty(client: TestClient, auth_headers: dict[str, str]) -> None:
    resp = client.get("/api/sessions", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"sessions": [], "total": 0}


def test_list_after_create(
    client: TestClient,
    auth_headers: dict[str, str],
    store: SessionStore,
) -> None:
    import asyncio

    async def setup():
        await store.create_session("a", "Alpha", "/proj")
        await asyncio.sleep(0.01)
        await store.create_session("b", "Bravo", "/proj")

    asyncio.run(setup())

    resp = client.get("/api/sessions", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    assert [s["id"] for s in body["sessions"]] == ["b", "a"]
    assert body["sessions"][0]["title"] == "Bravo"
    assert body["sessions"][0]["message_count"] == 0


def test_list_pagination(
    client: TestClient,
    auth_headers: dict[str, str],
    store: SessionStore,
) -> None:
    import asyncio

    async def setup():
        for i in range(5):
            await store.create_session(f"s{i}", f"S{i}", "/")
            await asyncio.sleep(0.001)

    asyncio.run(setup())

    resp = client.get("/api/sessions?limit=2&offset=0", headers=auth_headers)
    assert resp.json()["total"] == 5
    assert len(resp.json()["sessions"]) == 2

    resp = client.get("/api/sessions?limit=2&offset=4", headers=auth_headers)
    assert len(resp.json()["sessions"]) == 1


# ----- get -------------------------------------------------------------------


def test_get_existing(
    client: TestClient,
    auth_headers: dict[str, str],
    store: SessionStore,
) -> None:
    import asyncio

    asyncio.run(store.create_session("sid-x", "Hello", "/proj"))

    resp = client.get("/api/sessions/sid-x", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == "sid-x"
    assert body["title"] == "Hello"
    assert body["working_dir"] == "/proj"


def test_get_404(client: TestClient, auth_headers: dict[str, str]) -> None:
    resp = client.get("/api/sessions/missing", headers=auth_headers)
    assert resp.status_code == 404


# ----- patch (rename) --------------------------------------------------------


def test_patch_rename(
    client: TestClient,
    auth_headers: dict[str, str],
    store: SessionStore,
) -> None:
    import asyncio

    asyncio.run(store.create_session("sid", "Old", "/"))

    resp = client.patch(
        "/api/sessions/sid", json={"title": "New title"}, headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json()["title"] == "New title"

    # Verify persisted
    resp = client.get("/api/sessions/sid", headers=auth_headers)
    assert resp.json()["title"] == "New title"


def test_patch_empty_title_rejected(
    client: TestClient,
    auth_headers: dict[str, str],
    store: SessionStore,
) -> None:
    import asyncio

    asyncio.run(store.create_session("sid", "Old", "/"))

    resp = client.patch(
        "/api/sessions/sid", json={"title": "   "}, headers=auth_headers
    )
    assert resp.status_code == 400


def test_patch_404(client: TestClient, auth_headers: dict[str, str]) -> None:
    resp = client.patch(
        "/api/sessions/nope", json={"title": "x"}, headers=auth_headers
    )
    assert resp.status_code == 404


# ----- delete ----------------------------------------------------------------


def test_delete_soft(
    client: TestClient,
    auth_headers: dict[str, str],
    store: SessionStore,
) -> None:
    import asyncio

    asyncio.run(store.create_session("sid", "T", "/"))

    resp = client.delete("/api/sessions/sid", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}

    # No longer visible
    assert client.get("/api/sessions/sid", headers=auth_headers).status_code == 404
    assert client.get("/api/sessions", headers=auth_headers).json()["total"] == 0


def test_delete_404(client: TestClient, auth_headers: dict[str, str]) -> None:
    resp = client.delete("/api/sessions/missing", headers=auth_headers)
    assert resp.status_code == 404


# ----- messages --------------------------------------------------------------


def test_list_messages_empty(
    client: TestClient,
    auth_headers: dict[str, str],
    store: SessionStore,
) -> None:
    import asyncio

    asyncio.run(store.create_session("sid", "T", "/"))

    resp = client.get("/api/sessions/sid/messages", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"session_id": "sid", "messages": []}


def test_list_messages_with_content(
    client: TestClient,
    auth_headers: dict[str, str],
    store: SessionStore,
) -> None:
    import asyncio

    async def setup():
        await store.create_session("sid", "T", "/")
        await store.append_message(
            "sid", role="user", content=[{"type": "text", "text": "q"}]
        )
        await store.append_message(
            "sid",
            role="assistant",
            content=[
                {"type": "thinking", "text": "..."},
                {"type": "text", "text": "answer"},
            ],
        )

    asyncio.run(setup())

    resp = client.get("/api/sessions/sid/messages", headers=auth_headers)
    body = resp.json()
    assert body["session_id"] == "sid"
    assert len(body["messages"]) == 2
    assert body["messages"][0]["role"] == "user"
    assert body["messages"][0]["seq"] == 0
    assert body["messages"][1]["role"] == "assistant"
    assert body["messages"][1]["content"][1]["text"] == "answer"
    assert body["messages"][1]["is_partial"] is False


def test_list_messages_session_404(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    resp = client.get("/api/sessions/nope/messages", headers=auth_headers)
    assert resp.status_code == 404


# ----- store None falls back ------------------------------------------------


def test_sessions_503_when_no_store(tmp_path: Path) -> None:
    config = AgentConfig(working_dir=str(tmp_path), password="test-pw")
    app = FastAPI()
    app.include_router(create_router(config=config, store=None), prefix="/api")
    client = TestClient(app)

    token = client.post("/api/login", json={"password": "test-pw"}).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    resp = client.get("/api/sessions", headers=headers)
    assert resp.status_code == 503
