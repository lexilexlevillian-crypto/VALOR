import {createHash} from 'node:crypto';
import {canonSources} from './canon.ts';
import {observerView,retrieve,storyCardState,visible} from './epistemics.ts';
import {data,getEntity} from './model.ts';
import type {Entity,State} from './model.ts';
import type {Effect} from './simulation.ts';

export const contextPriorities=['validated-state-and-rules','current-scene-events','observer-knowledge','story-cards-and-directives','memory-and-relationships','retrieved-canon','optional-style'] as const;
export type ContextPriority=typeof contextPriorities[number];
export type ContextCategory='state'|'rules'|'event'|'conversation'|'fact'|'belief'|'storycard'|'directive'|'memory'|'relationship'|'canon'|'lore'|'style';
export type ContextManifestItem={id:string;priority:ContextPriority;rank:number;category:ContextCategory;text:string;source:string;score:number;estimatedTokens:number;requiredForClarity:boolean;repeated:boolean;claimKey?:string};
export type ContextDecision={id:string;category:ContextCategory;reason:'budget'|'duplicate'|'repetition-damped'|'lower-priority-conflict'|'secret'|'stale-belief'|'expired'|'inactive'|'not-yet-valid'|'scope-mismatch'|'activation-conditions-unmet'|'deactivated'|'active'|'agency-or-truth-override'|'unsupported-control';detail?:string};
export type NarrativeControls={
 pov:'first-person'|'third-person'|'third-person-limited';pacing:'slow'|'measured'|'brisk';tone:string;tension:'low'|'medium'|'high';spotlightId:string;
 safety:{preservePlayerAgency:true;requireConsent:true;serverTruthWins:true;excludedContent:string[]};styleHints:string[];
};
export type ContextManifest={version:2;observerId:string;clock:string;query:string;priorityLadder:readonly ContextPriority[];budget:{maxTokens:number;usedTokens:number};controls:NarrativeControls;included:ContextManifestItem[];omitted:ContextDecision[];rejected:ContextDecision[];counts:Record<string,number>};
export type ContextBuildOptions={maxTokens?:number;currentEvents?:Effect[];recentConversation?:Array<{id:string;input?:string;narration:string}>;recentFactIds?:string[];developer?:boolean};
export type ContextSource={id:string;layer:'state'|'rules'|'event'|'conversation'|'fact'|'belief'|'storycard'|'directive'|'memory'|'relationship'|'canon'|'lore'|'style';text:string;source:string;priority:ContextPriority};

const normalize=(text:string)=>text.toLowerCase().replace(/[^a-z0-9?]+/g,' ').trim().replace(/\s+/g,' ');
const tokens=(text:string)=>Math.max(1,Math.ceil(Buffer.byteLength(text)/4));
const terms=(query:string)=>[...new Set(normalize(query).split(' ').filter(term=>term.length>1))];
const relevance=(text:string,queryTerms:string[])=>queryTerms.reduce((score,term)=>score+(normalize(text).includes(term)?1:0),0);
const digest=(text:string)=>createHash('sha256').update(normalize(text)).digest('hex');
const active=(entity:Entity,s:State,observerId:string,query:string)=>storyCardState(entity,s,observerId,query).active;

export class RepetitionTracker {
 readonly facts:Set<string>;readonly phrases:Set<string>;readonly questions:Set<string>;readonly beats:Set<string>;private readonly normalized:string[];
 constructor(history:string[]=[],factIds:string[]=[]){
  this.facts=new Set(factIds);this.phrases=new Set();this.questions=new Set();this.beats=new Set();this.normalized=history.map(normalize);
  for(const original of history){const text=normalize(original),words=text.split(' ').filter(Boolean);for(let i=0;i<=words.length-6;i++)this.phrases.add(words.slice(i,i+6).join(' '));for(const question of original.match(/[^?]{3,}\?/g)??[])this.questions.add(normalize(question));for(const beat of beatNames(original))this.beats.add(beat);}
 }
 usedFact(id:string,text:string){const normalized=normalize(text);return this.facts.has(id)||normalized.length>8&&this.normalized.some(row=>row.includes(normalized));}
 review(text:string,requiredPhrases:string[]=[]){
  const required=requiredPhrases.map(normalize),words=normalize(text).split(' ').filter(Boolean),flags:Array<{kind:'phrase'|'question'|'beat';value:string}>=[],seen=new Set<string>();
  for(let i=0;i<=words.length-6;i++){const phrase=words.slice(i,i+6).join(' ');if(this.phrases.has(phrase)&&!required.some(value=>value.includes(phrase))&&!seen.has(phrase)){flags.push({kind:'phrase',value:phrase});seen.add(phrase);}}
  for(const question of text.match(/[^?]{3,}\?/g)??[]){const value=normalize(question);if(this.questions.has(value)&&!required.some(item=>item.includes(value)))flags.push({kind:'question',value});}
  for(const beat of beatNames(text))if(this.beats.has(beat)&&!required.some(item=>beatNames(item).includes(beat)))flags.push({kind:'beat',value:beat});
  return flags.slice(0,20);
 }
}
const beatNames=(text:string)=>{const value=text.toLowerCase(),beats:string[]=[];if(/\b(?:arriv|enter|step(?:s|ped)? in)\b/.test(value))beats.push('arrival');if(/\b(?:pause|silence|quiet|beat passes)\b/.test(value))beats.push('pause');if(/\b(?:glance|look(?:s|ed)? away|eyes narrow)\b/.test(value))beats.push('glance');if(/\b(?:ask|question|\?)\b/.test(value))beats.push('question');if(/\b(?:leave|depart|walk(?:s|ed)? away)\b/.test(value))beats.push('departure');return beats;};

