import {
  emptySnapshot,
  examplePolicy,
  relationshipStateMachine,
} from './index.mjs';

// All external calls use stateless dummy JSON adapters by default.
// The numeric policy is explicit demonstration tuning, not a source requirement.
const result = relationshipStateMachine({
  operation: 'ingest',
  snapshot: emptySnapshot('demo-timeline'),
  policy: examplePolicy(),
  source_event_id: 'demo-canonical-event',
  detail: 'Structured',
});

console.log(JSON.stringify(result, null, 2));
