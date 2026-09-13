import unittest

from acbe.browser.mock_adapter import MockBrowserAdapter
from acbe.core.types import ObservedState
from acbe.verification.verifier import Verifier
from benchmarks.environments import make_shop_environment


class TestVerifier(unittest.IsolatedAsyncioTestCase):
    async def test_flags_no_observable_change_as_low_confidence(self):
        env = make_shop_environment("shop-v", trap=False)
        browser = MockBrowserAdapter(env)
        await browser.start()
        verifier = Verifier(browser)

        same_state = ObservedState(url="x", page_type="home", goal="g", state_hash="abc")
        result = await verifier.verify_transition("page:home", same_state, same_state)
        # backend says "page:home" is verified (true, we never left it), but
        # since before/after hashes are identical the wrapper should not
        # blindly trust it as a *meaningful* transition.
        self.assertFalse(result.verified)
        self.assertLess(result.confidence, 1.0)

    async def test_trusts_backend_when_state_actually_changed(self):
        env = make_shop_environment("shop-v2", trap=False)
        browser = MockBrowserAdapter(env)
        await browser.start()
        verifier = Verifier(browser)

        before = ObservedState(url="x", page_type="home", goal="g", state_hash="abc")
        after = ObservedState(url="y", page_type="home", goal="g", state_hash="def")
        result = await verifier.verify_transition("page:home", before, after)
        self.assertTrue(result.verified)


if __name__ == "__main__":
    unittest.main()
