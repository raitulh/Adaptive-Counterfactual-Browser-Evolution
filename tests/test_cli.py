import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from acbe.cli.main import build_parser


def run_cli(argv):
    parser = build_parser()
    args = parser.parse_args(argv)
    buf = io.StringIO()
    with redirect_stdout(buf):
        args.func(args)
    return buf.getvalue()


class TestCLI(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.db = str(Path(self._tmp.name) / "acbe.db")

    def tearDown(self):
        self._tmp.cleanup()

    def test_init_creates_database(self):
        out = run_cli(["init", "--db", self.db])
        self.assertIn("Initialized", out)
        self.assertTrue(Path(self.db).exists())

    def test_run_list_shows_tasks(self):
        out = run_cli(["run", "--list", "--db", self.db])
        self.assertIn("wrong_element_0", out)

    def test_run_naive_task_fails(self):
        out = run_cli(["run", "--task", "wrong_element_0", "--db", self.db])
        self.assertIn("success:     False", out)

    def test_run_with_robust_locator_succeeds(self):
        out = run_cli(["run", "--task", "wrong_element_0", "--locator", "role_name", "--db", self.db])
        self.assertIn("success:     True", out)

    def test_run_unknown_task_exits_nonzero(self):
        with self.assertRaises(SystemExit):
            run_cli(["run", "--task", "does-not-exist", "--db", self.db])

    def test_eval_outputs_json(self):
        out = run_cli(["eval", "--task", "wrong_element_0", "--db", self.db])
        self.assertIn('"completed"', out)

    def test_improve_promotes_and_persists(self):
        out = run_cli(["improve", "--task", "wrong_element_0", "--db", self.db])
        self.assertIn("promoted:         True", out)

        strategies_out = run_cli(["strategies", "--db", self.db])
        self.assertIn("WRONG_ELEMENT", strategies_out)

        failures_out = run_cli(["failures", "--db", self.db])
        self.assertIn("WRONG_ELEMENT", failures_out)

    def test_improve_with_failure_latest(self):
        run_cli(["run", "--task", "wrong_element_1", "--db", self.db])  # doesn't record a failure by itself
        run_cli(["improve", "--task", "wrong_element_1", "--db", self.db])  # this does
        out = run_cli(["improve", "--failure", "latest", "--db", self.db])
        self.assertIn("wrong_element_1", out)

    def test_experiment_run_and_list(self):
        run_cli(["experiment", "run", "--task", "wrong_element_0",
                  "--candidate-locator", "role_name", "--db", self.db])
        out = run_cli(["experiment", "list", "--db", self.db])
        self.assertIn("manual_wrong_element_0", out)

    def test_history_and_rollback_and_compare(self):
        run_cli(["improve", "--task", "wrong_element_0", "--db", self.db])
        history_out = run_cli(["history", "--kind", "strategy", "--db", self.db])
        self.assertTrue(history_out.strip())

        # grab the first recorded strategy version to roll back to
        from acbe.evolution.rollback import VersionHistory
        versions = VersionHistory(self.db).history("strategy")
        self.assertGreaterEqual(len(versions), 1)
        first_version = versions[0]["version"]

        rollback_out = run_cli(["rollback", first_version, "--kind", "strategy", "--db", self.db])
        self.assertIn("Rolled back", rollback_out)

        if len(versions) >= 2:
            compare_out = run_cli(["compare", versions[0]["version"], versions[-1]["version"],
                                     "--kind", "strategy", "--db", self.db])
            self.assertIn("diff", compare_out)

    def test_rollback_unknown_version_exits_nonzero(self):
        run_cli(["init", "--db", self.db])
        with self.assertRaises(SystemExit):
            run_cli(["rollback", "nope", "--kind", "strategy", "--db", self.db])

    def test_serve_parser_prod_flag(self):
        parser = build_parser()
        args = parser.parse_args(["serve", "--prod", "--port", "9000"])
        self.assertTrue(args.prod)
        self.assertEqual(args.port, 9000)



if __name__ == "__main__":
    unittest.main()
