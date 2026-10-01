import {data,remapEntityReference,refs} from './model.ts';
import type {Data,Entity,State} from './model.ts';

export type NpcFilters={
 query?:string;status?:Data<'character'>['registryStatus'];locationId?:string;factionId?:string;
 relationship?:string;job?:string;schedule?:string;scheduled?:boolean;tags?:string[];
 visibility?:Entity['visibility'];alive?:boolean;injured?:boolean;arrested?:boolean;
 lastActiveFrom?:string;lastActiveUntil?:string;archive?:'active'|'archived'|'all';
};
const lower=(value:unknown)=>String(value??'').toLowerCase();
const includes=(value:unknown,needle:string)=>lower(value).includes(lower(needle));
const activeCaseStages=new Set(['arrest','booking','jail','bail','interrogation','charged','trial','sentenced','probation','parole']);

export function npcDerived(state:State,npc:Entity,lastActiveAt:string|null){
 const character=data(npc,'character');
 const injuries=state.entities.filter(entity=>entity.kind==='injury'&&!entity.archived&&entity.data.characterId===npc.id);
 const relationships=state.entities.filter(entity=>entity.kind==='relationship'&&!entity.archived&&(entity.data.fromId===npc.id||entity.data.toId===npc.id));
 const jobs=state.entities.filter(entity=>entity.kind==='job'&&!entity.archived&&entity.data.employeeId===npc.id);
 const arrested=character.arrested||state.entities.some(entity=>entity.kind==='case'&&!entity.archived&&(entity.data.suspectIds as string[]).includes(npc.id)&&activeCaseStages.has(String(entity.data.stage)));
 return {alive:character.condition!=='dead',injured:injuries.length>0,arrested,lastActiveAt:character.lastActiveAt??lastActiveAt,
  injuries:injuries.map(entity=>entity.id),relationships:relationships.map(entity=>entity.id),jobs:jobs.map(entity=>entity.id)};
}

export function listNpcs(state:State,filters:NpcFilters,lastActive:Map<string,string>){
 const archive=filters.archive??'active',query=lower(filters.query),relationship=lower(filters.relationship),job=lower(filters.job),schedule=lower(filters.schedule),tags=(filters.tags??[]).map(lower);
 return state.entities.filter(entity=>entity.kind==='character'&&!entity.data.playable&&(archive==='all'||archive==='archived'===entity.archived)).map(entity=>{
  const character=data(entity,'character'),derived=npcDerived(state,entity,lastActive.get(entity.id)??null);
  const location=character.locationId?state.entities.find(candidate=>candidate.id===character.locationId&&candidate.kind==='location'):undefined;
  const factions=character.factionIds.map(id=>state.entities.find(candidate=>candidate.id===id&&candidate.kind==='faction')).filter((value):value is Entity=>!!value);
  const relations=state.entities.filter(candidate=>candidate.kind==='relationship'&&!candidate.archived&&(candidate.data.fromId===entity.id||candidate.data.toId===entity.id));
  const jobRecords=state.entities.filter(candidate=>candidate.kind==='job'&&!candidate.archived&&candidate.data.employeeId===entity.id);
  const scheduleText=character.schedule.map(row=>row.activity+' '+(state.entities.find(candidate=>candidate.id===row.locationId)?.name??row.locationId)).join(' ');
  const jobText=[character.employerOccupation,...character.occupations.flatMap(row=>[row.position,row.placeOfWork,row.shift,row.notes]),...jobRecords.map(row=>row.name)].join(' ');
  const relationshipText=relations.flatMap(row=>[row.id,row.name,...(row.data.labels as string[])]).join(' ');
  const searchable=[entity.name,character.legalName,...character.aliases].join(' ');
  if(query&&!includes(searchable,query)||filters.status&&character.registryStatus!==filters.status||filters.locationId&&character.locationId!==filters.locationId||filters.factionId&&!character.factionIds.includes(filters.factionId))return null;
  if(relationship&&!includes(relationshipText,relationship)||job&&!includes(jobText,job)||schedule&&!includes(scheduleText,schedule)||filters.scheduled!==undefined&&(character.schedule.length>0)!==filters.scheduled)return null;
  if(tags.some(tag=>!character.tags.map(lower).includes(tag))||filters.visibility&&entity.visibility!==filters.visibility||filters.alive!==undefined&&derived.alive!==filters.alive||filters.injured!==undefined&&derived.injured!==filters.injured||filters.arrested!==undefined&&derived.arrested!==filters.arrested)return null;
  if(filters.lastActiveFrom&&(!derived.lastActiveAt||Date.parse(derived.lastActiveAt)<Date.parse(filters.lastActiveFrom))||filters.lastActiveUntil&&(!derived.lastActiveAt||Date.parse(derived.lastActiveAt)>Date.parse(filters.lastActiveUntil)))return null;
  return {id:entity.id,name:entity.name,aliases:character.aliases,status:character.registryStatus,visibility:entity.visibility,archived:entity.archived,location:location?{id:location.id,name:location.name}:null,
   factions:factions.map(row=>({id:row.id,name:row.name})),relationshipIds:derived.relationships,job:character.employerOccupation,occupations:character.occupations,schedule:character.schedule,tags:character.tags,...derived};
 }).filter((value):value is NonNullable<typeof value>=>!!value).sort((left,right)=>left.name.localeCompare(right.name)||left.id.localeCompare(right.id));
}

