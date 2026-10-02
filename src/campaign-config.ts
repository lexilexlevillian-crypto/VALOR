import {z} from 'zod';
import {id} from './contracts.ts';

const slug=z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/);
const jsonMap=z.record(z.string().max(80),z.json()).default({});
const calendar=z.strictObject({
 id:slug,
 daysPerWeek:z.number().int().min(1).max(14),
 firstDayOfWeek:z.number().int().min(0).max(13),
 months:z.array(z.strictObject({id:slug,label:z.string().trim().min(1).max(80),days:z.number().int().min(1).max(100)})).max(64)
});
const lawDelay=z.strictObject({min:z.number().int().min(1).max(10080),max:z.number().int().min(1).max(10080)}).refine(value=>value.min<=value.max,'invalid_law_delay');
const lawEnforcement=z.strictObject({
 profileId:id.nullable(),posture:z.enum(['authored','lax','balanced','strict']),variance:jsonMap,
 reportProbability:z.number().min(0).max(100).default(35),dispatchDelay:lawDelay.default({min:20,max:60}),officerAvailability:z.number().min(0).max(100).default(45),solveRate:z.number().min(0).max(100).default(25),
 evidenceThreshold:z.number().min(0).max(100).default(55),stopThreshold:z.number().min(0).max(100).default(35),searchThreshold:z.number().min(0).max(100).default(60),casePriority:z.number().min(-100).max(100).default(0),
 bookingMinutes:z.number().int().min(1).max(10080).default(240),detentionMinutes:z.number().int().min(1).max(525600).default(1440),bailLikelihood:z.number().min(0).max(100).default(70),releaseLikelihood:z.number().min(0).max(100).default(60),courtDelayDays:lawDelay.default({min:30,max:180}),
 informalResolution:z.number().min(0).max(100).default(20),corruptionTolerance:z.number().min(0).max(100).default(0),corruptionAuthored:z.boolean().default(false),seriousCrimeThreshold:z.number().min(0).max(100).default(75),
 directWitnessWeight:z.number().min(0).max(100).default(25),highProfileWeight:z.number().min(0).max(100).default(25),rivalPressureWeight:z.number().min(0).max(100).default(15),accumulatedEvidenceWeight:z.number().min(0).max(100).default(30)
});
const technology=z.strictObject({era:z.string().trim().min(1).max(80),features:z.record(z.string().max(80),z.boolean()),serviceVariability:z.enum(['fixed','authored','variable'])});
const saveBehavior=z.strictObject({autosave:z.enum(['safe-commit','manual-only','off']),branchOnDeath:z.boolean(),postDeath:z.enum(['load-or-branch','roster','observer']).default('load-or-branch'),maxManualSaves:z.number().int().min(1).max(10000)});
const uiDefaults=z.strictObject({density:z.enum(['compact','comfortable','spacious']),startView:z.string().trim().min(1).max(80),mapMode:z.enum(['list','graphical','hybrid'])});
const needsPolicy=z.strictObject({ui:z.enum(['hidden','summary','meters']),costs:z.enum(['none','authored']),penalties:z.enum(['none','authored'])}).default({ui:'hidden',costs:'none',penalties:'none'});
export const relationshipSafetySchema=z.strictObject({minimumRomanceAge:z.number().int().min(18).max(100),minimumIntimacyAge:z.number().int().min(18).max(100),consentWindowMinutes:z.number().int().min(1).max(1440),intoxicationBlocksConsentAt:z.number().min(1).max(100),allowNpcInitiative:z.boolean()}).default({minimumRomanceAge:18,minimumIntimacyAge:18,consentWindowMinutes:30,intoxicationBlocksConsentAt:50,allowNpcInitiative:true});

