"""Literal JSON contract fixtures, never implementations of external systems.

Unconfigured boundaries fail closed. Fixtures are supplied by trusted test/setup
code, not by a gameplay command. A fixture is selected by owner, operation and
resource/request reference and returned verbatim. There is no foreign clock,
inventory, health, authority, policy, or NPC simulation here.
"""

from __future__ import annotations

from .state import Object, clone, require


def request_system_9(request: Object) -> Object:
    return {"status": "OWNER_UNAVAILABLE", "owner": "system9", "source_ref": "dummy-starting-resources"}


def request_system_10(request: Object) -> Object:
    return {"status": "OWNER_UNAVAILABLE", "owner": "system10", "source_ref": "dummy-resolution"}


def request_system_11(request: Object) -> Object:
    return {"status": "OWNER_UNAVAILABLE", "owner": "system11", "source_ref": "dummy-clock"}


def request_system_12(request: Object) -> Object:
    return {"status": "OWNER_UNAVAILABLE", "owner": "system12", "source_ref": "dummy-location"}


def request_system_13(request: Object) -> Object:
    return {"status": "OWNER_UNAVAILABLE", "owner": "system13", "source_ref": "dummy-work"}


def request_inventory(request: Object) -> Object:
    return {"status": "OWNER_UNAVAILABLE", "owner": "inventory", "source_ref": "dummy-item-receipt"}


def request_health(request: Object) -> Object:
    return {"status": "OWNER_UNAVAILABLE", "owner": "health", "source_ref": "dummy-health-receipt"}


def request_travel(request: Object) -> Object:
    return {"status": "OWNER_UNAVAILABLE", "owner": "travel", "source_ref": "dummy-route"}


def request_institutions(request: Object) -> Object:
    return {"status": "OWNER_UNAVAILABLE", "owner": "institutions", "source_ref": "dummy-authority"}


def request_crime_encounters(request: Object) -> Object:
    return {"status": "OWNER_UNAVAILABLE", "owner": "crime", "source_ref": "dummy-event"}


def request_relationships(request: Object) -> Object:
    return {"status": "OWNER_UNAVAILABLE", "owner": "relationships", "source_ref": "dummy-decision"}


def request_knowledge(request: Object) -> Object:
    return {"status": "OWNER_UNAVAILABLE", "owner": "knowledge", "source_ref": "dummy-observation"}


def request_content(request: Object) -> Object:
    return {"status": "POLICY_MISSING", "owner": "content", "source_ref": "dummy-policy"}


def request_ui(request: Object) -> Object:
    return {"status": "ACCESS_DENIED", "owner": "ui", "source_ref": "dummy-player-authority"}


def publish_external(request: Object) -> Object:
    """Outgoing placeholder: a missing owner never fabricates acknowledgment."""
    return {"status": "OWNER_PENDING", "receipt_ref": None}


STUBS = {
    "system9": request_system_9, "system10": request_system_10,
    "system11": request_system_11, "system12": request_system_12,
    "system13": request_system_13, "inventory": request_inventory,
    "health": request_health, "travel": request_travel,
    "institutions": request_institutions, "crime": request_crime_encounters,
    "relationships": request_relationships, "knowledge": request_knowledge,
    "content": request_content, "ui": request_ui,
}


class DummyDependencies:
    """Inject immutable JSON examples without modelling external behaviour.

    Keys: (owner, operation, reference). Outgoing two-phase calls use
    'prepare:<operation>', 'commit:<operation>', and 'abort:<operation>'.
    Commit/abort requests carry stable idempotency identities.
    """

    def __init__(self, fixtures: dict[tuple[str, str, str], Object] | None = None):
        self.fixtures = {k: clone(v) for k, v in (fixtures or {}).items()}

    @classmethod
    def from_json(cls, records: list[Object]) -> DummyDependencies:
        """Load trusted literal fixtures from JSON; never accept these in commands.

        Each row: {"owner": "system11", "operation": "now",
                   "reference": "request-1", "response": {"status": "OK", "sim_time": 0}}.
        """
        require(type(records) is list, "INVALID_JSON")
        fixtures = {}
        for record in records:
            require(type(record) is dict and set(record) == {"owner", "operation", "reference", "response"}, "INVALID_JSON")
            require(record["owner"] in STUBS and type(record["operation"]) is str
                    and type(record["reference"]) is str and type(record["response"]) is dict, "INVALID_JSON")
            fixture_key = record["owner"], record["operation"], record["reference"]
            require(fixture_key not in fixtures, "DUPLICATE_REQUEST")
            fixtures[fixture_key] = clone(record["response"])
        return cls(fixtures)

    def call(self, owner: str, operation: str, reference: str, request: Object) -> Object:
        require(owner in STUBS, "OWNER_UNAVAILABLE")
        fixture = self.fixtures.get((owner, operation, reference))
        if fixture is not None:
            return clone(fixture)
        if operation.startswith(("prepare:", "commit:", "abort:")):
            return publish_external(request)
        return STUBS[owner](request)
