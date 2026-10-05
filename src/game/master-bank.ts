import {readFileSync} from 'node:fs';
import {simulationId as randomUUID} from './turn-runtime.ts';
import {validateEntity} from './model.ts';
import type {Entity} from './model.ts';
import {itemBank} from './master-bank-items.ts';
import {weaponBank} from './master-bank-weapons.ts';
import type {BankEntry,BankKind} from './master-bank-types.ts';

const vehicleBank=JSON.parse(readFileSync(new URL('./master-bank-vehicles.json',import.meta.url),'utf8')) as BankEntry[];
const cutoff=Date.parse('2012-01-01T00:00:00.000Z');
const entries:BankEntry[]=[...itemBank,...weaponBank,...vehicleBank].sort((left,right)=>left.name.localeCompare(right.name)||left.variant.localeCompare(right.variant)||left.id.localeCompare(right.id));
const byId=new Map(entries.map(entry=>[entry.id,entry]));

if(byId.size!==entries.length)throw new Error('duplicate_master_bank_id');
for(const entry of entries){
 if(!Number.isInteger(entry.price2012Cents)||entry.price2012Cents<=0)throw new Error('invalid_master_bank_price');
 if(!Number.isFinite(Date.parse(entry.introducedOn))||Date.parse(entry.introducedOn)>=cutoff)throw new Error('master_bank_cutoff_violation');
 if(entry.template.kind!=='item'&&entry.template.kind!=='vehicle')throw new Error('invalid_master_bank_template_kind');
}

export type MasterBankQuery={q?:string;kind?:BankKind;category?:string;offset?:number;limit?:number};
const normalized=(value:string)=>value.trim().toLocaleLowerCase();

export function listMasterBank(query:MasterBankQuery={}){
 const q=normalized(query.q??''),category=normalized(query.category??''),offset=Math.max(0,Math.trunc(query.offset??0)),limit=Math.max(1,Math.min(100,Math.trunc(query.limit??50)));
 const filtered=entries.filter(entry=>(!query.kind||entry.kind===query.kind)&&(!category||normalized(entry.category)===category)&&(!q||normalized([entry.name,entry.variant,entry.category,entry.template.data.make,entry.template.data.model,entry.template.data.caliber,entry.template.data.tags].flat().filter(Boolean).join(' ')).includes(q)));
 const counts={all:entries.length,item:entries.filter(entry=>entry.kind==='item').length,weapon:entries.filter(entry=>entry.kind==='weapon').length,vehicle:entries.filter(entry=>entry.kind==='vehicle').length};
 return {cutoff:'2012-01-01',currency:'USD',priceYear:2012,counts,total:filtered.length,offset,limit,nextOffset:offset+limit<filtered.length?offset+limit:null,items:filtered.slice(offset,offset+limit).map(entry=>({...entry,template:undefined}))};
}

export function masterBankEntry(id:string){const entry=byId.get(id);if(!entry)throw new Error('master_bank_entry_unavailable');return entry;}

export function instantiateMasterBankEntry(id:string):Entity{
 const source=masterBankEntry(id),template=structuredClone(source.template);
 return validateEntity({id:randomUUID(),kind:template.kind,name:template.name,visibility:template.visibility,revision:1,archived:false,data:template.data});
}

export const masterBankCount=entries.length;
