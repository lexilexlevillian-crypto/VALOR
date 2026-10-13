/** Compile-only public interface checks; no foreign engine modules are imported. */
import { PersistenceSystem25, PersistenceState, makeArtifact } from './index.mjs';
import type { CommandContext, QueryContext, Response, State } from './index.mjs';

const system = new PersistenceSystem25({
  dependencies: { commitStorage: _request => ({ mock: true, durable: false, acknowledged: false, simulated_durable_commit: false }) }
});
const context: CommandContext = {
  campaign_id: 'example', timeline_id: 'root', authority: { role: 'administrator', session_id: 'session', actor_id: 'actor' },
  operation_id: 'operation', idempotency_key: 'command', expected_head_revision: 0, expected_entity_revisions: {}, session_fence: 0
};
const query: QueryContext = context;
const response: Response = system.stateMachine({ command: 'GetStatus', context: query });
if (!response.ok) response.error.code satisfies string;
system.stateMachine({ command: 'CommitBatch', context, args: { opaque: null } });
const state: State = new PersistenceState().toJSON();
makeArtifact({ exact_value: '9007199254740993', unknown: null });
// @ts-expect-error Mutation requests require revision, idempotency, and fencing context.
system.stateMachine({ command: 'CommitBatch', context: query });
// @ts-expect-error State has no unlisted variables.
state.unlisted_state = {};
// @ts-expect-error No merge command exists.
system.stateMachine({ command: 'MergeTimelines', context });
