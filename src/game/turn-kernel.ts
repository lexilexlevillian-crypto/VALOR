import {recallMemories,mutateMemory} from './memory.ts';
import {recallInformation,queryInformation} from './information-operations.ts';
import {deterministicNarrative,narrativeValidatorVersion} from './narrative-runtime.ts';
import {parseDirectorText,saveNarrativeDirective,splitDirectorInput} from './narrative-directives.ts';
import {narrativeProfileSchema} from './narrative-profile.ts';
import {coreRulesetVersion} from './turn-rules.ts';
import {validatePlanReferences,validateCreativeProposal,describeCreativePlan,observerReferenceIds,type TurnPlanner,type CreativeProposal} from './turn-planner.ts';
import {beginTurnTrace,persistTurnTrace,failureReason} from './turn-pipeline.ts';
import {randomUUID} from 'node:crypto';
import {ensure} from '../contracts.ts';
import type {Actor} from '../contracts.ts';
import {Game,checksum} from './engine.ts';
import {interpretTurn} from './turn-input.ts';
import {currentScene} from './turn-scenes.ts';
import {controlState} from './turn-resolution.ts';
import {observerView} from './epistemics.ts';
import {turnCommandSchema,type PendingDecision,type PlayMode,type TurnClause,type TurnAffordance} from './turn-contracts.ts';

