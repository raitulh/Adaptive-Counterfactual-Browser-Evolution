from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import INSECURE_DEV_SECRET, Settings


def test_env_example_parses(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text((Path(__file__).parents[1] / ".env.example").read_text())
    settings = Settings(_env_file=env_file)
    assert settings.cookie_secure is None and settings.cookie_domain is None
    assert settings.secret_key == INSECURE_DEV_SECRET
    assert settings.cors_origins == ["http://localhost:3000"]
    assert settings.default_site_key is None


def test_comma_separated_lists(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "https://app.example.com/, https://admin.example.com")
    monkeypatch.setenv("BLOCKLIST_CIDRS", "203.0.113.0/24,2001:db8::/32")
    settings = Settings(_env_file=None)
    assert settings.cors_origins == ["https://app.example.com", "https://admin.example.com"]
    assert settings.blocklist_cidrs == ["203.0.113.0/24", "2001:db8::/32"]


def test_invalid_cidr_is_rejected():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, datacenter_cidrs=["not-a-network"])


def test_production_requires_real_secret_and_no_demo():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, environment="production")
    with pytest.raises(ValidationError):
        Settings(_env_file=None, environment="production", secret_key="x" * 40, seed_demo=True)
    settings = Settings(_env_file=None, environment="production", secret_key="x" * 40)
    assert settings.cookie_secure_effective is True


def test_samesite_none_needs_secure_cookies():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, cookie_samesite="none", cookie_secure=False)
