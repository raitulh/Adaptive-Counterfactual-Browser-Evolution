import json
import tempfile
import unittest
from pathlib import Path

from acbe.telemetry.tracer import Tracer, redact_secrets


class TestRedaction(unittest.TestCase):
    def test_redacts_known_sensitive_keys(self):
        data = {"api_key": "sk-abc123", "password": "hunter2", "note": "fine"}
        redacted = redact_secrets(data)
        self.assertEqual(redacted["api_key"], "***REDACTED***")
        self.assertEqual(redacted["password"], "***REDACTED***")
        self.assertEqual(redacted["note"], "fine")

    def test_redacts_nested_structures(self):
        data = {"headers": {"Authorization": "Bearer xyz"}, "items": [{"api_key": "sk-1"}, {"note": "ok"}]}
        redacted = redact_secrets(data)
        self.assertEqual(redacted["headers"]["Authorization"], "***REDACTED***")
        self.assertEqual(redacted["items"][0]["api_key"], "***REDACTED***")
        self.assertEqual(redacted["items"][1]["note"], "ok")

    def test_redacts_a_sensitive_key_even_when_its_value_is_a_nested_structure(self):
        # A key that itself looks sensitive (e.g. "cookies") is redacted
        # wholesale rather than recursed into -- the safer default.
        data = {"cookies": [{"session_id": "abc"}]}
        redacted = redact_secrets(data)
        self.assertEqual(redacted["cookies"], "***REDACTED***")


class TestTracer(unittest.TestCase):
    def test_events_are_redacted_on_the_way_in(self):
        tracer = Tracer(trace_dir=tempfile.mkdtemp())
        tracer.event("t1", "v1", "s1", api_key="secret-value", ok=True)
        events = tracer.events()
        self.assertEqual(events[0]["api_key"], "***REDACTED***")
        self.assertTrue(events[0]["ok"])

    def test_export_json_writes_valid_json(self):
        tmpdir = tempfile.mkdtemp()
        tracer = Tracer(trace_dir=tmpdir)
        tracer.event("t1", "v1", "s1", detail="hello")
        out_path = str(Path(tmpdir) / "trace.json")
        tracer.export_json(out_path)
        with open(out_path) as fh:
            data = json.load(fh)
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["detail"], "hello")

    def test_clear_empties_events(self):
        tracer = Tracer(trace_dir=tempfile.mkdtemp())
        tracer.event("t1", "v1", "s1")
        tracer.clear()
        self.assertEqual(tracer.events(), [])


if __name__ == "__main__":
    unittest.main()
