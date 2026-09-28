import {createHash} from 'node:crypto';
import {data,getEntity} from './model.ts';
import type {Data,Entity,State} from './model.ts';

export type TraitEffectType=Data<'trait'>['effects'][number]['type'];
export type TraitEffectMatch={attribute?:string;skillId?:string|null;context?:string;planType?:string;need?:string;choiceId?:string;observerContext?:string};
export type ResolvedTraitEffect={traitId:string;traitName:string;effectId:string;effectName:string;type:TraitEffectType;key:string;value:number;operation:string;description:string};
export type TraitEffectResolution={applied:ResolvedTraitEffect[];suppressed:ResolvedTraitEffect[]};

const intersects=(left:string[],right:string[])=>!left.length||!right.length||left.some(value=>right.includes(value));
const scopeMatches=(scope:Data<'trait'>['effects'][number]['scope'],match:TraitEffectMatch)=>{
 const one=(values:string[],value:unknown)=>!values.length||typeof value==='string'&&values.includes(value);
 return one(scope.attributes,match.attribute)&&one(scope.skillIds,match.skillId)&&one(scope.contexts,match.context)&&one(scope.planTypes,match.planType)&&one(scope.needs,match.need)&&one(scope.choiceIds,match.choiceId)&&one(scope.observerContexts,match.observerContext);
};
const scopesOverlap=(a:Data<'trait'>['effects'][number]['scope'],b:Data<'trait'>['effects'][number]['scope'])=>
 intersects(a.attributes,b.attributes)&&intersects(a.skillIds,b.skillIds)&&intersects(a.contexts,b.contexts)&&intersects(a.planTypes,b.planTypes)&&intersects(a.needs,b.needs)&&intersects(a.choiceIds,b.choiceIds)&&intersects(a.observerContexts,b.observerContexts);

export function activeTraitEffects(s:State,characterId:string,type?:TraitEffectType){
 const character=data(getEntity(s,characterId,'character'),'character'),selected=new Set(character.traits);
 const rows:Array<{trait:Entity;effect:Data<'trait'>['effects'][number]}> = [];
 for(const traitId of character.traits){
  const trait=getEntity(s,traitId,'trait'),definition=data(trait,'trait');
  for(const effect of definition.effects)rows.push({trait,effect});
  for(const combination of definition.combinations)if(combination.traitIds.every(id=>selected.has(id)))for(const effect of combination.effects)rows.push({trait,effect:{...effect,name:combination.name+' / '+effect.name}});
 }
 return type?rows.filter(row=>row.effect.type===type):rows;
}

export function resolveTraitEffects(s:State,characterId:string,type:TraitEffectType,match:TraitEffectMatch={}):TraitEffectResolution{
 const rows=activeTraitEffects(s,characterId,type).filter(row=>scopeMatches(row.effect.scope,match)).sort((a,b)=>a.trait.id.localeCompare(b.trait.id)||a.effect.id.localeCompare(b.effect.id));
 const applied:ResolvedTraitEffect[]=[],suppressed:ResolvedTraitEffect[]=[];
 const mapped=(row:typeof rows[number]):ResolvedTraitEffect=>({traitId:row.trait.id,traitName:row.trait.name,effectId:row.effect.id,effectName:row.effect.name,type:row.effect.type,key:row.effect.key,value:row.effect.value,operation:row.effect.operation,description:row.effect.description});
 const groups=new Map<string,typeof rows>();
 for(const row of rows){const key=row.effect.type+':'+row.effect.key,group=groups.get(key)??[];group.push(row);groups.set(key,group);}
 for(const group of groups.values()){
  if(group.length===1){applied.push(mapped(group[0]!));continue;}
  if(group.some(row=>row.effect.conflictBehavior==='reject'))throw new Error('trait_effect_conflict');
  if(group.every(row=>row.effect.stackingRule==='stack')){applied.push(...group.map(mapped));continue;}
  const rule=group.find(row=>row.effect.stackingRule!=='stack')!.effect.stackingRule;
  const chosen=rule==='highest'?group.reduce((best,row)=>row.effect.value>best.effect.value?row:best):
   rule==='lowest'?group.reduce((best,row)=>row.effect.value<best.effect.value?row:best):
   group.some(row=>row.effect.conflictBehavior==='replace')?group.at(-1)!:group[0]!;
  applied.push(mapped(chosen));suppressed.push(...group.filter(row=>row!==chosen).map(mapped));
 }
 return {applied,suppressed};
}

export function traitBalance(s:State,traitIds:string[],budget=s.settings.traitBudget){
 let advantageCost=0,disadvantageCredit=0,advantages=0,disadvantages=0;
 for(const traitId of traitIds){
  const trait=data(getEntity(s,traitId,'trait'),'trait');if(trait.mode!=='costed')continue;
  const balance=trait.balance==='neutral'?(trait.cost>0?'advantage':trait.cost<0?'disadvantage':'neutral'):trait.balance;
  if(balance==='advantage'){advantageCost+=trait.cost;advantages++;}
  if(balance==='disadvantage'){disadvantageCredit+=Math.abs(trait.cost);disadvantages++;}
 }
 const policy=s.settings.traitBalance,credit=policy.refundPolicy==='capped-current'?Math.min(disadvantageCredit,policy.disadvantageCreditCap):0;
 return {advantageCost,disadvantageCredit,appliedCredit:credit,netCost:Math.max(0,advantageCost-credit),advantages,disadvantages,budget};
}

