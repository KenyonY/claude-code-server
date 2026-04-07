"""FastAPI router factory for claude-code-server.

Usage:
    # Static config
    router = create_router(AgentConfig(working_dir="/my/project"))
    app.include_router(router, prefix="/agent")

    # Dynamic config per request
    router = create_router(config_factory=lambda req: AgentConfig(...))
    app.include_router(router, prefix="/agent")
"""

from __future__ import annotations

import asyncio
import io
import json
import uuid
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, UploadFile, File, Request, HTTPException, Depends
from fastapi.responses import StreamingResponse

from .agent import ClaudeAgent
from .models import (
    AgentConfig,
    ChatRequest,
    LoginRequest,
    MessagesResponse,
    SessionListResponse,
    SessionMetadata,
    UpdateSessionRequest,
)
from .store import SessionStore

# Default config
_DEFAULT_CONFIG = AgentConfig()


def create_router(
    config: AgentConfig | None = None,
    config_factory: Callable[[ChatRequest], AgentConfig] | None = None,
    upload_dir: str | None = None,
    store: SessionStore | None = None,
) -> APIRouter:
    """Create a FastAPI router with /chat, /upload, and /sessions endpoints.

    Args:
        config: Static config used for all requests.
        config_factory: Dynamic config factory — called per request with ChatRequest.
                       Takes precedence over static config.
        upload_dir: Directory for uploaded files. Defaults to {working_dir}/storage/chat_uploads.
        store: Optional SessionStore for persistent sessions/messages.
               If None, /api/sessions endpoints return 503 and /api/chat skips persistence.
    """
    router = APIRouter()
    _tokens: set[str] = set()

    def _require_auth(request: Request) -> None:
        auth = request.headers.get("authorization", "")
        if auth.startswith("Bearer ") and auth[7:] in _tokens:
            return
        token = request.query_params.get("token", "")
        if token and token in _tokens:
            return
        raise HTTPException(status_code=401, detail="Unauthorized")

    @router.post("/login")
    async def login(req: LoginRequest):
        cfg = config or _DEFAULT_CONFIG
        if req.password != cfg.password:
            raise HTTPException(status_code=401, detail="Wrong password")
        token = uuid.uuid4().hex
        _tokens.add(token)
        return {"token": token}

    @router.get("/auth/check")
    async def auth_check(_: None = Depends(_require_auth)):
        return {"ok": True}

    def _get_config(req: ChatRequest) -> AgentConfig:
        if config_factory:
            return config_factory(req)
        return config or _DEFAULT_CONFIG

    def _get_upload_dir(cfg: AgentConfig) -> Path:
        if upload_dir:
            p = Path(upload_dir)
        else:
            p = Path(cfg.working_dir) / "storage" / "chat_uploads"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @router.post("/chat")
    async def chat(req: ChatRequest, _: None = Depends(_require_auth)):
        """SSE streaming chat endpoint."""
        cfg = _get_config(req)
        # Request-level system prompt overrides server config
        if req.system_prompt is not None or req.append_system_prompt is not None:
            overrides: dict = {}
            if req.system_prompt is not None:
                overrides["system_prompt"] = req.system_prompt
            if req.append_system_prompt is not None:
                overrides["append_system_prompt"] = req.append_system_prompt
            cfg = cfg.model_copy(update=overrides)

        # Decide session id and whether it's a fresh session.
        # When store is configured, we use it as the source of truth for "exists?".
        sid = req.session_id
        existing_session = None
        if store is not None and sid:
            existing_session = await store.get_session(sid)
        is_new_session = existing_session is None
        if sid is None:
            sid = str(uuid.uuid4())

        # Persist user message (and create session row if needed).
        # Failures here only log — they must not block the SSE stream.
        if store is not None:
            try:
                if is_new_session:
                    title = (req.prompt or "New Chat").strip()[:50] or "New Chat"
                    await store.create_session(
                        sid=sid, title=title, working_dir=cfg.working_dir
                    )
                await store.append_message(
                    sid,
                    role="user",
                    content=[{"type": "text", "text": req.prompt}],
                )
            except Exception as e:
                print(f"[ccs] store write failed (user message): {e}")

        agent = ClaudeAgent()
        blocks: list[dict] = []
        stats = {"input_tokens": 0, "output_tokens": 0, "cost": 0.0}

        async def _flush_assistant(is_partial: bool) -> None:
            if store is None or not blocks:
                return
            try:
                await store.append_message(
                    sid, role="assistant", content=blocks, is_partial=is_partial
                )
                await store.update_session_stats(sid, **stats)
            except Exception as e:
                print(f"[ccs] store write failed (assistant message): {e}")

        async def event_stream():
            try:
                async for event in agent.chat(
                    prompt=req.prompt,
                    session_id=sid,
                    config=cfg,
                    is_new=is_new_session,
                ):
                    evt_type = event["event"]
                    evt_data = event["data"]
                    _accumulate_event(blocks, stats, evt_type, evt_data)
                    yield f"event: {evt_type}\ndata: {json.dumps(evt_data, ensure_ascii=False)}\n\n"
                await _flush_assistant(is_partial=False)
            except asyncio.CancelledError:
                # Client disconnect. Starlette cancels via an anyio cancel
                # scope, which is sticky — every subsequent await in this
                # scope re-raises CancelledError. Without shielding, the
                # to_thread that drives SQLite gets cancelled before commit,
                # silently dropping the partial assistant message.
                await agent.cancel()
                await asyncio.shield(_flush_assistant(is_partial=True))
                raise

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    @router.post("/upload")
    async def upload_file(file: UploadFile = File(...), _: None = Depends(_require_auth)):
        """Upload a file, return server path + data preview."""
        cfg = config or _DEFAULT_CONFIG
        dest = _get_upload_dir(cfg)

        original_name = file.filename or "upload"
        filename = f"{uuid.uuid4().hex[:8]}_{original_name}"
        file_path = dest / filename

        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)

        result: dict = {
            "path": str(file_path),
            "filename": original_name,
            "size": len(content),
        }

        suffix = Path(original_name).suffix.lower()
        image_exts = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"}
        if suffix in image_exts:
            result["type"] = "image"
            result["url"] = f"/files/{filename}"
        else:
            try:
                result.update(_parse_preview(content, suffix))
            except Exception:
                pass

        return result

    @router.get("/files/{filename}")
    async def serve_file(filename: str, _: None = Depends(_require_auth)):
        """Serve uploaded files (images, etc.)."""
        from fastapi.responses import FileResponse

        cfg = config or _DEFAULT_CONFIG
        file_path = _get_upload_dir(cfg) / filename
        if not file_path.is_file():
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="File not found")
        return FileResponse(file_path)

    @router.get("/health")
    async def health():
        return {"status": "ok"}

    # ----- sessions ----------------------------------------------------------

    def _require_store() -> SessionStore:
        if store is None:
            raise HTTPException(
                status_code=503, detail="Session store not configured"
            )
        return store

    @router.get("/sessions", response_model=SessionListResponse)
    async def list_sessions(
        limit: int = 50,
        offset: int = 0,
        _: None = Depends(_require_auth),
    ):
        s = _require_store()
        rows, total = await s.list_sessions(limit=limit, offset=offset)
        return {"sessions": rows, "total": total}

    @router.get("/sessions/{session_id}", response_model=SessionMetadata)
    async def get_session(session_id: str, _: None = Depends(_require_auth)):
        s = _require_store()
        row = await s.get_session(session_id)
        if not row:
            raise HTTPException(status_code=404, detail="Session not found")
        return row

    @router.patch("/sessions/{session_id}", response_model=SessionMetadata)
    async def update_session(
        session_id: str,
        body: UpdateSessionRequest,
        _: None = Depends(_require_auth),
    ):
        s = _require_store()
        if body.title is not None and not body.title.strip():
            raise HTTPException(status_code=400, detail="title cannot be empty")
        updated = await s.update_session(session_id, title=body.title)
        if not updated:
            raise HTTPException(status_code=404, detail="Session not found")
        return updated

    @router.delete("/sessions/{session_id}")
    async def delete_session(session_id: str, _: None = Depends(_require_auth)):
        s = _require_store()
        ok = await s.delete_session(session_id)
        if not ok:
            raise HTTPException(status_code=404, detail="Session not found")
        return {"ok": True}

    @router.get("/sessions/{session_id}/messages", response_model=MessagesResponse)
    async def list_session_messages(
        session_id: str, _: None = Depends(_require_auth)
    ):
        s = _require_store()
        if not await s.get_session(session_id):
            raise HTTPException(status_code=404, detail="Session not found")
        msgs = await s.list_messages(session_id)
        return {"session_id": session_id, "messages": msgs}

    return router


