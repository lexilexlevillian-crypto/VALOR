import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=mkdtempSync(join(tmpdir(),'valor-suite-'));
try{
 const files=process.argv.slice(2);
 const result=spawnSync(process.execPath,['--test','--test-concurrency=1',...(files.length?files:['tests/*.test.ts'])],{stdio:'inherit',env:{...process.env,TMP:root,TEMP:root,TMPDIR:root,VALOR_TEST_ROOT:root}});
 process.exitCode=result.status??1;
}finally{rmSync(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
