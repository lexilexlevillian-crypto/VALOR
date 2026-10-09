"""Canonical state, exact arithmetic, and JSON validation; Python 3.11+.

Tables are maps keyed by JSON-encoded [branch_id, record_reference]. These keys
provide identity for companion records whose specified fields contain no id.
Only the seven specified groups and their specified record fields are persisted.
Nested policy/claim/content objects are the architecture's structured JSON slots.
Timestamps are integer simulation seconds, supplied exclusively by System 11.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from fractions import Fraction
from typing import Any, TypeAlias

JSON: TypeAlias = None | bool | int | str | list["JSON"] | dict[str, "JSON"]
Object: TypeAlias = dict[str, JSON]
MIN_MONEY, MAX_MONEY = -(2**63), 2**63 - 1


class DomainError(Exception):
    """A deliberately non-disclosing, stable machine-readable failure."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def require(condition: bool, code: str) -> None:
    if not condition:
        raise DomainError(code)


def integer(value: Any, code: str = "INVALID_AMOUNT") -> int:
    require(type(value) is int, code)
    return value


def money(value: Any, *, nonnegative: bool = False) -> int:
    value = integer(value)
    require(MIN_MONEY <= value <= MAX_MONEY, "INTEGER_OVERFLOW")
    require(not nonnegative or value >= 0, "INVALID_AMOUNT")
    return value


def rational(value: Any) -> Fraction:
    require(isinstance(value, dict) and set(value) == {"numerator", "denominator"}, "INVALID_RATIONAL")
    n = integer(value["numerator"], "INVALID_RATIONAL")
    d = integer(value["denominator"], "INVALID_RATIONAL")
    require(d > 0, "INVALID_RATIONAL")
    return Fraction(n, d)


def ratio(value: Fraction) -> Object:
    return {"numerator": value.numerator, "denominator": value.denominator}


def quantity(value: Any) -> Fraction:
    result = Fraction(value) if type(value) is int else rational(value)
    require(result >= 0, "INVALID_QUANTITY")
    return result


