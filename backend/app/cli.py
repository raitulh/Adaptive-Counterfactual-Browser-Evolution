"""Operator CLI.

    python -m app.cli check-config          # validate configuration (fails fast like the app)
    python -m app.cli sync-tools             # mirror built-in tool specs into tool_definitions/tool_versions
    python -m app.cli promote-admin EMAIL    # grant platform-admin to an existing user (audited)
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import func, select


async def _sync_tools() -> int:
    from app.core.database import get_session_factory
    from app.tools.registry import get_tool_registry, sync_tool_catalog

    async with get_session_factory()() as session:
        session.info["system"] = True
        changed = await sync_tool_catalog(session, get_tool_registry())
    print(f"tool catalogue synced ({changed} new tool versions)")
    return 0


async def _promote(email: str) -> int:
    from app.audit import service as audit
    from app.audit.service import AuditCategory
    from app.core.database import get_session_factory
    from app.users.models import User

    async with get_session_factory()() as session:
        session.info["system"] = True
        user = (await session.execute(select(User).where(func.lower(User.email) == email.lower()))).scalar_one_or_none()
        if user is None:
            print(f"no user with e-mail {email}", file=sys.stderr)
            return 1
        user.is_platform_admin = True
        audit.record(session, category=AuditCategory.ADMIN, action="admin.platform_admin.granted", user_id=user.id,
                     actor_type="system", resource_type="user", resource_id=user.id)
        await session.commit()
    print(f"{email} is now a platform administrator")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check-config")
    sub.add_parser("sync-tools")
    promote = sub.add_parser("promote-admin")
    promote.add_argument("email")
    args = parser.parse_args()

    from app.core.config import get_settings

    get_settings().validate_for_startup()
    if args.command == "check-config":
        print("configuration OK")
        raise SystemExit(0)
    if args.command == "sync-tools":
        raise SystemExit(asyncio.run(_sync_tools()))
    raise SystemExit(asyncio.run(_promote(args.email)))


if __name__ == "__main__":
    main()
