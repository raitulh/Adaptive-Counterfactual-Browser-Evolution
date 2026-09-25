from __future__ import annotations

from pydantic import Field

from app.schemas.common import CamelModel, Email


class LoginIn(CamelModel):
    email: Email
    password: str = Field(min_length=1, max_length=1024)


class SignupIn(CamelModel):
    email: Email
    password: str = Field(min_length=12, max_length=128)


class AuthSessionOut(CamelModel):
    email: str
    workspace: str