function resolveControls(s:State,observerId:string,cards:Entity[],developer:boolean){
 const controls:NarrativeControls={pov:'third-person-limited',pacing:'measured',tone:'grounded',tension:s.settings.intensity==='grounded'?'medium':'low',spotlightId:observerId,safety:{preservePlayerAgency:true,requireConsent:true,serverTruthWins:true,excludedContent:[]},styleHints:[]};
 const rejected:ContextDecision[]=[];
 for(const card of cards.sort((a,b)=>Number(b.data.priority)-Number(a.data.priority)||a.id.localeCompare(b.id))){
  const tags=card.data.tags as string[];if(!tags.includes('directive')&&!tags.some(tag=>/^(?:pov|pacing|tone|tension|spotlight|exclude):/.test(tag)))continue;
  for(const tag of tags){
   const parts=tag.split(':'),kind=parts.shift()??'',value=parts.join(':');if(kind==='directive')continue;
   if(['agency','consent','truth','authority','tool'].includes(kind)){rejected.push({id:card.id,category:'directive',reason:'agency-or-truth-override',...(developer?{detail:tag}:{})});continue;}
   if(kind==='pov'&&['first-person','third-person','third-person-limited'].includes(value))controls.pov=value as NarrativeControls['pov'];
   else if(kind==='pacing'&&['slow','measured','brisk'].includes(value))controls.pacing=value as NarrativeControls['pacing'];
   else if(kind==='tone'&&/^[a-z0-9 -]{1,40}$/i.test(value))controls.tone=value;
   else if(kind==='tension'&&['low','medium','high'].includes(value))controls.tension=value as NarrativeControls['tension'];
   else if(kind==='spotlight'&&s.entities.some(entity=>entity.id===value&&entity.kind==='character'&&visible(s,entity,observerId)))controls.spotlightId=value;
   else if(kind==='exclude'&&/^[a-z0-9 -]{1,40}$/i.test(value))controls.safety.excludedContent.push(value);
   else if(kind!=='required'&&!['style'].includes(kind))rejected.push({id:card.id,category:'directive',reason:'unsupported-control',...(developer?{detail:tag}:{})});
  }
  if(tags.includes('style')&&card.data.description&&!rejected.some(item=>item.id===card.id&&item.reason==='agency-or-truth-override'))controls.styleHints.push(String(card.data.description));
 }
 controls.safety.excludedContent=[...new Set(controls.safety.excludedContent)].slice(0,50);controls.styleHints=controls.styleHints.slice(0,10);return {controls,rejected};
}

