import {z} from 'zod';
const id=z.uuid(),ids=z.array(id).max(10000),at=z.iso.datetime(),text=z.string().max(16000);
export const sourceSchema=z.strictObject({id,type:z.enum(['observation','testimony','record','rumor','inference','background','creator']),entityId:id.nullable(),recordId:id.nullable(),originalClaim:text,reliability:z.number().min(0).max(1),createdAt:at,eventId:id});
export const secretSchema=z.strictObject({id,subjectId:id,sensitivity:z.string().max(100),authorizedCharacterIds:ids,facets:z.array(z.strictObject({id,propositionId:id,requiredSourceIds:ids,discoverabilityPaths:z.array(z.string().max(200)).max(100),leakConsequences:text,availableTo:z.enum(['restricted','public']).default('restricted'),declassifiedAt:at.nullable().default(null)})).max(1000)});
export const identityKnowledgeSchema=z.strictObject({id,viewerId:id,subjectId:id,label:z.string().min(1).max(200),stage:z.enum(['unknown','familiar','first-name','full-name','corrected']),sourceId:id,at,previousId:id.nullable()});
export const spatialKnowledgeSchema=z.strictObject({id,viewerId:id,subjectId:id,precision:z.enum(['exact','area','rumored','last_known']),areaId:id,locationId:id.nullable(),label:z.string().min(1).max(200),sourceId:id,at});
export const interpretationSchema=z.strictObject({id,observationId:id,viewerId:id,recognizedAsId:id.nullable(),text,confidence:z.number().min(0).max(1),sourceIds:ids,at,supersedesId:id.nullable()});
export const knowledgePackageSchema=z.strictObject({id,name:z.string().max(200),category:z.enum(['background','occupation','faction','family','language','spatial','procedural','recognition','social','institutional']),claims:z.array(z.strictObject({propositionId:id,text,confidence:z.number().min(0).max(1)})).max(1000)});
export const informationExtensionFields={
 memoryTimelineId:id.nullable().optional(),
 sources:z.array(sourceSchema).default([]),secrets:z.array(secretSchema).default([]),identities:z.array(identityKnowledgeSchema).default([]),spatial:z.array(spatialKnowledgeSchema).default([]),interpretations:z.array(interpretationSchema).default([]),packages:z.array(knowledgePackageSchema).default([]),
 invalidatedNodeIds:ids.default([]),repairs:z.array(z.strictObject({id,eventId:id,entryId:id,reason:text,at,before:z.json(),after:z.json(),affectedIds:ids,committedEventIds:ids})).default([]),
 accessChanges:z.array(z.strictObject({id,eventId:id,recordId:id,at,before:z.json(),after:z.json()})).default([]),
};
