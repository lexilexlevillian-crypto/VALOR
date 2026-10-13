# System 26: Player Interface and Information Presentation

Isolated Python 3.11+ library, standard library only. The module is deployed
with the VALOR repository as a library artifact. It does not register an HTTP
endpoint or connect to live gameplay state. Every external dependency is a
stateless dummy-JSON adapter.

```python
from system26 import System26

interface = System26.create()
result = interface.step({
    "operation": "query",
    "context": interface.context(),
    "surface": "inventory",
})
```

Run verification from the repository root:

```sh
python -B -m unittest system26.test_interface -v
```

`python -m system26.interface` accepts JSON-line requests on stdin. Each request
must include the current context. Use `System26.create()` and `context()` when
embedding the library. State and methods prefixed with `_` are server-private;
only `step()` responses are intended for ordinary client delivery.

The mock owners return accepted/pending acknowledgments without resolving
canonical effects. Tests replace adapter responses with fixed contract fixtures;
they do not implement external systems. Instances are in-memory: durable state,
authentication, a browser UI, and live-system connections are not enabled by
this release. No production migrations or environment changes are required.

Release regressions cover entitlement filtering, source acquisition, safe cache
fallback, timeline fencing, inert drafts, read-only navigation, explicit action
authorization, idempotency, uncertain-result polling, result-cut presentation,
safe search/export, noncanonical notes, and AI-independent result retry.