def round_half_up(value: Fraction) -> int:
    """Nearest integer, exact ties away from zero; no binary floating point."""
    sign = -1 if value < 0 else 1
    value = abs(value)
    return money(sign * ((2 * value.numerator + value.denominator) // (2 * value.denominator)))


def validate_json(value: Any) -> None:
    if value is None or type(value) in (bool, int, str):
        return
    if type(value) is list:
        for item in value:
            validate_json(item)
        return
    if type(value) is dict and all(type(key) is str for key in value):
        for item in value.values():
            validate_json(item)
        return
    raise DomainError("INVALID_JSON")


def canonical(value: Any) -> str:
    validate_json(value)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def clone(value: Any) -> Any:
    return json.loads(canonical(value))


def key(branch: str, ref: str) -> str:
    require(type(branch) is str and bool(branch) and type(ref) is str and bool(ref), "INVALID_REFERENCE")
    return canonical([branch, ref])


# These lists are an allowlist, not extensible bags of game state.
SCHEMA = {
    "core_records": {
        "economic_account": "id branch_id owner_id custodian_id currency kind product_policy_id revision",
        "money_transaction": "id branch_id request_key principal_id source_event_id sim_time policy_version status",
        "money_posting": "transaction_id account_id currency amount_cents",
        "funds_hold": "id account_id request_key amount_cents expiry_time captured_cents state revision",
        "obligation": "id agreement_id debtor_id creditor_id period_key issued_cents settled_cents due_time state dispute_id revision",
        "occupancy_agreement": "id unit_id parties_ref terms_version start_time end_time status revision",
        "routine_mandate": "id principal_id plan_ref payment_source_id per_action_cap period_cap expiry revision",
    },
    "money_and_banking": {
        "cash_custody": "id cash_account_id value_cents custodian_id container_or_person_location_ref denomination_counts revision",
        "account_product_and_instrument": "product_policy_ref accepted_terms_version instrument_id account_id authorized_principals service_channel_refs access_and_eligibility_policy_ref availability_policy_ref hold_policy_ref withdrawal_limit_policy_ref overdraft_enabled approved_facility_limit_cents facility_used_cents fee_policy_refs freeze_authority_refs",
        "fee_rule": "amount_or_calculation trigger basis frequency_cap notice_requirements policy_version",
        "pending_banking_operation": "id request_key operation_kind source_ref destination_ref instrument_ref amount_cents hold_ref availability_policy_ref clearing_event_ref irrevocable_settlement_point state receipt_ref",
        "income_settlement": "source_entitlement_ref source_period_key payer_ref beneficiary_ref approved_gross_cents authorized_adjustments_ref approved_net_owed_cents payment_method provenance_ref settlement_state transaction_ref failure_code",
        "derived_balances": "posted_balance_cents active_holds_cents available_owned_funds_cents unused_approved_facility_cents pending_inflows_cents outstanding_debt_cents",
    },
    "agreements_obligations_and_debt": {
        "obligation_terms": "agreement_ref currency charge_type amount_calculation service_period recurrence local_civil_time_rule holiday_and_business_day_rule shorter_month_rule grace_rule partial_payment_rule allocation_order overpayment_rule late_fee_rules dispute_and_collection_policy_ref notice_policy_ref",
        "settlement_allocation": "transaction_ref obligation_ref period_key principal_cents interest_cents fee_cents credit_or_refund_cents",
        "autopay_authorization": "payer_account_ref eligible_obligation_classes amount_cap_cents period_budget_cents period_key period_spent_cents expiry insufficient_funds_behavior",
        "debt_agreement": "id lender_ref borrower_ref accepted_offer_ref terms_version disbursed_principal_cents outstanding_principal_cents annual_rate accrual_basis unposted_interest_fraction posted_interest_outstanding_cents payment_schedule_ref allocation_order compounding_enabled fee_rule_refs collateral_refs guarantor_refs notice_refs authority_ref",
        "debt_accrual_interval": "debt_ref start_time end_time principal_cents rate statement_interval_key interest_posting_ref",
        "gift_or_support_agreement": "payer_ref beneficiary_ref resource_refs acceptance_state recipient_policy_ref cap_cents period_rule effective_start effective_end cancellation_and_notice_terms_ref provenance_ref",
    },
    "commerce": {
        "merchant_and_offer": "merchant_ref authority_ref location_ref hours_ref staff_role_refs service_channels stock_owner_ref stock_refs service_capacity_ref accepted_instrument_types price_catalog_ref price_revision offer_effective_time baseline_price_cents markup_rule_ref supply_or_scarcity_event_ref promotion_ref negotiation_authority_ref return_policy_ref merchant_cash_float_ref",
        "quote": "id merchant_ref line_refs policy_version price_revision expiry_time_or_boundary subtotal_cents tax_lines service_charge_lines tip_cents deposit_applied_cents final_cents fulfillment_method state",
        "quote_line": "id offer_or_item_ref quantity unit_price_cents line_total_cents taxable eligible_charge_basis_refs acceptable_substitute_refs",
        "purchase_authorization": "quote_ref principal_ref instrument_ref maximum_total_cents authorized_goods_refs approved_substitutions fulfillment_method mandate_ref",
        "stock_or_service_reservation": "id request_key sale_line_ref owner_reservation_ref reserved_quantity_or_capacity fulfilled_quantity expiry state source_revision",
        "order_and_sale_receipt": "id order_refs quote_ref transaction_refs item_or_service_receipt_refs purchase_stage preparation_state handoff_state consumption_receipt_refs payment_state captured_cents refunded_cents unresolved_fulfillment_claim_ref",
        "restaurant_tab_and_split": "tab_ref accepted_terms_ref order_receipt_refs tip_preference_enabled tip_amount_or_rate tip_eligible_basis tip_cap_cents tip_transfer_or_payable_ref tip_allocation_owner_ref split_method payer_shares_cents remainder_assignment_order payer_authorization_refs payer_settlement_refs remaining_due_cents partial_settlement_policy_ref",
        "delivery": "sender_ref service_obligation_or_receipt_ref reserved_goods_refs pickup_location_ref courier_authority_ref route_ref promised_window destination_ref recipient_rule_ref handoff_attempt_refs state",
    },
    "housing_and_households": {
        "housing_offer_and_terms": "offer_ref property_ref unit_ref owner_or_agent_authority_ref available_occupancy recurring_price_cents deposit_cents included_service_refs term eligibility_policy_ref household_restrictions_ref condition_disclosure_refs application_fact_refs screening_authority_refs debtor_shares payment_schedule_ref permitted_payment_methods notice_rules_ref service_responsibility_ref authorized_access_terms_ref exclusive_or_shared_occupancy_model",
        "tenancy_deposit": "tenancy_ref holding_account_or_escrow_ref held_liability_cents deduction_claim_refs accepted_or_adjudicated_deductions_cents refund_transaction_refs remaining_held_cents",
        "household_membership_and_permissions": "household_ref member_ref tenure_ref room_refs key_refs common_space_permissions visitor_rule_ref contribution_terms_ref liability_model shared_account_or_cash_box_ref resource_owner_refs authorized_spender_refs authorized_consumer_refs resource_responsibilities",
        "condition_evidence_and_repair_claim": "id room_fixture_or_service_ref canonical_condition_receipt_ref reported_problem cause_evidence_refs severity_fact_ref discovery_observation_refs claimant_ref responsibility_claim owner_acknowledgment_ref scheduled_visit_ref entry_authority_ref attempted_fix_receipt_refs inspection_refs completed_repair_ack_ref dispute_state",
        "service_connection": "id provider_ref connection_ref agreement_ref payer_ref beneficiary_refs included_in_rent billing_policy_ref aggregate_usage_receipt_refs state cause_event_ref effective_time renewal_authorization_ref cancellation_terms_ref",
    },
    "daily_life_and_routines": {
        "routine_plan": "id template_ref activities permitted_location_and_route_refs participant_refs resource_refs approved_substitute_refs total_budget_cents duration_or_time_window repricing_allowed stop_conditions activation_or_schedule_ref",
        "routine_execution": "id mandate_ref state current_step completed_step_receipt_refs pending_reservation_refs period_key period_spent_cents total_spent_cents actual_elapsed_time_receipt_refs pause_reason unresolved_choice_ref",
        "grocery_and_task_preferences": "saved_basket_ref eligible_store_refs destination_storage_ref replenishment_trigger substitution_restrictions task_definition_ref ingredient_or_clothing_lot_refs facility_tool_and_supply_refs reservation_refs output_or_completion_receipt_refs portion_recipient_refs chore_owner_ref chore_frequency chore_tolerance_policy_ref collection_receipt_ref",
        "needs_and_optional_detail_settings": "needs_profile profile_effective_time health_threshold_policy_ref spoilage_enabled preservation_policy_ref denomination_detail_enabled per_garment_detail_enabled metered_utilities_enabled currency_exchange_enabled alarm_preference_ref offline_progression_policy_ref",
    },
    "knowledge_and_transaction_control": {
        "notice_and_observation_channel": "id record_or_event_ref content sender_authority_ref target_ref channel_ref authorized_reader_refs attempted_time delivered_time observed_time effective_service_time evidence_and_correction_refs",
        "request_and_coordinator": "branch_id principal_id request_id request_key expected_revision source_context_ref causal_event_ref source_revision policy_version principal_authority_ref target_ref spending_authorization_ref participant_reservation_refs participant_prepare_receipts coordinator_decision owner_acknowledgment_refs persisted_result_ref response_status failure_code cancellable_scope",
        "outbox_and_recovery": "event_id event_type source_transaction_or_receipt_ref subscriber_delivery_state timer_or_period_key reconciliation_issue_refs correction_or_reversal_refs",
    },
}
TABLE_GROUP = {table: group for group, tables in SCHEMA.items() for table in tables}
FIELDS = {table: frozenset(fields.split()) for tables in SCHEMA.values() for table, fields in tables.items()}
TIME_FIELDS = frozenset("sim_time expiry_time due_time start_time end_time expiry offer_effective_time effective_start effective_end effective_time profile_effective_time attempted_time delivered_time observed_time effective_service_time".split())
BOOL_FIELDS = frozenset("overdraft_enabled compounding_enabled taxable tip_preference_enabled included_in_rent repricing_allowed spoilage_enabled denomination_detail_enabled per_garment_detail_enabled metered_utilities_enabled currency_exchange_enabled".split())


def validate_record(table: str, record: Object) -> None:
    require(table in FIELDS and type(record) is dict, "INVALID_SCHEMA")
    require(set(record) <= FIELDS[table], "INVALID_SCHEMA")
    # Optional values are represented explicitly as null in a complete record.
    # This prevents malformed snapshots from deferring missing fields to gameplay.
    require(set(record) == FIELDS[table], "INVALID_SCHEMA")
    validate_json(record)
    for name, value in record.items():
        if value is None:
            continue
        if name == "payer_shares_cents":
            require(type(value) is dict, "INVALID_SCHEMA")
            for amount in value.values():
                money(amount, nonnegative=True)
        elif name.endswith("_cents") or name in {"per_action_cap", "period_cap"}:
            money(value)
        elif name in TIME_FIELDS or name in {"revision", "source_revision", "expected_revision", "price_revision", "current_step"}:
            integer(value, "INVALID_SCHEMA")
        elif name in BOOL_FIELDS:
            require(type(value) is bool, "INVALID_SCHEMA")
        elif name in {"annual_rate", "unposted_interest_fraction", "rate"}:
            rational(value)
        elif name in {"quantity", "reserved_quantity_or_capacity", "fulfilled_quantity"}:
            quantity(value)
        elif name.endswith("_id") or name.endswith("_ref") or name in {"id", "currency", "kind", "state", "status", "request_key",
                "policy_version", "terms_version", "accepted_terms_version", "period_key", "source_period_key", "statement_interval_key",
                "event_type", "operation_kind", "purchase_stage", "payment_method", "response_status", "needs_profile", "liability_model",
                "fulfillment_method", "split_method", "coordinator_decision"}:
            require(type(value) is str and bool(value), "INVALID_SCHEMA")
        elif name.endswith("_refs") or name in {"authorized_principals", "allocation_order", "remainder_assignment_order", "accepted_instrument_types", "service_channels"}:
            require(type(value) is list and all(type(item) is str and bool(item) for item in value), "INVALID_SCHEMA")
    if table == "obligation":
        require(record["state"] in {"SCHEDULED", "OPEN", "PARTIAL", "OVERDUE", "DISPUTED", "SETTLED", "WAIVED", "REVERSED"}, "INVALID_STATE")
    if table == "service_connection":
        require(record["state"] in {"ACTIVE", "IMPAIRED", "OUTAGE", "NOTICE_PENDING", "SUSPENDED", "RESTORED"}, "INVALID_STATE")
    if table == "needs_and_optional_detail_settings":
        require(record["needs_profile"] in {"OFF", "LIGHT", "DETAILED"}, "INVALID_STATE")
    if table == "funds_hold":
        require(record["state"] in {"ACTIVE", "CAPTURED", "RELEASED", "EXPIRED"}, "INVALID_STATE")
    if table == "request_and_coordinator":
        require(record["coordinator_decision"] in {"UNDECIDED", "COMMIT", "ABORT"}, "INVALID_STATE")


@dataclass(slots=True)
class System14State:
    """The complete domain state: no implicit balances, clock, or foreign state."""

    core_records: dict = field(default_factory=dict)
    money_and_banking: dict = field(default_factory=dict)
    agreements_obligations_and_debt: dict = field(default_factory=dict)
    commerce: dict = field(default_factory=dict)
    housing_and_households: dict = field(default_factory=dict)
    daily_life_and_routines: dict = field(default_factory=dict)
    knowledge_and_transaction_control: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        for group, tables in SCHEMA.items():
            current = getattr(self, group)
            require(type(current) is dict and set(current) <= set(tables), "INVALID_SCHEMA")
            for table in tables:
                current.setdefault(table, {})
                require(type(current[table]) is dict, "INVALID_SCHEMA")
                for scoped, record in current[table].items():
                    try:
                        branch, ref = json.loads(scoped)
                    except (ValueError, TypeError):
                        raise DomainError("INVALID_REFERENCE") from None
                    require(key(branch, ref) == scoped, "INVALID_REFERENCE")
                    validate_record(table, record)
                    if "branch_id" in record:
                        require(record["branch_id"] == branch, "INVALID_REFERENCE")

    def table(self, name: str) -> dict:
        require(name in TABLE_GROUP, "INVALID_SCHEMA")
        return getattr(self, TABLE_GROUP[name])[name]

    def get(self, name: str, branch: str, ref: str) -> Object:
        result = self.table(name).get(key(branch, ref))
        require(result is not None, "RECORD_UNAVAILABLE")
        return result

    def find(self, name: str, branch: str, ref: str) -> Object | None:
        return self.table(name).get(key(branch, ref))

    def put(self, name: str, branch: str, ref: str, record: Object) -> Object:
        validate_record(name, record)
        if "branch_id" in record:
            require(record["branch_id"] == branch, "INVALID_REFERENCE")
        self.table(name)[key(branch, ref)] = record
        return record

    def rows(self, name: str, branch: str):
        for scoped, record in self.table(name).items():
            found_branch, ref = json.loads(scoped)
            if found_branch == branch:
                yield ref, record

    def export(self) -> Object:
        return clone(asdict(self))

    @classmethod
    def restore(cls, snapshot: Object) -> System14State:
        require(type(snapshot) is dict and set(snapshot) == set(SCHEMA), "INVALID_SCHEMA")
        return cls(**clone(snapshot))
