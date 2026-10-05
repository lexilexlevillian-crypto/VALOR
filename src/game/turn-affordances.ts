import {createHash} from 'node:crypto';
import {intentContext} from './ai-intent.ts';
import type {State} from './model.ts';

export function turnAffordances(s:State,actorId:string,revision:number){
 return intentContext(s,actorId,'').candidates.map(candidate=>({
  affordanceId:createHash('sha256').update(JSON.stringify([actorId,revision,candidate.action])).digest('hex'),
  label:candidate.label,actionTemplate:candidate.action.type,expiresAtRevision:revision,enabled:true,action:candidate.action,
 }));
}
