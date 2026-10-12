"""Trusted-host JSON runner: python -m system19 < request.json.

Input: {"state": {}, "command": {...}, "fixtures": {...}}.
Fixtures: {owner: {operation: {selector: canned_JSON_response}}}.
Output: {"state": {...}, "reply": {...}}. Never expose state or fixtures to a
player client; only reply is actor-facing. No foreign IO is performed.
"""

import json
import sys

from .combat import Rejected, state_machine


def main() -> None:
    try:
        request = json.load(sys.stdin)
        result = state_machine(request.get("state", {}), request["command"], request.get("fixtures", {}))
    except (Rejected, KeyError, TypeError, ValueError):
        result = {"reply": {"status": "rejected", "data": {"code": "invalid_host_request"}}}
    json.dump(result, sys.stdout, sort_keys=True, allow_nan=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
