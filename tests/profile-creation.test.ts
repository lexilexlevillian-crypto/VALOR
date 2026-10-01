import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {data,validateEntity,validateState,settingsSchema} from '../src/game/model.ts';
import type {State} from '../src/game/model.ts';
import {automaticTraitNames,HEIGHTS,residencePlan,playerFloors} from '../public/profile-rules.js';
import {geography} from '../src/game/geography.ts';
import {prepareAppearance} from '../src/game/profile-creation.ts';
import {observerView} from '../src/game/epistemics.ts';
test('height bounds and inclusive neutral band derive correct physical traits',()=>{
 assert.equal(HEIGHTS[0]!.inches,51);assert.equal(HEIGHTS.at(-1)!.inches,96);
 for(const [inches,wanted]of [[51,'Short'],[64,'Short'],[65,''],[71,''],[72,'Tall'],[96,'Tall']] as const)assert.deepEqual(automaticTraitNames({heightCm:inches*2.54}),wanted?[wanted]:[]);
 assert.deepEqual(automaticTraitNames({heightCm:180.34,build:'Muscular'}),['Muscular']);
 const s:State={clock:'2012-01-01T00:00:00Z',settings:settingsSchema.parse({}),entities:[],facts:[],knowledge:[],beliefs:[],memories:[]};
 for(const height of [50*2.54,97*2.54]){const c=data(validateEntity({id:randomUUID(),kind:'character',name:'Invalid',visibility:'campaign',data:{heightCm:height}}),'character');assert.throws(()=>prepareAppearance(s,c),/height_must/);}
 const legacy=data(validateEntity({id:randomUUID(),kind:'character',name:'Legacy metric height',visibility:'campaign',data:{heightCm:175}}),'character');prepareAppearance(s,legacy);assert.equal(legacy.heightCm,175);
 assert.deepEqual(playerFloors(residencePlan('North Crowns')!),[2,3]);
 assert.ok(playerFloors(residencePlan('Gateway')!).every(f=>f>1&&f<12));
 assert.ok(playerFloors(residencePlan('First Harbor')!).every(f=>f>1&&f<20));
});
test('birthplace directory is local, bounded and includes nationalities and city coordinates',async()=>{
 const countries=await geography({});assert.ok(countries.countries!.length>=240);assert.ok(countries.countries!.find(c=>c.code==='US')!.nationality.includes('American'));
 const states=await geography({country:'US'});assert.ok(states.states!.some(s=>s.code==='WA'));
 const cities=await geography({country:'US',state:'WA',q:'Seattle'});assert.ok(cities.cities!.some(c=>c.name==='Seattle'&&c.latitude&&c.longitude));
 await assert.rejects(()=>geography({country:'../'}));await assert.rejects(()=>geography({country:'US',state:'no-such-state'}));
});
test('player home, appearance traits and NPC apartment reservations are persisted and private',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const t=await game.initialize(f.creator,f.campaign.id);await game.installCatalog(f.creator,t.id,1,key());
  const catalog=await game.load(t.id);for(const name of ['Explosives','Drug production','Swimming','Muscular'])assert.ok(catalog.entities.some(e=>e.name===name));
  const npc=validateEntity({id:randomUUID(),kind:'character',name:'Neighbor',visibility:'campaign',data:{originNeighborhood:'North Crowns',residence:{neighborhood:'North Crowns',floor:3,apartment:'302'},heightCm:162.56,build:'Muscular'}});
  await game.bulkEdit(f.creator,t.id,{revision:2,entities:[npc]},key());
  let s=await game.load(t.id);const n=data(s.entities.find(e=>e.id===npc.id)!,'character');assert.equal(n.residence!.apartment,'302');assert.equal(n.locationId,n.homeId);assert.ok(n.traits.some(id=>s.entities.find(e=>e.id===id)?.name==='Short'));assert.ok(n.traits.some(id=>s.entities.find(e=>e.id===id)?.name==='Muscular'));
  const reserved=validateEntity({id:randomUUID(),kind:'character',name:'Reserved',visibility:'campaign',data:{originNeighborhood:'North Crowns',residence:{neighborhood:'North Crowns',floor:3,apartment:'301'}}});
  await assert.rejects(()=>game.edit(f.creator,t.id,{revision:3,entity:reserved},key()),/invalid_or_reserved_apartment/);
  const duplicate={...npc,id:randomUUID()};await assert.rejects(()=>game.edit(f.creator,t.id,{revision:3,entity:duplicate},key()),/apartment_already_occupied/);
  const pkg=await game.createStartPackage(f.creator,t.id,{name:'Profile start',slug:'profile-start',kind:'guided',visibility:'campaign',status:'published',definition:{character:{name:'Player',data:{}}}},key());
  const start=await game.start(f.player,t.id,{revision:3,packageId:pkg.id,choices:{profile:{heightCm:182.88,build:'Average',nationality:'American (United States)',ethnicityContext:'Mixed / multiple ethnicities',birthplace:'Seattle, Washington, United States',originNeighborhood:'North Crowns',residence:{neighborhood:'North Crowns'}}}},key());
  s=await game.load(t.id);const player=data(s.entities.find(e=>e.id===start.characterId)!,'character');
  assert.ok(['201','301'].includes(player.residence!.apartment));assert.equal(player.residence!.building,1);assert.equal(player.locationId,player.homeId);assert.equal(player.birthplace,'Seattle, Washington, United States');
  assert.ok(player.traits.some(id=>s.entities.find(e=>e.id===id)?.name==='Tall'));
  const view=observerView(s,start.characterId);assert.equal(view.entities.some(e=>e.id===n.homeId),false,'another apartment remains private');
  assert.doesNotThrow(()=>validateState(s));
  const previousHome=player.homeId;const edited={...s.entities.find(e=>e.id===start.characterId)!,data:{...player,notes:'No teleport'}};
  await game.edit(f.creator,t.id,{revision:4,entity:edited},key());assert.equal(data((await game.load(t.id)).entities.find(e=>e.id===start.characterId)!,'character').homeId,previousHome);
 }finally{await f.close();}
});
