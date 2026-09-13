import unittest

from acbe.browser.base import RawBrowserState
from acbe.observation.state_extractor import StateExtractor


class TestStateExtractor(unittest.TestCase):
    def test_dedup_across_identical_states(self):
        extractor = StateExtractor()
        raw = RawBrowserState(url="http://x/a", page_type="home",
                               elements=[{"element_id": "e1", "accessible_name": "Go"}])
        first = extractor.extract(raw, goal="do a thing")
        second = extractor.extract(raw, goal="do a thing")
        self.assertTrue(first.state_change)
        self.assertFalse(second.state_change)
        self.assertEqual(first.state_hash, second.state_hash)

    def test_state_change_detected_on_new_page(self):
        extractor = StateExtractor()
        raw1 = RawBrowserState(url="http://x/a", page_type="home",
                                elements=[{"element_id": "e1", "accessible_name": "Go"}])
        raw2 = RawBrowserState(url="http://x/b", page_type="product",
                                elements=[{"element_id": "e2", "accessible_name": "Buy"}])
        extractor.extract(raw1, goal="g")
        second = extractor.extract(raw2, goal="g")
        self.assertTrue(second.state_change)

    def test_uncertainty_increases_after_failed_action(self):
        extractor = StateExtractor()
        raw = RawBrowserState(url="http://x/a", page_type="home",
                               elements=[{"element_id": "e1", "accessible_name": "Go"}])
        calm = extractor.extract(raw, goal="g", recent_action_failed=False)
        extractor.reset()
        anxious = extractor.extract(raw, goal="g", recent_action_failed=True)
        self.assertGreater(anxious.uncertainty, calm.uncertainty)

    def test_visible_elements_truncated(self):
        extractor = StateExtractor()
        elements = [{"element_id": f"e{i}", "accessible_name": f"Item {i}"} for i in range(30)]
        raw = RawBrowserState(url="http://x/a", page_type="list", elements=elements)
        observed = extractor.extract(raw, goal="g")
        self.assertLessEqual(len(observed.visible_elements), 12)
        self.assertEqual(observed.raw_element_count, 30)


if __name__ == "__main__":
    unittest.main()
