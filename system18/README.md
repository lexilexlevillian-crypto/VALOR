# System 18: Health, Injury, Medicine, and Substances

Isolated Node.js library for the System 18 architecture. Requires Node.js 22 or later and no third-party packages.

```js
import { HealthSystem, HealthState } from './health.mjs';

// Both inputs are explicit authored JSON. No production rules are supplied.
const system = new HealthSystem(initialSnapshot, dependencyFixtures);
const result = await system.step(command);
```

Run the isolated verification suite:

```sh
node --check system18/health.mjs
node --test system18/health.test.mjs
```

## Deployment boundary

This directory is packaged with VALOR on Render. It does not register an HTTP endpoint, modify live game health, run database migrations, or connect to other numbered systems. The existing application remains the web-service entry point.

Every dependency is a stateless dummy-JSON stub. Default dependency responses are pending. Supplied fixture assertions remain explicitly marked `mock: true`; they are not actual inventory, billing, transport, consent, or message-delivery commitments. The tests contain fictional fixtures, not production medical tuning.

Before gameplay activation, an explicit integration must supply versioned campaign/model manifests and a storage/access boundary. Numeric thresholds, transition timing, and medical profiles are not inferred. `snapshot`, `save`, and `load` are trusted-host APIs; never expose snapshots as player queries. Render's ephemeral filesystem is not durable game storage.

## Interface

`step(command)` accepts JSON with `command`, `actor_ref`, `target`, `canonical_time`, `expected_revision`, `correlation_id`, `idempotency_key`, `authority_ref`, `cause_ref`, `rules_version`, and `payload`.

Supported commands and visibility-filtered queries are declared in `health.mjs`. Results distinguish committed local state, pending mocked dependencies, and rejection. Saved state retains events, idempotency results, model versions, pending workflows, and scheduled boundaries.

Schema validation preserves explicit unknowns and rejects undeclared record fields. The tests cover replay, persistence, privacy, capability restrictions, chronological progression, exposure consumption, treatment/refusal, bleeding intervals, terminal transitions, and concurrent duplicate commands.
