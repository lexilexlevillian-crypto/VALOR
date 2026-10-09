/** Creator-only scratch workspace; all System 11 domain adapters stay mocked. */
import type {FastifyInstance} from 'fastify';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Actor} from './contracts.ts';
import {ensure} from './contracts.ts';
import {runSystem11,system11Version} from './system11-runtime.ts';
import type {System11Response} from './system11-runtime.ts';

const waitInput=z.strictObject({commandId:z.uuid(),branchId:z.string().min(1).max(160),expectedClockRevision:z.number().int().nonnegative(),durationMs:z.number().int().min(0).max(3600000).multipleOf(1000)});
type Workspace={branch:string;snapshot?:Record<string,unknown>;busy:boolean;expires:number};
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VALOR — System 11</title><style>body{font:18px system-ui;background:#151921;color:#edf2f7;max-width:48rem;margin:3rem auto;padding:1rem}button,a{color:inherit}button{background:#273448;border:1px solid #8594a8;border-radius:.5rem;padding:.7rem;margin:.4rem}a{display:inline-block;margin-bottom:1rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#202834;padding:1rem;border-radius:.5rem}small{color:#bfc9d7}</style><a href="/app">Return to VALOR</a><h1>Time, Schedule &amp; Calendar</h1><p>Isolated System 11 workspace</p><small>Uses mocked domain adapters. This workspace does not advance saved lives. Scratch state expires after 30 minutes of inactivity and on server restart.</small><h2 id="clock">Loading…</h2><div id="controls"><button data-minutes="5">Wait 5 minutes</button><button data-minutes="15">Wait 15 minutes</button><button data-minutes="30">Wait 30 minutes</button><button data-minutes="60">Wait 60 minutes</button></div><p id="status" role="status" aria-live="polite"></p><pre id="result"></pre><script type="module" src="/system11/client.js"></script></html>`;
const javascript=`let clock,csrf;
const status=document.getElementById('status'),output=document.getElementById('result'),buttons=[...document.querySelectorAll('button')];
function render(value){clock=value.clock;document.getElementById('clock').textContent=clock.local_datetime;output.textContent=JSON.stringify(value.result??value,null,2);}
async function load(){const auth=await fetch('/auth/session');if(auth.status===401){location.href='/app';return;}csrf=(await auth.json()).csrfToken;const response=await fetch('/system11');const value=await response.json();if(!response.ok)throw Error(value.error??'Unable to open System 11');render(value);}
for(const button of buttons)button.addEventListener('click',async()=>{if(!clock)return;buttons.forEach(b=>b.disabled=true);status.textContent='Advancing isolated time…';try{const response=await fetch('/system11/advance',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({commandId:crypto.randomUUID(),branchId:clock.branch_id,expectedClockRevision:clock.revision,durationMs:Number(button.dataset.minutes)*60000})});const value=await response.json();if(value.clock)render(value);if(!response.ok)throw Error(value.error??value.result?.error?.code??'Advance paused');status.textContent='Complete';}catch(error){status.textContent=error.message;}finally{buttons.forEach(b=>b.disabled=false);}});
load().catch(error=>status.textContent=error.message);`;

export function system11Routes(app:FastifyInstance,actor:(request:object)=>Actor){
  const workspaces=new Map<string,Workspace>();
  const allowed=(request:object)=>{const current=actor(request);ensure(current&&(current.role==='creator'||current.role==='admin'),403,'forbidden');return current;};
  function workspace(userId:string):Workspace{
    const now=Date.now();
    for(const [id,value] of workspaces)if(!value.busy&&value.expires<now)workspaces.delete(id);
    let value=workspaces.get(userId);
    if(!value){ensure(workspaces.size<32,503,'system11_busy');value={branch:'sandbox:'+randomUUID(),busy:false,expires:now+1800000};workspaces.set(userId,value);}
    ensure(!value.busy,409,'system11_busy');value.expires=now+1800000;return value;
  }
  const view=(value:System11Response)=>({domain:'time_schedule_calendar',version:system11Version,adapterMode:'mocked',isolated:true,persistence:'scratch',clock:value.clock,result:value.result});
  app.get('/system11/console',async(request,reply)=>{
    allowed(request);return reply.header('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'").type('text/html').send(html);
  });
  app.get('/system11/client.js',async(request,reply)=>{allowed(request);return reply.type('text/javascript').send(javascript);});
  app.get('/system11',async request=>{
    const current=allowed(request),session=workspace(current.id);session.busy=true;
    try{const value=await runSystem11({operation:'inspect',branch_id:session.branch,snapshot:session.snapshot});session.snapshot=value.snapshot;return view(value);}finally{session.busy=false;}
  });
  app.post('/system11/advance',async(request,reply)=>{
    const current=allowed(request),body=waitInput.parse(request.body),session=workspace(current.id);
    ensure(body.branchId===session.branch,409,'system11_workspace_changed');session.busy=true;
    try{
      const value=await runSystem11({operation:'advance',branch_id:session.branch,snapshot:session.snapshot,command_id:body.commandId,expected_clock_revision:body.expectedClockRevision,duration_ms:body.durationMs});
      session.snapshot=value.snapshot;
      if(value.result?.status==='ERROR')reply.code(409);
      if(value.result?.status==='RECOVERY_REQUIRED')reply.code(503);
      return view(value);
    }finally{session.busy=false;}
  });
  app.addHook('onClose',async()=>{workspaces.clear();});
}