const empty=(value:unknown):boolean=>value===null||value===undefined||value===''||Array.isArray(value)&&value.length===0||typeof value==='object'&&value!==null&&!Array.isArray(value)&&Object.values(value).every(empty);
const mergeIgnored=new Set(['characterSchemaVersion','playable','controllerUserId','mergedIntoId','mergeRecordId','retirementNarrative']);
export type NpcMergeConflict={path:string;source:unknown;target:unknown};
export function npcMergeConflicts(source:Entity,target:Entity):NpcMergeConflict[]{
 const conflicts:NpcMergeConflict[]=[];
 if(source.name!==target.name)conflicts.push({path:'name',source:source.name,target:target.name});
 const sourceData=data(source,'character') as unknown as Record<string,unknown>,targetData=data(target,'character') as unknown as Record<string,unknown>;
 for(const key of [...new Set([...Object.keys(sourceData),...Object.keys(targetData)])].sort()){
  if(mergeIgnored.has(key))continue;const left=sourceData[key],right=targetData[key];
  if(!empty(left)&&!empty(right)&&JSON.stringify(left)!==JSON.stringify(right))conflicts.push({path:'data.'+key,source:left,target:right});
 }
 return conflicts;
}

export function mergeNpcData(source:Entity,target:Entity,resolution:Record<string,'source'|'target'>){
 const conflicts=npcMergeConflicts(source,target),required=new Set(conflicts.map(row=>row.path));
 for(const path of required)if(!resolution[path])throw new Error('npc_merge_resolution_required');
 for(const path of Object.keys(resolution))if(!required.has(path))throw new Error('npc_merge_resolution_unknown');
 const merged=structuredClone(target),sourceData=data(source,'character') as unknown as Record<string,unknown>,targetData=merged.data as Record<string,unknown>;
 if(resolution.name==='source')merged.name=source.name;
 for(const [key,value] of Object.entries(sourceData)){
  const path='data.'+key;if(mergeIgnored.has(key))continue;
  if(resolution[path]==='source'||empty(targetData[key])&&!empty(value))targetData[key]=structuredClone(value);
 }
 const aliases=new Set([...(targetData.aliases as string[]??[]),...(sourceData.aliases as string[]??[])]);
 if(source.name!==merged.name)aliases.add(source.name);if(target.name!==merged.name)aliases.add(target.name);targetData.aliases=[...aliases];
 return merged;
}

export function remapNpcReferences(state:State,sourceId:string,targetId:string,keepSource=true){
 state.entities=state.entities.map(entity=>entity.id===sourceId&&keepSource?entity:remapEntityReference(entity,sourceId,targetId));
 state.facts=state.facts.map(row=>({...row,subjectId:row.subjectId===sourceId?targetId:row.subjectId,objectId:row.objectId===sourceId?targetId:row.objectId}));
 state.knowledge=state.knowledge.map(row=>({...row,observerId:row.observerId===sourceId?targetId:row.observerId}));
 state.knowledge=[...new Map(state.knowledge.map(row=>[row.observerId+':'+row.factId,row])).values()];
 state.beliefs=state.beliefs.map(row=>({...row,observerId:row.observerId===sourceId?targetId:row.observerId,subjectId:row.subjectId===sourceId?targetId:row.subjectId,objectId:row.objectId===sourceId?targetId:row.objectId}));
 state.memories=state.memories.map(row=>({...row,observerId:row.observerId===sourceId?targetId:row.observerId,recallConditions:row.recallConditions?{...row.recallConditions,entityIds:row.recallConditions.entityIds.map(id=>id===sourceId?targetId:id)}:row.recallConditions}));
}

export function npcReferrers(state:State,npcId:string){return state.entities.filter(entity=>!entity.archived&&entity.id!==npcId&&refs(entity).includes(npcId)).map(entity=>({id:entity.id,name:entity.name,kind:entity.kind}));}
export function mergePayload(state:State){return {entities:structuredClone(state.entities),facts:structuredClone(state.facts),knowledge:structuredClone(state.knowledge),beliefs:structuredClone(state.beliefs),memories:structuredClone(state.memories)};}
export function mergePayloadForChecksum(state:State){const payload=mergePayload(state);payload.entities=payload.entities.map(entity=>({...entity,revision:1}));return payload;}
