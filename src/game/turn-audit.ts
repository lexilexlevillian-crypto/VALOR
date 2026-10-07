import type {Kind,State} from './model.ts';
import type {Effect} from './simulation.ts';
// Exhaustive entity ownership: adding a kind requires choosing its authority.
export const entityAuthorities:Record<Kind,string>={
 character:'characters',location:'spacetime',itemType:'items',item:'items',vehicle:'vehicles',transportService:'vehicles',relationship:'relationships',reputation:'relationships',obligation:'relationships',injury:'health',deathRecord:'health',lore:'knowledge',storycard:'knowledge',trait:'characters',traitTemplate:'characters',skill:'characters',checkDefinition:'characters',faction:'factions',factionOrder:'factions',rumor:'factions',factionEvent:'factions',business:'economy',job:'economy',housing:'economy',account:'economy',transaction:'economy',receipt:'economy',bill:'economy',evidence:'investigation',case:'law',law:'law',crime:'law',crimeReport:'law',lawPosture:'law',informant:'investigation',criminalHeat:'investigation',quest:'events',watcher:'events',message:'communications',socialPost:'communications',combat:'combat',chase:'combat',recipe:'economy',service:'health',transition:'events',production:'economy',dispatch:'health',judgment:'law',estate:'health',socialRule:'relationships',media:'authored-content'
};
export function authorityFor(kind:string){const owner=(entityAuthorities as Record<string,string>)[kind];if(!owner)throw new Error('unknown_entity_authority');return owner;}
export type StateDelta={ownerSystem:string;entityId:string;preconditionRevision:number;operation:'entity.create'|'entity.update'|'entity.archive'|'state.set';value:Record<string,unknown>;causeEventIndex:number};
export type WriteGrant={ownerSystem:string;kind?:string;fields?:readonly string[];create?:boolean;archive?:boolean;root?:keyof State};
const encoded=(v:unknown)=>JSON.stringify(v);
const rootOwner:Record<string,string>={clock:'spacetime',settings:'spacetime',facts:'knowledge',knowledge:'knowledge',beliefs:'knowledge',memories:'knowledge',information:'knowledge',npcBehavior:'npc_behavior'};
export function buildDeltas(before:State,after:State,causeEventIndex:number):StateDelta[]{
 const previous=new Map(before.entities.map(e=>[e.id,e])),deltas:StateDelta[]=[];
 for(const entity of after.entities){
  const prior=previous.get(entity.id);
  if(!prior){deltas.push({ownerSystem:authorityFor(entity.kind),entityId:entity.id,preconditionRevision:0,operation:'entity.create',value:{entity},causeEventIndex});continue;}
  if(encoded(prior)===encoded(entity))continue;
  if(prior.kind!==entity.kind||entity.revision<prior.revision)throw new Error('immutable_entity_metadata');
  const fields:Record<string,unknown>={};
  for(const key of ['name','visibility','archived','revision'] as const)if(prior[key]!==entity[key])fields[key]=entity[key];
  const changedData:Record<string,unknown>={},removed:string[]=[];
  for(const key of new Set([...Object.keys(prior.data),...Object.keys(entity.data)]))if(encoded(prior.data[key])!==encoded(entity.data[key])){if(!(key in entity.data))removed.push(key);else changedData[key]=entity.data[key];}
  if(Object.keys(changedData).length)fields.data=changedData;if(removed.length)fields.removedData=removed;
  deltas.push({ownerSystem:authorityFor(entity.kind),entityId:entity.id,preconditionRevision:prior.revision,operation:entity.archived&&!prior.archived?'entity.archive':'entity.update',value:fields,causeEventIndex});
 }
 const ids=new Set(after.entities.map(e=>e.id));
 if(ids.size!==after.entities.length)throw new Error('duplicate_entity_delta');
 for(const entity of before.entities)if(!ids.has(entity.id))throw new Error('entity_deletion_requires_owner');
 for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
  if(key==='entities')continue;
  const k=key as keyof State;if(encoded(before[k])===encoded(after[k]))continue;
  if(!rootOwner[key])throw new Error('immutable_state_metadata');
  let value:Record<string,unknown>={value:after[k]};
  if(key==='settings'){value={};for(const field of new Set([...Object.keys(before.settings),...Object.keys(after.settings)]))if(encoded((before.settings as any)[field])!==encoded((after.settings as any)[field]))value[field]=(after.settings as any)[field];}
  deltas.push({ownerSystem:rootOwner[key]!,entityId:'$'+key,preconditionRevision:0,operation:'state.set',value,causeEventIndex});
 }
 return deltas;
}
export function authorizeDeltas(before:State,after:State,deltas:StateDelta[],grants:readonly WriteGrant[]){
 const next=new Map(after.entities.map(e=>[e.id,e]));
 for(const delta of deltas){
  const entity=next.get(delta.entityId),fields=delta.operation==='state.set'?Object.keys(delta.value):[...Object.keys(delta.value).filter(k=>!['data','removedData'].includes(k)),...Object.keys(delta.value.data??{}).map(k=>'data.'+k),...(delta.value.removedData as string[]??[]).map(k=>'data.'+k)];
  const allowed=grants.filter(g=>g.ownerSystem===delta.ownerSystem&&(delta.operation==='state.set'?g.root===delta.entityId.slice(1):!g.root&&g.kind===entity?.kind));
  if(delta.operation==='entity.create'){if(!allowed.some(g=>g.create))throw new Error('unauthorized_state_delta');continue;}
  if(delta.operation==='entity.archive'&&!allowed.some(g=>g.archive))throw new Error('unauthorized_state_delta');
  if(!allowed.length||fields.some(field=>!allowed.some(g=>g.fields?.includes(field)||g.fields?.includes('data.*')&&field.startsWith('data.'))))throw new Error('unauthorized_state_delta');
 }
}
export function validateDeltas(before:State,after:State,deltas:StateDelta[],events:Effect[],expected?:StateDelta[]){
 const actual=expected??buildDeltas(before,after,0);
 if(deltas.length!==actual.length)throw new Error('invalid_owned_delta');
 const indexed=new Map(actual.map(d=>[d.entityId,d]));const seen=new Set<string>();
 for(const delta of deltas){const intended=indexed.get(delta.entityId);if(!intended||seen.has(delta.entityId)||!Number.isInteger(delta.causeEventIndex)||!events[delta.causeEventIndex]||delta!==intended&&encoded({...delta,causeEventIndex:0})!==encoded(intended))throw new Error('invalid_owned_delta');seen.add(delta.entityId);}
}