export function buildContextManifest(s:State,observerId:string,query:string,options:ContextBuildOptions={}):ContextManifest{
 const view=observerView(s,observerId),retrieved=retrieve(s,observerId,query,50),retrievalScores=new Map(retrieved.sources.map(source=>[source.id,source.score])),queryTerms=terms(query),maxTokens=Math.max(64,Math.min(16_000,options.maxTokens??s.settings.contextTokens)),history=options.recentConversation?.map(turn=>turn.narration)??[],tracker=new RepetitionTracker(history,options.recentFactIds),developer=options.developer??false;
 const observer=data(getEntity(s,observerId,'character'),'character'),location=view.entities.find(entity=>entity.id===observer.locationId),visibleIds=new Set(view.entities.map(entity=>entity.id));
 const activeCards=view.entities.filter(entity=>entity.kind==='storycard'&&active(entity,s,observerId,query));
 const resolved=resolveControls(s,observerId,activeCards,developer),rejected=[...resolved.rejected],candidates:ContextManifestItem[]=[];
 const add=(item:Omit<ContextManifestItem,'estimatedTokens'|'repeated'>)=>{const repeated=tracker.usedFact(item.id,item.text);candidates.push({...item,estimatedTokens:tokens(item.text),repeated});};
 add({id:'rules',priority:contextPriorities[0],rank:1,category:'rules',text:'Server rules: '+JSON.stringify({clock:s.clock,needs:s.settings.needs,fuel:s.settings.fuel,weather:s.settings.weather,romance:s.settings.romance,intimacy:s.settings.intimacy,intensity:s.settings.intensity,rulesConfigured:s.settings.rules!==null}),source:'server-settings',score:100,requiredForClarity:true});
 add({id:'observer:'+observerId,priority:contextPriorities[0],rank:1,category:'state',text:'Observer '+getEntity(s,observerId,'character').name+': '+JSON.stringify({locationId:observer.locationId,condition:observer.condition,mood:observer.mood,activity:observer.activity,goals:observer.goals}),source:'validated-state',score:100,requiredForClarity:true});
 if(location)add({id:'location:'+location.id,priority:contextPriorities[0],rank:1,category:'state',text:'Current location '+location.name+': '+String(location.data.description??''),source:'validated-state',score:100,requiredForClarity:true,claimKey:observerId+':location'});
 for(const entity of view.entities.filter(entity=>entity.id!==observerId&&(entity.data.locationId===observer.locationId||(entity.data.possessorId??entity.data.ownerId)===observerId)).slice(0,100))add({id:'scene:'+entity.id,priority:contextPriorities[0],rank:1,category:'state',text:entity.kind+' '+entity.name+': '+JSON.stringify(entity.kind==='item'?{quantity:entity.data.quantity,condition:entity.data.condition,equipped:entity.data.equipped}:{condition:entity.data.condition,activity:entity.data.activity}),source:'validated-state',score:50+relevance(entity.name,queryTerms),requiredForClarity:false});
 for(const effect of options.currentEvents??[])if(effect.observers.includes(observerId))add({id:effect.id,priority:contextPriorities[1],rank:2,category:'event',text:effect.text,source:'server-event:'+effect.type,score:90+relevance(effect.text,queryTerms),requiredForClarity:true});
 for(const turn of options.recentConversation?.slice(-4)??[]){const questions=(turn.narration.match(/[^?]{3,}\?/g)??[]).slice(-2).join(' '),text=[turn.input?'Player: '+turn.input:'',questions?'Open questions: '+questions:''].filter(Boolean).join('\n');if(text)add({id:'conversation:'+turn.id,priority:contextPriorities[1],rank:2,category:'conversation',text,source:'chronicle',score:40+relevance(text,queryTerms),requiredForClarity:false});}
 for(const fact of view.facts){const text=fact.predicate+': '+JSON.stringify(fact.objectId??fact.value)+' (truth status '+(fact.truthStatus??'verified')+'; confidence '+(fact.confidence??1)+')',score=relevance(text,queryTerms);add({id:fact.id,priority:contextPriorities[2],rank:3,category:'fact',text,source:'fact:'+(fact.source??fact.eventId)+':'+fact.eventId,score:30+score,requiredForClarity:score>0,claimKey:fact.subjectId+':'+fact.predicate});}
 for(const belief of view.beliefs){if(belief.correctedBy||belief.truthStatus==='disproven'){rejected.push({id:belief.id,category:'belief',reason:'stale-belief',...(developer?{detail:belief.proposition}:{})});continue;}const score=relevance(belief.proposition,queryTerms);add({id:belief.id,priority:contextPriorities[2],rank:3,category:'belief',text:belief.proposition+' ('+(belief.truthStatus??'believed')+' perspective; confidence '+belief.confidence+')',source:'belief:'+belief.source,score:20+score,requiredForClarity:false,claimKey:belief.subjectId&&belief.predicate?belief.subjectId+':'+belief.predicate:undefined});}
 for(const card of activeCards){const tags=card.data.tags as string[],directive=tags.includes('directive')||tags.some(tag=>/^(?:pov|pacing|tone|tension|spotlight|exclude):/.test(tag));if(resolved.rejected.some(item=>item.id===card.id&&item.reason==='agency-or-truth-override'))continue;add({id:card.id,priority:contextPriorities[3],rank:4,category:directive?'directive':'storycard',text:card.name+': '+String(card.data.description),source:String(card.data.source),score:Number(card.data.priority)+relevance(card.name+' '+card.data.description,queryTerms),requiredForClarity:tags.includes('required')||directive});}
 for(const relation of view.entities.filter(entity=>entity.kind==='relationship')){const text=relation.name+': labels '+JSON.stringify(relation.data.labels)+'; recent '+JSON.stringify((relation.data.history as unknown[]).slice(-5));add({id:relation.id,priority:contextPriorities[4],rank:5,category:'relationship',text,source:'relationship-history',score:15+relevance(text,queryTerms),requiredForClarity:false});}
 for(const memory of view.memories.filter(memory=>memory.currentSalience>0)){const text=memory.text+(memory.interpretation&&memory.interpretation!==memory.text?' Personal interpretation: '+memory.interpretation:''),score=relevance(text,queryTerms);add({id:memory.id,priority:contextPriorities[4],rank:5,category:'memory',text,source:'memory:'+memory.eventId+':refresh-'+(memory.refreshCount??0),score:memory.currentSalience*10+score,requiredForClarity:false});}
 for(const canon of canonSources(s)){const score=relevance(canon.name+' '+canon.text,queryTerms);add({id:canon.id,priority:contextPriorities[5],rank:6,category:'canon',text:canon.name+': '+canon.text,source:canon.source,score:retrievalScores.get(canon.id)??score,requiredForClarity:false});}
 for(const lore of view.entities.filter(entity=>entity.kind==='lore'&&active(entity,s,observerId,query))){const text=lore.name+': '+String(lore.data.description),score=relevance(text,queryTerms);add({id:lore.id,priority:contextPriorities[6],rank:7,category:'lore',text,source:String(lore.data.source),score:retrievalScores.get(lore.id)??Number(lore.data.priority)+score,requiredForClarity:false});}
 for(const card of activeCards.filter(card=>(card.data.tags as string[]).includes('style')))add({id:'style:'+card.id,priority:contextPriorities[6],rank:7,category:'style',text:String(card.data.description),source:'optional-style:'+card.id,score:Number(card.data.priority),requiredForClarity:false});
 for(const entity of s.entities.filter(entity=>['lore','storycard'].includes(entity.kind)&&!entity.archived&&!visibleIds.has(entity.id)))rejected.push({id:developer?entity.id:'redacted-secret',category:entity.kind as 'lore'|'storycard',reason:'secret',...(developer?{detail:entity.name}:{})});
 for(const entity of view.entities.filter(entity=>['lore','storycard'].includes(entity.kind)&&!active(entity,s,observerId,query))){const state=storyCardState(entity,s,observerId,query);rejected.push({id:entity.id,category:entity.kind as 'lore'|'storycard',reason:state.reason,...(developer?{detail:entity.name+': activates '+JSON.stringify(state.activatesWhen)+'; deactivates '+JSON.stringify(state.deactivatesWhen)}:{})});}
 candidates.sort((a,b)=>a.rank-b.rank||Number(b.requiredForClarity)-Number(a.requiredForClarity)||b.score-a.score||a.id.localeCompare(b.id));
 const included:ContextManifestItem[]=[],omitted:ContextDecision[]=[],seen=new Set<string>(),claims=new Map<string,ContextManifestItem>();let usedTokens=0;
 for(const candidate of candidates){const fingerprint=digest(candidate.text);if(seen.has(fingerprint)){omitted.push({id:candidate.id,category:candidate.category,reason:'duplicate'});continue;}if(candidate.claimKey&&claims.has(candidate.claimKey)&&claims.get(candidate.claimKey)!.text!==candidate.text){omitted.push({id:candidate.id,category:candidate.category,reason:'lower-priority-conflict'});continue;}if(candidate.repeated&&!candidate.requiredForClarity){omitted.push({id:candidate.id,category:candidate.category,reason:'repetition-damped'});continue;}if(usedTokens+candidate.estimatedTokens>maxTokens){omitted.push({id:candidate.id,category:candidate.category,reason:'budget'});continue;}included.push(candidate);seen.add(fingerprint);if(candidate.claimKey)claims.set(candidate.claimKey,candidate);usedTokens+=candidate.estimatedTokens;}
 const counts:Record<string,number>={};for(const item of included)counts['included:'+item.category]=(counts['included:'+item.category]??0)+1;for(const item of omitted)counts['omitted:'+item.reason]=(counts['omitted:'+item.reason]??0)+1;for(const item of rejected)counts['rejected:'+item.reason]=(counts['rejected:'+item.reason]??0)+1;
 return {version:2,observerId,clock:s.clock,query:developer?query:'',priorityLadder:contextPriorities,budget:{maxTokens,usedTokens},controls:resolved.controls,included,omitted,rejected,counts};
}

