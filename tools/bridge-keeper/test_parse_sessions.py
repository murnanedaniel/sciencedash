import json
from pathlib import Path
import subprocess
import sys
import unittest

from parse_sessions import parse_sessions


VERSIONED_WORKER = (
    "/home/u/.local/share/claude/versions/2.1.283 --print "
    "--sdk-url https://api.anthropic.com/v1/code/sessions/cse_014JcAb9_- "
    "--session-id cse_014JcAb9_- --input-format stream-json"
)
NAMED_WORKER = (
    "/usr/bin/claude --print --sdk-url "
    "https://api.anthropic.com/v1/code/sessions/cse_named "
    "--session-id cse_named --input-format stream-json"
)


class ParseSessionsTests(unittest.TestCase):
    def test_versioned_worker(self):
        self.assertEqual(parse_sessions([VERSIONED_WORKER]), ["cse_014JcAb9_-"])

    def test_named_worker(self):
        self.assertEqual(parse_sessions([NAMED_WORKER]), ["cse_named"])

    def test_non_worker(self):
        self.assertEqual(parse_sessions(["claude rc --name x"]), [])

    def test_requires_both_worker_flags(self):
        for flag in ("--print", "--sdk-url"):
            with self.subTest(flag=flag):
                self.assertEqual(parse_sessions([NAMED_WORKER.replace(flag, "")]), [])

    def test_malformed_quote_does_not_discard_other_lines(self):
        self.assertEqual(parse_sessions([NAMED_WORKER + " 'unterminated", VERSIONED_WORKER]),
                         ["cse_014JcAb9_-"])

    def test_invalid_or_missing_session_id(self):
        for value in ("", "cse_", "other", "cse_bad!", "cse_bad/path"):
            with self.subTest(value=value):
                self.assertEqual(parse_sessions([
                    f"claude --print --sdk-url https://example.com --session-id {value}"
                ]), [])

    def test_cli_emits_sorted_unique_json_list(self):
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name("parse_sessions.py"))],
            input="\n".join([NAMED_WORKER, VERSIONED_WORKER, NAMED_WORKER]),
            text=True, capture_output=True, check=True,
        )
        self.assertEqual(json.loads(result.stdout), ["cse_014JcAb9_-", "cse_named"])


if __name__ == "__main__":
    unittest.main()
