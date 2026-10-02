import {z} from 'zod';
import {campaignConfigSchema} from '../campaign-config.ts';
import type {CanonSource} from './canon.ts';
import {id,name,visibility} from '../contracts.ts';
import {mediaBytes} from './media.ts';
const text=z.string().max(16000), short=z.string().max(1000), ref=id.nullable().default(null);
const cents=z.number().int().min(0).max(100000000000), score=z.number().min(-100).max(100), unit=z.number().min(0).max(100), openNumber=z.number().finite().min(-1000000).max(1000000);
const tags=z.array(z.string().max(80)).max(100).default([]);
export const attributes=['Strength','Agility','Endurance','Intellect','Perception','Presence','Will'] as const;
export const planTypes=['work','socialize','offer','share','travel','crime','care','message','call','breakup','scene'] as const;
export const romanceIntents=['flirt','date','confess','commit','exclusive','cohabit','marry','reconcile','intimacy','confront-jealousy'] as const;
export const matureContentModes=['off','implicit','fade-to-black','allowed-description'] as const;
export const simulationTierNames=['active','relevant','distant'] as const;
export const npcActivityOutcomes=['worked-shift','traveled','traveled-home','called-friend','argument-occurred','missed-appointment','socialized','shared-information','message-sent','crime-committed','care-provided','relationship-changed','scene-initiated','injured','arrested','killed'] as const;
export const relationshipMetrics=['attraction','affection','trust','respect','attachment','familiarity','desire','jealousy','resentment','fear','loyalty','dependency'] as const;
export const socialDisclosures=['public','private','secret','disputed'] as const;
export const phoneServices=['none','poor','fair','good'] as const;
export const contactSources=['exchange','discovery','document','known-contact','creator'] as const;
export const needTypes=['hunger','thirst','fatigue','hygiene'] as const;
export const characterSectionKinds=['identity','appearance','background','stats','skills','traits','health','inventory','relationships','affiliations','knowledge','notes','custom'] as const;
export const characterFieldClasses=['biographical','current','subjective'] as const;
const valueMatches=(type:'text'|'number'|'boolean'|'json',value:unknown)=>type==='json'||typeof value===(type==='text'?'string':type);
export const customFieldSchema=z.strictObject({
 id,name,position:z.number().int().min(0).default(0),type:z.enum(['text','number','boolean','json']),visibility,value:z.json(),helpText:short.default(''),
 editable:z.boolean().default(true),repeatable:z.boolean().default(false),classification:z.enum(characterFieldClasses).default('subjective'),archived:z.boolean().default(false)
}).superRefine((field,context)=>{
 // Scalar repeatable values remain readable for schema-v2 compatibility; every v3 Creator edit normalizes them to arrays.
 const values=field.repeatable&&Array.isArray(field.value)?field.value:[field.value];
 if(values.some(value=>!valueMatches(field.type,value)))context.addIssue({code:'custom',message:'custom_field_type'});
});
export const customSectionSchema=z.strictObject({id,name,kind:z.enum(characterSectionKinds).default('custom'),parentId:ref,position:z.number().int().min(0),visibility:visibility.default('creator'),helpText:short.default(''),editable:z.boolean().default(true),repeatable:z.boolean().default(false),archived:z.boolean().default(false),fields:z.array(customFieldSchema).max(1000)});
const common={description:text.default(''),tags,sections:z.array(customSectionSchema).max(1000).default([]),mediaIds:z.array(id).max(20).default([])};
const schedule=z.strictObject({id,minute:z.number().int().min(0).max(1439),locationId:id,activity:short,days:z.array(z.number().int().min(0).max(6)).default([0,1,2,3,4,5,6]),kind:z.enum(['routine','work','sleep','travel-home','appointment','social']).default('routine'),required:z.boolean().default(false)});
const condition=z.strictObject({kind:z.enum(['time','location','item','relationship','knowledge','health','quest','evidence']),subjectId:ref,targetId:ref,at:z.iso.datetime().nullable().default(null),threshold:z.number().default(0),negate:z.boolean().default(false)});
const outcome=z.discriminatedUnion('type',[
 z.strictObject({type:z.literal('quest'),questId:id,status:z.enum(['active','succeeded','failed','expired'])}),
 z.strictObject({type:z.literal('reveal'),characterId:id,subjectId:id}),
 z.strictObject({type:z.literal('notice'),characterId:id,text:short}),
 z.strictObject({type:z.literal('reputation'),factionId:id,characterId:id,delta:score}),
 z.strictObject({type:z.literal('housing'),housingId:id,access:z.boolean()}),
 z.strictObject({type:z.literal('relationship'),relationshipId:id,label:short,operation:z.enum(['add','remove'])}),
 z.strictObject({type:z.literal('obligation'),obligationId:id,status:z.enum(['open','fulfilled','forgiven','defaulted','disputed'])})
]);
const outcomeBands=z.strictObject({
 criticalMargin:openNumber.default(10),successAtCostMargin:openNumber.default(2),
 partialFailureMargin:openNumber.default(-2),failureInformationMargin:openNumber.default(-10)
}).refine(bands=>bands.criticalMargin>bands.successAtCostMargin&&bands.successAtCostMargin>=0&&bands.partialFailureMargin<=0&&bands.failureInformationMargin<bands.partialFailureMargin,'invalid_outcome_bands');
const rank=z.strictObject({name:short,min:openNumber,max:openNumber}).refine(value=>value.min<=value.max,'invalid_rank');
const numericScale=z.strictObject({min:openNumber,max:openNumber,step:z.number().positive().max(1000000),unit:short.default('rating')}).refine(value=>value.min<=value.max,'invalid_scale');
const rules=z.strictObject({
 dieSides:z.number().int().min(2).max(1000),threshold:openNumber,
 damage:z.number().min(0).max(100),treatmentMinutes:z.number().int().min(1).max(1440),
 recoveryPerDay:z.number().min(0).max(100),unfamiliarPenalty:z.number().min(0).max(100),
 bleedPerMinute:z.number().min(0).max(10),
 formula:z.enum(['additive-die','additive-no-die','authored-total']).default('additive-die'),
 outcomeMode:z.enum(['legacy-binary','configured-bands']).default('legacy-binary'),
 outcomeBands:outcomeBands.default({criticalMargin:10,successAtCostMargin:2,partialFailureMargin:-2,failureInformationMargin:-10})
});
const weaponRules=z.strictObject({
 chamberMode:z.enum(['abstracted','modeled']).default('abstracted'),
 malfunctionBasePercent:z.number().min(0).max(100).default(0),conditionMalfunctionFactor:z.number().min(0).max(10).default(0),
 conditionLossPerShot:z.number().min(0).max(100).default(0),armorConditionLossPerHit:z.number().min(0).max(100).default(5),
 ballisticsFormula:z.enum(['damage-minus-conditioned-protection','authored-result']).default('damage-minus-conditioned-protection')
});
export const settingsSchema=z.strictObject({
 campaign:campaignConfigSchema.nullable().default(null),
 residencePlans:z.record(z.string().max(160),z.strictObject({floors:z.number().int().min(3).max(60),unitsPerFloor:z.number().int().min(2).max(40)})).default({}),
 needs:z.boolean().default(false),fuel:z.boolean().default(false),weather:z.enum(['clear','rain','overcast','snow','fog']).default('clear'),narrationMode:z.enum(['grounded','anchored-prose']).default('grounded'),
 romance:z.boolean().default(false),intimacy:z.enum(matureContentModes).default('off'),
 intensity:z.enum(['restrained','grounded']).default('restrained'),difficulty:z.enum(['custom','narrative']).default('custom'),
 rules:rules.nullable().default(null),tokenBudget:z.number().int().min(0).max(1000000).default(0),userTokenBudget:z.number().int().min(0).max(1000000).default(0),
 contextTokens:z.number().int().min(256).max(16000).default(2000),timezone:z.string().default('America/New_York'),
 npcBudget:z.number().int().min(1).max(10000).default(2000),npcCatchupWorkBudget:z.number().int().min(1000).max(2000000).default(200000),npcInitiativeBudget:z.number().int().min(1).max(10000).default(500),npcTimelineLimit:z.number().int().min(10).max(2000).default(500),traitBudget:z.number().min(0).max(1000).default(6),
 traitBalance:z.strictObject({maxTraits:z.number().int().min(0).max(1000),maxAdvantages:z.number().int().min(0).max(1000),maxDisadvantages:z.number().int().min(0).max(1000),disadvantageCreditCap:z.number().min(0).max(1000),refundPolicy:z.enum(['none','capped-current'])}).default({maxTraits:100,maxAdvantages:20,maxDisadvantages:20,disadvantageCreditCap:6,refundPolicy:'capped-current'}),
 attributeScale:z.strictObject({min:openNumber,max:openNumber,step:z.number().positive().max(1000000),ranks:z.array(rank).max(32).default([]),labels:z.record(z.enum(attributes),short).default({Strength:'Strength',Agility:'Agility',Endurance:'Endurance',Intellect:'Intellect',Perception:'Perception',Presence:'Presence',Will:'Will'})}).refine(value=>value.min<=value.max,'invalid_attribute_scale').default({min:0,max:100,step:1,ranks:[],labels:{Strength:'Strength',Agility:'Agility',Endurance:'Endurance',Intellect:'Intellect',Perception:'Perception',Presence:'Presence',Will:'Will'}}),
 advancement:z.strictObject({attributeMinutesPerPoint:z.number().int().min(1).max(1000000),attributeCostCentsPerHour:cents,maxPointsPerTraining:z.number().int().min(1).max(10)}).default({attributeMinutesPerPoint:120,attributeCostCentsPerHour:0,maxPointsPerTraining:1})
 ,weatherSchedule:z.array(z.strictObject({at:z.iso.datetime(),weather:z.enum(['clear','rain','overcast','snow','fog'])})).max(500).default([]),
 holidays:z.array(z.strictObject({date:z.iso.date(),label:name})).max(500).default([]),
 dailyLife:z.strictObject({minutes:z.number().int().min(1).max(1440),hygieneGain:unit}).nullable().default(null),
 healthRules:z.strictObject({infectionPerDay:unit,untreatedSeverityPerDay:unit,withdrawalPerDay:unit,soberingPerHour:unit}).nullable().default(null),
 calendar:z.strictObject({hemisphere:z.enum(['north','south']),sunriseHour:z.number().int().min(0).max(23),sunsetHour:z.number().int().min(0).max(23)}).nullable().default(null),
 reproductiveHealth:z.boolean().default(false),npcRouteTravel:z.boolean().default(false),deterministicCatchup:z.boolean().default(false),
 tactics:z.strictObject({movementMeters:z.number().min(0.1).max(1000),failedChaseVehicleDamage:unit}).nullable().default(null),
 weapons:weaponRules.default({chamberMode:'abstracted',malfunctionBasePercent:0,conditionMalfunctionFactor:0,conditionLossPerShot:0,armorConditionLossPerHit:5,ballisticsFormula:'damage-minus-conditioned-protection'})
 ,communications:z.strictObject({smsDelayMinutes:z.number().int().min(1).max(60),poorServiceDelayMinutes:z.number().int().min(1).max(240),ringSeconds:z.number().int().min(15).max(300),smsCharacterLimit:z.number().int().min(1).max(1000),mmsAttachmentLimit:z.number().int().min(0).max(10)}).default({smsDelayMinutes:1,poorServiceDelayMinutes:5,ringSeconds:60,smsCharacterLimit:160,mmsAttachmentLimit:3})
});
const workDays=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'] as const;
const rating=z.number().min(0).max(10);
export const npcRegistryStatuses=['active','inactive','missing','retired'] as const;
const legacyProfileVisibility={description:'campaign',legalName:'campaign',aliases:'campaign',ageYears:'campaign',sex:'campaign',gender:'campaign',pronouns:'campaign',identity:'campaign',appearance:'campaign',appearanceDescription:'campaign',heightCm:'campaign',build:'campaign',hair:'campaign',eyes:'campaign',complexion:'campaign',features:'campaign',scars:'campaign',tattoos:'campaign',disabilities:'campaign',presentation:'campaign',socialPresentation:'campaign',attractivenessContext:'campaign'} as const;
const dossierRatings=z.strictObject({toughness:rating,charm:rating,persuasion:rating,intimidation:rating,cunning:rating,loyalty:rating,trustworthiness:rating,empathy:rating,selfEsteem:rating,courage:rating,compassion:rating,judginess:rating,convincibility:rating}).default({toughness:0,charm:0,persuasion:0,intimidation:0,cunning:0,loyalty:0,trustworthiness:0,empathy:0,selfEsteem:0,courage:0,compassion:0,judginess:0,convincibility:0});
const personalityProfile=z.strictObject({summary:text.default(''),alignment:short.default(''),zodiac:short.default(''),enneagram:short.default(''),mbti:short.default(''),narcissism:rating.default(0),machiavellianism:rating.default(0),psychopathy:rating.default(0),sadism:rating.default(0),openness:rating.default(0),conscientiousness:rating.default(0),extraversion:rating.default(0),agreeableness:rating.default(0),neuroticism:rating.default(0)}).default({summary:'',alignment:'',zodiac:'',enneagram:'',mbti:'',narcissism:0,machiavellianism:0,psychopathy:0,sadism:0,openness:0,conscientiousness:0,extraversion:0,agreeableness:0,neuroticism:0});
const occupationProfile=z.strictObject({id,businessId:ref,placeOfWork:short.default(''),position:short.default(''),days:z.array(z.enum(workDays)).max(7).default([]),shift:z.enum(['day','evening','night','rotating','on-call','custom']).default('day'),startMinute:z.number().int().min(0).max(1439).nullable().default(null),endMinute:z.number().int().min(0).max(1439).nullable().default(null),notes:text.default('')});
const trainingRecord=z.strictObject({id,skillId:ref,attribute:z.enum(attributes).nullable().default(null),trainerId:ref,source:short.default(''),startedAt:z.iso.datetime(),minutesInvested:z.number().int().min(0).max(1000000).default(0),requiredMinutes:z.number().int().min(1).max(1000000),
 practiceMinutes:z.number().int().min(0).max(1000000).default(0),requiredPracticeMinutes:z.number().int().min(0).max(1000000).default(0),costPaidCents:cents.default(0),requiredCostCents:cents.default(0),milestoneReached:z.boolean().default(false),status:z.enum(['active','completed','blocked']).default('active'),completedAt:z.iso.datetime().nullable().default(null),notes:text.default('')}).refine(v=>Boolean(v.skillId)!==Boolean(v.attribute),'training_target_required');
