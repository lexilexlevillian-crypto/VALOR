import {z} from 'zod';
const phrase=z.string().trim().min(1).max(500),phrases=z.array(phrase).max(40).default([]);
export const narrativeFields={
 perspective:z.enum(['first','second','third']).default('third'),tense:z.enum(['past','present']).default('past'),
 narrativeDistance:z.enum(['external','balanced','close','intimate']).default('close'),descriptionDensity:z.enum(['sparse','balanced','rich']).default('balanced'),
 literaryIntensity:z.enum(['straightforward','grounded-literary','highly-literary']).default('grounded-literary'),dialogueDensity:z.enum(['low','balanced','high']).default('balanced'),
 responseLength:z.enum(['short','medium','long','very-long']).default('medium'),pacing:z.enum(['fast','balanced','slow']).default('balanced'),
 sensoryDensity:z.enum(['low','moderate','high']).default('moderate'),metaphorDensity:z.enum(['minimal','selective','frequent']).default('selective'),
 humorLevel:z.enum(['low','natural','high']).default('natural'),violenceDetail:z.enum(['minimal','moderate','graphic-where-allowed']).default('moderate'),
 emotionalDetail:z.enum(['restrained','balanced','high']).default('balanced'),expositionDensity:z.enum(['minimal','balanced','expanded']).default('balanced'),
 mechanicalFeedbackStyle:z.enum(['narrative-only','light','standard','detailed']).default('light'),signedDialogueStyle:z.enum(['italics','quotes']).default('italics'),
 discouragedPatterns:phrases,forbiddenPatterns:phrases,approvedStyleExamples:phrases,negativeStyleExamples:phrases,
 phraseCooldowns:z.array(z.strictObject({phrase,turns:z.number().int().min(1).max(50)})).max(40).default([]),
 motifs:z.array(z.strictObject({phrase,cooldownTurns:z.number().int().min(1).max(50).default(4)})).max(20).default([]),
 toneBounds:phrases
};
export const narrativeProfileSchema=z.strictObject({id:z.string().max(100).default('standard-valor'),name:z.string().max(100).default('Standard Valor'),version:z.number().int().positive().default(1),...narrativeFields});
// Defaults belong to resolved profiles; an omitted override must inherit.
const patchFields=Object.fromEntries(Object.entries(narrativeFields).map(([key,schema])=>[key,schema.unwrap().optional()])) as {[K in keyof typeof narrativeFields]:z.ZodOptional<ReturnType<(typeof narrativeFields)[K]['unwrap']>>};
export const narrativePatchSchema=z.strictObject(patchFields);
export type NarrativeProfile=z.infer<typeof narrativeProfileSchema>;
export type NarrativePatch=z.infer<typeof narrativePatchSchema>;
export const narrativePresets={
 'standard-valor':narrativeProfileSchema.parse({}),
 straightforward:narrativeProfileSchema.parse({id:'straightforward',name:'Straightforward',descriptionDensity:'sparse',literaryIntensity:'straightforward',metaphorDensity:'minimal',pacing:'fast'}),
 literary:narrativeProfileSchema.parse({id:'literary',name:'Literary',descriptionDensity:'rich',literaryIntensity:'highly-literary',responseLength:'long',sensoryDensity:'high'}),
 'dialogue-heavy':narrativeProfileSchema.parse({id:'dialogue-heavy',name:'Dialogue Heavy',dialogueDensity:'high'}),
 minimal:narrativeProfileSchema.parse({id:'minimal',name:'Minimal',descriptionDensity:'sparse',literaryIntensity:'straightforward',responseLength:'short',pacing:'fast',metaphorDensity:'minimal',expositionDensity:'minimal'})
} as const;
export const voiceProfileSchema=z.strictObject({
 vocabulary:phrases,sentenceLength:z.enum(['terse','varied','long']).default('varied'),formality:z.enum(['casual','neutral','formal']).default('neutral'),
 profanity:phrase.default('authored only'),slang:phrases,dialect:phrase.default('readable'),codeSwitching:phrases,fillerWords:phrases,habitualPhrases:phrases,
 interruptionTendency:z.enum(['low','normal','high']).default('normal'),rambling:z.enum(['low','normal','high']).default('low'),directness:phrase.default('neutral'),evasiveness:phrase.default('only when motivated'),lyingStyle:phrase.default('no automatic tells'),humor:z.enum(['none','dry','warm','playful']).default('none'),emotionalExpressiveness:phrase.default('reserved'),politeness:phrase.default('neutral'),occupationalJargon:phrases,endearments:phrases,insults:phrases,nameUse:phrase.default('ordinary'),fragmentUse:z.enum(['low','selective','frequent']).default('selective'),
 registers:z.strictObject({professional:phrases,intimate:phrases,family:phrases,stranger:phrases,enemy:phrases}).default({professional:[],intimate:[],family:[],stranger:[],enemy:[]}),forbiddenTendencies:phrases,sampleLines:phrases,
 // Authored equivalent realizations are never additional decisions or facts.
 equivalents:z.array(z.strictObject({canonical:phrase,alternatives:phrases,register:z.enum(['any','professional','intimate','family','stranger','enemy']).default('any'),exact:z.boolean().default(false)})).max(40).default([])
});
export const communicationProfileSchema=z.strictObject({normalMethod:z.enum(['say','sign','write']).default('say'),language:z.string().max(40).default('en'),canSpeak:z.boolean().default(true),languages:z.record(z.string().max(40),z.strictObject({spoken:z.number().min(0).max(100).default(0),written:z.number().min(0).max(100).default(0),signed:z.number().min(0).max(100).default(0)})).default({en:{spoken:100,written:100,signed:0}})});
export const locationNarrativeSchema=z.strictObject({interiorPolicy:z.enum(['strict','flexible']).default('strict'),details:z.array(z.strictObject({id:z.string().max(100),text:phrase,sense:z.enum(['visual','sound','temperature','smell','touch']).default('visual'),layer:z.enum(['immediate','current','structural']).default('structural'),visibility:z.enum(['public','creator']).default('public')})).max(40).default([])});
export const paragraphTargets={short:[1,2],medium:[2,4],long:[4,7],'very-long':[6,12]} as const;
