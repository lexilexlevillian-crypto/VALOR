import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,key,login} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {validateEntity} from '../src/game/model.ts';
import {buildApp} from '../src/app.ts';

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
  const updated=await f.app.inject({method:'POST',url:'/commands',headers:{...headers,'idempotency-key':key()},payload:{scope:f.scope,audit:{reason:'creator-correction',note:'Reviewed with campaign owner'},command:{type:'record.update',recordId,expectedRevision:1,name:'After name',visibility:'campaign'}}});
  assert.equal(updated.statusCode,200,updated.body);
  const auditsAfter=(await f.app.inject({url:'/scopes/campaign/'+f.campaign.id+'/audits',headers:{cookie:session.cookie}})).json();
  const updateAudit=auditsAfter.find((row:{action:string;target_id:string})=>row.action==='record.update'&&row.target_id===recordId);
  assert.match(updateAudit.before_json,/Before name/);
  assert.match(updateAudit.after_json,/After name/);
  assert.equal(updateAudit.reason,'creator-correction');
  assert.equal(updateAudit.note,'Reviewed with campaign owner');
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

test('System 02 archives by default and hard-deletes only after an owner dependency report and exact confirmation',async()=>{
 const f=await fixture();
 try{
  const active=await f.execute({type:'record.create',kind:'security-test',name:'Active record',visibility:'creator'});
  const activeReport=await f.domain.deletionReport(f.creator,f.scope,active.id,'Review active record');
  assert.equal(activeReport.hardDeleteAllowed,false);
  await assert.rejects(()=>f.domain.hardDeleteRecord(f.creator,f.scope,active.id,activeReport.id,activeReport.confirmation),/hard_delete_blocked/);
  await assert.rejects(()=>f.domain.deletionReport(f.player,f.scope,active.id),/forbidden/);

  const worldScope={type:'world' as const,id:f.world.id};
  const source=await f.domain.execute(f.creator,worldScope,{type:'record.create',kind:'security-template',name:'Referenced source',visibility:'creator'},key());
  await f.execute({type:'record.instantiate',sourceRecordId:source.id,sourceRevision:1,visibility:'creator'});
  await f.domain.execute(f.creator,worldScope,{type:'record.archive',recordId:source.id,expectedRevision:1},key());
  const blockedReport=await f.domain.deletionReport(f.creator,worldScope,source.id,'Check source dependencies');
  assert.equal(blockedReport.blockers.sourceInstances,1);
  assert.equal(blockedReport.hardDeleteAllowed,false);
  await assert.rejects(()=>f.domain.hardDeleteRecord(f.creator,worldScope,source.id,blockedReport.id,blockedReport.confirmation),/hard_delete_blocked/);

  const archived=await f.execute({type:'record.create',kind:'security-test',name:'Archived record',visibility:'creator'});
  await f.execute({type:'record.archive',recordId:archived.id,expectedRevision:1});
  const report=await f.domain.deletionReport(f.creator,f.scope,archived.id,'Dependency review complete');
  assert.equal(report.hardDeleteAllowed,true);
  assert.ok(report.retainedHistory.events>0);
  await assert.rejects(()=>f.domain.hardDeleteRecord(f.creator,f.scope,archived.id,report.id,'DELETE IT'),/confirmation/);
  const deleted=await f.domain.hardDeleteRecord(f.creator,f.scope,archived.id,report.id,report.confirmation,'Approved permanent removal');
  assert.equal(deleted.deleted,true);
  assert.equal(await f.store.get('SELECT id FROM records WHERE id=?',archived.id),undefined);
  assert.equal((await f.store.get<{n:number}>("SELECT count(*) n FROM domain_events WHERE aggregate_id=? AND type='record.hard_deleted'",archived.id))!.n,1);
  assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM artifact_schema_versions WHERE artifact_type=? AND artifact_id=?','record',archived.id))!.n,0);
  const audit=await f.store.get<{reason:string;note:string;before_json:string}>('SELECT reason,note,before_json FROM audit_log WHERE action=? AND target_id=?','record.hard_deleted',archived.id);
  assert.equal(audit!.reason,'confirmed-hard-delete');assert.equal(audit!.note,'Approved permanent removal');assert.match(audit!.before_json,/retainedHistory/);
 }finally{await f.close();}
});