export const campaignConfigSchema=z.strictObject({
 startAt:z.iso.datetime(),timezone:z.string().trim().min(1).max(100),calendar,
 enabledSystems:z.record(slug,z.boolean()),difficulty:z.string().trim().min(1).max(80),
 contentRating:z.enum(['general','mature']),matureContent:z.enum(['off','implicit','fade-to-black','allowed-description']),relationshipSafety:relationshipSafetySchema,
 needsIntensity:z.enum(['off','light','grounded','intense']),needsPolicy,injuryIntensity:z.enum(['restrained','grounded','intense']),
 lawEnforcement,technology,travelAbstraction:z.enum(['exact','route','abstract']),saveBehavior,uiDefaults
});
const partialCalendar=calendar.partial();
const partialLaw=lawEnforcement.partial();
const partialTechnology=technology.partial();
const partialSave=saveBehavior.partial();
const partialUi=uiDefaults.partial();
const partialRelationshipSafety=relationshipSafetySchema.removeDefault().partial();
const partialNeedsPolicy=needsPolicy.removeDefault().partial();
export const campaignConfigOverridesSchema=z.strictObject({
 startAt:z.iso.datetime().optional(),timezone:z.string().trim().min(1).max(100).optional(),calendar:partialCalendar.optional(),
 enabledSystems:z.record(slug,z.boolean()).optional(),difficulty:z.string().trim().min(1).max(80).optional(),
 contentRating:z.enum(['general','mature']).optional(),matureContent:z.enum(['off','implicit','fade-to-black','allowed-description']).optional(),relationshipSafety:partialRelationshipSafety.optional(),
 needsIntensity:z.enum(['off','light','grounded','intense']).optional(),needsPolicy:partialNeedsPolicy.optional(),injuryIntensity:z.enum(['restrained','grounded','intense']).optional(),
 lawEnforcement:partialLaw.optional(),technology:partialTechnology.optional(),travelAbstraction:z.enum(['exact','route','abstract']).optional(),
 saveBehavior:partialSave.optional(),uiDefaults:partialUi.optional()
});
export type CampaignConfig=z.infer<typeof campaignConfigSchema>;
export type CampaignConfigOverrides=z.infer<typeof campaignConfigOverridesSchema>;
export type StoredCampaignConfig={defaults:CampaignConfig;overrides:CampaignConfigOverrides;revision:number;schemaVersion:number};

function merge(base:Record<string,unknown>,patch:Record<string,unknown>):Record<string,unknown>{
 const result={...base};
 for(const [key,value] of Object.entries(patch)){
  if(value&&typeof value==='object'&&!Array.isArray(value)&&result[key]&&typeof result[key]==='object'&&!Array.isArray(result[key])) result[key]=merge(result[key] as Record<string,unknown>,value as Record<string,unknown>);
  else result[key]=value;
 }
 return result;
}
export function resolveCampaignConfig(defaults:unknown,overrides:unknown):CampaignConfig{
 const base=campaignConfigSchema.parse(defaults),patch=campaignConfigOverridesSchema.parse(overrides);
 const resolved=campaignConfigSchema.parse(merge(base as unknown as Record<string,unknown>,patch as unknown as Record<string,unknown>));
 if(resolved.calendar.firstDayOfWeek>=resolved.calendar.daysPerWeek)throw new Error('invalid_calendar_week');
 if(resolved.calendar.id!=='gregorian'&&!resolved.calendar.months.length)throw new Error('custom_calendar_months_required');
 if(new Set(resolved.calendar.months.map(m=>m.id)).size!==resolved.calendar.months.length)throw new Error('duplicate_calendar_month');
 if(resolved.contentRating==='general'&&resolved.matureContent!=='off')throw new Error('general_rating_requires_mature_content_off');
 try{new Intl.DateTimeFormat('en-US',{timeZone:resolved.timezone});}catch{throw new Error('invalid_timezone');}
 return resolved;
}
export function parseStoredCampaignConfig(row:{defaults_json:string;overrides_json:string;revision:number;schema_version:number}):StoredCampaignConfig{
 const defaults=campaignConfigSchema.parse(JSON.parse(row.defaults_json));
 const overrides=campaignConfigOverridesSchema.parse(JSON.parse(row.overrides_json));
 resolveCampaignConfig(defaults,overrides);
 return {defaults,overrides,revision:row.revision,schemaVersion:row.schema_version};
}
export function defaultCampaignConfig(startAt:string,timezone:string):CampaignConfig{
 return campaignConfigSchema.parse({
  startAt,timezone,calendar:{id:'gregorian',daysPerWeek:7,firstDayOfWeek:0,months:[]},enabledSystems:{},difficulty:'grounded',
  contentRating:'mature',matureContent:'fade-to-black',relationshipSafety:{minimumRomanceAge:18,minimumIntimacyAge:18,consentWindowMinutes:30,intoxicationBlocksConsentAt:50,allowNpcInitiative:true},needsIntensity:'off',needsPolicy:{ui:'hidden',costs:'none',penalties:'none'},injuryIntensity:'grounded',
  lawEnforcement:{profileId:null,posture:'authored',variance:{},reportProbability:35,dispatchDelay:{min:20,max:60},officerAvailability:45,solveRate:25,evidenceThreshold:55,stopThreshold:35,searchThreshold:60,casePriority:0,bookingMinutes:240,detentionMinutes:1440,bailLikelihood:70,releaseLikelihood:60,courtDelayDays:{min:30,max:180},informalResolution:20,corruptionTolerance:0,corruptionAuthored:false,seriousCrimeThreshold:75,directWitnessWeight:25,highProfileWeight:25,rivalPressureWeight:15,accumulatedEvidenceWeight:30},technology:{era:'authored',features:{},serviceVariability:'authored'},
  travelAbstraction:'route',saveBehavior:{autosave:'safe-commit',branchOnDeath:true,postDeath:'load-or-branch',maxManualSaves:100},
  uiDefaults:{density:'compact',startView:'chronicle',mapMode:'list'}
 });
}
