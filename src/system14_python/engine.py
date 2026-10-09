"""Deterministic, durable System 14 state machine with JSON-only boundaries.

Public contract: System14.process(Command) -> Response. Money is integer cents;
time is integer simulation seconds from the clock stub. Unspecified policies
must be provided by the content stub; there are no permissive policy defaults.

SQLite BEGIN IMMEDIATE serializes writers across threads/processes. Local state
and the coordinator decision are committed together. Foreign effects use durable
prepare/commit calls and are retried by recover(); no foreign implementation is
imported. Snapshot/result/command documents occupy the specified structured
content field of private observation records, not extra domain-state variables.

The constructor's initial_state and export_state() are trusted storage/migration
interfaces, never player commands. Production callers must not expose them to AI.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from contextlib import contextmanager
from fractions import Fraction
from pathlib import Path
from typing import TypedDict, NotRequired, Any

from .dependencies import DummyDependencies
from .operations import Operations, OPERATIONS
from .state import (
    System14State, Object, JSON, SCHEMA, FIELDS, DomainError, require, money,
    integer, rational, ratio, quantity, round_half_up, canonical, clone, key,
)


class Command(TypedDict):
    operation: str
    branch_id: str
    principal_id: str
    request_id: str
    request_key: str
    expected_revision: int
    source_context_ref: str
    causal_event_ref: str
    source_revision: int
    policy_version: str
    principal_authority_ref: str
    target_ref: str
    payload: Object
    spending_authorization_ref: NotRequired[str | None]


class Response(TypedDict, total=False):
    status: str
    request_id: str
    transaction_refs: list[str]
    receipt_refs: list[str]
    effective_time: int
    result: Object
    failure_code: str
    remaining_reservations: list[str]
    cancellable: bool
    choice_required: bool


class SimulatedCrash(BaseException):
    """Test hook; represents process loss, never a gameplay failure response."""


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def command_digest(command: Command) -> str:
    """Authority fixtures must bind the exact command, not just an actor name."""
    return digest(command)


def reference(prefix: str, *parts: Any) -> str:
    return prefix + ":" + digest(list(parts))[:32]


class Context:
    """Transient execution workspace; not part of canonical domain state."""

    def __init__(self, engine: System14, state: System14State, command: Command, now: int,
                 authority: Object, resuming: bool = False):
        self.engine, self.state, self.command = engine, state, command
        self.branch, self.principal = command["branch_id"], command["principal_id"]
        self.now, self.authority, self.resuming = now, authority, resuming
        self.payload = command["payload"]
        self.request_ref = reference("request", self.branch, self.principal, command["request_key"])
        self.tx_ref = reference("transaction", self.request_ref)
        self.effects: list[Object] = []
        self.reservations: dict[str, Object] = {}
        self.stock_reservations: dict[str, Object] = {}
        self.events: list[str] = []
        self.result: Object = {}
        self.status = "COMMITTED"

    def get(self, table: str, ref: str) -> Object:
        return self.state.get(table, self.branch, ref)

    def put(self, table: str, ref: str, record: Object) -> Object:
        if table == "outbox_and_recovery" and ref not in self.events:
            self.events.append(ref)
        return self.state.put(table, self.branch, ref, record)

    def call(self, owner: str, operation: str, ref: str, payload: Object | None = None) -> Object:
        request = {
            "branch_id": self.branch, "request_id": self.command["request_id"],
            "causal_event_id": self.command["causal_event_ref"],
            "source_revision": self.command["source_revision"],
            "policy_version": self.command["policy_version"],
            "principal_authority_ref": self.command["principal_authority_ref"],
            "principal_id": self.principal, "payload": clone(payload or {}),
        }
        try:
            result = self.engine.dependencies.call(owner, operation, ref, request)
        except Exception:
            raise DomainError("OWNER_UNAVAILABLE") from None
        require(type(result) is dict, "OWNER_UNAVAILABLE")
        if result.get("status") != "OK":
            allowed = {"OWNER_UNAVAILABLE", "OWNER_PENDING", "POLICY_MISSING", "ACCESS_DENIED", "CHOICE_REQUIRED"}
            raise DomainError(result.get("status") if result.get("status") in allowed else "OWNER_UNAVAILABLE")
        return result

    def policy(self, ref: str, version: str | None = None) -> Object:
        value = self.call("content", "policy", ref)
        require(value.get("policy_version") == (version or self.command["policy_version"]), "POLICY_MISSING")
        require(type(value.get("policy")) is dict, "POLICY_MISSING")
        return value["policy"]

    def revision(self, record: Object) -> None:
        if not self.resuming:
            require(record.get("revision", 0) == self.command["expected_revision"], "REVISION_CONFLICT")

    def effect(self, owner: str, operation: str, ref: str, payload: Object,
               patches: list[Object] | None = None) -> None:
        self.effects.append({"owner": owner, "operation": operation, "reference": ref,
                             "payload": clone(payload), "patches": patches or []})

    def event(self, event_type: str, source: str, period: str | None = None) -> str:
        event_id = reference("event", self.branch, event_type, source, period)
        if self.state.find("outbox_and_recovery", self.branch, event_id) is None:
            self.put("outbox_and_recovery", event_id, {
                "event_id": event_id, "event_type": event_type,
                "source_transaction_or_receipt_ref": source,
                "subscriber_delivery_state": {}, "timer_or_period_key": period,
                "reconciliation_issue_refs": [], "correction_or_reversal_refs": [],
            })
        return event_id

    def time_effect(self, activity_ref: str) -> None:
        timing = self.call("system11", "activity", activity_ref)
        require(timing.get("interruption_ref") is None, "CHOICE_REQUIRED")
        require(integer(timing.get("elapsed_seconds")) >= 0, "OWNER_UNAVAILABLE")
        self.effect("system11", "advance", activity_ref, {"timing_receipt_ref": timing["receipt_ref"]})


class System14(Operations):
    """Durable isolated engine. Dependency fixtures are explicitly trusted inputs."""

    def __init__(self, database: str | Path = ":memory:", *,
                 dependencies: DummyDependencies | None = None,
                 initial_state: System14State | None = None):
        self.dependencies = dependencies or DummyDependencies()
        self._lock = threading.RLock()
        self._db = sqlite3.connect(str(database), isolation_level=None, check_same_thread=False, timeout=30)
        self._db.execute("PRAGMA busy_timeout=30000")
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=FULL")
        self._db.execute("CREATE TABLE IF NOT EXISTS system14_snapshot (singleton INTEGER PRIMARY KEY CHECK(singleton=1), state_json TEXT NOT NULL)")
        with self._transaction():
            if self._db.execute("SELECT 1 FROM system14_snapshot WHERE singleton=1").fetchone() is None:
                state = initial_state or System14State()
                self._validate(state)
                self._db.execute("INSERT INTO system14_snapshot VALUES (1, ?)", (canonical(state.export()),))

    @contextmanager
    def _transaction(self):
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                yield
                self._db.execute("COMMIT")
            except BaseException:
                self._db.execute("ROLLBACK")
                raise

    def close(self) -> None:
        with self._lock:
            self._db.close()

    def _load(self) -> System14State:
        return System14State.restore(json.loads(self._db.execute("SELECT state_json FROM system14_snapshot WHERE singleton=1").fetchone()[0]))

    def _save(self, state: System14State) -> None:
        self._validate(state)
        self._db.execute("UPDATE system14_snapshot SET state_json=? WHERE singleton=1", (canonical(state.export()),))

    def export_state(self) -> Object:
        """Trusted backup only. Gameplay/AI must use ViewRecord instead."""
        with self._lock:
            return self._load().export()

    @staticmethod
    def _balance(state: System14State, branch: str, account: str) -> int:
        return money(sum(p["amount_cents"] for _, p in state.rows("money_posting", branch) if p["account_id"] == account))

    @staticmethod
    def _holds(state: System14State, branch: str, account: str, exclude: str | None = None) -> int:
        return money(sum(h["amount_cents"] - h["captured_cents"] for ref, h in state.rows("funds_hold", branch)
                         if h["account_id"] == account and h["state"] == "ACTIVE" and ref != exclude))

    def _validate(self, state: System14State) -> None:
        """Whole-snapshot invariants run before every durable state mutation."""
        state.__post_init__()
        branches = {json.loads(k)[0] for table in FIELDS for k in state.table(table)}
        for branch in branches:
            transaction_keys, obligation_keys, interest_keys = set(), set(), set()
            sums: dict[tuple[str, str], int] = {}
            for _, p in state.rows("money_posting", branch):
                account = state.get("economic_account", branch, p["account_id"])
                state.get("money_transaction", branch, p["transaction_id"])
                require(account["currency"] == p["currency"], "INVALID_CURRENCY")
                pair = (p["transaction_id"], p["currency"])
                sums[pair] = sums.get(pair, 0) + money(p["amount_cents"])
            require(all(value == 0 for value in sums.values()), "UNBALANCED_TRANSACTION")
            for _, tx in state.rows("money_transaction", branch):
                unique = (tx["principal_id"], tx["request_key"])
                require(unique not in transaction_keys, "DUPLICATE_REQUEST")
                transaction_keys.add(unique)
            for ref, account in state.rows("economic_account", branch):
                available = money(self._balance(state, branch, ref) - self._holds(state, branch, ref))
                require(available >= 0 or account["kind"] in {"SCENARIO_SOURCE", "LIABILITY"}, "INSUFFICIENT_AVAILABLE_FUNDS")
                if account["kind"] == "CASH":
                    cash = sum(p["value_cents"] for _, p in state.rows("cash_custody", branch) if p["cash_account_id"] == ref)
                    require(cash == self._balance(state, branch, ref), "CUSTODY_MISMATCH")
            for _, h in state.rows("funds_hold", branch):
                state.get("economic_account", branch, h["account_id"])
                require(0 <= h["captured_cents"] <= h["amount_cents"], "INVALID_HOLD")
            for _, custody in state.rows("cash_custody", branch):
                require(custody["value_cents"] >= 0, "CUSTODY_MISMATCH")
                state.get("economic_account", branch, custody["cash_account_id"])
                if custody.get("denomination_counts") is not None:
                    total = 0
                    for denomination, count in custody["denomination_counts"].items():
                        require(denomination.isdigit() and int(denomination) > 0 and integer(count) >= 0, "CUSTODY_MISMATCH")
                        total += int(denomination) * count
                    require(total == custody["value_cents"], "CUSTODY_MISMATCH")
            for _, obligation in state.rows("obligation", branch):
                terms = state.get("obligation_terms", branch, obligation["agreement_id"])
                unique = (obligation["agreement_id"], obligation["period_key"], terms["charge_type"])
                require(unique not in obligation_keys, "DUPLICATE_PERIOD")
                obligation_keys.add(unique)
                require(0 <= obligation["settled_cents"] <= obligation["issued_cents"], "INVALID_ALLOCATION")
                allocated = sum(a["principal_cents"] + a["interest_cents"] + a["fee_cents"]
                                for _, a in state.rows("settlement_allocation", branch) if a["obligation_ref"] == obligation["id"])
                require(allocated == obligation["settled_cents"], "INVALID_ALLOCATION")
            for _, interval in state.rows("debt_accrual_interval", branch):
                if interval["interest_posting_ref"] is not None:
                    unique = (interval["debt_ref"], interval["statement_interval_key"])
                    require(unique not in interest_keys, "DUPLICATE_PERIOD")
                    interest_keys.add(unique)
            for _, debt in state.rows("debt_agreement", branch):
                require(debt["outstanding_principal_cents"] >= 0 and debt["posted_interest_outstanding_cents"] >= 0, "INVALID_DEBT")
                require(rational(debt["annual_rate"]) >= 0 and integer(debt["accrual_basis"]) > 0, "INVALID_DEBT")
            for _, reservation in state.rows("stock_or_service_reservation", branch):
                require(quantity(reservation["fulfilled_quantity"]) <= quantity(reservation["reserved_quantity_or_capacity"]), "STOCK_UNAVAILABLE")
            for _, quote in state.rows("quote", branch):
                subtotal = sum(state.get("quote_line", branch, line)["line_total_cents"] for line in quote["line_refs"])
                charges = sum(money(charge["amount_cents"], nonnegative=True) for charge in quote["tax_lines"] + quote["service_charge_lines"])
                require(quote["subtotal_cents"] == subtotal and quote["tip_cents"] >= 0 and quote["deposit_applied_cents"] >= 0, "INVALID_QUOTE")
                require(quote["final_cents"] == money(subtotal + charges + quote["tip_cents"] - quote["deposit_applied_cents"], nonnegative=True), "INVALID_QUOTE")
            for _, sale in state.rows("order_and_sale_receipt", branch):
                require(0 <= sale["refunded_cents"] <= sale["captured_cents"], "REFUND_EXCEEDS_CAPTURE")
            for _, deposit in state.rows("tenancy_deposit", branch):
                require(0 <= deposit["remaining_held_cents"] <= deposit["held_liability_cents"], "INVALID_DEPOSIT")
                require(deposit["remaining_held_cents"] + deposit["accepted_or_adjudicated_deductions_cents"] <= deposit["held_liability_cents"], "INVALID_DEPOSIT")
            agreements = list(state.rows("occupancy_agreement", branch))
            for i, (_, a) in enumerate(agreements):
                if a["status"] not in {"ACCEPTED", "ACTIVE"}:
                    continue
                offer = state.get("housing_offer_and_terms", branch, a["parties_ref"])
                if offer["exclusive_or_shared_occupancy_model"] != "EXCLUSIVE":
                    continue
                for _, b in agreements[i + 1:]:
                    if b["unit_id"] == a["unit_id"] and b["status"] in {"ACCEPTED", "ACTIVE"}:
                        require(max(a["start_time"], b["start_time"]) >= min(a["end_time"], b["end_time"]), "OCCUPANCY_CONFLICT")

    @staticmethod
    def _failure(command: dict, code: str) -> Response:
        choices = {"CAP_EXCEEDED", "STALE_QUOTE", "CHOICE_REQUIRED", "NO_SPENDING_MANDATE", "STOCK_UNAVAILABLE"}
        return {"status": "CHOICE_REQUIRED" if code in choices else "REJECTED",
                "request_id": command.get("request_id", ""), "failure_code": code,
                "remaining_reservations": [], "cancellable": False, "choice_required": code in choices}

    def _authorize(self, command: Command) -> Object:
        canonical(command)
        required = set(Command.__required_keys__) - {"spending_authorization_ref"}
        require(required <= set(command) and set(command) <= set(Command.__annotations__), "INVALID_COMMAND")
        for name in required - {"payload", "expected_revision", "source_revision"}:
            require(type(command[name]) is str and bool(command[name]), "INVALID_COMMAND")
        require(type(command["payload"]) is dict, "INVALID_COMMAND")
        integer(command["expected_revision"], "INVALID_COMMAND")
        integer(command["source_revision"], "INVALID_COMMAND")
        try:
            fact = self.dependencies.call("ui", "authorize", command["request_id"], clone(command))
        except Exception:
            raise DomainError("OWNER_UNAVAILABLE") from None
        require(type(fact) is dict, "OWNER_UNAVAILABLE")
        require(fact.get("status") == "OK" and fact.get("command_digest") == command_digest(command)
                and fact.get("principal_id") == command["principal_id"]
                and fact.get("branch_id") == command["branch_id"], "ACCESS_DENIED")
        require(fact.get("explicit_action") is True or fact.get("owner_event") is True
                or command["payload"].get("mandate_ref") is not None
                or command["operation"] in {"RunRoutine", "ViewRecord"}, "NO_SPENDING_MANDATE")
        return fact

    def _document(self, state: System14State, branch: str, ref: str, principal: str, content: Object, now: int) -> None:
        state.put("notice_and_observation_channel", branch, ref, {
            "id": ref, "record_or_event_ref": ref, "content": clone(content),
            "sender_authority_ref": "system14", "target_ref": principal, "channel_ref": "SYSTEM14_INTERNAL",
            "authorized_reader_refs": [], "attempted_time": now, "delivered_time": None,
            "observed_time": None, "effective_service_time": None, "evidence_and_correction_refs": [],
        })

    def _coordinator(self, c: Context, result: Response, decision: str, effects: list[Object], prepared: list[str]) -> None:
        doc_ref = reference("request-document", c.request_ref)
        self._document(c.state, c.branch, doc_ref, c.principal, {
            "command": c.command, "digest": command_digest(c.command), "result": result,
            "effects": effects, "authority": c.authority, "completion_status": c.status, "event_refs": list(c.events),
        }, c.now)
        c.put("request_and_coordinator", c.request_ref, {
            "branch_id": c.branch, "principal_id": c.principal,
            "request_id": c.command["request_id"], "request_key": c.command["request_key"],
            "expected_revision": c.command["expected_revision"], "source_context_ref": doc_ref,
            "causal_event_ref": c.command["causal_event_ref"], "source_revision": c.command["source_revision"],
            "policy_version": c.command["policy_version"], "principal_authority_ref": c.command["principal_authority_ref"],
            "target_ref": c.command["target_ref"], "spending_authorization_ref": c.command.get("spending_authorization_ref"),
            "participant_reservation_refs": list(c.reservations) + list(c.stock_reservations),
            "participant_prepare_receipts": prepared, "coordinator_decision": decision,
            "owner_acknowledgment_refs": [], "persisted_result_ref": doc_ref,
            "response_status": result["status"], "failure_code": result.get("failure_code"),
            "cancellable_scope": "UNCOMMITTED_ONLY" if decision == "UNDECIDED" else "NONE",
        })

    def process(self, command: Command, *, crash_at: str | None = None) -> Response:
        """JSON in/out. Crash hooks: before_decision, after_decision, after_owner_commit."""
        try:
            authority = self._authorize(command)
            branch, principal = command["branch_id"], command["principal_id"]
            request_ref = reference("request", branch, principal, command["request_key"])
            restart = False
            with self._transaction():
                base = self._load()
                existing = base.find("request_and_coordinator", branch, request_ref)
                if existing:
                    document = base.get("notice_and_observation_channel", branch, existing["persisted_result_ref"])["content"]
                    require(document["digest"] == command_digest(command), "DUPLICATE_REQUEST")
                    if existing["coordinator_decision"] != "UNDECIDED":
                        return clone(document["result"])
                for other_ref, other in base.rows("request_and_coordinator", branch):
                    if other_ref == request_ref or other["target_ref"] != command["target_ref"] or other["coordinator_decision"] != "COMMIT":
                        continue
                    other_doc = base.get("notice_and_observation_channel", branch, other["source_context_ref"])["content"]
                    require(len(other["owner_acknowledgment_refs"]) == len(other_doc["effects"])
                            or command["operation"] == "ViewRecord", "OWNER_PENDING")
                try:
                    clock = self.dependencies.call("system11", "now", command["request_id"], clone(command))
                except Exception:
                    raise DomainError("OWNER_UNAVAILABLE") from None
                require(type(clock) is dict, "OWNER_UNAVAILABLE")
                require(clock.get("status") == "OK", "OWNER_UNAVAILABLE")
                now = integer(clock.get("sim_time"), "OWNER_UNAVAILABLE")
                c = Context(self, System14State.restore(base.export()), command, now, authority, bool(existing))
                try:
                    handler = getattr(self, "_cmd_" + command["operation"], None)
                    require(handler is not None and command["operation"] in OPERATIONS, "INVALID_COMMAND")
                    handler(c)
                    self._validate(c.state)
                except DomainError as failure:
                    # Failed commands retain no proposed domain mutations. Unpaid
                    # entitlements/obligations already in the base remain intact.
                    c.state = base
                    self._release_request(c, request_ref)
                    result = self._failure(command, failure.code)
                    old_effects = document["effects"] if existing else []
                    old_prepared = existing["participant_prepare_receipts"] if existing else []
                    self._coordinator(c, result, "ABORT", old_effects, old_prepared)
                    self._save(c.state)
                    return result
                prepared: list[str] = []
                waiting = False
                prepare_failure = None
                # Persist the intent and reservations BEFORE contacting a prepare
                # participant. A real crash anywhere after this point is recoverable.
                restart = bool(c.effects) and existing is None
                if not restart:
                    for index, effect in enumerate(c.effects):
                        outcome = self._effect_call(c.command, c.request_ref, index, effect, "prepare")
                        if outcome.get("status") == "OK" and type(outcome.get("receipt_ref")) is str:
                            prepared.append(outcome["receipt_ref"])
                        else:
                            waiting = True
                            if outcome.get("status") in {"REJECTED", "ACCESS_DENIED", "STOCK_UNAVAILABLE", "REVISION_CONFLICT"}:
                                prepare_failure = outcome["status"] if outcome["status"] != "REJECTED" else "OWNER_REJECTED"
                if prepare_failure:
                    c.state = base
                    self._release_request(c, request_ref)
                    result = self._failure(command, prepare_failure)
                    self._coordinator(c, result, "ABORT", c.effects, prepared)
                    self._save(c.state)
                    return result
                if restart or waiting or crash_at == "before_decision":
                    # Retain only resource reservations, never speculative postings.
                    for ref, hold in c.reservations.items():
                        reserved = clone(hold)
                        # A pending approved facility draw reserves its lender's
                        # funds. Borrower's unreceived funds cannot become a hold.
                        available = self._balance(base, branch, hold["account_id"]) - self._holds(base, branch, hold["account_id"], ref)
                        reserved["amount_cents"] = min(reserved["amount_cents"], max(0, available))
                        reserved["captured_cents"] = min(reserved["captured_cents"], reserved["amount_cents"])
                        base.put("funds_hold", branch, ref, reserved)
                    for ref, reservation in c.stock_reservations.items():
                        base.put("stock_or_service_reservation", branch, ref, clone(reservation))
                    c.state = base
                    pending: Response = {"status": "OWNER_PENDING", "request_id": command["request_id"],
                        "remaining_reservations": list(c.reservations) + list(c.stock_reservations),
                        "cancellable": True, "choice_required": False}
                    self._coordinator(c, pending, "UNDECIDED", c.effects, prepared)
                    self._save(c.state)
                    result = pending
                else:
                    result = {"status": c.status, "request_id": command["request_id"],
                              "transaction_refs": [c.tx_ref] if c.state.find("money_transaction", branch, c.tx_ref) else [],
                              "receipt_refs": [], "effective_time": now, "result": clone(c.result)}
                    if c.effects:
                        result["status"] = "OWNER_PENDING"
                        result["cancellable"] = False
                    self._coordinator(c, result, "COMMIT", c.effects, prepared)
                    self._save(c.state)
            if restart:
                if crash_at == "before_prepare":
                    raise SimulatedCrash(crash_at)
                return self.process(command, crash_at=crash_at)
            if crash_at in {"before_decision", "after_decision"}:
                raise SimulatedCrash(crash_at)
            if waiting:
                return result
            try:
                return self._complete(branch, request_ref, crash_at=crash_at)
            except DomainError:
                return {"status": "OWNER_PENDING", "request_id": command["request_id"],
                        "failure_code": "RECONCILIATION_REQUIRED", "cancellable": False}
        except DomainError as failure:
            return self._failure(command if type(command) is dict else {}, failure.code)
        except (KeyError, TypeError, ValueError, IndexError):
            return self._failure(command if type(command) is dict else {}, "INVALID_COMMAND")
        except sqlite3.Error:
            return {"status": "PENDING", "request_id": command.get("request_id", ""),
                    "failure_code": "STORAGE_UNAVAILABLE", "cancellable": False}

    def _effect_call(self, command: Command, request_ref: str, index: int, effect: Object, phase: str) -> Object:
        try:
            result = self.dependencies.call(effect["owner"], phase + ":" + effect["operation"], effect["reference"], {
                "branch_id": command["branch_id"], "request_id": command["request_id"],
                "causal_event_id": command["causal_event_ref"], "source_revision": command["source_revision"],
                "policy_version": command["policy_version"], "principal_authority_ref": command["principal_authority_ref"],
                "idempotency_key": reference("owner-operation", request_ref, index), "payload": clone(effect["payload"]),
            })
            return result if type(result) is dict else {"status": "OWNER_PENDING"}
        except Exception:
            return {"status": "OWNER_PENDING"}

    def _complete(self, branch: str, request_ref: str, *, crash_at: str | None = None) -> Response:
        with self._transaction():
            state = self._load()
            coordinator = state.get("request_and_coordinator", branch, request_ref)
            document = state.get("notice_and_observation_channel", branch, coordinator["persisted_result_ref"])["content"]
            if coordinator["coordinator_decision"] == "UNDECIDED":
                return clone(document["result"])
            abort = coordinator["coordinator_decision"] == "ABORT"
            acknowledgments = coordinator["owner_acknowledgment_refs"]
            for index, effect in enumerate(document["effects"]):
                operation_ref = reference("owner-operation", request_ref, index)
                if operation_ref in acknowledgments:
                    continue
                result = self._effect_call(document["command"], request_ref, index, effect, "abort" if abort else "commit")
                if result.get("status") != "OK" or type(result.get("receipt_ref")) is not str:
                    break
                if crash_at == "after_owner_commit":
                    raise SimulatedCrash(crash_at)
                if not abort:
                    for patch in effect["patches"]:
                        record = state.get(patch["table"], branch, patch["reference"])
                        for field, value in patch.get("set", {}).items():
                            record[field] = result["receipt_ref"] if value == "$OWNER_RECEIPT" else clone(value)
                        for field in patch.get("append_receipt", []):
                            if result["receipt_ref"] not in record[field]:
                                record[field].append(result["receipt_ref"])
                        for field, changes in patch.get("merge", {}).items():
                            record[field].update(clone(changes))
                    document["result"].setdefault("receipt_refs", []).append(result["receipt_ref"])
                acknowledgments.append(operation_ref)
            if not abort and len(acknowledgments) == len(document["effects"]):
                document["result"]["status"] = document["completion_status"]
                coordinator["response_status"] = document["result"]["status"]
            self._save(state)
            return clone(document["result"])

    def recover(self) -> list[Response]:
        """Trusted recovery worker. Replays persisted decisions, not world logic."""
        with self._lock:
            state = self._load()
        jobs = [(json.loads(scoped)[0], json.loads(scoped)[1], clone(row))
                for scoped, row in state.table("request_and_coordinator").items()]
        results = []
        for branch, ref, row in jobs:
            if row["coordinator_decision"] == "UNDECIDED":
                command = state.get("notice_and_observation_channel", branch, row["source_context_ref"])["content"]["command"]
                results.append(self.process(command))
            else:
                results.append(self._complete(branch, ref))
        return results

    def _release_request(self, c: Context, request_ref: str) -> None:
        original = c.state.find("request_and_coordinator", c.branch, request_ref)
        if original is None:
            return
        require(original["coordinator_decision"] != "COMMIT", "ALREADY_COMMITTED")
        for ref in original["participant_reservation_refs"]:
            hold = c.state.find("funds_hold", c.branch, ref)
            if hold and hold["state"] == "ACTIVE":
                hold["state"], hold["revision"] = "RELEASED", hold["revision"] + 1
            reservation = c.state.find("stock_or_service_reservation", c.branch, ref)
            if reservation and reservation["state"] == "PREPARED":
                reservation["state"] = "RELEASED"

    def _instrument(self, c: Context, instrument_ref: str, source: str) -> Object:
        instrument = c.get("account_product_and_instrument", instrument_ref)
        require(instrument["account_id"] == source and c.principal in instrument["authorized_principals"], "ACCESS_DENIED")
        require(not instrument["freeze_authority_refs"], "INSTRUMENT_UNAVAILABLE")
        fact = c.call("institutions", "instrument", instrument_ref)
        require(fact.get("usable") is True, "INSTRUMENT_UNAVAILABLE")
        return instrument

    def _cash_delta(self, c: Context, account_ref: str, delta: int, custody_ref: str | None = None) -> None:
        account = c.get("economic_account", account_ref)
        if account["kind"] != "CASH":
            return
        candidates = [(ref, cash) for ref, cash in c.state.rows("cash_custody", c.branch)
                      if cash["cash_account_id"] == account_ref and (custody_ref is None or ref == custody_ref)]
        require(len(candidates) == 1, "CASH_NOT_PRESENT")
        ref, cash = candidates[0]
        fact = c.call("system12", "cash_custody", ref)
        require(fact.get("present") is True and fact.get("custody_authorized") is True, "CASH_NOT_PRESENT")
        cash["value_cents"] = money(cash["value_cents"] + delta, nonnegative=True)
        cash["revision"] += 1
        if cash["denomination_counts"] is not None:
            counts = fact.get("resulting_denomination_counts")
            require(type(counts) is dict and fact.get("authorized_delta_cents") == delta, "CHANGE_UNAVAILABLE")
            cash["denomination_counts"] = clone(counts)

    def _post(self, c: Context, account_ref: str, delta: int) -> None:
        account = c.get("economic_account", account_ref)
        if c.state.find("money_transaction", c.branch, c.tx_ref) is None:
            c.put("money_transaction", c.tx_ref, {
                "id": c.tx_ref, "branch_id": c.branch, "request_key": c.command["request_key"],
                "principal_id": c.principal, "source_event_id": c.command["causal_event_ref"],
                "sim_time": c.now, "policy_version": c.command["policy_version"], "status": "SETTLED",
            })
        posting_ref = reference("posting", c.tx_ref, account_ref)
        posting = c.state.find("money_posting", c.branch, posting_ref)
        if posting:
            posting["amount_cents"] = money(posting["amount_cents"] + delta)
        else:
            c.put("money_posting", posting_ref, {"transaction_id": c.tx_ref, "account_id": account_ref,
                  "currency": account["currency"], "amount_cents": money(delta)})
        account["revision"] += 1
        c.event("MoneySettled", c.tx_ref)

    def _transfer(self, c: Context, source: str, destination: str, amount: int,
                  instrument_ref: str | None, *, source_authorized: bool = False,
                  capture_hold: str | None = None, privileged: bool = False) -> None:
        amount = money(amount, nonnegative=True)
        require(amount > 0 and source != destination, "INVALID_AMOUNT")
        payer, recipient = c.get("economic_account", source), c.get("economic_account", destination)
        require(payer["currency"] == recipient["currency"], "INVALID_CURRENCY")
        require(payer["kind"] != "LIABILITY", "ACCESS_DENIED")
        # A bank claim cannot turn into banknotes merely by choosing a destination.
        # BankTransfer explicitly coordinates vault custody and bank liabilities.
        require(privileged or (payer["kind"] == "CASH") == (recipient["kind"] == "CASH"), "BANKING_REQUIRED")
        instrument = None
        if not source_authorized:
            require(instrument_ref is not None, "INSTRUMENT_UNAVAILABLE")
            instrument = self._instrument(c, instrument_ref, source)
        hold_ref = capture_hold or reference("hold", c.request_ref, source)
        existing_hold = c.state.find("funds_hold", c.branch, hold_ref)
        if capture_hold:
            require(existing_hold is not None and existing_hold["account_id"] == source and existing_hold["state"] == "ACTIVE", "INVALID_HOLD")
            require(existing_hold["expiry_time"] > c.now and existing_hold["amount_cents"] - existing_hold["captured_cents"] >= amount, "INVALID_HOLD")
            c.reservations[capture_hold] = clone(existing_hold)
        available = self._balance(c.state, c.branch, source) - self._holds(c.state, c.branch, source, hold_ref)
        if available < amount and instrument and instrument["overdraft_enabled"]:
            self._draw_facility(c, instrument, amount - available)
            available = self._balance(c.state, c.branch, source) - self._holds(c.state, c.branch, source, hold_ref)
        require(available >= amount or (privileged and payer["kind"] == "SCENARIO_SOURCE"), "INSUFFICIENT_AVAILABLE_FUNDS")
        if not privileged:
            if not capture_hold:
                already = c.reservations.get(hold_ref, {}).get("amount_cents", 0)
                hold = {"id": hold_ref, "account_id": source, "request_key": c.command["request_key"],
                        "amount_cents": money(already + amount), "expiry_time": c.now,
                        "captured_cents": 0, "state": "ACTIVE", "revision": 0}
                product_versions = {p["accepted_terms_version"] for _, p in c.state.rows("account_product_and_instrument", c.branch)
                                    if p["account_id"] == source and p["product_policy_ref"] == payer["product_policy_id"]}
                require(len(product_versions) <= 1, "POLICY_MISSING")
                product_version = next(iter(product_versions), c.command["policy_version"])
                hold_policy = c.policy(payer["product_policy_id"], product_version)
                hold["expiry_time"] = c.now + integer(hold_policy["reservation_seconds"])
                require(hold["expiry_time"] > c.now, "POLICY_MISSING")
                c.reservations[hold_ref] = clone(hold)
                c.put("funds_hold", hold_ref, hold)
                existing_hold = hold
            existing_hold["captured_cents"] = (money(existing_hold["captured_cents"] + amount)
                                               if capture_hold else existing_hold["amount_cents"])
            existing_hold["state"] = "CAPTURED"
            existing_hold["revision"] += 1
        self._cash_delta(c, source, -amount, c.payload.get("source_cash_ref"))
        self._cash_delta(c, destination, amount, c.payload.get("destination_cash_ref"))
        self._post(c, source, -amount)
        self._post(c, destination, amount)

    def _draw_facility(self, c: Context, instrument: Object, amount: int) -> None:
        require(c.payload.get("allow_facility_draw") is True and c.payload.get("mandate_ref") is None,
                "INSUFFICIENT_AVAILABLE_FUNDS")
        policy = c.policy(instrument["product_policy_ref"], instrument["accepted_terms_version"])
        require(policy.get("facility_draw_accepted") is True, "NO_SPENDING_MANDATE")
        debt = c.get("debt_agreement", policy["facility_debt_ref"])
        require(debt["outstanding_principal_cents"] + amount <= instrument["approved_facility_limit_cents"], "INSUFFICIENT_AVAILABLE_FUNDS")
        require(debt["borrower_ref"] == c.principal and debt["authority_ref"] == policy["facility_authority_ref"], "ACCESS_DENIED")
        self._accrue_to(c, debt, c.now)
        self._transfer(c, policy["facility_funding_account_ref"], instrument["account_id"], amount, None, source_authorized=True)
        debt["outstanding_principal_cents"] = money(debt["outstanding_principal_cents"] + amount)
        debt["disbursed_principal_cents"] = money(debt["disbursed_principal_cents"] + amount)
        for _, related in c.state.rows("account_product_and_instrument", c.branch):
            if related["account_id"] == instrument["account_id"] and related["product_policy_ref"] == instrument["product_policy_ref"]:
                related["facility_used_cents"] = debt["outstanding_principal_cents"]

    def _cmd_TransferFunds(self, c: Context) -> None:
        p = c.payload
        self._check_mandate(c, p["source"], p["cents"], "TransferFunds", p["destination"])
        c.revision(c.get("economic_account", p["source"]))
        self._transfer(c, p["source"], p["destination"], p["cents"], p["instrument"])
        c.result = {"amount_cents": p["cents"], "destination_ref": p["destination"]}

    def _cmd_GrantStartingResources(self, c: Context) -> None:
        fact = c.call("system9", "grant", c.command["target_ref"])
        require(fact.get("accepted") is True and fact.get("beneficiary_ref") == c.principal, "ACCESS_DENIED")
        grant_key = reference("grant", fact["grant_ref"])
        require(c.state.find("outbox_and_recovery", c.branch, grant_key) is None, "DUPLICATE_REQUEST")
        self._transfer(c, fact["source_account_ref"], fact["destination_account_ref"], fact["amount_cents"], None,
                       source_authorized=True, privileged=True)
        c.put("outbox_and_recovery", grant_key, {"event_id": grant_key, "event_type": "StartingGrantSettled",
            "source_transaction_or_receipt_ref": c.tx_ref, "subscriber_delivery_state": {},
            "timer_or_period_key": fact["grant_ref"], "reconciliation_issue_refs": [], "correction_or_reversal_refs": []})
        c.effect("system9", "grant_receipt", fact["grant_ref"], {"transaction_ref": c.tx_ref})

    def _cmd_InstallRecords(self, c: Context) -> None:
        require(c.authority.get("development_mode") is True, "ACCESS_DENIED")
        fact = c.call("content", "records", c.command["target_ref"])
        forbidden = {"money_posting", "money_transaction", "derived_balances", "request_and_coordinator", "outbox_and_recovery", "settlement_allocation"}
        for entry in fact["records"]:
            table, ref, record = entry["table"], entry["reference"], entry["record"]
            require(table in FIELDS and table not in forbidden, "ACCESS_DENIED")
            require(c.state.find(table, c.branch, ref) is None, "REVISION_CONFLICT")
            c.put(table, ref, clone(record))
        c.event("ConfigurationInstalled", c.command["target_ref"])

    def _cmd_PlaceHold(self, c: Context) -> None:
        p = c.payload
        account = c.get("economic_account", p["account_ref"])
        c.revision(account)
        self._instrument(c, p["instrument"], p["account_ref"])
        amount = money(p["cents"], nonnegative=True)
        require(amount > 0, "INVALID_AMOUNT")
        require(self._balance(c.state, c.branch, p["account_ref"]) - self._holds(c.state, c.branch, p["account_ref"]) >= amount,
                "INSUFFICIENT_AVAILABLE_FUNDS")
        terms = c.policy(account["product_policy_id"])
        expiry = c.now + integer(terms["reservation_seconds"])
        require(expiry > c.now, "POLICY_MISSING")
        ref = reference("hold", c.request_ref, p["account_ref"])
        c.put("funds_hold", ref, {"id": ref, "account_id": p["account_ref"], "request_key": c.command["request_key"],
              "amount_cents": amount, "expiry_time": expiry, "captured_cents": 0, "state": "ACTIVE", "revision": 0})
        account["revision"] += 1
        c.event("HoldPlaced", ref)
        c.result = {"hold_ref": ref, "amount_cents": amount}

    def _cmd_CaptureHold(self, c: Context) -> None:
        hold = c.get("funds_hold", c.command["target_ref"])
        c.revision(hold)
        self._transfer(c, hold["account_id"], c.payload["destination"], c.payload["cents"], c.payload["instrument"], capture_hold=hold["id"])
        c.event("HoldReleased", hold["id"])
        c.result = {"captured_cents": c.payload["cents"], "released_cents": hold["amount_cents"] - hold["captured_cents"]}

    def _cmd_ReleaseHold(self, c: Context) -> None:
        hold = c.get("funds_hold", c.command["target_ref"])
        c.revision(hold)
        self._instrument(c, c.payload["instrument"], hold["account_id"])
        require(hold["state"] == "ACTIVE", "INVALID_HOLD")
        hold["state"], hold["revision"] = "RELEASED", hold["revision"] + 1
        c.event("HoldReleased", hold["id"])

    def _cmd_ExpireHold(self, c: Context) -> None:
        hold = c.get("funds_hold", c.command["target_ref"])
        fact = c.call("system11", "timer", c.command["causal_event_ref"])
        require(fact.get("target_ref") == hold["id"] and c.now >= hold["expiry_time"], "ACCESS_DENIED")
        for _, coordinator in c.state.rows("request_and_coordinator", c.branch):
            require(not (hold["id"] in coordinator["participant_reservation_refs"] and coordinator["coordinator_decision"] == "UNDECIDED"), "OWNER_PENDING")
        if hold["state"] == "ACTIVE":
            hold["state"], hold["revision"] = "EXPIRED", hold["revision"] + 1
            c.event("HoldReleased", hold["id"], fact["period_key"])

    def _cmd_CancelPending(self, c: Context) -> None:
        target = c.get("request_and_coordinator", c.command["target_ref"])
        require(target["principal_id"] == c.principal, "ACCESS_DENIED")
        require(target["coordinator_decision"] == "UNDECIDED", "ALREADY_COMMITTED")
        self._release_request(c, c.command["target_ref"])
        target["coordinator_decision"], target["response_status"] = "ABORT", "REJECTED"
        document = c.get("notice_and_observation_channel", target["persisted_result_ref"])["content"]
        document["result"] = self._failure(document["command"], "CANCELLED")
        target["failure_code"], target["cancellable_scope"] = "CANCELLED", "NONE"
        # ABORT delivery belongs to the original coordinator and is recovered later.
        c.result = {"cancelled_request_ref": c.command["target_ref"]}

    def _cmd_ViewRecord(self, c: Context) -> None:
        table, ref = c.payload["table"], c.command["target_ref"]
        require(table not in {"request_and_coordinator"}, "ACCESS_DENIED")
        record = c.get(table, ref)
        require(record.get("channel_ref") != "SYSTEM14_INTERNAL", "ACCESS_DENIED")
        fact = c.call("knowledge", "view", ref)
        require(fact.get("principal_id") == c.principal and fact.get("table") == table, "ACCESS_DENIED")
        allowed = fact.get("visible_fields", [])
        require(type(allowed) is list and set(allowed) <= set(record), "ACCESS_DENIED")
        c.result = {"record": {name: clone(record[name]) for name in allowed}}

    def _cmd_GetBalances(self, c: Context) -> None:
        account_ref = c.command["target_ref"]
        account = c.get("economic_account", account_ref)
        observation = c.call("knowledge", "balance_observation", account_ref)
        require(observation.get("principal_id") == c.principal and observation.get("account_ref") == account_ref, "ACCESS_DENIED")
        if observation.get("observed_revision") != account["revision"]:
            require(type(observation.get("known_balances")) is dict, "ACCESS_DENIED")
            # Unknown joint-account activity is not exposed through a live cache.
            from .state import validate_record
            validate_record("derived_balances", observation["known_balances"])
            c.result = {"balances": clone(observation["known_balances"]), "current": False}
            return
        posted = self._balance(c.state, c.branch, account_ref)
        held = self._holds(c.state, c.branch, account_ref)
        facilities = [p for _, p in c.state.rows("account_product_and_instrument", c.branch)
                      if p["account_id"] == account_ref and p["overdraft_enabled"]]
        # Multiple instruments for the same account reference one product, not
        # separate copies of approved borrowing capacity.
        capacity = max((p["approved_facility_limit_cents"] - p["facility_used_cents"] for p in facilities), default=0)
        pending = sum(p["amount_cents"] for _, p in c.state.rows("pending_banking_operation", c.branch)
                      if p["destination_ref"] == account_ref and p["state"] == "PENDING")
        debts = sum(d["outstanding_principal_cents"] + d["posted_interest_outstanding_cents"]
                    for _, d in c.state.rows("debt_agreement", c.branch) if d["borrower_ref"] == account["owner_id"])
        balances = {"posted_balance_cents": posted, "active_holds_cents": held,
                    "available_owned_funds_cents": money(posted - held), "unused_approved_facility_cents": money(capacity),
                    "pending_inflows_cents": money(pending), "outstanding_debt_cents": money(debts)}
        c.put("derived_balances", account_ref, balances)
        c.result = {"balances": clone(balances), "current": True}
