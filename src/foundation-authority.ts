import {randomBytes,randomUUID} from 'node:crypto';
import {ensure} from './contracts.ts';
import type {Actor} from './contracts.ts';
import {Domain} from './domain.ts';
import {foundationCommandPayloadSchemas,foundationCommandSchema,foundationEventForCommand} from './foundation-vocabulary.ts';
import type {FoundationCommand} from './foundation-vocabulary.ts';
import {Store} from './db.ts';
import {Game,checksum} from './game/engine.ts';

type ScopeInfo={type:'world'|'campaign';id:string;timelineId:string|null};
type StoredCommand={id:string;actor_id:string;request_hash:string;response_json:string|null};

export class FoundationAuthority{
 readonly store:Store;readonly domain:Domain;readonly game:Game;
 constructor(store:Store){this.store=store;this.domain=new Domain(store);this.game=new Game(store);}

 private async authorize(actor:Actor,command:FoundationCommand,scope:ScopeInfo){
  if(command.type==='StartCampaign'){await this.domain.access(actor,{type:'world',id:scope.id},true);return;}
  const timelineId=scope.timelineId!;
  if(['EditCharacter','CreateEvidence','TriggerWatcher'].includes(command.type)){await this.game.access(actor,timelineId,true);return;}
  if(command.type==='CreateCharacter'){
   const payload=foundationCommandPayloadSchemas.CreateCharacter.parse(command.payload);
   await this.game.access(actor,timelineId,Boolean(payload.definition));return;
  }
  if(['CreateSave','BranchTimeline'].includes(command.type)){
   const {access}=await this.game.access(actor,timelineId);ensure(access.role!=='observer',403,'forbidden');return;
  }
  const payload=command.payload as {characterId?:unknown};
  ensure(typeof payload.characterId==='string',400,'character_required');
  await this.game.authorizeCharacter(actor,timelineId,payload.characterId);
 }

 private async scope(command:FoundationCommand):Promise<ScopeInfo>{
  if(command.type==='StartCampaign'){
   const payload=foundationCommandPayloadSchemas.StartCampaign.parse(command.payload);
   return {type:'world',id:payload.worldId,timelineId:null};
  }
  const payload=foundationCommandPayloadSchemas[command.type].parse(command.payload) as {timelineId:string};
  const row=await this.store.get<{campaign_id:string}>('SELECT campaign_id FROM timelines WHERE id=? AND archived_at IS NULL',payload.timelineId);
  ensure(row,404,'timeline_unavailable');
  return {type:'campaign',id:row.campaign_id,timelineId:payload.timelineId};
 }

 private async replay(actor:Actor,command:FoundationCommand,scope:ScopeInfo,hash:string){
  const byId=await this.store.get<StoredCommand>('SELECT c.id,c.actor_id,c.request_hash,r.response_json FROM foundation_commands c LEFT JOIN foundation_command_receipts r ON r.command_id=c.id WHERE c.id=?',command.commandId);
  if(byId){
   ensure(byId.actor_id===actor.id&&byId.request_hash===hash,409,'command_id_conflict');
   ensure(byId.response_json,409,'command_incomplete');
   return JSON.parse(byId.response_json);
  }
  const byKey=await this.store.get<StoredCommand>('SELECT c.id,c.actor_id,c.request_hash,r.response_json FROM foundation_commands c LEFT JOIN foundation_command_receipts r ON r.command_id=c.id WHERE c.scope_type=? AND c.scope_id=? AND c.actor_id=? AND c.idempotency_key=?',scope.type,scope.id,actor.id,command.idempotencyKey);
  if(!byKey)return;
  ensure(byKey.request_hash===hash,409,'idempotency_conflict');
  ensure(byKey.response_json,409,'command_incomplete');
  return JSON.parse(byKey.response_json);
 }

