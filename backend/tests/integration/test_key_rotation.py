"""TOKEN_ENCRYPTION_KEY rotation: stored credentials are re-encrypted under the new primary key."""

from __future__ import annotations

import uuid

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select

from app.admin.key_rotation import ENCRYPTED_COLUMNS, rotate_encrypted_columns
from app.auth.models import MfaFactor
from app.core.config import get_settings
from app.core.crypto import DecryptionError, LocalFernetKeyManager
from app.core.database import Base, get_session_factory
from app.db_models import import_all_models
from app.integrations.models import OAuthConnection

pytestmark = pytest.mark.integration


def test_every_encrypted_column_is_covered() -> None:
    import_all_models()
    found = {(table.name, column.name) for table in Base.metadata.tables.values() for column in table.columns
             if column.name.endswith(("_enc", "_encrypted"))}
    assert found == set(ENCRYPTED_COLUMNS)


async def test_rotation_reencrypts_under_the_primary_key_and_reports_undecryptable(make_user) -> None:
    user = await make_user()
    old_key = get_settings().encryption_keys()[0]
    new_key = Fernet.generate_key()
    old_only = LocalFernetKeyManager([old_key])
    sf = get_session_factory()

    async with sf() as s:
        s.info["tenant_id"] = user.tenant_id
        conn = OAuthConnection(tenant_id=user.tenant_id, user_id=user.user_id, provider="google",
                               provider_account_id=f"acct-{uuid.uuid4().hex[:8]}",
                               access_token_enc=old_only.encrypt("access-token-A"),
                               refresh_token_enc=old_only.encrypt("refresh-token-A"))
        s.add(conn)
        await s.commit()
    async with sf() as s:
        s.info["system"] = True
        good = MfaFactor(user_id=user.user_id, secret_encrypted=old_only.encrypt("JBSWY3DPEHPK3PXP"))
        corrupt = MfaFactor(user_id=user.user_id, secret_encrypted="not-a-fernet-token")
        s.add_all([good, corrupt])
        await s.commit()

    async def load() -> tuple[OAuthConnection, MfaFactor]:
        async with sf() as s:
            s.info["system"] = True
            c = (await s.execute(select(OAuthConnection).where(OAuthConnection.id == conn.id))).scalar_one()
            m = (await s.execute(select(MfaFactor).where(MfaFactor.id == good.id))).scalar_one()
            return c, m

    rotating = LocalFernetKeyManager([new_key, old_key])
    try:
        # Dry run: verifies decryptability, writes nothing.
        dry = await rotate_encrypted_columns(sf, rotating, batch_size=2, dry_run=True)
        c, m = await load()
        assert c.access_token_enc == conn.access_token_enc and m.secret_encrypted == good.secret_encrypted
        assert f"mfa_factors.secret_encrypted:{corrupt.id}" in dry.failed

        report = await rotate_encrypted_columns(sf, rotating, batch_size=2)
        assert f"mfa_factors.secret_encrypted:{corrupt.id}" in report.failed
        assert not any(str(conn.id) in ref or str(good.id) in ref for ref in report.failed)
        assert report.rotated["oauth_connections.access_token_enc"] >= 1

        new_only = LocalFernetKeyManager([new_key])
        c, m = await load()
        assert new_only.decrypt(c.access_token_enc or "") == "access-token-A"
        assert new_only.decrypt(c.refresh_token_enc or "") == "refresh-token-A"
        assert new_only.decrypt(m.secret_encrypted) == "JBSWY3DPEHPK3PXP"
        with pytest.raises(DecryptionError):
            old_only.decrypt(c.access_token_enc or "")
        assert c.version == 1  # compare-and-set rewrite does not disturb optimistic-lock versions
    finally:
        # Restore every row to the suite's key so later tests keep decrypting.
        await rotate_encrypted_columns(sf, LocalFernetKeyManager([old_key, new_key]))
    c, _ = await load()
    assert old_only.decrypt(c.access_token_enc or "") == "access-token-A"
