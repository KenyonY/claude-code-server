"""Unit tests for SessionStore."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from claude_code_server.store import SessionStore


@pytest.fixture
def store(tmp_path: Path) -> SessionStore:
    return SessionStore(tmp_path / "test.db")


@pytest.mark.asyncio
async def test_create_and_get_session(store: SessionStore) -> None:
    s = await store.create_session("sid-1", "Hello", "/tmp/proj")
    assert s["id"] == "sid-1"
    assert s["title"] == "Hello"
    assert s["working_dir"] == "/tmp/proj"
    assert s["message_count"] == 0
    assert s["total_input_tokens"] == 0
    assert s["total_output_tokens"] == 0
    assert s["total_cost_usd"] == 0.0
    assert s["deleted_at"] is None
    assert s["owner_id"] is None
    assert s["created_at"] > 0
    assert s["last_active_at"] == s["created_at"]

    fetched = await store.get_session("sid-1")
    assert fetched == s


@pytest.mark.asyncio
async def test_get_nonexistent_returns_none(store: SessionStore) -> None:
    assert await store.get_session("nope") is None


@pytest.mark.asyncio
async def test_list_sessions_orders_by_active_desc(store: SessionStore) -> None:
    await store.create_session("a", "A", "/")
    await asyncio.sleep(0.01)
    await store.create_session("b", "B", "/")
    await asyncio.sleep(0.01)
    await store.create_session("c", "C", "/")

    sessions, total = await store.list_sessions()
    assert total == 3
    assert [s["id"] for s in sessions] == ["c", "b", "a"]


@pytest.mark.asyncio
async def test_list_sessions_pagination(store: SessionStore) -> None:
    for i in range(5):
        await store.create_session(f"s-{i}", f"S{i}", "/")
        await asyncio.sleep(0.001)

    page1, total1 = await store.list_sessions(limit=2, offset=0)
    page2, total2 = await store.list_sessions(limit=2, offset=2)
    page3, total3 = await store.list_sessions(limit=2, offset=4)

    assert total1 == total2 == total3 == 5
    assert len(page1) == 2
    assert len(page2) == 2
    assert len(page3) == 1
    assert {s["id"] for s in page1 + page2 + page3} == {f"s-{i}" for i in range(5)}


@pytest.mark.asyncio
async def test_update_session_title(store: SessionStore) -> None:
    await store.create_session("sid", "Old", "/")
    updated = await store.update_session("sid", title="New")
    assert updated is not None
    assert updated["title"] == "New"

    fetched = await store.get_session("sid")
    assert fetched is not None
    assert fetched["title"] == "New"


@pytest.mark.asyncio
async def test_update_session_noop_when_title_none(store: SessionStore) -> None:
    await store.create_session("sid", "Original", "/")
    result = await store.update_session("sid", title=None)
    assert result is not None
    assert result["title"] == "Original"


@pytest.mark.asyncio
async def test_delete_session_soft(store: SessionStore) -> None:
    await store.create_session("sid", "T", "/")

    deleted = await store.delete_session("sid")
    assert deleted is True

    assert await store.get_session("sid") is None
    sessions, total = await store.list_sessions()
    assert sessions == []
    assert total == 0


@pytest.mark.asyncio
async def test_delete_nonexistent_returns_false(store: SessionStore) -> None:
    assert await store.delete_session("nope") is False


@pytest.mark.asyncio
async def test_double_delete_returns_false_second_time(store: SessionStore) -> None:
    await store.create_session("sid", "T", "/")
    assert await store.delete_session("sid") is True
    assert await store.delete_session("sid") is False


@pytest.mark.asyncio
async def test_update_session_stats_accumulates(store: SessionStore) -> None:
    await store.create_session("sid", "T", "/")

    await store.update_session_stats(
        "sid", input_tokens=100, output_tokens=50, cost=0.01
    )
    s = await store.get_session("sid")
    assert s is not None
    assert s["total_input_tokens"] == 100
    assert s["total_output_tokens"] == 50
    assert s["total_cost_usd"] == pytest.approx(0.01)

    await store.update_session_stats(
        "sid", input_tokens=200, output_tokens=100, cost=0.02
    )
    s = await store.get_session("sid")
    assert s is not None
    assert s["total_input_tokens"] == 300
    assert s["total_output_tokens"] == 150
    assert s["total_cost_usd"] == pytest.approx(0.03)


@pytest.mark.asyncio
async def test_update_stats_advances_last_active(store: SessionStore) -> None:
    s0 = await store.create_session("sid", "T", "/")
    await asyncio.sleep(0.01)
    await store.update_session_stats("sid", input_tokens=1, output_tokens=1, cost=0)
    s1 = await store.get_session("sid")
    assert s1 is not None
    assert s1["last_active_at"] > s0["last_active_at"]


@pytest.mark.asyncio
async def test_append_message_assigns_seq_per_session(store: SessionStore) -> None:
    await store.create_session("sid", "T", "/")

    m1 = await store.append_message(
        "sid", role="user", content=[{"type": "text", "text": "hi"}]
    )
    m2 = await store.append_message(
        "sid", role="assistant", content=[{"type": "text", "text": "yo"}]
    )
    m3 = await store.append_message(
        "sid", role="user", content=[{"type": "text", "text": "what's up"}]
    )

    assert m1["seq"] == 0
    assert m2["seq"] == 1
    assert m3["seq"] == 2


@pytest.mark.asyncio
async def test_append_message_increments_session_message_count(
    store: SessionStore,
) -> None:
    await store.create_session("sid", "T", "/")

    await store.append_message(
        "sid", role="user", content=[{"type": "text", "text": "1"}]
    )
    await store.append_message(
        "sid", role="assistant", content=[{"type": "text", "text": "2"}]
    )

    s = await store.get_session("sid")
    assert s is not None
    assert s["message_count"] == 2


@pytest.mark.asyncio
async def test_list_messages_returns_in_seq_order(store: SessionStore) -> None:
    await store.create_session("sid", "T", "/")

    blocks = [
        {"type": "thinking", "text": "let me think"},
        {"type": "text", "text": "answer"},
        {"type": "tool_use", "id": "t1", "name": "Read", "input": {"path": "/x"}},
        {"type": "tool_result", "tool_use_id": "t1", "content": "ok", "is_error": False},
    ]
    await store.append_message(
        "sid", role="user", content=[{"type": "text", "text": "q"}]
    )
    await store.append_message("sid", role="assistant", content=blocks)

    msgs = await store.list_messages("sid")
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"
    assert msgs[0]["seq"] == 0
    assert msgs[1]["role"] == "assistant"
    assert msgs[1]["seq"] == 1
    assert msgs[1]["content"] == blocks
    assert msgs[1]["is_partial"] is False


@pytest.mark.asyncio
async def test_partial_message_flag(store: SessionStore) -> None:
    await store.create_session("sid", "T", "/")

    await store.append_message(
        "sid",
        role="assistant",
        content=[{"type": "text", "text": "partial"}],
        is_partial=True,
    )

    msgs = await store.list_messages("sid")
    assert msgs[0]["is_partial"] is True


@pytest.mark.asyncio
async def test_session_message_isolation(store: SessionStore) -> None:
    await store.create_session("a", "A", "/")
    await store.create_session("b", "B", "/")

    await store.append_message(
        "a", role="user", content=[{"type": "text", "text": "msg-a"}]
    )
    await store.append_message(
        "b", role="user", content=[{"type": "text", "text": "msg-b"}]
    )

    msgs_a = await store.list_messages("a")
    msgs_b = await store.list_messages("b")
    assert len(msgs_a) == 1
    assert len(msgs_b) == 1
    assert msgs_a[0]["content"][0]["text"] == "msg-a"
    assert msgs_b[0]["content"][0]["text"] == "msg-b"

    s_a = await store.get_session("a")
    s_b = await store.get_session("b")
    assert s_a is not None and s_a["message_count"] == 1
    assert s_b is not None and s_b["message_count"] == 1


@pytest.mark.asyncio
async def test_owner_filter(store: SessionStore) -> None:
    await store.create_session("a", "A", "/", owner_id="alice")
    await store.create_session("b", "B", "/", owner_id="bob")
    await store.create_session("c", "C", "/", owner_id="alice")

    alice_sessions, total = await store.list_sessions(owner_id="alice")
    assert total == 2
    assert {s["id"] for s in alice_sessions} == {"a", "c"}

    all_sessions, all_total = await store.list_sessions()
    assert all_total == 3


@pytest.mark.asyncio
async def test_unicode_content_round_trip(store: SessionStore) -> None:
    await store.create_session("sid", "测试", "/")
    blocks = [{"type": "text", "text": "你好，世界 🌏"}]
    await store.append_message("sid", role="user", content=blocks)

    msgs = await store.list_messages("sid")
    assert msgs[0]["content"] == blocks


@pytest.mark.asyncio
async def test_db_persists_across_store_instances(tmp_path: Path) -> None:
    db_path = tmp_path / "persist.db"

    store1 = SessionStore(db_path)
    await store1.create_session("sid", "Persistent", "/proj")
    await store1.append_message(
        "sid", role="user", content=[{"type": "text", "text": "hi"}]
    )

    store2 = SessionStore(db_path)
    s = await store2.get_session("sid")
    assert s is not None
    assert s["title"] == "Persistent"
    msgs = await store2.list_messages("sid")
    assert len(msgs) == 1
    assert msgs[0]["content"][0]["text"] == "hi"
