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
const lawEnforcement=z.strictObject({profileId:id.nullable(),posture:z.enum(['authored','lax','balanced','strict']),variance:jsonMap});
const technology=z.strictObject({era:z.string().trim().min(1).max(80),features:z.record(z.string().max(80),z.boolean()),serviceVariability:z.enum(['fixed','authored','variable'])});
const saveBehavior=z.strictObject({autosave:z.enum(['safe-commit','manual-only','off']),branchOnDeath:z.boolean(),maxManualSaves:z.number().int().min(1).max(10000)});
const uiDefaults=z.strictObject({density:z.enum(['compact','comfortable','spacious']),startView:z.string().trim().min(1).max(80),mapMode:z.enum(['list','graphical','hybrid'])});

export const campaignConfigSchema=z.strictObject({
 startAt:z.iso.datetime(),timezone:z.string().trim().min(1).max(100),calendar,
 enabledSystems:z.record(slug,z.boolean()),difficulty:z.string().trim().min(1).max(80),
 contentRating:z.enum(['general','mature']),matureContent:z.enum(['off','implicit','fade-to-black','allowed-description']),
 needsIntensity:z.enum(['off','light','grounded','intense']),injuryIntensity:z.enum(['restrained','grounded','intense']),
 lawEnforcement,technology,travelAbstraction:z.enum(['exact','route','abstract']),saveBehavior,uiDefaults
});
const partialCalendar=calendar.partial();
const partialLaw=lawEnforcement.partial();
const partialTechnology=technology.partial();
const partialSave=saveBehavior.partial();
const partialUi=uiDefaults.partial();
export const campaignConfigOverridesSchema=z.strictObject({
 startAt:z.iso.datetime().optional(),timezone:z.string().trim().min(1).max(100).optional(),calendar:partialCalendar.optional(),
 enabledSystems:z.record(slug,z.boolean()).optional(),difficulty:z.string().trim().min(1).max(80).optional(),
 contentRating:z.enum(['general','mature']).optional(),matureContent:z.enum(['off','implicit','fade-to-black','allowed-description']).optional(),
 needsIntensity:z.enum(['off','light','grounded','intense']).optional(),injuryIntensity:z.enum(['restrained','grounded','intense']).optional(),
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
  contentRating:'mature',matureContent:'fade-to-black',needsIntensity:'off',injuryIntensity:'grounded',
  lawEnforcement:{profileId:null,posture:'authored',variance:{}},technology:{era:'authored',features:{},serviceVariability:'authored'},
  travelAbstraction:'route',saveBehavior:{autosave:'safe-commit',branchOnDeath:true,maxManualSaves:100},
  uiDefaults:{density:'compact',startView:'chronicle',mapMode:'list'}
 });
}
