import {z} from 'zod';
export type FailureStage='provider'|'tools'|'output';
// Fixed codes only: exception messages can contain model output, URLs, or secrets.
const safeCodes=new Set([
 'ai_timeout','ai_canceled','ai_trace_mismatch','ai_usage_exceeded_budget','ai_input_budget_exceeded','ai_response_schema_invalid',
 'tool_not_allowed','fact_not_authorized','interpretation_not_authorized','narrative_source_not_authorized','command_proposal_not_authorized','command_candidate_not_authorized','duplicate_tool_call',
 'invalid_narrative_sources','incomplete_narrative_sources','player_dialogue_not_preserved','player_agency_violation','narration_too_large','story_requires_third_person','story_requires_past_tense','invalid_proposal_choice',
 'narrative_control_retry','narrative_mechanical_claim_rejected','narrative_repetition_rejected','narrative_content_rejected',
 'story_retry_cannot_expand','story_addition_not_allowed','story_location_required','story_world_limit','story_name_already_exists','story_detail_already_exists','story_npc_requires_public_scene','story_place_requires_public_outdoors',
 'narrative_context_unavailable','intent_context_unavailable','creator_assistance_not_configured',
 ...['deepinfra','gemini','provider'].flatMap(provider=>['request_failed','empty_response','response_too_large','invalid_response','incomplete_response','invalid_output','invalid_json','route_mismatch'].map(code=>provider+'_'+code))
]);
export function safeAiFailure(error:unknown,stage:FailureStage):string{
 if(error instanceof z.ZodError){
  if(stage!=='output')return stage==='tools'?'ai_tool_schema_invalid':'ai_response_schema_invalid';
  // Fixed structural field names only: never serialize issue messages, keys, or received values.
  const path=error.issues[0]?.path??[];
  const field=path[0]==='paragraphs'?(path[2]==='sourceIds'?'source_ids':path[2]==='text'?'text':'paragraphs'):path[0]==='additions'?'additions':path[0]==='order'?'order':null;
  return 'ai_output_schema_invalid'+(field?'_'+field:'');
 }
 if(error instanceof Error&&safeCodes.has(error.message)){
  const status=(error as Error & {httpStatus?:unknown}).httpStatus;
  if(['deepinfra_request_failed','gemini_request_failed','provider_request_failed'].includes(error.message)){
   if(status===401||status===403)return 'ai_provider_auth_failed';
   if(status===429)return 'ai_provider_rate_limited';
   if(status===400||status===404||status===422)return 'ai_provider_request_rejected';
   if(typeof status==='number'&&status>=500&&status<=599)return 'ai_provider_unavailable';
  }
  return error.message;
 }
 if(stage==='provider'&&error instanceof TypeError&&error.message==='fetch failed')return 'ai_provider_network_error';
 return stage==='output'?'ai_output_validation_failed':stage==='tools'?'ai_tool_validation_failed':'ai_provider_failed';
}
export function narrationFailureMessage(reason:string){
 const fieldMessages:Record<string,string>={ai_output_schema_invalid_source_ids:'The AI used invalid story references.',ai_output_schema_invalid_text:'The AI returned an invalid or oversized paragraph.',ai_output_schema_invalid_paragraphs:'The AI did not return the required paragraph list.',ai_output_schema_invalid_additions:'The AI returned an invalid scene detail.',ai_output_schema_invalid_order:'The AI returned an invalid event order.'};
 if(fieldMessages[reason])return `${fieldMessages[reason]} Your saved turn is unchanged. Use Retry beside Continue to rewrite only the narration. Code: ${reason}.`;
 const explanation=reason==='ai_timeout'?'The AI took too long to respond.':reason==='ai_provider_rate_limited'?'The AI provider is rate-limiting requests or its quota is exhausted.':reason==='ai_provider_auth_failed'?'The AI provider rejected the server credentials.':reason==='ai_output_schema_invalid'?'The AI reply did not match the required story format.':reason==='ai_response_schema_invalid'?'The AI returned an invalid response envelope.':reason==='narrative_mechanical_claim_rejected'?'The AI described a game outcome that did not happen.':reason==='narrative_repetition_rejected'?'The AI repeated too much existing writing.':reason==='narrative_content_rejected'?'The AI reply conflicted with this life’s content settings.':'The AI reply could not be accepted.';
 return `${explanation} Your saved turn is unchanged. Use Retry beside Continue to rewrite only the narration. Code: ${reason}.`;
}
