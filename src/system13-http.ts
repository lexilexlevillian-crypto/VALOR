import type { FastifyInstance } from 'fastify';
import type { Actor } from './contracts.ts';
import { JobsEngine } from './system13/index.mjs';

export const SYSTEM13_VERSION = 'system13/1';

/** Deployment metadata only. Gameplay storage must be bound by a durable host. */
export function system13Routes(app: FastifyInstance, actor: (request: object) => Actor | undefined) {
  const probe = new JobsEngine({world_id:'system13-runtime-probe', branch_id:'probe', filename:':memory:'});
  probe.close();
  app.get('/api/system13/status', async (request, reply) => {
    if (!actor(request)) return reply.code(401).send({error:'authentication_required'});
    return {
      domain:'jobs_workplaces_career',
      version:SYSTEM13_VERSION,
      status:'loaded',
      mode:'isolated-library',
      dependencies:'fixed-json-stubs',
      gameplayIntegration:false,
      persistentStorageBound:false,
    };
  });
}
