import {system11Python} from '../src/system11-runtime.ts';
try{system11Python();console.log('System 11 runtime ready (system11/1; tzdata 2026d).');}
catch{console.error('System 11 requires Python 3.12+; set VALOR_SYSTEM11_PYTHON to its executable.');process.exitCode=1;}
