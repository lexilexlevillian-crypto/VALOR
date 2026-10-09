import {test} from 'node:test';
import assert from 'node:assert/strict';
import {skillNames,traitGroups} from '../src/game/catalog.ts';
import {stockSkill,stockTrait,skillStatus,skillPointCost} from '../public/creation-rules.js';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';

test('Medicine retains trained bonuses for legacy stock descriptions without changing custom skills',()=>{
 const stock=stockSkill('Medicine')!;
 const skill={id:'medicine',kind:'skill',name:'Medicine',data:{description:stock.description}};
 assert.match(stock.description,/Clinical knowledge/);
 assert.equal(skillStatus(skill,49).checkBonus,0);
 assert.equal(skillStatus(skill,50).checkBonus,2);
 assert.equal(skillStatus({...skill,data:{description:stock.legacyDescription}},50).checkBonus,2);
 assert.equal(skillStatus({...skill,data:{description:'Custom Medicine'}},100).checkBonus,0);
 assert.equal(skillPointCost(skill,0),0);
 assert.equal(skillPointCost(skill,50),2.5);
 assert.equal(skillPointCost(skill,100),5);
 assert.equal(skillPointCost(skill,50,50),0);
 assert.equal(skillPointCost(skill,70,50),1);
 assert.equal(skillPointCost(skill,0,50),0);
 const scaled={...skill,data:{scale:{min:-10,max:30,step:1}}};
 assert.equal(skillPointCost(scaled,10),2.5);
 assert.equal(skillPointCost(scaled,30,10),2.5);
});

test('expanded stock catalog installs scoped training, attribute effects, costs and opposing traits',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id);
  await game.installCatalog(f.creator,timeline.id,1,key());
  const state=await game.load(timeline.id);
  const find=(name:string,kind:string)=>state.entities.find(e=>e.name===name&&e.kind===kind)!;
  assert.equal(new Set(skillNames).size,skillNames.length);
  const names=Object.values(traitGroups).flat();
  assert.equal(new Set(names).size,names.length);
  for(const name of ['Clinical assessment','Emergency medicine','Anatomy','Medical research','Physical therapy','Medical imaging','Laboratory diagnostics','Nutrition','Electronics repair','Radio operation','Technical writing','Wilderness first aid']){
   const skill=find(name,'skill');assert.ok(skill);
   assert.equal(skill.data.description,stockSkill(name)!.description);
   assert.equal(skillStatus(skill,50).checkBonus,2);
  }
  for(const [name,attribute,value,cost] of [
   ['Dexterous','Agility',2,4],['Unsteady hands','Agility',-1,-2],
   ['Quick recovery from exertion','Endurance',1,2],['Low stamina','Endurance',-2,-4],
   ['Analytical','Intellect',2,4],['Detail-oriented','Perception',1,2],
   ['Focused','Will',1,2],['Absent-minded','Perception',-1,-2],
   ['Composed','Will',2,4],['Easily rattled','Will',-2,-4],
   ['Tactful','Presence',1,2],['Abrasive','Presence',-1,-2]
  ] as const){
   const trait=find(name,'trait');assert.ok(trait);
   assert.equal(trait.data.cost,cost);assert.deepEqual(trait.data.modifiers,{[attribute]:value});
   assert.equal(trait.data.description,stockTrait(name)!.description);
  }
  for(const [name,skillName] of [['Clinical training','Clinical assessment'],['Emergency care training','Emergency medicine'],['Laboratory training','Laboratory diagnostics'],['Field medic training','Wilderness first aid']]){
   const trait=find(name!,'trait'),skill=find(skillName!,'skill');assert.ok(trait&&skill);
   assert.equal(trait.data.cost,2);
   assert.deepEqual(trait.data.skillGrants,[{skillId:skill.id,fraction:.5}]);
   assert.ok((trait.data.scopedCheckModifiers as {skillId:string;value:number}[]).some(m=>m.skillId===skill.id&&m.value===2));
  }
  assert.ok((find('Dexterous','trait').data.opposes as string[]).includes(find('Unsteady hands','trait').id));
  assert.ok((find('Unsteady hands','trait').data.opposes as string[]).includes(find('Dexterous','trait').id));
  await game.installCatalog(f.creator,timeline.id,2,key());
  const refreshed=await game.load(timeline.id);
  assert.equal(refreshed.entities.filter(e=>e.name==='Clinical training').length,1);
  assert.equal(refreshed.entities.find(e=>e.name==='Clinical training')!.id,find('Clinical training','trait').id);
 }finally{await f.close();}
});
