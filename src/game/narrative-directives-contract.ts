import {z} from 'zod';
import {narrativePatchSchema} from './narrative-profile.ts';
export {narrativePatchSchema};
export const narrativeDirectiveSchema=z.strictObject({
 scope:z.enum(['one-response','scene','character','campaign','user']).default('one-response'),
 patch:narrativePatchSchema.default({}),
 focusId:z.uuid().optional(),
 interior:z.string().trim().min(1).max(1000).optional(),
});
export type NarrativeDirective=z.infer<typeof narrativeDirectiveSchema>;
