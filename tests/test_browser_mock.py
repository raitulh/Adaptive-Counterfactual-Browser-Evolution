import asyncio
import unittest

from acbe.browser.base import BrowserActionError
from acbe.browser.mock_adapter import MockBrowserAdapter
from acbe.core.types import ActionRecord, ActionType, LocatorStrategy, new_id
from benchmarks.environments import make_shop_environment


def click(target, locator=LocatorStrategy.ROLE_NAME, **params):
    return ActionRecord(
        action_id=new_id("act"), action_type=ActionType.CLICK,
        target_description=target, locator_strategy=locator, params=params,
    )


class TestMockBrowserAdapter(unittest.IsolatedAsyncioTestCase):
    async def test_observe_lists_elements(self):
        env = make_shop_environment("shop-a", trap=False)
        browser = MockBrowserAdapter(env)
        await browser.start()
        state = await browser.observe()
        self.assertEqual(state.page_type, "home")
        names = [e["visible_text"] for e in state.elements]
        self.assertIn("Browse", names)

    async def test_weak_locator_hits_decoy(self):
        env = make_shop_environment("shop-b", trap=True)
        browser = MockBrowserAdapter(env)
        await browser.start()
        await browser.act(click("Browse", LocatorStrategy.ROLE_NAME))
        with self.assertRaises(BrowserActionError) as ctx:
            await browser.act(click("Add to cart", LocatorStrategy.TEXT_VISUAL))
        self.assertEqual(ctx.exception.error_kind, "WRONG_ELEMENT")

    async def test_robust_locator_avoids_decoy(self):
        env = make_shop_environment("shop-c", trap=True)
        browser = MockBrowserAdapter(env)
        await browser.start()
        await browser.act(click("Browse", LocatorStrategy.ROLE_NAME))
        state = await browser.act(click("Add to cart", LocatorStrategy.ROLE_NAME))
        self.assertEqual(state.page_type, "cart")

    async def test_no_trap_succeeds_regardless_of_strategy(self):
        env = make_shop_environment("shop-d", trap=False)
        browser = MockBrowserAdapter(env)
        await browser.start()
        await browser.act(click("Browse", LocatorStrategy.TEXT_VISUAL))
        state = await browser.act(click("Add to cart", LocatorStrategy.TEXT_VISUAL))
        self.assertEqual(state.page_type, "cart")

    async def test_verify_page_match(self):
        env = make_shop_environment("shop-e", trap=False)
        browser = MockBrowserAdapter(env)
        await browser.start()
        result = await browser.verify("page:home")
        self.assertTrue(result.verified)
        result = await browser.verify("page:cart")
        self.assertFalse(result.verified)

    async def test_element_not_found_raises_wrong_element(self):
        env = make_shop_environment("shop-f", trap=False)
        browser = MockBrowserAdapter(env)
        await browser.start()
        with self.assertRaises(BrowserActionError) as ctx:
            await browser.act(click("This button does not exist anywhere"))
        self.assertEqual(ctx.exception.error_kind, "WRONG_ELEMENT")


if __name__ == "__main__":
    unittest.main()
