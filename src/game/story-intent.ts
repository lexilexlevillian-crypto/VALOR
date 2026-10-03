import {proposeIntent} from './intent.ts';
import {observerView} from './epistemics.ts';
import type {Action,State} from './model.ts';
// A fast path for ordinary roleplay. Unknown mechanical targets are clarified, never invented.
export function storyIntent(s:State,characterId:string,text:string):Action|null{
 const view=observerView(s,characterId),self=view.entities.find(e=>e.id===characterId)!;
 const original=text.trim(),name=self.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 let line=original.replace(new RegExp('^(?:I|they|he|she|'+name+')\\s+','i'),'').replace(/[.!]+$/,'').trim();
 const quoted=/^(?:say|said|says)\s+["“]([\s\S]+)["”]$/i.exec(line)??/^["“]([\s\S]+)["”]$/.exec(original);
 if(quoted)return {type:'say',text:quoted[1]!};
 if(/\b(?:don't|didn't|doesn't|never|not|would|could|might|if)\b|\?/i.test(line))return null;
 const verbs:Record<string,string>={looked:'look',looks:'look',searched:'search',searches:'search',walked:'go',walks:'go',went:'go',headed:'go',took:'take',takes:'take',equipped:'equip',unequipped:'unequip',ate:'consume',drank:'consume',waited:'wait',slept:'sleep',said:'say'};
 line=line.replace(/^\w+/,v=>verbs[v.toLowerCase()]??v).replace(/^look(?:ed)? around$/i,'look').replace(/^search (?:this |the )?(?:location|room|place)$/i,'search').replace(/^go to /i,'go ').replace(/^pick(?:ed)? up /i,'take ').replace(/^put on /i,'equip ').replace(/^take off /i,'unequip ');
 const parsed=proposeIntent(s,characterId,line);if(parsed.action)return parsed.action;
 const named=(kind:string,label:string)=>{const found=view.entities.filter(e=>e.kind===kind&&e.name.toLowerCase()===label.trim().toLowerCase());return found.length===1?found[0]:undefined;};
 const purchase=/^(?:buy|bought) (.+?) from (.+)$/i.exec(line);
 if(purchase){const shop=named('business',purchase[2]!),item=named('item',purchase[1]!);if(shop&&item)return {type:'buy',businessId:shop.id,itemId:item.id,quantity:1};}
 const give=/^(?:give|gave) (.+?) to (.+)$/i.exec(line);
 if(give){const item=named('item',give[1]!),person=named('character',give[2]!);if(item&&person)return {type:'give',itemId:item.id,toId:person.id};}
 const discard=/^(?:drop|dropped|discard|discarded) (.+)$/i.exec(line);
 if(discard){const item=named('item',discard[1]!);if(item)return {type:'discard-item',itemId:item.id,quantity:1};}
 const work=/^(?:work|worked)(?: a shift)? (?:at|as) (.+)$/i.exec(line);
 if(work){const job=named('job',work[1]!);if(job)return {type:'work',jobId:job.id};}
 const greet=/^(?:greet|greeted) (.+)$/i.exec(line);
 if(greet){const person=named('character',greet[1]!);if(person)return {type:'social',targetId:person.id,intent:'greet',consent:false};}
 if(/^(?:raise (?:my|their|his|her) guard|raised (?:my|their|his|her) guard|block|blocked)$/i.test(line))return {type:'defend',defense:'block'};
 const hit=/^(?:attack|attacked|punch|punched|hit|strike|struck)\s+(.+)$/i.exec(line);
 if(hit){const targets=view.entities.filter(e=>e.kind==='character'&&e.id!==characterId&&e.name.toLowerCase()===hit[1]!.toLowerCase());if(targets.length===1)return {type:'attack',targetId:targets[0]!.id,weaponId:null,bodyPart:'torso'};}
 const flee=/^(?:flee|fled|run|ran) to (.+)$/i.exec(line);
 if(flee){const targets=view.entities.filter(e=>e.kind==='location'&&e.name.toLowerCase()===flee[1]!.toLowerCase());if(targets.length===1)return {type:'flee',destinationId:targets[0]!.id};}
 return null;
}
