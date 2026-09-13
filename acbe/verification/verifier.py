"""
Verification (Section 3 / 15): every important action gets an
Expected State / Actual State / Transition / Verification Result.

This wraps whatever the ``BrowserAdapter.verify`` backend returns, and adds
a couple of environment-agnostic checks (state actually changed, no
exception was raised) so agents never have to invent their own ad hoc
verification logic.
"""

from __future__ import annotations

from acbe.browser.base import BrowserAdapter
from acbe.core.types import ObservedState, VerificationResult


class Verifier:
    def __init__(self, browser: BrowserAdapter):
        self.browser = browser

    async def verify_transition(
        self,
        expected_state: str,
        before: ObservedState,
        after: ObservedState,
    ) -> VerificationResult:
        backend_result = await self.browser.verify(expected_state)

        if backend_result.verified and before.state_hash == after.state_hash:
            # Backend claims success but nothing observably changed -- treat
            # this as low-confidence rather than blindly trusting it.
            return VerificationResult(
                verified=False,
                method=backend_result.method,
                expected_state=expected_state,
                actual_state=after.url,
                confidence=0.4,
                detail="Backend reported success but no observable state change was detected.",
            )
        return backend_result