test('System 02 enforces campaign role claims and excludes hidden/contact-private data from views, AI context, exports, and audits',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id),locationId=randomUUID(),playerId=randomUUID(),npcId=randomUUID(),phoneId=randomUUID();
  const entities=[
   validateEntity({id:locationId,kind:'location',name:'Security room',visibility:'campaign',data:{}}),
   validateEntity({id:playerId,kind:'character',name:'Player character',visibility:'owner',data:{playable:true,controllerUserId:f.player.id,locationId}}),
   validateEntity({id:npcId,kind:'character',name:'Visible NPC',visibility:'campaign',data:{locationId,secrets:'NPC_SECRET_VALUE',instructions:'HIDDEN_INSTRUCTION'}}),
   validateEntity({id:phoneId,kind:'item',name:'Private phone',visibility:'owner',data:{category:'phone',ownerId:playerId,contacts:[{characterId:npcId,label:'PRIVATE_CONTACT_LABEL'}]}})
  ];
  await game.bulkEdit(f.creator,timeline.id,{revision:1,entities},key());
  const audit=await f.store.get<{before_json:string}>('SELECT before_json FROM audit_log WHERE action=? ORDER BY rowid DESC LIMIT 1','creator.bulk');
  assert.match(audit!.before_json,/\[REDACTED\]/);
  assert.doesNotMatch(audit!.before_json,/NPC_SECRET_VALUE|HIDDEN_INSTRUCTION|PRIVATE_CONTACT_LABEL/);

  const playerView=JSON.stringify(await game.view(f.player,timeline.id,playerId));
  assert.doesNotMatch(playerView,/NPC_SECRET_VALUE|HIDDEN_INSTRUCTION/);
  const context=JSON.stringify(await game.context(f.player,timeline.id,playerId,'NPC_SECRET_VALUE HIDDEN_INSTRUCTION'));
  assert.doesNotMatch(context,/NPC_SECRET_VALUE|HIDDEN_INSTRUCTION/);
  await assert.rejects(()=>game.export(f.player,timeline.id),/forbidden/);

  const playerSession=await login(f,'player@example.test'),otherSession=await login(f,'other@example.test');
  const developerPath='/game/timelines/'+timeline.id+'/developer/overview';
  assert.equal((await f.app.inject({url:developerPath,headers:{cookie:playerSession.cookie}})).statusCode,403);
  assert.equal((await f.app.inject({url:developerPath,headers:{cookie:otherSession.cookie}})).statusCode,404);
  await f.domain.setMember(f.creator,f.campaign.id,{userId:f.other.id,role:'admin',expectedRevision:3},key());
  assert.equal((await f.app.inject({url:developerPath,headers:{cookie:otherSession.cookie}})).statusCode,200);
 }finally{await f.close();}
});

test('System 02 enforces independent mutation, AI, export, import, and export-size limits',async()=>{
 const f=await fixture();
 const app=buildApp(f.store,{...f.settings,mutationLimit:2,aiCallLimit:1,exportLimit:1},false);
 try{
  const creator=await login({...f,app});
  const headers={cookie:creator.cookie,origin:f.settings.origin,'x-csrf-token':creator.csrf};
  for(let index=0;index<2;index++){
   const response=await app.inject({method:'POST',url:'/worlds',headers:{...headers,'idempotency-key':key()},payload:{name:'Limited world '+index}});
   assert.equal(response.statusCode,201,response.body);
  }
  const mutationLimited=await app.inject({method:'POST',url:'/worlds',headers:{...headers,'idempotency-key':key()},payload:{name:'Rejected burst'}});
  assert.equal(mutationLimited.statusCode,429);

  const other=await login({...f,app},'other@example.test'),otherHeaders={cookie:other.cookie,origin:f.settings.origin,'x-csrf-token':other.csrf};
  const missingTimeline=randomUUID(),interpret=()=>app.inject({method:'POST',url:'/game/timelines/'+missingTimeline+'/interpret',headers:otherHeaders,payload:{characterId:randomUUID(),text:'look',provider:'gemini'}});
  assert.equal((await interpret()).statusCode,404);
  assert.equal((await interpret()).statusCode,429);
  const exportRequest=()=>app.inject({url:'/game/timelines/'+missingTimeline+'/export',headers:{cookie:other.cookie}});
  assert.equal((await exportRequest()).statusCode,404);
  assert.equal((await exportRequest()).statusCode,429);

  const timeline=await new Game(f.store).initialize(f.creator,f.campaign.id);
  await assert.rejects(()=>new Game(f.store,{exportBytes:512}).export(f.creator,timeline.id),/export_too_large/);
  await assert.rejects(()=>new Game(f.store,{importBytes:1024}).validateImport(f.creator,timeline.id,{padding:'x'.repeat(2000)}),/import_too_large/);
 }finally{await app.close();await f.close();}
});
