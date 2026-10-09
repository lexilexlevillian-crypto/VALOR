"""Executable acceptance fixtures for isolated System 14 (stdlib unittest).

Run from the workspace root:
    python -m unittest discover -s tests/system14_python -v

Owner replies below are literal contract fixtures, not simulated foreign systems.
"""

from __future__ import annotations

import concurrent.futures
import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from fractions import Fraction

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from system14_python import System14, System14State, DummyDependencies, SimulatedCrash, DomainError
from system14_python.engine import command_digest, reference
from system14_python.state import money, round_half_up, rational, ratio, MAX_MONEY, clone, FIELDS


def initial_state(bank=20000, cash=4000, employer=100000, shared=6000):
    state = System14State()
    balances = {"cash": cash, "bank": bank, "employer": employer, "merchant": 5000,
                "merchant-bank": 5000, "landlord": 0, "escrow": 0, "lender": 1000000, "shared": shared, "other": 0,
                "vault": 100000, "bank-liability": -bank}
    state.put("economic_account", "A", "mint", {"id": "mint", "branch_id": "A", "owner_id": "system9",
        "custodian_id": "system9", "currency": "USD", "kind": "SCENARIO_SOURCE", "product_policy_id": "bank-product", "revision": 0})
    for account, balance in balances.items():
        owner = "pc" if account in {"cash", "bank"} else ("banker" if account in {"vault", "bank-liability"} else "merchant" if account == "merchant-bank" else account)
        kind = "CASH" if account in {"cash", "merchant", "vault"} else "LIABILITY" if account == "bank-liability" else "BANK"
        product = "cash-product" if kind == "CASH" else "bank-product"
        state.put("economic_account", "A", account, {"id": account, "branch_id": "A", "owner_id": owner,
            "custodian_id": owner, "currency": "USD", "kind": kind, "product_policy_id": product, "revision": 0})
        state.put("account_product_and_instrument", "A", account + "-instrument", {
            "product_policy_ref": product, "accepted_terms_version": "v1", "instrument_id": account + "-instrument",
            "account_id": account, "authorized_principals": [owner] + (["pc"] if account == "shared" else []),
            "service_channel_refs": ["counter"], "access_and_eligibility_policy_ref": "access",
            "availability_policy_ref": "availability", "hold_policy_ref": "holds", "withdrawal_limit_policy_ref": "withdrawal",
            "overdraft_enabled": False, "approved_facility_limit_cents": 0, "facility_used_cents": 0,
            "fee_policy_refs": [], "freeze_authority_refs": []})
        if kind == "CASH":
            state.put("cash_custody", "A", account + "-pile", {"id": account + "-pile", "cash_account_id": account,
                "value_cents": balance, "custodian_id": owner, "container_or_person_location_ref": "location-" + account,
                "denomination_counts": None, "revision": 0})
        tx = "fixture-grant-" + account
        state.put("money_transaction", "A", tx, {"id": tx, "branch_id": "A", "request_key": tx, "principal_id": "system9",
            "source_event_id": tx, "sim_time": 0, "policy_version": "v1", "status": "SETTLED"})
        for suffix, target, amount in [("source", "mint", -balance), ("target", account, balance)]:
            state.put("money_posting", "A", tx + suffix, {"transaction_id": tx, "account_id": target, "currency": "USD", "amount_cents": amount})
    state.put("needs_and_optional_detail_settings", "A", "pc", {"needs_profile": "LIGHT", "profile_effective_time": 0,
        "health_threshold_policy_ref": None, "spoilage_enabled": False, "preservation_policy_ref": None,
        "denomination_detail_enabled": False, "per_garment_detail_enabled": False, "metered_utilities_enabled": False,
        "currency_exchange_enabled": False, "alarm_preference_ref": None, "offline_progression_policy_ref": "clock-policy"})
    return state


