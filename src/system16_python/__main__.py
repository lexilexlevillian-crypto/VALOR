"""JSON-lines harness: python -m src.system16_python

Each input line is a TRUSTED host envelope:
    {"state": <State.to_json()>, "command": <Command>, "fixtures": <dummy JSON>}

Each output line is {"state": <next snapshot>, "result": <observer-safe result>}.
`state` and `fixtures` must never be supplied to or accepted from a player UI.
With no fixtures, external grants fail closed. No network connections are made.
For atomic on-disk execution use system16_python.execute(database, command, deps).
"""

import json
import sys

from . import MockDependencies, State, transition
from .state import canonical


def main() -> None:
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            envelope = json.loads(line)
            result = transition(envelope.get("state", State().to_json()), envelope["command"], MockDependencies(envelope.get("fixtures")))
            print(canonical(result), flush=True)
        except (KeyError, TypeError, ValueError):
            print(canonical({"result": {"status": "FAILED", "data": {}, "failure_code": "INVALID_ENVELOPE"}}), flush=True)


if __name__ == "__main__":
    main()
