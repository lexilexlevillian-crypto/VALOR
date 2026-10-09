"""Fixed dummy JSON boundaries. No external owner is imported or simulated.

Fixtures are trusted test/content inputs, not fields accepted from player commands.
Keys are owner:operation:resource, owner:operation, or owner (most specific wins).
Missing grants fail closed. Writes merely acknowledge an idempotency-keyed payload.
"""

from copy import deepcopy
from typing import Any


def request_system_3(payload: dict) -> dict:
    return {"allowed": False, "scope": {}, "known_failure_codes": [], "receipt": "mock-s3"}


def request_system_4(payload: dict) -> dict:
    return {"known_endpoints": [], "known_information_refs": [], "receipt": "mock-s4"}


def request_system_5_6(payload: dict) -> dict:
    return {"eligible": False, "decision_ref": None, "receipt": "mock-s5-s6"}


def request_system_7_8(payload: dict) -> dict:
    return {"context_refs": [], "receipt": "mock-s7-s8"}


def request_system_9(payload: dict) -> dict:
    return {"identity_associations": [], "receipt": "mock-s9"}


def request_system_10(payload: dict) -> dict:
    return {"resolved": False, "coverage": {}, "receipt": "mock-s10"}


def request_system_11(payload: dict) -> dict:
    return {"now": 0, "due_event_ids": [], "order": None, "receipt": "mock-s11"}


def request_system_12(payload: dict) -> dict:
    return {"line_of_sight": False, "coverage": {}, "receipt": "mock-s12"}


def request_system_14(payload: dict) -> dict:
    return {"accepted": False, "reservation_refs": [], "receipt": "mock-s14"}


def request_system_15(payload: dict) -> dict:
    return {"present": False, "accessible": False, "powered": False, "compatible": False, "receipt": "mock-s15"}


def request_dialogue(payload: dict) -> dict:
    return {"feasible": False, "choice_required": True, "receipt": "mock-dialogue"}


def request_infrastructure(payload: dict) -> dict:
    return {"available": False, "authorized": False, "region": "mock-region", "receipt": "mock-infrastructure"}


def request_investigation(payload: dict) -> dict:
    return {"authorized": False, "coverage": {}, "receipt": "mock-investigation"}


def request_player(payload: dict) -> dict:
    return {"explicit": False, "authorized": False, "receipt": "mock-player"}


def request_configuration(payload: dict) -> dict:
    return {"available": False, "policies": {}, "receipt": "mock-configuration"}


def notify_external_owner(payload: dict) -> dict:
    """Outgoing placeholder: accepts a dummy payload without changing an owner."""
    return {"accepted": True, "receipt": "mock-outgoing"}


READERS = {
    "system3": request_system_3, "system4": request_system_4,
    "system5_6": request_system_5_6, "system7_8": request_system_7_8,
    "system9": request_system_9, "system10": request_system_10,
    "system11": request_system_11, "system12": request_system_12,
    "system14": request_system_14, "system15": request_system_15,
    "dialogue": request_dialogue, "infrastructure": request_infrastructure,
    "investigation": request_investigation, "player": request_player,
    "configuration": request_configuration,
}


class MockDependencies:
    """A static JSON fixture selector; it has no clocks, balances, beliefs or plans."""

    __slots__ = ("fixtures",)

    def __init__(self, fixtures: dict[str, Any] | None = None):
        self.fixtures = deepcopy(fixtures or {})

    def read(self, owner: str, operation: str, resource: str = "", **payload: Any) -> dict:
        for key in (f"{owner}:{operation}:{resource}", f"{owner}:{operation}", owner):
            if key in self.fixtures:
                return deepcopy(self.fixtures[key])
        return READERS[owner]({"operation": operation, "resource": resource, **payload})

    def write(self, owner: str, event: str, key: str, **payload: Any) -> dict:
        fixture = self.fixtures.get(f"write:{owner}:{event}")
        if fixture is not None:
            return deepcopy(fixture)
        return notify_external_owner({"owner": owner, "event": event, "request_key": key, **payload})

    def policy(self, ref: str) -> dict:
        from .state import ContractError
        value = self.read("configuration", "policy", ref)
        if value.get("version") != ref:
            raise ContractError("POLICY_UNAVAILABLE", "OWNER_PENDING")
        return value
