import {createHash} from 'node:crypto';
import type {Store} from '../db.ts';
import type {State} from './model.ts';
import {observerView} from './epistemics.ts';
import type {ControlState} from './turn-contracts.ts';
import {controlState} from './turn-resolution.ts';
const sceneId=(timeline:string,actor:string,revision:number)=>createHash('sha256').update([timeline,actor,revision].join(':')).digest('hex');
export async function updateScene(store:Store,timelineId:string,actorId:string,s:State,revision:number,eventId:string,projection?:ReturnType<typeof observerView>,controlOverride?:ControlState){
 const view=projection??observerView(s,actorId),self=s.entities.find(e=>e.id===actorId)!;
 const rows=await store.all<{id:string;state_json:string}>('SELECT id,state_json FROM turn_scenes WHERE timeline_id=? AND character_id=? AND status<>?',timelineId,actorId,'CLOSED');
 const same=rows.find(r=>JSON.parse(r.state_json).locationId===self.data.locationId&&JSON.parse(r.state_json).phase!=='TRAVEL');
 const travel=Boolean(self.data.journey),id=travel?sceneId(timelineId,actorId,revision):same?.id??sceneId(timelineId,actorId,revision),old=same?JSON.parse(same.state_json):null;
 for(const row of rows)if(row.id!==id){const previous=JSON.parse(row.state_json);previous.status=travel?'SUSPENDED':'CLOSED';previous.sceneRevision=revision;previous.lastEventAt=s.clock;await store.run('UPDATE turn_scenes SET status=?,state_json=? WHERE id=?',previous.status,JSON.stringify(previous),row.id);}
 const specialized=view.entities.filter(e=>e.kind==='combat'&&e.data.active||e.kind==='chase'&&e.data.status==='active').map(e=>({id:e.id,kind:e.kind}));
 const control=controlOverride??controlState(s,actorId),state={sceneId:id,status:'OPEN',locationId:self.data.locationId,participantIds:view.entities.filter(e=>e.kind==='character'&&(e.id===actorId||self.data.locationId!==null&&e.data.locationId===self.data.locationId||travel&&(s.entities.find(row=>row.id===(self.data.journey as {vehicleId?:string}|null)?.vehicleId)?.data.occupants as string[]|undefined)?.includes(e.id))).map(e=>e.id),playerCharacterId:actorId,phase:travel?'TRAVEL':self.data.condition==='dead'?'DEATH':specialized.length?'SEQUENTIAL':'HANDOFF',tempo:specialized.length?'SEQUENTIAL':travel?'ACTIVE':'PAUSED',control,activePressures:view.entities.filter(e=>e.kind==='injury'||e.kind==='message'&&e.data.callState==='ringing').map(e=>({id:e.id,kind:e.kind})),environmentalStateRefs:view.entities.filter(e=>e.kind==='item'&&e.data.mechanism).map(e=>e.id),specializedStateRefs:specialized,openedAt:old?.openedAt??s.clock,lastEventAt:s.clock,sceneRevision:revision,lastCommittedTurnId:eventId};
 await store.run('INSERT INTO turn_scenes VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,state_json=excluded.state_json',id,timelineId,actorId,'OPEN',JSON.stringify(state));
 return state;
}
export async function currentScene(store:Store,timelineId:string,actorId:string){const row=await store.get<{state_json:string}>("SELECT state_json FROM turn_scenes WHERE timeline_id=? AND character_id=? AND status='OPEN' ORDER BY rowid DESC LIMIT 1",timelineId,actorId);return row?JSON.parse(row.state_json):null;}
