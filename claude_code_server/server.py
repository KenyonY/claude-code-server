"""Standalone server + CLI entry point.

Usage:
    # CLI
    claude-code-server --working-dir /path/to/project --port 8333

    # Python
    from claude_code_server import create_app, AgentConfig
    app = create_app(AgentConfig(working_dir="/path/to/project"))
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .models import AgentConfig
from .router import create_router
from .store import SessionStore

_STATIC_DIR = Path(__file__).parent / "static"


def create_app(
    config: AgentConfig | None = None,
    data_dir: str | Path | None = None,
) -> FastAPI:
    """Create a standalone FastAPI application.

    data_dir: directory for the SQLite sessions database.
              Defaults to {working_dir}/.ccs-data.
              Pass an empty string to disable persistence (sessions become
              in-memory only and /api/sessions returns 503).
    """
    app = FastAPI(title="Claude Code Server")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    store: SessionStore | None = None
    if data_dir != "":
        cfg = config or AgentConfig()
        base = Path(data_dir) if data_dir else Path(cfg.working_dir) / ".ccs-data"
        store = SessionStore(base / "sessions.db")

    router = create_router(config=config, store=store)
    app.include_router(router, prefix="/api")

    # Serve bundled frontend (exists after pip install)
    if _STATIC_DIR.is_dir():

        @app.get("/{full_path:path}")
        async def serve_frontend(full_path: str):
            file_path = _STATIC_DIR / full_path
            if file_path.is_file():
                return FileResponse(file_path)
            return FileResponse(_STATIC_DIR / "index.html")

    return app


def main() -> None:
    """CLI entry point: claude-code-server."""
    import uvicorn

    parser = argparse.ArgumentParser(description="Claude Code Server")
    parser.add_argument(
        "--working-dir", "-d",
        default=os.getcwd(),
        help="Project directory (claude CLI cwd, picks up CLAUDE.md)",
    )
    parser.add_argument(
        "--port", "-p",
        type=int,
        default=int(os.environ.get("CLAUDE_CODE_SERVER_PORT", "8333")),
    )
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--max-turns", type=int, default=20)
    parser.add_argument(
        "--system-prompt",
        default=None,
        help="System prompt (overrides project CLAUDE.md)",
    )
    parser.add_argument(
        "--system-prompt-file",
        default=None,
        help="Read system prompt from file",
    )
    parser.add_argument(
        "--append-system-prompt",
        default=None,
        help="Append to default system prompt (keeps CC tools/rules)",
    )
    parser.add_argument(
        "--append-system-prompt-file",
        default=None,
        help="Read append system prompt from file",
    )
    parser.add_argument(
        "--password",
        default=os.environ.get("CCS_PASSWORD", "yao"),
        help="Login password (default: yao, env: CCS_PASSWORD)",
    )
    parser.add_argument(
        "--data-dir",
        default=None,
        help="Directory for sessions.db (default: {working_dir}/.ccs-data)",
    )
    args = parser.parse_args()

    system_prompt = args.system_prompt
    if args.system_prompt_file:
        with open(args.system_prompt_file) as f:
            system_prompt = f.read()

    append_system_prompt = args.append_system_prompt
    if args.append_system_prompt_file:
        with open(args.append_system_prompt_file) as f:
            append_system_prompt = f.read()

    config = AgentConfig(
        working_dir=args.working_dir,
        system_prompt=system_prompt,
        append_system_prompt=append_system_prompt,
        max_turns=args.max_turns,
        password=args.password,
    )

    app = create_app(config, data_dir=args.data_dir)
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
