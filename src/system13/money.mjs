/** Exact rational arithmetic. JSON uses decimal integer strings for rational parts. */
import { requireRule, integer, exact } from "./schema.mjs";
const gcd = (a, b) => {
  a = a < 0n ? -a : a;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
};
export function rational(value) {
  if (Number.isSafeInteger(value)) return [BigInt(value), 1n];
  if (typeof value === "string") {
    requireRule(/^-?\d+(?:\/\d+)?$/.test(value), "INVALID_RATIONAL");
    const [n, d = "1"] = value.split("/");
    return reduce(BigInt(n), BigInt(d));
  }
  exact(value, ["numerator", "denominator"]);
  requireRule(
    /^-?\d+$/.test(value.numerator) && /^\d+$/.test(value.denominator),
    "INVALID_RATIONAL",
  );
  return reduce(BigInt(value.numerator), BigInt(value.denominator));
}
export function reduce(n, d) {
  requireRule(d > 0n, "INVALID_RATIONAL");
  const g = gcd(n, d);
  return [n / g, d / g];
}
export const add = (a, b) => reduce(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
export const multiply = (a, b) => reduce(a[0] * b[0], a[1] * b[1]);
export const divide = (a, b) => {
  requireRule(b[0] > 0n, "ZERO_WEIGHT");
  return reduce(a[0] * b[1], a[1] * b[0]);
};
export const asJSON = (a) => ({
  numerator: a[0].toString(),
  denominator: a[1].toString(),
});
export function safeNumber(n) {
  const value = Number(n);
  requireRule(Number.isSafeInteger(value), "AMOUNT_OVERFLOW");
  return value;
}
export function roundHalfUp(a) {
  const sign = a[0] < 0n ? -1n : 1n,
    n = a[0] * sign;
  return safeNumber(sign * ((2n * n + a[1]) / (2n * a[1])));
}
export function hourlyEntitlement(rateCentsPerHour, payableSeconds, carry = 0) {
  integer(rateCentsPerHour);
  const seconds = rational(payableSeconds);
  requireRule(seconds[0] >= 0n, "INVALID_DURATION");
  const exactAmount = add(
    divide(multiply(rational(rateCentsPerHour), seconds), rational(3600)),
    rational(carry),
  );
  const cents = roundHalfUp(exactAmount);
  return {
    cents,
    fractional_remainder: asJSON(add(exactAmount, rational(-cents))),
  };
}
export function allocateTipPool(poolCents, participants) {
  integer(poolCents);
  requireRule(participants.length > 0, "ZERO_WEIGHT");
  requireRule(
    new Set(participants.map((p) => p.participant_id)).size ===
      participants.length,
    "DUPLICATE_PARTICIPANT",
  );
  let total = rational(0);
  const rows = participants.map((p) => {
    exact(p, ["participant_id", "eligible_service_seconds", "role_weight"]);
    requireRule(
      typeof p.participant_id === "string" && p.participant_id.length > 0,
      "INVALID_PARTICIPANT",
    );
    const seconds = rational(p.eligible_service_seconds),
      weight = rational(p.role_weight);
    requireRule(seconds[0] >= 0n && weight[0] >= 0n, "INVALID_WEIGHT");
    const w = multiply(seconds, weight);
    total = add(total, w);
    return { ...p, weight: w };
  });
  requireRule(total[0] > 0n, "ZERO_WEIGHT");
  let allocated = 0;
  for (const row of rows) {
    const share = divide(multiply(rational(poolCents), row.weight), total);
    row.floor_allocation_cents = safeNumber(share[0] / share[1]);
    row.remainder = reduce(share[0] % share[1], share[1]);
    row.final_allocation_cents = row.floor_allocation_cents;
    allocated += row.floor_allocation_cents;
  }
  const ranked = [...rows].sort((a, b) => {
    const delta =
      b.remainder[0] * a.remainder[1] - a.remainder[0] * b.remainder[1];
    return delta === 0n
      ? a.participant_id < b.participant_id
        ? -1
        : 1
      : delta > 0n
        ? 1
        : -1;
  });
  for (let i = 0; i < poolCents - allocated; i++)
    ranked[i].final_allocation_cents++;
  return rows.map(({ weight, remainder, ...row }) => ({
    ...row,
    allocation_weight: asJSON(weight),
    fractional_remainder: asJSON(remainder),
  }));
}
