import {z} from 'zod';
import {campaignConfigSchema} from '../campaign-config.ts';
import type {CanonSource} from './canon.ts';
import {id,name,visibility} from '../contracts.ts';
import {mediaBytes} from './media.ts';
const text=z.string().max(16000), short=z.string().max(1000), ref=id.nullable().default(null);
const cents=z.number().int().min(0).max(100000000000), score=z.number().min(-100).max(100), unit=z.number().min(0).max(100), openNumber=z.number().finite().min(-1000000).max(1000000);
const tags=z.array(z.string().max(80)).max(100).default([]);
export const attributes=['Strength','Agility','Endurance','Intellect','Perception','Presence','Will'] as const;
const customField=z.strictObject({id,name,type:z.enum(['text','number','boolean','json']),visibility,value:z.json(),helpText:short.default(''),repeatable:z.boolean().default(false),archived:z.boolean().default(false)});
const customSection=z.strictObject({id,name,parentId:ref,position:z.number().int().min(0),visibility:visibility.default('creator'),helpText:short.default(''),editable:z.boolean().default(true),repeatable:z.boolean().default(false),archived:z.boolean().default(false),fields:z.array(customField).max(1000)});
const common={description:text.default(''),tags,sections:z.array(customSection).max(1000).default([]),mediaIds:z.array(id).max(20).default([])};
const schedule=z.strictObject({id,minute:z.number().int().min(0).max(1439),locationId:id,activity:short,days:z.array(z.number().int().min(0).max(6)).default([0,1,2,3,4,5,6])});
const condition=z.strictObject({kind:z.enum(['time','location','item','relationship','knowledge','health','quest','evidence']),subjectId:ref,targetId:ref,at:z.iso.datetime().nullable().default(null),threshold:z.number().default(0),negate:z.boolean().default(false)});
const outcome=z.discriminatedUnion('type',[
 z.strictObject({type:z.literal('quest'),questId:id,status:z.enum(['active','succeeded','failed','expired'])}),
 z.strictObject({type:z.literal('reveal'),characterId:id,subjectId:id}),
 z.strictObject({type:z.literal('notice'),characterId:id,text:short}),
 z.strictObject({type:z.literal('reputation'),factionId:id,characterId:id,delta:score}),
 z.strictObject({type:z.literal('housing'),housingId:id,access:z.boolean()}),
 z.strictObject({type:z.literal('relationship'),relationshipId:id,label:short,operation:z.enum(['add','remove'])})
]);
const outcomeBands=z.strictObject({
 criticalMargin:openNumber.default(10),successAtCostMargin:openNumber.default(2),
 partialFailureMargin:openNumber.default(-2),failureInformationMargin:openNumber.default(-10)
});
const rules=z.strictObject({
 dieSides:z.number().int().min(2).max(1000),threshold:openNumber,
 damage:z.number().min(0).max(100),treatmentMinutes:z.number().int().min(1).max(1440),
 recoveryPerDay:z.number().min(0).max(100),unfamiliarPenalty:z.number().min(0).max(100),
 bleedPerMinute:z.number().min(0).max(10),
 formula:z.enum(['additive-die','additive-no-die','authored-total']).default('additive-die'),
 outcomeMode:z.enum(['legacy-binary','configured-bands']).default('legacy-binary'),
 outcomeBands:outcomeBands.default({criticalMargin:10,successAtCostMargin:2,partialFailureMargin:-2,failureInformationMargin:-10})
});
export const settingsSchema=z.strictObject({
 campaign:campaignConfigSchema.nullable().default(null),
 needs:z.boolean().default(false),fuel:z.boolean().default(false),weather:z.enum(['clear','rain','overcast','snow','fog']).default('clear'),narrationMode:z.enum(['grounded','anchored-prose']).default('grounded'),
 romance:z.boolean().default(false),intimacy:z.enum(['off','fade-to-black']).default('off'),
 intensity:z.enum(['restrained','grounded']).default('restrained'),difficulty:z.enum(['custom','narrative']).default('custom'),
 rules:rules.nullable().default(null),tokenBudget:z.number().int().min(0).max(1000000).default(0),userTokenBudget:z.number().int().min(0).max(1000000).default(0),
 contextTokens:z.number().int().min(256).max(16000).default(2000),timezone:z.string().default('America/New_York'),
 npcBudget:z.number().int().min(1).max(10000).default(2000),traitBudget:z.number().min(0).max(1000).default(0),
 attributeScale:z.strictObject({min:openNumber,max:openNumber,step:z.number().positive().max(1000000),labels:z.record(z.enum(attributes),short).default({Strength:'Strength',Agility:'Agility',Endurance:'Endurance',Intellect:'Intellect',Perception:'Perception',Presence:'Presence',Will:'Will'})}).default({min:0,max:100,step:1,labels:{Strength:'Strength',Agility:'Agility',Endurance:'Endurance',Intellect:'Intellect',Perception:'Perception',Presence:'Presence',Will:'Will'}}),
 advancement:z.strictObject({attributeMinutesPerPoint:z.number().int().min(1).max(1000000),attributeCostCentsPerHour:cents,maxPointsPerTraining:z.number().int().min(1).max(10)}).default({attributeMinutesPerPoint:120,attributeCostCentsPerHour:0,maxPointsPerTraining:1})
 ,weatherSchedule:z.array(z.strictObject({at:z.iso.datetime(),weather:z.enum(['clear','rain','overcast','snow','fog'])})).max(500).default([]),
 holidays:z.array(z.strictObject({date:z.iso.date(),label:name})).max(500).default([]),
 dailyLife:z.strictObject({minutes:z.number().int().min(1).max(1440),hygieneGain:unit}).nullable().default(null),
 healthRules:z.strictObject({infectionPerDay:unit,untreatedSeverityPerDay:unit,withdrawalPerDay:unit,soberingPerHour:unit}).nullable().default(null),
 calendar:z.strictObject({hemisphere:z.enum(['north','south']),sunriseHour:z.number().int().min(0).max(23),sunsetHour:z.number().int().min(0).max(23)}).nullable().default(null),
 reproductiveHealth:z.boolean().default(false),npcRouteTravel:z.boolean().default(false),deterministicCatchup:z.boolean().default(false),
 tactics:z.strictObject({movementMeters:z.number().min(0.1).max(1000),failedChaseVehicleDamage:unit}).nullable().default(null)
});
const trainingRecord=z.strictObject({id,skillId:ref,attribute:z.enum(attributes).nullable().default(null),trainerId:ref,source:short.default(''),startedAt:z.iso.datetime(),minutesInvested:z.number().int().min(0).max(1000000).default(0),requiredMinutes:z.number().int().min(1).max(1000000),
 practiceMinutes:z.number().int().min(0).max(1000000).default(0),requiredPracticeMinutes:z.number().int().min(0).max(1000000).default(0),costPaidCents:cents.default(0),requiredCostCents:cents.default(0),milestoneReached:z.boolean().default(false),status:z.enum(['active','completed','blocked']).default('active'),completedAt:z.iso.datetime().nullable().default(null),notes:text.default('')}).refine(v=>Boolean(v.skillId)!==Boolean(v.attribute),'training_target_required');
