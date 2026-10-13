# System 27: Creator / Developer Control

Isolated Python 3.11+ control-plane package, shipped with the existing VALOR
service. Uses only the Python standard library. No HTTP routes, public admin
endpoint, game-owner imports, external credentials, or live integrations are
added. All dependency adapters return marked dummy JSON contracts.

## Run and verify

```sh
python -B -m unittest system27.test_control_plane -v
python -B -m system27 /path/to/control.sqlite3
```

The CLI accepts one typed JSON command per input line and returns one JSON
response per output line. See `control_plane.py` for the opening request and
`test_control_plane.py` for complete draft, review, repair, scenario, retry,
and player-preview examples. The public Python API is:

```python
from system27 import ControlPlane

plane = ControlPlane(":memory:", server_session="creator")
try:
    response = plane.state_machine(request)
finally:
    plane.close()
```

`server_session` is a trusted, server-selected **demo** context. The CLI reads
`SYSTEM27_DEMO_SESSION` (`creator`, `player`, or `revoked`). These are placeholder
capability responses, not production authentication. Do not expose the CLI or
its demo authorization through an unauthenticated network wrapper.

State uses exactly the record groups and fields from the supplied architecture.
SQLite serializes commands, retains incomplete stages, and reloads stable
operation IDs. A partially attempted plan remains associated with its original
operation ID, including when the owner acknowledgement is unavailable. Cancellation
does not remove completed stages or permit replay under a new operation ID.

## Isolation and deployment boundary

- All numbered systems and external providers remain stateless black-box stubs.
- Responses identify `execution: "mock"` and `canonical_effects_committed: false`.
- Scenario assertion adapters report `not_executed`; control-plane unit tests do
  not claim that the external game engine's 72 acceptance cases have run.
- Player projections are obtained separately from privileged inspection. Leaving
  privileged mode fences old requests; the new player-view context also rejects
  privileged reads even for the same creator principal.
- The package is included in the existing service deployment artifact, following
  the repository's isolated-module delivery pattern. It is not wired to Player
  Mode or to other numbered systems.
- The existing service uses its existing storage and startup configuration. This
  package opens no database on import. A CLI-created SQLite file requires an
  explicitly selected durable location for persistent use; Render's ordinary
  local filesystem is not durable across deployments.
- `.github/workflows/system27.yml` runs these module tests independently of the
  full application verification workflow.

Authoring references in the demonstration adapters include `demo:candidate`,
`demo:checkpoint`, `demo:entity`, `demo:patch`, `demo:repair`, `demo:knowledge`,
and `demo:npc-create`. Unknown references fail closed. The source documents all
implementation-selected status values and unset-reference conventions.
