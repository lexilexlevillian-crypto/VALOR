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

export const foundationCommandSchema = z.strictObject({
 commandId: id,
 type: z.enum(foundationCommandTypes),
 aggregateId: id.nullable(),
 expectedRevision: z.number().int().positive().nullable(),
 idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
 payload: z.record(z.string(), z.json())
});

export type FoundationCommand = z.infer<typeof foundationCommandSchema>;

export const foundationEventSchema = z.strictObject({
 eventId: id,
 type: z.enum(foundationEventTypes),
 aggregateId: id,
 aggregateRevision: z.number().int().positive(),
 schemaVersion: z.number().int().positive(),
 commandId: id,
 payload: z.record(z.string(), z.json()),
 seed: z.string().regex(/^[a-f0-9]{64}$/),
 rngVersion: z.string().min(1).max(64),
 createdAt: z.iso.datetime()
});

export type FoundationEvent = z.infer<typeof foundationEventSchema>;

