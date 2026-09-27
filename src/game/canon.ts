import {z} from 'zod';
import type {State} from './model.ts';
const row=z.object({id:z.uuid(),name:z.string(),visibility:z.string(),archived_at:z.string().nullable().optional()}).passthrough();
export const canonSnapshotSchema=z.object({
 record:row.extend({kind:z.string()}),
 canon:z.object({slug:z.string(),aliases_json:z.string(),source_status:z.enum(['draft','published','archived']),valid_from:z.string().nullable(),valid_until:z.string().nullable()}).passthrough(),
 sections:z.array(row.extend({parent_id:z.string().nullable()})),
 fields:z.array(row.extend({section_id:z.string(),value_json:z.string().nullable().optional()})),
 links:z.array(z.record(z.string(),z.json()))
});
export const canonSourceSchema=z.strictObject({revisionId:z.uuid(),worldId:z.uuid(),records:z.array(canonSnapshotSchema).max(10000)});
export type CanonSource=z.infer<typeof canonSourceSchema>;
// Only explicitly campaign-visible fields and ancestors enter player context.
export function canonSources(s:State){
 if(!s.canon)return [];
 const at=Date.parse(s.clock);
 return s.canon.records.filter(r=>r.record.visibility==='campaign'&&!r.record.archived_at&&r.canon.source_status==='published'&&(!r.canon.valid_from||Date.parse(r.canon.valid_from)<=at)&&(!r.canon.valid_until||Date.parse(r.canon.valid_until)>at)).map(r=>{
  const allowed=(id:string,seen=new Set<string>()):boolean=>{if(seen.has(id))return false;seen.add(id);const section=r.sections.find(x=>x.id===id);return !!section&&section.visibility==='campaign'&&!section.archived_at&&(!section.parent_id||allowed(section.parent_id,seen));};
  const values=r.fields.filter(f=>f.visibility==='campaign'&&!f.archived_at&&allowed(f.section_id)).map(f=>f.name+': '+(f.value_json??'null'));
  return {id:r.record.id,name:r.record.name,text:[r.record.kind,...values].join('\n'),source:'canon:'+s.canon!.revisionId+':'+r.canon.slug,score:0};
 });
}