class Fixture:
    def __init__(self, *, state=None, path=":memory:"):
        self.dep = DummyDependencies()
        self.number = 0
        self.path = path
        self.engine = System14(path, dependencies=self.dep, initial_state=state or initial_state())
        self.policy("bank-product", {"reservation_seconds": 600, "instrument_type": "DEBIT"})
        self.policy("cash-product", {"reservation_seconds": 600, "instrument_type": "CASH"})
        for account in ("cash", "bank", "employer", "merchant", "merchant-bank", "landlord", "escrow", "lender", "shared", "other", "vault"):
            self.fact("institutions", "instrument", account + "-instrument", {"usable": True})
        for account in ("cash", "merchant", "vault"):
            self.fact("system12", "cash_custody", account + "-pile", {"present": True, "custody_authorized": True})

    def fact(self, owner, operation, target, value):
        self.dep.fixtures[owner, operation, target] = {"status": "OK", **clone(value)}

    def policy(self, target, value, version="v1"):
        self.fact("content", "policy", target, {"policy_version": version, "policy": value})

    def ready(self, owner, operation, target):
        for phase in ("prepare", "commit", "abort"):
            self.fact(owner, phase + ":" + operation, target, {"receipt_ref": phase + ":" + operation + ":" + target})

    def timing(self, target, *, interruption=None, seconds=0):
        self.fact("system11", "activity", target, {"elapsed_seconds": seconds, "receipt_ref": "time:" + target, "interruption_ref": interruption})
        self.ready("system11", "advance", target)

    def command(self, operation, target="target", payload=None, *, now=0, principal="pc", revision=0, branch="A", request=None,
                explicit=True, owner_event=False, developer=False):
        self.number += 1
        rid = request or "request-" + str(self.number)
        command = {"operation": operation, "branch_id": branch, "principal_id": principal,
            "request_id": rid, "request_key": rid, "expected_revision": revision, "source_context_ref": "test-context",
            "causal_event_ref": "cause:" + rid, "source_revision": 0, "policy_version": "v1",
            "principal_authority_ref": "authority:" + rid, "target_ref": target, "payload": payload or {}}
        self.authorize(command, explicit=explicit, owner_event=owner_event, developer=developer)
        self.fact("system11", "now", rid, {"sim_time": now})
        return command

    def authorize(self, command, *, explicit=True, owner_event=False, developer=False):
        self.fact("ui", "authorize", command["request_id"], {"command_digest": command_digest(command),
            "principal_id": command["principal_id"], "branch_id": command["branch_id"],
            "explicit_action": explicit, "owner_event": owner_event, "development_mode": developer})

    def run(self, operation, target="target", payload=None, **kwargs):
        return self.engine.process(self.command(operation, target, payload, **kwargs))

    def state(self):
        return System14State.restore(self.engine.export_state())

    def balance(self, account, branch="A"):
        return self.engine._balance(self.state(), branch, account)

    def get(self, table, target, branch="A"):
        return self.state().get(table, branch, target)

    def seed(self, table, target, record):
        # Trusted content fixture installed through the same validated API.
        install_ref = "install:" + table + ":" + target
        self.fact("content", "records", install_ref, {"records": [{"table": table, "reference": target, "record": record}]})
        outcome = self.run("InstallRecords", install_ref, developer=True)
        assert outcome["status"] == "COMMITTED", outcome

    def transfer(self, cents, source="bank", destination="other", **kwargs):
        return self.run("TransferFunds", source, {"source": source, "destination": destination, "cents": cents,
            "instrument": source + "-instrument"}, **kwargs)

    def obligation(self, amount=85000, partial=True, due=100, state="OPEN"):
        terms = {"agreement_ref": "lease", "currency": "USD", "charge_type": "RENT", "amount_calculation": "rent-price",
            "service_period": "month", "recurrence": "monthly", "local_civil_time_rule": "clock", "holiday_and_business_day_rule": "clock",
            "shorter_month_rule": "last-day", "grace_rule": "grace", "partial_payment_rule": "rent-partial", "allocation_order": ["PRINCIPAL"],
            "overpayment_rule": "CREDIT", "late_fee_rules": [], "dispute_and_collection_policy_ref": "dispute", "notice_policy_ref": "notice"}
        self.seed("obligation_terms", "lease", terms)
        self.seed("obligation", "rent", {"id": "rent", "agreement_id": "lease", "debtor_id": "pc", "creditor_id": "landlord",
            "period_key": "2012-01", "issued_cents": amount, "settled_cents": 0, "due_time": due, "state": state, "dispute_id": None, "revision": 0})
        self.policy("rent-partial", {"partial_allowed": partial})
        self.policy("rent-price", {"amount_cents": amount, "accepted": True, "debtor_ref": "pc", "creditor_ref": "landlord", "creditor_account_ref": "landlord"})

    def pay(self, amount, *, applied=None, **kwargs):
        self.fact("content", "allocation", "rent", {"amount_cents": applied if applied is not None else amount,
            "allocation_order": ["PRINCIPAL"], "principal_cents": applied if applied is not None else amount, "interest_cents": 0, "fee_cents": 0})
        return self.run("PayObligation", "rent", {"source": "bank", "instrument": "bank-instrument", "cents": amount}, **kwargs)

    def shop(self, unit=1250, *, stock=1, accepted=("CASH", "DEBIT"), expiry=600):
        self.seed("merchant_and_offer", "shop", {"merchant_ref": "shop", "authority_ref": "merchant", "location_ref": "shop-location",
            "hours_ref": "hours", "staff_role_refs": ["clerk"], "service_channels": ["COUNTER"], "stock_owner_ref": "inventory",
            "stock_refs": ["food"], "service_capacity_ref": "counter", "accepted_instrument_types": list(accepted),
            "price_catalog_ref": "prices", "price_revision": 1, "offer_effective_time": 0, "baseline_price_cents": unit,
            "markup_rule_ref": None, "supply_or_scarcity_event_ref": None, "promotion_ref": None, "negotiation_authority_ref": None,
            "return_policy_ref": "returns", "merchant_cash_float_ref": "merchant"})
        self.policy("prices", {"items": {"food": {"unit_price_cents": unit, "taxable": False, "eligible_charge_basis_refs": []}},
            "tax_rules": [], "service_charge_rules": [], "quote_valid_seconds": expiry, "settlement_account_ref": "merchant",
            "settlement_accounts": {"CASH": "merchant", "DEBIT": "merchant-bank"}})
        self.fact("inventory", "availability", "shop", {"visible": True, "available_quantities": {"food": stock}})
        self.fact("system12", "commerce_access", "shop", {"accessible": True, "buyer_present": True})
        self.fact("system13", "commerce_service", "shop", {"open": True, "staff_available": True})

    def quote(self):
        out = self.run("QuotePurchase", "shop", {"merchant": "shop", "lines": [{"item_ref": "food", "quantity": 1}], "fulfillment": "COUNTER"})
        assert out["status"] == "QUOTED", out
        q = out["result"]["quote"]["id"]
        self.fact("inventory", "purchase", q, {"capacity_available": True, "stock_available": True, "substitutions_approved": True,
            "lines": {"food": {"reservation_ref": "last-unit", "revision": 0}}})
        self.ready("inventory", "purchase_transfer", q)
        self.timing(q, seconds=35 * 60)
        return q

    def buy_command(self, q, source="cash", **kwargs):
        return self.command("AcceptQuote", q, {"source": source, "instrument": source + "-instrument", "max_total": 30000}, **kwargs)

    def buy(self, q, source="cash", **kwargs):
        return self.engine.process(self.buy_command(q, source, **kwargs))

    def routine(self, *, source="cash", per_cap=3000, period_cap=3000, activities=None, spent=0):
        activities = clone(activities or [{"operation": "AcceptQuote", "target_ref": "shop", "payload": {}}])
        for activity in activities:
            if activity["operation"] == "AcceptQuote":
                quote = self.state().find("quote", "A", activity["target_ref"])
                activity["payload"]["expected_total_cents"] = quote["final_cents"] if quote else per_cap
        plan = {"id": "plan", "template_ref": "template", "activities": activities,
            "permitted_location_and_route_refs": ["shop-location", "home"], "participant_refs": ["pc"], "resource_refs": ["food"],
            "approved_substitute_refs": [], "total_budget_cents": period_cap, "duration_or_time_window": {"start_time": 0, "end_time": 10000},
            "repricing_allowed": False, "stop_conditions": ["CHOICE", "DEADLINE", "CAP"], "activation_or_schedule_ref": "activated"}
        mandate = {"id": "mandate", "principal_id": "pc", "plan_ref": "plan", "payment_source_id": source,
            "per_action_cap": per_cap, "period_cap": period_cap, "expiry": 10000, "revision": 0}
        self.fact("content", "routine_activation", "template", {"routine_plan": plan, "routine_mandate": mandate, "period_key": "week-1"})
        outcome = self.run("ActivateRoutine", "template")
        assert outcome["status"] == "COMMITTED", outcome
        if spent:
            with self.engine._transaction():
                state = self.engine._load()
                execution = state.get("routine_execution", "A", "mandate")
                execution["period_spent_cents"], execution["total_spent_cents"] = spent, spent
                self.engine._save(state)

    def debt(self, principal=100000):
        self.seed("debt_agreement", "debt", {"id": "debt", "lender_ref": "lender", "borrower_ref": "pc", "accepted_offer_ref": "loan",
            "terms_version": "v1", "disbursed_principal_cents": principal, "outstanding_principal_cents": principal,
            "annual_rate": {"numerator": 10, "denominator": 100}, "accrual_basis": 365,
            "unposted_interest_fraction": {"numerator": 0, "denominator": 1}, "posted_interest_outstanding_cents": 0,
            "payment_schedule_ref": "debt-policy", "allocation_order": ["INTEREST", "PRINCIPAL"], "compounding_enabled": False,
            "fee_rule_refs": [], "collateral_refs": [], "guarantor_refs": [], "notice_refs": [], "authority_ref": "loan-authority"})
        self.seed("debt_accrual_interval", "origin", {"debt_ref": "debt", "start_time": 0, "end_time": 0,
            "principal_cents": principal, "rate": {"numerator": 10, "denominator": 100}, "statement_interval_key": "ORIGIN", "interest_posting_ref": None})
        self.policy("debt-policy", {"lender_account_ref": "lender", "period_key": "month-1"})

    def interest(self, days=30):
        command = self.command("PostInterest", "debt", now=days * 86400, owner_event=True)
        self.fact("system11", "statement", command["causal_event_ref"], {"debt_ref": "debt", "end_time": days * 86400, "period_key": "month-1"})
        self.fact("system11", "debt_elapsed", "debt", {"start_time": 0, "end_time": days * 86400,
            "elapsed_days": {"numerator": days, "denominator": 1}, "statement_interval_key": "month-1"})
        return self.engine.process(command)


