import { z } from 'zod';
export const id = z.uuid();
export const name = z.string().trim().min(1).max(160);
export const visibility = z.enum(['creator','campaign','owner','knowledge']);
export const scopeSchema = z.discriminatedUnion('type', [
  z.strictObject({type:z.literal('world'), id}),
  z.strictObject({type:z.literal('campaign'), id})
]);
export type Scope = z.infer<typeof scopeSchema>;
const root = {recordId:id, expectedRevision:z.number().int().positive()};
const position = z.number().int().min(0).max(1000000);
const value = z.json().refine(v => JSON.stringify(v).length <= 16000, 'Value too large');
export const commandSchema = z.discriminatedUnion('type', [
  z.strictObject({type:z.literal('record.create'), kind:name, name, visibility}),
  z.strictObject({type:z.literal('record.update'), ...root, name, visibility}),
  z.strictObject({type:z.literal('record.archive'), ...root}),
  z.strictObject({type:z.literal('record.instantiate'), sourceRecordId:id, sourceRevision:z.number().int().positive(), visibility}),
  z.strictObject({type:z.literal('section.add'), ...root, name, position, visibility, parentId:id.nullable().default(null)}),
  z.strictObject({type:z.literal('section.update'), ...root, sectionId:id, name, position, visibility}),
  z.strictObject({type:z.literal('section.archive'), ...root, sectionId:id}),
  z.strictObject({type:z.literal('field.add'), ...root, sectionId:id, name, position, visibility, valueType:z.enum(['text','number','boolean','json'])}),
  z.strictObject({type:z.literal('field.update'), ...root, fieldId:id, name, position, visibility}),
  z.strictObject({type:z.literal('field.archive'), ...root, fieldId:id}),
  z.strictObject({type:z.literal('field.set'), ...root, fieldId:id, value}),
  z.strictObject({type:z.literal('visibility.grant'), ...root, userId:id}),
  z.strictObject({type:z.literal('visibility.revoke'), ...root, userId:id})
]);
export type Command = z.infer<typeof commandSchema>;
export const envelopeSchema = z.strictObject({scope:scopeSchema, command:commandSchema});
export const eventSchema = z.strictObject({
  id, schemaVersion:z.literal(1), actorId:id, aggregateId:id,
  aggregateRevision:z.number().int().positive(), type:z.string().min(1),
  payload:z.record(z.string(), z.json()), seed:z.string().regex(/^[a-f0-9]{64}$/),
  rngVersion:z.literal('hmac-sha256-v1'), createdAt:z.iso.datetime()
});
export type DomainEvent = z.infer<typeof eventSchema>;
export type Actor = {id:string; role:'admin'|'creator'|'player'};
export class Fault extends Error {
  status:number; code:string;
  constructor(status:number, code:string) { super(code); this.status=status; this.code=code; }
}
export function ensure(condition:unknown, status:number, code:string): asserts condition {
  if (!condition) throw new Fault(status, code);
}
