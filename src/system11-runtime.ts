/** Fixed-path Python transport. Player input is JSON stdin, never shell text. */
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {Fault,ensure} from './contracts.ts';

export const system11Version='system11/1';
const worker=fileURLToPath(new URL('./system11_python/bridge.py',import.meta.url));
export const system11Environment=():NodeJS.ProcessEnv=>({
  PATH:process.env.PATH,Path:process.env.Path,SystemRoot:process.env.SystemRoot,
  SYSTEMROOT:process.env.SYSTEMROOT,WINDIR:process.env.WINDIR,
  PYTHONPATH:join(dirname(worker),'vendor'),PYTHONNOUSERSITE:'1',
  PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8',
});
let executable:string|undefined;
let running=0;
export function system11Python():string {
  if(executable)return executable;
  for(const candidate of [...new Set([process.env.VALOR_SYSTEM11_PYTHON,'python3','python'].filter((v):v is string=>Boolean(v)))]){
    const probe=spawnSync(candidate,['-S','-B',worker,'--probe'],{encoding:'utf8',env:system11Environment(),timeout:5000,windowsHide:true,maxBuffer:8192});
    if(probe.status!==0)continue;
    try { const value=JSON.parse(probe.stdout); if(value.ready===true&&value.version===system11Version&&value.tzdata_version==='2026d')return executable=candidate; }catch{}
  }
  throw new Fault(503,'system11_runtime_unavailable');
}
export type System11Response={snapshot:Record<string,unknown>;clock:Record<string,unknown>;result:Record<string,unknown>|null};
export async function runSystem11(message:Record<string,unknown>):Promise<System11Response>{
  ensure(running<2,503,'system11_busy');
  const payload=JSON.stringify(message);
  ensure(Buffer.byteLength(payload)<4*1024*1024,413,'system11_workspace_full');
  const python=system11Python();
  running++;
  try {
    return await new Promise((resolve,reject)=>{
      const child=spawn(python,['-S','-B',worker],{env:system11Environment(),windowsHide:true,stdio:['pipe','pipe','pipe']});
      const chunks:Buffer[]=[];let size=0,finished=false;
      const finish=(error?:Fault,value?:System11Response)=>{if(finished)return;finished=true;clearTimeout(timer);error?reject(error):resolve(value!);};
      const timer=setTimeout(()=>{child.kill();finish(new Fault(503,'system11_timeout'));},20000);
      child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>4*1024*1024){child.kill();finish(new Fault(413,'system11_workspace_full'));}else chunks.push(chunk);});
      child.stderr.resume(); // Never log snapshots, dialogue, paths, or process diagnostics.
      child.on('error',()=>finish(new Fault(503,'system11_runtime_unavailable')));
      child.stdin.on('error',()=>finish(new Fault(503,'system11_worker_failed')));
      child.on('close',code=>{
        if(finished)return;
        if(code!==0)return finish(new Fault(503,'system11_worker_failed'));
        try{
          const value=JSON.parse(Buffer.concat(chunks).toString('utf8')) as System11Response;
          if(!value.snapshot||!value.clock||value.snapshot.domain!=='time_schedule_calendar')throw new Error();
          finish(undefined,value);
        }catch{finish(new Fault(503,'system11_worker_failed'));}
      });
      child.stdin.end(payload);
    });
  }finally{running--;}
}