 private async run(actor:Actor,command:FoundationCommand):Promise<Record<string,unknown>>{
  const revision=command.expectedRevision;
  switch(command.type){
   case 'StartCampaign':{
    const p=foundationCommandPayloadSchemas.StartCampaign.parse(command.payload);
    return this.domain.createCampaign(actor,{worldId:p.worldId,name:p.name,startingAt:p.startingAt,timezone:p.timezone,configuration:p.configuration},command.idempotencyKey);
   }
   case 'CreateCharacter':{
    const p=foundationCommandPayloadSchemas.CreateCharacter.parse(command.payload);
    return this.game.start(actor,p.timelineId,{revision:revision!,packageId:p.packageId,definition:p.definition},command.idempotencyKey);
   }
   case 'EditCharacter':{
    const p=foundationCommandPayloadSchemas.EditCharacter.parse(command.payload);
    return this.game.edit(actor,p.timelineId,{revision:revision!,entity:p.entity},command.idempotencyKey);
   }
   case 'AdvanceWorldTime':{
    const p=foundationCommandPayloadSchemas.AdvanceWorldTime.parse(command.payload);
    return this.game.turn(actor,p.timelineId,{revision:revision!,characterId:p.characterId,action:{type:'wait',minutes:p.minutes}},command.idempotencyKey);
   }
   case 'MoveActor':{
    const p=foundationCommandPayloadSchemas.MoveActor.parse(command.payload);
    return this.game.turn(actor,p.timelineId,{revision:revision!,characterId:p.characterId,action:{type:'travel',destinationId:p.destinationId,mode:p.mode,vehicleId:p.vehicleId}},command.idempotencyKey);
   }
   case 'TransferItem':{
    const p=foundationCommandPayloadSchemas.TransferItem.parse(command.payload);
    return this.game.turn(actor,p.timelineId,{revision:revision!,characterId:p.characterId,action:{type:'give',itemId:p.itemId,toId:p.toId}},command.idempotencyKey);
   }
   case 'AddContact':{
    const p=foundationCommandPayloadSchemas.AddContact.parse(command.payload);
    return this.game.turn(actor,p.timelineId,{revision:revision!,characterId:p.characterId,action:{type:'add-contact',phoneId:p.phoneId,contactId:p.contactId,label:p.label}},command.idempotencyKey);
   }
   case 'SendText':{
    const p=foundationCommandPayloadSchemas.SendText.parse(command.payload);
    return this.game.turn(actor,p.timelineId,{revision:revision!,characterId:p.characterId,action:{type:'message',phoneId:p.phoneId,toId:p.toId,text:p.text,medium:'sms'}},command.idempotencyKey);
   }
   case 'StartConversation':{
    const p=foundationCommandPayloadSchemas.StartConversation.parse(command.payload);
    return this.game.turn(actor,p.timelineId,{revision:revision!,characterId:p.characterId,action:{type:'conversation',targetId:p.targetId,text:p.text}},command.idempotencyKey);
   }
   case 'ResolveCheck':{
    const p=foundationCommandPayloadSchemas.ResolveCheck.parse(command.payload);
    return this.game.turn(actor,p.timelineId,{revision:revision!,characterId:p.characterId,action:{type:'check',attribute:p.attribute,skillId:p.skillId,checkId:p.checkId,context:p.context}},command.idempotencyKey);
   }
   case 'StartCombat':{
    const p=foundationCommandPayloadSchemas.StartCombat.parse(command.payload);
    return this.game.turn(actor,p.timelineId,{revision:revision!,characterId:p.characterId,action:{type:'combat',targetId:p.targetId}},command.idempotencyKey);
   }
   case 'CreateEvidence':{
    const p=foundationCommandPayloadSchemas.CreateEvidence.parse(command.payload);
    ensure(typeof p.entity==='object'&&p.entity!==null&&'kind' in p.entity&&p.entity.kind==='evidence',400,'evidence_entity_required');
    return this.game.edit(actor,p.timelineId,{revision:revision!,entity:p.entity},command.idempotencyKey);
   }
   case 'TriggerWatcher':{
    const p=foundationCommandPayloadSchemas.TriggerWatcher.parse(command.payload);
    return this.game.triggerWatcher(actor,p.timelineId,revision!,p.watcherId,command.idempotencyKey);
   }
   case 'CreateSave':{
    const p=foundationCommandPayloadSchemas.CreateSave.parse(command.payload),{t}=await this.game.access(actor,p.timelineId);
    ensure(t.revision===revision,409,'revision_conflict');
    return this.game.save(actor,p.timelineId,p.name);
   }
   case 'BranchTimeline':{
    const p=foundationCommandPayloadSchemas.BranchTimeline.parse(command.payload),{t}=await this.game.access(actor,p.timelineId);
    ensure(t.revision===revision,409,'revision_conflict');
    return this.game.branch(actor,p.timelineId,p.saveId,p.name);
   }
  }
 }