export {turnAffordances} from './turn-affordances.ts';
import {turnAffordances} from './turn-affordances.ts';
import {authorInformation,informationProjection} from './information.ts';
import {observerEffects} from './turn-visibility.ts';
import type {Effect} from './simulation.ts';
// Session means an existing timeline. All world writes still use Game.turn,
// Game.branch, and their database transaction / authorization contracts.
export class TurnKernel {
 readonly game:Game;
 private planner?:TurnPlanner;private npcPlanner?:import('./behavior-planner.ts').NpcBehaviorPlanner;
 constructor(game:Game,planner?:TurnPlanner,npcPlanner?:import('./behavior-planner.ts').NpcBehaviorPlanner){this.game=game;this.planner=planner;this.npcPlanner=npcPlanner;}
 async execute(actor:Actor,raw:unknown):Promise<Record<string,any>>{
  const command=turnCommandSchema.parse(raw),id=command.sessionId,characterId=command.actorId,input=command.input;
  await this.game.authorizeCharacter(actor,id,characterId);
  const split=input.kind==='freeform'?splitDirectorInput(input.text):null;
  const director=split?parseDirectorText(split.director):null;
  const canonicalText=input.kind==='freeform'?(split?.canonical??input.text):'';
  const playerName=input.kind==='freeform'?(await this.game.load(id)).entities.find(e=>e.id===characterId)!.name:'';
  const beliefText=canonicalText.toLowerCase().startsWith(playerName.toLowerCase()+' ')?'my character '+canonicalText.slice(playerName.length+1):canonicalText;
  const queryText=canonicalText.replaceAll(playerName,'I').trim(),queryMatch=/^(?:what (?:do|does|did) I (know|remember|observe)(?: about)?|where (?:do|does) I know|why (?:do|does) I (?:think|believe))(?:\s+(.+?))?\??$/i.exec(queryText);
  const informationQuery=input.kind==='freeform'&&!split&&queryMatch?{kind:(queryMatch[1]?.toLowerCase()==='observe'?'observed':queryMatch[1]?.toLowerCase()??(/^where/i.test(queryText)?'where':'why')) as 'know'|'remember'|'observed'|'where'|'why',query:(queryMatch[2]??'').replace(/\?$/,'')}:null;
  const authoredBelief=input.kind==='freeform'&&!split?/^(?:I (?:think|believe|suspect)|my (?:character|PC) (?:thinks|believes|suspects))(?: that)?\s+(.+)$/i.exec(beliefText.trim()):null;
  const memoryAnchor=input.kind==='freeform'&&!split?/^(I|my character|my PC|[\p{L}][\p{L} '-]{0,100}) (?:never forgot|will never forget) (?:this|that)[.!]?$/iu.exec(canonicalText.trim()):null;
  const memoryQuery=input.kind==='freeform'&&!split?/^what do I remember(?: about (.+?))?[?]?$/i.exec(canonicalText.trim()):null;
  // Reserve RNG lineage before the world transaction so rollback cannot reroll.
  const attempt=await beginTurnTrace(this.game.store,{timelineId:id,actorId:actor.id,requestKey:'command_'+checksum(command.commandId),bodyHash:checksum(command),originalText:input.kind==='freeform'?input.text:'',expectedRevision:command.expectedRevision});
  try{
   let proposal:CreativeProposal|null=null;
   // Provider I/O is outside the world transaction. Receipt replay never calls AI.
   if(input.kind==='freeform'&&canonicalText&&!memoryAnchor&&!memoryQuery&&!informationQuery&&!authoredBelief&&!director?.message&&!director?.query&&this.planner&&!await this.game.store.get('SELECT command_id FROM turn_interactions WHERE command_id=?',command.commandId)){
    const snapshot=await this.game.load(id),parsed=interpretTurn(snapshot,characterId,canonicalText);
    if(parsed.clarification||parsed.clauses.some(c=>c.action.type==='physical'&&c.action.operation==='attempt'))proposal=await this.planner.propose(actor,id,characterId,command.expectedRevision,canonicalText).catch(()=>null);
   }
   const npcPlans=this.npcPlanner&&!memoryAnchor&&!memoryQuery&&!informationQuery&&!authoredBelief&&!director?.message&&!director?.query&&(!split||!!canonicalText)&&['action','freeform','affordance','clarification_answer'].includes(input.kind)&&!await this.game.store.get('SELECT command_id FROM turn_interactions WHERE command_id=?',command.commandId)?await this.npcPlanner.prepare(actor,id,characterId,command.expectedRevision,command.commandId).catch(()=>[]):[];
   const response=await this.game.store.transaction(async()=>{
   const receipt=await this.game.store.get<{timeline_id:string;user_id:string;body_hash:string;result_json:string}>('SELECT * FROM turn_interactions WHERE command_id=?',command.commandId);
   if(receipt){ensure(receipt.timeline_id===id&&receipt.user_id===actor.id&&receipt.body_hash===checksum(command),409,'idempotency_conflict');return JSON.parse(receipt.result_json);}
   const {t}=await this.game.access(actor,id);
   ensure(t.revision===command.expectedRevision,409,'revision_conflict');
   const state=await this.game.load(id),metadata=await this.game.store.get<{mode:PlayMode;pending_json:string|null}>('SELECT mode,pending_json FROM turn_input_state WHERE timeline_id=? AND user_id=? AND character_id=?',id,actor.id,characterId);
   let mode=command.mode,pending:PendingDecision|null=metadata?.pending_json?JSON.parse(metadata.pending_json):null;
   let result:Record<string,unknown>,clauses:TurnClause[]|undefined,text='';let interpreted:unknown=null;
   const scene=await currentScene(this.game.store,id,characterId);
   const base={commandId:command.commandId,sessionId:id,revision:t.revision,worldTime:state.clock,control:pending?{holder:'PLAYER',reasonCode:'CLARIFICATION_REQUIRED',actingEntityId:characterId}:scene?.sceneRevision===t.revision?scene.control:controlState(state,characterId)};
   let directorResult:{text:string;scope?:string}|undefined;
   if(director?.focus){const view=observerView(state,characterId),targets=view.entities.filter(e=>e.name.toLowerCase()===director.focus!.toLowerCase()||director.focus==='environment'&&e.id===state.entities.find(e=>e.id===characterId)?.data.locationId);if(targets.length===1)directorResult=await saveNarrativeDirective(this.game,actor,id,characterId,mode,{focusId:targets[0]!.id,scope:director.scope});else director.message='Focus was not changed. Name one character or object your character can currently identify.';}
   if(input.kind==='narrative_directive'||director?.directive)directorResult=await saveNarrativeDirective(this.game,actor,id,characterId,mode,input.kind==='narrative_directive'?input.directive:director!.directive);
   if(memoryQuery){const recalled=recallInformation(state,characterId,memoryQuery[1]??'');result={...base,status:'PRESENTED',recall:recalled,presentation:{kind:'director',text:recalled.memories.length?recalled.memories.map(m=>m.text+' ('+m.detail+', '+Math.round(m.confidence*100)+'% confidence)').join('\n'):recalled.meaning}};
   }else if(memoryAnchor){
    const self=state.entities.find(e=>e.id===characterId)!,subject=memoryAnchor[1]!.toLowerCase(),permitted=['i','my character','my pc',self.name.toLowerCase()].includes(subject),rows=permitted?recallMemories(state,characterId,{explicit:true,limit:50}).sort((a,b)=>b.at.localeCompare(a.at)):[],latest=rows[0],anchors=latest?rows.filter(m=>m.sourceEventId===latest.sourceEventId):[];
    if(!anchors.length)result={...base,status:'PRESENTED',presentation:{kind:'director',text:'No eligible experience was selected. Open Journal to choose an existing memory.'}};
    else{const mutation=await this.game.mutate(actor,id,t.revision,'memory_'+checksum(command.commandId),command,'memory.anchor',false,(s,eventId)=>({result:{memoryIds:anchors.map(m=>{mutateMemory(s,characterId,m.id,'anchor',eventId,{reason:'Player-authored memory significance'});return m.id;})}}));result={...base,...mutation,status:'PRESENTED',presentation:{kind:'director',text:'The most recent recalled experience was marked as significant. No world time passed.'}};}
   }else if(informationQuery){result={...base,status:'PRESENTED',inspection:queryInformation(state,characterId,informationQuery.kind,informationQuery.query),presentation:{kind:'director',text:'Your character’s accessible information. No world time passed.'}};}
   else if(authoredBelief){
    const mutation=await this.game.mutate(actor,id,t.revision,'belief_'+checksum(command.commandId),command,'information.player-belief',false,async(s,eventId)=>{await this.game.authorizeCharacter(actor,id,characterId);return {result:{entryId:authorInformation(s,characterId,{kind:'belief',text:authoredBelief[1]!},eventId).id}};});
    result={...base,...mutation,status:'PRESENTED',presentation:{kind:'director',text:'Your character’s belief was recorded. No world time passed.'}};
   }else if(input.kind==='narrative_directive'||split&&(!canonicalText||director?.message||director?.query)){
    let message=directorResult?.text??director?.message??'No narrative direction was applied.';
    if(director?.query==='recap'){
     const events=await this.game.store.all<{effects_json:string}>('SELECT effects_json FROM game_events WHERE timeline_id=? ORDER BY revision DESC LIMIT 20',id);
     message=events.reverse().flatMap(row=>observerEffects(state,JSON.parse(row.effects_json) as Effect[],characterId,true).map(e=>e.text)).slice(-20).join('\n\n')||'No observed events have been recorded for this character.';
    }else if(director?.query==='knowledge'){
     const view=observerView(state,characterId);
     message='Only your character’s accessible information is shown. Unknown locations and hidden NPC thoughts remain unknown.';
     result={...base,status:'PRESENTED',inspection:{...view,information:informationProjection(state,characterId)}};
    }else if(director?.query==='options')message='Available actions: '+turnAffordances(state,characterId,t.revision).filter(a=>a.enabled).map(a=>a.label).join('; ')+'.';
    result={...base,...result!,status:'PRESENTED',presentation:{kind:'director',text:message}};
   }else if(input.kind==='mode_switch'){mode=input.targetMode;result={...base,status:'PRESENTED'};}
   else if(input.kind==='inspection'){
    const view=observerView(state,characterId);
    if(input.targetId){const target=view.entities.find(e=>e.id===input.targetId);ensure(target,404,'target_unavailable');result={...base,status:'PRESENTED',inspection:target};}
    else result={...base,status:'PRESENTED',inspection:input.panel==='inventory'?await this.game.inventory(actor,id,characterId,{}):input.panel==='phone'?await this.game.phone(actor,id,characterId):input.panel==='journal'?(await this.game.view(actor,id,characterId)).journal:input.panel==='cases'?(await this.game.view(actor,id,characterId)).caseFiles:input.panel==='health'?view.entities.filter(e=>e.id===characterId||e.kind==='injury'&&e.data.characterId===characterId):view};
   }else if(input.kind==='cancel_pending'){
    if(pending?.pendingDecisionId===input.pendingActionId){pending=null;result={...base,status:'CANCELED',control:scene?.sceneRevision===t.revision?scene.control:controlState(state,characterId)};}
    else {
     const committed=await this.game.store.get<{result_json:string}>('SELECT result_json FROM turn_interactions WHERE command_id=? AND timeline_id=? AND user_id=? AND character_id=?',input.pendingActionId,id,actor.id,characterId);
     const turn=await this.game.store.get<{id:string;narration:string}>('SELECT id,narration FROM story_turns WHERE id=? AND timeline_id=? AND user_id=? AND character_id=?',input.pendingActionId,id,actor.id,characterId);
     ensure(committed||turn,404,'pending_action_unavailable');result={...base,status:'ALREADY_COMMITTED',committed:committed?JSON.parse(committed.result_json):turn};
    }
   }else if(input.kind==='regenerate_narration'){
    const turn=await this.game.store.get<{permitted_json:string;id:string}>('SELECT id,permitted_json FROM story_turns WHERE id=? AND timeline_id=? AND user_id=? AND character_id=?',input.turnId,id,actor.id,characterId);
    ensure(turn,404,'turn_unavailable');
    const batch=await this.game.store.get<{batch_json:string}>('SELECT batch_json FROM turn_resolution_batches WHERE event_id=?',input.turnId);
    const original=batch?JSON.parse(batch.batch_json):null;
    const frozen=await this.game.store.get<{context_json:string}>('SELECT context_json FROM turn_narrative_contexts WHERE event_id=?',turn.id),narrative=frozen?JSON.parse(frozen.context_json).narrative:null;
    if(narrative&&input.patch)narrative.profile=narrativeProfileSchema.parse({...narrative.profile,...input.patch});
    const narration=narrative?deterministicNarrative(narrative):(JSON.parse(turn.permitted_json) as Array<{text:string}>).map(e=>e.text).join('\n\n')||'The action resolved. No observer-visible change was recorded.';
    const versionId=randomUUID();await this.game.store.run('INSERT INTO narration_versions VALUES (?,?,?,?,?)',versionId,turn.id,narration,'grounded',new Date().toISOString());
    await this.game.store.run('UPDATE story_turns SET narration=?,narration_status=? WHERE id=?',narration,'grounded',turn.id);
    if(narrative)await this.game.store.run('INSERT INTO narrative_render_records VALUES (?,?,?,?,?,?,?)',randomUUID(),turn.id,id,actor.id,versionId,JSON.stringify({turnId:turn.id,eventIds:narrative.eventIds,profile:narrative.profile,promptVersion:'narrative-v3',model:{provider:'grounded',model:'deterministic-v2'},validatorVersion:narrativeValidatorVersion,retryCount:0,status:'regenerated',mechanicsChanged:false}),new Date().toISOString());
    result={...base,status:'PRESENTED',turnId:turn.id,narration,versionId,turnRevision:original?original.baseRevision+1:null,control:original?.resolution?.control??original?.nextControl??base.control,rerolled:false};
   }else if(input.kind==='edit_request'){
    const branch=await this.game.branch(actor,id,input.edit.saveId,input.edit.name);
    result={...base,status:'BRANCHED',branch,reason:input.edit.reason};pending=null;
   }else{
    if(input.kind==='clarification_answer'){
     ensure(pending?.pendingDecisionId===input.pendingDecisionId,409,'pending_decision_unavailable');
     ensure(pending.basedOnRevision===t.revision,409,'clarification_stale');
     if(pending.proposedClauses&&input.answer==='confirm_plan'){clauses=pending.proposedClauses;text=pending.originalText;}
     else text=input.answer;const option=pending.options?.find(option=>option.id===input.answer||option.label.toLowerCase()===input.answer.toLowerCase());if(!clauses&&option?.answerText)text=option.answerText;else if(!clauses&&option)text=pending.originalText.replace(/\b(him|her|them|he|she|it)\b/gi,()=>option.label);
    }else if(input.kind==='freeform'){text=canonicalText;}
    else if(input.kind==='action'){text=input.text??'';clauses=[{clauseId:'1',dependency:'NONE',action:input.action}];}
    else {
     const choice=turnAffordances(state,characterId,t.revision).find(item=>item.affordanceId===input.affordanceId);
     ensure(choice,409,'affordance_stale');clauses=[{clauseId:'1',dependency:'NONE',action:choice.action}];
    }
    if(!clauses){
     const interpretation=interpretTurn(state,characterId,text);interpreted=interpretation;
     if(proposal?.clauses.length){
      proposal=validateCreativeProposal(proposal,state,characterId,text);
      pending={pendingDecisionId:randomUUID(),basedOnRevision:t.revision,prompt:'Confirm these steps:\n'+describeCreativePlan(proposal.clauses,state,characterId),originalText:text,proposedClauses:proposal.clauses,proposalEvidence:proposal.evidence,options:[{id:'confirm_plan',label:'Confirm these steps'}]};
      interpreted={...interpretation,proposal};result={...base,status:'NEEDS_CLARIFICATION',control:{holder:'PLAYER',reasonCode:'CLARIFICATION_REQUIRED',actingEntityId:characterId}};
     }else if(interpretation.clauses.some(c=>c.action.type==='physical'&&c.action.operation==='attempt')){
      pending={pendingDecisionId:randomUUID(),basedOnRevision:t.revision,prompt:proposal?.clarification??'Describe how you want to use the object and what should change. Nothing has happened.',originalText:text};result={...base,status:'NEEDS_CLARIFICATION',control:{holder:'PLAYER',reasonCode:'CLARIFICATION_REQUIRED',actingEntityId:characterId}};
     }else if(interpretation.presentation){result={...base,status:'PRESENTED',presentation:interpretation.presentation};}
     else if(interpretation.clarification){
      pending={pendingDecisionId:randomUUID(),basedOnRevision:t.revision,prompt:interpretation.clarification,originalText:text,...(interpretation.options?{options:interpretation.options}:{})};
      result={...base,status:'NEEDS_CLARIFICATION',control:{holder:'PLAYER',reasonCode:'CLARIFICATION_REQUIRED',actingEntityId:characterId}};
     }else clauses=interpretation.clauses;
    }
    if(clauses){
     // All references still pass domain validation; input IDs never grant access.
     const visibleIds=observerReferenceIds(state,characterId);
     validatePlanReferences(clauses,visibleIds);
     const cursor=await this.game.store.get<{cursor:string}>('SELECT cursor FROM timeline_turn_cursors WHERE timeline_id=?',id);
     ensure(cursor,409,'turn_cursor_unavailable');
     const turn=await this.game.turn(actor,id,{revision:t.revision,cursor:cursor.cursor,characterId,action:clauses[0]!.action,clauses,text,mode},'kernel_'+checksum(command.commandId),attempt.seed,npcPlans);
     pending=null;result={...base,...turn,status:'COMMITTED',worldTime:(await this.game.load(id)).clock};
    }
   }
   await this.game.store.run('INSERT INTO turn_input_state VALUES (?,?,?,?,?) ON CONFLICT(timeline_id,user_id,character_id) DO UPDATE SET mode=excluded.mode,pending_json=excluded.pending_json',id,actor.id,characterId,mode,pending?JSON.stringify(pending):null);
   const current=await this.game.load(id),revision=Number(result!.revision);
   const affordances:TurnAffordance[]=turnAffordances(current,characterId,revision).map(({action,...safe})=>safe);
   const response={...result!,mode,pendingDecision:pending,affordances,freeformAllowed:true};
   await this.game.store.run('INSERT INTO turn_interactions VALUES (?,?,?,?,?,?,?,?)',command.commandId,id,actor.id,characterId,checksum(command),input.kind,JSON.stringify(response),new Date().toISOString());
   await this.game.store.run('INSERT INTO turn_attempt_records VALUES (?,?)',command.commandId,JSON.stringify({command,baseRevision:t.revision,resultKind:result!.status,interpretation:interpreted,clauses:clauses??null,committedEventIds:result!.eventId?[result!.eventId]:[],rulesetVersion:coreRulesetVersion,contentVersion:state.canon?.revisionId??'local',control:result!.control}));
   return response;
  });
  await persistTurnTrace(this.game.store,attempt.traceId,[],response.status==='COMMITTED'?'committed':'validated',typeof response.eventId==='string'?response.eventId:undefined);return response;
  }catch(error){await persistTurnTrace(this.game.store,attempt.traceId,[],'failed',undefined,failureReason(error)).catch(()=>{});throw error;}
 }
}