const npcActivity=z.strictObject({id,at:z.iso.datetime(),tier:z.enum(simulationTierNames),outcome:z.enum(npcActivityOutcomes),source:z.enum(['schedule','goal','health','justice','relationship','faction','event']),sourceEntityId:ref,summary:short,eventId:short});
const character=z.strictObject({...common,characterSchemaVersion:z.number().int().positive().default(8),playable:z.boolean().default(false),controllerUserId:ref,
 registryStatus:z.enum(npcRegistryStatuses).default('active'),lastActiveAt:z.iso.datetime().nullable().default(null),arrested:z.boolean().default(false),retirementNarrative:text.default(''),mergedIntoId:ref,mergeRecordId:ref,
 profileVisibility:z.record(z.string(),visibility).default(legacyProfileVisibility),portraitMediaId:ref,
 legalName:short.default(''),aliases:tags,dob:z.iso.date().nullable().default(null),ageYears:z.number().int().min(0).max(200).nullable().default(null),sex:short.default(''),gender:short.default(''),pronouns:short.default(''),
 residence:z.strictObject({neighborhood:short,name:short.default(''),building:z.literal(1).default(1),floor:z.number().int().min(0).max(60).default(0),apartment:z.string().max(6).regex(/^$|^[0-9]{3,4}$/).default('')}).nullable().default(null),
 identity:z.record(z.string(),short).default({}),nationality:short.default(''),cultureContext:text.default(''),ethnicityContext:text.default(''),birthplace:short.default(''),originLocationId:ref,originNeighborhood:short.default(''),classContext:short.default(''),
 appearance:z.record(z.string(),short).default({}),appearanceDescription:text.default(''),heightCm:z.number().min(0).max(300).nullable().default(null),build:short.default(''),hair:short.default(''),eyes:short.default(''),
 complexion:short.default(''),features:tags,scars:tags,tattoos:tags,disabilities:tags,presentation:short.default(''),
 socialPresentation:z.record(z.string(),short).default({}),attractivenessContext:text.default(''),background:z.record(z.string(),text).default({}),familyBackground:text.default(''),
 employerOccupation:short.default(''),occupations:z.array(occupationProfile).max(3).default([]),dossierRatings,personalityProfile,psychologyNotes:text.default(''),education:text.default(''),beliefsContext:text.default(''),
 voice:text.default(''),instructions:text.default(''),aiBehavior:text.default(''),secrets:text.default(''),notes:text.default(''),needsContext:text.default(''),
 attributes:z.record(z.enum(attributes),openNumber).default({Strength:0,Agility:0,Endurance:0,Intellect:0,Perception:0,Presence:0,Will:0}),
 skills:z.record(z.string(),openNumber).default({}),traits:z.array(id).default([]),
 locationId:ref,homeId:ref,factionIds:z.array(id).default([]),socialConnections:z.strictObject({friendIds:z.array(id).max(1000),followingIds:z.array(id).max(1000),followerIds:z.array(id).max(1000)}).default({friendIds:[],followingIds:[],followerIds:[]}),cash:cents.default(0),bank:cents.default(0),
 condition:z.enum(['conscious','unconscious','dead']).default('conscious'),blood:unit.default(100),fatigue:unit.default(0),
 hunger:unit.default(0),thirst:unit.default(0),hygiene:unit.default(100),intoxication:unit.default(0),
 restrainedBy:ref,goals:tags,fears:tags,mood:short.default(''),activity:short.default(''),heat:z.record(z.string(),unit).default({}),
 dependence:unit.default(0),withdrawal:unit.default(0),lastDoseAt:z.iso.datetime().nullable().default(null),
 training:z.array(trainingRecord).max(500).default([]),
 schedule:z.array(schedule).max(100).default([]),lastSimulated:z.iso.datetime().nullable().default(null),simulationTier:z.enum(simulationTierNames).default('distant'),simulationTierReason:short.default('not currently material'),activityTimeline:z.array(npcActivity).max(2000).default([]),
 plans:z.array(z.strictObject({id,type:z.enum(planTypes),targetId:id,auxiliaryId:ref,
   priority:z.number().int().default(0),cooldownMinutes:z.number().int().min(15).max(10080).default(60),
   lastRun:z.iso.datetime().nullable().default(null),enabled:z.boolean().default(true),text:short.default(''),conditions:z.array(condition).max(32).default([]),constraints:z.array(condition).max(32).default([]),expiresAt:z.iso.datetime().nullable().default(null),fallback:z.enum(['skip','retry','disable','next-plan']).default('skip'),maxRunsPerDay:z.number().int().min(1).max(1440).default(4),runDate:z.iso.date().nullable().default(null),runsToday:z.number().int().min(0).max(1440).default(0),failedAttempts:z.number().int().min(0).max(1000000).default(0),lastOutcome:z.enum(['performed','blocked','expired']).nullable().default(null)})).max(100).default([]),
 traitEffectTrace:z.array(z.strictObject({at:z.iso.datetime(),traitId:id,effectId:id,type:z.enum(['schedule-priority','ai-priority','need-rate','first-impression']),target:short,value:openNumber,decision:short})).max(500).default([]),
 preferences:z.record(z.string(),short).default({}),contentFilters:z.strictObject({romance:z.enum(['enabled','off']),matureContent:z.enum(['campaign',...matureContentModes]),blockedIntents:z.array(z.enum(romanceIntents)).max(romanceIntents.length),allowNpcInitiative:z.boolean()}).default({romance:'enabled',matureContent:'campaign',blockedIntents:[],allowNpcInitiative:true}),compatibility:z.strictObject({traitWeights:z.record(id,score).default({}),requiredTraits:z.array(id).max(100).default([]),minimum:score.default(-100)}).default({traitWeights:{},requiredTraits:[],minimum:-100}),boundaries:tags,
 journey:z.strictObject({originId:id,destinationId:id,arrivesAt:z.iso.datetime(),activity:short}).nullable().default(null),
 reproductive:z.strictObject({enabled:z.boolean(),cycleStart:z.iso.datetime().nullable().default(null),cycleDays:z.number().int().min(1).max(400),bleedingDays:z.number().int().min(0).max(100),pregnancyStartedAt:z.iso.datetime().nullable().default(null),pregnancyDays:z.number().int().min(1).max(500),phase:z.enum(['inactive','cycle','menstruation','pregnancy','due']).default('inactive')}).nullable().default(null)
});
const location=z.strictObject({...common,parentId:ref,category:z.enum(['city','district','street','building','room','road','outside']).default('room'),
 exits:z.array(z.strictObject({to:id,minutes:z.number().int().min(1).max(10080),modes:z.array(z.enum(['walk','drive','transit','taxi'])).default(['walk']),locked:z.boolean().default(false),keyId:ref,fare:cents.default(0),
 interruption:z.strictObject({locationId:id,afterMinutes:z.number().int().min(1).max(10080),questId:ref,whenWeather:z.enum(['clear','rain','overcast','snow','fog']).nullable().default(null)}).nullable().default(null),terrainPenalty:unit.default(0),trafficPenalty:unit.default(0)})).default([]),
 hours:z.strictObject({opens:z.number().int().min(0).max(23),closes:z.number().int().min(0).max(24)}).nullable().default(null),
 discoverable:z.boolean().default(false),ownerId:ref,cover:unit.default(0),weatherExposed:z.boolean().default(false),closedDates:z.array(z.iso.date()).max(500).default([])
});
const phoneContact=z.strictObject({characterId:ref,label:name,savedName:short.default(''),number:short.default(''),alias:short.default(''),source:z.enum(contactSources).default('creator'),sourceEntityId:ref,consentPrivacy:z.enum(['shared','discovered','private','unknown','revoked']).default('unknown'),relationshipId:ref,createdAt:z.iso.datetime().nullable().default(null),lastInteractionAt:z.iso.datetime().nullable().default(null),blocked:z.boolean().default(false),favorite:z.boolean().default(false),permissions:z.strictObject({calls:z.boolean(),sms:z.boolean(),mms:z.boolean(),email:z.boolean(),social:z.boolean()}).default({calls:true,sms:true,mms:true,email:true,social:false})});
const itemCategories=['object','clothing','jewelry','wallet','id','key','cash','card','document','food','drink','medicine','drug','substance','tool','container','camera','computer','storage-media','phone','weapon','firearm','magazine','ammo','armor'] as const;
const itemType=z.strictObject({...common,itemTypeSchemaVersion:z.literal(1).default(1),category:z.enum(itemCategories).default('object'),
 dimensions:z.strictObject({lengthCm:z.number().min(0).max(100000).default(0),widthCm:z.number().min(0).max(100000).default(0),heightCm:z.number().min(0).max(100000).default(0),weightKg:z.number().min(0).max(100000).default(0)}).default({lengthCm:0,widthCm:0,heightCm:0,weightKg:0}),
 legal:z.strictObject({classification:z.enum(['unrestricted','restricted','prohibited']).default('unrestricted'),carry:z.enum(['unrestricted','open-only','concealed-permit','permit','prohibited']).default('unrestricted'),permitTags:tags,notes:text.default('')}).default({classification:'unrestricted',carry:'unrestricted',permitTags:[],notes:''}),
 defaultCondition:unit.default(100),stackability:z.strictObject({mode:z.enum(['unique','stackable']).default('unique'),maxStack:z.number().int().min(1).max(100000).default(1)}).default({mode:'unique',maxStack:1}),
 instanceSchema:z.record(z.string(),z.enum(['string','number','boolean','entity-id','date','datetime'])).default({}),capacity:z.strictObject({weightKg:z.number().min(0).max(100000).default(0),volumeLiters:z.number().min(0).max(100000).default(0)}).default({weightKg:0,volumeLiters:0}),wearableSlots:tags
});
const itemEvent=z.strictObject({at:z.iso.datetime(),eventId:ref,action:z.enum(['created','acquired','transferred','stolen','stored','retrieved','split','discarded','equipped','worn','concealed','discovered','modified','damaged','repaired','loaded','unloaded','shot','empty-click','malfunction','maintained','disarmed','recovered']),actorId:ref,fromId:ref,toId:ref,locationId:ref,containerId:ref,quantity:z.number().int().min(0).max(100000).default(1),note:short.default('')});
const item=z.strictObject({...common,itemSchemaVersion:z.number().int().positive().default(4),typeId:ref,category:z.enum(itemCategories).default('object'),
 ownerId:ref,possessorId:ref,locationId:ref,containerId:ref,quantity:z.number().int().min(0).max(100000).default(1),
 weight:z.number().min(0).max(100000).default(0),capacity:z.number().min(0).max(100000).default(0),
 condition:unit.default(100),concealed:z.boolean().default(false),concealment:unit.default(0),discoveredByIds:z.array(id).max(10000).default([]),equipped:z.boolean().default(false),wearState:z.enum(['stowed','held','equipped','worn']).default('stowed'),
 stolen:z.boolean().default(false),price:cents.default(0),serial:short.default(''),caliber:short.default(''),
 magazine:z.number().int().min(0).max(1000).default(0),loaded:z.number().int().min(0).max(1000).default(0),
 weaponSchemaVersion:z.number().int().positive().default(1),weaponFamily:short.default(''),ammoType:short.default(''),compatibleAmmoTypes:tags,magazineFamily:short.default(''),compatibleMagazineFamilies:tags,installedMagazineId:ref,
 chamberState:z.enum(['not-modeled','empty','loaded']).default('not-modeled'),chamberAmmoType:short.default(''),malfunction:z.enum(['none','misfire','failure-to-feed','jammed','broken']).default('none'),lastMaintainedAt:z.iso.datetime().nullable().default(null),shotsSinceMaintenance:z.number().int().min(0).max(10000000).default(0),attachmentIds:z.array(id).max(50).default([]),carryState:z.enum(['stored','holstered','slung','held']).default('stored'),concealmentContextId:ref,
 proficiency:short.default(''),coverage:tags,protectionClass:short.default(''),battery:unit.default(100),locked:z.boolean().default(false),
 phoneSchemaVersion:z.number().int().positive().default(2),phoneNumber:short.default(''),phoneType:z.enum(['mobile','landline']).default('mobile'),phoneState:z.enum(['active','lost','dead']).default('active'),service:z.enum(phoneServices).default('good'),batteryRequired:z.boolean().default(true),authorizedUserIds:z.array(id).max(20).default([]),phoneApps:z.strictObject({contacts:z.boolean(),messages:z.boolean(),calls:z.boolean(),voicemail:z.boolean(),camera:z.boolean(),photos:z.boolean(),email:z.boolean(),gps:z.boolean(),social:z.boolean()}).default({contacts:true,messages:true,calls:true,voicemail:true,camera:true,photos:true,email:true,gps:true,social:true}),
 contacts:z.array(phoneContact).max(5000).default([]),dose:unit.default(0),provenance:text.default(''),provenanceRecords:z.array(z.strictObject({at:z.iso.datetime(),source:short,eventId:ref,ownerId:ref,note:text.default('')})).max(2000).default([]),markings:tags,modifications:z.array(z.strictObject({id,name,description:text.default(''),sourceEventId:ref})).max(500).default([]),secretContents:text.default(''),instanceData:z.record(z.string(),z.json()).default({}),eventHistory:z.array(itemEvent).max(5000).default([]),dirty:unit.default(0),
 protection:unit.default(1),rangeMeters:z.number().min(0).max(5000).nullable().default(null),deceasedId:ref
});
const vehicle=z.strictObject({...common,ownerId:ref,locationId:ref,keyId:ref,plate:short.default(''),registration:text.default(''),
 category:z.enum(['car','truck','motorcycle','bus','taxi','transit']).default('car'),fuel:unit.default(100),condition:unit.default(100),
 capacity:z.number().int().min(1).max(100).default(5),occupants:z.array(id).default([]),stolen:z.boolean().default(false),locked:z.boolean().default(true),
 trunkCapacity:z.number().min(0).max(100000).default(0),components:z.record(z.string(),unit).default({})
});
const relationshipHistory=z.strictObject({at:z.iso.datetime(),eventId:id,label:short,kind:z.enum(['meaningful','label','boundary','routine','system']).optional(),reason:text.optional(),changes:z.partialRecord(z.enum(relationshipMetrics),score).optional(),actorId:ref.optional(),relatedEntityIds:z.array(id).max(100).optional(),disclosure:z.enum(socialDisclosures).optional(),knownByIds:z.array(id).max(100).optional()});
const relationshipLabel=z.strictObject({id,label:short,category:z.enum(['family','friend','enemy','rival','romantic','lover','affair','unrequited','poly','toxic','ex','social-circle','affiliation','professional','other']).default('other'),disclosure:z.enum(socialDisclosures).default('private'),knownByIds:z.array(id).max(100).default([]),status:z.enum(['active','ended']).default('active'),sourceEventId:ref,at:z.iso.datetime(),endedAt:z.iso.datetime().nullable().default(null)});
const consentRequest=z.strictObject({id,intent:z.enum(romanceIntents),initiatorId:id,recipientId:id,requestedAt:z.iso.datetime(),expiresAt:z.iso.datetime(),locationId:ref,status:z.enum(['pending','accepted','declined','withdrawn','expired']),respondedAt:z.iso.datetime().nullable().default(null),responseEventId:ref,contentMode:z.enum(matureContentModes),voluntary:z.literal(true).default(true)}).refine(value=>value.initiatorId!==value.recipientId,'consent_self_reference');
const relation=z.strictObject({...common,relationshipSchemaVersion:z.number().int().positive().default(2),fromId:id,toId:id,labels:tags,labelRecords:z.array(relationshipLabel).max(200).default([]),attraction:score.default(0),affection:score.default(0),trust:score.default(0),
 respect:score.default(0),attachment:score.default(0),familiarity:score.default(0),desire:score.default(0),jealousy:score.default(0),
 resentment:score.default(0),fear:score.default(0),loyalty:score.default(0),dependency:score.default(0),inertia:z.number().min(0).max(1).default(0.8),
 boundaries:tags,history:z.array(relationshipHistory).max(2000).default([]),secret:z.boolean().default(true),disclosure:z.enum(socialDisclosures).default('secret'),knownByIds:z.array(id).max(100).default([]),pending:short.default(''),consentRequests:z.array(consentRequest).max(200).default([]),relationshipStyle:z.enum(['unspecified','monogamous','open','polyamorous']).default('unspecified'),exclusivityStatus:z.enum(['none','proposed','exclusive','disputed']).default('none'),
 cooldownMinutes:z.number().int().min(15).max(10080).default(60),movementThreshold:z.number().min(0.1).max(100).default(1),lastMeaningfulAt:z.iso.datetime().nullable().default(null)
}).refine(value=>value.fromId!==value.toId,'relationship_self_reference');
const reputationSource=z.strictObject({id,eventId:id,delta:score,reason:short,at:z.iso.datetime(),decayPerDay:z.number().min(0).max(100).default(0),expiresAt:z.iso.datetime().nullable().default(null),disclosure:z.enum(socialDisclosures).default('private'),knownByIds:z.array(id).max(100).default([]),contextEntityIds:z.array(id).max(100).default([])});
const reputation=z.strictObject({...common,subjectId:id,audience:z.strictObject({type:z.enum(['neighborhood','gang','employer','police','family','public','custom']),entityId:ref,label:short}),baseScore:score.default(0),score,sourceEvents:z.array(reputationSource).max(1000).default([]),calculatedAt:z.iso.datetime().nullable().default(null)});
const obligationHistory=z.strictObject({at:z.iso.datetime(),eventId:id,status:z.enum(['open','fulfilled','forgiven','defaulted','disputed']),reason:short,disclosure:z.enum(socialDisclosures).default('private'),knownByIds:z.array(id).max(100).default([])});
const obligation=z.strictObject({...common,creditorId:id,debtorId:id,kind:z.enum(['favor','debt']),terms:text,dueCondition:text,stakes:text,status:z.enum(['open','fulfilled','forgiven','defaulted','disputed']).default('open'),disclosure:z.enum(socialDisclosures).default('private'),knownByIds:z.array(id).max(100).default([]),sourceEventId:ref,createdAt:z.iso.datetime(),dueAt:z.iso.datetime().nullable().default(null),settledAt:z.iso.datetime().nullable().default(null),contextEntityIds:z.array(id).max(100).default([]),history:z.array(obligationHistory).max(1000).default([])}).refine(value=>value.creditorId!==value.debtorId,'obligation_self_reference');
const injury=z.strictObject({...common,characterId:id,bodyPart:name,category:z.enum(['cut','gunshot','burn','blunt','fracture','internal','infection','illness','overdose','scar','disability']),
 severity:unit,bleeding:unit.default(0),pain:unit.default(0),treated:z.boolean().default(false),permanent:z.boolean().default(false),
 startedAt:z.iso.datetime(),recoveryDays:z.number().min(0).max(10000).default(0),substance:short.default(''),infection:unit.default(0),modifiers:z.partialRecord(z.enum(attributes),score).default({})
});
const loreScope=z.strictObject({campaign:z.boolean().nullable().default(null),placeIds:z.array(id).max(100).default([]),peopleIds:z.array(id).max(100).default([]),relationshipIds:z.array(id).max(100).default([]),eventIds:z.array(id).max(100).default([]),factionIds:z.array(id).max(100).default([])}).default({campaign:true,placeIds:[],peopleIds:[],relationshipIds:[],eventIds:[],factionIds:[]});
const loreActivation=z.strictObject({mode:z.enum(['always','all','any']).default('always'),locationId:ref,characterId:ref,keywords:tags,requiredTags:tags,placeIds:z.array(id).max(100).default([]),peopleIds:z.array(id).max(100).default([]),relationshipIds:z.array(id).max(100).default([]),eventIds:z.array(id).max(100).default([]),factionIds:z.array(id).max(100).default([]),from:z.iso.datetime().nullable().default(null),until:z.iso.datetime().nullable().default(null)}).nullable().default({mode:'always',locationId:null,characterId:null,keywords:[],requiredTags:[],placeIds:[],peopleIds:[],relationshipIds:[],eventIds:[],factionIds:[],from:null,until:null});
const loreDeactivation=z.strictObject({mode:z.enum(['never','any','all']).default('never'),at:z.iso.datetime().nullable().default(null),eventIds:z.array(id).max(100).default([]),keywords:tags,tags,reason:short.default('')}).default({mode:'never',at:null,eventIds:[],keywords:[],tags:[],reason:''});
const lore=z.strictObject({...common,schemaVersion:z.number().int().min(1).default(1),subjectId:ref,source:text.default('Creator'),sourceRefs:z.array(short).max(100).default([]),validFrom:z.iso.datetime().nullable().default(null),
 validUntil:z.iso.datetime().nullable().default(null),links:z.array(id).default([]),linkDetails:z.array(z.strictObject({targetId:id,type:short,note:text.default('')})).max(500).default([]),priority:z.number().int().default(0),scope:loreScope,
 activation:loreActivation,deactivation:loreDeactivation,embedding:z.array(z.number().finite()).max(4096).default([])
});
const scopedCheckModifier=z.strictObject({name:short,value:openNumber,attribute:z.enum(attributes).nullable().default(null),skillId:ref,contexts:tags});
const traitEffectScope=z.strictObject({attributes:z.array(z.enum(attributes)).max(7).default([]),skillIds:z.array(id).max(100).default([]),contexts:tags,planTypes:z.array(z.enum(planTypes)).max(planTypes.length).default([]),needs:z.array(z.enum(needTypes)).max(needTypes.length).default([]),choiceIds:tags,observerContexts:tags}).default({attributes:[],skillIds:[],contexts:[],planTypes:[],needs:[],choiceIds:[],observerContexts:[]});
const traitEffect=z.strictObject({id,name,type:z.enum(['check-modifier','choice','need-rate','schedule-priority','ai-priority','first-impression','flavor']),scope:traitEffectScope,
 stackingRule:z.enum(['stack','highest','lowest','unique']),conflictBehavior:z.enum(['reject','suppress','replace']),key:short,value:openNumber.default(0),
 operation:z.enum(['modify','unlock','restrict','describe']).default('modify'),description:text.default('')
}).superRefine((effect,context)=>{
 if(effect.type==='check-modifier'&&effect.operation!=='modify')context.addIssue({code:'custom',message:'invalid_check_effect'});
 if(effect.type==='choice'&&(!effect.scope.choiceIds.length||!['unlock','restrict'].includes(effect.operation)))context.addIssue({code:'custom',message:'invalid_choice_effect'});
 if(effect.type==='need-rate'&&!effect.scope.needs.length)context.addIssue({code:'custom',message:'need_scope_required'});
 if(['schedule-priority','ai-priority'].includes(effect.type)&&!effect.scope.planTypes.length)context.addIssue({code:'custom',message:'plan_scope_required'});
 if(effect.type==='first-impression'&&(!effect.scope.observerContexts.length||effect.operation!=='describe'||!effect.description))context.addIssue({code:'custom',message:'observer_context_required'});
 if(effect.type==='flavor'&&(effect.operation!=='describe'||!effect.description))context.addIssue({code:'custom',message:'flavor_description_required'});
});
const traitCombination=z.strictObject({id,name,traitIds:z.array(id).min(1).max(20),description:text.default(''),effects:z.array(traitEffect).max(50).default([])});
const catalog=z.strictObject({...common,category:short.default(''),cost:z.number().min(-100).max(100).default(0),mode:z.enum(['descriptive','costed']).default('descriptive'),
 prerequisites:z.array(id).default([]),opposes:z.array(id).default([]),modifiers:z.record(z.string(),openNumber).default({}),permanent:z.boolean().default(false),acquirable:z.boolean().default(true),
 scopedCheckModifiers:z.array(scopedCheckModifier).max(100).default([]),
 skillGrants:z.array(z.strictObject({skillId:id,fraction:z.number().min(0).max(1)})).max(30).default([]),
 effects:z.array(traitEffect).max(100).default([]),combinations:z.array(traitCombination).max(100).default([]),
 balance:z.enum(['neutral','advantage','disadvantage']).default('neutral'),
 acquisition:z.strictObject({mode:z.enum(['creator','earned','either']),requirements:tags,note:text.default('')}).default({mode:'either',requirements:[],note:''}),
 loss:z.strictObject({mode:z.enum(['never','creator','condition','earned']),requirements:tags,refund:z.enum(['none','prorated','full']),note:text.default('')}).default({mode:'creator',requirements:[],refund:'none',note:''}),
 generation:z.strictObject({weight:z.number().min(0).max(10000),tags,requiresBackgroundTags:tags}).default({weight:1,tags:[],requiresBackgroundTags:[]}),
 scale:numericScale.default({min:0,max:100,step:1,unit:'rating'}),
 ranks:z.array(rank).max(32).default([]),
 training:z.strictObject({minutesPerPoint:z.number().int().min(1).max(1000000),practiceMinutesPerPoint:z.number().int().min(0).max(1000000),costCentsPerHour:cents,trainerRequired:z.boolean(),requiresMilestone:z.boolean()}).default({minutesPerPoint:60,practiceMinutesPerPoint:0,costCentsPerHour:0,trainerRequired:false,requiresMilestone:false})
}).superRefine((value,context)=>{
 if(value.category.toLowerCase()==='experience'&&Object.keys(value.modifiers).length)context.addIssue({code:'custom',message:'experience_modifiers_require_scope'});
 if(value.category.toLowerCase()==='experience'&&value.effects.some(effect=>effect.type==='check-modifier'&&!effect.scope.skillIds.length&&!effect.scope.contexts.length))context.addIssue({code:'custom',message:'experience_modifiers_require_scope'});
 if(value.mode==='descriptive'&&value.cost!==0)context.addIssue({code:'custom',message:'descriptive_trait_cannot_be_costed'});
 if(value.balance==='advantage'&&value.cost<=0||value.balance==='disadvantage'&&value.cost>=0)context.addIssue({code:'custom',message:'trait_cost_direction'});
});
const traitTemplate=z.strictObject({...common,backgroundTags:tags,categoryWeights:z.record(z.string(),z.number().min(0).max(1000)).default({}),requiredTraitIds:z.array(id).max(100).default([]),excludedTraitIds:z.array(id).max(100).default([]),
 minTraits:z.number().int().min(0).max(100),maxTraits:z.number().int().min(0).max(100),budget:z.number().min(0).max(1000),categoryCaps:z.record(z.string(),z.number().int().min(0).max(100)).default({}),tagCaps:z.record(z.string(),z.number().int().min(0).max(100)).default({}),allowHidden:z.boolean().default(true)
}).refine(value=>value.minTraits<=value.maxTraits,'invalid_trait_template_range');
const checkDefinition=z.strictObject({...common,attribute:z.enum(attributes),skillId:ref,difficulty:openNumber,context:short.default(''),
 formula:z.enum(['additive-die','additive-no-die','authored-total']).default('additive-die'),rollMode:z.enum(['roll','no-roll']).default('roll'),
 requiredTraits:z.array(id).default([]),requiredEquipmentTags:tags,equipmentModifier:openNumber.default(0),
 contextModifiers:z.record(z.string(),openNumber).default({}),conditionModifiers:z.record(z.string(),openNumber).default({}),
 outcomeMode:z.enum(['legacy-binary','configured-bands']).default('legacy-binary'),outcomeBands:outcomeBands.default({criticalMargin:10,successAtCostMargin:2,partialFailureMargin:-2,failureInformationMargin:-10})
});const faction=z.strictObject({...common,category:short.default(''),leaderId:ref,cohesion:unit.default(50),jurisdictionIds:z.array(id).default([]),memberIds:z.array(id).default([]),reputation:z.record(z.string(),score).default({}),treasuryCents:cents.default(0),
 groupPolicy:z.strictObject({intervalMinutes:z.number().int().min(15).max(10080),cohesionStep:score,shareKnowledge:z.boolean(),shareMood:z.boolean(),shareRumors:z.boolean().default(false),rumorLimit:z.number().int().min(0).max(20).default(1),conflictThreshold:unit.default(0)}).nullable().default(null),lastGroupAt:z.iso.datetime().nullable().default(null),
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
const message=z.strictObject({...common,messageSchemaVersion:z.number().int().positive().default(2),threadId:short.default(''),fromId:id,toId:ref,phoneId:id,recipientPhoneId:ref,fromNumber:short.default(''),toNumber:short.default(''),participants:z.array(id).max(20).default([]),medium:z.enum(['sms','mms','call','voicemail','email']).default('sms'),body:text,at:z.iso.datetime(),sentAt:z.iso.datetime().nullable().default(null),availableAt:z.iso.datetime().nullable().default(null),deliveredAt:z.iso.datetime().nullable().default(null),receivedAt:z.iso.datetime().nullable().default(null),readAt:z.iso.datetime().nullable().default(null),read:z.boolean().default(false),status:z.enum(['draft','queued','sent','delivered','received','read','failed']).default('queued'),attachments:z.array(id).max(10).default([]),deletedByIds:z.array(id).max(20).default([]),hiddenFromIds:z.array(id).max(20).default([]),sourceEventId:ref,replyToId:ref,failureReason:short.default(''),
 callState:z.enum(['ringing','active','declined','missed','ended']).nullable().default(null),answeredAt:z.iso.datetime().nullable().default(null),endedAt:z.iso.datetime().nullable().default(null)});
const socialPost=z.strictObject({...common,authorId:id,platform:name,body:text,at:z.iso.datetime(),source:z.enum(['creator','simulation']),validated:z.boolean(),sourceEventId:ref,privacy:z.enum(['public','friends','followers','custom','private']).default('public'),allowedViewerIds:z.array(id).max(10000).default([]),attachments:z.array(id).max(10).default([]),deleted:z.boolean().default(false),hiddenFromIds:z.array(id).max(1000).default([])});
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
export const dataSchemas={character,location,itemType,item,vehicle,relationship:relation,reputation,obligation,injury,lore,storycard:lore,trait:catalog,traitTemplate,skill:catalog,checkDefinition,faction,business,job,housing,evidence,case:caseSchema,law,quest,watcher,message,socialPost,combat,recipe,service,transition,production,dispatch,judgment,estate,socialRule,media};
export type Kind=keyof typeof dataSchemas;
export const kinds=Object.keys(dataSchemas) as [Kind,...Kind[]];
export const entitySchema=z.strictObject({id,kind:z.enum(kinds),name,visibility, data:z.record(z.string(),z.json()),revision:z.number().int().positive().default(1),archived:z.boolean().default(false)});
export type Entity=z.infer<typeof entitySchema>;
export type Data<K extends Kind>=z.infer<(typeof dataSchemas)[K]>;
export type CustomSection=z.infer<typeof customSectionSchema>;
export const characterProfileTemplateSchema=z.strictObject({schemaVersion:z.literal(1).default(1),sections:z.array(customSectionSchema).max(1000)});
export function validateCustomSections(sections:CustomSection[]){
 const sectionIds=new Set(sections.map(section=>section.id)),fieldIds=new Set<string>();
 if(sectionIds.size!==sections.length)throw new Error('duplicate_section_id');
 for(const section of sections){
  if(section.parentId&&!sectionIds.has(section.parentId))throw new Error('missing_parent_section');
  let parentId=section.parentId;const seen=new Set([section.id]);
  while(parentId){if(seen.has(parentId))throw new Error('section_cycle');seen.add(parentId);const parent=sections.find(candidate=>candidate.id===parentId);if(!parent)throw new Error('missing_parent_section');parentId=parent.parentId;}
  for(const field of section.fields){if(fieldIds.has(field.id))throw new Error('duplicate_field_id');fieldIds.add(field.id);}
 }
 return sections;
}
export function applyCharacterProfileTemplate(existing:CustomSection[],template:unknown):CustomSection[]{
 const current=validateCustomSections(z.array(customSectionSchema).max(1000).parse(existing));
 const replacement=characterProfileTemplateSchema.parse(template).sections;
 validateCustomSections(replacement);
 const currentFields=new Map(current.flatMap(section=>section.fields.map(field=>[field.id,field] as const)));
 const next=structuredClone(replacement).map(section=>({...section,fields:section.fields.map(field=>{
  const old=currentFields.get(field.id);
  // A stable field ID owns its value contract. Template presentation may move or relabel it, but cannot reinterpret the saved value.
  return old?{...field,type:old.type,value:structuredClone(old.value),repeatable:old.repeatable}:field;
 })}));
 const nextFields=new Set(next.flatMap(section=>section.fields.map(field=>field.id)));
 const bySection=new Map(next.map(section=>[section.id,section]));
 for(const oldSection of current){
  const leftovers=oldSection.fields.filter(field=>!nextFields.has(field.id)).map(field=>({...structuredClone(field),archived:true}));
  if(!leftovers.length)continue;
  const target=bySection.get(oldSection.id);
  if(target)target.fields.push(...leftovers);
  else{const archived={...structuredClone(oldSection),parentId:null,archived:true,fields:leftovers};next.push(archived);bySection.set(archived.id,archived);}
 }
 return validateCustomSections(next);
}
export function data<K extends Kind>(entity:Entity,kind:K):Data<K>{
 if(entity.kind!==kind)throw new Error('entity_kind_mismatch');
 return dataSchemas[kind].parse(entity.data) as Data<K>;
}
export function validateEntity(raw:unknown):Entity{
 const e=entitySchema.parse(raw);e.data=dataSchemas[e.kind].parse(e.data) as Entity['data'];
 if(e.kind==='media'){const m=data(e,'media');mediaBytes(m.mime,m.body);}
 if(e.kind==='item'){const d=data(e,'item');if(d.loaded>d.magazine)throw new Error('ammo_capacity');if(d.possessorId&&(d.locationId||d.containerId)||d.locationId&&d.containerId)throw new Error('ambiguous_item_location');if(['phone','key','weapon','firearm','magazine','document','camera','computer','storage-media','vehicle'].includes(d.category)&&d.quantity!==1)throw new Error('unique_item_quantity');if(d.category==='firearm'&&d.chamberState==='loaded'&&!d.chamberAmmoType&&d.ammoType)d.chamberAmmoType=d.ammoType;if(d.category!=='firearm'&&d.installedMagazineId)throw new Error('magazine_install_target');if(['firearm','weapon'].includes(d.category)&&d.concealed&&!d.concealmentContextId)throw new Error('concealment_context_required');e.data=d as Entity['data'];}
 validateCustomSections(e.data.sections as CustomSection[]);
 return e;
}
export const actionSchema=z.discriminatedUnion('type',[
 z.strictObject({type:z.literal('request-assistance'),agencyId:id,phoneId:id,report:short,patientId:ref,transportConsent:z.boolean().default(false)}),
 z.strictObject({type:z.literal('dispatch-response'),dispatchId:id,operation:z.enum(['accept','close','transport'])}),
 z.strictObject({type:z.literal('settle-estate'),estateId:id}),
 z.strictObject({type:z.literal('tactical-move'),position:z.number().min(0).max(10000)}),
 z.strictObject({type:z.literal('read-message'),messageId:id,phoneId:id}),
 z.strictObject({type:z.literal('phone-call'),phoneId:id,toId:ref,number:short.optional()}).refine(value=>Boolean(value.toId)!==Boolean(value.number),'phone_destination_required'),
 z.strictObject({type:z.literal('call-response'),messageId:id,phoneId:id,response:z.enum(['answer','decline','end'])}),
 z.strictObject({type:z.literal('call-speak'),messageId:id,phoneId:id,text:short}),
 z.strictObject({type:z.literal('leave-voicemail'),phoneId:id,callId:id,text:short}),
 z.strictObject({type:z.literal('delete-message'),phoneId:id,messageId:id,operation:z.enum(['delete','hide','restore'])}),
 z.strictObject({type:z.literal('contact-control'),phoneId:id,contactId:id,operation:z.enum(['block','unblock','favorite','unfavorite','delete'])}),
 z.strictObject({type:z.literal('share-number'),phoneId:id,toId:id}),
 z.strictObject({type:z.literal('vehicle-access'),vehicleId:id,operation:z.enum(['unlock','lock','enter','leave'])}),
 z.strictObject({type:z.literal('cook'),recipeId:id}),
 z.strictObject({type:z.literal('hygiene'),operation:z.enum(['wash','laundry']),itemId:ref}),
 z.strictObject({type:z.literal('pay-bail'),caseId:id}),
 z.strictObject({type:z.literal('clinical-care'),serviceId:id,injuryId:id}),
 z.strictObject({type:z.literal('forensic-test'),serviceId:id,evidenceId:id,caseId:id}),
 z.strictObject({type:z.literal('look')}),z.strictObject({type:z.literal('inspect'),targetId:id}),z.strictObject({type:z.literal('wait'),minutes:z.number().int().min(1).max(10080)}),
 z.strictObject({type:z.literal('sleep'),minutes:z.number().int().min(1).max(720)}),z.strictObject({type:z.literal('say'),text:short}),
 z.strictObject({type:z.literal('travel'),destinationId:id,mode:z.enum(['walk','drive','transit','taxi']).default('walk'),vehicleId:ref}),
 z.strictObject({type:z.literal('take'),itemId:id}),z.strictObject({type:z.literal('give'),itemId:id,toId:id}),
 z.strictObject({type:z.literal('steal'),itemId:id,targetId:id}),
 z.strictObject({type:z.literal('cover')}),
 z.strictObject({type:z.literal('equip'),itemId:id,equipped:z.boolean()}),
 z.strictObject({type:z.literal('reload'),weaponId:id,ammoId:id.optional(),magazineId:id.optional()}).refine(value=>Boolean(value.ammoId)!==Boolean(value.magazineId),'reload_source_required'),
 z.strictObject({type:z.literal('load-magazine'),magazineId:id,ammoId:id,quantity:z.number().int().min(1).max(1000).optional()}),
 z.strictObject({type:z.literal('clear-malfunction'),weaponId:id}),z.strictObject({type:z.literal('maintain-weapon'),weaponId:id,maintenanceItemId:id.optional()}),
 z.strictObject({type:z.literal('attach-weapon'),weaponId:id,attachmentId:id,attached:z.boolean()}),z.strictObject({type:z.literal('consume'),itemId:id}),
 z.strictObject({type:z.literal('treat'),injuryId:id,medicineId:id}),
 z.strictObject({type:z.literal('message'),phoneId:id,toId:ref,number:short.optional(),text:short,medium:z.enum(['sms','mms','email']).default('sms'),attachments:z.array(id).max(10).optional()}).refine(value=>Boolean(value.toId)!==Boolean(value.number),'phone_destination_required'),
 z.strictObject({type:z.literal('add-contact'),phoneId:id,contactId:id,label:name,alias:short.optional(),factId:id.optional()}),
 z.strictObject({type:z.literal('conversation'),targetId:id,text:short}),
 z.strictObject({type:z.literal('buy'),businessId:id,itemId:id,payment:z.enum(['cash','bank']).optional()}),z.strictObject({type:z.literal('sell'),businessId:id,itemId:id}),
 z.strictObject({type:z.literal('bank'),businessId:id,operation:z.enum(['deposit','withdraw']),cents:cents.refine(n=>n>0)}),
 z.strictObject({type:z.literal('work'),jobId:id}),z.strictObject({type:z.literal('pay-rent'),housingId:id}),
 z.strictObject({type:z.literal('social'),targetId:id,intent:z.enum(['greet','trust',...romanceIntents,'breakup','decline']),response:z.enum(['propose','accept','decline','withdraw']).optional(),consentRequestId:id.nullable().optional(),consent:z.boolean().default(false)}),
 z.strictObject({type:z.literal('content-filter'),romance:z.enum(['enabled','off']),matureContent:z.enum(['campaign',...matureContentModes]),blockedIntents:z.array(z.enum(romanceIntents)).max(romanceIntents.length),allowNpcInitiative:z.boolean()}),
 z.strictObject({type:z.literal('safety-exit'),targetId:ref}),
 z.strictObject({type:z.literal('share'),targetId:id,factId:id}),
 z.strictObject({type:z.literal('check'),attribute:z.enum(attributes),skillId:ref,checkId:ref,context:short.default('')}),z.strictObject({type:z.literal('train'),skillId:ref,attribute:z.enum(attributes).nullable().default(null),trainerId:ref,source:short.default(''),mode:z.enum(['instruction','practice']).default('instruction'),minutes:z.number().int().min(15).max(1440),milestoneReached:z.boolean().default(false)}).refine(v=>Boolean(v.skillId)!==Boolean(v.attribute),'training_target_required'),
 z.strictObject({type:z.literal('combat'),targetId:id}),
 z.strictObject({type:z.literal('attack'),targetId:id,weaponId:ref,bodyPart:name.default('torso')}),
 z.strictObject({type:z.literal('defend'),defense:z.enum(['dodge','block','parry'])}),
 z.strictObject({type:z.literal('grapple'),targetId:id}),z.strictObject({type:z.literal('restrain'),targetId:id,itemId:id}),
 z.strictObject({type:z.literal('disarm'),targetId:id}),z.strictObject({type:z.literal('shove'),targetId:id}),
 z.strictObject({type:z.literal('surrender')}),z.strictObject({type:z.literal('flee'),destinationId:id}),
 z.strictObject({type:z.literal('chase'),targetId:id,destinationId:id,vehicleId:ref}),
 z.strictObject({type:z.literal('custody'),evidenceId:id,toId:id,reason:short}),
 z.strictObject({type:z.literal('conceal'),itemId:id,concealed:z.boolean(),contextId:id.optional()}),
 z.strictObject({type:z.literal('store'),itemId:id,containerId:id}),
 z.strictObject({type:z.literal('retrieve'),itemId:id,containerId:id}),
 z.strictObject({type:z.literal('examine-item'),itemId:id}),
 z.strictObject({type:z.literal('split-stack'),itemId:id,quantity:z.number().int().min(1).max(99999)}),
 z.strictObject({type:z.literal('transfer-item'),itemId:id,toId:id,quantity:z.number().int().min(1).max(100000).optional(),transferOwnership:z.boolean().optional()}),
 z.strictObject({type:z.literal('discard-item'),itemId:id,quantity:z.number().int().min(1).max(100000).optional()}),
 z.strictObject({type:z.literal('wear-item'),itemId:id,worn:z.boolean()}),
 z.strictObject({type:z.literal('search'),targetId:id.optional(),method:z.enum(['visual','pat-down','thorough','forensic']).optional(),minutes:z.number().int().min(1).max(120).optional(),acceptRisk:z.boolean().optional()}),z.strictObject({type:z.literal('crime'),lawId:id,targetId:ref}),
 z.strictObject({type:z.literal('report'),factId:id,agencyId:id,investigatorId:id}),
 z.strictObject({type:z.literal('report-belief'),beliefId:id,agencyId:id,investigatorId:id,targetId:id}),
 z.strictObject({type:z.literal('collect'),evidenceId:id,caseId:id}),
 z.strictObject({type:z.literal('case'),caseId:id,operation:z.enum(['investigate','warrant','search','arrest','booking','jail','bail','interrogation','charge','trial','sentence','probation','parole','close']),targetId:ref}),
]);
export type Action=z.infer<typeof actionSchema>;
export type Settings=z.infer<typeof settingsSchema>;
export const recallConditionsSchema=z.strictObject({entityIds:z.array(id).max(100).default([]),tags,locationId:ref,from:z.iso.datetime().nullable().default(null),until:z.iso.datetime().nullable().default(null)});
export const factSchema=z.strictObject({id,subjectId:id,predicate:z.string().max(160),objectId:id.nullable().default(null),value:z.json(),qualifiers:z.record(z.string(),z.json()).default({}),source:z.string().max(1000).default('simulation'),truthStatus:z.enum(['verified','asserted','disputed','false','superseded']).default('verified'),audience:z.array(z.string().max(160)).max(100).default([]),confidence:z.number().min(0).max(1).default(1),observedAt:z.iso.datetime().nullable().default(null),learnedAt:z.iso.datetime().nullable().default(null),validFrom:z.iso.datetime().nullable().default(null),validUntil:z.iso.datetime().nullable().default(null),eventId:id,eventIds:z.array(id).max(100).default([]),evidenceIds:z.array(id).max(100).default([]),tags,at:z.iso.datetime(),retiredAt:z.iso.datetime().nullable()});
export const knowledgeSchema=z.strictObject({observerId:id,factId:id,source:z.string().max(1000),at:z.iso.datetime(),confidence:z.number().min(0).max(1).default(1),observedAt:z.iso.datetime().nullable().default(null),expiresAt:z.iso.datetime().nullable().default(null),evidenceIds:z.array(id).max(100).default([])});
export const beliefSchema=z.strictObject({id,observerId:id,proposition:z.string().max(16000),subjectId:id.nullable().default(null),predicate:z.string().max(160).default('believes'),objectId:id.nullable().default(null),value:z.json().default(null),qualifiers:z.record(z.string(),z.json()).default({}),confidence:z.number().min(0).max(1),source:z.string().max(1000),truthStatus:z.enum(['believed','doubted','disproven','confirmed']).default('believed'),audience:z.array(z.string().max(160)).max(100).default([]),observedAt:z.iso.datetime().nullable().default(null),validFrom:z.iso.datetime().nullable().default(null),validUntil:z.iso.datetime().nullable().default(null),eventIds:z.array(id).max(100).default([]),evidenceIds:z.array(id).max(100).default([]),tags,at:z.iso.datetime(),correctedBy:id.nullable()});
export const memorySchema=z.strictObject({id,observerId:id,text:z.string().max(16000),interpretation:z.string().max(16000).default(''),salience:z.number().min(0).max(1),decayPerDay:z.number().min(0).max(1),eventId:id,eventRefs:z.array(id).max(100).default([]),at:z.iso.datetime(),private:z.boolean(),privacy:z.enum(['private','shared']).default('private'),recallConditions:recallConditionsSchema.default({entityIds:[],tags:[],locationId:null,from:null,until:null}),lastRefreshedAt:z.iso.datetime().nullable().default(null),refreshCount:z.number().int().min(0).default(0),expiresAt:z.iso.datetime().nullable().default(null),tags});
export type Fact={id:string;subjectId:string;predicate:string;objectId?:string|null;value:unknown;qualifiers?:Record<string,unknown>;source?:string;truthStatus?:'verified'|'asserted'|'disputed'|'false'|'superseded';audience?:string[];confidence?:number;observedAt?:string|null;learnedAt?:string|null;validFrom?:string|null;validUntil?:string|null;eventId:string;eventIds?:string[];evidenceIds?:string[];tags?:string[];at:string;retiredAt:string|null};
export type Knowledge={observerId:string;factId:string;source:string;at:string;confidence?:number;observedAt?:string|null;expiresAt?:string|null;evidenceIds?:string[]};
export type Belief={id:string;observerId:string;proposition:string;subjectId?:string|null;predicate?:string;objectId?:string|null;value?:unknown;qualifiers?:Record<string,unknown>;confidence:number;source:string;truthStatus?:'believed'|'doubted'|'disproven'|'confirmed';audience?:string[];observedAt?:string|null;validFrom?:string|null;validUntil?:string|null;eventIds?:string[];evidenceIds?:string[];tags?:string[];at:string;correctedBy:string|null};
export type RecallConditions={entityIds:string[];tags:string[];locationId:string|null;from:string|null;until:string|null};
export type Memory={id:string;observerId:string;text:string;interpretation?:string;salience:number;decayPerDay:number;eventId:string;eventRefs?:string[];at:string;private:boolean;privacy?:'private'|'shared';recallConditions?:RecallConditions;lastRefreshedAt?:string|null;refreshCount?:number;expiresAt?:string|null;tags?:string[]};
export type State={canon?:CanonSource|null;clock:string;settings:Settings;entities:Entity[];facts:Fact[];knowledge:Knowledge[];beliefs:Belief[];memories:Memory[];eventIds?:string[]};
export const getEntity=(s:State,id:string,kind?:Kind)=>{const e=s.entities.find(e=>e.id===id&&!e.archived);if(!e||kind&&e.kind!==kind)throw new Error('entity_unavailable');return e;};
export function refs(e:Entity):string[]{
 const result:string[]=[];const walk=(v:unknown,key='')=>{if(!v)return;if(typeof v==='string'&&((key.endsWith('Id')&&!['controllerUserId','sourceEventId','responseEventId','eventId','effectId','parentId','mergeRecordId','threadId'].includes(key))||['parentId','to'].includes(key)&&e.kind==='location'))result.push(v);
 else if(Array.isArray(v)){if(['traits','traitIds','skillIds','requiredTraitIds','excludedTraitIds','factionIds','peopleIds','placeIds','relationshipIds','occupants','links','prerequisites','opposes','jurisdictionIds','memberIds','stock','suspectIds','evidenceIds','warrantLocationIds','lawIds','participants','mediaIds','knownByIds','contextEntityIds','relatedEntityIds'].includes(key))result.push(...v as string[]);else v.forEach(x=>walk(x,key));}
 else if(typeof v==='object')for(const[k,x]of Object.entries(v))if(!['sections','history','custody'].includes(k))walk(x,k);};walk(e.data);
 if(e.kind==='character'){const c=data(e,'character');result.push(...Object.keys(c.skills),...c.compatibility.requiredTraits,...Object.keys(c.compatibility.traitWeights));}
 return [...new Set(result)].filter(x=>x!==e.id);
}
export function remapEntityReference(e:Entity,sourceId:string,targetId:string):Entity{
 const copy=structuredClone(e);
 const walk=(value:unknown):unknown=>{
  if(value===sourceId)return targetId;
  if(Array.isArray(value))return value.map(walk);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,walk(item)]));
  return value;
 };
 copy.data=walk(copy.data) as Entity['data'];
 return copy;
}
export function validateState(s:State){
 const ids=new Set(s.entities.map(e=>e.id));if(ids.size!==s.entities.length)throw new Error('duplicate_entity_id');
 for(const e of s.entities){validateEntity(e);for(const r of refs(e))if(!ids.has(r))throw new Error('broken_reference');}
 for(const e of s.entities.filter(e=>!e.archived&&['location','item'].includes(e.kind))){const seen=new Set([e.id]);let p=(e.data.parentId??e.data.containerId) as string|null;while(p){if(seen.has(p))throw new Error('containment_cycle');seen.add(p);const parent=getEntity(s,p);p=(parent.data.parentId??parent.data.containerId) as string|null;}}
 for(const k of s.knowledge)if(!s.facts.some(f=>f.id===k.factId)||!ids.has(k.observerId))throw new Error('invalid_knowledge_reference');
 const byId=new Map(s.entities.map(e=>[e.id,e]));
 const target=(value:unknown,kinds:Kind[])=>{if(value!==null&&value!==undefined){const e=byId.get(String(value));if(!e||!kinds.includes(e.kind))throw new Error('reference_kind_mismatch');}};
 const common:Record<string,Kind[]>={locationId:['location'],homeId:['location'],originLocationId:['location'],skillId:['skill'],trainerId:['character'],characterId:['character'],possessorId:['character'],investigatorId:['character'],employeeId:['character'],tenantId:['character'],leaderId:['character'],employerId:['business'],businessId:['business'],medicineId:['item'],typeId:['itemType'],agencyId:['faction'],caseId:['case'],phoneId:['item'],recipientPhoneId:['item'],keyId:['item'],containerId:['item','vehicle'],questId:['quest'],outputId:['item'],responderId:['character'],requesterId:['character'],patientId:['character'],executorId:['character'],beneficiaryId:['character'],relationshipId:['relationship'],destinationId:['location'],portraitMediaId:['media'],mergedIntoId:['character'],authorId:['character'],replyToId:['message'],installedMagazineId:['item'],concealmentContextId:['item','character']};
 const arrays:Record<string,Kind[]>={traits:['trait'],requiredTraits:['trait'],requiredTraitIds:['trait'],excludedTraitIds:['trait'],factionIds:['faction'],occupants:['character'],jurisdictionIds:['location'],memberIds:['character'],stock:['item'],suspectIds:['character'],evidenceIds:['evidence'],warrantLocationIds:['location'],lawIds:['law'],participants:['character'],participantIds:['character'],authorizedUserIds:['character'],discoveredByIds:['character'],friendIds:['character'],followingIds:['character'],followerIds:['character'],allowedViewerIds:['character'],mediaIds:['media'],attachments:['media'],attachmentIds:['item']};
 for(const e of s.entities){
  for(const [key,kinds]of Object.entries(common))target(e.data[key],kinds);
  for(const [key,kinds]of Object.entries(arrays))for(const value of (e.data[key]??[]) as unknown[])target(value,kinds);
  if(['relationship','message'].includes(e.kind)){target(e.data.fromId,['character']);target(e.data.toId,['character']);}
  if(e.kind==='item'&&e.data.category==='phone')for(const contact of data(e,'item').contacts){target(contact.characterId,['character']);target(contact.relationshipId,['relationship']);}
  if(e.kind==='item'){
   const item=data(e,'item');
   if(item.installedMagazineId){const magazine=data(getEntity(s,item.installedMagazineId,'item'),'item');if(item.category!=='firearm'||magazine.category!=='magazine')throw new Error('magazine_install_target');if(!item.caliber||!magazine.caliber||item.caliber!==magazine.caliber)throw new Error('incompatible_magazine');if(item.compatibleMagazineFamilies.length&&(!magazine.magazineFamily||!item.compatibleMagazineFamilies.includes(magazine.magazineFamily)))throw new Error('incompatible_magazine');}
   if(item.concealmentContextId){const context=getEntity(s,item.concealmentContextId);if(context.kind==='item'&&!['clothing','container','armor'].includes(data(context,'item').category))throw new Error('invalid_concealment_context');}
   if(item.typeId){const definition=data(getEntity(s,item.typeId,'itemType'),'itemType');if(item.category!==definition.category)throw new Error('item_type_category_mismatch');if(definition.stackability.mode==='unique'&&item.quantity!==1||item.quantity>definition.stackability.maxStack)throw new Error('item_stackability');
    for(const [field,kind] of Object.entries(definition.instanceSchema)){if(!(field in item.instanceData))throw new Error('item_instance_schema');const value=item.instanceData[field],valid=kind==='string'?typeof value==='string':kind==='number'?typeof value==='number'&&Number.isFinite(value):kind==='boolean'?typeof value==='boolean':kind==='entity-id'?typeof value==='string'&&ids.has(value):kind==='date'?typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value):typeof value==='string'&&!Number.isNaN(Date.parse(value));if(!valid)throw new Error('item_instance_schema');}
   }
  }
  if(e.kind==='relationship'){
   const relationship=data(e,'relationship');for(const observerId of relationship.knownByIds)target(observerId,['character']);for(const label of relationship.labelRecords)for(const observerId of label.knownByIds)target(observerId,['character']);for(const entry of relationship.history)for(const observerId of entry.knownByIds??[])target(observerId,['character']);for(const request of relationship.consentRequests){target(request.initiatorId,['character']);target(request.recipientId,['character']);target(request.locationId,['location']);if(![relationship.fromId,relationship.toId].includes(request.initiatorId)||![relationship.fromId,relationship.toId].includes(request.recipientId))throw new Error('consent_participant_mismatch');}
  }
  if(e.kind==='reputation'){
   const reputation=data(e,'reputation');target(reputation.subjectId,['character']);const allowed:Record<typeof reputation.audience.type,Kind[]>={neighborhood:['location'],gang:['faction'],employer:['business'],police:['faction'],family:['faction'],public:[],custom:['location','faction','business','character']};if(reputation.audience.type==='public'){if(reputation.audience.entityId)throw new Error('public_reputation_has_audience_entity');}else target(reputation.audience.entityId,allowed[reputation.audience.type]);for(const source of reputation.sourceEvents)for(const observerId of source.knownByIds)target(observerId,['character']);
  }
  if(e.kind==='obligation'){
   const obligation=data(e,'obligation');target(obligation.creditorId,['character']);target(obligation.debtorId,['character']);for(const observerId of obligation.knownByIds)target(observerId,['character']);for(const entry of obligation.history)for(const observerId of entry.knownByIds)target(observerId,['character']);
  }
  if(e.kind==='location'){target(e.data.parentId,['location']);for(const exit of data(e,'location').exits){target(exit.to,['location']);target(exit.keyId,['item']);if(exit.interruption){target(exit.interruption.locationId,['location']);target(exit.interruption.questId,['quest']);if(exit.interruption.afterMinutes>exit.minutes)throw new Error('interruption_after_arrival');}}}
  if(e.kind==='character'){
   const character=data(e,'character'),aligned=(value:number,min:number,step:number)=>Math.abs((value-min)/step-Math.round((value-min)/step))<1e-9;
   for(const value of Object.values(character.attributes)){if(value<s.settings.attributeScale.min||value>s.settings.attributeScale.max)throw new Error('attribute_out_of_scale');if(!aligned(value,s.settings.attributeScale.min,s.settings.attributeScale.step))throw new Error('attribute_step_mismatch');}
   for(const [skillId,value] of Object.entries(character.skills)){target(skillId,['skill']);const skill=data(getEntity(s,skillId,'skill'),'skill');if(value<skill.scale.min||value>skill.scale.max)throw new Error('skill_out_of_scale');if(!aligned(value,skill.scale.min,skill.scale.step))throw new Error('skill_step_mismatch');}
   for(const entry of character.schedule)target(entry.locationId,['location']);for(const training of character.training){target(training.skillId,['skill']);target(training.trainerId,['character']);if(training.attribute&&training.skillId)throw new Error('training_target_required');}
   for(const trace of character.traitEffectTrace)target(trace.traitId,['trait']);
   const selected=new Set(character.traits);if(selected.size!==character.traits.length)throw new Error('duplicate_traits');
   let advantageCost=0,disadvantageCredit=0,advantages=0,disadvantages=0;
   const activeEffects:Array<Data<'trait'>['effects'][number]>=[];
   for(const traitId of selected){const trait=data(getEntity(s,traitId,'trait'),'trait');for(const prerequisite of trait.prerequisites)target(prerequisite,['trait']);for(const opposition of trait.opposes)target(opposition,['trait']);if(!trait.prerequisites.every(id=>selected.has(id))||trait.opposes.some(id=>selected.has(id)))throw new Error('trait_prerequisite_or_opposition');
    if(trait.mode==='costed'){const balance=trait.balance==='neutral'?(trait.cost>0?'advantage':trait.cost<0?'disadvantage':'neutral'):trait.balance;if(balance==='advantage'){advantageCost+=trait.cost;advantages++;}if(balance==='disadvantage'){disadvantageCredit+=Math.abs(trait.cost);disadvantages++;}}
    activeEffects.push(...trait.effects,...trait.combinations.filter(combination=>combination.traitIds.every(id=>selected.has(id))).flatMap(combination=>combination.effects));
   }
   const policy=s.settings.traitBalance,credit=policy.refundPolicy==='capped-current'?Math.min(disadvantageCredit,policy.disadvantageCreditCap):0;
   if(character.playable){if(selected.size>policy.maxTraits)throw new Error('trait_count_cap');if(advantages>policy.maxAdvantages)throw new Error('trait_advantage_cap');if(disadvantages>policy.maxDisadvantages)throw new Error('trait_disadvantage_cap');if(Math.max(0,advantageCost-credit)>s.settings.traitBudget)throw new Error('trait_budget_exceeded');}
   const overlaps=(left:string[],right:string[])=>!left.length||!right.length||left.some(value=>right.includes(value));
   for(let index=0;index<activeEffects.length;index++)for(let other=index+1;other<activeEffects.length;other++){const left=activeEffects[index]!,right=activeEffects[other]!,a=left.scope,b=right.scope;if(left.type===right.type&&left.key===right.key&&(left.conflictBehavior==='reject'||right.conflictBehavior==='reject')&&overlaps(a.attributes,b.attributes)&&overlaps(a.skillIds,b.skillIds)&&overlaps(a.contexts,b.contexts)&&overlaps(a.planTypes,b.planTypes)&&overlaps(a.needs,b.needs)&&overlaps(a.choiceIds,b.choiceIds)&&overlaps(a.observerContexts,b.observerContexts))throw new Error('trait_effect_conflict');}
  }
  if(e.kind==='traitTemplate'){const template=data(e,'traitTemplate');if(template.requiredTraitIds.some(id=>template.excludedTraitIds.includes(id)))throw new Error('trait_template_required_excluded');}
  if(e.kind==='trait'){const trait=data(e,'trait');for(const grant of trait.skillGrants)target(grant.skillId,['skill']);for(const effect of [...trait.effects,...trait.combinations.flatMap(combination=>combination.effects)])for(const skillId of effect.scope.skillIds)target(skillId,['skill']);for(const combination of trait.combinations)for(const traitId of combination.traitIds)target(traitId,['trait']);}
  if(e.kind==='character'){const c=data(e,'character');if(c.journey){target(c.journey.originId,['location']);target(c.journey.destinationId,['location']);}if(c.reproductive&&c.reproductive.bleedingDays>c.reproductive.cycleDays)throw new Error('invalid_cycle');}
  if(e.kind==='faction')target(data(e,'faction').dispatchPolicy?.hospitalId,['location']);
  if(e.kind==='production'){const p=data(e,'production');if(new Set(p.inputs.map(i=>i.itemId)).size!==p.inputs.length||p.inputs.some(i=>i.itemId===p.outputId))throw new Error('invalid_production_inputs');for(const i of p.inputs)target(i.itemId,['item']);}
  if(e.kind==='transition'||e.kind==='socialRule')for(const o of data(e,e.kind).outcomes){if(o.type==='quest')target(o.questId,['quest']);if(o.type==='housing')target(o.housingId,['housing']);if(o.type==='relationship')target(o.relationshipId,['relationship']);if(o.type==='reputation')target(o.factionId,['faction']);if(o.type==='obligation')target(o.obligationId,['obligation']);if('characterId'in o)target(o.characterId,['character']);}
  if(e.kind==='recipe'){const recipe=data(e,'recipe');if(new Set(recipe.inputs.map(i=>i.itemId)).size!==recipe.inputs.length)throw new Error('duplicate_recipe_input');for(const input of recipe.inputs)target(input.itemId,['item']);}
  if(e.kind==='combat'){const c=data(e,'combat');for(const key of Object.keys(c.positions))if(!c.participants.includes(key))throw new Error('position_not_participant');for(const line of c.blockedLines)if(!c.participants.includes(line.fromId)||!c.participants.includes(line.toId))throw new Error('line_not_participant');}
 }
 for(const [rows,label]of [[s.facts,'fact'],[s.beliefs,'belief'],[s.memories,'memory']] as const){if(new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error('duplicate_'+label+'_id');}
 for(const f of s.facts){if(!ids.has(f.subjectId))throw new Error('invalid_fact_reference');if(f.objectId&&!ids.has(f.objectId))throw new Error('invalid_fact_object');for(const evidenceId of f.evidenceIds??[])target(evidenceId,['evidence']);}
 for(const k of s.knowledge){target(k.observerId,['character']);for(const evidenceId of k.evidenceIds??[])target(evidenceId,['evidence']);}
 for(const b of s.beliefs){target(b.observerId,['character']);if(b.subjectId&&!ids.has(b.subjectId))throw new Error('invalid_belief_subject');if(b.objectId&&!ids.has(b.objectId))throw new Error('invalid_belief_object');for(const evidenceId of b.evidenceIds??[])target(evidenceId,['evidence']);if(b.correctedBy&&!s.facts.some(f=>f.id===b.correctedBy))throw new Error('invalid_correction_reference');}
 for(const m of s.memories){target(m.observerId,['character']);for(const entityId of m.recallConditions?.entityIds??[])if(!ids.has(entityId))throw new Error('invalid_memory_recall_reference');}
}
