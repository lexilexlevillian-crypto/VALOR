import {z} from 'zod';
import {id} from './contracts.ts';

export const foundationCommandTypes = [
  'CreateCharacter',
  'EditCharacter',
  'StartCampaign',
  'AdvanceWorldTime',
  'MoveActor',
  'TransferItem',
  'AddContact',
  'SendText',
  'StartConversation',
  'ResolveCheck',
  'StartCombat',
  'CreateEvidence',
  'TriggerWatcher',
  'CreateSave',
  'BranchTimeline'
] as const;

export const foundationEventTypes = [
  'CharacterCreated',
  'CharacterEdited',
  'CampaignStarted',
  'WorldTimeAdvanced',
  'ActorMoved',
  'ItemTransferred',
  'ContactAdded',
  'TextSent',
  'ConversationStarted',
  'CheckResolved',
  'CombatStarted',
  'EvidenceCreated',
  'WatcherTriggered',
  'SaveCreated',
  'TimelineBranched'
] as const;

export type FoundationCommandType = typeof foundationCommandTypes[number];
export type FoundationEventType = typeof foundationEventTypes[number];

const timelineId=z.uuid(), characterId=z.uuid();
const startPayload=z.strictObject({
 timelineId,packageId:z.uuid().optional(),definition:z.unknown().optional()
}).refine(value=>Boolean(value.packageId)!==Boolean(value.definition),'one_start_source_required');

export const foundationCommandPayloadSchemas = {
 CreateCharacter:startPayload,
 EditCharacter:z.strictObject({timelineId,entity:z.unknown()}),
 StartCampaign:z.strictObject({
  worldId:z.uuid(),name:z.string().trim().min(1).max(160),startingAt:z.iso.datetime(),
  timezone:z.string().min(1).max(100),configuration:z.strictObject({overrides:z.unknown()}).optional()
 }),
 AdvanceWorldTime:z.strictObject({timelineId,characterId,minutes:z.number().int().min(1).max(10080)}),
 MoveActor:z.strictObject({timelineId,characterId,destinationId:z.uuid(),mode:z.enum(['walk','drive','transit','taxi']).default('walk'),vehicleId:z.uuid().nullable().default(null)}),
 TransferItem:z.strictObject({timelineId,characterId,itemId:z.uuid(),toId:z.uuid()}),
 AddContact:z.strictObject({timelineId,characterId,phoneId:z.uuid(),contactId:z.uuid(),label:z.string().trim().min(1).max(160)}),
 SendText:z.strictObject({timelineId,characterId,phoneId:z.uuid(),toId:z.uuid(),text:z.string().min(1).max(1000)}),
 StartConversation:z.strictObject({timelineId,characterId,targetId:z.uuid(),text:z.string().min(1).max(1000)}),
 ResolveCheck:z.strictObject({timelineId,characterId,attribute:z.enum(['Strength','Agility','Endurance','Intellect','Perception','Presence','Will']),skillId:z.uuid().nullable().default(null),checkId:z.uuid().nullable().default(null),context:z.string().max(1000).default('')}),
 StartCombat:z.strictObject({timelineId,characterId,targetId:z.uuid()}),
 CreateEvidence:z.strictObject({timelineId,entity:z.unknown()}),
 TriggerWatcher:z.strictObject({timelineId,watcherId:z.uuid()}),
 CreateSave:z.strictObject({timelineId,name:z.string().trim().min(1).max(160)}),
 BranchTimeline:z.strictObject({timelineId,saveId:z.uuid(),name:z.string().trim().min(1).max(160)})
} satisfies Record<FoundationCommandType,z.ZodType>;

export const foundationCommandSchema = z.strictObject({
 commandId: id,
 type: z.enum(foundationCommandTypes),
 aggregateId: id.nullable(),
 expectedRevision: z.number().int().positive().nullable(),
 idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
 payload: z.record(z.string(), z.json())
}).superRefine((command,context)=>{
 const result=foundationCommandPayloadSchemas[command.type].safeParse(command.payload);
 if(!result.success)for(const issue of result.error.issues)context.addIssue({...issue,path:['payload',...issue.path]});
 if(command.type==='StartCampaign'&&command.expectedRevision!==null)context.addIssue({code:'custom',message:'StartCampaign has no aggregate revision',path:['expectedRevision']});
 if(command.type!=='StartCampaign'&&command.expectedRevision===null)context.addIssue({code:'custom',message:'expectedRevision is required',path:['expectedRevision']});
});

export type FoundationCommand = z.infer<typeof foundationCommandSchema>;

export const foundationEventSchema = z.strictObject({
 eventId: id,
 type: z.enum(foundationEventTypes),
 actorId:id,
 scopeType:z.enum(['world','campaign']),
 scopeId:id,
 timelineId:id.nullable(),
 aggregateId: id,
 aggregateRevision: z.number().int().positive(),
 schemaVersion: z.number().int().positive(),
 commandId: id,
 sourceEventId:id.nullable(),
 payload: z.record(z.string(), z.json()),
 seed: z.string().regex(/^[a-f0-9]{64}$/),
 rngVersion: z.string().min(1).max(64),
 createdAt: z.iso.datetime()
});

export type FoundationEvent = z.infer<typeof foundationEventSchema>;

export const foundationEventForCommand:Record<FoundationCommandType,FoundationEventType>={
 CreateCharacter:'CharacterCreated',EditCharacter:'CharacterEdited',StartCampaign:'CampaignStarted',
 AdvanceWorldTime:'WorldTimeAdvanced',MoveActor:'ActorMoved',TransferItem:'ItemTransferred',
 AddContact:'ContactAdded',SendText:'TextSent',StartConversation:'ConversationStarted',
 ResolveCheck:'CheckResolved',StartCombat:'CombatStarted',CreateEvidence:'EvidenceCreated',
 TriggerWatcher:'WatcherTriggered',CreateSave:'SaveCreated',BranchTimeline:'TimelineBranched'
};

export const foundationCommandAuthorization:Record<FoundationCommandType,'campaign-creator'|'character-controller'|'campaign-member'>={
 CreateCharacter:'campaign-member',EditCharacter:'campaign-creator',StartCampaign:'campaign-creator',
 AdvanceWorldTime:'character-controller',MoveActor:'character-controller',TransferItem:'character-controller',
 AddContact:'character-controller',SendText:'character-controller',StartConversation:'character-controller',
 ResolveCheck:'character-controller',StartCombat:'character-controller',CreateEvidence:'campaign-creator',
 TriggerWatcher:'campaign-creator',CreateSave:'campaign-member',BranchTimeline:'campaign-member'
};

