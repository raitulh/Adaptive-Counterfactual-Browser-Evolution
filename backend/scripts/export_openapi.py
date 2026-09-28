"""Export the AgentOS OpenAPI schema to a JSON file (default: docs/openapi.json).

    python scripts/export_openapi.py [--output docs/openapi.json]

The schema is generated from the real application factory (``app.main.create_app``)
without starting the server or touching PostgreSQL/Redis. When the environment does
not hold a configuration that passes startup validation (typically: no JWT_SECRET /
TOKEN_ENCRYPTION_KEY on a build machine), throw-away dummy values are injected for
this process only; secrets do not influence the schema. Output is deterministic
(sorted keys) so the file diffs cleanly in review.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _ensure_exportable_settings() -> None:
    """Keep a valid configured environment; otherwise inject dummy values for this process."""
    from app.core.config import ConfigError, Settings, get_settings

    try:
        Settings().validate_for_startup()
        return
    except ConfigError:
        pass
    from cryptography.fernet import Fernet

    dummies = {
        "APP_ENV": "development",
        "DEBUG": "false",
        "JWT_SECRET": "openapi-export-only-" + "x" * 32,
        "TOKEN_ENCRYPTION_KEY": Fernet.generate_key().decode(),
        "TOKEN_ENCRYPTION_PREVIOUS_KEYS": "",
    }
    os.environ.update(dummies)
    get_settings.cache_clear()
    print("[export-openapi] configuration incomplete; using dummy secrets for schema export",
          file=sys.stderr)


def build_schema() -> dict[str, object]:
    _ensure_exportable_settings()
    from app.core.config import get_settings
    from app.main import create_app

    app = create_app(get_settings())
    return app.openapi()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export the AgentOS OpenAPI schema")
    parser.add_argument("--output", default=None,
                        help="output path (default: <backend>/docs/openapi.json; relative to the current directory)")
    args = parser.parse_args(argv)
    output = Path(args.output).resolve() if args.output else BACKEND_DIR / "docs" / "openapi.json"

    # Settings read `.env` relative to the working directory: use the backend's.
    os.chdir(BACKEND_DIR)
    schema = build_schema()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(schema, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    paths = schema.get("paths", {})
    print(f"[export-openapi] wrote {output} ({len(paths) if isinstance(paths, dict) else 0} paths)",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