export function validateTraitSelection(s:State,traitIds:string[],budget=s.settings.traitBudget){
 const selected=new Set(traitIds);if(selected.size!==traitIds.length)throw new Error('duplicate_traits');
 const balance=traitBalance(s,traitIds,budget),policy=s.settings.traitBalance;
 if(traitIds.length>policy.maxTraits)throw new Error('trait_count_cap');
 if(balance.advantages>policy.maxAdvantages)throw new Error('trait_advantage_cap');
 if(balance.disadvantages>policy.maxDisadvantages)throw new Error('trait_disadvantage_cap');
 if(balance.netCost>budget)throw new Error('trait_budget_exceeded');
 for(const traitId of traitIds){
  const trait=data(getEntity(s,traitId,'trait'),'trait');
  if(!trait.prerequisites.every(id=>selected.has(id))||trait.opposes.some(id=>selected.has(id)))throw new Error('trait_prerequisite_or_opposition');
 }
 const active=traitIds.flatMap(traitId=>{const entity=getEntity(s,traitId,'trait'),trait=data(entity,'trait'),effects=[...trait.effects,...trait.combinations.filter(combination=>combination.traitIds.every(id=>selected.has(id))).flatMap(combination=>combination.effects)];return effects.map(effect=>({entity,effect}));});
 for(let index=0;index<active.length;index++)for(let other=index+1;other<active.length;other++){
  const left=active[index]!,right=active[other]!;
  if(left.effect.type===right.effect.type&&left.effect.key===right.effect.key&&scopesOverlap(left.effect.scope,right.effect.scope)&&(left.effect.conflictBehavior==='reject'||right.effect.conflictBehavior==='reject'))throw new Error('trait_effect_conflict');
 }
 return balance;
}

export function choiceAccess(s:State,characterId:string,choiceId:string,context=''){
 const resolution=resolveTraitEffects(s,characterId,'choice',{choiceId,context});
 if(resolution.applied.some(effect=>effect.operation==='restrict'))return {allowed:false,reason:'trait_restricted',...resolution};
 if(resolution.applied.some(effect=>effect.operation==='unlock'))return {allowed:true,reason:'trait_unlocked',...resolution};
 return {allowed:true,reason:'no_trait_restriction',...resolution};
}

export function socialPresentationDescriptors(s:State,characterId:string,observerContext:string){
 return resolveTraitEffects(s,characterId,'first-impression',{observerContext}).applied.map(effect=>({descriptor:effect.description,traitId:effect.traitId,effectId:effect.effectId}));
}

const fraction=(seed:string,index:number)=>Number.parseInt(createHash('sha256').update(seed+':'+index).digest('hex').slice(0,13),16)/0x10000000000000;
export function generateNpcTraitSelection(s:State,templateId:string,seed:string){
 const template=data(getEntity(s,templateId,'traitTemplate'),'traitTemplate'),selected:string[]=[];
 const add=(traitId:string)=>{
  if(selected.includes(traitId)||template.excludedTraitIds.includes(traitId))return false;
  const trait=data(getEntity(s,traitId,'trait'),'trait');
  if(!trait.generation.requiresBackgroundTags.every(tag=>template.backgroundTags.includes(tag)))return false;
  const next=[...selected,traitId],categoryCount=next.filter(id=>data(getEntity(s,id,'trait'),'trait').category===trait.category).length;
  if(categoryCount>(template.categoryCaps[trait.category]??Number.POSITIVE_INFINITY))return false;
  for(const tag of trait.generation.tags)if(next.filter(id=>data(getEntity(s,id,'trait'),'trait').generation.tags.includes(tag)).length>(template.tagCaps[tag]??Number.POSITIVE_INFINITY))return false;
  try{validateTraitSelection(s,next,template.budget);}catch{return false;}selected.push(traitId);return true;
 };
 const required=(traitId:string,stack=new Set<string>())=>{if(selected.includes(traitId))return;if(stack.has(traitId))throw new Error('trait_prerequisite_cycle');stack.add(traitId);const trait=data(getEntity(s,traitId,'trait'),'trait');for(const prerequisite of trait.prerequisites)required(prerequisite,stack);stack.delete(traitId);if(!add(traitId)&&!selected.includes(traitId))throw new Error('trait_template_required_conflict');};
 for(const traitId of template.requiredTraitIds)required(traitId);
 const traits=s.entities.filter(entity=>entity.kind==='trait'&&!entity.archived&&(template.allowHidden||entity.visibility!=='creator'));
 let draw=0;
 while(selected.length<template.maxTraits){
  const candidates=traits.filter(entity=>!selected.includes(entity.id)&&!template.excludedTraitIds.includes(entity.id)).map(entity=>{const trait=data(entity,'trait'),weight=trait.generation.weight*(template.categoryWeights[trait.category]??0);return {entity,trait,weight};}).filter(candidate=>candidate.weight>0&&candidate.trait.prerequisites.every(id=>selected.includes(id))&&candidate.trait.generation.requiresBackgroundTags.every(tag=>template.backgroundTags.includes(tag)));
  if(!candidates.length)break;
  const total=candidates.reduce((sum,candidate)=>sum+candidate.weight,0),point=fraction(seed,draw++)*total;let cursor=0,chosen=candidates.at(-1)!;
  for(const candidate of candidates.sort((a,b)=>a.entity.id.localeCompare(b.entity.id))){cursor+=candidate.weight;if(point<cursor){chosen=candidate;break;}}
  if(!add(chosen.entity.id)){traits.splice(traits.findIndex(entity=>entity.id===chosen.entity.id),1);continue;}
 }
 if(selected.length<template.minTraits)throw new Error('trait_template_unsatisfied');
 validateTraitSelection(s,selected,template.budget);
 return {traitIds:selected,seed,templateId,balance:traitBalance(s,selected,template.budget)};
}