def _accumulate_event(
    blocks: list[dict], stats: dict, evt: str, data: dict
) -> None:
    """Fold an SSE event into accumulated content blocks (Anthropic style).

    text/thinking deltas merge into the trailing block of the same type.
    tool_call/tool_result append a fresh block.
    done updates running token/cost stats.
    """
    if evt == "text":
        chunk = data.get("content", "")
        if not chunk:
            return
        if blocks and blocks[-1].get("type") == "text":
            blocks[-1]["text"] += chunk
        else:
            blocks.append({"type": "text", "text": chunk})
    elif evt == "thinking":
        chunk = data.get("content", "")
        if not chunk:
            return
        if blocks and blocks[-1].get("type") == "thinking":
            blocks[-1]["text"] += chunk
        else:
            blocks.append({"type": "thinking", "text": chunk})
    elif evt == "tool_call":
        blocks.append({
            "type": "tool_use",
            "id": data.get("id", ""),
            "name": data.get("name", ""),
            "input": data.get("arguments", {}),
        })
    elif evt == "tool_result":
        blocks.append({
            "type": "tool_result",
            "tool_use_id": data.get("id", ""),
            "content": data.get("result", ""),
            "is_error": bool(data.get("is_error", False)),
        })
    elif evt == "done":
        stats["input_tokens"] += int(data.get("input_tokens") or 0)
        stats["output_tokens"] += int(data.get("output_tokens") or 0)
        stats["cost"] += float(data.get("cost") or 0)


