import {parentPort,workerData} from 'node:worker_threads';
import {System10} from '../../src/system10/index.mjs';
const engine=new System10({database:workerData.database,fixtures:workerData.fixtures});
try { parentPort.postMessage(engine.dispatch(workerData.command,'developer')); }
finally { engine.close(); }