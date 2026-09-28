import {z} from 'zod';
import {aiToolCallSchema,type AiToolName} from './contracts.ts';

const opaqueId=z.string().trim().min(1).max(200);
export const factualLookupInput=z.strictObject({factIds:z.array(opaqueId).min(1).max(50)});
export const interpretationProposalInput=z.strictObject({candidateId:opaqueId.nullable()});
export const narrationToolInput=z.discriminatedUnion('mode',[
 z.strictObject({mode:z.literal('order'),sourceIds:z.array(opaqueId).max(200)}),
 z.strictObject({mode:z.literal('anchored'),paragraphs:z.array(z.strictObject({sourceIds:z.array(opaqueId).min(1).max(50),text:z.string().min(1).max(4000)})).max(200)})
]);
export const serverCommandProposalInput=z.strictObject({candidateId:opaqueId,expectedRevision:z.number().int().positive()});

export type ToolAuthorization={facts?:ReadonlyMap<string,unknown>;interpretationCandidates?:ReadonlySet<string>;narrativeSourceIds?:ReadonlySet<string>;commandCandidates?:ReadonlyMap<string,{expectedRevision:number;request:unknown}>;canProposeCommands?:boolean;};

// Tools operate only on server-supplied capabilities. There is deliberately no SQL, write, file, shell, or web tool.
export function validateToolCall(raw:unknown,allowed:readonly AiToolName[],authorization:ToolAuthorization){
 const call=aiToolCallSchema.parse(raw);if(!allowed.includes(call.name))throw new Error('tool_not_allowed');
 switch(call.name){
  case 'factual.lookup':{const input=factualLookupInput.parse(call.input),facts=input.factIds.map(id=>{if(!authorization.facts?.has(id))throw new Error('fact_not_authorized');return {id,value:authorization.facts.get(id)};});return {id:call.id,name:call.name,result:{facts}};}
  case 'interpretation.propose':{const input=interpretationProposalInput.parse(call.input);if(input.candidateId!==null&&!authorization.interpretationCandidates?.has(input.candidateId))throw new Error('interpretation_not_authorized');return {id:call.id,name:call.name,result:{candidateId:input.candidateId,requiresConfirmation:true}};}
  case 'narration.compose':{const input=narrationToolInput.parse(call.input),ids=input.mode==='order'?input.sourceIds:input.paragraphs.flatMap(value=>value.sourceIds);if(ids.some(id=>!authorization.narrativeSourceIds?.has(id)))throw new Error('narrative_source_not_authorized');return {id:call.id,name:call.name,result:input};}
  case 'server-command.propose':{const input=serverCommandProposalInput.parse(call.input);if(!authorization.canProposeCommands)throw new Error('command_proposal_not_authorized');const candidate=authorization.commandCandidates?.get(input.candidateId);if(!candidate||candidate.expectedRevision!==input.expectedRevision)throw new Error('command_candidate_not_authorized');return {id:call.id,name:call.name,result:{request:candidate.request,expectedRevision:candidate.expectedRevision,requiresConfirmation:true}};}
 }
}

export function validateToolCalls(raw:unknown,allowed:readonly AiToolName[],authorization:ToolAuthorization){
 const calls=z.array(aiToolCallSchema).max(8).parse(raw),seen=new Set<string>();
 return calls.map(call=>{if(seen.has(call.id))throw new Error('duplicate_tool_call');seen.add(call.id);return validateToolCall(call,allowed,authorization);});
}
