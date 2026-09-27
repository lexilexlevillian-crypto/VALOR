import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,key,login} from './helpers.ts';

test('System 02 audits correlate privileged edits and preserve before/after values',async()=>{
 const f=await fixture();
 try{
  const session=await login(f);
  const headers={cookie:session.cookie,origin:f.settings.origin,'x-csrf-token':session.csrf,'idempotency-key':key()};
  const created=await f.app.inject({method:'POST',url:'/commands',headers,payload:{scope:f.scope,command:{type:'record.create',kind:'security-test',name:'Before name',visibility:'campaign'}}});
  assert.equal(created.statusCode,200,created.body);
  const recordId=created.json().id as string;
  const requestId=String(created.headers['x-request-id']);
  const audits=await f.app.inject({url:'/scopes/campaign/'+f.campaign.id+'/audits',headers:{cookie:session.cookie}});
  assert.equal(audits.statusCode,200);
  const createAudit=audits.json().find((row:{action:string;target_id:string})=>row.action==='record.create'&&row.target_id===recordId);
  assert.equal(createAudit.request_id,requestId);
  assert.equal(createAudit.before_json,null);
  assert.match(createAudit.after_json,/Before name/);
  const updated=await f.app.inject({method:'POST',url:'/commands',headers:{...headers,'idempotency-key':key()},payload:{scope:f.scope,command:{type:'record.update',recordId,expectedRevision:1,name:'After name',visibility:'campaign'}}});
  assert.equal(updated.statusCode,200,updated.body);
  const auditsAfter=(await f.app.inject({url:'/scopes/campaign/'+f.campaign.id+'/audits',headers:{cookie:session.cookie}})).json();
  const updateAudit=auditsAfter.find((row:{action:string;target_id:string})=>row.action==='record.update'&&row.target_id===recordId);
  assert.match(updateAudit.before_json,/Before name/);
  assert.match(updateAudit.after_json,/After name/);
  assert.ok(updateAudit.request_id);
 }finally{await f.close();}
});

test('System 02 blocks cross-campaign reads, role escalation, and hidden field leakage',async()=>{
 const f=await fixture();
 try{
  const record=await f.execute({type:'record.create',kind:'security-test',name:'Visible record',visibility:'campaign'});
  const section=await f.execute({type:'section.add',recordId:record.id,expectedRevision:1,name:'Details',position:0,visibility:'campaign',parentId:null});
  const field=await f.execute({type:'field.add',recordId:record.id,expectedRevision:2,sectionId:section.sectionId!,name:'Creator secret',position:0,valueType:'text',visibility:'creator'});
  await f.execute({type:'field.set',recordId:record.id,expectedRevision:3,fieldId:field.fieldId!,value:'DO_NOT_LEAK'});
  const player=await login(f,'player@example.test');
  const other=await login(f,'other@example.test');
  const visible=await f.app.inject({url:'/scopes/campaign/'+f.campaign.id+'/records/'+record.id,headers:{cookie:player.cookie}});
  assert.equal(visible.statusCode,200);
  assert.doesNotMatch(visible.body,/DO_NOT_LEAK|Creator secret/);
  assert.equal((await f.app.inject({url:'/scopes/campaign/'+f.campaign.id+'/audits',headers:{cookie:player.cookie}})).statusCode,403);
  assert.equal((await f.app.inject({url:'/scopes/campaign/'+f.campaign.id+'/records',headers:{cookie:other.cookie}})).statusCode,404);
  const denied=await f.app.inject({method:'POST',url:'/commands',headers:{cookie:player.cookie,origin:f.settings.origin,'x-csrf-token':player.csrf,'idempotency-key':key()},payload:{scope:f.scope,command:{type:'record.create',kind:'security-test',name:'Escalation',visibility:'campaign'}}});
  assert.equal(denied.statusCode,403);
 }finally{await f.close();}
});