export function contextBrief(s:State,observerId:string,query:string,byteLimit=4000,options:Omit<ContextBuildOptions,'maxTokens'>={}){
 const limit=Math.max(256,Math.min(64_000,byteLimit)),manifest=buildContextManifest(s,observerId,query,{...options,maxTokens:Math.max(64,Math.floor(limit/4))});
 const sources:ContextSource[]=manifest.included.map(item=>({id:item.id,layer:item.category,text:item.text,source:item.source,priority:item.priority}));
 const summary:Record<string,unknown>={version:2,observerId,clock:s.clock,sources,omitted:manifest.omitted.length+manifest.rejected.length,manifest:{budget:manifest.budget,controls:manifest.controls,included:manifest.included.map(item=>item.id),omitted:manifest.omitted.map(item=>({id:item.id,reason:item.reason})),rejected:manifest.rejected.map(item=>({id:item.id,reason:item.reason}))}};
 const size=()=>Buffer.byteLength(JSON.stringify(summary));const compact=summary.manifest as {controls?:unknown;included:string[];omitted:unknown[];rejected:unknown[]};
 while(size()>limit&&sources.length){const removed=sources.pop()!;compact.included=compact.included.filter(id=>id!==removed.id);summary.omitted=Number(summary.omitted)+1;}
 while(size()>limit&&compact.rejected.length)compact.rejected.pop();while(size()>limit&&compact.omitted.length)compact.omitted.pop();if(size()>limit)delete compact.controls;
 if(size()>limit)return {version:2,observerId,clock:s.clock,sources:[],omitted:manifest.included.length+manifest.omitted.length+manifest.rejected.length};return summary;
}

