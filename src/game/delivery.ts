import {randomUUID} from 'node:crypto';
import type {Store} from '../db.ts';
export type GameDelivery={id:string;timelineId:string;revision:number;type:string;effects:unknown[];clock:string};
// Trusted worker interface, not an API. Consumers must deduplicate event IDs.
export async function deliverGameEvents(store:Store,hook:(event:GameDelivery)=>Promise<void>,limit=100){
 const token=randomUUID(),at=new Date().toISOString(),until=new Date(Date.now()+60000).toISOString();
 const rows=await store.transaction(async()=>{
  const pending=await store.all<{event_id:string}>('SELECT event_id FROM game_outbox WHERE delivered_at IS NULL AND (lease_until IS NULL OR lease_until<?) ORDER BY rowid LIMIT ?',at,Math.max(1,Math.min(1000,limit)));
  for(const row of pending)await store.run('UPDATE game_outbox SET attempts=attempts+1,lease_token=?,lease_until=? WHERE event_id=?',token,until,row.event_id);
  return pending;
 });
 for(const row of rows){
  try{
   const event=await store.get<{id:string;timeline_id:string;revision:number;type:string;effects_json:string;clock:string}>('SELECT * FROM game_events WHERE id=?',row.event_id);
   if(!event)throw new Error('game_event_missing');
   await hook({id:event.id,timelineId:event.timeline_id,revision:event.revision,type:event.type,effects:JSON.parse(event.effects_json),clock:event.clock});
   await store.run('UPDATE game_outbox SET delivered_at=?,lease_token=NULL,lease_until=NULL WHERE event_id=? AND lease_token=?',new Date().toISOString(),event.id,token);
  }catch(error){
   await store.run('UPDATE game_outbox SET lease_token=NULL,lease_until=NULL WHERE lease_token=? AND delivered_at IS NULL',token);
   throw error;
  }
 }
 return rows.length;
}
