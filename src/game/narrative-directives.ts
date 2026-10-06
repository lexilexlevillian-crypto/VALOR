import {randomUUID,createHash} from 'node:crypto';
import {narrativeDirectiveSchema,type NarrativeDirective} from './narrative-directives-contract.ts';
import {ensure,type Actor} from '../contracts.ts';
import type {Store} from '../db.ts';
import type {Game} from './engine.ts';
import {observerView} from './epistemics.ts';
import {currentScene} from './turn-scenes.ts';
import {NarrativePreferences} from './narrative-preferences.ts';
import {narrativeProfileSchema,type NarrativeProfile} from './narrative-profile.ts';

// OOC markers inside literal speech are ordinary speech, never instructions.
export function splitDirectorInput(text:string){
 const masked=text.replace(/"[^"]*"|“[^”]*”/g,value=>' '.repeat(value.length));
 const marker=/(?:^|\s)(?:OOC:|\[OOC\]|\/ooc\b)\s*/i.exec(masked);
 return marker?{canonical:text.slice(0,marker.index).trim(),director:text.slice(marker.index+marker[0].length).trim()}:null;
}
export function parseDirectorText(text:string):{directive?:NarrativeDirective;query?:'recap'|'knowledge'|'options';focus?:string;scope?:string;message?:string}{
 const scope=/\b(?:always|from now on|persistently)\b/i.test(text)?'character':/\b(?:this|current) scene\b/i.test(text)?'scene':/\b(?:globally|all characters)\b/i.test(text)?'user':'one-response';
 let value=text.trim().replace(/[.!]$/,'');
 const focus=/^(?:focus (?:on )?)(.+?)(?: for (?:the )?(next reply|this scene))?$/i.exec(value);if(focus)return {focus:focus[1]!.trim(),scope};
 if(/^(?:recap|summarize(?: the scene)?|what happened)$/i.test(value))return {query:'recap'};
 if(/^(?:what (?:do I|does my character) know|where (?:is|are) .+|what (?:do I|does my character) (?:recognize|understand))\??$/i.test(value))return {query:'knowledge'};
 if(/^(?:what (?:are my options|can I do)|options)\??$/i.test(value))return {query:'options'};
 // An explicit PC-interior declaration is preserved as an attributed private account,
 // never inferred as someone else's knowledge or objective world truth.
 const interior=/^(?:my (?:character|PC)(?:'s)? (?:interior|thoughts?|feelings?)|PC interior)\s*:\s*(.+)$/i.exec(value);
 const implicit=/^(?:I am|I'm|he is|he's|she is|she's|they are|they're|(?:my )?PC is) (?:jealous|furious|angry|sad|afraid|happy|worried|lonely|nervous)(?: but (?:hiding|concealing) it)?$/i.test(value);
 if(implicit)return {directive:narrativeDirectiveSchema.parse({scope,interior:value})};
 if(interior)return {directive:narrativeDirectiveSchema.parse({scope,interior:interior[1]})};
 value=value.replace(/\b(?:please|keep|make|use|the|next|reply|response|narration|prose|for|this|current|scene|always|from now on|persistently|globally|all characters)\b/gi,' ').replace(/\s+/g,' ').trim();
 const patch:Record<string,string>={};
 const controls:Array<[string,RegExp,Record<string,string>?]>=[
  ['perspective',/\b(first|second|third)[ -]person\b/i],
  ['tense',/\b(past|present)(?:[ -]tense)?\b/i],
  ['responseLength',/\b(very[ -]long|short|medium|long)\b/i,{'very long':'very-long'}],
  ['descriptionDensity',/\b(sparse|rich)(?: description)?\b|\b(balanced) description\b/i],
  ['pacing',/\b(fast|slow) pacing\b/i],
  ['narratorTone',/\b(neutral|sardonic|literary|harsh|warm) tone\b/i],
  ['professionalDetail',/\b(light|standard|technical) professional detail\b/i],
  ['profanity',/\b(low|moderate|high|character-authentic) profanity\b/i],
  ['graphicness',/\b(minimal|grounded|graphic) graphicness\b/i],
  ['expositionDensity',/\b(minimal|standard|detailed) exposition\b/i,{standard:'balanced',detailed:'expanded'}],
  ['dialogueDensity',/\b(low|balanced|high|dialogue-heavy) dialogue\b/i,{'dialogue-heavy':'high'}],
 ];
 for(const [key,pattern,map] of controls){const match=pattern.exec(value);if(match){patch[key]=map?.[(match[1]??match[2])!.toLowerCase()]??(match[1]??match[2])!.toLowerCase();value=value.replace(match[0],' ');}}
 if(Object.keys(patch).length&&!value.replace(/\b(?:and|with|it)\b/gi,'').replace(/[,;:]/g,'').trim())return {directive:narrativeDirectiveSchema.parse({scope,patch})};
 return {message:'That OOC request was not applied. Use writing preferences for style, “recap” or “what do I know” for information, or “PC interior: …” for your own private thoughts. World changes require a game action or authorized Creator edit.'};
}
export async function saveNarrativeDirective(game:Game,actor:Actor,timelineId:string,characterId:string,mode:'GAME'|'STORY',raw:unknown){
 const directive=narrativeDirectiveSchema.parse(raw);
 await game.authorizeCharacter(actor,timelineId,characterId);
 const scene=await currentScene(game.store,timelineId,characterId);
 if(directive.focusId){const view=observerView(await game.load(timelineId),characterId);ensure(view.entities.some(e=>e.id===directive.focusId),404,'focus_unavailable');}
 ensure(Object.keys(directive.patch).length>0||directive.interior||directive.focusId,400,'empty_narrative_directive');
 if(['user','campaign','character'].includes(directive.scope)){
  ensure(!directive.interior&&!directive.focusId,400,'private_directive_requires_temporary_scope');
  const preferences=new NarrativePreferences(game),saved=await preferences.read(actor,timelineId,characterId,mode),old=saved.rows.find(row=>row.scope===directive.scope);
  await preferences.save(actor,timelineId,{characterId,mode,scope:directive.scope,expectedRevision:old?.revision??0,patch:{...old?.patch,...directive.patch}});
 }else{
  ensure(directive.scope!=='scene'||scene,409,'scene_unavailable');
  const active=await game.store.get<{n:number}>('SELECT count(*) n FROM narrative_directives WHERE timeline_id=? AND user_id=? AND character_id=? AND mode=? AND consumed_event_id IS NULL AND (scope=? OR scene_id=?)',timelineId,actor.id,characterId,mode,'one-response',scene?.sceneId??'');
  ensure((active?.n??0)<40,409,'too_many_narrative_directives');
  await game.store.run('INSERT INTO narrative_directives VALUES (?,?,?,?,?,?,?,?,?,NULL)',randomUUID(),timelineId,actor.id,characterId,mode,directive.scope,directive.scope==='scene'?scene.sceneId:null,JSON.stringify(directive),new Date().toISOString());
 }
 return {text:'Narrative direction saved for '+directive.scope+'. No world time passed.',scope:directive.scope};
}
export async function applyNarrativeDirectives(store:Store,userId:string,timelineId:string,characterId:string,sceneId:string,mode:'GAME'|'STORY',profile:NarrativeProfile,eventId:string){
 const rows=await store.all<{id:string;scope:string;payload_json:string}>("SELECT id,scope,payload_json FROM narrative_directives WHERE timeline_id=? AND user_id=? AND character_id=? AND mode=? AND consumed_event_id IS NULL AND (scope='one-response' OR scene_id=?) ORDER BY CASE scope WHEN 'scene' THEN 0 ELSE 1 END,rowid",timelineId,userId,characterId,mode,sceneId);
 let resolved=profile,focusId:string|undefined;const interior:string[]=[],layers:unknown[]=[];
 for(const row of rows){const directive=narrativeDirectiveSchema.parse(JSON.parse(row.payload_json));resolved=narrativeProfileSchema.parse({...resolved,...directive.patch});if(directive.focusId)focusId=directive.focusId;if(directive.interior)interior.splice(0,interior.length,directive.interior);layers.push({scope:row.scope,directiveId:row.id});if(row.scope==='one-response')await store.run('UPDATE narrative_directives SET consumed_event_id=? WHERE id=? AND consumed_event_id IS NULL',eventId,row.id);}
 if(rows.some(row=>Object.keys(JSON.parse(row.payload_json).patch??{}).length)){resolved.id='custom';resolved.name='Custom';resolved.version=parseInt(createHash('sha256').update(JSON.stringify({profile:resolved,layers})).digest('hex').slice(0,12),16)||1;}
 return {profile:resolved,focusId,interior,layers};
}
