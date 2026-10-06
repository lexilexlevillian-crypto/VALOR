import {z} from 'zod';
import {actionSchema} from './model.ts';
import {narrativeDirectiveSchema,narrativePatchSchema} from './narrative-directives-contract.ts';

export const playModeSchema=z.enum(['GAME','STORY']);
export type PlayMode=z.infer<typeof playModeSchema>;
export const turnClauseSchema=z.strictObject({
 clauseId:z.string().min(1).max(128),
 dependency:z.enum(['NONE','PREVIOUS_SUCCESS','PREVIOUS_ATTEMPT','CONDITIONAL']),
 condition:z.strictObject({targetId:z.uuid(),field:z.enum(['open','locked']),equals:z.boolean()}).optional(),
 action:actionSchema,
});
export type TurnClause=z.infer<typeof turnClauseSchema>;
export const turnCommandSchema=z.strictObject({
 commandId:z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),sessionId:z.uuid(),
 expectedRevision:z.number().int().positive(),actorId:z.uuid(),mode:playModeSchema,
 clientTimestamp:z.iso.datetime({offset:true}).optional(),
 input:z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('freeform'),text:z.string().trim().min(1).max(1000)}),
  z.strictObject({kind:z.literal('action'),action:actionSchema,text:z.string().max(1000).optional()}),
  z.strictObject({kind:z.literal('affordance'),affordanceId:z.string().min(1).max(200)}),
  z.strictObject({kind:z.literal('inspection'),panel:z.enum(['scene','inventory','phone','journal','health','cases']),targetId:z.uuid().optional()}),
  z.strictObject({kind:z.literal('mode_switch'),targetMode:playModeSchema}),
  z.strictObject({kind:z.literal('clarification_answer'),pendingDecisionId:z.uuid(),answer:z.string().trim().min(1).max(1000)}),
  z.strictObject({kind:z.literal('cancel_pending'),pendingActionId:z.string().min(16).max(128)}),
  z.strictObject({kind:z.literal('narrative_directive'),directive:narrativeDirectiveSchema}),
  z.strictObject({kind:z.literal('regenerate_narration'),turnId:z.uuid(),patch:narrativePatchSchema.optional()}),
  z.strictObject({kind:z.literal('edit_request'),edit:z.strictObject({saveId:z.uuid(),reason:z.string().trim().min(1).max(1000),name:z.string().trim().min(1).max(160)})}),
 ]),
});
export type TurnCommand=z.infer<typeof turnCommandSchema>;
export type ControlState={holder:'PLAYER'|'WORLD'|'SYSTEM';reasonCode:string;actingEntityId?:string};
export type PendingDecision={pendingDecisionId:string;basedOnRevision:number;prompt:string;originalText:string;proposedClauses?:TurnClause[];proposalEvidence?:Array<{clauseId:string;start:number;end:number;text:string}>;options?:Array<{id:string;label:string;answerText?:string}>};
export type TurnTime={kind:'NONE'|'EXACT'|'COMPRESSED';start:string;end:string;elapsedSeconds:number;policyRef:string};
export type TurnAffordance={affordanceId:string;label:string;actionTemplate:string;expiresAtRevision:number;enabled:boolean};