const character=z.strictObject({...common,characterSchemaVersion:z.number().int().positive().default(2),playable:z.boolean().default(false),controllerUserId:ref,
 legalName:short.default(''),aliases:tags,dob:z.iso.date().nullable().default(null),sex:short.default(''),gender:short.default(''),pronouns:short.default(''),
 identity:z.record(z.string(),short).default({}),nationality:short.default(''),cultureContext:text.default(''),originLocationId:ref,classContext:short.default(''),
 appearance:z.record(z.string(),short).default({}),heightCm:z.number().min(0).max(300).nullable().default(null),build:short.default(''),hair:short.default(''),eyes:short.default(''),
 complexion:short.default(''),features:tags,scars:tags,tattoos:tags,disabilities:tags,presentation:short.default(''),
 socialPresentation:z.record(z.string(),short).default({}),background:z.record(z.string(),text).default({}),familyBackground:text.default(''),
 employerOccupation:short.default(''),education:text.default(''),beliefsContext:text.default(''),
 voice:text.default(''),instructions:text.default(''),secrets:text.default(''),notes:text.default(''),
 attributes:z.record(z.enum(attributes),z.number().min(0).max(100)).default({Strength:0,Agility:0,Endurance:0,Intellect:0,Perception:0,Presence:0,Will:0}),
 skills:z.record(z.string(),z.number().min(0).max(100)).default({}),traits:z.array(id).default([]),
 locationId:ref,homeId:ref,factionIds:z.array(id).default([]),cash:cents.default(0),bank:cents.default(0),
 condition:z.enum(['conscious','unconscious','dead']).default('conscious'),blood:unit.default(100),fatigue:unit.default(0),
 hunger:unit.default(0),thirst:unit.default(0),hygiene:unit.default(100),intoxication:unit.default(0),
 restrainedBy:ref,goals:tags,fears:tags,mood:short.default(''),activity:short.default(''),heat:z.record(z.string(),unit).default({}),
 dependence:unit.default(0),withdrawal:unit.default(0),lastDoseAt:z.iso.datetime().nullable().default(null),
 training:z.array(trainingRecord).max(500).default([]),
 schedule:z.array(schedule).max(100).default([]),lastSimulated:z.iso.datetime().nullable().default(null),
 plans:z.array(z.strictObject({id,type:z.enum(['work','socialize','offer','share','travel','crime','care','message','breakup']),targetId:id,auxiliaryId:ref,
   priority:z.number().int().default(0),cooldownMinutes:z.number().int().min(15).max(10080).default(60),
   lastRun:z.iso.datetime().nullable().default(null),enabled:z.boolean().default(true),text:short.default(''),conditions:z.array(condition).max(32).default([])})).max(100).default([]),
 preferences:z.record(z.string(),short).default({}),compatibility:z.strictObject({traitWeights:z.record(id,score).default({}),requiredTraits:z.array(id).max(100).default([]),minimum:score.default(-100)}).default({traitWeights:{},requiredTraits:[],minimum:-100}),boundaries:tags,
 journey:z.strictObject({originId:id,destinationId:id,arrivesAt:z.iso.datetime(),activity:short}).nullable().default(null),
 reproductive:z.strictObject({enabled:z.boolean(),cycleStart:z.iso.datetime().nullable().default(null),cycleDays:z.number().int().min(1).max(400),bleedingDays:z.number().int().min(0).max(100),pregnancyStartedAt:z.iso.datetime().nullable().default(null),pregnancyDays:z.number().int().min(1).max(500),phase:z.enum(['inactive','cycle','menstruation','pregnancy','due']).default('inactive')}).nullable().default(null)
});
const location=z.strictObject({...common,parentId:ref,category:z.enum(['city','district','street','building','room','road','outside']).default('room'),
 exits:z.array(z.strictObject({to:id,minutes:z.number().int().min(1).max(10080),modes:z.array(z.enum(['walk','drive','transit','taxi'])).default(['walk']),locked:z.boolean().default(false),keyId:ref,fare:cents.default(0),
 interruption:z.strictObject({locationId:id,afterMinutes:z.number().int().min(1).max(10080),questId:ref,whenWeather:z.enum(['clear','rain','overcast','snow','fog']).nullable().default(null)}).nullable().default(null),terrainPenalty:unit.default(0),trafficPenalty:unit.default(0)})).default([]),
 hours:z.strictObject({opens:z.number().int().min(0).max(23),closes:z.number().int().min(0).max(24)}).nullable().default(null),
 discoverable:z.boolean().default(false),ownerId:ref,cover:unit.default(0),weatherExposed:z.boolean().default(false),closedDates:z.array(z.iso.date()).max(500).default([])
});
const item=z.strictObject({...common,category:z.enum(['object','clothing','weapon','firearm','ammo','medicine','food','drink','substance','key','document','container','phone','armor']).default('object'),
 ownerId:ref,locationId:ref,containerId:ref,quantity:z.number().int().min(0).max(100000).default(1),
 weight:z.number().min(0).max(100000).default(0),capacity:z.number().min(0).max(100000).default(0),
 condition:unit.default(100),concealed:z.boolean().default(false),equipped:z.boolean().default(false),
 stolen:z.boolean().default(false),price:cents.default(0),serial:short.default(''),caliber:short.default(''),
 magazine:z.number().int().min(0).max(1000).default(0),loaded:z.number().int().min(0).max(1000).default(0),
 proficiency:short.default(''),coverage:tags,battery:unit.default(100),locked:z.boolean().default(false),
 contacts:z.array(z.strictObject({characterId:id,label:name})).default([]),dose:unit.default(0),provenance:text.default(''),dirty:unit.default(0),
 protection:unit.default(1),rangeMeters:z.number().min(0).max(5000).nullable().default(null),deceasedId:ref
});
const vehicle=z.strictObject({...common,ownerId:ref,locationId:ref,keyId:ref,plate:short.default(''),registration:text.default(''),
 category:z.enum(['car','truck','motorcycle','bus','taxi','transit']).default('car'),fuel:unit.default(100),condition:unit.default(100),
 capacity:z.number().int().min(1).max(100).default(5),occupants:z.array(id).default([]),stolen:z.boolean().default(false),locked:z.boolean().default(true),
 trunkCapacity:z.number().min(0).max(100000).default(0),components:z.record(z.string(),unit).default({})
});
const relation=z.strictObject({...common,fromId:id,toId:id,labels:tags,attraction:score.default(0),affection:score.default(0),trust:score.default(0),
 respect:score.default(0),attachment:score.default(0),familiarity:score.default(0),desire:score.default(0),jealousy:score.default(0),
 resentment:score.default(0),fear:score.default(0),loyalty:score.default(0),dependency:score.default(0),inertia:z.number().min(0).max(1).default(0.8),
 boundaries:tags,history:z.array(z.strictObject({at:z.iso.datetime(),eventId:id,label:short})).default([]),secret:z.boolean().default(true),pending:short.default('')
});
const injury=z.strictObject({...common,characterId:id,bodyPart:name,category:z.enum(['cut','gunshot','burn','blunt','fracture','internal','infection','illness','overdose','scar','disability']),
 severity:unit,bleeding:unit.default(0),pain:unit.default(0),treated:z.boolean().default(false),permanent:z.boolean().default(false),
 startedAt:z.iso.datetime(),recoveryDays:z.number().min(0).max(10000).default(0),substance:short.default(''),infection:unit.default(0),modifiers:z.partialRecord(z.enum(attributes),score).default({})
});
const lore=z.strictObject({...common,subjectId:ref,source:text.default('Creator'),validFrom:z.iso.datetime().nullable().default(null),
 validUntil:z.iso.datetime().nullable().default(null),links:z.array(id).default([]),priority:z.number().int().default(0),
 activation:z.strictObject({locationId:ref,characterId:ref,keywords:tags}).nullable().default(null),embedding:z.array(z.number().finite()).max(4096).default([])
});
const catalog=z.strictObject({...common,category:short.default(''),cost:z.number().min(-100).max(100).default(0),mode:z.enum(['descriptive','costed']).default('descriptive'),
 prerequisites:z.array(id).default([]),opposes:z.array(id).default([]),modifiers:z.record(z.string(),openNumber).default({}),permanent:z.boolean().default(false),acquirable:z.boolean().default(true),
 scale:z.strictObject({min:openNumber,max:openNumber,step:z.number().positive().max(1000000),unit:short.default('rating')}).default({min:0,max:100,step:1,unit:'rating'}),
 ranks:z.array(z.strictObject({name:short,min:openNumber,max:openNumber})).max(32).default([]),
 training:z.strictObject({minutesPerPoint:z.number().int().min(1).max(1000000),practiceMinutesPerPoint:z.number().int().min(0).max(1000000),costCentsPerHour:cents,trainerRequired:z.boolean(),requiresMilestone:z.boolean()}).default({minutesPerPoint:60,practiceMinutesPerPoint:0,costCentsPerHour:0,trainerRequired:false,requiresMilestone:false})
});
const checkDefinition=z.strictObject({...common,attribute:z.enum(attributes),skillId:ref,difficulty:openNumber,context:short.default(''),
 formula:z.enum(['additive-die','additive-no-die','authored-total']).default('additive-die'),rollMode:z.enum(['roll','no-roll']).default('roll'),
 requiredTraits:z.array(id).default([]),requiredEquipmentTags:tags,equipmentModifier:openNumber.default(0),
 contextModifiers:z.record(z.string(),openNumber).default({}),conditionModifiers:z.record(z.string(),openNumber).default({}),
 outcomeMode:z.enum(['legacy-binary','configured-bands']).default('legacy-binary'),outcomeBands:outcomeBands.default({criticalMargin:10,successAtCostMargin:2,partialFailureMargin:-2,failureInformationMargin:-10})
});const faction=z.strictObject({...common,category:short.default(''),leaderId:ref,cohesion:unit.default(50),jurisdictionIds:z.array(id).default([]),memberIds:z.array(id).default([]),reputation:z.record(z.string(),score).default({}),treasuryCents:cents.default(0),
 groupPolicy:z.strictObject({intervalMinutes:z.number().int().min(15).max(10080),cohesionStep:score,shareKnowledge:z.boolean(),shareMood:z.boolean()}).nullable().default(null),lastGroupAt:z.iso.datetime().nullable().default(null),
 dispatchPolicy:z.strictObject({kind:z.enum(['police','ems']),responseMinutes:z.number().int().min(1).max(10080),hospitalId:ref}).nullable().default(null)});