class MoneyAcceptance(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.engine.close)

    def test_M01_cash_meal(self):
        self.f.shop()
        result = self.f.buy(self.f.quote())
        self.assertEqual(result["status"], "COMMITTED", result)
        self.assertEqual((self.f.balance("cash"), self.f.balance("bank")), (2750, 20000))

    def test_M02_withdrawal_conserves_money(self):
        self.f.fact("institutions", "bank_operation", "atm", {"available": True, "accepted": True,
            "source_ref": "bank", "destination_ref": "cash", "amount_cents": 5000, "fee_cents": 0,
            "operation_kind": "ATM_WITHDRAWAL", "cash_capacity_cents": 100000, "within_product_limit": True,
            "availability": "IMMEDIATE", "vault_account_ref": "vault", "institutional_liability_ref": "bank-liability",
            "cash_exchange_authorized": True})
        self.f.timing("atm")
        self.f.ready("institutions", "bank_transfer", "atm")
        result = self.f.run("BankTransfer", "atm", {"source": "bank", "destination": "cash", "cents": 5000, "instrument": "bank-instrument"})
        self.assertEqual(result["status"], "COMMITTED", result)
        self.assertEqual((self.f.balance("bank"), self.f.balance("cash")), (15000, 9000))

    def test_M03_inaccessible_cash(self):
        self.f.fact("system12", "cash_custody", "cash-pile", {"present": False, "custody_authorized": True})
        result = self.f.transfer(1250, "cash", "merchant")
        self.assertEqual(result["failure_code"], "CASH_NOT_PRESENT")
        self.assertEqual(self.f.balance("cash"), 4000)

    def test_M04_real_concurrent_spending(self):
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / "state.sqlite")
            fixture = Fixture(state=initial_state(bank=1000), path=path)
            other = System14(path, dependencies=fixture.dep)
            try:
                commands = [fixture.command("TransferFunds", "bank", {"source": "bank", "destination": "other", "cents": 800,
                    "instrument": "bank-instrument"}) for _ in range(2)]
                gate = threading.Barrier(2)
                def run(engine, command):
                    gate.wait()
                    return engine.process(command)
                with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                    futures = [pool.submit(run, engine, command) for engine, command in zip((fixture.engine, other), commands)]
                    results = [future.result() for future in futures]
                self.assertEqual(sum(r["status"] == "COMMITTED" for r in results), 1, results)
                self.assertEqual(fixture.balance("bank"), 200)
            finally:
                other.close()
                fixture.engine.close()

    def hold(self, amount=800):
        result = self.f.run("PlaceHold", "bank", {"account_ref": "bank", "instrument": "bank-instrument", "cents": amount})
        self.assertEqual(result["status"], "COMMITTED", result)
        return result["result"]["hold_ref"]

    def test_M05_hold_excludes_available_funds(self):
        self.hold()
        self.assertEqual(self.f.balance("bank"), 20000)
        self.assertEqual(self.f.engine._holds(self.f.state(), "A", "bank"), 800)

    def test_M06_partial_capture_releases_remainder(self):
        hold = self.hold()
        result = self.f.run("CaptureHold", hold, {"destination": "other", "cents": 600, "instrument": "bank-instrument"})
        self.assertEqual(result["result"]["released_cents"], 200, result)
        self.assertEqual(self.f.balance("bank"), 19400)
        self.assertEqual(self.f.engine._holds(self.f.state(), "A", "bank"), 0)

    def test_M07_capture_retry_identical(self):
        hold = self.hold()
        command = self.f.command("CaptureHold", hold, {"destination": "other", "cents": 600, "instrument": "bank-instrument"})
        first = self.f.engine.process(command)
        self.assertEqual(first, self.f.engine.process(command))
        self.assertEqual(self.f.balance("bank"), 19400)

    def test_M08_empty_atm_no_debit(self):
        self.f.fact("institutions", "bank_operation", "atm", {"available": True, "accepted": True,
            "source_ref": "bank", "destination_ref": "cash", "amount_cents": 5000, "operation_kind": "ATM_WITHDRAWAL",
            "cash_capacity_cents": 0, "within_product_limit": True})
        result = self.f.run("BankTransfer", "atm", {"source": "bank", "destination": "cash", "cents": 5000, "instrument": "bank-instrument"})
        self.assertEqual(result["failure_code"], "INSTRUMENT_UNAVAILABLE")
        self.assertEqual(self.f.balance("bank"), 20000)

    def pending_check(self):
        self.f.fact("institutions", "bank_operation", "check", {"available": True, "accepted": True,
            "source_ref": "bank", "destination_ref": "other", "amount_cents": 1000, "fee_cents": 0,
            "operation_kind": "CHECK_DEPOSIT", "availability": "DELAYED", "check_possessed": True,
            "irrevocable_settlement_point": "CLEARING"})
        self.f.timing("check")
        result = self.f.run("BankTransfer", "check", {"source": "bank", "destination": "other", "cents": 1000, "instrument": "bank-instrument"})
        self.assertEqual(result["status"], "PENDING", result)
        return result["result"]["operation_ref"]

    def test_M09_check_pending_not_spendable(self):
        self.pending_check()
        self.assertEqual(self.f.balance("other"), 0)

    def test_M10_check_clears_once(self):
        operation = self.pending_check()
        self.f.fact("institutions", "clearing", operation, {"operation_ref": operation, "event_ref": "clear-1", "accepted": True, "settlement_authorized": True})
        self.f.ready("institutions", "clearing", operation)
        command = self.f.command("ClearBankOperation", operation, owner_event=True)
        first = self.f.engine.process(command)
        self.assertEqual(first["status"], "COMMITTED", first)
        self.assertEqual(self.f.engine.process(command), first)
        self.assertEqual(self.f.balance("other"), 1000)

    def wage(self, amount):
        self.f.fact("system13", "wage_entitlement", "wage", {"approved": True, "settlement_authorized": True,
            "payer_account_ref": "employer", "beneficiary_account_ref": "bank", "income_settlement": {
                "source_entitlement_ref": "wage", "source_period_key": "pay-1", "payer_ref": "employer", "beneficiary_ref": "pc",
                "approved_gross_cents": amount, "authorized_adjustments_ref": "adjustments", "approved_net_owed_cents": amount,
                "payment_method": "DIRECT_DEPOSIT", "provenance_ref": "job", "settlement_state": "OWED", "transaction_ref": None, "failure_code": None}})
        self.f.ready("system13", "wage_receipt", "wage")

    def test_M11_unfunded_wages_remain_owed(self):
        self.wage(200000)
        result = self.f.run("SettleIncome", "wage")
        self.assertEqual(result["status"], "REJECTED", result)
        self.assertEqual(self.f.get("income_settlement", "wage")["settlement_state"], "OWED")
        self.assertEqual(self.f.balance("bank"), 20000)

    def test_M12_entitlement_once_across_new_requests(self):
        self.wage(50000)
        first = self.f.run("SettleIncome", "wage")
        second = self.f.run("SettleIncome", "wage")
        self.assertEqual(first["status"], "COMMITTED", first)
        self.assertEqual(second["status"], "COMMITTED", second)
        self.assertEqual(self.f.balance("bank"), 70000)

    def test_M13_absent_late_fee_policy_no_fee(self):
        self.f.obligation(state="OVERDUE")
        result = self.f.run("AssessLateFee", "rent")
        self.assertEqual(result["failure_code"], "POLICY_MISSING")
        self.assertEqual(self.f.get("obligation", "rent")["issued_cents"], 85000)

    def test_M14_no_hidden_overdraft(self):
        result = self.f.transfer(20001)
        self.assertEqual(result["failure_code"], "INSUFFICIENT_AVAILABLE_FUNDS")
        self.assertEqual(self.f.balance("bank"), 20000)

    def test_M15_month_period_unique_owner_calendar(self):
        self.f.obligation()
        for _ in range(2):
            command = self.f.command("IssueObligation", "lease", owner_event=True)
            self.f.fact("system11", "obligation_period", command["causal_event_ref"], {"agreement_ref": "lease", "issued": True,
                "period_key": "2012-02-last-day", "due_time": 500})
            result = self.f.engine.process(command)
            self.assertEqual(result["status"], "COMMITTED", result)
        obligations = list(self.f.state().rows("obligation", "A"))
        self.assertEqual(len(obligations), 2)

    def test_M16_partial_allocation_preserved(self):
        self.f.obligation()
        result = self.f.pay(10000)
        self.assertEqual(result["status"], "COMMITTED", result)
        self.assertEqual(self.f.get("obligation", "rent")["state"], "PARTIAL")
        self.assertEqual(result["result"]["remaining_cents"], 75000)

    def test_M17_overpayment_credit_recorded(self):
        self.f.obligation(amount=1000)
        result = self.f.pay(1500, applied=1000)
        self.assertEqual(result["result"]["credit_or_refund_cents"], 500, result)
        self.assertEqual(self.f.balance("bank"), 18500)

    def test_M18_overdue_timer_repeat(self):
        self.f.obligation()
        for _ in range(2):
            command = self.f.command("MarkObligationOverdue", "rent", now=101, owner_event=True)
            self.f.fact("system11", "timer", command["causal_event_ref"], {"target_ref": "rent", "period_key": "2012-01"})
            self.assertEqual(self.f.engine.process(command)["status"], "COMMITTED")
        events = [r for _, r in self.f.state().rows("outbox_and_recovery", "A") if r["event_type"] == "ObligationOverdue"]
        self.assertEqual(len(events), 1)

    def test_M19_autopay_insufficient_no_other_source(self):
        self.f.obligation()
        self.f.seed("autopay_authorization", "auto", {"payer_account_ref": "bank", "eligible_obligation_classes": ["RENT"],
            "amount_cap_cents": 85000, "period_budget_cents": 85000, "period_key": "month", "period_spent_cents": 0,
            "expiry": 1000, "insufficient_funds_behavior": "PAUSE"})
        result = self.f.run("PayObligation", "rent", {"source": "bank", "instrument": "bank-instrument", "cents": 85000, "autopay_ref": "auto"})
        self.assertEqual(result["failure_code"], "INSUFFICIENT_AVAILABLE_FUNDS", result)
        self.assertEqual(self.f.get("obligation", "rent")["state"], "OPEN")
        self.assertEqual(self.f.balance("cash"), 4000)

    def test_M20_interest_exact_822_with_remainder(self):
        self.f.debt()
        result = self.f.interest()
        self.assertEqual(result["result"]["posted_interest_cents"], 822, result)
        self.assertEqual(rational(self.f.get("debt_agreement", "debt")["unposted_interest_fraction"]), Fraction(-6, 73))

    def test_M21_interest_then_principal(self):
        self.f.debt()
        self.f.interest()
        result = self.f.run("RepayDebt", "debt", {"source": "bank", "instrument": "bank-instrument", "cents": 5000}, now=30 * 86400)
        self.assertEqual(result["result"]["remaining_principal_cents"], 95822, result)
        self.assertEqual(self.f.get("debt_agreement", "debt")["posted_interest_outstanding_cents"], 0)

    def test_M22_midinterval_principal_split(self):
        self.f.debt()
        self.f.fact("system11", "debt_elapsed", "debt", {"start_time": 0, "end_time": 10 * 86400,
            "elapsed_days": {"numerator": 10, "denominator": 1}, "statement_interval_key": "month-1"})
        result = self.f.run("RepayDebt", "debt", {"source": "bank", "instrument": "bank-instrument", "cents": 5000}, now=10 * 86400)
        self.assertEqual(result["status"], "COMMITTED", result)
        intervals = list(self.f.state().rows("debt_accrual_interval", "A"))
        self.assertEqual(intervals[-1][1]["principal_cents"], 100000)
        self.assertEqual(self.f.get("debt_agreement", "debt")["outstanding_principal_cents"], 95000)

    def test_M23_refund_exceeds_capture(self):
        self.f.shop()
        result = self.f.buy(self.f.quote())
        sale = result["result"]["sale_ref"]
        refund = self.f.run("RefundSale", sale, {"cents": 1251})
        self.assertEqual(refund["failure_code"], "REFUND_EXCEEDS_CAPTURE")
        self.assertEqual(self.f.balance("cash"), 2750)

    def test_M24_integer_overflow_atomic(self):
        result = self.f.transfer(MAX_MONEY + 1)
        self.assertEqual(result["failure_code"], "INTEGER_OVERFLOW")
        self.assertEqual(self.f.balance("bank"), 20000)


