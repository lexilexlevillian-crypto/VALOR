import {reception} from './narrative-perception.ts';
import {data,getEntity,type State} from './model.ts';
import {emit,type Effect} from './simulation.ts';
import {fact,visible} from './epistemics.ts';
import {communicationProfileSchema} from './narrative-profile.ts';
import {ensure} from '../contracts.ts';
export type Communication={method:'say'|'sign'|'write';language:string;targetId:string|null;text:string;tone?:string;volume?:'whisper'|'normal'|'shout';replyToFactId?:string;requiresResponse?:boolean};
export function communicate(s:State,speakerId:string,input:Communication,eventId:string,effects:Effect[],exact=true){
 const speaker=getEntity(s,speakerId,'character'),c=data(speaker,'character'),profile=communicationProfileSchema.parse(c.communication??{}),channel=input.method==='say'?'spoken':input.method==='sign'?'signed':'written';
 ensure(c.condition==='conscious',400,'character_cannot_communicate');ensure(input.method!=='say'||profile.canSpeak,400,'speech_unavailable');ensure((profile.languages[input.language]?.[channel]??0)>0,400,'communication_language_unavailable');
 const target=input.targetId?getEntity(s,input.targetId,'character'):null;ensure(!target||target.data.locationId===c.locationId&&c.locationId&&visible(s,target,speakerId),400,'communication_target_unavailable');
 const location=c.locationId?s.entities.find(e=>e.id===c.locationId):null,noise=Number(location?.data.noise??0);
 const audience=s.entities.filter(e=>e.kind==='character'&&!e.archived&&e.data.condition==='conscious'&&(e.id===speakerId||c.locationId!==null&&e.data.locationId===c.locationId));
 const understood:string[]=[];
 for(const person of audience){
  const self=person.id===speakerId,isTarget=person.id===target?.id,canReceive=self||(input.method==='write'?(target?isTarget:visible(s,speaker,person.id)):input.method==='sign'?visible(s,speaker,person.id):input.volume==='whisper'?noise<25&&(target?isTarget:true):noise<(input.volume==='shout'?100:70));
  const received=reception(s,speakerId,person.id,input.method,input.volume);if(!canReceive||received===0)continue;
  const receiver=communicationProfileSchema.parse(data(person,'character').communication??{}),level=self?100:Math.min(received,profile.languages[input.language]?.[channel]??0,receiver.languages[input.language]?.[channel]??0),comprehension=level>=80?'full':level>0?'partial':'none';
  const text=comprehension==='full'?(input.method==='say'?input.text:speaker.name+(input.method==='sign'?' signed, *':' wrote, “')+input.text+(input.method==='sign'?'*':'”')):speaker.name+(input.method==='sign'?' signed':input.method==='write'?' wrote':' spoke')+' in '+input.language+(comprehension==='partial'?'; only fragments were understood.':'; the words were not understood.');
  emit(effects,text,[person.id],c.playable?'player.dialogue':'npc.dialogue',speakerId);
  const relation=target?s.entities.find(e=>e.kind==='relationship'&&e.data.fromId===speakerId&&e.data.toId===target.id):undefined,labels=(relation?.data.labels??[]) as string[],register=labels.some(l=>['marry','date','commit','cohabit'].includes(l))?'intimate':labels.some(l=>['sibling','family','parent','child'].includes(l))?'family':labels.includes('enemy')?'enemy':labels.some(l=>['coworker','boss','employee','professional'].includes(l))?'professional':'stranger';
  effects.at(-1)!.dialogue={speakerId,register,tone:input.tone??'neutral',volume:input.volume??'normal',targetId:input.targetId,requiresResponse:input.requiresResponse??false,method:input.method,language:input.language,exact:exact||c.playable,text:comprehension==='full'?input.text:'',comprehension};
  if(comprehension==='full')understood.push(person.id);
 }
 // The fact records the utterance, not the truth of its claim. Unknown language
 // creates neither a translation nor propositional knowledge for that listener.
 fact(s,speakerId,'communicated',{speakerId,method:input.method,language:input.language,text:input.text,targetId:input.targetId,tone:input.tone??'neutral',volume:input.volume??'normal'},eventId,understood,{truthStatus:'asserted',source:'utterance',audience:understood,qualifiers:input.replyToFactId?{replyToFactId:input.replyToFactId}:{}});
 return {understood};
}
export function phraseCommunication(intent:'greet'|'decline'|'ask-location'|'ask-status',subjectName=''){
 if(intent==='greet')return 'Hello.';if(intent==='decline')return 'No, thank you.';
 ensure(subjectName.trim().length>0,400,'communication_subject_required');return intent==='ask-location'?'Where is '+subjectName+'?':'How is '+subjectName+'?';
}

// Conversation memory comes from audible canonical utterances, never private prose.
export function conversationState(s:State,observerId:string,otherId?:string){
 const known=new Set(s.knowledge.filter(k=>k.observerId===observerId&&(!k.expiresAt||k.expiresAt>s.clock)).map(k=>k.factId));
 const utterances=s.facts.filter(f=>known.has(f.id)&&f.predicate==='communicated'&&!f.retiredAt&&f.value!==null&&typeof f.value==='object').flatMap(f=>{const value=f.value as {speakerId?:string;text?:string;targetId?:string|null};return typeof value.text==='string'&&(!otherId||value.speakerId===otherId||value.speakerId===observerId&&(!value.targetId||value.targetId===otherId))?[{id:f.id,text:value.text,speakerId:value.speakerId!,targetId:value.targetId,replyToFactId:typeof f.qualifiers?.replyToFactId==='string'?f.qualifiers.replyToFactId:null}]:[];}).slice(-50);
 const questions=utterances.filter(u=>u.text.trim().endsWith('?')),answered=new Set(utterances.flatMap(u=>u.replyToFactId?[u.replyToFactId]:[])),latestQuestion=questions.filter(u=>u.speakerId!==observerId).at(-1),repeatCount=latestQuestion?questions.filter(q=>q.speakerId===latestQuestion.speakerId&&q.text.toLowerCase().trim()===latestQuestion.text.toLowerCase().trim()).length:0;
 return {utterances,topic:questions.at(-1)?.text??'',unresolvedQuestions:questions.filter(q=>!questions.some(other=>answered.has(other.id)&&other.speakerId===q.speakerId&&other.text.toLowerCase().trim()===q.text.toLowerCase().trim())),previousAnswers:utterances.filter(u=>u.replyToFactId),latestQuestion,repeatCount};
}
