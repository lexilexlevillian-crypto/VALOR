import {spawnSync} from 'node:child_process';
import {system11Python,system11Environment} from '../src/system11-runtime.ts';
const result=spawnSync(system11Python(),['-S','-B','-m','unittest','discover','-s','tests/system11_python','-v'],{env:system11Environment(),stdio:'inherit',windowsHide:true});
process.exitCode=result.status??1;