class HousingCommerceAcceptance(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.engine.close)

    def sale(self):
        self.f.shop()
        q = self.f.quote()
        result = self.f.buy(q)
        self.assertEqual(result["status"], "COMMITTED", result)
        return q, result["result"]["sale_ref"]

    def fulfill(self, sale):
        self.f.fact("inventory", "handoff", sale, {"authorized": True, "recipient_present_or_policy_valid": True, "receipt_ref": "handoff-1"})
        self.f.ready("inventory", "handoff", sale)
        result = self.f.run("FulfillSale", sale)
        self.assertEqual(result["status"], "COMMITTED", result)

    def refund(self, sale, amount=1250):
        self.f.fact("institutions", "refund", sale, {"authorized": True, "claimant_ref": "pc", "window_and_condition_valid": True,
            "refund_cents": amount, "original_sale_ref": sale, "refund_kind": "CASH", "destination_account_ref": "cash",
            "merchant_account_ref": "merchant", "delivery_cancelled": True})
        self.f.fact("inventory", "return", sale, {"sold_item_identity_valid": True, "claimant_has_custody": True, "receipt_ref": "returned-item-1"})
        self.f.ready("inventory", "return", sale)
        self.f.ready("inventory", "cancel_fulfillment", sale)
        return self.f.run("RefundSale", sale, {"cents": amount})

    def housing(self, deposit=0):
        offer = {"offer_ref": "housing", "property_ref": "building", "unit_ref": "unit", "owner_or_agent_authority_ref": "landlord",
            "available_occupancy": {"start_time": 0, "end_time": 100000, "capacity": 1}, "recurring_price_cents": 85000,
            "deposit_cents": deposit, "included_service_refs": [], "term": {"start_time": 100, "end_time": 100000},
            "eligibility_policy_ref": "eligibility", "household_restrictions_ref": "restrictions", "condition_disclosure_refs": [],
            "application_fact_refs": [], "screening_authority_refs": [], "debtor_shares": {"pc": {"numerator": 1, "denominator": 1}},
            "payment_schedule_ref": "schedule", "permitted_payment_methods": ["DEBIT"], "notice_rules_ref": "notices",
            "service_responsibility_ref": "service", "authorized_access_terms_ref": "access", "exclusive_or_shared_occupancy_model": "EXCLUSIVE"}
        self.f.seed("housing_offer_and_terms", "housing", offer)
        self.f.fact("institutions", "housing_acceptance", "housing", {"accepted": True, "screening_authorized": True,
            "principal_ref": "pc", "terms_version": "v1", "agreement_ref": "tenancy", "authority_ref": "lease-authority",
            "obligation_terms": [], "deposit_due_now": bool(deposit), "deposit_holding_account_ref": "escrow"})
        self.f.fact("system12", "occupancy_capacity", "unit", {"available": True, "amenities_valid": True})
        self.f.ready("system12", "reserve_occupancy", "unit")
        result = self.f.run("AcceptHousingOffer", "housing", {"terms_version": "v1", "source": "bank", "instrument": "bank-instrument"})
        self.assertEqual(result["status"], "COMMITTED", result)

    def split(self):
        self.f.fact("relationships", "split_agreement", "tab", {"accepted": True, "total_cents": 10001,
            "shares": {"pc": {"numerator": 1, "denominator": 3}, "merchant": {"numerator": 1, "denominator": 3}, "other": {"numerator": 1, "denominator": 3}},
            "restaurant_tab_and_split": {"tab_ref": "tab", "accepted_terms_ref": "tab-terms", "order_receipt_refs": [],
                "tip_preference_enabled": False, "tip_amount_or_rate": 0, "tip_eligible_basis": "SUBTOTAL", "tip_cap_cents": 0,
                "tip_transfer_or_payable_ref": "tip", "tip_allocation_owner_ref": "system13", "split_method": "AGREED_SHARES",
                "payer_shares_cents": {}, "remainder_assignment_order": ["pc", "merchant", "other"],
                "payer_authorization_refs": [], "payer_settlement_refs": [], "remaining_due_cents": 0,
                "partial_settlement_policy_ref": "tab-policy"}})
        self.f.policy("tab-policy", {"independent_partial_settlements": True, "merchant_account_ref": "landlord"})
        return self.f.run("CreateSplitBill", "tab")

    def test_H01_last_unit_only_once(self):
        self.f.shop()
        q1, q2 = self.f.quote(), self.f.quote()
        first, second = self.f.buy(q1), self.f.buy(q2)
        self.assertEqual(first["status"], "COMMITTED", first)
        self.assertEqual(second["failure_code"], "STOCK_UNAVAILABLE")
        self.assertEqual(self.f.balance("cash"), 2750)

    def test_H02_expired_quote(self):
        self.f.shop()
        result = self.f.buy(self.f.quote(), now=600)
        self.assertEqual(result["failure_code"], "STALE_QUOTE")
        self.assertEqual(self.f.balance("cash"), 4000)

    def test_H03_capacity_before_payment(self):
        self.f.shop()
        q = self.f.quote()
        self.f.dep.fixtures["inventory", "purchase", q]["capacity_available"] = False
        result = self.f.buy(q)
        self.assertEqual(result["failure_code"], "CAPACITY_EXCEEDED")
        self.assertEqual(self.f.balance("cash"), 4000)

    def test_H04_unavailable_change(self):
        f = Fixture(state=initial_state(cash=20000))
        self.addCleanup(f.engine.close)
        f.shop()
        command = f.buy_command(f.quote())
        command["payload"]["cash_tender_cents"] = 10000
        f.authorize(command)
        result = f.engine.process(command)
        self.assertEqual(result["failure_code"], "CHANGE_UNAVAILABLE")
        self.assertEqual(f.balance("cash"), 20000)

    def test_H05_same_item_returned_once(self):
        q, sale = self.sale()
        self.fulfill(sale)
        first = self.refund(sale)
        self.assertEqual(first["status"], "COMMITTED", first)
        second = self.refund(sale)
        self.assertEqual(second["failure_code"], "REFUND_EXCEEDS_CAPTURE")
        self.assertEqual(self.f.balance("cash"), 4000)

    def test_H06_paid_not_consumed(self):
        q, sale = self.sale()
        self.assertEqual(self.f.get("order_and_sale_receipt", sale)["consumption_receipt_refs"], [])
        self.assertEqual(self.f.get("order_and_sale_receipt", sale)["handoff_state"], "PENDING")

    def test_H07_integer_split_10001(self):
        result = self.split()
        self.assertEqual(result["result"]["shares_cents"], {"pc": 3334, "merchant": 3334, "other": 3333}, result)

    def test_H08_failed_third_share_no_pc_coverage(self):
        self.split()
        first = self.f.run("PaySplitBill", "tab", {"source": "bank", "instrument": "bank-instrument"})
        second = self.f.run("PaySplitBill", "tab", {"source": "merchant-bank", "instrument": "merchant-bank-instrument"}, principal="merchant")
        third = self.f.run("PaySplitBill", "tab", {"source": "other", "instrument": "other-instrument"}, principal="other")
        self.assertEqual((first["status"], second["status"]), ("PARTIAL", "PARTIAL"), (first, second))
        self.assertEqual(third["failure_code"], "INSUFFICIENT_AVAILABLE_FUNDS")
        self.assertEqual(self.f.get("restaurant_tab_and_split", "tab")["remaining_due_cents"], 3333)
        self.assertEqual(self.f.balance("bank"), 16666)

    def test_H09_tip_single_customer_debit(self):
        self.f.shop(unit=8000)
        self.f.fact("system13", "tip_policy", "shop", {"allocation_authorized": True, "policy_ref": "pool"})
        quote = self.f.run("QuotePurchase", "shop", {"merchant": "shop", "lines": [{"item_ref": "food", "quantity": 1}],
            "fulfillment": "COUNTER", "tip_enabled": True, "tip_rate": {"numerator": 15, "denominator": 100}, "tip_cap_cents": 2000})
        q = quote["result"]["quote"]["id"]
        self.f.fact("inventory", "purchase", q, {"capacity_available": True, "stock_available": True, "substitutions_approved": True,
            "lines": {"food": {"reservation_ref": "tip-food", "revision": 0}}})
        self.f.ready("inventory", "purchase_transfer", q)
        self.f.timing(q)
        self.f.ready("system13", "tip_payable", reference("sale", q))
        command = self.f.buy_command(q, "bank")
        result = self.f.engine.process(command)
        self.assertEqual(result["status"], "COMMITTED", result)
        self.f.engine.process(command)
        self.f.engine.recover()
        self.assertEqual(self.f.balance("bank"), 10800)

    def test_H10_closed_shop_no_service(self):
        self.f.shop()
        q = self.f.quote()
        self.f.dep.fixtures["system13", "commerce_service", "shop"]["open"] = False
        result = self.f.buy(q)
        self.assertEqual(result["failure_code"], "INSTRUMENT_UNAVAILABLE")
        self.assertEqual(self.f.balance("cash"), 4000)

    def test_H11_signature_no_relocation(self):
        self.housing()
        self.assertEqual(self.f.get("occupancy_agreement", "tenancy")["status"], "ACCEPTED")
        self.assertEqual(self.f.get("cash_custody", "cash-pile")["container_or_person_location_ref"], "location-cash")

    def test_H12_no_overlapping_exclusive_lease(self):
        self.housing()
        self.f.dep.fixtures["institutions", "housing_acceptance", "housing"]["agreement_ref"] = "tenancy-2"
        result = self.f.run("AcceptHousingOffer", "housing", {"terms_version": "v1"})
        self.assertEqual(result["failure_code"], "OCCUPANCY_CONFLICT")
        self.assertEqual(len(list(self.f.state().rows("occupancy_agreement", "A"))), 1)

    def test_H13_deposit_separate_liability(self):
        self.housing(deposit=10000)
        self.assertEqual(self.f.balance("bank"), 10000)
        self.assertEqual(self.f.balance("escrow"), 10000)
        self.assertEqual(self.f.get("tenancy_deposit", "tenancy")["held_liability_cents"], 10000)

    def test_H14_overdue_no_lockout(self):
        self.housing()
        self.f.obligation()
        command = self.f.command("MarkObligationOverdue", "rent", now=101)
        self.f.fact("system11", "timer", command["causal_event_ref"], {"target_ref": "rent", "period_key": "month"})
        self.f.engine.process(command)
        self.assertEqual(self.f.get("occupancy_agreement", "tenancy")["status"], "ACCEPTED")

    def claim(self):
        claim = {"id": "claim", "room_fixture_or_service_ref": "fixture", "canonical_condition_receipt_ref": "condition-good",
            "reported_problem": {"assertion": "damage"}, "cause_evidence_refs": [], "severity_fact_ref": "unknown",
            "discovery_observation_refs": [], "claimant_ref": "pc", "responsibility_claim": {"asserted_party": "tenant"},
            "owner_acknowledgment_ref": None, "scheduled_visit_ref": None, "entry_authority_ref": None,
            "attempted_fix_receipt_refs": [], "inspection_refs": [], "completed_repair_ack_ref": None, "dispute_state": "DISPUTED"}
        self.f.fact("institutions", "repair_claim", "claim", {"condition_evidence_and_repair_claim": claim})
        self.f.ready("institutions", "repair_claim", "claim")
        result = self.f.run("RecordRepairClaim", "claim")
        self.assertEqual(result["status"], "COMMITTED", result)

    def test_H15_claim_not_damage_truth(self):
        self.claim()
        claim = self.f.get("condition_evidence_and_repair_claim", "claim")
        self.assertEqual(claim["canonical_condition_receipt_ref"], "condition-good")
        self.assertEqual(claim["dispute_state"], "DISPUTED")

    def test_H16_deposit_refund_once(self):
        self.housing(deposit=10000)
        self.f.fact("institutions", "deposit_disposition", "tenancy", {"authority_valid": True, "outcome": "REFUND",
            "deduction_cents": 0, "refund_cents": 10000, "tenant_account_ref": "bank", "claim_refs": [], "finding_ref": "finding"})
        self.f.ready("institutions", "deposit_receipt", "tenancy")
        command = self.f.command("SettleDeposit", "tenancy")
        first = self.f.engine.process(command)
        self.assertEqual(first["status"], "COMMITTED", first)
        self.assertEqual(first, self.f.engine.process(command))
        self.assertEqual(self.f.balance("bank"), 20000)

    def test_H17_failed_repair_remains_unconfirmed(self):
        self.claim()
        self.f.fact("system13", "repair_progress", "claim", {"authorized": True, "accepted_output": False,
            "attempted_fix_receipt_ref": "failed-work"})
        result = self.f.run("UpdateRepair", "claim")
        self.assertEqual(result["status"], "COMMITTED", result)
        self.assertIsNone(self.f.get("condition_evidence_and_repair_claim", "claim")["completed_repair_ack_ref"])

    def test_H18_repair_requires_entry_authority(self):
        self.claim()
        self.f.fact("system13", "repair_progress", "claim", {"authorized": True, "accepted_output": True,
            "attempted_fix_receipt_ref": "work", "inspection_ref": "inspection"})
        result = self.f.run("UpdateRepair", "claim")
        self.assertEqual(result["failure_code"], "ACCESS_DENIED")

    def test_H19_private_account_access_denied(self):
        result = self.f.transfer(100, principal="roommate")
        self.assertEqual(result["failure_code"], "ACCESS_DENIED")
        self.assertEqual(self.f.balance("bank"), 20000)

    def test_H20_shared_budget_remaining_800(self):
        self.f.shop(unit=1000)
        q = self.f.quote()
        self.f.routine(source="shared", per_cap=2000, period_cap=2000, spent=1200)
        command = self.f.buy_command(q, "shared")
        command["payload"]["mandate_ref"] = "mandate"
        self.f.authorize(command)
        result = self.f.engine.process(command)
        self.assertEqual(result["failure_code"], "CAP_EXCEEDED")
        self.assertEqual(self.f.balance("shared"), 6000)
        self.assertEqual(self.f.balance("bank"), 20000)

    def test_H21_private_food_not_shared_by_location(self):
        self.f.fact("inventory", "consumption", "private-food", {"consumer_ref": "pc", "authorized": False, "present": True, "usable": True})
        result = self.f.run("ConsumePortion", "private-food")
        self.assertEqual(result["failure_code"], "ACCESS_DENIED")

    def test_H22_roommate_paycheck_private(self):
        result = self.f.run("ViewRecord", "employer", {"table": "economic_account"})
        self.assertEqual(result["failure_code"], "OWNER_UNAVAILABLE")
        self.assertNotIn("record", result)

    def test_H23_lease_end_changes_rights_only(self):
        self.housing()
        self.f.fact("institutions", "housing_access", "tenancy", {"authorized": True, "notice_ref": "notice", "effective_time": 100000,
            "unit_ref": "unit", "agreement_status": "ENDED", "authority_ref": "authority", "access_transition_ref": "rights-expire"})
        self.f.ready("system12", "housing_access", "unit")
        result = self.f.run("ChangeHousingAccess", "tenancy", now=100000)
        self.assertEqual(result["status"], "COMMITTED", result)
        self.assertEqual(self.f.get("occupancy_agreement", "tenancy")["status"], "ENDED")
        self.assertEqual(self.f.get("cash_custody", "cash-pile")["container_or_person_location_ref"], "location-cash")

    def test_H24_no_price_based_condition_inference(self):
        self.claim()
        before = self.f.get("condition_evidence_and_repair_claim", "claim")
        self.housing()
        self.assertEqual(before, self.f.get("condition_evidence_and_repair_claim", "claim"))
        self.assertNotIn("hygiene", FIELDS["economic_account"])


