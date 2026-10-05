import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash,randomUUID} from 'node:crypto';
import type {State} from './model.ts';
type Runtime={seed:string;eventId:string;state:State;owner:string;sequence:number};
const storage=new AsyncLocalStorage<Runtime>();
export function withTurnRuntime<T>(seed:string,eventId:string,state:State,owner:string,fn:()=>T):T{return storage.run({seed,eventId,state,owner,sequence:0},fn);}
export function simulationId():ReturnType<typeof randomUUID>{
 const r=storage.getStore();if(!r)return randomUUID();const h=createHash('sha256').update(r.seed+':'+r.eventId+':'+r.sequence++).digest('hex');
 return (h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32)) as ReturnType<typeof randomUUID>;
}
export function eventMetadata(){const r=storage.getStore();return r?{occurredAt:r.state.clock,sourceSystem:r.owner,causeRefs:[r.eventId]}:{};}
