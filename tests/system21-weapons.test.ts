import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {actionSchema,data,settingsSchema,validateEntity,validateState} from '../src/game/model.ts';
import type {Entity,State} from '../src/game/model.ts';
import {resolveAction} from '../src/game/actions.ts';
import {reviewMechanicalClaims} from '../src/game/context.ts';
import {weaponState} from '../src/game/weapons.ts';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';

const eventId='cccccccc-cccc-4ccc-8ccc-cccccccccccc',seed='3'.repeat(64);
const make=(kind:Entity['kind'],name:string,raw:Record<string,unknown>={},visibility:Entity['visibility']='campaign')=>validateEntity({id:randomUUID(),kind,name,visibility,data:raw});
const state=(entities:Entity[],mode:'abstracted'|'modeled'='abstracted'):State=>({clock:'2012-06-01T12:00:00.000Z',settings:settingsSchema.parse({weapons:{chamberMode:mode}}),entities,facts:[],knowledge:[],beliefs:[],memories:[],eventIds:[]});
const act=(s:State,actorId:string,raw:unknown)=>resolveAction(s,actorId,actionSchema.parse(raw),eventId,seed);

test('individual firearms retain identity, authored compatibility, magazine identity, chamber state, attachments, and maintenance state',()=>{
 const owner=make('character','Owner'),magazine=make('item','Magazine A',{category:'magazine',ownerId:owner.id,possessorId:owner.id,serial:'MAG-A',caliber:'9mm',magazineFamily:'P99',magazine:15,loaded:4,ammoType:'FMJ'}),optic=make('item','Optic',{ownerId:owner.id,possessorId:owner.id,tags:['weapon-attachment'],serial:'OPT-7'}),gun=make('item','Pistol',{category:'firearm',ownerId:owner.id,possessorId:owner.id,serial:'SER-21',markings:['agency rack 4'],caliber:'9mm',weaponFamily:'Pistol',compatibleAmmoTypes:['FMJ','JHP'],compatibleMagazineFamilies:['P99'],installedMagazineId:magazine.id,chamberState:'loaded',chamberAmmoType:'JHP',condition:83,malfunction:'failure-to-feed',attachmentIds:[optic.id],carryState:'holstered',lastMaintainedAt:'2012-05-01T12:00:00.000Z',shotsSinceMaintenance:12}),s=state([owner,magazine,optic,gun],'modeled');
 validateState(s);const view=weaponState(s,gun);assert.equal(view.serial,'SER-21');assert.equal(view.magazine.id,magazine.id);assert.equal(view.magazine.capacity,15);assert.equal(view.chamber?.state,'loaded');assert.equal(view.totalRounds,5);assert.equal(view.malfunction,'failure-to-feed');assert.deepEqual(view.attachments,[optic.id]);
});

test('reload conserves compatible ammunition and rejects incompatible ammunition atomically',()=>{
 const room=make('location','Room'),owner=make('character','Owner',{locationId:room.id}),magazine=make('item','P99 magazine',{category:'magazine',ownerId:owner.id,possessorId:owner.id,caliber:'9mm',magazineFamily:'P99',magazine:10}),gun=make('item','Pistol',{category:'firearm',ownerId:owner.id,possessorId:owner.id,caliber:'9mm',weaponFamily:'Pistol',compatibleAmmoTypes:['FMJ'],compatibleMagazineFamilies:['P99'],magazine:0,chamberState:'empty'}),ammo=make('item','9mm FMJ',{category:'ammo',ownerId:owner.id,possessorId:owner.id,caliber:'9mm',ammoType:'FMJ',quantity:15}),wrong=make('item','.45 ACP',{category:'ammo',ownerId:owner.id,possessorId:owner.id,caliber:'.45',ammoType:'FMJ',quantity:6}),s=state([room,owner,magazine,gun,ammo,wrong],'modeled');
 assert.throws(()=>act(s,owner.id,{type:'reload',weaponId:gun.id,ammoId:wrong.id}),/incompatible_ammunition/);assert.equal(data(wrong,'item').quantity,6);assert.equal(data(gun,'item').loaded,0);
 act(s,owner.id,{type:'load-magazine',magazineId:magazine.id,ammoId:ammo.id,quantity:8});assert.equal(data(ammo,'item').quantity,7);assert.equal(data(magazine,'item').loaded,8);
 act(s,owner.id,{type:'reload',weaponId:gun.id,magazineId:magazine.id});assert.equal(data(gun,'item').installedMagazineId,magazine.id);assert.equal(data(gun,'item').chamberState,'loaded');assert.equal(data(magazine,'item').loaded,7);assert.equal(data(ammo,'item').quantity+data(magazine,'item').loaded+1,15);assert.ok(data(gun,'item').eventHistory.some(entry=>entry.action==='loaded'));validateState(s);
});

