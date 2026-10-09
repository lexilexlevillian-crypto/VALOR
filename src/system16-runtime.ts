/** Deployment boundary for the isolated Python module; no game-owner calls. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
export const SYSTEM16_VERSION = 'system16/1';
export const SYSTEM16_STATUS = Object.freeze({
  system: 16,
  version: SYSTEM16_VERSION,
  domain: 'phone_communication_2012_social_media',
  mode: 'isolated',
  dependencies: 'mocked',
  gameplayIntegration: false,
});

const probe = `
import json, sys
if sys.version_info < (3, 12):
    raise RuntimeError('python_version_unsupported')
from src.system16_python import State, transition
from src.system16_python.contracts import COMMANDS
state = State().to_json()
command = {'operation': 'CreateDraft', 'branch_id': 'runtime-probe',
           'principal_id': 'runtime-probe', 'request_id': 'runtime-probe',
           'arguments': {}}
result = transition(state, command)
assert result['state'] == state
assert result['result']['status'] == 'CHOICE_REQUIRED'
assert result['result']['failure_code'] == 'AUTHORIZATION_REQUIRED'
assert 'CommitMessage' in COMMANDS
print(json.dumps({'domain': state['domain'], 'verified': True}))
`;

let verification: Promise<void> | undefined;

/** Import and exercise a denied synthetic command once per server process. */
export function verifySystem16Runtime(): Promise<void> {
  if (verification) return verification;
  verification = (async () => {
    const override = process.env.SYSTEM16_PYTHON;
    const candidates = override ? [override] : ['python3', 'python'];
    for (const interpreter of candidates) {
      try {
        const { stdout } = await run(interpreter, ['-B', '-c', probe], {
          cwd: root,
          timeout: 30000,
          maxBuffer: 16384,
          windowsHide: true,
        });
        const result: unknown = JSON.parse(stdout);
        if (typeof result === 'object' && result !== null &&
            'verified' in result && result.verified === true &&
            'domain' in result && result.domain === SYSTEM16_STATUS.domain) return;
      } catch {
        // Process diagnostics are intentionally not exposed through HTTP or logs.
      }
    }
    throw new Error('system16_runtime_unavailable');
  })();
  return verification;
}

/** The host's existing authentication hook protects this metadata-only route. */
export function system16Routes(app: FastifyInstance): void {
  app.addHook('onReady', verifySystem16Runtime);
  app.get('/system16/status', async () => SYSTEM16_STATUS);
}