const business=z.strictObject({...common,locationId:id,ownerId:ref,cash:cents.default(0),stock:z.array(id).default([]),priceMultiplier:z.number().min(0.1).max(10).default(1),
 hours:z.strictObject({opens:z.number().int().min(0).max(23),closes:z.number().int().min(0).max(24)}).default({opens:0,closes:24}),contraband:z.boolean().default(false)
});
const job=z.strictObject({...common,employerId:id,employeeId:id,locationId:id,hourlyCents:cents,minutesPerShift:z.number().int().min(1).max(1440),lastWorked:z.iso.datetime().nullable().default(null)});
const housing=z.strictObject({...common,locationId:id,landlordId:id,tenantId:id,rentCents:cents,dueAt:z.iso.datetime(),periodDays:z.number().int().min(1).max(366),access:z.boolean().default(true)});
const evidence=z.strictObject({...common,locationId:ref,objectId:ref,caseId:ref,sourceEventId:ref,discoveredBy:z.array(id).default([]),
 contaminated:z.boolean().default(false),destroyed:z.boolean().default(false),custodianId:ref,
 forensicFindings:z.array(z.strictObject({testName:name,result:text,completed:z.boolean().default(false)})).max(50).default([]),
 custody:z.array(z.strictObject({at:z.iso.datetime(),fromId:ref,toId:ref,eventId:id,reason:short})).default([])
});
const caseSchema=z.strictObject({...common,agencyId:id,investigatorId:id,suspectIds:z.array(id).default([]),evidenceIds:z.array(id).default([]),
 stage:z.enum(['reported','investigating','warrant','arrest','booking','jail','bail','interrogation','charged','trial','sentenced','probation','parole','closed']).default('reported'),
 warrantLocationIds:z.array(id).default([]),lawIds:z.array(id).default([]),leads:tags,bailAmountCents:cents.nullable().default(null)
});
const law=z.strictObject({...common,jurisdictionIds:z.array(id).default([]),agencyIds:z.array(id).default([]),
 permits:z.array(z.enum(['search','arrest','charge','sentence'])).default([]),requiresWarrant:z.boolean().default(true),bailCents:cents.default(0),penalty:text.default('')});