export type CharacterDriftEvidence={npcId:string;text:string;traitIds?:string[];goalRefs?:string[];knowledgeFactIds?:string[];mood?:string;historyEventIds?:string[]};
export function checkCharacterDrift(s:State,evidence:CharacterDriftEvidence){
 const npc=getEntity(s,evidence.npcId,'character'),character=data(npc,'character'),flags:Array<{kind:'trait'|'goal'|'knowledge'|'mood'|'history';value:string}>=[];
 if(character.playable)flags.push({kind:'history',value:'player_character_not_npc'});
 const traits=new Set(character.traits),goals=new Set(character.goals),known=new Set(s.knowledge.filter(row=>row.observerId===npc.id).map(row=>row.factId)),history=new Set([...s.memories.filter(row=>row.observerId===npc.id).map(row=>row.eventId),...s.entities.filter(entity=>entity.kind==='relationship'&&(entity.data.fromId===npc.id||entity.data.toId===npc.id)).flatMap(entity=>(entity.data.history as Array<{eventId:string}>).map(row=>row.eventId))]);
 for(const id of evidence.traitIds??[])if(!traits.has(id))flags.push({kind:'trait',value:id});for(const goal of evidence.goalRefs??[])if(!goals.has(goal))flags.push({kind:'goal',value:goal});for(const id of evidence.knowledgeFactIds??[])if(!known.has(id))flags.push({kind:'knowledge',value:id});if(evidence.mood!==undefined&&evidence.mood!==character.mood)flags.push({kind:'mood',value:evidence.mood});for(const id of evidence.historyEventIds??[])if(!history.has(id))flags.push({kind:'history',value:id});
 return {accepted:flags.length===0,decision:flags.some(flag=>['knowledge','trait','goal'].includes(flag.kind))?'retry' as const:flags.length?'developer-review' as const:'accept' as const,flags,response:evidence.text};
}

