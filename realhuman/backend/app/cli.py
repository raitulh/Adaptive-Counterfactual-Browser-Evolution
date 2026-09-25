"""
Management commands.

    python -m app.cli seed                 # demo account + project (uses DEMO_* settings)
    python -m app.cli create-user EMAIL    # prompts for a password
"""

from __future__ import annotations

import argparse
import getpass
import sys

from sqlalchemy import select

from app.clock import Clock
from app.config import get_settings
from app.db.database import create_db_engine, create_session_factory
from app.logging_config import configure_logging
from app.models import Project, ProjectSettings, User
from app.schemas.auth import SignupIn
from app.security.api_keys import generate_site_key
from app.security.auth import hash_password
from app.services.seed import seed_demo


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("seed", help="Create the demo account and project.")
    create_user = commands.add_parser("create-user", help="Create an account and project.")
    create_user.add_argument("email")
    args = parser.parse_args(argv)

    settings = get_settings()
    configure_logging(settings.log_level)
    session_factory = create_session_factory(create_db_engine(settings))
    clock = Clock()

    if args.command == "seed":
        seed_demo(session_factory, settings, clock)
        print(f"Demo project ready. Site key: {settings.demo_site_key}")
        return 0

    password = getpass.getpass("Password (12+ characters): ")
    credentials = SignupIn(email=args.email, password=password)
    now = clock.now()
    with session_factory() as db:
        if db.scalar(select(User.id).where(User.email == credentials.email)):
            print("An account with this email already exists.", file=sys.stderr)
            return 1
        user = User(
            email=credentials.email,
            password_hash=hash_password(credentials.password),
            workspace_name=f"{credentials.email.split('@', 1)[0]}'s workspace",
            created_at=now,
        )
        project = Project(name="Default project", site_key=generate_site_key(), created_at=now)
        project.settings = ProjectSettings(updated_at=now)
        user.projects.append(project)
        db.add(user)
        db.commit()
        print(f"Created {user.email}. Site key: {project.site_key}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