const quest=z.strictObject({...common,status:z.enum(['dormant','active','succeeded','failed','expired']).default('dormant'),characterId:ref,
 deadline:z.iso.datetime().nullable().default(null),objectives:tags,hiddenSolution:text.default(''),branches:z.record(z.string(),short).default({})});
const watcher=z.strictObject({...common,trigger:z.enum(['time','location','item','relationship','knowledge','health','quest']),subjectId:ref,targetId:ref,
 dueAt:z.iso.datetime().nullable().default(null),threshold:z.number().default(0),effect:z.enum(['activate-quest','fail-quest','reveal-lore','npc-offer']),
 cooldownMinutes:z.number().int().min(1).default(60),lastFired:z.iso.datetime().nullable().default(null),
 conditionMode:z.enum(['all','any']).default('all'),conflictGroup:short.default(''),
 conditions:z.array(condition).max(32).default([]),
 expiresAt:z.iso.datetime().nullable().default(null),priority:z.number().int().default(0),once:z.boolean().default(true),fired:z.boolean().default(false)});
const message=z.strictObject({...common,fromId:id,toId:id,phoneId:id,medium:z.enum(['sms','mms','call','voicemail','email']).default('sms'),body:text,at:z.iso.datetime(),read:z.boolean().default(false),status:z.enum(['queued','delivered','read']).default('queued'),
 callState:z.enum(['ringing','active','declined','missed','ended']).nullable().default(null),answeredAt:z.iso.datetime().nullable().default(null),endedAt:z.iso.datetime().nullable().default(null)});