test('carry transfer moves the installed magazine, and weapon concealment requires a physical context',()=>{
 const room=make('location','Room'),owner=make('character','Owner',{locationId:room.id}),recipient=make('character','Recipient',{locationId:room.id}),coat=make('item','Long coat',{category:'clothing',ownerId:owner.id,possessorId:owner.id,equipped:true,wearState:'worn',capacity:4}),magazine=make('item','Magazine',{category:'magazine',ownerId:owner.id,possessorId:owner.id,caliber:'9mm',magazineFamily:'P99',magazine:10,loaded:3}),gun=make('item','Pistol',{category:'firearm',ownerId:owner.id,possessorId:owner.id,caliber:'9mm',compatibleMagazineFamilies:['P99'],installedMagazineId:magazine.id,carryState:'held'}),s=state([room,owner,recipient,coat,magazine,gun]);
 assert.throws(()=>act(s,owner.id,{type:'conceal',itemId:gun.id,concealed:true}),/concealment_context_required/);act(s,owner.id,{type:'conceal',itemId:gun.id,concealed:true,contextId:coat.id});assert.equal(data(gun,'item').concealmentContextId,coat.id);assert.ok(data(gun,'item').concealment>0);
 act(s,owner.id,{type:'transfer-item',itemId:gun.id,toId:recipient.id,transferOwnership:false});assert.equal(data(gun,'item').possessorId,recipient.id);assert.equal(data(gun,'item').ownerId,owner.id);assert.equal(data(gun,'item').concealed,false);assert.equal(data(magazine,'item').possessorId,recipient.id);assert.equal(data(magazine,'item').ownerId,owner.id);validateState(s);
});

test('shots, empty clicks, casings, injury evidence, and degradable coverage are emitted mechanical results',()=>{
 const room=make('location','Range'),skill=make('skill','Pistol'),shooter=make('character','Shooter',{playable:true,locationId:room.id,attributes:{Strength:50,Agility:100,Endurance:50,Intellect:50,Perception:100,Presence:50,Will:50},skills:{[skill.id]:100}}),target=make('character','Target',{locationId:room.id,attributes:{Strength:0,Agility:0,Endurance:0,Intellect:0,Perception:0,Presence:0,Will:0}}),gun=make('item','Pistol',{category:'firearm',ownerId:shooter.id,possessorId:shooter.id,equipped:true,carryState:'held',caliber:'9mm',ammoType:'FMJ',weaponFamily:'Pistol',chamberState:'loaded',chamberAmmoType:'FMJ',condition:100}),armor=make('item','Vest',{category:'armor',ownerId:target.id,possessorId:target.id,equipped:true,wearState:'worn',coverage:['torso'],protection:4,protectionClass:'IIA',condition:100}),s=state([room,skill,shooter,target,gun,armor],'modeled');
 s.settings.rules={dieSides:6,threshold:1,damage:10,treatmentMinutes:1,recoveryPerDay:1,unfamiliarPenalty:20,bleedPerMinute:0,formula:'additive-no-die',outcomeMode:'legacy-binary',outcomeBands:{criticalMargin:10,successAtCostMargin:2,partialFailureMargin:-2,failureInformationMargin:-10}};s.settings.weapons.conditionLossPerShot=1;s.settings.weapons.armorConditionLossPerHit=5;
 act(s,shooter.id,{type:'combat',targetId:target.id});const fired=act(s,shooter.id,{type:'attack',targetId:target.id,weaponId:gun.id,bodyPart:'torso'});assert.ok(fired.effects.some(effect=>effect.type==='weapon.shot'));assert.equal(data(gun,'item').condition,99);assert.equal(data(gun,'item').shotsSinceMaintenance,1);assert.equal(data(armor,'item').condition,95);
 const casing=s.entities.find(entity=>entity.kind==='evidence'&&entity.data.sourceEventId===eventId)!;assert.ok(casing);const injury=s.entities.find(entity=>entity.kind==='injury'&&entity.data.characterId===target.id)!;assert.equal(data(injury,'injury').severity,6);assert.ok(s.facts.some(entry=>entry.predicate==='injury'&&entry.evidenceIds?.includes(casing.id)));assert.ok(data(gun,'item').eventHistory.some(entry=>entry.action==='shot'));
 const combat=s.entities.find(entity=>entity.kind==='combat')!,combatState=data(combat,'combat');combatState.turnIndex=combatState.participants.indexOf(shooter.id);combat.data=combatState;const click=act(s,shooter.id,{type:'attack',targetId:target.id,weaponId:gun.id,bodyPart:'torso'});assert.ok(click.effects.some(effect=>effect.type==='weapon.empty-click'));assert.ok(data(gun,'item').eventHistory.some(entry=>entry.action==='empty-click'));assert.equal(s.entities.filter(entity=>entity.kind==='evidence').length,1);validateState(s);
});

