import unittest

from acbe.core.config import ACBEConfig
from acbe.safety.guard import (
    DestructiveActionError,
    DomainNotAllowedError,
    ProtectedComponentError,
    SafetyGuard,
)


class TestSafetyGuard(unittest.TestCase):
    def setUp(self):
        self.guard = SafetyGuard(ACBEConfig())

    def test_protected_component_blocked_without_approval(self):
        with self.assertRaises(ProtectedComponentError):
            self.guard.check_protected_component("evaluator")

    def test_protected_component_allowed_with_human_approval(self):
        self.guard.check_protected_component("evaluator", human_approved=True)  # should not raise

    def test_non_protected_component_never_blocked(self):
        self.guard.check_protected_component("some_random_module")  # should not raise

    def test_destructive_action_requires_confirmation(self):
        with self.assertRaises(DestructiveActionError):
            self.guard.check_destructive_action("financial_transaction")
        self.guard.check_destructive_action("financial_transaction", confirmed=True)

    def test_domain_allowlist_blocks_other_domains(self):
        guard = SafetyGuard(ACBEConfig(domain_allowlist=["example.com"]))
        with self.assertRaises(DomainNotAllowedError):
            guard.check_domain("https://evil.example.org/phish")
        guard.check_domain("https://shop.example.com/cart")  # should not raise

    def test_no_allowlist_means_allow_all(self):
        guard = SafetyGuard(ACBEConfig(domain_allowlist=None))
        guard.check_domain("https://anything.at.all/x")  # should not raise

    def test_rate_limiter_blocks_after_threshold(self):
        guard = SafetyGuard(ACBEConfig())
        guard._rate_limiter.max_events = 3
        for _ in range(3):
            guard.check_rate_limit("k1")
        with self.assertRaises(RuntimeError):
            guard.check_rate_limit("k1")

    def test_audit_trail_records_every_check(self):
        guard = SafetyGuard(ACBEConfig())
        try:
            guard.check_protected_component("evaluator")
        except ProtectedComponentError:
            pass
        trail = guard.audit_trail()
        self.assertTrue(any(e["event"] == "protected_component_blocked" for e in trail))


if __name__ == "__main__":
    unittest.main()
