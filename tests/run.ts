import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=mkdtempSync(join(tmpdir(),'valor-suite-'));
try{
 const files=process.argv.slice(2);
 const discovered=files.length?files:readdirSync(resolve('tests')).filter(file=>/\.test\.(?:ts|mjs)$/.test(file)).sort().map(file=>resolve('tests',file));
 let exitCode=0;
 for(const file of discovered){
  const result=spawnSync(process.execPath,['--test','--test-concurrency=1',file],{stdio:'inherit',env:{...process.env,TMP:root,TEMP:root,TMPDIR:root,VALOR_TEST_ROOT:root,AI_PROVIDER:'',DEEPINFRA_API_KEY:'',DEEPINFRA_TOKEN:'',GEMINI_API_KEY:'',GOOGLE_API_KEY:'',AI_GATEWAY_URL:'',AI_GATEWAY_SECRET:''}});
  if((result.status??1)!==0)exitCode=result.status??1;
 }
 process.exitCode=exitCode;
}finally{rmSync(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