export function reviewMechanicalClaims(text:string,effects:Effect[]=[]){
 const emitted=new Set(effects.map(effect=>effect.type)),claims:Array<{pattern:RegExp;eventTypes:string[];value:string}>=[
  // Ambiguous words such as fire/discharge need weapon context, not a fireplace or hospital.
  {pattern:/\b(?:gunfire|gunshots?|shots? (?:rings?|rang|strikes?|struck|misses|missed)|open(?:s|ed|ing)? fire)\b|\b(?:fires?|fired|firing|discharg(?:e|ed|es|ing))\b[^.!?;\n]{0,32}\b(?:gun|firearm|pistol|rifle|shotgun|revolver|weapon|rounds?|bullets?)\b|\b(?:gun|firearm|pistol|rifle|shotgun|revolver|weapon)\b(?:\s+(?:was|were|had|been|suddenly|then))?\s+(?:fires?|fired|discharg(?:ed|es))\b/i,eventTypes:['weapon.shot'],value:'shot'},
  {pattern:/\breload(?:s|ed|ing)?\b|\b(?:loads?|loaded|loading) (?:a |the )?(?:gun|firearm|pistol|rifle|weapon|magazine)\b/i,eventTypes:['weapon.reload'],value:'reload'},
  {pattern:/\bempty[- ]click(?:s|ed)?\b|\b(?:gun|firearm|pistol|rifle|shotgun|revolver|weapon|trigger)\b(?:\s+(?:only|just|merely|gave|produced|made|an?|the|dry|hollow|empty)){0,4}\s+click(?:s|ed)?\b|\bclick(?:s|ed)?\s+(?:of|from)\s+(?:(?:an?|the|his|her|their|empty)\s+){0,3}(?:gun|firearm|pistol|rifle|shotgun|revolver|weapon|trigger)\b/i,eventTypes:['weapon.empty-click'],value:'empty-click'},
  {pattern:/\b(?:spent )?casings?\b/i,eventTypes:['weapon.shot'],value:'casing'},
  {pattern:/\bdisarm(?:s|ed|ing)?\b/i,eventTypes:['weapon.disarmed'],value:'disarmed-weapon'},
  {pattern:/\brecover(?:s|ed|ing)?\b.{0,40}\b(?:gun|weapon|firearm|pistol|rifle)\b|\b(?:gun|weapon|firearm|pistol|rifle)\b.{0,40}\brecover(?:s|ed|ing)?\b/i,eventTypes:['weapon.recovered'],value:'recovered-weapon'},
  {pattern:/\b(?:restrain(?:s|ed|ing)?|handcuff(?:s|ed|ing)?)\b/i,eventTypes:['combat.restrained'],value:'restraint'},
  {pattern:/\bgrappl(?:e|es|ed|ing)\b/i,eventTypes:['combat.grappled'],value:'grapple'},
  {pattern:/\bsurrender(?:s|ed|ing)?\b/i,eventTypes:['combat.surrendered'],value:'surrender'},
  {pattern:/\b(?:flees?|fled)\b/i,eventTypes:['combat.fled'],value:'combat-flee'},
  {pattern:/\b(?:caught|intercepted)\b.{0,30}\b(?:chase|pursuit|quarry|suspect)\b|\b(?:chase|pursuit|quarry|suspect)\b.{0,30}\b(?:caught|intercepted)\b/i,eventTypes:['chase.caught'],value:'chase-caught'},
  {pattern:/\b(?:escaped?|got away)\b.{0,30}\b(?:chase|pursuit|pursuer)\b|\b(?:chase|pursuit|pursuer)\b.{0,30}\b(?:escaped?|got away)\b/i,eventTypes:['chase.escaped'],value:'chase-escaped'},
  {pattern:/\b(?:crash(?:es|ed|ing)?|collision)\b/i,eventTypes:['chase.collision','vehicle.damage'],value:'collision'}
 ];
 return claims.filter(claim=>claim.pattern.test(text)&&!claim.eventTypes.some(type=>emitted.has(type))).map(claim=>({kind:'unsupported-mechanical-claim',value:claim.value}));
}

export function reviewNarrativeOutput(text:string,controls:NarrativeControls,repetition:RepetitionTracker,requiredPhrases:string[]=[],effects:Effect[]=[]){
 const flags:Array<{kind:string;value:string}>=[...repetition.review(text,requiredPhrases),...reviewMechanicalClaims(text,effects)];for(const excluded of controls.safety.excludedContent)if(normalize(text).includes(normalize(excluded)))flags.push({kind:'safety',value:excluded});
 // A broad beat or one short phrase overlap is normal continuity. Reject only substantial
 // phrase reuse (three overlapping six-word windows), exact repeated questions, or hard rules.
 const phraseCount=flags.filter(flag=>flag.kind==='phrase').length,blocking=flags.filter(flag=>flag.kind!=='beat'&&(flag.kind!=='phrase'||phraseCount>=3));
 return {accepted:blocking.length===0,decision:blocking.length?'retry' as const:'accept' as const,flags};
}
