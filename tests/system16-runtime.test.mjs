import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { SYSTEM16_STATUS, SYSTEM16_VERSION, system16Routes, verifySystem16Runtime } from '../src/system16-runtime.ts';

test('System 16 deployment verifies Python and preserves mocked isolation', async () => {
  await verifySystem16Runtime();
  const app = Fastify();
  system16Routes(app);
  try {
    const status = await app.inject('/system16/status');
    assert.equal(status.statusCode, 200);
    assert.deepEqual(status.json(), SYSTEM16_STATUS);
    assert.equal(status.json().gameplayIntegration, false);
    assert.equal(status.json().dependencies, 'mocked');
    assert.equal(SYSTEM16_VERSION, 'system16/1');
    assert.equal((await app.inject({ method: 'POST', url: '/system16/status', payload: { fixtures: {} } })).statusCode, 404);
  } finally {
    await app.close();
  }
});

test('System 16 status is not in the host authentication bypass', () => {
  const source = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  const hook = source.slice(source.indexOf("app.addHook('onRequest'"), source.indexOf("app.addHook('onResponse'"));
  assert.ok(hook.includes('auth.authenticate'));
  assert.ok(!hook.includes('/system16/status'));
});

test('System 16 Python acceptance suite runs in the host CI test discovery', () => {
  execFileSync(process.env.SYSTEM16_PYTHON ?? 'python3', [
    '-B', '-m', 'unittest', 'discover', '-s', 'tests/system16_python', '-q',
  ], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    timeout: 60000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
});
