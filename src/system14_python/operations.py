"""System 14 domain operations. External decisions are opaque JSON contracts."""

from __future__ import annotations

from fractions import Fraction
from typing import TYPE_CHECKING

from .state import DomainError, Object, require, integer, money, rational, ratio, quantity, round_half_up, clone, canonical

if TYPE_CHECKING:
    from .engine import Context


def ref(prefix: str, *parts) -> str:
    from .engine import reference
    return reference(prefix, *parts)


def patch(table: str, reference: str, values: Object | None = None, append: list[str] | None = None) -> Object:
    return {"table": table, "reference": reference, "set": values or {}, "append_receipt": append or []}


class Operations:
    """Handlers share the engine's exact ledger, authorization and coordinator."""

    def _check_mandate(self, c: Context, source: str, amount: int, operation: str,
                       target: str, goods: list[str] | None = None) -> None:
        mandate_ref = c.payload.get("mandate_ref")
        if mandate_ref is None:
            require(c.authority.get("explicit_action") is True, "NO_SPENDING_MANDATE")
            return
        mandate = c.get("routine_mandate", mandate_ref)
        plan = c.get("routine_plan", mandate["plan_ref"])
        execution = c.get("routine_execution", mandate_ref)
        require(mandate["principal_id"] == c.principal and mandate["payment_source_id"] == source, "NO_SPENDING_MANDATE")
        require(mandate["expiry"] > c.now and plan["activation_or_schedule_ref"] is not None, "NO_SPENDING_MANDATE")
        require(execution["state"] in {"ACTIVE", "RUNNING"}, "NO_SPENDING_MANDATE")
        require(plan["duration_or_time_window"]["start_time"] <= c.now < plan["duration_or_time_window"]["end_time"], "NO_SPENDING_MANDATE")
        require(any(a["operation"] == operation and a["target_ref"] in {target, c.command["target_ref"]}
                    for a in plan["activities"]), "NO_SPENDING_MANDATE")
        if goods is not None:
            require(set(goods) <= set(plan["resource_refs"]) | set(plan["approved_substitute_refs"]), "CHOICE_REQUIRED")
        reserved = 0
        for other_ref, row in c.state.rows("request_and_coordinator", c.branch):
            if row["coordinator_decision"] != "UNDECIDED" or other_ref == c.request_ref:
                continue
            document = c.get("notice_and_observation_channel", row["source_context_ref"])["content"]
            if document["command"]["payload"].get("mandate_ref") == mandate_ref:
                reserved += sum(c.get("funds_hold", h)["amount_cents"] for h in row["participant_reservation_refs"]
                                if c.state.find("funds_hold", c.branch, h) and c.get("funds_hold", h)["state"] == "ACTIVE")
        require(amount <= mandate["per_action_cap"], "CAP_EXCEEDED")
        require(execution["period_spent_cents"] + reserved + amount <= mandate["period_cap"], "CAP_EXCEEDED")
        require(execution["total_spent_cents"] + reserved + amount <= plan["total_budget_cents"], "CAP_EXCEEDED")
        execution["period_spent_cents"] = money(execution["period_spent_cents"] + amount)
        execution["total_spent_cents"] = money(execution["total_spent_cents"] + amount)

    def _cmd_OpenAccount(self, c: Context) -> None:
        accepted = c.call("institutions", "open_account", c.command["target_ref"])
        require(accepted.get("accepted") is True and accepted.get("identity_documents_verified") is True, "ACCESS_DENIED")
        account, instrument = accepted["economic_account"], accepted["account_product_and_instrument"]
        require(account["owner_id"] == c.principal and account["branch_id"] == c.branch, "ACCESS_DENIED")
        require(c.state.find("economic_account", c.branch, account["id"]) is None, "REVISION_CONFLICT")
        require(instrument["account_id"] == account["id"], "INVALID_REFERENCE")
        c.put("economic_account", account["id"], clone(account))
        c.put("account_product_and_instrument", instrument["instrument_id"], clone(instrument))
        c.effect("institutions", "open_account", c.command["target_ref"], {"account_ref": account["id"]})
        c.result = {"account_ref": account["id"]}

    def _cmd_BankTransfer(self, c: Context) -> None:
        p = c.payload
        instrument = self._instrument(c, p["instrument"], p["source"])
        service = c.call("institutions", "bank_operation", c.command["target_ref"])
        require(service.get("available") is True and service.get("accepted") is True, "INSTRUMENT_UNAVAILABLE")
        require(service["source_ref"] == p["source"] and service["destination_ref"] == p["destination"]
                and service["amount_cents"] == p["cents"], "ACCESS_DENIED")
        if service["operation_kind"] == "ATM_WITHDRAWAL":
            require(service.get("cash_capacity_cents", 0) >= p["cents"] and service.get("within_product_limit") is True,
                    "INSTRUMENT_UNAVAILABLE")
        self._check_mandate(c, p["source"], money(p["cents"] + service["fee_cents"]), "BankTransfer", p["destination"])
        c.revision(c.get("economic_account", p["source"]))
        if service["fee_cents"]:
            fee = c.policy(service["fee_policy_ref"], instrument["accepted_terms_version"])
            require(service["fee_policy_ref"] in instrument["fee_policy_refs"] and service.get("fee_accepted") is True,
                    "NO_SPENDING_MANDATE")
            require(fee["amount_cents"] == service["fee_cents"] and service.get("fee_triggered") is True
                    and service.get("fee_notice_satisfied") is True and service.get("fee_frequency_remaining", 0) > 0, "POLICY_MISSING")
        if service["availability"] == "IMMEDIATE":
            self._bank_settle(c, service, p["source"], p["destination"], p["cents"], p["instrument"])
            if service["fee_cents"]:
                self._transfer(c, p["source"], service["fee_account_ref"], service["fee_cents"], p["instrument"])
            c.effect("institutions", "bank_transfer", c.command["target_ref"], {"transaction_ref": c.tx_ref})
        else:
            require(service["fee_cents"] == 0, "POLICY_MISSING")
            if service["operation_kind"] == "CASH_DEPOSIT":
                # Physical cash is received into the explicit clearing account;
                # customer funds remain pending until the clearing owner confirms.
                require(c.get("economic_account", service["vault_account_ref"])["kind"] == "CASH"
                        and c.get("economic_account", service["institutional_liability_ref"])["kind"] == "LIABILITY", "POLICY_MISSING")
                self._transfer(c, p["source"], service["vault_account_ref"], p["cents"], p["instrument"])
                pending_source = service["institutional_liability_ref"]
                hold_ref = None
            elif service["operation_kind"] == "CHECK_DEPOSIT":
                require(service.get("check_possessed") is True, "ACCESS_DENIED")
                pending_source, hold_ref = p["source"], None
            else:
                source = c.get("economic_account", p["source"])
                amount = money(p["cents"], nonnegative=True)
                require(self._balance(c.state, c.branch, p["source"]) - self._holds(c.state, c.branch, p["source"]) >= amount,
                        "INSUFFICIENT_AVAILABLE_FUNDS")
                hold_ref = ref("clearing-hold", c.request_ref)
                c.put("funds_hold", hold_ref, {"id": hold_ref, "account_id": p["source"], "request_key": c.command["request_key"],
                    "amount_cents": amount, "expiry_time": service["expiry_time"], "captured_cents": 0, "state": "ACTIVE", "revision": 0})
                source["revision"] += 1
                pending_source = p["source"]
            operation_ref = (ref("check-deposit", c.command["target_ref"]) if service["operation_kind"] == "CHECK_DEPOSIT"
                             else ref("bank-operation", c.request_ref))
            require(c.state.find("pending_banking_operation", c.branch, operation_ref) is None, "DUPLICATE_REQUEST")
            c.put("pending_banking_operation", operation_ref, {
                "id": operation_ref, "request_key": c.command["request_key"], "operation_kind": service["operation_kind"],
                "source_ref": pending_source, "destination_ref": p["destination"], "instrument_ref": p["instrument"],
                "amount_cents": p["cents"], "hold_ref": hold_ref, "availability_policy_ref": instrument["availability_policy_ref"],
                "clearing_event_ref": None, "irrevocable_settlement_point": service["irrevocable_settlement_point"],
                "state": "PENDING", "receipt_ref": None,
            })
            c.status = "PENDING"
            c.result = {"operation_ref": operation_ref, "available_cents_created": 0}
        c.time_effect(c.command["target_ref"])

    def _bank_settle(self, c: Context, service: Object, source: str, destination: str, amount: int, instrument: str) -> None:
        source_kind, destination_kind = c.get("economic_account", source)["kind"], c.get("economic_account", destination)["kind"]
        if (source_kind == "CASH") == (destination_kind == "CASH"):
            self._transfer(c, source, destination, amount, instrument)
            return
        vault, liability = service["vault_account_ref"], service["institutional_liability_ref"]
        vault_account, liability_account = c.get("economic_account", vault), c.get("economic_account", liability)
        require(vault_account["kind"] == "CASH" and liability_account["kind"] == "LIABILITY"
                and vault_account["owner_id"] == liability_account["owner_id"]
                and vault_account["currency"] == liability_account["currency"] == c.get("economic_account", source)["currency"], "POLICY_MISSING")
        require(service.get("cash_exchange_authorized") is True, "ACCESS_DENIED")
        if source_kind == "CASH":
            require(service["operation_kind"] == "CASH_DEPOSIT", "POLICY_MISSING")
            self._transfer(c, source, vault, amount, instrument)
            self._post(c, liability, -amount)
            self._post(c, destination, amount)
        else:
            require(service["operation_kind"] in {"ATM_WITHDRAWAL", "TELLER_WITHDRAWAL"}, "POLICY_MISSING")
            self._transfer(c, source, liability, amount, instrument)
            self._transfer(c, vault, destination, amount, None, source_authorized=True)

    def _cmd_ClearBankOperation(self, c: Context) -> None:
        operation = c.get("pending_banking_operation", c.command["target_ref"])
        if operation["state"] == "SETTLED":
            c.result = {"transaction_ref": operation["receipt_ref"]}
            return
        require(operation["state"] == "PENDING", "INVALID_STATE")
        decision = c.call("institutions", "clearing", operation["id"])
        require(decision.get("operation_ref") == operation["id"], "ACCESS_DENIED")
        operation["clearing_event_ref"] = decision["event_ref"]
        if not decision["accepted"]:
            operation["state"] = "RETURN_DUE" if operation["operation_kind"] == "CASH_DEPOSIT" else "REJECTED"
            if operation["hold_ref"]:
                c.get("funds_hold", operation["hold_ref"])["state"] = "RELEASED"
            c.result = {"operation_ref": operation["id"], "cleared": False}
            return
        require(decision.get("settlement_authorized") is True, "ACCESS_DENIED")
        if operation["operation_kind"] == "CASH_DEPOSIT":
            source, destination = c.get("economic_account", operation["source_ref"]), c.get("economic_account", operation["destination_ref"])
            require(source["kind"] == "LIABILITY" and source["currency"] == destination["currency"], "POLICY_MISSING")
            self._post(c, operation["source_ref"], -operation["amount_cents"])
            self._post(c, operation["destination_ref"], operation["amount_cents"])
        else:
            self._transfer(c, operation["source_ref"], operation["destination_ref"], operation["amount_cents"], None,
                           source_authorized=True, capture_hold=operation["hold_ref"])
        operation["state"], operation["receipt_ref"] = "SETTLED", c.tx_ref
        c.effect("institutions", "clearing", operation["id"], {"transaction_ref": c.tx_ref})
        c.result = {"transaction_ref": c.tx_ref}

    def _cmd_CancelBankOperation(self, c: Context) -> None:
        operation = c.get("pending_banking_operation", c.command["target_ref"])
        require(operation["state"] == "PENDING", "INVALID_STATE")
        decision = c.call("institutions", "cancel_clearing", operation["id"])
        require(decision.get("cancellable") is True and decision.get("principal_id") == c.principal, "ACCESS_DENIED")
        require(operation["operation_kind"] != "CASH_DEPOSIT", "CHOICE_REQUIRED")
        if operation["hold_ref"]:
            c.get("funds_hold", operation["hold_ref"])["state"] = "RELEASED"
        operation["state"] = "CANCELLED"
        c.effect("institutions", "cancel_clearing", operation["id"], {"operation_ref": operation["id"]})

    def _cmd_SettleIncome(self, c: Context) -> None:
        fact = c.call("system13", "wage_entitlement", c.command["target_ref"])
        entitlement = fact["income_settlement"]
        entitlement_ref = entitlement["source_entitlement_ref"]
        previous = c.state.find("income_settlement", c.branch, entitlement_ref)
        if previous and previous["settlement_state"] in {"SETTLED", "CHECK_PENDING"}:
            c.result = {"transaction_ref": previous["transaction_ref"]}
            c.status = "PENDING" if previous["settlement_state"] == "CHECK_PENDING" else "COMMITTED"
            return
        require(fact.get("approved") is True and fact.get("settlement_authorized") is True, "ACCESS_DENIED")
        require(entitlement["beneficiary_ref"] == c.principal or c.authority.get("owner_event") is True, "ACCESS_DENIED")
        if previous:
            require(all(previous[k] == entitlement[k] for k in ("approved_net_owed_cents", "payer_ref", "beneficiary_ref", "source_period_key")), "REVISION_CONFLICT")
        income = c.put("income_settlement", entitlement_ref, clone(entitlement))
        if income["payment_method"] == "CHECK":
            income["settlement_state"] = "CHECK_PENDING"
            c.effect("system13", "deliver_paycheck", entitlement_ref, {"entitlement_ref": entitlement_ref})
            c.status, c.result = "PENDING", {"entitlement_ref": entitlement_ref, "available_cents_created": 0}
            return
        source = fact["payer_account_ref"]
        amount = money(income["approved_net_owed_cents"], nonnegative=True)
        if self._balance(c.state, c.branch, source) - self._holds(c.state, c.branch, source, ref("hold", c.request_ref, source)) < amount:
            income["settlement_state"], income["failure_code"] = "OWED", "INSUFFICIENT_AVAILABLE_FUNDS"
            c.event("WageSettlementFailed", entitlement_ref)
            c.status, c.result = "REJECTED", {"failure_code": "INSUFFICIENT_AVAILABLE_FUNDS", "entitlement_ref": entitlement_ref}
            return
        if income["payment_method"] == "CASH_HANDOFF":
            require(c.get("economic_account", source)["kind"] == "CASH"
                    and c.get("economic_account", fact["beneficiary_account_ref"])["kind"] == "CASH", "CASH_NOT_PRESENT")
        self._transfer(c, source, fact["beneficiary_account_ref"], amount, None, source_authorized=True)
        income["settlement_state"], income["transaction_ref"], income["failure_code"] = "SETTLED", c.tx_ref, None
        c.effect("system13", "wage_receipt", entitlement_ref, {"transaction_ref": c.tx_ref})
        c.result = {"amount_cents": amount, "entitlement_ref": entitlement_ref}

    def _cmd_IssueObligation(self, c: Context) -> None:
        terms = c.get("obligation_terms", c.command["target_ref"])
        period = c.call("system11", "obligation_period", c.command["causal_event_ref"])
        require(period["agreement_ref"] == terms["agreement_ref"] and period.get("issued") is True, "ACCESS_DENIED")
        obligation_ref = ref("obligation", terms["agreement_ref"], period["period_key"], terms["charge_type"])
        old = c.state.find("obligation", c.branch, obligation_ref)
        if old:
            c.result = {"obligation_ref": obligation_ref, "state": old["state"]}
            return
        calculation = c.policy(terms["amount_calculation"])
        amount = money(calculation["amount_cents"], nonnegative=True)
        require(calculation.get("accepted") is True, "NO_SPENDING_MANDATE")
        c.put("obligation", obligation_ref, {"id": obligation_ref, "agreement_id": terms["agreement_ref"],
            "debtor_id": calculation["debtor_ref"], "creditor_id": calculation["creditor_ref"],
            "period_key": period["period_key"], "issued_cents": amount, "settled_cents": 0,
            "due_time": period["due_time"], "state": "OPEN", "dispute_id": None, "revision": 0})
        c.event("ObligationIssued", obligation_ref, period["period_key"])
        c.result = {"obligation_ref": obligation_ref, "issued_cents": amount}

    def _cmd_MarkObligationOverdue(self, c: Context) -> None:
        obligation = c.get("obligation", c.command["target_ref"])
        timer = c.call("system11", "timer", c.command["causal_event_ref"])
        require(timer["target_ref"] == obligation["id"] and c.now > obligation["due_time"], "ACCESS_DENIED")
        if obligation["state"] in {"OPEN", "PARTIAL", "SCHEDULED"}:
            obligation["state"], obligation["revision"] = "OVERDUE", obligation["revision"] + 1
            c.event("ObligationOverdue", obligation["id"], obligation["period_key"])
        c.result = {"obligation_ref": obligation["id"], "state": obligation["state"]}

    def _cmd_PayObligation(self, c: Context) -> None:
        p = c.payload
        obligation = c.get("obligation", c.command["target_ref"])
        c.revision(obligation)
        require(obligation["state"] not in {"WAIVED", "REVERSED", "SCHEDULED"}, "INVALID_STATE")
        if obligation["state"] == "SETTLED":
            c.result = {"obligation_ref": obligation["id"], "remaining_cents": 0}
            return
        terms = c.get("obligation_terms", obligation["agreement_id"])
        policy = c.policy(terms["partial_payment_rule"])
        amount = money(p["cents"], nonnegative=True)
        remaining = obligation["issued_cents"] - obligation["settled_cents"]
        require(amount > 0 and (amount >= remaining or policy["partial_allowed"] is True), "PARTIAL_PAYMENT_NOT_ALLOWED")
        require(c.get("economic_account", p["source"])["currency"] == terms["currency"], "INVALID_CURRENCY")
        self._check_mandate(c, p["source"], amount, "PayObligation", obligation["id"])
        if p.get("autopay_ref"):
            autopay = c.get("autopay_authorization", p["autopay_ref"])
            require(autopay["payer_account_ref"] == p["source"] and autopay["expiry"] > c.now
                    and terms["charge_type"] in autopay["eligible_obligation_classes"], "NO_SPENDING_MANDATE")
            require(amount <= autopay["amount_cap_cents"] and autopay["period_spent_cents"] + amount <= autopay["period_budget_cents"], "CAP_EXCEEDED")
            autopay["period_spent_cents"] = money(autopay["period_spent_cents"] + amount)
        applied, excess = min(amount, remaining), max(0, amount - remaining)
        require(not excess or terms["overpayment_rule"] in {"CREDIT", "REFUND"}, "OVERPAYMENT_NOT_ALLOWED")
        calculation = c.policy(terms["amount_calculation"])
        destination = calculation["creditor_account_ref"]
        require(c.get("economic_account", destination)["owner_id"] == obligation["creditor_id"], "ACCESS_DENIED")
        # REFUND means the excess is never captured; the receipt exposes it.
        transfer_amount = applied if excess and terms["overpayment_rule"] == "REFUND" else amount
        self._transfer(c, p["source"], destination, transfer_amount, p["instrument"])
        allocation = c.call("content", "allocation", obligation["id"])
        require(allocation["amount_cents"] == applied and allocation["allocation_order"] == terms["allocation_order"], "POLICY_MISSING")
        principal, interest, fees = (money(allocation[name], nonnegative=True) for name in ("principal_cents", "interest_cents", "fee_cents"))
        require(principal + interest + fees == applied, "INVALID_ALLOCATION")
        c.put("settlement_allocation", ref("allocation", c.tx_ref, obligation["id"]), {
            "transaction_ref": c.tx_ref, "obligation_ref": obligation["id"], "period_key": obligation["period_key"],
            "principal_cents": principal, "interest_cents": interest, "fee_cents": fees, "credit_or_refund_cents": excess})
        obligation["settled_cents"] += applied
        obligation["revision"] += 1
        obligation["state"] = "SETTLED" if applied == remaining else ("DISPUTED" if obligation["dispute_id"] else "PARTIAL")
        c.event("PaymentAllocated", obligation["id"], c.tx_ref)
        c.result = {"obligation_ref": obligation["id"], "paid_cents": transfer_amount,
                    "remaining_cents": remaining - applied, "credit_or_refund_cents": excess}

    def _cmd_DisputeObligation(self, c: Context) -> None:
        obligation = c.get("obligation", c.command["target_ref"])
        c.revision(obligation)
        require(c.principal in {obligation["debtor_id"], obligation["creditor_id"]}, "ACCESS_DENIED")
        fact = c.call("institutions", "dispute", obligation["id"])
        require(fact.get("authorized") is True, "ACCESS_DENIED")
        obligation["dispute_id"], obligation["state"] = fact["dispute_ref"], "DISPUTED"
        obligation["revision"] += 1
        c.effect("institutions", "dispute", obligation["id"], {"dispute_ref": fact["dispute_ref"]})

    def _cmd_AdjustObligation(self, c: Context) -> None:
        obligation = c.get("obligation", c.command["target_ref"])
        c.revision(obligation)
        fact = c.call("institutions", "adjust_obligation", obligation["id"])
        require(fact.get("authorized") is True and fact["state"] in {"WAIVED", "REVERSED"}, "ACCESS_DENIED")
        obligation["state"], obligation["revision"] = fact["state"], obligation["revision"] + 1
        c.event("ObligationAdjusted", obligation["id"], fact["authority_ref"])

    def _cmd_AssessLateFee(self, c: Context) -> None:
        obligation = c.get("obligation", c.command["target_ref"])
        terms = c.get("obligation_terms", obligation["agreement_id"])
        require(obligation["state"] == "OVERDUE", "INVALID_STATE")
        fact = c.call("content", "late_fee", obligation["id"])
        require(fact["fee_rule_ref"] in terms["late_fee_rules"] and fact.get("accepted") is True
                and fact.get("triggered") is True and fact.get("notice_satisfied") is True, "POLICY_MISSING")
        rule = c.get("fee_rule", fact["fee_rule_ref"])
        require(rule["policy_version"] == c.command["policy_version"], "POLICY_MISSING")
        event_ref = ref("late-fee", obligation["id"], fact["trigger_key"])
        if c.state.find("outbox_and_recovery", c.branch, event_ref):
            return
        amount = money(fact["amount_cents"], nonnegative=True)
        require(amount <= fact["remaining_cap_cents"], "CAP_EXCEEDED")
        basis = obligation["issued_cents"] - obligation["settled_cents"] if rule["basis"] == "UNPAID" else obligation["issued_cents"]
        require(rule["basis"] in {"UNPAID", "ISSUED"}, "POLICY_MISSING")
        expected = (money(rule["amount_or_calculation"], nonnegative=True) if type(rule["amount_or_calculation"]) is int
                    else round_half_up(Fraction(basis) * rational(rule["amount_or_calculation"])))
        require(amount == expected, "INVALID_AMOUNT")
        prior = []
        for _, notice in c.state.rows("notice_and_observation_channel", c.branch):
            previous = notice["content"].get("fee_fact") if type(notice["content"]) is dict else None
            if previous and previous["fee_rule_ref"] == fact["fee_rule_ref"] and previous["period_key"] == fact["period_key"]:
                prior.append(previous)
        require(len(prior) < rule["frequency_cap"]["count"] and sum(p["amount_cents"] for p in prior) + amount <= rule["frequency_cap"]["amount_cents"], "CAP_EXCEEDED")
        obligation["issued_cents"] = money(obligation["issued_cents"] + amount)
        obligation["revision"] += 1
        c.put("outbox_and_recovery", event_ref, {"event_id": event_ref, "event_type": "LateFeeAssessed",
            "source_transaction_or_receipt_ref": obligation["id"], "subscriber_delivery_state": {},
            "timer_or_period_key": fact["trigger_key"], "reconciliation_issue_refs": [], "correction_or_reversal_refs": []})
        self._document(c.state, c.branch, ref("fee-evidence", event_ref), c.principal, {"fee_fact": fact}, c.now)

    def _accrue_to(self, c: Context, debt: Object, end_time: int) -> None:
        intervals = [i for _, i in c.state.rows("debt_accrual_interval", c.branch) if i["debt_ref"] == debt["id"]]
        require(bool(intervals), "POLICY_MISSING")
        start = max(i["end_time"] for i in intervals)
        require(end_time >= start, "INVALID_TIME")
        if end_time == start:
            return
        elapsed = c.call("system11", "debt_elapsed", debt["id"])
        require(elapsed["start_time"] == start and elapsed["end_time"] == end_time, "OWNER_UNAVAILABLE")
        days = rational(elapsed["elapsed_days"])
        require(days >= 0, "INVALID_TIME")
        require(debt["accrual_basis"] == 365, "POLICY_MISSING")
        principal = debt["outstanding_principal_cents"]
        if debt["compounding_enabled"]:
            policy = c.policy(debt["payment_schedule_ref"], debt["terms_version"])
            require(policy.get("compounding_accepted") is True, "POLICY_MISSING")
            principal = money(principal + debt["posted_interest_outstanding_cents"])
        accrued = Fraction(principal) * rational(debt["annual_rate"]) * days / debt["accrual_basis"]
        debt["unposted_interest_fraction"] = ratio(rational(debt["unposted_interest_fraction"]) + accrued)
        interval_ref = ref("accrual", debt["id"], start, end_time)
        c.put("debt_accrual_interval", interval_ref, {"debt_ref": debt["id"], "start_time": start, "end_time": end_time,
            "principal_cents": debt["outstanding_principal_cents"], "rate": clone(debt["annual_rate"]),
            "statement_interval_key": elapsed["statement_interval_key"], "interest_posting_ref": None})

    def _cmd_AcceptLoan(self, c: Context) -> None:
        fact = c.call("institutions", "loan_offer", c.command["target_ref"])
        require(fact.get("accepted") is True and fact.get("disbursement_authorized") is True
                and fact.get("collateral_and_guarantor_authority_valid") is True, "ACCESS_DENIED")
        debt = clone(fact["debt_agreement"])
        require(debt["borrower_ref"] == c.principal and debt["accepted_offer_ref"] == c.command["target_ref"], "ACCESS_DENIED")
        require(c.state.find("debt_agreement", c.branch, debt["id"]) is None, "DUPLICATE_REQUEST")
        amount = money(debt["disbursed_principal_cents"], nonnegative=True)
        require(debt["outstanding_principal_cents"] == amount and debt["posted_interest_outstanding_cents"] == 0
                and rational(debt["unposted_interest_fraction"]) == 0 and rational(debt["annual_rate"]) >= 0, "INVALID_DEBT")
        self._transfer(c, fact["lender_account_ref"], fact["borrower_account_ref"], amount, None, source_authorized=True)
        c.put("debt_agreement", debt["id"], debt)
        c.put("debt_accrual_interval", ref("debt-origin", debt["id"]), {"debt_ref": debt["id"],
            "start_time": c.now, "end_time": c.now, "principal_cents": amount, "rate": debt["annual_rate"],
            "statement_interval_key": "ORIGIN", "interest_posting_ref": None})
        c.effect("institutions", "loan_receipt", debt["id"], {"transaction_ref": c.tx_ref, "debt_ref": debt["id"]})
        c.result = {"debt_ref": debt["id"], "principal_cents": amount}

    def _cmd_PostInterest(self, c: Context) -> None:
        debt = c.get("debt_agreement", c.command["target_ref"])
        statement = c.call("system11", "statement", c.command["causal_event_ref"])
        require(statement["debt_ref"] == debt["id"] and statement["end_time"] == c.now, "ACCESS_DENIED")
        for _, interval in c.state.rows("debt_accrual_interval", c.branch):
            if interval["debt_ref"] == debt["id"] and interval["statement_interval_key"] == statement["period_key"] and interval["interest_posting_ref"]:
                c.result = {"interest_posting_ref": interval["interest_posting_ref"]}
                return
        self._accrue_to(c, debt, c.now)
        amount = round_half_up(rational(debt["unposted_interest_fraction"]))
        require(amount >= 0, "INVALID_DEBT")
        debt["unposted_interest_fraction"] = ratio(rational(debt["unposted_interest_fraction"]) - amount)
        debt["posted_interest_outstanding_cents"] = money(debt["posted_interest_outstanding_cents"] + amount)
        interest_ref = ref("interest", debt["id"], statement["period_key"])
        c.put("debt_accrual_interval", interest_ref, {"debt_ref": debt["id"], "start_time": c.now, "end_time": c.now,
            "principal_cents": debt["outstanding_principal_cents"], "rate": debt["annual_rate"],
            "statement_interval_key": statement["period_key"], "interest_posting_ref": interest_ref})
        self._document(c.state, c.branch, interest_ref, c.principal, {"debt_ref": debt["id"], "posted_interest_cents": amount,
                        "period_key": statement["period_key"]}, c.now)
        c.event("InterestPosted", interest_ref, statement["period_key"])
        c.result = {"posted_interest_cents": amount, "interest_posting_ref": interest_ref}

    def _cmd_RepayDebt(self, c: Context) -> None:
        debt = c.get("debt_agreement", c.command["target_ref"])
        self._accrue_to(c, debt, c.now)
        amount = money(c.payload["cents"], nonnegative=True)
        require(0 < amount <= debt["outstanding_principal_cents"] + debt["posted_interest_outstanding_cents"], "INVALID_AMOUNT")
        policy = c.policy(debt["payment_schedule_ref"], debt["terms_version"])
        require(debt["allocation_order"] in [["INTEREST", "PRINCIPAL"], ["PRINCIPAL", "INTEREST"]], "POLICY_MISSING")
        self._check_mandate(c, c.payload["source"], amount, "RepayDebt", debt["id"])
        self._transfer(c, c.payload["source"], policy["lender_account_ref"], amount, c.payload["instrument"])
        left, principal_paid, interest_paid = amount, 0, 0
        for target in debt["allocation_order"]:
            field = "posted_interest_outstanding_cents" if target == "INTEREST" else "outstanding_principal_cents"
            paid = min(left, debt[field])
            debt[field] -= paid
            left -= paid
            if target == "INTEREST":
                interest_paid += paid
            else:
                principal_paid += paid
        for _, instrument in c.state.rows("account_product_and_instrument", c.branch):
            if instrument["overdraft_enabled"]:
                facility = c.policy(instrument["product_policy_ref"], instrument["accepted_terms_version"])
                if facility.get("facility_debt_ref") == debt["id"]:
                    instrument["facility_used_cents"] = max(0, instrument["facility_used_cents"] - principal_paid)
        c.put("settlement_allocation", ref("debt-payment", c.tx_ref), {"transaction_ref": c.tx_ref,
            "obligation_ref": debt["id"], "period_key": policy["period_key"], "principal_cents": principal_paid,
            "interest_cents": interest_paid, "fee_cents": 0, "credit_or_refund_cents": 0})
        c.result = {"principal_paid_cents": principal_paid, "interest_paid_cents": interest_paid,
                    "remaining_principal_cents": debt["outstanding_principal_cents"]}

    def _cmd_QuotePurchase(self, c: Context) -> None:
        p = c.payload
        merchant = c.get("merchant_and_offer", p["merchant"])
        require(merchant["offer_effective_time"] <= c.now, "STALE_QUOTE")
        price = c.policy(merchant["price_catalog_ref"])
        stock = c.call("inventory", "availability", p["merchant"], {"lines": p["lines"]})
        require(stock.get("visible") is True, "ACCESS_DENIED")
        quote_ref = ref("quote", c.request_ref)
        subtotal, line_refs, taxable_refs = 0, [], []
        for index, requested in enumerate(p["lines"]):
            item = requested["item_ref"]
            requested_quantity = quantity(requested["quantity"])
            require(requested_quantity > 0 and item in price["items"], "STOCK_UNAVAILABLE")
            offer = price["items"][item]
            require(item in stock["available_quantities"] and quantity(stock["available_quantities"][item]) >= requested_quantity, "STOCK_UNAVAILABLE")
            unit = money(offer["unit_price_cents"], nonnegative=True)
            if merchant["markup_rule_ref"]:
                markup = c.policy(merchant["markup_rule_ref"])
                rate = rational(markup["rate"])
                require(rate >= 0, "POLICY_MISSING")
                unit = money(unit + round_half_up(Fraction(unit) * rate))
            if merchant["supply_or_scarcity_event_ref"]:
                supply = c.call("inventory", "supply_event", merchant["supply_or_scarcity_event_ref"])
                require(supply.get("grounded") is True, "POLICY_MISSING")
                unit = money(round_half_up(Fraction(unit) * rational(price["scarcity_multiplier"])), nonnegative=True)
            if merchant["promotion_ref"]:
                promotion = c.policy(merchant["promotion_ref"])
                require(promotion["start_time"] <= c.now < promotion["end_time"], "POLICY_MISSING")
                discount = (round_half_up(Fraction(unit) * rational(promotion["discount_rate"]))
                            if "discount_rate" in promotion else money(promotion["discount_cents"], nonnegative=True))
                require(0 <= discount <= unit, "POLICY_MISSING")
                unit -= discount
            exact_total = unit * requested_quantity
            require(exact_total.denominator == 1 or price.get("quantity_rounding") == "HALF_UP", "POLICY_MISSING")
            total = money(exact_total.numerator) if exact_total.denominator == 1 else round_half_up(exact_total)
            line_ref = ref("quote-line", quote_ref, index)
            c.put("quote_line", line_ref, {"id": line_ref, "offer_or_item_ref": item, "quantity": clone(requested["quantity"]),
                "unit_price_cents": unit, "line_total_cents": total, "taxable": offer["taxable"],
                "eligible_charge_basis_refs": clone(offer["eligible_charge_basis_refs"]),
                "acceptable_substitute_refs": clone(requested.get("acceptable_substitute_refs", []))})
            subtotal = money(subtotal + total)
            line_refs.append(line_ref)
            if offer["taxable"]:
                taxable_refs.append(line_ref)
        require(bool(line_refs), "INVALID_AMOUNT")
        def charges(rules):
            result = []
            for rule in rules:
                selected = taxable_refs if rule["basis"] == "TAXABLE" else line_refs
                require(rule["basis"] in {"TAXABLE", "SUBTOTAL"}, "POLICY_MISSING")
                basis = sum(c.get("quote_line", line)["line_total_cents"] for line in selected)
                charge = round_half_up(Fraction(basis) * rational(rule["rate"])) if "rate" in rule else money(rule["amount_cents"], nonnegative=True)
                require(charge >= 0, "INVALID_AMOUNT")
                result.append({"rule_ref": rule["rule_ref"], "basis_cents": basis, "amount_cents": charge})
            return result
        tax_lines, service_lines = charges(price["tax_rules"]), charges(price["service_charge_rules"])
        tip = 0
        if p.get("tip_enabled") is True:
            basis = money(p.get("tip_basis_cents", subtotal), nonnegative=True)
            require(basis == subtotal or price.get("tip_basis_cents") == basis, "POLICY_MISSING")
            tip = min(round_half_up(Fraction(basis) * rational(p["tip_rate"])) if "tip_rate" in p else money(p["tip_cents"], nonnegative=True), money(p["tip_cap_cents"], nonnegative=True))
            require(tip >= 0, "INVALID_AMOUNT")
        if price.get("tip_tax_rule") is not None:
            rule = price["tip_tax_rule"]
            tax_lines.append({"rule_ref": rule["rule_ref"], "basis_cents": tip,
                              "amount_cents": round_half_up(Fraction(tip) * rational(rule["rate"]))})
        # Deposits require a real prior credit entitlement from the content owner.
        deposit = 0
        if p.get("deposit_ref"):
            applied = c.call("institutions", "purchase_deposit", p["deposit_ref"])
            require(applied.get("owner_ref") == c.principal and applied.get("merchant_ref") == p["merchant"], "ACCESS_DENIED")
            deposit = money(applied["remaining_cents"], nonnegative=True)
        final = money(subtotal + sum(t["amount_cents"] for t in tax_lines + service_lines) + tip - deposit, nonnegative=True)
        quote = {"id": quote_ref, "merchant_ref": p["merchant"], "line_refs": line_refs,
                 "policy_version": c.command["policy_version"], "price_revision": merchant["price_revision"],
                 "expiry_time_or_boundary": c.now + integer(price["quote_valid_seconds"]), "subtotal_cents": subtotal,
                 "tax_lines": tax_lines, "service_charge_lines": service_lines, "tip_cents": tip,
                 "deposit_applied_cents": deposit, "final_cents": final, "fulfillment_method": p["fulfillment"], "state": "QUOTED"}
        require(quote["expiry_time_or_boundary"] > c.now, "POLICY_MISSING")
        c.put("quote", quote_ref, quote)
        self._document(c.state, c.branch, ref("quote-terms", quote_ref), c.principal,
                       {"policy": price, "principal_ref": c.principal, "deposit_ref": p.get("deposit_ref")}, c.now)
        c.status, c.result = "QUOTED", {"quote": clone(quote)}

    def _cmd_AcceptQuote(self, c: Context) -> None:
        p = c.payload
        quote = c.get("quote", c.command["target_ref"])
        require(quote["state"] == "QUOTED" and c.now < quote["expiry_time_or_boundary"], "STALE_QUOTE")
        quoted_terms = c.get("notice_and_observation_channel", ref("quote-terms", quote["id"]))["content"]
        require(quoted_terms["principal_ref"] == c.principal, "ACCESS_DENIED")
        merchant, price = c.get("merchant_and_offer", quote["merchant_ref"]), quoted_terms["policy"]
        require(quote["final_cents"] <= money(p["max_total"], nonnegative=True), "CAP_EXCEEDED")
        items = [c.get("quote_line", line)["offer_or_item_ref"] for line in quote["line_refs"]]
        self._check_mandate(c, p["source"], quote["final_cents"], "AcceptQuote", quote["merchant_ref"], items)
        instrument = self._instrument(c, p["instrument"], p["source"])
        payment_policy = c.policy(instrument["product_policy_ref"], instrument["accepted_terms_version"])
        require(payment_policy["instrument_type"] in merchant["accepted_instrument_types"], "INSTRUMENT_UNAVAILABLE")
        if p.get("mandate_ref"):
            plan = c.get("routine_plan", c.get("routine_mandate", p["mandate_ref"])["plan_ref"])
            require(merchant["location_ref"] in plan["permitted_location_and_route_refs"], "NO_SPENDING_MANDATE")
            planned = next(a for a in plan["activities"] if a["operation"] == "AcceptQuote" and a["target_ref"] in {quote["id"], quote["merchant_ref"]})
            expected_total = planned["payload"].get("expected_total_cents")
            require(expected_total is not None or plan["repricing_allowed"] is True, "POLICY_MISSING")
            require(plan["repricing_allowed"] is True or quote["final_cents"] <= expected_total, "CHOICE_REQUIRED")
        access = c.call("system12", "commerce_access", quote["merchant_ref"])
        work = c.call("system13", "commerce_service", quote["merchant_ref"])
        require(access.get("accessible") is True and work.get("open") is True and work.get("staff_available") is True, "INSTRUMENT_UNAVAILABLE")
        if quote["fulfillment_method"] == "COUNTER":
            require(access.get("buyer_present") is True, "ACCESS_DENIED")
        stock = c.call("inventory", "purchase", quote["id"], {"lines": quote["line_refs"]})
        require(stock.get("capacity_available") is True, "CAPACITY_EXCEEDED")
        require(stock.get("stock_available") is True and stock.get("substitutions_approved") is True, "STOCK_UNAVAILABLE")
        for substitution in stock.get("substitutions", []):
            require(substitution["replacement_ref"] in p.get("approved_substitutions", []), "CHOICE_REQUIRED")
        reservations = []
        for line_ref in quote["line_refs"]:
            line = c.get("quote_line", line_ref)
            owner_line = stock["lines"][line["offer_or_item_ref"]]
            owner_reservation = owner_line["reservation_ref"]
            for existing_ref, existing in c.state.rows("stock_or_service_reservation", c.branch):
                if existing["owner_reservation_ref"] == owner_reservation and existing["request_key"] != c.command["request_key"]:
                    require(existing["state"] == "RELEASED", "STOCK_UNAVAILABLE")
            reservation_ref = ref("stock", c.request_ref, line_ref)
            record = {"id": reservation_ref, "request_key": c.command["request_key"], "sale_line_ref": line_ref,
                      "owner_reservation_ref": owner_reservation, "reserved_quantity_or_capacity": line["quantity"],
                      "fulfilled_quantity": 0, "expiry": quote["expiry_time_or_boundary"], "state": "PREPARED",
                      "source_revision": owner_line["revision"]}
            c.put("stock_or_service_reservation", reservation_ref, record)
            c.stock_reservations[reservation_ref] = clone(record)
            reservations.append(reservation_ref)
        amount = quote["final_cents"]
        if c.get("economic_account", p["source"])["kind"] == "CASH":
            tender = money(p.get("cash_tender_cents", amount), nonnegative=True)
            require(tender >= amount, "INVALID_AMOUNT")
            change = tender - amount
            require(self._balance(c.state, c.branch, merchant["merchant_cash_float_ref"]) >= change, "CHANGE_UNAVAILABLE")
            require(self._balance(c.state, c.branch, p["source"]) - self._holds(c.state, c.branch, p["source"], ref("hold", c.request_ref, p["source"])) >= tender,
                    "INSUFFICIENT_AVAILABLE_FUNDS")
        sale_ref = ref("sale", quote["id"])
        require(c.state.find("order_and_sale_receipt", c.branch, sale_ref) is None, "DUPLICATE_REQUEST")
        c.put("purchase_authorization", ref("purchase-authority", sale_ref), {"quote_ref": quote["id"], "principal_ref": c.principal,
            "instrument_ref": p["instrument"], "maximum_total_cents": p["max_total"], "authorized_goods_refs": items,
            "approved_substitutions": clone(p.get("approved_substitutions", [])), "fulfillment_method": quote["fulfillment_method"],
            "mandate_ref": p.get("mandate_ref")})
        # Customer payment is one capture, including tip. Tip custody/payable is
        # subsequently allocated by System 13, never a second customer debit.
        if amount:
            settlement_account = price.get("settlement_accounts", {}).get(payment_policy["instrument_type"], price.get("settlement_account_ref"))
            require(type(settlement_account) is str, "POLICY_MISSING")
            self._transfer(c, p["source"], settlement_account, amount, p["instrument"])
        if quote["deposit_applied_cents"]:
            c.effect("institutions", "apply_purchase_deposit", quoted_terms["deposit_ref"],
                     {"quote_ref": quote["id"], "amount_cents": quote["deposit_applied_cents"]})
        sale = {"id": sale_ref, "order_refs": [], "quote_ref": quote["id"], "transaction_refs": [c.tx_ref] if amount else [],
                "item_or_service_receipt_refs": [], "purchase_stage": "COMMIT", "preparation_state": "NOT_STARTED",
                "handoff_state": "PENDING", "consumption_receipt_refs": [], "payment_state": "SETTLED",
                "captured_cents": amount, "refunded_cents": 0, "unresolved_fulfillment_claim_ref": ref("fulfillment-claim", sale_ref)}
        c.put("order_and_sale_receipt", sale_ref, sale)
        quote["state"] = "ACCEPTED"
        updates = [patch("stock_or_service_reservation", r, {"state": "COMMITTED"}) for r in reservations]
        updates.append(patch("order_and_sale_receipt", sale_ref, append=["item_or_service_receipt_refs"]))
        c.effect("inventory", "purchase_transfer", quote["id"], {"sale_ref": sale_ref, "reservation_refs": reservations}, updates)
        if quote["tip_cents"]:
            tip_policy = c.call("system13", "tip_policy", quote["merchant_ref"])
            require(tip_policy.get("allocation_authorized") is True, "POLICY_MISSING")
            c.effect("system13", "tip_payable", sale_ref, {"sale_ref": sale_ref, "amount_cents": quote["tip_cents"],
                     "custody_account_ref": settlement_account, "allocation_policy_ref": tip_policy["policy_ref"]})
        c.time_effect(quote["id"])
        c.result = {"sale_ref": sale_ref, "paid_cents": amount, "fulfillment_state": "PENDING"}

    def _cmd_FulfillSale(self, c: Context) -> None:
        sale = c.get("order_and_sale_receipt", c.command["target_ref"])
        require(sale["payment_state"] == "SETTLED" and sale["refunded_cents"] == 0, "INVALID_STATE")
        if sale["handoff_state"] == "HANDED_OVER":
            c.result = {"sale_ref": sale["id"], "item_receipt_refs": clone(sale["item_or_service_receipt_refs"])}
            return
        require(bool(sale["item_or_service_receipt_refs"]), "OWNER_PENDING")
        handoff = c.call("inventory", "handoff", sale["id"])
        require(handoff.get("authorized") is True and handoff.get("recipient_present_or_policy_valid") is True, "ACCESS_DENIED")
        patches = [patch("order_and_sale_receipt", sale["id"], {"purchase_stage": "COMPLETE", "handoff_state": "HANDED_OVER",
                    "unresolved_fulfillment_claim_ref": None}, ["item_or_service_receipt_refs"])]
        quote = c.get("quote", sale["quote_ref"])
        for r, reservation in c.state.rows("stock_or_service_reservation", c.branch):
            if reservation["sale_line_ref"] in quote["line_refs"] and reservation["state"] == "COMMITTED":
                patches.append(patch("stock_or_service_reservation", r, {"fulfilled_quantity": reservation["reserved_quantity_or_capacity"], "state": "FULFILLED"}))
        c.effect("inventory", "handoff", sale["id"], {"handoff_receipt_ref": handoff["receipt_ref"]}, patches)
        c.event("SaleFulfilled", sale["id"])
        c.result = {"sale_ref": sale["id"]}

    def _cmd_RefundSale(self, c: Context) -> None:
        sale = c.get("order_and_sale_receipt", c.command["target_ref"])
        amount = money(c.payload["cents"], nonnegative=True)
        require(0 < amount <= sale["captured_cents"] - sale["refunded_cents"], "REFUND_EXCEEDS_CAPTURE")
        terms = c.call("institutions", "refund", sale["id"])
        require(terms.get("authorized") is True and terms.get("claimant_ref") == c.principal
                and terms.get("window_and_condition_valid") is True, "ACCESS_DENIED")
        require(terms["refund_cents"] == amount and terms["original_sale_ref"] == sale["id"], "INVALID_AMOUNT")
        for _, row in c.state.rows("request_and_coordinator", c.branch):
            doc = c.get("notice_and_observation_channel", row["source_context_ref"])["content"]
            linked = (doc["command"]["operation"] == "FulfillSale" and doc["command"]["target_ref"] == sale["id"])
            linked = linked or doc.get("result", {}).get("result", {}).get("sale_ref") == sale["id"]
            if row["coordinator_decision"] == "COMMIT" and linked:
                require(len(row["owner_acknowledgment_refs"]) == len(doc["effects"]), "OWNER_PENDING")
        if sale["handoff_state"] == "HANDED_OVER":
            returned = c.call("inventory", "return", sale["id"])
            require(returned.get("sold_item_identity_valid") is True and returned.get("claimant_has_custody") is True, "ACCESS_DENIED")
            return_event_ref = ref("item-return", returned["receipt_ref"])
            require(c.state.find("outbox_and_recovery", c.branch, return_event_ref) is None, "DUPLICATE_REQUEST")
            c.put("outbox_and_recovery", return_event_ref, {"event_id": return_event_ref, "event_type": "ItemReturned",
                "source_transaction_or_receipt_ref": returned["receipt_ref"], "subscriber_delivery_state": {},
                "timer_or_period_key": returned["receipt_ref"], "reconciliation_issue_refs": [], "correction_or_reversal_refs": []})
            c.effect("inventory", "return", sale["id"], {"sale_ref": sale["id"], "return_receipt_ref": returned["receipt_ref"]})
        else:
            require(terms.get("delivery_cancelled") is True, "OWNER_PENDING")
            c.effect("inventory", "cancel_fulfillment", sale["id"], {"sale_ref": sale["id"]})
        destination = terms["destination_account_ref"]
        if terms["refund_kind"] == "STORE_CREDIT":
            require(c.get("economic_account", destination)["kind"] == "STORE_CREDIT", "INVALID_CURRENCY")
        self._transfer(c, terms["merchant_account_ref"], destination, amount, None, source_authorized=True)
        sale["refunded_cents"] += amount
        if sale["refunded_cents"] == sale["captured_cents"]:
            sale["payment_state"], sale["handoff_state"] = "REFUNDED", "RETURNED_OR_CANCELLED"
            sale["unresolved_fulfillment_claim_ref"] = None
        c.event("RefundSettled", sale["id"], c.tx_ref)
        c.result = {"refunded_cents": amount, "remaining_refundable_cents": sale["captured_cents"] - sale["refunded_cents"]}

    def _cmd_CreateSplitBill(self, c: Context) -> None:
        accepted = c.call("relationships", "split_agreement", c.command["target_ref"])
        require(accepted.get("accepted") is True, "NO_SPENDING_MANDATE")
        tab = clone(accepted["restaurant_tab_and_split"])
        require(c.state.find("restaurant_tab_and_split", c.branch, tab["tab_ref"]) is None, "DUPLICATE_REQUEST")
        total = money(accepted["total_cents"], nonnegative=True)
        order = tab["remainder_assignment_order"]
        require(bool(order) and len(set(order)) == len(order), "INVALID_ALLOCATION")
        if tab["split_method"] == "AGREED_SHARES":
            shares = accepted["shares"]
            require(set(shares) == set(order), "INVALID_ALLOCATION")
            fractions = {payer: rational(value) for payer, value in shares.items()}
            require(all(v >= 0 for v in fractions.values()) and sum(fractions.values()) == 1, "INVALID_ALLOCATION")
            allocated = {payer: (total * fractions[payer]).numerator // (total * fractions[payer]).denominator for payer in order}
            remainder = total - sum(allocated.values())
            for payer in order[:remainder]:
                allocated[payer] += 1
        else:
            require(tab["split_method"] == "LINE_ALLOCATION", "POLICY_MISSING")
            allocated = accepted["line_allocation_cents"]
            require(set(allocated) == set(order) and all(money(v, nonnegative=True) >= 0 for v in allocated.values())
                    and sum(allocated.values()) == total, "INVALID_ALLOCATION")
        tab["payer_shares_cents"], tab["remaining_due_cents"] = allocated, total
        tab["payer_settlement_refs"] = []
        c.put("restaurant_tab_and_split", tab["tab_ref"], tab)
        c.result = {"tab_ref": tab["tab_ref"], "shares_cents": allocated}

    def _cmd_PaySplitBill(self, c: Context) -> None:
        tab = c.get("restaurant_tab_and_split", c.command["target_ref"])
        policy = c.policy(tab["partial_settlement_policy_ref"])
        require(policy["independent_partial_settlements"] is True, "CHOICE_REQUIRED")
        payer = c.payload.get("share_owner_ref", c.principal)
        require(payer in tab["payer_shares_cents"], "ACCESS_DENIED")
        payment_ref = ref("tab-share", tab["tab_ref"], payer)
        require(c.state.find("settlement_allocation", c.branch, payment_ref) is None, "ALREADY_SETTLED")
        amount = tab["payer_shares_cents"][payer]
        self._check_mandate(c, c.payload["source"], amount, "PaySplitBill", tab["tab_ref"])
        self._transfer(c, c.payload["source"], policy["merchant_account_ref"], amount, c.payload["instrument"])
        c.put("settlement_allocation", payment_ref, {"transaction_ref": c.tx_ref, "obligation_ref": tab["tab_ref"],
            "period_key": payer, "principal_cents": amount, "interest_cents": 0, "fee_cents": 0, "credit_or_refund_cents": 0})
        tab["payer_settlement_refs"].append(c.tx_ref)
        tab["remaining_due_cents"] -= amount
        if tab["remaining_due_cents"] == 0 and tab["tip_preference_enabled"]:
            c.effect("system13", "tab_tip_payable", tab["tab_ref"], {"tab_ref": tab["tab_ref"],
                     "tip_transfer_or_payable_ref": tab["tip_transfer_or_payable_ref"]})
        c.status = "PARTIAL" if tab["remaining_due_cents"] else "COMMITTED"
        c.result = {"paid_cents": amount, "remaining_due_cents": tab["remaining_due_cents"]}

    def _cmd_AcceptHousingOffer(self, c: Context) -> None:
        offer = c.get("housing_offer_and_terms", c.command["target_ref"])
        require(c.authority.get("explicit_action") is True, "NO_SPENDING_MANDATE")
        decision = c.call("institutions", "housing_acceptance", offer["offer_ref"])
        require(decision.get("accepted") is True and decision.get("screening_authorized") is True
                and decision.get("principal_ref") == c.principal, "ACCESS_DENIED")
        require(decision["terms_version"] == c.payload["terms_version"], "REVISION_CONFLICT")
        place = c.call("system12", "occupancy_capacity", offer["unit_ref"])
        require(place.get("available") is True and place.get("amenities_valid") is True, "OCCUPANCY_CONFLICT")
        agreement_ref = decision["agreement_ref"]
        require(c.state.find("occupancy_agreement", c.branch, agreement_ref) is None, "DUPLICATE_REQUEST")
        require(offer["term"]["start_time"] < offer["term"]["end_time"], "INVALID_TIME")
        c.put("occupancy_agreement", agreement_ref, {"id": agreement_ref, "unit_id": offer["unit_ref"],
            "parties_ref": offer["offer_ref"], "terms_version": decision["terms_version"],
            "start_time": offer["term"]["start_time"], "end_time": offer["term"]["end_time"],
            "status": "ACCEPTED", "revision": 0})
        for terms in decision["obligation_terms"]:
            require(c.state.find("obligation_terms", c.branch, terms["agreement_ref"]) is None, "REVISION_CONFLICT")
            c.put("obligation_terms", terms["agreement_ref"], clone(terms))
        deposit = money(offer["deposit_cents"], nonnegative=True)
        if decision["deposit_due_now"] and deposit:
            self._transfer(c, c.payload["source"], decision["deposit_holding_account_ref"], deposit, c.payload["instrument"])
            c.put("tenancy_deposit", agreement_ref, {"tenancy_ref": agreement_ref,
                "holding_account_or_escrow_ref": decision["deposit_holding_account_ref"], "held_liability_cents": deposit,
                "deduction_claim_refs": [], "accepted_or_adjudicated_deductions_cents": 0,
                "refund_transaction_refs": [], "remaining_held_cents": deposit})
            c.event("DepositHeld", agreement_ref)
        c.effect("system12", "reserve_occupancy", offer["unit_ref"], {"agreement_ref": agreement_ref,
                 "start_time": offer["term"]["start_time"], "end_time": offer["term"]["end_time"],
                 "authority_ref": decision["authority_ref"]})
        c.event("HousingAccepted", agreement_ref)
        c.result = {"agreement_ref": agreement_ref, "occupancy_start": offer["term"]["start_time"]}

    def _cmd_ChangeHousingAccess(self, c: Context) -> None:
        agreement = c.get("occupancy_agreement", c.command["target_ref"])
        c.revision(agreement)
        authority = c.call("institutions", "housing_access", agreement["id"])
        require(authority.get("authorized") is True and authority.get("notice_ref") is not None
                and authority["effective_time"] <= c.now, "ACCESS_DENIED")
        require(authority["unit_ref"] == agreement["unit_id"], "ACCESS_DENIED")
        state = authority["agreement_status"]
        require(state in {"ACTIVE", "ENDED"}, "INVALID_STATE")
        c.effect("system12", "housing_access", agreement["unit_id"], {
            "agreement_ref": agreement["id"], "authority_ref": authority["authority_ref"],
            "notice_ref": authority["notice_ref"], "effective_time": authority["effective_time"],
            "access_transition_ref": authority["access_transition_ref"]},
            [patch("occupancy_agreement", agreement["id"], {"status": state, "revision": agreement["revision"] + 1})])

    def _cmd_RecordRepairClaim(self, c: Context) -> None:
        fact = c.call("institutions", "repair_claim", c.command["target_ref"])
        claim = clone(fact["condition_evidence_and_repair_claim"])
        require(claim["claimant_ref"] == c.principal and claim["completed_repair_ack_ref"] is None, "ACCESS_DENIED")
        require(c.state.find("condition_evidence_and_repair_claim", c.branch, claim["id"]) is None, "DUPLICATE_REQUEST")
        c.put("condition_evidence_and_repair_claim", claim["id"], claim)
        c.effect("institutions", "repair_claim", claim["id"], {"claim_ref": claim["id"]})
        c.result = {"claim_ref": claim["id"], "dispute_state": claim["dispute_state"]}

    def _cmd_UpdateRepair(self, c: Context) -> None:
        claim = c.get("condition_evidence_and_repair_claim", c.command["target_ref"])
        fact = c.call("system13", "repair_progress", claim["id"])
        require(fact.get("authorized") is True, "ACCESS_DENIED")
        for field in ("owner_acknowledgment_ref", "scheduled_visit_ref", "entry_authority_ref"):
            if field in fact:
                claim[field] = fact[field]
        if fact.get("attempted_fix_receipt_ref"):
            if fact["attempted_fix_receipt_ref"] not in claim["attempted_fix_receipt_refs"]:
                claim["attempted_fix_receipt_refs"].append(fact["attempted_fix_receipt_ref"])
        if fact.get("accepted_output") is True:
            require(claim["entry_authority_ref"] is not None and fact.get("inspection_ref") is not None, "ACCESS_DENIED")
            if fact["inspection_ref"] not in claim["inspection_refs"]:
                claim["inspection_refs"].append(fact["inspection_ref"])
            c.effect("system12", "complete_repair", claim["room_fixture_or_service_ref"],
                     {"work_receipt_ref": fact["attempted_fix_receipt_ref"], "entry_authority_ref": claim["entry_authority_ref"],
                      "inspection_ref": fact["inspection_ref"]},
                     [patch("condition_evidence_and_repair_claim", claim["id"], {"completed_repair_ack_ref": "$OWNER_RECEIPT"})])
        c.result = {"claim_ref": claim["id"], "repair_confirmed": claim["completed_repair_ack_ref"] is not None}

    def _cmd_SettleDeposit(self, c: Context) -> None:
        deposit = c.get("tenancy_deposit", c.command["target_ref"])
        finding = c.call("institutions", "deposit_disposition", deposit["tenancy_ref"])
        require(finding.get("authority_valid") is True, "ACCESS_DENIED")
        if finding["outcome"] == "DISPUTED":
            for claim in finding["claim_refs"]:
                if claim not in deposit["deduction_claim_refs"]:
                    deposit["deduction_claim_refs"].append(claim)
            c.status, c.result = "PENDING", {"held_cents": deposit["remaining_held_cents"]}
            return
        deduction = money(finding["deduction_cents"], nonnegative=True)
        refund = money(finding["refund_cents"], nonnegative=True)
        require(deduction + refund <= deposit["remaining_held_cents"], "REFUND_EXCEEDS_CAPTURE")
        require(deduction + refund > 0, "ALREADY_SETTLED")
        if deduction:
            require(finding.get("deduction_accepted_or_adjudicated") is True and bool(finding["claim_refs"]), "ACCESS_DENIED")
            require(not any(claim in deposit["deduction_claim_refs"] and finding.get("previously_applied") is True for claim in finding["claim_refs"]), "DUPLICATE_REQUEST")
            require(finding.get("duplicate_charge_excluded") is True, "INVALID_ALLOCATION")
            self._transfer(c, deposit["holding_account_or_escrow_ref"], finding["claimant_account_ref"], deduction, None, source_authorized=True)
            deposit["accepted_or_adjudicated_deductions_cents"] += deduction
        if refund:
            self._transfer(c, deposit["holding_account_or_escrow_ref"], finding["tenant_account_ref"], refund, None, source_authorized=True)
            deposit["refund_transaction_refs"].append(c.tx_ref)
        deposit["remaining_held_cents"] -= deduction + refund
        for claim in finding["claim_refs"]:
            if claim not in deposit["deduction_claim_refs"]:
                deposit["deduction_claim_refs"].append(claim)
        c.effect("institutions", "deposit_receipt", deposit["tenancy_ref"], {"transaction_ref": c.tx_ref,
                 "refund_cents": refund, "deduction_cents": deduction, "finding_ref": finding["finding_ref"]})
        c.result = {"refund_cents": refund, "deduction_cents": deduction, "remaining_held_cents": deposit["remaining_held_cents"]}

    def _cmd_AmendAgreement(self, c: Context) -> None:
        fact = c.call("institutions", "agreement_amendment", c.command["target_ref"])
        require(fact.get("accepted_by_required_parties") is True and fact.get("effective_time", c.now + 1) <= c.now, "ACCESS_DENIED")
        allowed = {"obligation_terms", "occupancy_agreement", "debt_agreement", "gift_or_support_agreement", "household_membership_and_permissions"}
        table = fact["table"]
        require(table in allowed, "ACCESS_DENIED")
        record = c.get(table, c.command["target_ref"])
        c.revision(record)
        fields = {
            "obligation_terms": {"amount_calculation", "recurrence", "grace_rule", "partial_payment_rule", "allocation_order", "overpayment_rule", "late_fee_rules", "notice_policy_ref"},
            "occupancy_agreement": {"terms_version", "end_time"},
            "debt_agreement": {"terms_version", "annual_rate", "accrual_basis", "payment_schedule_ref", "allocation_order", "compounding_enabled", "fee_rule_refs"},
            "gift_or_support_agreement": {"cap_cents", "period_rule", "effective_end", "cancellation_and_notice_terms_ref"},
            "household_membership_and_permissions": {"contribution_terms_ref", "visitor_rule_ref", "common_space_permissions", "authorized_spender_refs", "authorized_consumer_refs", "resource_responsibilities"},
        }
        require(set(fact["changes"]) <= fields[table], "ACCESS_DENIED")
        if table == "debt_agreement":
            self._accrue_to(c, record, c.now)
        record.update(clone(fact["changes"]))
        if "revision" in record:
            record["revision"] += 1
        c.event("AgreementAmended", c.command["target_ref"], fact["amendment_ref"])
        self._document(c.state, c.branch, fact["amendment_ref"], c.principal, {"accepted_amendment": fact}, c.now)

    def _cmd_AcceptHouseholdAgreement(self, c: Context) -> None:
        fact = c.call("relationships", "household_agreement", c.command["target_ref"])
        require(fact.get("accepted_by_required_parties") is True, "ACCESS_DENIED")
        membership = clone(fact["household_membership_and_permissions"])
        require(membership["member_ref"] == c.principal, "ACCESS_DENIED")
        membership_ref = ref("membership", membership["household_ref"], membership["member_ref"])
        require(c.state.find("household_membership_and_permissions", c.branch, membership_ref) is None, "REVISION_CONFLICT")
        c.put("household_membership_and_permissions", membership_ref, membership)
        c.effect("relationships", "household_receipt", membership["household_ref"], {"membership_ref": membership_ref})
        c.result = {"membership_ref": membership_ref}

    def _cmd_SharedPurchase(self, c: Context) -> None:
        membership = c.get("household_membership_and_permissions", c.payload["membership_ref"])
        require(membership["member_ref"] == c.principal and c.principal in membership["authorized_spender_refs"]
                and c.payload["source"] == membership["shared_account_or_cash_box_ref"], "ACCESS_DENIED")
        require(c.payload.get("mandate_ref") is not None, "NO_SPENDING_MANDATE")
        self._cmd_AcceptQuote(c)

    def _cmd_ChangeService(self, c: Context) -> None:
        service = c.get("service_connection", c.command["target_ref"])
        event = c.call("institutions", "service_event", service["id"])
        require(event.get("authorized") is True and event["effective_time"] <= c.now, "ACCESS_DENIED")
        state = event["state"]
        require(state in {"ACTIVE", "IMPAIRED", "OUTAGE", "NOTICE_PENDING", "SUSPENDED", "RESTORED"}, "INVALID_STATE")
        if state == "SUSPENDED":
            require(event.get("notice_ref") is not None, "ACCESS_DENIED")
        if state == "RESTORED":
            require(event.get("restoration_event_ref") is not None, "ACCESS_DENIED")
        c.effect("system12", "service_state", service["connection_ref"], {"event_ref": event["event_ref"], "state": state},
                 [patch("service_connection", service["id"], {"state": state, "cause_event_ref": event["event_ref"], "effective_time": event["effective_time"]})])
        c.event("ServiceStateChanged", service["id"], event["event_ref"])

    def _cmd_ChangeSubscription(self, c: Context) -> None:
        service = c.get("service_connection", c.command["target_ref"])
        fact = c.call("institutions", "subscription_change", service["id"])
        require(fact.get("accepted") is True and fact.get("principal_ref") == c.principal, "ACCESS_DENIED")
        require(fact["action"] in {"ENROLL", "RENEW", "CANCEL"}, "INVALID_COMMAND")
        if fact["action"] == "CANCEL":
            service["renewal_authorization_ref"] = None
        else:
            require(fact.get("paid_transition_accepted") is True and fact.get("renewal_authorization_ref") is not None, "NO_SPENDING_MANDATE")
            service["renewal_authorization_ref"] = fact["renewal_authorization_ref"]
        c.effect("institutions", "subscription_change", service["id"], {"agreement_ref": service["agreement_ref"], "action": fact["action"]})

    def _cmd_ScheduleDelivery(self, c: Context) -> None:
        fact = c.call("travel", "delivery_offer", c.command["target_ref"])
        require(fact.get("accepted") is True and fact.get("sender_ref") == c.principal, "ACCESS_DENIED")
        delivery = clone(fact["delivery"])
        require(delivery["state"] == "SCHEDULED", "INVALID_STATE")
        require(c.state.find("delivery", c.branch, c.command["target_ref"]) is None, "DUPLICATE_REQUEST")
        c.put("delivery", c.command["target_ref"], delivery)
        c.effect("travel", "schedule_delivery", c.command["target_ref"], {"delivery_ref": c.command["target_ref"]})

    def _cmd_UpdateDelivery(self, c: Context) -> None:
        delivery = c.get("delivery", c.command["target_ref"])
        fact = c.call("travel", "delivery_event", c.command["target_ref"])
        require(fact.get("authorized") is True, "ACCESS_DENIED")
        require(fact["state"] in {"PICKED_UP", "IN_TRANSIT", "ATTEMPT_FAILED", "STORED", "RETURNED", "DELIVERED"}, "INVALID_STATE")
        c.effect("inventory", "delivery_movement", c.command["target_ref"], {"movement_receipt_ref": fact["movement_receipt_ref"]},
                 [patch("delivery", c.command["target_ref"], {"state": fact["state"]}, ["handoff_attempt_refs"])])

    def _cmd_AcceptGiftOrSupport(self, c: Context) -> None:
        fact = c.call("relationships", "gift_support", c.command["target_ref"])
        require(fact.get("accepted_by_required_parties") is True, "ACCESS_DENIED")
        agreement = clone(fact["gift_or_support_agreement"])
        require(agreement["acceptance_state"] == "ACCEPTED" and c.principal in {agreement["payer_ref"], agreement["beneficiary_ref"]}, "ACCESS_DENIED")
        require(c.state.find("gift_or_support_agreement", c.branch, c.command["target_ref"]) is None, "DUPLICATE_REQUEST")
        c.put("gift_or_support_agreement", c.command["target_ref"], agreement)
        c.effect("relationships", "gift_support_acceptance", c.command["target_ref"], {"agreement_ref": c.command["target_ref"]})

    def _cmd_SettleGiftOrSupport(self, c: Context) -> None:
        agreement = c.get("gift_or_support_agreement", c.command["target_ref"])
        require(agreement["acceptance_state"] == "ACCEPTED" and agreement["effective_start"] <= c.now < agreement["effective_end"], "NO_SPENDING_MANDATE")
        fact = c.call("relationships", "support_payment", c.command["target_ref"])
        require(fact.get("payer_authorized") is True and fact.get("recipient_acceptance_valid") is True, "ACCESS_DENIED")
        amount = money(fact["amount_cents"], nonnegative=True)
        require(amount <= agreement["cap_cents"], "CAP_EXCEEDED")
        payment_ref = ref("support-payment", c.command["target_ref"], fact["period_key"])
        require(c.state.find("settlement_allocation", c.branch, payment_ref) is None, "DUPLICATE_PERIOD")
        self._transfer(c, fact["payer_account_ref"], fact["beneficiary_account_ref"], amount, None, source_authorized=True)
        c.put("settlement_allocation", payment_ref, {"transaction_ref": c.tx_ref, "obligation_ref": c.command["target_ref"],
            "period_key": fact["period_key"], "principal_cents": amount, "interest_cents": 0, "fee_cents": 0, "credit_or_refund_cents": 0})
        c.effect("relationships", "support_receipt", c.command["target_ref"], {"transaction_ref": c.tx_ref})

    def _cmd_SellOwnedGoods(self, c: Context) -> None:
        fact = c.call("inventory", "sale_offer", c.command["target_ref"])
        require(fact.get("seller_ref") == c.principal and fact.get("owned_and_in_custody") is True
                and fact.get("buyer_authorized") is True and fact.get("offer_valid") is True, "ACCESS_DENIED")
        require(fact["transaction_kind"] == "SALE", "CHOICE_REQUIRED")
        self._transfer(c, fact["buyer_account_ref"], fact["seller_account_ref"], fact["amount_cents"], None, source_authorized=True)
        c.effect("inventory", "owned_goods_sale", c.command["target_ref"], {"offer_ref": c.command["target_ref"],
                 "transaction_ref": c.tx_ref, "reservation_ref": fact["reservation_ref"]})
        c.result = {"sale_proceeds_cents": fact["amount_cents"]}

    def _cmd_ApplyGroundedEconomicEvent(self, c: Context) -> None:
        require(c.authority.get("owner_event") is True, "ACCESS_DENIED")
        owner = c.payload["owner"]
        require(owner in {"crime", "institutions"}, "ACCESS_DENIED")
        event = c.call(owner, "economic_event", c.command["target_ref"])
        require(event.get("grounded") is True and event.get("authority_valid") is True, "ACCESS_DENIED")
        unique = ref("grounded-event", owner, event["event_ref"])
        require(c.state.find("outbox_and_recovery", c.branch, unique) is None, "DUPLICATE_REQUEST")
        if event["kind"] == "WALLET_THEFT":
            require(c.get("economic_account", event["source_account_ref"])["kind"] == "CASH", "CASH_NOT_PRESENT")
        self._transfer(c, event["source_account_ref"], event["destination_account_ref"], event["amount_cents"], None, source_authorized=True)
        c.put("outbox_and_recovery", unique, {"event_id": unique, "event_type": "GroundedEconomicEvent",
            "source_transaction_or_receipt_ref": c.tx_ref, "subscriber_delivery_state": {},
            "timer_or_period_key": event["event_ref"], "reconciliation_issue_refs": [], "correction_or_reversal_refs": []})
        self._document(c.state, c.branch, ref("provenance", unique), c.principal, {"provenance_ref": event["provenance_ref"]}, c.now)
        c.effect(owner, "economic_receipt", event["event_ref"], {"transaction_ref": c.tx_ref})

    def _cmd_MoveCash(self, c: Context) -> None:
        custody = c.get("cash_custody", c.command["target_ref"])
        c.revision(custody)
        require(custody["custodian_id"] == c.principal, "ACCESS_DENIED")
        movement = c.call("system12", "cash_movement", custody["id"])
        require(movement.get("authorized") is True and movement["source_ref"] == custody["container_or_person_location_ref"], "ACCESS_DENIED")
        c.effect("system12", "cash_movement", custody["id"], {"movement_ref": movement["movement_ref"]},
                 [patch("cash_custody", custody["id"], {"container_or_person_location_ref": movement["destination_ref"], "revision": custody["revision"] + 1})])

    def _cmd_ActivateRoutine(self, c: Context) -> None:
        require(c.authority.get("explicit_action") is True, "NO_SPENDING_MANDATE")
        fact = c.call("content", "routine_activation", c.command["target_ref"])
        plan, mandate = clone(fact["routine_plan"]), clone(fact["routine_mandate"])
        require(mandate["principal_id"] == c.principal and mandate["plan_ref"] == plan["id"], "ACCESS_DENIED")
        require(plan["activation_or_schedule_ref"] is not None and plan["stop_conditions"]
                and plan["permitted_location_and_route_refs"] and plan["activities"], "NO_SPENDING_MANDATE")
        require(mandate["expiry"] > c.now and plan["duration_or_time_window"]["end_time"] <= mandate["expiry"], "NO_SPENDING_MANDATE")
        require(money(mandate["per_action_cap"], nonnegative=True) <= money(mandate["period_cap"], nonnegative=True), "CAP_EXCEEDED")
        money(plan["total_budget_cents"], nonnegative=True)
        require(all(a["operation"] in ROUTINE_OPERATIONS for a in plan["activities"]), "NO_SPENDING_MANDATE")
        require(c.state.find("routine_mandate", c.branch, mandate["id"]) is None, "REVISION_CONFLICT")
        c.put("routine_plan", plan["id"], plan)
        c.put("routine_mandate", mandate["id"], mandate)
        c.put("routine_execution", mandate["id"], {"id": mandate["id"], "mandate_ref": mandate["id"], "state": "ACTIVE",
            "current_step": 0, "completed_step_receipt_refs": [], "pending_reservation_refs": [],
            "period_key": fact["period_key"], "period_spent_cents": 0, "total_spent_cents": 0,
            "actual_elapsed_time_receipt_refs": [], "pause_reason": None, "unresolved_choice_ref": None})
        c.result = {"mandate_ref": mandate["id"]}

    def _cmd_RunRoutine(self, c: Context) -> None:
        from .state import System14State
        execution = c.get("routine_execution", c.command["target_ref"])
        mandate = c.get("routine_mandate", execution["mandate_ref"])
        plan = c.get("routine_plan", mandate["plan_ref"])
        require(mandate["principal_id"] == c.principal and execution["state"] == "ACTIVE", "NO_SPENDING_MANDATE")
        require(mandate["expiry"] > c.now, "NO_SPENDING_MANDATE")
        step = execution["current_step"]
        require(step < len(plan["activities"]), "INVALID_STATE")
        boundary = c.call("system11", "routine_boundary", execution["id"])
        activity = plan["activities"][step]
        require(activity["operation"] in ROUTINE_OPERATIONS, "NO_SPENDING_MANDATE")
        before = c.state.export()
        old_command, old_payload = c.command, c.payload
        try:
            require(boundary.get("interruption_ref") is None and boundary.get("deadline_feasible") is True, "CHOICE_REQUIRED")
            require(boundary["location_ref"] in plan["permitted_location_and_route_refs"], "NO_SPENDING_MANDATE")
            c.command = {**old_command, "operation": activity["operation"], "target_ref": activity["target_ref"]}
            c.payload = {**clone(activity["payload"]), "mandate_ref": mandate["id"]}
            handler = getattr(self, "_cmd_" + activity["operation"])
            handler(c)
        except DomainError as failure:
            c.state = System14State.restore(before)
            c.effects, c.reservations, c.stock_reservations = [], {}, {}
            execution = c.get("routine_execution", mandate["id"])
            execution["state"], execution["pause_reason"] = "PAUSED", failure.code
            execution["unresolved_choice_ref"] = boundary.get("interruption_ref") or ref("routine-choice", c.request_ref)
            c.event("RoutinePaused", execution["id"], c.request_ref)
            c.status, c.result = "CHOICE_REQUIRED", {"routine_ref": execution["id"], "failure_code": failure.code,
                                                     "current_step": step}
            return
        finally:
            c.command, c.payload = old_command, old_payload
        execution = c.get("routine_execution", mandate["id"])
        execution["state"] = "RUNNING" if c.effects else "ACTIVE"
        new_state = "COMPLETE" if step + 1 == len(plan["activities"]) else "ACTIVE"
        completed = execution["completed_step_receipt_refs"] + [c.tx_ref if c.state.find("money_transaction", c.branch, c.tx_ref) else c.request_ref]
        values = {"state": new_state, "current_step": step + 1, "completed_step_receipt_refs": completed,
                  "pending_reservation_refs": [], "pause_reason": None, "unresolved_choice_ref": None}
        if c.effects:
            execution["pending_reservation_refs"] = list(c.reservations) + list(c.stock_reservations)
            for effect in c.effects:
                if effect["owner"] == "system11":
                    effect["patches"].append(patch("routine_execution", mandate["id"], append=["actual_elapsed_time_receipt_refs"]))
            c.effects[-1]["patches"].append(patch("routine_execution", mandate["id"], values))
        else:
            execution.update(values)
        c.result = {"routine_ref": execution["id"], "step_index": step, "activity_result": clone(c.result)}

    def _cmd_ResumeRoutine(self, c: Context) -> None:
        execution = c.get("routine_execution", c.command["target_ref"])
        mandate = c.get("routine_mandate", execution["mandate_ref"])
        require(mandate["principal_id"] == c.principal and mandate["expiry"] > c.now and execution["state"] == "PAUSED", "NO_SPENDING_MANDATE")
        require(c.authority.get("explicit_action") is True, "NO_SPENDING_MANDATE")
        execution["state"], execution["pause_reason"], execution["unresolved_choice_ref"] = "ACTIVE", None, None

    def _cmd_CancelRoutine(self, c: Context) -> None:
        execution = c.get("routine_execution", c.command["target_ref"])
        mandate = c.get("routine_mandate", execution["mandate_ref"])
        require(mandate["principal_id"] == c.principal and execution["state"] != "RUNNING", "OWNER_PENDING")
        for request_ref, coordinator in c.state.rows("request_and_coordinator", c.branch):
            document = c.get("notice_and_observation_channel", coordinator["source_context_ref"])["content"]
            command = document["command"]
            if coordinator["coordinator_decision"] == "UNDECIDED" and (command["payload"].get("mandate_ref") == mandate["id"]
                    or (command["operation"] == "RunRoutine" and command["target_ref"] == mandate["id"])):
                self._release_request(c, request_ref)
                coordinator["coordinator_decision"] = "ABORT"
                document["result"] = self._failure(command, "CANCELLED")
        execution["state"], execution["pending_reservation_refs"] = "CANCELLED", []
        mandate["revision"] += 1

    def _cmd_AdvanceBudgetPeriod(self, c: Context) -> None:
        execution = c.get("routine_execution", c.command["target_ref"])
        boundary = c.call("system11", "budget_period", execution["id"])
        require(boundary.get("effective_time", c.now + 1) <= c.now and boundary["previous_period_key"] == execution["period_key"], "ACCESS_DENIED")
        require(boundary["period_key"] != execution["period_key"] and not execution["pending_reservation_refs"], "OWNER_PENDING")
        execution["period_key"], execution["period_spent_cents"] = boundary["period_key"], 0
        c.event("BudgetPeriodAdvanced", execution["id"], boundary["period_key"])

    def _task(self, c: Context, kind: str) -> None:
        preferences = c.get("grocery_and_task_preferences", c.command["target_ref"])
        resources = c.call("inventory", "task_resources", preferences["task_definition_ref"])
        require(resources.get("authorized") is True and resources.get("resources_present") is True
                and resources.get("facilities_usable") is True, "RESOURCE_UNAVAILABLE")
        require(type(resources.get("payment_required")) is bool, "POLICY_MISSING")
        if resources["payment_required"]:
            sale = c.get("order_and_sale_receipt", resources["paid_sale_ref"])
            require(sale["payment_state"] == "SETTLED" and sale["refunded_cents"] == 0, "PAYMENT_REQUIRED")
        if kind == "LAUNDRY":
            require(resources.get("items_not_worn") is True and resources.get("machine_available") is True, "RESOURCE_UNAVAILABLE")
        if c.payload.get("mandate_ref"):
            plan = c.get("routine_plan", c.get("routine_mandate", c.payload["mandate_ref"])["plan_ref"])
            require(set(preferences["ingredient_or_clothing_lot_refs"]) <= set(plan["resource_refs"]), "NO_SPENDING_MANDATE")
        if resources.get("uncertainty_meaningful") is True:
            resolution = c.call("system10", "task_resolution", preferences["task_definition_ref"])
            require(resolution.get("succeeded") is True, "TASK_FAILED")
        preferences["reservation_refs"] = clone(resources["reservation_refs"])
        updates = [patch("grocery_and_task_preferences", c.command["target_ref"], append=["output_or_completion_receipt_refs"])]
        for owner_ref in resources["reservation_refs"]:
            reservation_ref = ref("task-reservation", owner_ref)
            existing = c.state.find("stock_or_service_reservation", c.branch, reservation_ref)
            require(existing is None or (existing["state"] == "PREPARED" and existing["request_key"] == c.command["request_key"])
                    or existing["state"] == "RELEASED", "RESOURCE_UNAVAILABLE")
            reservation = {"id": reservation_ref, "request_key": c.command["request_key"],
                "sale_line_ref": preferences["task_definition_ref"], "owner_reservation_ref": owner_ref,
                "reserved_quantity_or_capacity": 1, "fulfilled_quantity": 0, "expiry": resources["reservation_expiry"],
                "state": "PREPARED", "source_revision": resources["source_revision"]}
            require(reservation["expiry"] > c.now, "RESOURCE_UNAVAILABLE")
            c.put("stock_or_service_reservation", reservation_ref, reservation)
            c.stock_reservations[reservation_ref] = clone(reservation)
            updates.append(patch("stock_or_service_reservation", reservation_ref, {"state": "FULFILLED", "fulfilled_quantity": 1}))
        c.effect("inventory", kind.lower(), preferences["task_definition_ref"], {
            "task_ref": preferences["task_definition_ref"], "reservation_refs": resources["reservation_refs"],
            "input_refs": preferences["ingredient_or_clothing_lot_refs"], "output_receipt_ref": resources["output_receipt_ref"]},
            updates)
        c.time_effect(preferences["task_definition_ref"])
        c.result = {"task_ref": preferences["task_definition_ref"], "kind": kind}

    def _cmd_Cook(self, c: Context) -> None:
        self._task(c, "COOK")

    def _cmd_StartLaundry(self, c: Context) -> None:
        self._task(c, "LAUNDRY")

    def _cmd_CompleteChore(self, c: Context) -> None:
        self._task(c, "CHORE")

    def _cmd_CollectLaundry(self, c: Context) -> None:
        preferences = c.get("grocery_and_task_preferences", c.command["target_ref"])
        collection = c.call("inventory", "laundry_collection", preferences["task_definition_ref"])
        require(collection.get("owner_present") is True and collection.get("service_complete") is True, "RESOURCE_UNAVAILABLE")
        c.effect("inventory", "collect_laundry", preferences["task_definition_ref"], {"collection_ref": collection["receipt_ref"]},
                 [patch("grocery_and_task_preferences", c.command["target_ref"], {"collection_receipt_ref": "$OWNER_RECEIPT"})])
        c.time_effect(preferences["task_definition_ref"])

    def _cmd_ConsumePortion(self, c: Context) -> None:
        portion = c.call("inventory", "consumption", c.command["target_ref"])
        require(portion.get("consumer_ref") == c.principal and portion.get("authorized") is True
                and portion.get("present") is True and portion.get("usable") is True, "ACCESS_DENIED")
        event_ref = ref("consumption", portion["consumption_ref"])
        require(c.state.find("outbox_and_recovery", c.branch, event_ref) is None, "ALREADY_CONSUMED")
        sale_ref = portion.get("sale_ref")
        if sale_ref:
            sale = c.get("order_and_sale_receipt", sale_ref)
            require(sale["handoff_state"] == "HANDED_OVER", "RESOURCE_UNAVAILABLE")
        updates = [patch("order_and_sale_receipt", sale_ref, append=["consumption_receipt_refs"])] if sale_ref else []
        c.effect("inventory", "consume", portion["consumption_ref"], {"portion_ref": c.command["target_ref"],
                 "consumer_ref": c.principal, "consumption_ref": portion["consumption_ref"]}, updates)
        # Health receives the same committed owner receipt identity. It owns all
        # physiology, including substance effects when ordinary needs are OFF.
        c.effect("health", "consumption", portion["consumption_ref"], {"consumption_receipt_ref": portion["receipt_ref"],
                 "consumer_ref": c.principal})
        c.put("outbox_and_recovery", event_ref, {"event_id": event_ref, "event_type": "PortionConsumed",
            "source_transaction_or_receipt_ref": portion["receipt_ref"], "subscriber_delivery_state": {},
            "timer_or_period_key": portion["consumption_ref"], "reconciliation_issue_refs": [], "correction_or_reversal_refs": []})
        c.time_effect(portion["consumption_ref"])

    def _cmd_Rest(self, c: Context) -> None:
        place = c.call("system12", "rest_access", c.command["target_ref"])
        require(place.get("feasible") is True and place.get("authorized") is True, "ACCESS_DENIED")
        rest = c.call("system11", "rest_interval", c.command["request_id"])
        require(rest.get("actual_elapsed_seconds", -1) >= 0 and rest.get("end_time", -1) >= rest.get("start_time", 0), "OWNER_UNAVAILABLE")
        c.effect("system11", "rest", c.command["request_id"], {"rest_interval_ref": rest["receipt_ref"]})
        c.effect("health", "rest", rest["receipt_ref"], {"actual_elapsed_seconds": rest["actual_elapsed_seconds"],
                 "rest_receipt_ref": rest["receipt_ref"], "interruption_ref": rest.get("interruption_ref")})
        c.result = {"actual_elapsed_seconds": rest["actual_elapsed_seconds"], "interruption_ref": rest.get("interruption_ref")}

    def _cmd_SetNeedsProfile(self, c: Context) -> None:
        settings = c.get("needs_and_optional_detail_settings", c.principal)
        profile = c.payload["needs_profile"]
        require(profile in {"OFF", "LIGHT", "DETAILED"} and c.authority.get("explicit_action") is True, "ACCESS_DENIED")
        settings["needs_profile"], settings["profile_effective_time"] = profile, c.now
        c.effect("health", "needs_profile", c.principal, {"profile": profile, "effective_time": c.now,
                 "threshold_policy_ref": settings["health_threshold_policy_ref"]})
        c.event("NeedsProfileChanged", c.principal, c.request_ref)

    def _cmd_SetOptionalDetails(self, c: Context) -> None:
        settings = c.get("needs_and_optional_detail_settings", c.principal)
        allowed = {"spoilage_enabled", "denomination_detail_enabled", "per_garment_detail_enabled", "metered_utilities_enabled", "currency_exchange_enabled"}
        require(set(c.payload) <= allowed and all(type(v) is bool for v in c.payload.values()), "INVALID_COMMAND")
        require(c.authority.get("explicit_action") is True, "ACCESS_DENIED")
        settings.update(clone(c.payload))
        c.event("OptionalDetailsChanged", c.principal, c.request_ref)

    def _cmd_ProcessSpoilage(self, c: Context) -> None:
        settings = c.get("needs_and_optional_detail_settings", c.principal)
        if not settings["spoilage_enabled"]:
            c.result = {"spoilage_applied": False}
            return
        require(settings["preservation_policy_ref"] is not None, "POLICY_MISSING")
        exposure = c.call("inventory", "preservation_event", c.command["target_ref"])
        require(exposure.get("threshold_met") is True and exposure.get("policy_ref") == settings["preservation_policy_ref"], "POLICY_MISSING")
        c.effect("inventory", "spoilage", exposure["event_ref"], {"lot_ref": c.command["target_ref"], "exposure_receipt_ref": exposure["receipt_ref"]})

    def _cmd_DeliverNotice(self, c: Context) -> None:
        fact = c.call("knowledge", "notice", c.command["target_ref"])
        notice = clone(fact["notice_and_observation_channel"])
        require(notice["channel_ref"] != "SYSTEM14_INTERNAL" and fact.get("sender_authorized") is True, "ACCESS_DENIED")
        require(notice["observed_time"] is None or fact.get("observed") is True, "ACCESS_DENIED")
        previous = c.state.find("notice_and_observation_channel", c.branch, notice["id"])
        require(previous is None or previous["record_or_event_ref"] == notice["record_or_event_ref"], "REVISION_CONFLICT")
        c.put("notice_and_observation_channel", notice["id"], notice)
        c.effect("knowledge", "notice", notice["id"], {"notice_ref": notice["id"]})

    def _cmd_FastForward(self, c: Context) -> None:
        boundary = c.call("system11", "fast_forward", c.command["request_id"])
        require(boundary.get("explicit_clock_policy") is True, "NO_SPENDING_MANDATE")
        require(boundary["end_time"] >= c.now, "INVALID_TIME")
        # The clock's returned due events become separate idempotent commands;
        # fast-forward never enrolls autopay or infers routine authority.
        c.effect("system11", "fast_forward", c.command["request_id"], {"clock_receipt_ref": boundary["receipt_ref"],
                 "end_time": boundary["end_time"], "interruption_ref": boundary.get("interruption_ref")})
        c.result = {"end_time": boundary["end_time"], "interruption_ref": boundary.get("interruption_ref"),
                    "due_event_refs": clone(boundary["due_event_refs"])}

    def _cmd_ForkBranch(self, c: Context) -> None:
        require(c.authority.get("development_mode") is True, "ACCESS_DENIED")
        destination = c.payload["destination_branch_id"]
        require(type(destination) is str and destination and destination != c.branch, "INVALID_REFERENCE")
        from .state import FIELDS
        require(not any(list(c.state.rows(table, destination)) for table in FIELDS), "REVISION_CONFLICT")
        # Forks require a quiescent coordinator boundary; opaque participant
        # reservations must never be reused against another branch.
        for _, coordinator in c.state.rows("request_and_coordinator", c.branch):
            document = c.get("notice_and_observation_channel", coordinator["source_context_ref"])["content"]
            require(coordinator["coordinator_decision"] != "UNDECIDED" and
                    len(coordinator["owner_acknowledgment_refs"]) == len(document["effects"]), "OWNER_PENDING")
        require(not any(h["state"] == "ACTIVE" for _, h in c.state.rows("funds_hold", c.branch)), "OWNER_PENDING")
        for table in FIELDS:
            for record_ref, record in list(c.state.rows(table, c.branch)):
                copied = clone(record)
                if "branch_id" in copied:
                    copied["branch_id"] = destination
                if table == "routine_execution":
                    copied["state"] = "PAUSED"
                    copied["pause_reason"] = "BRANCH_ACTIVATION_REQUIRED"
                if table == "routine_plan":
                    copied["activation_or_schedule_ref"] = None
                if table == "request_and_coordinator":
                    # Historical request IDs do not authorize commands on the new
                    # branch. History stays inspectable but cannot be re-executed.
                    copied["cancellable_scope"] = "NONE"
                c.state.put(table, destination, record_ref, copied)
        c.result = {"branch_id": destination}

    def _cmd_PublishEvents(self, c: Context) -> None:
        require(c.authority.get("owner_event") is True, "ACCESS_DENIED")
        subscription = c.call("content", "subscriptions", c.command["target_ref"])
        blocked_events = set()
        for _, coordinator in c.state.rows("request_and_coordinator", c.branch):
            document = c.get("notice_and_observation_channel", coordinator["source_context_ref"])["content"]
            if coordinator["coordinator_decision"] != "COMMIT" or len(coordinator["owner_acknowledgment_refs"]) != len(document["effects"]):
                blocked_events.update(document.get("event_refs", []))
        for event_ref, event in c.state.rows("outbox_and_recovery", c.branch):
            if event_ref in blocked_events:
                continue
            for subscriber in subscription["subscribers"]:
                if event["event_type"] not in subscriber["event_types"] or event["subscriber_delivery_state"].get(subscriber["owner"]) == "ACKNOWLEDGED":
                    continue
                # Only event identities leave this boundary. Record contents need
                # a separately authorized knowledge projection.
                update = patch("outbox_and_recovery", event_ref)
                update["merge"] = {"subscriber_delivery_state": {subscriber["owner"]: "ACKNOWLEDGED"}}
                c.effect(subscriber["owner"], "event", event_ref, {"event_id": event_ref, "event_type": event["event_type"]}, [update])

    def _cmd_ExchangeCurrency(self, c: Context) -> None:
        settings = c.get("needs_and_optional_detail_settings", c.principal)
        require(settings["currency_exchange_enabled"], "INVALID_CURRENCY")
        quote = c.call("institutions", "exchange_quote", c.command["target_ref"])
        require(quote.get("accepted") is True and quote.get("clearing_authorized") is True and quote["expiry_time"] > c.now, "STALE_QUOTE")
        source, destination = c.payload["source"], c.payload["destination"]
        amount = money(c.payload["cents"], nonnegative=True)
        require(quote["source_cents"] == amount and c.get("economic_account", source)["currency"] == quote["source_currency"]
                and c.get("economic_account", destination)["currency"] == quote["destination_currency"], "INVALID_CURRENCY")
        converted = round_half_up(Fraction(amount) * rational(quote["rate"]))
        require(converted == quote["destination_cents"] and converted > 0, "INVALID_AMOUNT")
        self._check_mandate(c, source, amount, "ExchangeCurrency", destination)
        self._transfer(c, source, quote["source_clearing_account_ref"], amount, c.payload["instrument"])
        self._transfer(c, quote["destination_clearing_account_ref"], destination, converted, None, source_authorized=True)
        c.effect("institutions", "exchange", c.command["target_ref"], {"transaction_ref": c.tx_ref})
        c.result = {"source_cents": amount, "destination_cents": converted}

    def _cmd_PayWholeSplitBill(self, c: Context) -> None:
        tab = c.get("restaurant_tab_and_split", c.command["target_ref"])
        policy = c.policy(tab["partial_settlement_policy_ref"])
        require(tab["remaining_due_cents"] > 0, "ALREADY_SETTLED")
        remaining = []
        for payer in tab["remainder_assignment_order"]:
            payment_ref = ref("tab-share", tab["tab_ref"], payer)
            if c.state.find("settlement_allocation", c.branch, payment_ref) is None:
                remaining.append((payer, payment_ref))
        for payer, payment_ref in remaining:
            authorization = c.call("ui", "split_authorization", payment_ref)
            amount = tab["payer_shares_cents"][payer]
            require(authorization.get("accepted") is True and authorization.get("payer_ref") == payer
                    and authorization["tab_ref"] == tab["tab_ref"] and authorization["amount_cents"] == amount, "ACCESS_DENIED")
            original_principal = c.principal
            try:
                c.principal = payer
                self._instrument(c, authorization["instrument_ref"], authorization["account_ref"])
            finally:
                c.principal = original_principal
            self._transfer(c, authorization["account_ref"], policy["merchant_account_ref"], amount, None, source_authorized=True)
            c.put("settlement_allocation", payment_ref, {"transaction_ref": c.tx_ref, "obligation_ref": tab["tab_ref"],
                "period_key": payer, "principal_cents": amount, "interest_cents": 0, "fee_cents": 0, "credit_or_refund_cents": 0})
            tab["remaining_due_cents"] -= amount
        require(tab["remaining_due_cents"] == 0, "INVALID_ALLOCATION")
        tab["payer_settlement_refs"].append(c.tx_ref)
        if tab["tip_preference_enabled"]:
            c.effect("system13", "tab_tip_payable", tab["tab_ref"], {"tab_ref": tab["tab_ref"], "tip_transfer_or_payable_ref": tab["tip_transfer_or_payable_ref"]})
        c.result = {"remaining_due_cents": 0, "paid_cents": sum(tab["payer_shares_cents"][payer] for payer, _ in remaining)}

    def _cmd_UpdateMerchantOffer(self, c: Context) -> None:
        require(c.authority.get("development_mode") is True, "ACCESS_DENIED")
        merchant = c.get("merchant_and_offer", c.command["target_ref"])
        require(merchant["price_revision"] == c.command["expected_revision"], "REVISION_CONFLICT")
        update = c.call("content", "merchant_update", c.command["target_ref"])
        allowed = {"price_catalog_ref", "price_revision", "offer_effective_time", "baseline_price_cents", "markup_rule_ref", "promotion_ref", "supply_or_scarcity_event_ref"}
        require(set(update["changes"]) <= allowed and update["changes"]["price_revision"] == merchant["price_revision"] + 1, "REVISION_CONFLICT")
        merchant.update(clone(update["changes"]))
        c.event("MerchantOfferUpdated", merchant["merchant_ref"], str(merchant["price_revision"]))


ROUTINE_OPERATIONS = frozenset({"AcceptQuote", "PayObligation", "TransferFunds", "SharedPurchase", "Cook", "StartLaundry",
                               "CollectLaundry", "CompleteChore", "ConsumePortion", "Rest", "FulfillSale"})

OPERATIONS = frozenset({
    "TransferFunds", "GrantStartingResources", "InstallRecords", "PlaceHold", "CaptureHold", "ReleaseHold", "ExpireHold",
    "CancelPending", "ViewRecord", "OpenAccount", "BankTransfer", "ClearBankOperation", "CancelBankOperation", "SettleIncome",
    "IssueObligation", "MarkObligationOverdue", "PayObligation", "DisputeObligation", "AdjustObligation", "AssessLateFee",
    "AcceptLoan", "PostInterest", "RepayDebt", "QuotePurchase", "AcceptQuote", "FulfillSale", "RefundSale", "CreateSplitBill", "PaySplitBill",
    "AcceptHousingOffer", "ChangeHousingAccess", "RecordRepairClaim", "UpdateRepair", "SettleDeposit", "AmendAgreement",
    "AcceptHouseholdAgreement", "SharedPurchase", "ChangeService", "ChangeSubscription", "ScheduleDelivery", "UpdateDelivery",
    "AcceptGiftOrSupport", "SettleGiftOrSupport", "SellOwnedGoods", "ApplyGroundedEconomicEvent", "MoveCash", "ActivateRoutine",
    "RunRoutine", "ResumeRoutine", "CancelRoutine", "AdvanceBudgetPeriod", "Cook", "StartLaundry", "CompleteChore", "CollectLaundry",
    "ConsumePortion", "Rest", "SetNeedsProfile", "SetOptionalDetails", "ProcessSpoilage", "DeliverNotice", "FastForward", "ForkBranch", "PublishEvents",
    "GetBalances", "ExchangeCurrency", "PayWholeSplitBill", "UpdateMerchantOffer",
})
