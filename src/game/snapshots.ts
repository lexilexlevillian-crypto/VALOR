import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {z} from 'zod';
import type {Store} from '../db.ts';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const hashSchema=z.string().regex(/^[a-f0-9]{64}$/);
const manifestSchema=z.strictObject({storageVersion:z.literal(2),version:z.literal(1),clock:z.string(),settings:z.unknown(),blocks:z.strictObject({entities:z.array(hashSchema),facts:z.array(hashSchema),knowledge:z.array(hashSchema),beliefs:z.array(hashSchema),memories:z.array(hashSchema),transcript:z.array(hashSchema)})});
type Snapshot={version:number;state:{clock:string;settings:unknown;entities:unknown[];facts:unknown[];knowledge:unknown[];beliefs:unknown[];memories:unknown[]};transcript:unknown[]};
export async function encodeSnapshot(store:Store,snapshot:Snapshot){
 const pending=new Map<string,string>();
 const pack=(rows:unknown[],size:number)=>{const ids:string[]=[];for(let offset=0;offset<rows.length;offset+=size){const json=JSON.stringify(rows.slice(offset,offset+size)),id=hash(json);pending.set(id,json);ids.push(id);}return ids;};
 const s=snapshot.state,manifest={storageVersion:2,version:1,clock:s.clock,settings:s.settings,blocks:{entities:pack(s.entities,1),facts:pack(s.facts,64),knowledge:pack(s.knowledge,64),beliefs:pack(s.beliefs,64),memories:pack(s.memories,64),transcript:pack(snapshot.transcript,32)}};
 const ids=[...pending.keys()];
 for(let offset=0;offset<ids.length;offset+=200){
  const group=ids.slice(offset,offset+200),existing=new Set((await store.all<{hash:string}>('SELECT hash FROM snapshot_chunks WHERE hash IN ('+group.map(()=>'?').join(',')+')',...group)).map(r=>r.hash));
  const statements=group.filter(id=>!existing.has(id)).map(id=>({sql:'INSERT OR IGNORE INTO snapshot_chunks(hash,payload) VALUES (?,?)',args:[id,gzipSync(pending.get(id)!).toString('base64')]}));
  if(statements.length)await store.batch(statements);
 }
 return manifest;
}
export async function decodeSnapshot(store:Store,raw:unknown):Promise<unknown>{
 if(!raw||typeof raw!=='object'||!('storageVersion'in raw))return raw; // v1 saves remain valid.
 const manifest=manifestSchema.parse(raw),cache=new Map<string,unknown[]>();let bytes=0;
 const ids=[...new Set(Object.values(manifest.blocks).flat())];
 for(let offset=0;offset<ids.length;offset+=200){
  const group=ids.slice(offset,offset+200),rows=await store.all<{hash:string;payload:string}>('SELECT hash,payload FROM snapshot_chunks WHERE hash IN ('+group.map(()=>'?').join(',')+')',...group);
  for(const row of rows){
   const json=gunzipSync(Buffer.from(row.payload,'base64'),{maxOutputLength:16*1024*1024}).toString('utf8');bytes+=Buffer.byteLength(json);
   if(bytes>128*1024*1024||hash(json)!==row.hash)throw new Error('corrupt_snapshot_chunk');
   const parsed:unknown=JSON.parse(json);if(!Array.isArray(parsed))throw new Error('corrupt_snapshot_chunk');cache.set(row.hash,parsed);
  }
 }
 const unpack=(ids:string[])=>ids.flatMap(id=>{const rows=cache.get(id);if(!rows)throw new Error('missing_snapshot_chunk');return rows;});
 return {version:1,state:{clock:manifest.clock,settings:manifest.settings,entities:unpack(manifest.blocks.entities),facts:unpack(manifest.blocks.facts),knowledge:unpack(manifest.blocks.knowledge),beliefs:unpack(manifest.blocks.beliefs),memories:unpack(manifest.blocks.memories)},transcript:unpack(manifest.blocks.transcript)};
}
