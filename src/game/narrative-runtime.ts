import {conversationState} from './communication.ts';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {ensure} from '../contracts.ts';
import {data,getEntity,type State} from './model.ts';
import type {Effect} from './simulation.ts';
import {observerView} from './epistemics.ts';
import {narrativeProfileSchema,paragraphTargets,type NarrativeProfile} from './narrative-profile.ts';
export const narrativeValidatorVersion='narrative-validator-v1';
export type NarrativeFact={id:string;text:string;classification:'REQUIRED'|'OPTIONAL'|'HIDDEN'|'UI_ONLY';detailClass:'state-backed'|'event-backed'|'authorized-generated-canon'|'decorative'|'invalid';source:string;order:number;exact:boolean;alternatives:string[];speakerId?:string;sense?:string};
export type NarrativeBundle={version:1;mode:'GAME'|'STORY';profile:NarrativeProfile;profileLayers:unknown[];actorId:string;actorName:string;turnId:string;eventIds:string[];clock:string;locationId:string|null;locationFingerprint:string;facts:NarrativeFact[];focus:Array<{id:string;name:string;role:'primary'|'secondary'|'background';voice:unknown}>;control:unknown;suppression:ReturnType<typeof suppressionManifest>;continuity:ReturnType<typeof conversationContinuity>;content:{excluded:string[];mature:string};playerAuthorship:{text:string;private:true};};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const factId=(s:string)=>{const h=hash(s);return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);};
const normalize=(s:string)=>s.toLowerCase().replace(/[“”]/g,'"').replace(/\s+/g,' ').trim();
const semantic=(s:string)=>normalize(s).replace(/\bi don't know\b/g,'i do not know').replace(/\b(?:hello|hey)\b/g,'hi').replace(/\b(?:goodbye|farewell)\b/g,'bye').replace(/\bthanks\b/g,'thank you').replace(/[^a-z0-9' ]/g,'').trim();
const gesturePatterns:Record<string,RegExp>={jaw:/jaw.{0,14}(?:clench|tighten)|teeth.{0,10}grit/i,breath:/breath.{0,15}(?:hitch|catch|caught)/i,eyes:/eyes?.{0,15}(?:darken|narrow)/i,silence:/silence (?:stretch|settle)|charged air|palpable tension/i,smirk:/smirk|lips? quirke?/i,smoking:/smok(?:e|ing)|cigarette/i,sipping:/sipp?(?:ed|ing)?\b/i,phone:/phone.{0,15}(?:buzz|vibrat)/i,neck:/rubb?(?:ed|ing)?.{0,15}neck/i,doorway:/lean.{0,16}doorway/i,therapy:/hold space|validat(?:e|ing) (?:your|his|her) feelings|process (?:your|his|her) trauma/i,noir:/city never sleeps|trouble walked in|streets swallowed|rain washed nothing clean/i,romance:/electric touch|magnetic pull|primal|feral|predator.{0,10}prey/i};
export function suppressionManifest(history:string[],profile:NarrativeProfile){
 const recent=history.slice(-50),categories=Object.entries(gesturePatterns).filter(([,pattern])=>recent.slice(-8).some(t=>pattern.test(t))).map(([name])=>name),openings=recent.slice(-8).flatMap(t=>t.split(/\n\n/).map(p=>normalize(p).split(' ').slice(0,4).join(' '))),endings=recent.slice(-8).map(t=>normalize(t).split(' ').slice(-5).join(' '));
 const phrases=[...profile.discouragedPatterns,...['jaw clenched','breath hitched','eyes darkened','flicker of something','weight of','charged air','palpable tension','throat bob','lips quirked','for a moment','the kind of silence that']].filter(p=>recent.slice(-8).some(t=>normalize(t).includes(normalize(p))));
 const cooldowns=[...profile.phraseCooldowns.map(p=>({phrase:p.phrase,turns:p.turns})),...profile.motifs.map(m=>({phrase:m.phrase,turns:m.cooldownTurns}))].filter(p=>recent.slice(-p.turns).some(t=>normalize(t).includes(normalize(p.phrase))));
 return {categories,phrases:[...new Set([...phrases,...cooldowns.map(p=>p.phrase)])],openings:[...new Set(openings)],endings:[...new Set(endings)]};
}
export function conversationContinuity(turns:Array<{input?:string;narration:string}>){
 const questions:string[]=[],answers:string[]=[],positions:string[]=[],interruptions:string[]=[];let topic='';
 for(const turn of turns.slice(-8)){const text=[turn.input??'',turn.narration].join('\n');for(const q of text.match(/[^.!?\n]{2,}\?/g)??[]){const question=q.trim();questions.push(question);topic=question;}const lines=text.split(/[\n.!]+/).map(s=>s.trim()).filter(Boolean);answers.push(...lines.filter(t=>!t.includes('?')).slice(-3));positions.push(...lines.filter(t=>/\b(?:will not|won't|refuse|agree|do not|don't)\b/i.test(t)));interruptions.push(...lines.filter(t=>/interrupt|—$|\.\.\.$/.test(t)));}
 const repeated=questions.filter((q,i)=>questions.slice(0,i).some(old=>normalize(old)===normalize(q)));
 // Questions remain unresolved unless a canonical answer relationship says otherwise;
 // proximity of prose alone is never proof that a question has been answered.
 return {topic,unresolvedQuestions:[...new Set(questions)].slice(-12),previousAnswers:answers.slice(-12),statedPositions:positions.slice(-8),interruptions:interruptions.slice(-8),repeatedQuestions:[...new Set(repeated)],unfinishedSentences:interruptions.filter(t=>/—$|\.\.\.$/.test(t))};
}
export function presentFact(text:string,profile:NarrativeProfile,actorName:string,exact=false):string{
 if(exact){const quote=text.search(/[“*]/);return quote<0?text:presentFact(text.slice(0,quote),profile,actorName,false)+text.slice(quote);}
 const escaped=actorName.replace(/[.*+?^$\{\}()|[\]\\]/g,'\\$&');
 const subject=profile.perspective==='first'?'I':profile.perspective==='second'?'You':actorName,possessive=profile.perspective==='first'?'my':profile.perspective==='second'?'your':actorName+"'s";
 // Transform presentation grammar only. Literal quoted speech remains byte-for-byte.
 return text.split(/("[^"\n]*"|“[^”\n]*”|\*[^*\n]*\*)/g).map((part,index)=>{
  if(index%2)return part;
  let prose=part.replace(/\b[Yy]our\b/g,possessive).replace(/\b[Yy]ou\b/g,subject);
  if(profile.perspective!=='third'&&escaped){prose=prose.replace(new RegExp(escaped+"['’]s\\b",'g'),possessive);prose=prose.replace(new RegExp('\\b(at|to|from|with|for|toward) '+escaped+'\\b','g'),(_m,preposition)=>preposition+' '+(profile.perspective==='first'?'me':'you'));} 
  if(profile.perspective!=='third'&&escaped)prose=prose.replace(new RegExp('(^|[.!?]\\s+)'+escaped+'(?=\\s)','g'),(_m,prefix)=>prefix+subject);
  const verbs:Record<string,string>={travels:'traveled',passes:'passed',advances:'advanced',signs:'signed',writes:'wrote',whispers:'whispered',shouts:'shouted',draws:'drew',gives:'gave',receives:'received',pays:'paid',buys:'bought',sells:'sold',eats:'ate',drinks:'drank',asks:'asked',answers:'answered',refuses:'refused',continues:'continued',stops:'stopped',starts:'started',finds:'found',notices:'noticed',feels:'felt',needs:'needed',wants:'wanted',knows:'knew',sends:'sent',calls:'called',speaks:'spoke',works:'worked',rests:'rested',wakes:'woke',loses:'lost',gains:'gained',drops:'dropped',picks:'picked',becomes:'became',breaks:'broke',unlocks:'unlocked',locks:'locked',arrives:'arrived',is:'was',are:'were',am:'was',has:'had',have:'had',does:'did',goes:'went',go:'went',takes:'took',take:'took',moves:'moved',move:'moved',waits:'waited',wait:'waited',opens:'opened',open:'opened',closes:'closed',close:'closed',misses:'missed',miss:'missed',hits:'hit',fires:'fired',fire:'fired',reloads:'reloaded',reload:'reloaded',says:'said',say:'said',walks:'walked',walk:'walked',arrive:'arrived',remains:'remained',remain:'remained',begins:'began',begin:'began',accepts:'accepted',accept:'accepted',fails:'failed',fail:'failed',resolves:'resolved',resolve:'resolved',hears:'heard',hear:'heard',sees:'saw',see:'saw',holds:'held',hold:'held',stands:'stood',stand:'stood',sits:'sat',sit:'sat',leaves:'left',leave:'left',returns:'returned',return:'returned',looks:'looked',look:'looked',sleeps:'slept',sleep:'slept'};
  const inflect=(dictionary:Record<string,string>,past:boolean)=>prose.replace(/\b[a-z]+\b/g,(word,offset)=>{if(!dictionary[word])return word;const previous=prose.slice(0,offset).trim().split(/\s+/).at(-1)?.toLowerCase()??'';if(['to','can','could','will','would','may','might','must','should','not','a','an','the','my','your','his','her','their','our'].includes(previous))return word;if(!past&&['is','are','was','were','be','been','has','have','had','remains','remained'].includes(previous))return word;if(past&&['open','close','look','stand','sleep','return','move','wait','fire','reload','go','take','leave','walk','hear','see','hold','sit','fail','resolve','accept','begin'].includes(word)&&!['i','you','we','they',actorName.toLowerCase()].includes(previous))return word;return dictionary[word]!;});
  if(profile.tense==='past')prose=inflect(verbs,true);
  else {const reverse:Record<string,string>={traveled:'travels',travelled:'travels',passed:'passes',advanced:'advances',signed:'signs',wrote:'writes',whispered:'whispers',shouted:'shouts',drew:'draws',gave:'gives',received:'receives',paid:'pays',bought:'buys',sold:'sells',ate:'eats',drank:'drinks',asked:'asks',answered:'answers',refused:'refuses',continued:'continues',stopped:'stops',started:'starts',found:'finds',noticed:'notices',felt:'feels',needed:'needs',wanted:'wants',knew:'knows',sent:'sends',called:'calls',spoke:'speaks',worked:'works',rested:'rests',woke:'wakes',lost:'loses',gained:'gains',dropped:'drops',picked:'picks',became:'becomes',broke:'breaks',unlocked:'unlocks',locked:'locks',was:'is',were:'are',had:'has',did:'does',went:'goes',took:'takes',moved:'moves',waited:'waits',opened:'opens',closed:'closes',missed:'misses',fired:'fires',reloaded:'reloads',said:'says',walked:'walks',arrived:'arrives',remained:'remains',began:'begins',accepted:'accepts',failed:'fails',resolved:'resolves',heard:'hears',saw:'sees',held:'holds',stood:'stands',sat:'sits',left:'leaves',returned:'returns',looked:'looks',slept:'sleeps'};prose=inflect(reverse,false);}
  if(profile.perspective==='first')prose=prose.replace(/\bI were\b/g,'I was');if(profile.perspective==='second')prose=prose.replace(/\bYou was\b/g,'You were');
  if(profile.tense==='present'&&profile.perspective!=='third'){const pronoun=profile.perspective==='first'?'I':'You';prose=prose.replace(new RegExp('\\b'+pronoun+' (is|has|does|[a-z]+s)\\b','g'),(_m,verb)=>pronoun+' '+(verb==='is'?(pronoun==='I'?'am':'are'):verb==='has'?'have':verb==='does'?'do':verb.endsWith('es')&&/^(goes|watches|misses)$/.test(verb)?verb.slice(0,-2):verb.slice(0,-1)));}
  return prose;
 }).join('');
}
export function buildNarrativeBundle(input:{state:State;before:State;actorId:string;turnId:string;effects:Effect[];profile:NarrativeProfile;layers:unknown[];mode:'GAME'|'STORY';control:unknown;playerText:string;recent:Array<{input?:string;narration:string}>;previousLocationFingerprint?:string;excluded?:string[];projection?:ReturnType<typeof observerView>}){
 const {state:s,actorId,turnId,profile,mode}=input,view=input.projection??observerView(s,actorId),self=view.entities.find(e=>e.id===actorId)!,actual=data(getEntity(s,actorId,'character'),'character'),location=view.entities.find(e=>e.id===actual.locationId),facts:NarrativeFact[]=[];
 const add=(key:string,text:string,classification:NarrativeFact['classification'],source:string,exact=false,alternatives:string[]=[],speakerId?:string,sense?:string)=>facts.push({id:factId(turnId+':'+key),text,classification,detailClass:source.startsWith('event:')?'event-backed':'state-backed',source,order:facts.length,exact,alternatives,...(speakerId?{speakerId}:{}),...(sense?{sense}:{})});
 if(location)add('location',self.name+' was at '+location.name+'.','REQUIRED','state:location');
 for(const effect of input.effects.filter(e=>e.observers.includes(actorId))){
  const dialogue=effect.dialogue,playerSpeech=effect.type==='player.dialogue'&&effect.subjectId===actorId,ui=/^(?:check|time|inventory|money|funds|notice|resolution\.applied)(?:\.|$)/.test(effect.type),classification=ui||mode==='STORY'&&playerSpeech?'UI_ONLY':'REQUIRED';
  let text=effect.text,alternatives:string[]=[];
  if(effect.travel){const trip=effect.travel,origin=view.entities.find(e=>e.id===trip.originId)?.name??(data(getEntity(input.before,actorId,'character'),'character').locationId===trip.originId?input.before.entities.find(e=>e.id===trip.originId)?.name:undefined)??'the departure point',destination=view.entities.find(e=>e.id===trip.destinationId)?.name??'the destination',passengers=trip.passengerIds.filter(id=>id!==actorId).flatMap(id=>{const person=view.entities.find(e=>e.id===id);return person?[person.name]:[];});text=self.name+' traveled from '+origin+' toward '+destination+' by '+trip.mode+' for '+trip.minutes+' minutes'+(passengers.length?', with '+passengers.join(', '):'')+'. '+effect.text;}

  if(dialogue?.comprehension==='full'){
   const name=view.entities.find(e=>e.id===dialogue.speakerId)?.name??'Someone';text=dialogue.method==='sign'?name+' signed, '+(profile.signedDialogueStyle==='italics'?'*'+dialogue.text+'*':'“'+dialogue.text+'”'):dialogue.method==='write'?name+' wrote, “'+dialogue.text+'”':name+(dialogue.volume==='whisper'?' whispered':dialogue.volume==='shout'?' shouted':dialogue.tone==='quiet'?' said quietly':dialogue.tone==='firm'?' said firmly':dialogue.tone==='warm'?' said warmly':' said')+', “'+dialogue.text+'”';
   if(!dialogue.exact&&!/\b(?:kill|shoot|threat|promise|owe|confess|love|marry)\b/i.test(dialogue.text)){
    const speaker=s.entities.find(e=>e.id===dialogue.speakerId),voice=speaker?.kind==='character'?data(speaker,'character').voiceProfile:null;
    const equivalents=voice?.equivalents.filter(e=>!e.exact&&e.canonical===dialogue.text&&(e.register==='any'||e.register===dialogue.register)).flatMap(e=>e.alternatives)??[];
    if(semantic(dialogue.text)==='hi')equivalents.push('Hello.','Hi.');if(semantic(dialogue.text)==='thank you')equivalents.push('Thank you.','Thanks.');
    alternatives=equivalents.filter(t=>semantic(t)===semantic(dialogue.text)&&(voice?.sentenceLength!=='terse'||t.split(/\s+/).length<=12)&&!voice?.forbiddenTendencies.some(p=>normalize(t).includes(normalize(p)))).map(t=>text.replace(dialogue.text,t));
   }
  }
  facts.push({id:effect.id,text,classification,detailClass:'event-backed',source:'event:'+effect.type,order:facts.length,exact:!!dialogue||playerSpeech,alternatives,speakerId:dialogue?.speakerId??(playerSpeech?actorId:undefined)});
 }
 const descriptor=location?JSON.stringify({description:location.data.description,details:(location.data.narrative as {details?:Array<{visibility:string}>}|null)?.details?.filter(d=>d.visibility==='public')}):'',fingerprint=hash(descriptor);
 if(location){const rich=location.data.narrative as {details?:Array<{id:string;text:string;visibility:string;layer:string;sense:string}>}|null;
  if(fingerprint!==input.previousLocationFingerprint){if(location.data.description&&!input.effects.some(e=>e.observers.includes(actorId)&&e.text.includes(String(location.data.description)))){const descriptions=[...new Set(String(location.data.description).split(/\n\s*\n/).map(t=>t.trim()).filter(t=>t&&t.length<=4000))];for(const [i,description] of descriptions.slice(0,20).entries())add('description:'+i,description,'OPTIONAL','state:location-description');}for(const detail of (rich?.details??[]).filter(d=>d.visibility==='public').sort((a,b)=>['immediate','current','structural'].indexOf(a.layer)-['immediate','current','structural'].indexOf(b.layer)))add('detail:'+detail.id,detail.text,'OPTIONAL','state:location-detail',false,[],undefined,detail.sense);}
 }
 for(const item of view.entities.filter(e=>e.kind==='item'&&e.data.locationId===actual.locationId&&actual.locationId)){const before=input.before.entities.find(e=>e.id===item.id),mechanism=item.data.mechanism as {open?:boolean}|undefined;if(mechanism&&Number(item.data.condition)<100)add('condition:'+item.id,item.name+' remained damaged.','REQUIRED','state:persistent-damage');else if(before&&before.data.condition!==item.data.condition)add('condition:'+item.id,item.name+' had changed condition.','REQUIRED','state:item-condition');}
 const combat=view.entities.find(e=>e.kind==='combat'&&e.data.active);if(combat)for(const [id,position] of Object.entries(combat.data.positions??{})){const person=view.entities.find(e=>e.id===id);if(person)add('position:'+id,person.name+' held position '+String(position)+'.','REQUIRED','state:combat-position');}
 const focus=view.entities.filter(e=>e.kind==='character'&&e.id!==actorId&&actual.locationId&&e.data.locationId===actual.locationId).map(e=>{const full=s.entities.find(x=>x.id===e.id)!;const involved=input.effects.some(f=>f.subjectId===e.id&&f.observers.includes(actorId));return {id:e.id,name:e.name,role:involved?'primary' as const:'background' as const,voice:full.data.voiceProfile??null};}).sort((a,b)=>Number(b.role==='primary')-Number(a.role==='primary')||a.id.localeCompare(b.id));
 return {version:1 as const,mode,profile,profileLayers:input.layers,actorId,actorName:self.name,turnId,eventIds:[...new Set(input.effects.map(e=>e.id))],clock:s.clock,locationId:actual.locationId,locationFingerprint:fingerprint,facts,focus,control:input.control,suppression:suppressionManifest(input.recent.map(t=>t.narration),profile),continuity:{...conversationContinuity(input.recent.map(t=>({narration:t.narration}))),...(()=>{const c=conversationState(s,actorId);return {topic:c.topic,unresolvedQuestions:c.unresolvedQuestions.map(q=>q.text),previousAnswers:c.previousAnswers.map(a=>a.text)};})()},content:{excluded:input.excluded??[],mature:s.settings.intimacy},playerAuthorship:{text:input.playerText,private:true as const}} satisfies NarrativeBundle;
}
export function narrativeChoices(bundle:NarrativeBundle){return bundle.facts.filter(f=>f.classification==='REQUIRED'||f.classification==='OPTIONAL').map(f=>({...f,variants:[...new Set([f.text,...f.alternatives].map(t=>presentFact(t,bundle.profile,bundle.actorName,f.exact)))]}));}
export function selectedNarrativeChoices(bundle:NarrativeBundle){
 const optionalLimit=bundle.profile.descriptionDensity==='sparse'?0:Math.min(bundle.profile.descriptionDensity==='rich'?12:4,({short:1,medium:3,long:7,'very-long':12})[bundle.profile.responseLength]);let optional=0,smells=0;
 return narrativeChoices(bundle).filter(f=>{if(f.classification==='REQUIRED')return true;if(optional>=optionalLimit||f.sense&&bundle.profile.sensoryDensity==='low'||f.sense==='smell'&&smells++>=1)return false;
 if([...bundle.suppression.phrases,...bundle.profile.forbiddenPatterns,...bundle.content.excluded].some(p=>normalize(f.text).includes(normalize(p)))||bundle.suppression.categories.some(c=>gesturePatterns[c]?.test(f.text)))return false;optional++;return true;});
}
export function deterministicDraft(bundle:NarrativeBundle){
 const selected=selectedNarrativeChoices(bundle),paragraphs:Array<{sourceIds:string[];text:string}>=[],groupSize=bundle.profile.responseLength==='short'||bundle.profile.pacing==='fast'?3:2;let priorSpeaker:string|undefined;
 for(const f of selected){const prior=paragraphs.at(-1),speaker=f.speakerId;if(prior&&prior.sourceIds.length<groupSize&&!speaker&&!priorSpeaker){prior.sourceIds.push(f.id);prior.text+=' '+f.variants[0];}else paragraphs.push({sourceIds:[f.id],text:f.variants[0]!});priorSpeaker=speaker;}
 return {paragraphs};
}
export function deterministicNarrative(bundle:NarrativeBundle){return deterministicDraft(bundle).paragraphs.map(p=>p.text).join('\n\n')||'No further observable change was recorded.';}
const draftSchema=z.strictObject({additions:z.array(z.unknown()).max(0).optional(),paragraphs:z.array(z.strictObject({sourceIds:z.array(z.uuid()).min(1).max(50),text:z.string().min(1).max(4000)})).max(200)});
export function validateNarrativeDraft(raw:unknown,bundle:NarrativeBundle){
 if(raw&&typeof raw==='object'&&'additions'in raw&&Array.isArray(raw.additions))ensure(raw.additions.length===0,400,'narration_cannot_mutate_world');
 const draft=draftSchema.parse(raw),choices=narrativeChoices(bundle),index=new Map(choices.map(f=>[f.id,f])),used=new Set<string>(),repairs:Array<{kind:string;sourceIds:string[]}>=[];let previous=-1;
 const paragraphs:string[]=[],selected=new Set(selectedNarrativeChoices(bundle).map(f=>f.id));
 for(const paragraph of draft.paragraphs){const sources=paragraph.sourceIds.map(id=>{const f=index.get(id);ensure(f,400,'narrative_unknown_source');ensure(!used.has(id),400,'narrative_duplicate_event');ensure(f.order>previous,400,'narrative_endpoint_order');previous=f.order;used.add(id);return f;});
  const expected=sources.map(f=>f.variants[0]).join(' '),provided=paragraph.text.trim(),normalized=(s:string)=>s.replace(/\s+/g,' ').trim();
  // Compare against finite, trusted realizations rather than accepting model claims
  // that an arbitrary new sentence is equivalent. Single-source casual dialogue
  // may choose a verified equivalent; compound paragraphs preserve exact facts.
  const accepted=sources.length===1?sources[0]!.variants.some(v=>normalized(v)===normalized(provided)):normalized(expected)===normalized(provided);
  let text=provided;if(accepted&&sources.some(f=>f.exact)){const literal=sources.length===1?sources[0]!.variants.find(v=>normalized(v)===normalized(provided))!:expected;if(text!==literal){text=literal;repairs.push({kind:'literal-format',sourceIds:paragraph.sourceIds});}}
  if(!accepted){const rawSource=sources.map(f=>f.text).join(' '),otherProfiles=(['first','second','third'] as const).flatMap(p=>(['past','present'] as const).map(t=>sources.map(f=>presentFact(f.text,{...bundle.profile,perspective:p,tense:t},bundle.actorName,f.exact)).join(' ')));
   ensure(normalized(rawSource)===normalized(provided)||otherProfiles.some(v=>normalized(v)===normalized(provided)),400,'narrative_unsupported_claim');text=expected;repairs.push({kind:'pov-tense',sourceIds:paragraph.sourceIds});
  }
  if(sources.some(f=>!selected.has(f.id))){const kept=sources.filter(f=>selected.has(f.id));repairs.push({kind:'optional-detail-trim',sourceIds:sources.filter(f=>!selected.has(f.id)).map(f=>f.id)});if(!kept.length)continue;text=kept.map(f=>f.variants[0]).join(' ');}
  const optional=sources.every(f=>f.classification==='OPTIONAL'),suppressed=bundle.suppression.phrases.some(p=>normalize(text).includes(normalize(p)))||bundle.suppression.categories.some(category=>gesturePatterns[category]?.test(text));
  if(optional&&suppressed){repairs.push({kind:'repetition-trim',sourceIds:paragraph.sourceIds});continue;}
  // Essential truth and literal speech outrank style filters; filters cannot erase
  // a required action or canonical threat. Optional texture is safely removable.
  if(optional&&[...bundle.profile.forbiddenPatterns,...bundle.content.excluded].some(p=>normalize(text).includes(normalize(p)))){repairs.push({kind:'content-trim',sourceIds:paragraph.sourceIds});continue;}
  paragraphs.push(text);
 }
 ensure(choices.filter(f=>f.classification==='REQUIRED').every(f=>used.has(f.id)),400,'narrative_missing_required_fact');
 const text=paragraphs.join('\n\n');ensure(Buffer.byteLength(text)<=24000,400,'narration_too_large');return {text:text||deterministicNarrative(bundle),repairs,validatorVersion:narrativeValidatorVersion,paragraphTarget:paragraphTargets[bundle.profile.responseLength]};
}
