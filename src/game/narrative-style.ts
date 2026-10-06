import type {NarrativeProfile} from './narrative-profile.ts';
const words=(text:string)=>text.match(/\b[\p{L}\p{N}’']+\b/gu)??[];
export function styleMetrics(text:string){
 const tokens=words(text),sentences=text.split(/[.!?]+(?:\s|$)/).filter(s=>s.trim()),paragraphs=text.split(/\n\s*\n/).filter(s=>s.trim()),speech=(text.match(/“[^”]*”|"[^"]*"/g)??[]).join(' ');
 return {vocabularyComplexity:tokens.filter(t=>t.length>8).length/Math.max(1,tokens.length),narratorSarcasm:(text.match(/\b(?:apparently|of course|so much for|yeah right)\b/gi)??[]).length,internalInterpretation:(text.match(/\b(?:felt|thought|wondered|realized|wanted)\b/gi)??[]).length,exposition:(text.match(/\b(?:because|used to|years ago|historically|as everyone knew)\b/gi)??[]).length,words:tokens.length,sentenceWords:tokens.length/Math.max(1,sentences.length),paragraphWords:tokens.length/Math.max(1,paragraphs.length),paragraphs:paragraphs.length,dialogueRatio:words(speech).length/Math.max(1,tokens.length),fragmentRatio:sentences.filter(s=>words(s).length<4).length/Math.max(1,sentences.length),profanity:(text.match(/\b(?:fuck(?:ing)?|shit|damn|hell)\b/gi)??[]).length,metaphorCues:(text.match(/\b(?:as if|like a|as though)\b/gi)??[]).length,sensoryCues:(text.match(/\b(?:smell|buzz|hum|warm|cold|light|sound|scent)\w*\b/gi)??[]).length};
}
export type StyleTurn={narration:string;sceneId?:string;dialogue?:Array<{speakerId:string;text:string}>};
export function narrativeStyleMemory(history:Array<string|StyleTurn>,profile:NarrativeProfile,sceneId?:string){
 const turns=history.slice(-50).map(t=>typeof t==='string'?{narration:t}:t),metrics=turns.map(t=>styleMetrics(t.narration));
 const average=(sample:ReturnType<typeof styleMetrics>[])=>({turns:sample.length,...Object.fromEntries(Object.keys(styleMetrics('')).map(key=>[key,sample.reduce((sum,m)=>sum+m[key as keyof typeof m],0)/Math.max(1,sample.length)]))}) as ReturnType<typeof styleMetrics>&{turns:number};
 const windows={immediate:average(metrics.slice(-1)),scene:average(sceneId?turns.filter(t=>t.sceneId===sceneId).map(t=>styleMetrics(t.narration)):metrics.slice(-8)),medium:average(metrics.slice(-24)),long:average(metrics)},drift:string[]=[];
 // A trend requires several turns; a single unusual scene is not style drift.
 if(windows.scene.turns>=4){
  if(profile.responseLength==='short'&&windows.scene.paragraphs>3)drift.push('response-length');
  if(profile.literaryIntensity==='straightforward'&&windows.scene.metaphorCues>2)drift.push('figurative-language');
  if(windows.scene.fragmentRatio>0.5)drift.push('fragment-rhythm');
  if(windows.scene.turns>=8&&windows.scene.sentenceWords>windows.long.sentenceWords*1.5)drift.push('sentence-length');
 }
 const recent=turns.slice(-8).map(t=>t.narration),perNpc:Record<string,{phrases:string[];metrics:ReturnType<typeof styleMetrics>}>={};
 for(const turn of turns)for(const line of turn.dialogue??[]){const old=perNpc[line.speakerId]?.phrases??[];const phrases=[...old,line.text].slice(-12);perNpc[line.speakerId]={phrases,metrics:styleMetrics(phrases.join(' '))};}
 const motifs:Record<string,RegExp>={tension:/jaw.{0,16}(?:tight|clench)|teeth.{0,12}grit|eyes?.{0,12}dark/gi,breathing:/breath.{0,16}(?:hitch|catch|caught)/gi,silence:/silence.{0,16}(?:stretch|settle)|charged air|palpable tension/gi,electricity:/electric|magnetic|sparks? between/gi,noise:/fluorescent.{0,15}(?:buzz|hum)|buzz|hum/gi,noir:/city.{0,16}(?:bleed|sleep)|streets swallowed/gi};
 return {windows,drift,sceneId:sceneId??null,perNpc,recentExactPhrases:recent.flatMap(t=>t.split(/[.!?\n]+/).map(s=>s.trim()).filter(s=>s.length>10)).slice(-40),semanticMotifs:Object.entries(motifs).filter(([,r])=>recent.filter(t=>{r.lastIndex=0;return r.test(t);}).length>=2).map(([key])=>key),openings:recent.map(t=>t.split(/\s+/).slice(0,5).join(' ')),endings:recent.map(t=>t.split(/\s+/).slice(-6).join(' ')),jokePatterns:recent.flatMap(t=>t.match(/(?:apparently|of course|so much for)[^.!?]*[.!?]/gi)??[]),target:{responseLength:profile.responseLength,literaryIntensity:profile.literaryIntensity,dialogueDensity:profile.dialogueDensity}};
}
export function activeNarrativeValidators(sources:string[]){
 const text=sources.join(' ');
 return ['state-event-fidelity','player-agency','knowledge-secrecy','identity-recognition','spatial-continuity','time-weather','inventory-weapons','health-consciousness','control-handoff','mode-contract','style-repetition',
  ...(/dialogue/.test(text)?['npc-voice','group-audibility']:[]),
  ...(/combat|weapon|attack|shot/.test(text)?['combat-clarity']:[]),
  ...(/romance|intimacy|relationship|consent/.test(text)?['romance-mutuality']:[]),
  ...(/dream|hallucinat|perception/.test(text)?['subjective-perception']:[]),
  ...(/job|work|procedure/.test(text)?['professional-procedure']:[]),
  ...(/lore|rumor|memory/.test(text)?['lore-attribution']:[]),
  ...(/travel|clock|sleep/.test(text)?['montage-handoff']:[])];
}
export function narrativeRepairInstruction(code:string){
 const instructions:Record<string,string>={
  narrative_unsupported_claim:'Remove unsupported claims, including invented actions, feelings, reciprocity, hidden knowledge, and extra events. Use the approved realization for each source.',
  narrative_missing_required_fact:'Restore every missing required source exactly once. Optional detail cannot replace an outcome.',
  narrative_duplicate_event:'Remove duplicate source IDs; each resolved event occurs once.',
  narrative_endpoint_order:'Restore source order and end at the original reaction window.',
  narrative_unknown_source:'Remove all source IDs outside the supplied bundle.',
  narration_cannot_mutate_world:'Remove additions. Narration has no world mutation authority.',
  narration_too_large:'Trim optional detail and group related facts; preserve every required outcome.',
 };
 if(code.startsWith('narrative_review_'))return 'Revise the '+code.slice(17)+' defect. Preserve every cited outcome and remove unsupported interpretation; obey the selected profile and NPC voice. Use exact source wording if uncertain.';
 return instructions[code]??'Use the required JSON contract, approved realizations, unique sources and original order. Preserve the resolved handoff.';
}
