import {storyActionClarification,storyIntent} from './story-intent.ts';
import {observerView} from './epistemics.ts';
import {actionSchema,data,type State,type Action,type Entity} from './model.ts';
import type {TurnClause} from './turn-contracts.ts';
export type InterpretedTurn={clauses:TurnClause[];clarification?:string;originalText:string;options?:Array<{id:string;label:string;answerText?:string}>;presentation?:{kind:'help'|'settings';text:string};intent?:{declaredGoal:string;approach:string;explicitConstraints:string[];confidence:number;evidence:Array<{start:number;end:number;text:string}>;assumptions:Array<{code:string;materiality:'TRIVIAL';basis:'CONTEXT'}>}};
export function correctedInput(text:string){
 const masked=text.replace(/"[^"]*"|“[^”]*”/g,match=>' '.repeat(match.length)),last=[...masked.matchAll(/(?:—|--|;|,)\s*no,?\s*(?:actually\s+)?/gi)].at(-1);
 return last?text.slice(last.index!+last[0].length).replace(/\s+instead[.!]?$/i,'').trim():text.trim();
}
const normalize=(text:string)=>text.toLowerCase().replace(/^(?:the|a|an|my)\s+/,'').replace(/[.!]+$/,'').trim();
const number=(s:string)=>({one:1,two:2,five:5,ten:10,fifteen:15,thirty:30,sixty:60}[s.toLowerCase()]??Number(s));
export function interpretTurn(s:State,actorId:string,text:string):InterpretedTurn{
 const input=correctedInput(text);
 if(/^(?:help|settings|what can I do)[?.!]?$/i.test(input))return {originalText:text,clauses:[],presentation:{kind:/settings/i.test(input)?'settings':'help',text:/settings/i.test(input)?'Open Settings to adjust presentation preferences.':'Type what you want to attempt, use a suggested action, or inspect the scene. Clarifications and inspection do not advance time.'}};
 const view=observerView(s,actorId),pc=view.entities.find(e=>e.id===actorId)!;
 const candidates=(kind:string,label:string)=>{
  let query=normalize(label);const pool=view.entities.filter(e=>e.kind===kind&&e.id!==actorId);
  if(/^(him|her|them|he|she|they|it)$/.test(query)){const local=pool.filter(e=>e.data.locationId===pc.data.locationId);return local.length?local:pool;}
  const exact=pool.filter(e=>normalize(e.name)===query);if(exact.length)return exact;
  if(kind==='item')query=query.replace(/^(?:(?:locked|unlocked|open|closed|ordinary)\s+)+/,'');
  const described=pool.filter(e=>normalize(e.name)===query);if(described.length)return described;
  return pool.filter(e=>normalize(e.name).split(/\s+/).includes(query)||normalize(e.name).endsWith(' '+query)||kind==='item'&&String((e.data.mechanism as {kind?:string}|null)?.kind)===query);
 };
 let ambiguous:Entity[]=[],ambiguousLabel='';
 const find=(kind:string,label:string)=>{const rows=candidates(kind,label);if(rows.length>1){ambiguous=rows;ambiguousLabel=label;}return rows.length===1?rows[0]:undefined;};
 const unclear=(message='Which action or known target do you mean? Nothing has happened yet.'):InterpretedTurn=>({clauses:[],clarification:message,originalText:text,...(ambiguous.length?{options:ambiguous.map(e=>({id:e.id,label:e.name,...(ambiguousLabel?{answerText:input.replace(ambiguousLabel,()=>e.name)}:{})}))}:{})});
 const outside=input.replace(/"[^"]*"|“[^”]*”/g,'');
 if(/\b(?:would|could|might)\b|\?/.test(outside)||/\bleave immediately\b.*\bstay\b/i.test(outside))return unclear();
 let constraints:string[]=[];let approach='';
 function one(raw:string):Action|null{
  let line=raw.replace(/^I\s+/i,'').replace(/[.!]+$/,'').trim();
  const speech=/^(?:say|tell\s+[^,“"]+|look at\s+[^,“"]+\s+and say),?\s*["“]([\s\S]+)["”]$/i.exec(line);
  if(speech)return {type:'say',text:speech[1]!};
  if(/\bwithout (?:making (?:a )?noise|being heard|a sound)\b|\bquietly\b/i.test(line)){constraints.push('avoid-noise');approach='quiet';line=line.replace(/\s+without (?:making (?:a )?noise|being heard|a sound)\b|\bquietly\s*/ig,'').trim();}
  if(/\bwithout interruption\b/i.test(line)){constraints.push('requested-uninterrupted');line=line.replace(/\s+without interruption\b/ig,'');}
  const until=/^wait (.+?) (minutes?|hours?)(?: or)? until (.+?) (arrives|leaves)$/i.exec(line);
  if(until){const target=find('character',until[3]!);if(target&&number(until[1]!)>0)return {type:'wait-until',minutes:number(until[1]!)*(until[2]!.startsWith('hour')?60:1),targetId:target.id,condition:until[4]!.toLowerCase() as 'arrives'|'leaves'};return null;}
  const wait=/^(wait|sleep) (.+?) (minutes?|hours?)$/i.exec(line);
  if(wait&&number(wait[2]!)>0)return actionSchema.parse({type:wait[1]!.toLowerCase(),minutes:number(wait[2]!)*(wait[3]!.startsWith('hour')?60:1)});
  if(/^sleep until morning$/i.test(line)){const fmt=new Intl.DateTimeFormat('en-US',{timeZone:s.settings.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});for(let minutes=1;minutes<=1500;minutes++)if(fmt.format(new Date(Date.parse(s.clock)+minutes*60000))==='06:00')return actionSchema.parse({type:'sleep',minutes});return null;}
  if(/^(?:work(?: the rest of (?:the|my) shift)?|quit(?: (?:my|the) job| (?:the|my) shift)?)$/i.test(line)){
   const jobs=view.entities.filter(e=>e.kind==='job'&&e.data.employeeId===actorId&&e.data.status==='active');if(jobs.length===1)return {type:/^quit/i.test(line)?'quit-job':'work',jobId:jobs[0]!.id};ambiguous=jobs;return null;
  }
  if(/^(?:walk|go|move) (?:across|to the other side of) (?:the |this )?(?:room|diner)$/i.test(line))return {type:'move-within',destination:'across the room'};
  if(/^drive away$/i.test(line)){const location=view.entities.find(e=>e.id===pc.data.locationId&&e.kind==='location'),exits=location?data(location,'location').exits.filter(exit=>exit.modes.includes('drive')&&view.entities.some(e=>e.id===exit.to)):[],cars=view.entities.filter(e=>e.kind==='vehicle'&&e.data.locationId===pc.data.locationId);if(exits.length===1&&cars.length===1)return {type:'travel',destinationId:exits[0]!.to,mode:'drive',vehicleId:cars[0]!.id};return null;}
  if(/^beat (?:them all|everyone) up$/i.test(line)){const targets=view.entities.filter(e=>e.kind==='character'&&e.id!==actorId&&e.data.locationId===pc.data.locationId);targets.sort((a,b)=>a.id.localeCompare(b.id));if(targets.length)return actionSchema.parse({type:'combat',targetId:targets[0]!.id,opponentIds:targets.slice(1).map(e=>e.id)});return null;}
  const call=/^call (.+)$/i.exec(line);
  if(call){const person=find('character',call[1]!);if(!person)return null;const phones=view.entities.filter(e=>e.kind==='item'&&e.data.category==='phone'&&(e.data.possessorId??e.data.ownerId)===actorId&&data(e,'item').contacts.some(c=>c.characterId===person.id&&!c.blocked));return phones.length===1?{type:'phone-call',phoneId:phones[0]!.id,toId:person.id}:null;}
  const give=/^give (.+?) (?:to (.+))$/i.exec(line)??/^give (.+?) (?:the |my )(.+)$/i.exec(line)?.map((v,i,a)=>i===1?a[2]!:i===2?a[1]!:v)??/^give (him|her|them) (.+)$/i.exec(line)?.map((v,i,a)=>i===1?a[2]!:i===2?a[1]!:v);
  if(give){const item=find('item',give[1]!),person=find('character',give[2]!);return item&&person?{type:'give',itemId:item.id,toId:person.id}:null;}
  const physical=/^(open|close|unlock|pick|lockpick|force|kick|push|shove|throw|put|place|move|carefully manipulate)\s+(.+)$/i.exec(line.replace(/^effortlessly\s+/i,''));
  if(physical){
   let verb=physical[1]!.toLowerCase(),tail=physical[2]!.replace(/\s+open$/i,''),instrument:Entity|undefined,destination:Entity|undefined;
   if(['pick','lockpick','carefully manipulate'].includes(verb))tail=tail.replace(/^(?:the )?(?:lock|pins) (?:of|on|in) /i,'').replace(/(?:'s)? lock$/i,'');
   const withTool=/^(.+?) with (.+)$/i.exec(tail);if(withTool){tail=withTool[1]!;instrument=find('item',withTool[2]!);if(!instrument)return null;}
   if(['pick','lockpick','carefully manipulate'].includes(verb))tail=tail.replace(/(?:'s)? lock$/i,'');
   if(verb==='throw'){const parts=/^(.+?) at (.+)$/.exec(tail);if(!parts)return null;instrument=find('item',parts[1]!);tail=parts[2]!;if(!instrument)return null;}
   if(['push','shove','put','place','move'].includes(verb)){
    const parts=/^(.+?) (?:in front of|into|in) (.+)$/.exec(tail);
    if(parts){tail=parts[1]!;destination=find('item',parts[2]!)??find('vehicle',parts[2]!.replace(/(?:'s)? trunk$/i,''));if(!destination)return null;}
   }
   const target=find('item',tail);if(!target)return null;
   const operation=({pick:'lockpick',lockpick:'lockpick','carefully manipulate':'lockpick',kick:'force',shove:'push',put:'place',move:destination?'push':'attempt'} as Record<string,string>)[verb]??verb;
   if(operation==='lockpick'&&!instrument){const tools=view.entities.filter(e=>e.kind==='item'&&(e.data.tags as string[]).includes('lockpick')&&(e.data.possessorId??e.data.ownerId)===actorId);if(tools.length===1)instrument=tools[0];}
   return actionSchema.parse({type:'physical',operation,targetId:target.id,instrumentId:instrument?.id??null,destinationId:destination?.id??null,quiet:constraints.includes('avoid-noise'),goal:line,approach:approach||verb});
  }
  const persuade=/^(?:convince|persuade) (.+?)(?: to (.+?))?(?: by (.+))?$/i.exec(line);
  if(persuade){const person=find('character',persuade[1]!);if(person){approach=persuade[3]??'persuasion';return actionSchema.parse({type:'persuade',targetId:person.id,goal:persuade[2]??'agree',approach});}return null;}
  const action=storyIntent(s,actorId,line);if(action)return action;
  const take=/^(?:take|grab|draw) (.+)$/i.exec(line);if(take){const item=find('item',take[1]!);if(item)return {type:'take',itemId:item.id};}
  // Named, plausible but novel actions remain attempts at an observable object.
  const target=view.entities.filter(e=>e.kind==='item'&&normalize(line).includes(normalize(e.name)));
  if(target.length===1&&!/\b(?:don't|do not|not|never)\b/i.test(line))return actionSchema.parse({type:'physical',operation:'attempt',targetId:target[0]!.id,goal:line,approach:line});
  return null;
 }
 const masked=input.replace(/"[^"]*"|“[^”]*”/g,match=>' '.repeat(match.length));
 let pieces:string[]=[];let start=0;
 for(const match of masked.matchAll(/\s*(?:;|\bthen\b|\band\b)\s+(?=(?:I\s+)?(?:take|give|go|walk|drive|call|say|tell|wait|sleep|look|search|equip|consume|drop|attack|flee|work|open|close|unlock|pick|push|throw|put|quit)\b)/gi)){if(/^if .+ is (?:open|closed|locked|unlocked),?\s*$/i.test(input.slice(0,match.index)))continue;pieces.push(input.slice(start,match.index).trim());start=match.index!+match[0].length;}
 pieces.push(input.slice(start).trim());
 const single=one(input);if(single&&single.type==='say')pieces=[input];
 if(pieces.length>8)return unclear('Choose the first part of that plan. Nothing has happened yet.');
 const clauses:TurnClause[]=[];
 for(const[index,piece]of pieces.entries()){
  const conditional=/^if (.+?) is (open|closed|locked|unlocked),?\s+(?:then )?(.+)$/i.exec(piece);
  let condition:TurnClause['condition']|undefined;
  if(conditional){const target=find('item',conditional[1]!);if(!target)return unclear();condition={targetId:target.id,field:/lock/.test(conditional[2]!)?'locked':'open',equals:['open','locked'].includes(conditional[2]!.toLowerCase())};}
  const action=one(conditional?.[3]??piece);if(!action)return unclear(storyActionClarification(text)??undefined);
  clauses.push({clauseId:String(index+1),dependency:condition?'CONDITIONAL':index?'PREVIOUS_SUCCESS':'NONE',...(condition?{condition}:{}),action});
 }
 return {originalText:text,clauses,intent:{declaredGoal:input,approach,explicitConstraints:[...new Set(constraints)],confidence:1,evidence:[{start:0,end:text.length,text}],assumptions:[]}};
}