test('narration cannot claim weapon mechanics that were not emitted',()=>{
 assert.deepEqual(reviewMechanicalClaims('He fires the pistol and a spent casing lands nearby.',[]).map(flag=>flag.value),['shot','casing']);
 assert.deepEqual(reviewMechanicalClaims('She reloads the firearm.',[{id:randomUUID(),text:'Magazine installed.',observers:[],type:'weapon.reload',subjectId:randomUUID()}]),[]);
 assert.equal(reviewMechanicalClaims('The weapon is disarmed.',[])[0]?.value,'disarmed-weapon');
 assert.equal(reviewMechanicalClaims('An empty click follows.',[])[0]?.value,'empty-click');
});

test('shot history and casing evidence survive save and branch restoration',async()=>{
 const f=await fixture(),game=new Game(f.store);try{
  const timeline=await game.initialize(f.creator,f.campaign.id),room=make('location','Range'),skill=make('skill','Pistol'),shooter=make('character','Shooter',{playable:true,controllerUserId:f.player.id,locationId:room.id,attributes:{Strength:30,Agility:100,Endurance:30,Intellect:30,Perception:100,Presence:30,Will:30},skills:{[skill.id]:100}},'owner'),target=make('character','Target',{locationId:room.id}),gun=make('item','Serialized pistol',{category:'firearm',ownerId:shooter.id,possessorId:shooter.id,equipped:true,carryState:'held',serial:'SAVE-21',caliber:'9mm',weaponFamily:'Pistol',magazine:1,loaded:1},'owner');
  await game.bulkEdit(f.creator,timeline.id,{revision:1,entities:[room,skill,shooter,target,gun]},key());const current=(await game.load(timeline.id)).settings,revision=(await game.access(f.creator,timeline.id)).t.revision;await game.configure(f.creator,timeline.id,revision,settingsSchema.parse({...current,rules:{dieSides:6,threshold:1,damage:10,treatmentMinutes:1,recoveryPerDay:1,unfamiliarPenalty:20,bleedPerMinute:0,formula:'additive-no-die',outcomeMode:'legacy-binary',outcomeBands:{criticalMargin:10,successAtCostMargin:2,partialFailureMargin:-2,failureInformationMargin:-10}}}),key());
  let playerRevision=(await game.access(f.player,timeline.id)).t.revision;await game.turn(f.player,timeline.id,{revision:playerRevision,characterId:shooter.id,action:actionSchema.parse({type:'combat',targetId:target.id})},key());playerRevision=(await game.access(f.player,timeline.id)).t.revision;const turn=await game.turn(f.player,timeline.id,{revision:playerRevision,characterId:shooter.id,action:actionSchema.parse({type:'attack',targetId:target.id,weaponId:gun.id,bodyPart:'torso'})},key());
  const before=await game.load(timeline.id),casing=before.entities.find(entity=>entity.kind==='evidence'&&entity.data.sourceEventId===turn.eventId);assert.ok(casing);assert.ok(data(before.entities.find(entity=>entity.id===gun.id)!,'item').eventHistory.some(entry=>entry.action==='shot'&&entry.eventId===turn.eventId));
  const save=await game.save(f.player,timeline.id,'Firearm evidence'),branch=await game.branch(f.player,timeline.id,save.id,'Firearm evidence branch'),restored=await game.load(branch.id),restoredGun=restored.entities.find(entity=>entity.id===gun.id)!;assert.ok(restored.entities.some(entity=>entity.id===casing.id&&entity.kind==='evidence'));assert.ok(data(restoredGun,'item').eventHistory.some(entry=>entry.action==='shot'&&entry.eventId===turn.eventId));validateState(restored);
 }finally{await f.close();}
});
