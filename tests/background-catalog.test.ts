import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {backgroundSkillNames,skillNames} from '../src/game/catalog.ts';
import {data,validateEntity,validateState} from '../src/game/model.ts';
import {ORIGINS,applyStartingGrants,startingBudget} from '../public/creation-rules.js';

test('every background has selectable, free training before any catalog installation',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id);
  const options=await game.creationOptions(f.player,timeline.id);
  for(const background of ORIGINS){
   const character={playable:true,background:{option1:background.id},skills:{} as Record<string,number>,attributes:{Strength:10}};
   applyStartingGrants(character,options.entities);
   for(const [name,fraction] of Object.entries(background.skills)){
    const skill=options.entities.find(row=>row.kind==='skill'&&row.name===name);
    assert.ok(skill,background.name+' is missing '+name);
    assert.ok(skillNames.includes(name));
    assert.equal(character.skills[skill.id],fraction*100,background.name+' / '+name);
   }
   assert.equal(startingBudget(character,options.entities).skills,0);
   assert.deepEqual(character.attributes,{Strength:10});
   assert.deepEqual(background.modifiers,{});
  }
  const pkg=await game.createStartPackage(f.creator,timeline.id,{name:'Backgrounds',slug:'backgrounds',kind:'guided',visibility:'campaign',status:'published',definition:{character:{name:'Subject',data:{}}}},key());
  const result=await game.start(f.player,timeline.id,{revision:1,packageId:pkg.id,choices:{background:{option1:'doctor',option2:'surgeon',option3:'bartender',option4:'auto-mechanic'}}},key());
  const saved=await game.load(timeline.id),character=data(saved.entities.find(row=>row.id===result.characterId)!,'character');
  for(const name of ['Medicine','Surgery','Bartending','Auto repair']){
   const skill=options.entities.find(row=>row.name===name)!;
   assert.equal(character.skills[skill.id],50,name);
  }
  assert.equal(startingBudget(character,saved.entities).skills,0);
  assert.doesNotThrow(()=>validateState(saved));
 }finally{await f.close();}
});

test('older worlds gain missing background skills without replacing customized or unpublished records',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id);
  // Reproduce a pre-expansion catalog, including deliberate Creator overrides.
  await f.store.run("DELETE FROM game_entities WHERE timeline_id=? AND kind='skill'",timeline.id);
  const custom=validateEntity({id:randomUUID(),kind:'skill',name:'Medicine',visibility:'campaign',data:{description:'Custom medical rules',scale:{min:-10,max:30,step:1}}});
  const hidden=validateEntity({id:randomUUID(),kind:'skill',name:'Surgery',visibility:'creator',data:{description:'Private surgery'}});
  const archived=validateEntity({id:randomUUID(),kind:'skill',name:'Bartending',visibility:'campaign',archived:true,data:{description:'Retired bartending'}});
  for(const entity of [custom,hidden,archived])await f.store.run('INSERT INTO game_entities(timeline_id,id,kind,name,visibility,data_json,created_at,updated_at,archived_at) VALUES (?,?,?,?,?,?,?,?,?)',timeline.id,entity.id,entity.kind,entity.name,entity.visibility,JSON.stringify(entity.data),new Date().toISOString(),new Date().toISOString(),entity.archived?new Date().toISOString():null);
  const sql=readFileSync(new URL('../migrations/052_background_skills.sql',import.meta.url),'utf8');
  await f.store.exec(sql);await f.store.exec(sql);
  const saved=await game.load(timeline.id);
  for(const name of backgroundSkillNames)assert.equal(saved.entities.filter(row=>row.kind==='skill'&&row.name===name).length,1,name);
  for(const entity of [custom,hidden,archived])assert.deepEqual(saved.entities.find(row=>row.id===entity.id),entity);
  const options=await game.creationOptions(f.player,timeline.id);
  assert.ok(options.entities.some(row=>row.name==='Auto repair'));
  assert.equal(options.entities.some(row=>row.name==='Surgery'||row.name==='Bartending'),false);
  const character={background:{option1:'doctor'},skills:{} as Record<string,number>};
  applyStartingGrants(character,options.entities);assert.equal(character.skills[custom.id],10);
  assert.doesNotThrow(()=>validateState(saved));
 }finally{await f.close();}
});