const recipe=z.strictObject({...common,minutes:z.number().int().min(1).max(1440),locationId:ref,
 inputs:z.array(z.strictObject({itemId:id,quantity:z.number().int().min(1).max(10000)})).min(1).max(50),
 outputName:name,outputCategory:z.enum(['food','drink']),outputQuantity:z.number().int().min(1).max(10000),outputDose:unit,outputWeight:z.number().min(0).max(1000)});
const service=z.strictObject({...common,businessId:id,category:z.enum(['clinical','forensic']),minutes:z.number().int().min(1).max(10080),costCents:cents,
 medicineId:ref,severityReduction:unit.default(0),testName:short.default('')});
const transition=z.strictObject({...common,questId:id,from:z.enum(['dormant','active','succeeded','failed','expired']),to:z.enum(['active','succeeded','failed','expired']),conditions:z.array(condition).min(1).max(32),outcomes:z.array(outcome).max(50).default([]),priority:z.number().int().default(0),firedAt:z.iso.datetime().nullable().default(null)});
const production=z.strictObject({...common,businessId:id,inputs:z.array(z.strictObject({itemId:id,quantity:z.number().int().min(1).max(10000)})).min(1).max(50),outputId:id,quantity:z.number().int().min(1).max(10000),intervalMinutes:z.number().int().min(1).max(10080),nextAt:z.iso.datetime(),enabled:z.boolean().default(false),runs:z.number().int().min(0).default(0)});
const dispatch=z.strictObject({...common,agencyId:id,requesterId:id,locationId:id,responderId:ref,patientId:ref,destinationId:ref,report:short,kind:z.enum(['police','ems']),status:z.enum(['queued','enroute','arrived','closed']).default('queued'),dueAt:z.iso.datetime().nullable().default(null),transportConsent:z.boolean().default(false),createdAt:z.iso.datetime()});
const judgment=z.strictObject({...common,caseId:id,characterId:id,authority:short,verdict:z.enum(['acquitted','convicted']),fineCents:cents.default(0),custodyUntil:z.iso.datetime().nullable().default(null),probationUntil:z.iso.datetime().nullable().default(null),appliedAt:z.iso.datetime().nullable().default(null)});
const estate=z.strictObject({...common,characterId:id,executorId:id,beneficiaryId:id,authorized:z.boolean().default(false),settledAt:z.iso.datetime().nullable().default(null),funeralAt:z.iso.datetime().nullable().default(null),notified:z.boolean().default(false)});
const socialRule=z.strictObject({...common,relationshipId:id,label:short,conditions:z.array(condition).max(32).default([]),outcomes:z.array(outcome).max(50),firedAt:z.iso.datetime().nullable().default(null)});
const media=z.strictObject({...common,ownerId:ref,mime:z.enum(['image/png','image/jpeg','image/webp']),body:z.string().max(349528),alt:short});
const combat=z.strictObject({...common,participants:z.array(id).min(2),turnIndex:z.number().int().min(0).default(0),round:z.number().int().min(1).default(1),
 active:z.boolean().default(true),cover:z.record(z.string(),unit).default({}),defenses:z.record(z.string(),z.enum(['dodge','block','parry'])).default({}),log:tags,
 positions:z.record(z.string(),z.number().min(0).max(10000)).default({}),blockedLines:z.array(z.strictObject({fromId:id,toId:id})).max(500).default([])});
