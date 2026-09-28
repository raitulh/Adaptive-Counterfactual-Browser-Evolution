"""Operator CLI.

    python -m app.cli check-config          # validate configuration (fails fast like the app)
    python -m app.cli sync-tools             # mirror built-in tool specs into tool_definitions/tool_versions
    python -m app.cli promote-admin EMAIL    # grant platform-admin to an existing user (audited)
    python -m app.cli rotate-encryption [--dry-run]  # re-encrypt stored credentials under the primary key
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


async def _rotate_encryption(*, dry_run: bool, batch_size: int) -> int:
    from app.admin.key_rotation import rotate_encrypted_columns
    from app.audit import service as audit
    from app.audit.service import AuditCategory
    from app.core.crypto import get_key_manager
    from app.core.database import get_session_factory

    report = await rotate_encrypted_columns(get_session_factory(), get_key_manager(), batch_size=batch_size,
                                            dry_run=dry_run)
    for column, count in report.rotated.items():
        print(f"{column}: {count} {'decryptable' if dry_run else 're-encrypted'}")
    if report.changed_concurrently:
        print(f"{report.changed_concurrently} values changed concurrently (already written under the primary key)")
    if not dry_run:
        await audit.record_independent(
            category=AuditCategory.ADMIN, action="admin.encryption.rotated", actor_type="system",
            status="failure" if report.failed else "success",
            # Aggregate counts only (per-column keys would be masked by the audit redactor: *token*/*secret*).
            metadata={"values_rotated": report.total_rotated, "columns": len(report.rotated),
                      "changed_concurrently": report.changed_concurrently, "failed": len(report.failed)})
    if report.failed:
        print(f"{len(report.failed)} values could not be decrypted with any configured key:", file=sys.stderr)
        for ref in report.failed[:100]:
            print(f"  {ref}", file=sys.stderr)
        print("Keep the old key in TOKEN_ENCRYPTION_PREVIOUS_KEYS until these are resolved.", file=sys.stderr)
        return 1
    print("done: every stored credential is " + ("decryptable" if dry_run else "encrypted under the primary key"))
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check-config")
    sub.add_parser("sync-tools")
    promote = sub.add_parser("promote-admin")
    promote.add_argument("email")
    rotate = sub.add_parser("rotate-encryption", help="re-encrypt stored credentials under TOKEN_ENCRYPTION_KEY")
    rotate.add_argument("--dry-run", action="store_true", help="only check every value is decryptable")
    rotate.add_argument("--batch-size", type=int, default=500)
    args = parser.parse_args()

    from app.core.config import get_settings

    get_settings().validate_for_startup()
    if args.command == "check-config":
        print("configuration OK")
        raise SystemExit(0)
    if args.command == "sync-tools":
        raise SystemExit(asyncio.run(_sync_tools()))
    if args.command == "rotate-encryption":
        raise SystemExit(asyncio.run(_rotate_encryption(dry_run=args.dry_run, batch_size=max(1, args.batch_size))))
    raise SystemExit(asyncio.run(_promote(args.email)))


if __name__ == "__main__":
    main()
