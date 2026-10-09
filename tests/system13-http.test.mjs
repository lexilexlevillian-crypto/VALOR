import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { system13Routes, SYSTEM13_VERSION } from '../src/system13-http.ts';

test('System 13 deployment status requires authentication', async () => {
  const app = Fastify();
  try {
    system13Routes(app, () => undefined);
    const response = await app.inject('/api/system13/status');
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), {error:'authentication_required'});
  } finally { await app.close(); }
});

test('System 13 reports isolation without exposing mutation or fixture APIs', async () => {
  const app = Fastify();
  try {
    system13Routes(app, () => ({id:'test-player', role:'player'}));
    const response = await app.inject('/api/system13/status');
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      domain:'jobs_workplaces_career', version:SYSTEM13_VERSION, status:'loaded',
      mode:'isolated-library', dependencies:'fixed-json-stubs',
      gameplayIntegration:false, persistentStorageBound:false,
    });
    assert.equal((await app.inject({method:'POST', url:'/api/system13/status', payload:{fixtures:{}}})).statusCode, 404);
  } finally { await app.close(); }
});