export const dataSchemas={character,location,item,vehicle,relationship:relation,injury,lore,storycard:lore,trait:catalog,skill:catalog,checkDefinition,faction,business,job,housing,evidence,case:caseSchema,law,quest,watcher,message,combat,recipe,service,transition,production,dispatch,judgment,estate,socialRule,media};
export type Kind=keyof typeof dataSchemas;
export const kinds=Object.keys(dataSchemas) as [Kind,...Kind[]];
export const entitySchema=z.strictObject({id,kind:z.enum(kinds),name,visibility, data:z.record(z.string(),z.json()),revision:z.number().int().positive().default(1),archived:z.boolean().default(false)});
export type Entity=z.infer<typeof entitySchema>;
export type Data<K extends Kind>=z.infer<(typeof dataSchemas)[K]>;
export function data<K extends Kind>(entity:Entity,kind:K):Data<K>{
 if(entity.kind!==kind)throw new Error('entity_kind_mismatch');
 return dataSchemas[kind].parse(entity.data) as Data<K>;
}
export function validateEntity(raw:unknown):Entity{
 const e=entitySchema.parse(raw);e.data=dataSchemas[e.kind].parse(e.data) as Entity['data'];
 if(e.kind==='media'){const m=data(e,'media');mediaBytes(m.mime,m.body);}
 if(e.kind==='item'){const d=data(e,'item');if(d.loaded>d.magazine)throw new Error('ammo_capacity');if(d.ownerId && (d.locationId||d.containerId))throw new Error('ambiguous_item_location');if(d.locationId&&d.containerId)throw new Error('ambiguous_item_location');}
 const sections=e.data.sections as z.infer<typeof customSection>[];const sectionIds=new Set(sections.map(s=>s.id)),fieldIds=new Set<string>();
 if(sectionIds.size!==sections.length)throw new Error('duplicate_section_id');
 for(const s of sections){
  if(s.parentId&&!sectionIds.has(s.parentId))throw new Error('missing_parent_section');
  let p=s.parentId;const seen=new Set([s.id]);
  while(p){if(seen.has(p))throw new Error('section_cycle');seen.add(p);const parent=sections.find(x=>x.id===p);if(!parent)throw new Error('missing_parent_section');p=parent.parentId;}
  for(const f of s.fields){if(fieldIds.has(f.id))throw new Error('duplicate_field_id');fieldIds.add(f.id);if(f.type!=='json'&&typeof f.value!==(f.type==='text'?'string':f.type))throw new Error('custom_field_type');}
 }
 return e;
}
export const actionSchema=z.discriminatedUnion('type',[
 z.strictObject({type:z.literal('request-assistance'),agencyId:id,phoneId:id,report:short,patientId:ref,transportConsent:z.boolean().default(false)}),
 z.strictObject({type:z.literal('dispatch-response'),dispatchId:id,operation:z.enum(['accept','close','transport'])}),
 z.strictObject({type:z.literal('settle-estate'),estateId:id}),
 z.strictObject({type:z.literal('tactical-move'),position:z.number().min(0).max(10000)}),
 z.strictObject({type:z.literal('read-message'),messageId:id,phoneId:id}),
 z.strictObject({type:z.literal('phone-call'),phoneId:id,toId:id}),
 z.strictObject({type:z.literal('call-response'),messageId:id,phoneId:id,response:z.enum(['answer','decline','end'])}),
 z.strictObject({type:z.literal('call-speak'),messageId:id,phoneId:id,text:short}),
 z.strictObject({type:z.literal('vehicle-access'),vehicleId:id,operation:z.enum(['unlock','lock','enter','leave'])}),
 z.strictObject({type:z.literal('cook'),recipeId:id}),
 z.strictObject({type:z.literal('hygiene'),operation:z.enum(['wash','laundry']),itemId:ref}),
 z.strictObject({type:z.literal('pay-bail'),caseId:id}),
 z.strictObject({type:z.literal('clinical-care'),serviceId:id,injuryId:id}),
 z.strictObject({type:z.literal('forensic-test'),serviceId:id,evidenceId:id,caseId:id}),
 z.strictObject({type:z.literal('look')}),z.strictObject({type:z.literal('wait'),minutes:z.number().int().min(1).max(10080)}),
 z.strictObject({type:z.literal('sleep'),minutes:z.number().int().min(1).max(720)}),z.strictObject({type:z.literal('say'),text:short}),
 z.strictObject({type:z.literal('travel'),destinationId:id,mode:z.enum(['walk','drive','transit','taxi']).default('walk'),vehicleId:ref}),
 z.strictObject({type:z.literal('take'),itemId:id}),z.strictObject({type:z.literal('give'),itemId:id,toId:id}),
 z.strictObject({type:z.literal('steal'),itemId:id,targetId:id}),
 z.strictObject({type:z.literal('cover')}),
 z.strictObject({type:z.literal('equip'),itemId:id,equipped:z.boolean()}),
 z.strictObject({type:z.literal('reload'),weaponId:id,ammoId:id}),z.strictObject({type:z.literal('consume'),itemId:id}),
 z.strictObject({type:z.literal('treat'),injuryId:id,medicineId:id}),
 z.strictObject({type:z.literal('message'),phoneId:id,toId:id,text:short,medium:z.enum(['sms','mms','call','voicemail','email']).default('sms')}),
 z.strictObject({type:z.literal('add-contact'),phoneId:id,contactId:id,label:name}),
 z.strictObject({type:z.literal('conversation'),targetId:id,text:short}),
 z.strictObject({type:z.literal('buy'),businessId:id,itemId:id,payment:z.enum(['cash','bank']).optional()}),z.strictObject({type:z.literal('sell'),businessId:id,itemId:id}),
 z.strictObject({type:z.literal('bank'),businessId:id,operation:z.enum(['deposit','withdraw']),cents:cents.refine(n=>n>0)}),
 z.strictObject({type:z.literal('work'),jobId:id}),z.strictObject({type:z.literal('pay-rent'),housingId:id}),
 z.strictObject({type:z.literal('social'),targetId:id,intent:z.enum(['greet','trust','flirt','date','commit','cohabit','marry','reconcile','breakup','intimacy','decline']),consent:z.boolean().default(false)}),
 z.strictObject({type:z.literal('share'),targetId:id,factId:id}),
 z.strictObject({type:z.literal('check'),attribute:z.enum(attributes),skillId:ref,checkId:ref,context:short.default('')}),z.strictObject({type:z.literal('train'),skillId:ref,attribute:z.enum(attributes).nullable().default(null),trainerId:ref,minutes:z.number().int().min(15).max(1440),milestoneReached:z.boolean().default(false)}).refine(v=>Boolean(v.skillId)!==Boolean(v.attribute),'training_target_required'),
 z.strictObject({type:z.literal('combat'),targetId:id}),
 z.strictObject({type:z.literal('attack'),targetId:id,weaponId:ref,bodyPart:name.default('torso')}),
 z.strictObject({type:z.literal('defend'),defense:z.enum(['dodge','block','parry'])}),
 z.strictObject({type:z.literal('grapple'),targetId:id}),z.strictObject({type:z.literal('restrain'),targetId:id,itemId:id}),
 z.strictObject({type:z.literal('disarm'),targetId:id}),z.strictObject({type:z.literal('shove'),targetId:id}),
 z.strictObject({type:z.literal('surrender')}),z.strictObject({type:z.literal('flee'),destinationId:id}),
 z.strictObject({type:z.literal('chase'),targetId:id,destinationId:id,vehicleId:ref}),
 z.strictObject({type:z.literal('custody'),evidenceId:id,toId:id,reason:short}),
 z.strictObject({type:z.literal('conceal'),itemId:id,concealed:z.boolean()}),
 z.strictObject({type:z.literal('store'),itemId:id,containerId:id}),
 z.strictObject({type:z.literal('retrieve'),itemId:id,containerId:id}),
 z.strictObject({type:z.literal('search')}),z.strictObject({type:z.literal('crime'),lawId:id,targetId:ref}),
 z.strictObject({type:z.literal('report'),factId:id,agencyId:id,investigatorId:id}),
 z.strictObject({type:z.literal('report-belief'),beliefId:id,agencyId:id,investigatorId:id,targetId:id}),
 z.strictObject({type:z.literal('collect'),evidenceId:id,caseId:id}),
 z.strictObject({type:z.literal('case'),caseId:id,operation:z.enum(['investigate','warrant','search','arrest','booking','jail','bail','interrogation','charge','trial','sentence','probation','parole','close']),targetId:ref}),
]);
export type Action=z.infer<typeof actionSchema>;
export type Settings=z.infer<typeof settingsSchema>;
export type Fact={id:string;subjectId:string;predicate:string;value:unknown;eventId:string;at:string;retiredAt:string|null};
export type Knowledge={observerId:string;factId:string;source:string;at:string};
export type Belief={id:string;observerId:string;proposition:string;confidence:number;source:string;at:string;correctedBy:string|null};
export type Memory={id:string;observerId:string;text:string;salience:number;decayPerDay:number;eventId:string;at:string;private:boolean};
export type State={canon?:CanonSource|null;clock:string;settings:Settings;entities:Entity[];facts:Fact[];knowledge:Knowledge[];beliefs:Belief[];memories:Memory[]};
export const getEntity=(s:State,id:string,kind?:Kind)=>{const e=s.entities.find(e=>e.id===id&&!e.archived);if(!e||kind&&e.kind!==kind)throw new Error('entity_unavailable');return e;};
export function refs(e:Entity):string[]{
 const result:string[]=[];const walk=(v:unknown,key='')=>{if(!v)return;if(typeof v==='string'&&((key.endsWith('Id')&&!['controllerUserId','sourceEventId','eventId','parentId'].includes(key))||['parentId','to'].includes(key)&&e.kind==='location'))result.push(v);
 else if(Array.isArray(v)){if(['traits','factionIds','occupants','links','prerequisites','opposes','jurisdictionIds','memberIds','stock','suspectIds','evidenceIds','warrantLocationIds','lawIds','participants','mediaIds'].includes(key))result.push(...v as string[]);else v.forEach(x=>walk(x,key));}
 else if(typeof v==='object')for(const[k,x]of Object.entries(v))if(!['sections','history','custody'].includes(k))walk(x,k);};walk(e.data);
 if(e.kind==='character'){const c=data(e,'character');result.push(...Object.keys(c.skills),...c.compatibility.requiredTraits,...Object.keys(c.compatibility.traitWeights));}
 return [...new Set(result)].filter(x=>x!==e.id);
}
export function validateState(s:State){
 const ids=new Set(s.entities.map(e=>e.id));if(ids.size!==s.entities.length)throw new Error('duplicate_entity_id');
 for(const e of s.entities){validateEntity(e);for(const r of refs(e))if(!ids.has(r))throw new Error('broken_reference');}
 for(const e of s.entities.filter(e=>!e.archived&&['location','item'].includes(e.kind))){const seen=new Set([e.id]);let p=(e.data.parentId??e.data.containerId) as string|null;while(p){if(seen.has(p))throw new Error('containment_cycle');seen.add(p);const parent=getEntity(s,p);p=(parent.data.parentId??parent.data.containerId) as string|null;}}
 for(const k of s.knowledge)if(!s.facts.some(f=>f.id===k.factId)||!ids.has(k.observerId))throw new Error('invalid_knowledge_reference');
 const byId=new Map(s.entities.map(e=>[e.id,e]));
 const target=(value:unknown,kinds:Kind[])=>{if(value!==null&&value!==undefined){const e=byId.get(String(value));if(!e||!kinds.includes(e.kind))throw new Error('reference_kind_mismatch');}};
 const common:Record<string,Kind[]>={locationId:['location'],homeId:['location'],originLocationId:['location'],skillId:['skill'],trainerId:['character'],characterId:['character'],investigatorId:['character'],employeeId:['character'],tenantId:['character'],leaderId:['character'],employerId:['business'],businessId:['business'],medicineId:['item'],agencyId:['faction'],caseId:['case'],phoneId:['item'],keyId:['item'],containerId:['item','vehicle'],questId:['quest'],outputId:['item'],responderId:['character'],requesterId:['character'],patientId:['character'],executorId:['character'],beneficiaryId:['character'],relationshipId:['relationship'],destinationId:['location']};
 const arrays:Record<string,Kind[]>={traits:['trait'],requiredTraits:['trait'],factionIds:['faction'],occupants:['character'],jurisdictionIds:['location'],memberIds:['character'],stock:['item'],suspectIds:['character'],evidenceIds:['evidence'],warrantLocationIds:['location'],lawIds:['law'],participants:['character'],mediaIds:['media']};
 for(const e of s.entities){
  for(const [key,kinds]of Object.entries(common))target(e.data[key],kinds);
  for(const [key,kinds]of Object.entries(arrays))for(const value of (e.data[key]??[]) as unknown[])target(value,kinds);
  if(['relationship','message'].includes(e.kind)){target(e.data.fromId,['character']);target(e.data.toId,['character']);}
  if(e.kind==='location'){target(e.data.parentId,['location']);for(const exit of data(e,'location').exits){target(exit.to,['location']);target(exit.keyId,['item']);if(exit.interruption){target(exit.interruption.locationId,['location']);target(exit.interruption.questId,['quest']);if(exit.interruption.afterMinutes>exit.minutes)throw new Error('interruption_after_arrival');}}}
  if(e.kind==='character'){for(const skillId of Object.keys(data(e,'character').skills))target(skillId,['skill']);for(const entry of data(e,'character').schedule)target(entry.locationId,['location']);for(const training of data(e,'character').training){target(training.skillId,['skill']);target(training.trainerId,['character']);if(training.attribute&&training.skillId)throw new Error('training_target_required');}}
  if(e.kind==='character'){const c=data(e,'character');if(c.journey){target(c.journey.originId,['location']);target(c.journey.destinationId,['location']);}if(c.reproductive&&c.reproductive.bleedingDays>c.reproductive.cycleDays)throw new Error('invalid_cycle');}
  if(e.kind==='faction')target(data(e,'faction').dispatchPolicy?.hospitalId,['location']);
  if(e.kind==='production'){const p=data(e,'production');if(new Set(p.inputs.map(i=>i.itemId)).size!==p.inputs.length||p.inputs.some(i=>i.itemId===p.outputId))throw new Error('invalid_production_inputs');for(const i of p.inputs)target(i.itemId,['item']);}
  if(e.kind==='transition'||e.kind==='socialRule')for(const o of data(e,e.kind).outcomes){if(o.type==='quest')target(o.questId,['quest']);if(o.type==='housing')target(o.housingId,['housing']);if(o.type==='relationship')target(o.relationshipId,['relationship']);if(o.type==='reputation')target(o.factionId,['faction']);if('characterId'in o)target(o.characterId,['character']);}
  if(e.kind==='recipe'){const recipe=data(e,'recipe');if(new Set(recipe.inputs.map(i=>i.itemId)).size!==recipe.inputs.length)throw new Error('duplicate_recipe_input');for(const input of recipe.inputs)target(input.itemId,['item']);}
  if(e.kind==='combat'){const c=data(e,'combat');for(const key of Object.keys(c.positions))if(!c.participants.includes(key))throw new Error('position_not_participant');for(const line of c.blockedLines)if(!c.participants.includes(line.fromId)||!c.participants.includes(line.toId))throw new Error('line_not_participant');}
 }
 for(const [rows,label]of [[s.facts,'fact'],[s.beliefs,'belief'],[s.memories,'memory']] as const){if(new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error('duplicate_'+label+'_id');}
 for(const f of s.facts)if(!ids.has(f.subjectId))throw new Error('invalid_fact_reference');
 for(const k of s.knowledge)target(k.observerId,['character']);
 for(const b of s.beliefs){target(b.observerId,['character']);if(b.correctedBy&&!s.facts.some(f=>f.id===b.correctedBy))throw new Error('invalid_correction_reference');}
 for(const m of s.memories)target(m.observerId,['character']);
}