def _parse_preview(content: bytes, suffix: str) -> dict:
    """Parse the first few rows of a data file for preview."""
    result: dict = {}

    if suffix == ".jsonl":
        lines = content.decode("utf-8").strip().split("\n")
        rows = [json.loads(line) for line in lines[:5] if line.strip()]
        result["preview"] = rows
        result["total_lines"] = len(lines)

    elif suffix == ".csv":
        import pandas as pd

        df = pd.read_csv(io.BytesIO(content), nrows=5)
        total = content.count(b"\n")
        if content.endswith(b"\n"):
            total -= 1
        result["preview"] = df.to_dict("records")
        result["total_lines"] = total

    elif suffix in (".xlsx", ".xls"):
        import pandas as pd

        buf = io.BytesIO(content)
        df = pd.read_excel(buf, nrows=5)
        df = df.loc[:, ~df.columns.astype(str).str.startswith("Unnamed")]
        df = df.dropna(axis=1, how="all")
        result["preview"] = df.where(df.notna(), None).to_dict("records")
        buf.seek(0)
        result["total_lines"] = len(pd.read_excel(buf))

    elif suffix == ".json":
        data = json.loads(content.decode("utf-8"))
        if isinstance(data, list):
            result["preview"] = data[:5]
            result["total_lines"] = len(data)

    elif suffix == ".zip":
        import zipfile

        data_suffixes = {".jsonl", ".csv", ".xlsx", ".xls"}
        buf = io.BytesIO(content)
        with zipfile.ZipFile(buf) as zf:
            for name in zf.namelist():
                if (
                    Path(name).suffix.lower() in data_suffixes
                    and not Path(name).name.startswith("__")
                    and not Path(name).name.startswith(".")
                ):
                    inner = zf.read(name)
                    result.update(_parse_preview(inner, Path(name).suffix.lower()))
                    result["zip_data_file"] = name
                    break

    elif suffix == ".parquet":
        import pandas as pd

        df = pd.read_parquet(io.BytesIO(content))
        result["preview"] = df.head(5).where(df.head(5).notna(), None).to_dict("records")
        result["total_lines"] = len(df)

    return result
