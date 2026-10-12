"""Stateless JSON fixtures, not implementations of external systems.

Each dependency has a ``snapshot`` and optional ``receipts`` indexed by the
outgoing idempotency key. Fixtures are trusted test inputs, never player input.
No stub mutates state, resolves an action, advances time, transfers an object,
or manufactures a successful receipt. Missing dependencies fail closed.
"""

from copy import deepcopy
from typing import Any, Callable

JSON = dict[str, Any]


def _stub(owner: str, request: JSON, fixtures: JSON | None = None) -> JSON:
    fixture = (fixtures or {}).get(owner, {})
    if request.get("kind") in {"effect", "receipt"}:
        return deepcopy(fixture.get("receipts", {}).get(
            request["idempotency_key"],
            {"status": "pending", "event_ref": None, "mock": True},
        ))
    return deepcopy(fixture.get("snapshot", {
        "available": False, "records": {}, "mock": True,
    }))


def request_system_9(request: JSON, fixtures: JSON | None = None) -> JSON:
    return _stub("system_9", request, fixtures)


def request_system_10(request: JSON, fixtures: JSON | None = None) -> JSON:
    return _stub("system_10", request, fixtures)


def request_system_11(request: JSON, fixtures: JSON | None = None) -> JSON:
    return _stub("system_11", request, fixtures)


def request_system_12(request: JSON, fixtures: JSON | None = None) -> JSON:
    return _stub("system_12", request, fixtures)


def request_system_13(request: JSON, fixtures: JSON | None = None) -> JSON:
    return _stub("system_13", request, fixtures)


def request_system_14(request: JSON, fixtures: JSON | None = None) -> JSON:
    return _stub("system_14", request, fixtures)


def request_system_15(request: JSON, fixtures: JSON | None = None) -> JSON:
    return _stub("system_15", request, fixtures)


def request_system_16(request: JSON, fixtures: JSON | None = None) -> JSON:
    return _stub("system_16", request, fixtures)


def request_system_17(request: JSON, fixtures: JSON | None = None) -> JSON:
    return _stub("system_17", request, fixtures)


def request_system_18(request: JSON, fixtures: JSON | None = None) -> JSON:
    return _stub("system_18", request, fixtures)


def request_system_19(request: JSON, fixtures: JSON | None = None) -> JSON:
    return _stub("system_19", request, fixtures)


def request_knowledge(request: JSON, fixtures: JSON | None = None) -> JSON:
    return _stub("knowledge", request, fixtures)


def request_memory(request: JSON, fixtures: JSON | None = None) -> JSON:
    return _stub("memory", request, fixtures)


def request_relationships(request: JSON, fixtures: JSON | None = None) -> JSON:
    return _stub("relationships", request, fixtures)


def request_consent(request: JSON, fixtures: JSON | None = None) -> JSON:
    return _stub("consent", request, fixtures)


def request_evidence(request: JSON, fixtures: JSON | None = None) -> JSON:
    return _stub("evidence", request, fixtures)


def request_player_input(request: JSON, fixtures: JSON | None = None) -> JSON:
    return _stub("player_input", request, fixtures)


def request_content_manifests(request: JSON, fixtures: JSON | None = None) -> JSON:
    return _stub("content_manifests", request, fixtures)


def request_narration_ui(request: JSON, fixtures: JSON | None = None) -> JSON:
    return _stub("narration_ui", request, fixtures)


STUBS: dict[str, Callable[[JSON, JSON | None], JSON]] = {
    **{f"system_{n}": globals()[f"request_system_{n}"] for n in range(9, 20)},
    "knowledge": request_knowledge,
    "memory": request_memory,
    "relationships": request_relationships,
    "consent": request_consent,
    "evidence": request_evidence,
    "player_input": request_player_input,
    "content_manifests": request_content_manifests,
    "narration_ui": request_narration_ui,
}