 async execute(actor:Actor,raw:unknown){
  const command=foundationCommandSchema.parse(raw),scope=await this.scope(command),requestHash=checksum(command);
  return this.store.transaction(async()=>{
   await this.authorize(actor,command,scope);
   const replay=await this.replay(actor,command,scope,requestHash);if(replay)return replay;
   if(scope.timelineId)ensure(command.aggregateId===null||command.aggregateId===scope.timelineId,400,'aggregate_scope_mismatch');
   const createdAt=new Date().toISOString();
   await this.store.run(
    'INSERT INTO foundation_commands VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    command.commandId,1,command.type,actor.id,scope.type,scope.id,scope.timelineId,command.aggregateId,
    command.expectedRevision,command.idempotencyKey,requestHash,JSON.stringify(command.payload),createdAt
   );
   const outcome=await this.run(actor,command);
   const sourceEventId=typeof outcome.eventId==='string'?outcome.eventId:null;
   let random:{seed:string;rng_version?:string}|undefined;
   if(sourceEventId){
    random=await this.store.get<{seed:string;rng_version?:string}>('SELECT seed,rng_version FROM domain_events WHERE id=?',sourceEventId);
    random??=await this.store.get<{seed:string}>('SELECT seed FROM game_events WHERE id=?',sourceEventId);
   }
   const eventId=randomUUID(),seed=random?.seed??randomBytes(32).toString('hex');
   const eventScope:ScopeInfo=command.type==='StartCampaign'
    ?{type:'campaign',id:String(outcome.id),timelineId:null}:scope;
   const aggregateId=this.aggregate(command,scope,outcome);
   const aggregateRevision=await this.revision(eventScope,outcome);
   await this.store.run(
    'INSERT INTO foundation_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    eventId,1,command.commandId,foundationEventForCommand[command.type],actor.id,eventScope.type,eventScope.id,
    eventScope.timelineId,aggregateId,aggregateRevision,sourceEventId,JSON.stringify(outcome),seed,
    random?.rng_version??'hmac-sha256-v1',createdAt
   );
   const response={commandId:command.commandId,eventId,type:foundationEventForCommand[command.type],outcome};
   await this.store.run('INSERT INTO foundation_command_receipts VALUES (?,?,?,?)',command.commandId,eventId,JSON.stringify(response),createdAt);
   return response;
  });
 }

 private aggregate(command:FoundationCommand,scope:ScopeInfo,outcome:Record<string,unknown>){
  for(const key of ['characterId','entityId','watcherId','id'])if(typeof outcome[key]==='string')return String(outcome[key]);
  return command.aggregateId??scope.timelineId??scope.id;
 }
 private async revision(scope:ScopeInfo,outcome:Record<string,unknown>){
  if(typeof outcome.revision==='number')return outcome.revision;
  if(scope.timelineId)return (await this.store.get<{revision:number}>('SELECT revision FROM timelines WHERE id=?',scope.timelineId))!.revision;
  return (await this.store.get<{revision:number}>('SELECT revision FROM campaigns WHERE id=?',scope.id))!.revision;
 }
}
