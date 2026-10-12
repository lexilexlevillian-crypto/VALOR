"""JSON transport for the isolated module; run with ``python -m system20``.

Read one JSON object containing ``state``, ``command``, and optional trusted
``stub_payloads``. Write one transition result. Omit ``state`` for a new module.
The state payload is restricted engine persistence, not a player-facing view.
"""

import json
import sys

from . import main_state_machine, new_state


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict) or "command" not in payload:
            raise ValueError("JSON command required")
        result = main_state_machine(
            payload.get("state", new_state()),
            payload["command"],
            payload.get("stub_payloads"),
        )
        json.dump(result, sys.stdout, sort_keys=True, allow_nan=False)
        sys.stdout.write("\n")
        return 0 if result["result"]["status"] != "rejected" else 1
    except (ValueError, TypeError, KeyError):
        json.dump({"result": {"status": "rejected", "code": "invalid_json_envelope"}}, sys.stdout)
        sys.stdout.write("\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
