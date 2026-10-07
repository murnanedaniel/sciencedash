"""Read ps args lines from stdin and emit live bridge session IDs as JSON."""

import json
import re
import shlex
import sys


def parse_sessions(lines):
    sessions = set()
    for line in lines:
        try:
            args = shlex.split(line)
        except ValueError:
            continue
        if "--print" not in args or "--sdk-url" not in args:
            continue
        for i, arg in enumerate(args[:-1]):
            if arg == "--session-id" and re.fullmatch(r"cse_[A-Za-z0-9_-]+", args[i + 1]):
                sessions.add(args[i + 1])
    return sorted(sessions)


if __name__ == "__main__":
    print(json.dumps(parse_sessions(sys.stdin)))
