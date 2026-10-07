import {z} from 'zod';

const id=z.uuid(),ids=z.array(id).max(10000),at=z.iso.datetime(),unit=z.number().min(0).max(1),text=z.string().max(16000);
export const memoryTypeSchema=z.enum(['episodic','semantic','source','procedural','spatial','recognition','social','relationship','routine']);
export const memoryMutationTypeSchema=z.enum(['reinforce','weaken','reinterpret','contaminate','source_confuse','correct','invalidate','anchor','stale']);
export const cognitionSchema=z.strictObject({
 version:z.literal(1),type:memoryTypeSchema,timelineId:id.nullable(),inheritedFromTimelineId:id.nullable(),branchValidFrom:at,branchValidTo:at.nullable(),
 sourceKind:z.enum(['observation','information','event','authored-backstory','legacy','consolidation']),sourceObservationIds:ids,sourceInformationIds:ids,
 sceneId:z.string().max(200).nullable(),formedAt:at,locationId:id.nullable(),entities:ids,topics:z.array(z.string().max(100)).max(100),
 exactFragments:z.array(z.strictObject({text,confidence:unit})).max(30),gist:text,detail:z.enum(['high','moderate','low','fragmentary']),confidence:unit,accessibility:unit,sourceMemoryStrength:unit,
 informationalSalience:unit,emotionalSalience:unit,emotionAuthority:z.enum(['none','player','npc-state','mechanic']),formationReason:z.string().max(200),factors:z.record(z.string(),unit),
 sourceLabel:z.string().max(200),interpretation:text,anchor:z.boolean(),status:z.enum(['active','consolidated','stale','invalid']),
 lastRecalledAt:at.nullable(),recallCount:z.number().int().nonnegative(),reinforcementCount:z.number().int().nonnegative(),
 links:z.array(z.strictObject({entityId:id,relation:z.enum(['entity','location','object','relationship','source']),weight:unit,createdFrom:id})).max(200),
 consolidation:z.strictObject({sourceMemoryIds:ids,retainedExceptions:ids,sourceHash:z.string(),createdAt:at}).nullable(),consolidationParentId:id.nullable(),
 mutations:z.array(z.strictObject({id,type:memoryMutationTypeSchema,causedByEventId:id,at,previous:z.json(),next:z.json(),reason:text,affectedIds:ids,committedEventIds:ids})),
});
export type Cognition=z.infer<typeof cognitionSchema>;
export type MemoryType=z.infer<typeof memoryTypeSchema>;