class RoutineRecoveryAcceptance(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.engine.close)

    def routine_sale(self, *, unit=1250, cap=3000):
        self.f.shop(unit=unit)
        q = self.f.quote()
        self.f.routine(per_cap=cap, period_cap=cap, activities=[{"operation": "AcceptQuote", "target_ref": q,
            "payload": {"source": "cash", "instrument": "cash-instrument", "max_total": cap}}])
        self.f.fact("system11", "routine_boundary", "mandate", {"interruption_ref": None, "deadline_feasible": True, "location_ref": "shop-location"})
        return q

    def test_R01_authorized_routine_completes(self):
        self.routine_sale()
        result = self.f.run("RunRoutine", "mandate", explicit=False)
        self.assertEqual(result["status"], "COMMITTED", result)
        execution = self.f.get("routine_execution", "mandate")
        self.assertEqual((execution["state"], execution["period_spent_cents"], execution["current_step"]), ("COMPLETE", 1250, 1))
        self.assertEqual(self.f.balance("cash"), 2750)

    def test_R02_cap_pauses_no_purchase(self):
        self.routine_sale(unit=3001, cap=3000)
        result = self.f.run("RunRoutine", "mandate")
        self.assertEqual(result["status"], "CHOICE_REQUIRED", result)
        self.assertEqual(self.f.get("routine_execution", "mandate")["pause_reason"], "CAP_EXCEEDED")
        self.assertEqual(self.f.balance("cash"), 4000)

    def test_R03_unapproved_substitute(self):
        q = self.routine_sale()
        self.f.dep.fixtures["inventory", "purchase", q]["substitutions_approved"] = False
        result = self.f.run("RunRoutine", "mandate")
        self.assertEqual(result["status"], "CHOICE_REQUIRED", result)
        self.assertEqual(self.f.balance("cash"), 4000)

    def test_R04_encounter_stops_before_spending(self):
        self.routine_sale()
        self.f.dep.fixtures["system11", "routine_boundary", "mandate"]["interruption_ref"] = "encounter"
        result = self.f.run("RunRoutine", "mandate")
        self.assertEqual(result["status"], "CHOICE_REQUIRED", result)
        self.assertEqual(self.f.get("routine_execution", "mandate")["unresolved_choice_ref"], "encounter")
        self.assertEqual(self.f.balance("cash"), 4000)

    def test_R05_cancel_preserves_committed_step(self):
        self.routine_sale()
        self.f.run("RunRoutine", "mandate")
        result = self.f.run("CancelRoutine", "mandate")
        self.assertEqual(result["status"], "COMMITTED", result)
        self.assertEqual(self.f.balance("cash"), 2750)
        self.assertEqual(self.f.get("routine_execution", "mandate")["current_step"], 1)

    def test_R06_save_reload_budget_preserved(self):
        self.routine_sale()
        self.f.run("RunRoutine", "mandate")
        restored = System14(initial_state=self.f.state())
        self.addCleanup(restored.close)
        execution = System14State.restore(restored.export_state()).get("routine_execution", "A", "mandate")
        self.assertEqual(execution["period_spent_cents"], 1250)

    def preferences(self):
        self.f.seed("grocery_and_task_preferences", "laundry", {"saved_basket_ref": "basket", "eligible_store_refs": [],
            "destination_storage_ref": "home", "replenishment_trigger": "weekly", "substitution_restrictions": [],
            "task_definition_ref": "wash", "ingredient_or_clothing_lot_refs": ["clothes"], "facility_tool_and_supply_refs": ["machine"],
            "reservation_refs": [], "output_or_completion_receipt_refs": [], "portion_recipient_refs": [], "chore_owner_ref": "pc",
            "chore_frequency": "weekly", "chore_tolerance_policy_ref": "tolerance", "collection_receipt_ref": None})

    def test_R07_finished_laundry_requires_collection(self):
        self.preferences()
        self.f.fact("inventory", "task_resources", "wash", {"authorized": True, "resources_present": True, "facilities_usable": True,
            "items_not_worn": True, "machine_available": True, "reservation_refs": ["wash-reservation"], "output_receipt_ref": "washed-clothes",
            "payment_required": False, "reservation_expiry": 10000, "source_revision": 0})
        self.f.ready("inventory", "laundry", "wash")
        self.f.timing("wash", seconds=3600)
        result = self.f.run("StartLaundry", "laundry")
        self.assertEqual(result["status"], "COMMITTED", result)
        self.assertIsNone(self.f.get("grocery_and_task_preferences", "laundry")["collection_receipt_ref"])

    def test_R08_deadline_boundary_pauses(self):
        self.routine_sale()
        self.f.dep.fixtures["system11", "routine_boundary", "mandate"]["deadline_feasible"] = False
        result = self.f.run("RunRoutine", "mandate")
        self.assertEqual(result["status"], "CHOICE_REQUIRED", result)
        self.assertEqual(self.f.balance("cash"), 4000)

    def test_R09_off_no_local_need_penalty(self):
        self.f.ready("health", "needs_profile", "pc")
        result = self.f.run("SetNeedsProfile", "pc", {"needs_profile": "OFF"}, now=100000)
        self.assertEqual(result["status"], "COMMITTED", result)
        self.assertEqual(self.f.get("needs_and_optional_detail_settings", "pc")["needs_profile"], "OFF")
        self.assertFalse(any("hunger" in field or "fatigue" in field for fields in FIELDS.values() for field in fields))

    def test_R10_light_does_not_invent_supplies(self):
        self.preferences()
        self.f.fact("inventory", "task_resources", "wash", {"authorized": True, "resources_present": False, "facilities_usable": True})
        result = self.f.run("CompleteChore", "laundry")
        self.assertEqual(result["failure_code"], "RESOURCE_UNAVAILABLE")
        self.assertEqual(self.f.get("grocery_and_task_preferences", "laundry")["output_or_completion_receipt_refs"], [])

    def test_R11_purchase_no_hunger_recovery(self):
        self.routine_sale()
        self.f.run("RunRoutine", "mandate")
        coordinators = list(self.f.state().rows("request_and_coordinator", "A"))
        effects = [effect for _, coordinator in coordinators for effect in self.f.get("notice_and_observation_channel", coordinator["source_context_ref"])["content"]["effects"]]
        self.assertFalse(any(e["owner"] == "health" for e in effects))

    def test_R12_interrupted_rest_actual_interval(self):
        self.f.fact("system12", "rest_access", "bed", {"feasible": True, "authorized": True})
        command = self.f.command("Rest", "bed")
        self.f.fact("system11", "rest_interval", command["request_id"], {"actual_elapsed_seconds": 300, "start_time": 0,
            "end_time": 300, "receipt_ref": "rest-300", "interruption_ref": "alarm"})
        self.f.ready("system11", "rest", command["request_id"])
        self.f.ready("health", "rest", "rest-300")
        result = self.f.engine.process(command)
        self.assertEqual(result["result"]["actual_elapsed_seconds"], 300, result)

    def test_R13_profile_preserves_debt(self):
        self.f.debt()
        self.f.ready("health", "needs_profile", "pc")
        self.f.run("SetNeedsProfile", "pc", {"needs_profile": "OFF"})
        self.assertEqual(self.f.get("debt_agreement", "debt")["outstanding_principal_cents"], 100000)
        self.assertNotIn("injury", FIELDS["needs_and_optional_detail_settings"])

    def test_R14_demographic_account_fields_rejected(self):
        state = initial_state()
        state.get("economic_account", "A", "bank")["hygiene_penalty"] = 5
        with self.assertRaises(DomainError):
            System14(initial_state=state)

    def test_R15_unaccepted_gift_no_transfer(self):
        self.f.fact("relationships", "gift_support", "gift", {"accepted_by_required_parties": False})
        result = self.f.run("AcceptGiftOrSupport", "gift")
        self.assertEqual(result["failure_code"], "ACCESS_DENIED")
        self.assertEqual(self.f.balance("cash"), 4000)

    def test_R16_wallet_theft_keeps_bank_funds(self):
        self.f.fact("crime", "economic_event", "theft", {"grounded": True, "authority_valid": True, "event_ref": "theft-1",
            "kind": "WALLET_THEFT", "source_account_ref": "cash", "destination_account_ref": "merchant", "amount_cents": 4000,
            "provenance_ref": "crime-event"})
        self.f.ready("crime", "economic_receipt", "theft-1")
        result = self.f.run("ApplyGroundedEconomicEvent", "theft", {"owner": "crime"}, owner_event=True)
        self.assertEqual(result["status"], "COMMITTED", result)
        self.assertEqual((self.f.balance("cash"), self.f.balance("bank")), (0, 20000))

    def test_R17_narration_cannot_pay_bill(self):
        self.f.obligation()
        result = self.f.run("Narrate", "rent", {"text": "The rent was paid."})
        self.assertEqual(result["failure_code"], "INVALID_COMMAND")
        self.assertEqual(self.f.get("obligation", "rent")["settled_cents"], 0)

    def test_R18_no_ai_required(self):
        self.f.shop()
        result = self.f.buy(self.f.quote())
        self.assertEqual(result["status"], "COMMITTED", result)
        self.assertEqual(self.f.balance("cash"), 2750)

    def test_R19_crash_after_commit_recovers_once(self):
        with tempfile.TemporaryDirectory() as folder:
            f = Fixture(path=Path(folder) / "crash.sqlite")
            f.shop()
            q = f.quote()
            command = f.buy_command(q)
            with self.assertRaises(SimulatedCrash):
                f.engine.process(command, crash_at="after_decision")
            self.assertEqual(f.balance("cash"), 2750)
            f.engine.close()
            f.engine = System14(f.path, dependencies=f.dep)
            try:
                f.engine.recover()
                f.engine.recover()
                self.assertEqual(f.balance("cash"), 2750)
                result = f.engine.process(command)
                self.assertEqual(result["status"], "COMMITTED", result)
                self.assertEqual(len(f.get("order_and_sale_receipt", result["result"]["sale_ref"])["item_or_service_receipt_refs"]), 1)
            finally:
                f.engine.close()

    def test_R20_crash_before_decision_reserves_then_recovers(self):
        self.f.shop()
        q = self.f.quote()
        command = self.f.buy_command(q)
        with self.assertRaises(SimulatedCrash):
            self.f.engine.process(command, crash_at="before_decision")
        self.assertEqual(self.f.balance("cash"), 4000)
        self.assertEqual(self.f.engine._holds(self.f.state(), "A", "cash"), 1250)
        self.f.engine.recover()
        self.assertEqual(self.f.balance("cash"), 2750)

    def test_R21_fast_forward_does_not_create_mandates(self):
        command = self.f.command("FastForward", "clock")
        self.f.fact("system11", "fast_forward", command["request_id"], {"explicit_clock_policy": True,
            "end_time": 30 * 86400, "receipt_ref": "month", "interruption_ref": None, "due_event_refs": ["rent-due"]})
        self.f.ready("system11", "fast_forward", command["request_id"])
        result = self.f.engine.process(command)
        self.assertEqual(result["status"], "COMMITTED", result)
        self.assertEqual(list(self.f.state().rows("routine_mandate", "A")), [])
        self.assertEqual(self.f.balance("bank"), 20000)

    def test_R22_npc_insufficient_funds(self):
        result = self.f.transfer(1, "other", "bank", principal="other")
        self.assertEqual(result["failure_code"], "INSUFFICIENT_AVAILABLE_FUNDS")

    def test_R23_branch_balances_isolated(self):
        result = self.f.run("ForkBranch", "A", {"destination_branch_id": "B"}, developer=True)
        self.assertEqual(result["status"], "COMMITTED", result)
        self.f.transfer(500)
        self.assertEqual(self.f.balance("bank", "A"), 19500)
        self.assertEqual(self.f.balance("bank", "B"), 20000)

    def test_R24_private_context_not_exposed(self):
        result = self.f.transfer(500)
        request_ref = reference("request", "A", "pc", result["request_id"])
        internal = self.f.get("request_and_coordinator", request_ref)["source_context_ref"]
        self.f.fact("knowledge", "view", internal, {"principal_id": "pc", "table": "notice_and_observation_channel", "visible_fields": ["content"]})
        result = self.f.run("ViewRecord", internal, {"table": "notice_and_observation_channel"})
        self.assertEqual(result["failure_code"], "ACCESS_DENIED")
        self.assertNotIn("content", json.dumps(result))


class BoundaryRegressionTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.engine.close)

    def test_unknown_dependency_fails_closed(self):
        engine = System14()
        self.addCleanup(engine.close)
        command = self.f.command("TransferFunds", "bank", {"source": "bank", "destination": "other", "cents": 100, "instrument": "bank-instrument"})
        self.assertEqual(engine.process(command)["failure_code"], "ACCESS_DENIED")

    def test_exception_from_authority_stub_is_json_failure(self):
        class Broken(DummyDependencies):
            def call(self, *args, **kwargs):
                raise OSError("private server detail")
        engine = System14(dependencies=Broken())
        self.addCleanup(engine.close)
        command = self.f.command("ViewRecord", "bank", {"table": "economic_account"})
        result = engine.process(command)
        self.assertEqual(result["failure_code"], "OWNER_UNAVAILABLE")
        self.assertNotIn("private", json.dumps(result))

    def test_changed_request_semantics_cannot_reuse_key(self):
        command = self.f.command("TransferFunds", "bank", {"source": "bank", "destination": "other", "cents": 100, "instrument": "bank-instrument"})
        self.f.engine.process(command)
        command["payload"]["cents"] = 200
        self.f.authorize(command)
        self.assertEqual(self.f.engine.process(command)["failure_code"], "DUPLICATE_REQUEST")
        self.assertEqual(self.f.balance("bank"), 19900)

    def test_bool_is_not_money(self):
        result = self.f.transfer(True)
        self.assertEqual(result["failure_code"], "INVALID_AMOUNT")
        self.assertEqual(self.f.balance("bank"), 20000)

    def test_no_binary_float_json(self):
        command = self.f.command("TransferFunds", "bank", {"source": "bank", "destination": "other", "cents": 100, "instrument": "bank-instrument"})
        command["payload"]["cents"] = 0.1
        result = self.f.engine.process(command)
        self.assertEqual(result["failure_code"], "INVALID_JSON")

    def test_bank_to_cash_requires_banking_service(self):
        result = self.f.transfer(1000, "bank", "cash")
        self.assertEqual(result["failure_code"], "BANKING_REQUIRED")
        self.assertEqual((self.f.balance("bank"), self.f.balance("cash")), (20000, 4000))

    def test_cash_deposit_preserves_physical_cash_in_vault(self):
        self.f.fact("institutions", "bank_operation", "deposit", {"available": True, "accepted": True,
            "source_ref": "cash", "destination_ref": "bank", "amount_cents": 1000, "fee_cents": 0,
            "operation_kind": "CASH_DEPOSIT", "availability": "IMMEDIATE", "vault_account_ref": "vault",
            "institutional_liability_ref": "bank-liability", "cash_exchange_authorized": True})
        self.f.timing("deposit")
        self.f.ready("institutions", "bank_transfer", "deposit")
        result = self.f.run("BankTransfer", "deposit", {"source": "cash", "destination": "bank", "cents": 1000, "instrument": "cash-instrument"})
        self.assertEqual(result["status"], "COMMITTED", result)
        self.assertEqual((self.f.balance("cash"), self.f.balance("vault"), self.f.balance("bank")), (3000, 101000, 21000))
        self.assertEqual(self.f.balance("bank-liability"), -21000)

    def test_card_purchase_does_not_mint_merchant_cash(self):
        self.f.shop()
        result = self.f.buy(self.f.quote(), "bank")
        self.assertEqual(result["status"], "COMMITTED", result)
        self.assertEqual(self.f.balance("merchant"), 5000)
        self.assertEqual(self.f.balance("merchant-bank"), 6250)

    def test_before_prepare_crash_is_durable(self):
        self.f.shop()
        command = self.f.buy_command(self.f.quote())
        with self.assertRaises(SimulatedCrash):
            self.f.engine.process(command, crash_at="before_prepare")
        self.assertEqual(self.f.balance("cash"), 4000)
        self.f.engine.recover()
        self.assertEqual(self.f.balance("cash"), 2750)

    def test_after_owner_commit_crash_replays_same_receipt(self):
        self.f.shop()
        q = self.f.quote()
        command = self.f.buy_command(q)
        with self.assertRaises(SimulatedCrash):
            self.f.engine.process(command, crash_at="after_owner_commit")
        self.f.engine.recover()
        self.assertEqual(self.f.balance("cash"), 2750)
        sale = self.f.get("order_and_sale_receipt", reference("sale", q))
        self.assertEqual(len(sale["item_or_service_receipt_refs"]), 1)

    def test_cancel_prepared_request_releases_holds(self):
        self.f.shop()
        q = self.f.quote()
        self.f.dep.fixtures.pop(("inventory", "prepare:purchase_transfer", q))
        command = self.f.buy_command(q)
        pending = self.f.engine.process(command)
        self.assertEqual(pending["status"], "OWNER_PENDING", pending)
        self.assertEqual(self.f.engine._holds(self.f.state(), "A", "cash"), 1250)
        request_ref = reference("request", "A", "pc", command["request_key"])
        result = self.f.run("CancelPending", request_ref)
        self.assertEqual(result["status"], "COMMITTED", result)
        self.f.engine.recover()
        self.assertEqual(self.f.engine._holds(self.f.state(), "A", "cash"), 0)
        self.assertEqual(self.f.balance("cash"), 4000)

    def test_cancel_cannot_reverse_decided_commit(self):
        self.f.shop()
        q = self.f.quote()
        self.f.dep.fixtures.pop(("inventory", "commit:purchase_transfer", q))
        command = self.f.buy_command(q)
        pending = self.f.engine.process(command)
        self.assertEqual(pending["status"], "OWNER_PENDING", pending)
        request_ref = reference("request", "A", "pc", command["request_key"])
        result = self.f.run("CancelPending", request_ref)
        self.assertEqual(result["failure_code"], "ALREADY_COMMITTED")
        self.assertEqual(self.f.balance("cash"), 2750)

    def test_prepare_rejection_aborts_without_debit(self):
        self.f.shop()
        q = self.f.quote()
        self.f.dep.fixtures["inventory", "prepare:purchase_transfer", q] = {"status": "STOCK_UNAVAILABLE"}
        result = self.f.buy(q)
        self.assertEqual(result["failure_code"], "STOCK_UNAVAILABLE", result)
        self.assertEqual(self.f.balance("cash"), 4000)
        self.assertEqual(self.f.engine._holds(self.f.state(), "A", "cash"), 0)

    def test_recovery_completes_owner_without_new_debit(self):
        self.f.shop()
        q = self.f.quote()
        self.f.dep.fixtures.pop(("inventory", "commit:purchase_transfer", q))
        command = self.f.buy_command(q)
        self.f.engine.process(command)
        self.assertEqual(self.f.balance("cash"), 2750)
        self.f.ready("inventory", "purchase_transfer", q)
        self.f.engine.recover()
        self.assertEqual(self.f.engine.process(command)["status"], "COMMITTED")
        self.assertEqual(self.f.balance("cash"), 2750)

    def test_old_quote_honors_old_catalog(self):
        self.f.shop()
        q = self.f.quote()
        self.f.policy("new-prices", {"items": {"food": {"unit_price_cents": 9999, "taxable": False, "eligible_charge_basis_refs": []}},
            "tax_rules": [], "service_charge_rules": [], "quote_valid_seconds": 600, "settlement_account_ref": "merchant"})
        self.f.fact("content", "merchant_update", "shop", {"changes": {"price_catalog_ref": "new-prices", "price_revision": 2, "offer_effective_time": 0}})
        result = self.f.run("UpdateMerchantOffer", "shop", developer=True, revision=1)
        self.assertEqual(result["status"], "COMMITTED", result)
        result = self.f.buy(q)
        self.assertEqual(result["result"]["paid_cents"], 1250, result)

    def test_pending_hold_blocks_second_purchase(self):
        f = Fixture(state=initial_state(cash=2000))
        self.addCleanup(f.engine.close)
        f.shop()
        q = f.quote()
        f.dep.fixtures.pop(("inventory", "prepare:purchase_transfer", q))
        first = f.buy(q)
        self.assertEqual(first["status"], "OWNER_PENDING", first)
        second = f.transfer(800, "cash", "merchant")
        self.assertEqual(second["failure_code"], "INSUFFICIENT_AVAILABLE_FUNDS")

    def test_late_fee_frequency_cap_local(self):
        self.f.obligation(state="OVERDUE")
        self.f.seed("fee_rule", "late-rule", {"amount_or_calculation": 100, "trigger": "OVERDUE", "basis": "UNPAID",
            "frequency_cap": {"count": 1, "amount_cents": 100}, "notice_requirements": "DELIVERED", "policy_version": "v1"})
        self.f.fact("institutions", "agreement_amendment", "lease", {"accepted_by_required_parties": True, "effective_time": 0,
            "table": "obligation_terms", "changes": {"late_fee_rules": ["late-rule"]}, "amendment_ref": "add-fee"})
        self.f.run("AmendAgreement", "lease")
        fact = {"fee_rule_ref": "late-rule", "accepted": True, "triggered": True, "notice_satisfied": True,
                "trigger_key": "one", "period_key": "month", "amount_cents": 100, "remaining_cap_cents": 100}
        self.f.fact("content", "late_fee", "rent", fact)
        first = self.f.run("AssessLateFee", "rent")
        self.assertEqual(first["status"], "COMMITTED", first)
        fact["trigger_key"] = "two"
        self.f.fact("content", "late_fee", "rent", fact)
        second = self.f.run("AssessLateFee", "rent")
        self.assertEqual(second["failure_code"], "CAP_EXCEEDED")
        self.assertEqual(self.f.get("obligation", "rent")["issued_cents"], 85100)

    def test_stale_balance_observation_does_not_leak_current(self):
        known = {"posted_balance_cents": 19000, "active_holds_cents": 0, "available_owned_funds_cents": 19000,
            "unused_approved_facility_cents": 0, "pending_inflows_cents": 0, "outstanding_debt_cents": 0}
        self.f.fact("knowledge", "balance_observation", "bank", {"principal_id": "pc", "account_ref": "bank", "observed_revision": -1,
            "known_balances": known})
        result = self.f.run("GetBalances", "bank")
        self.assertEqual(result["result"]["balances"]["posted_balance_cents"], 19000, result)
        self.assertFalse(result["result"]["current"])

    def test_current_balance_is_ledger_derived(self):
        self.f.fact("knowledge", "balance_observation", "bank", {"principal_id": "pc", "account_ref": "bank", "observed_revision": 0})
        result = self.f.run("GetBalances", "bank")
        self.assertEqual(result["result"]["balances"]["posted_balance_cents"], 20000, result)

    def test_currency_mismatch_is_atomic(self):
        state = initial_state()
        state.get("economic_account", "A", "other")["currency"] = "EUR"
        for _, posting in state.rows("money_posting", "A"):
            if posting["account_id"] == "other":
                posting["currency"] = "EUR"
        f = Fixture(state=state)
        self.addCleanup(f.engine.close)
        result = f.transfer(100)
        self.assertEqual(result["failure_code"], "INVALID_CURRENCY")
        self.assertEqual(f.balance("bank"), 20000)

    def test_exact_rounding_signed_and_large(self):
        self.assertEqual(round_half_up(Fraction(1, 2)), 1)
        self.assertEqual(round_half_up(Fraction(-1, 2)), -1)
        self.assertEqual(round_half_up(Fraction(8000 * 15, 100)), 1200)
        self.assertEqual(money(MAX_MONEY), MAX_MONEY)

    def test_missing_core_field_rejected_on_restore(self):
        state = initial_state().export()
        account = next(iter(state["core_records"]["economic_account"].values()))
        del account["currency"]
        with self.assertRaises(DomainError):
            System14State.restore(state)

    def test_snapshot_cannot_hide_unbalanced_posting(self):
        state = initial_state()
        posting = next(iter(state.table("money_posting").values()))
        posting["amount_cents"] += 1
        with self.assertRaises(DomainError):
            System14(initial_state=state)

    def test_same_request_concurrency_returns_same_receipt(self):
        command = self.f.command("TransferFunds", "bank", {"source": "bank", "destination": "other", "cents": 100, "instrument": "bank-instrument"})
        barrier = threading.Barrier(2)
        def invoke():
            barrier.wait()
            return self.f.engine.process(command)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            a, b = [pool.submit(invoke) for _ in range(2)]
            self.assertEqual(a.result(), b.result())
        self.assertEqual(self.f.balance("bank"), 19900)

    def test_fractional_item_quantity_uses_exact_arithmetic(self):
        self.f.shop(unit=100)
        result = self.f.run("QuotePurchase", "shop", {"merchant": "shop", "lines": [
            {"item_ref": "food", "quantity": {"numerator": 1, "denominator": 2}}], "fulfillment": "COUNTER"})
        self.assertEqual(result["status"], "QUOTED", result)
        self.assertEqual(result["result"]["quote"]["final_cents"], 50)

    def test_task_reservation_cannot_create_two_outputs(self):
        helper = RoutineRecoveryAcceptance()
        helper.f = self.f
        helper.preferences()
        self.f.fact("inventory", "task_resources", "wash", {"authorized": True, "resources_present": True, "facilities_usable": True,
            "reservation_refs": ["ingredients-1"], "output_receipt_ref": "meal-1", "payment_required": False,
            "reservation_expiry": 10000, "source_revision": 0})
        self.f.ready("inventory", "cook", "wash")
        self.f.timing("wash")
        first = self.f.run("Cook", "laundry")
        second = self.f.run("Cook", "laundry")
        self.assertEqual(first["status"], "COMMITTED", first)
        self.assertEqual(second["failure_code"], "RESOURCE_UNAVAILABLE")
        self.assertEqual(len(self.f.get("grocery_and_task_preferences", "laundry")["output_or_completion_receipt_refs"]), 1)

    def test_two_subscriber_acks_are_merged(self):
        self.f.transfer(100)
        event = next(r for _, r in self.f.state().rows("outbox_and_recovery", "A") if r["event_type"] == "MoneySettled")
        self.f.fact("content", "subscriptions", "subscribers", {"subscribers": [
            {"owner": "knowledge", "event_types": ["MoneySettled"]}, {"owner": "institutions", "event_types": ["MoneySettled"]}]})
        self.f.ready("knowledge", "event", event["event_id"])
        self.f.ready("institutions", "event", event["event_id"])
        result = self.f.run("PublishEvents", "subscribers", owner_event=True)
        self.assertEqual(result["status"], "COMMITTED", result)
        state = self.f.get("outbox_and_recovery", event["event_id"])["subscriber_delivery_state"]
        self.assertEqual(state, {"knowledge": "ACKNOWLEDGED", "institutions": "ACKNOWLEDGED"})

    def test_pending_owner_event_is_not_published_as_complete(self):
        self.f.shop()
        q = self.f.quote()
        self.f.dep.fixtures.pop(("inventory", "commit:purchase_transfer", q))
        self.f.buy(q)
        event = next(r for _, r in self.f.state().rows("outbox_and_recovery", "A") if r["event_type"] == "MoneySettled")
        self.f.fact("content", "subscriptions", "subscribers", {"subscribers": [{"owner": "knowledge", "event_types": ["MoneySettled"]}]})
        self.f.ready("knowledge", "event", event["event_id"])
        result = self.f.run("PublishEvents", "subscribers", owner_event=True)
        self.assertEqual(result["status"], "COMMITTED", result)
        self.assertEqual(self.f.get("outbox_and_recovery", event["event_id"])["subscriber_delivery_state"], {})

    def test_last_unit_concurrent_buyers(self):
        self.f.shop()
        commands = [self.f.buy_command(self.f.quote()) for _ in range(2)]
        barrier = threading.Barrier(2)
        def buy(command):
            barrier.wait()
            return self.f.engine.process(command)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            pending = [pool.submit(buy, command) for command in commands]
            results = [future.result() for future in pending]
        self.assertEqual(sum(result["status"] == "COMMITTED" for result in results), 1, results)
        self.assertEqual(self.f.balance("cash"), 2750)

    def test_whole_split_payment_rolls_back_all_if_one_payer_cannot_fund(self):
        helper = HousingCommerceAcceptance()
        helper.f = self.f
        helper.split()
        for payer, account, amount in [("pc", "bank", 3334), ("merchant", "merchant-bank", 3334), ("other", "other", 3333)]:
            payment_ref = reference("tab-share", "tab", payer)
            self.f.fact("ui", "split_authorization", payment_ref, {"accepted": True, "payer_ref": payer, "tab_ref": "tab",
                "amount_cents": amount, "account_ref": account, "instrument_ref": account + "-instrument"})
        result = self.f.run("PayWholeSplitBill", "tab")
        self.assertEqual(result["failure_code"], "INSUFFICIENT_AVAILABLE_FUNDS", result)
        self.assertEqual(self.f.balance("bank"), 20000)
        self.assertEqual(self.f.balance("merchant-bank"), 5000)
        self.assertEqual(self.f.get("restaurant_tab_and_split", "tab")["remaining_due_cents"], 10001)


if __name__ == "__main__":
    unittest.main()
