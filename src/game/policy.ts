import type {Action,State} from './model.ts';
// These are generic mechanics, never named setting records or identity-derived rules.
export const actionSystems:Record<string,string>={
 travel:'travel',chase:'travel','chase-action':'travel','vehicle-access':'travel','vehicle-custody':'travel','vehicle-service':'travel','recover-vehicle':'travel',combat:'combat',attack:'combat',defend:'combat',grapple:'combat',restrain:'combat','escape-restraint':'combat',disarm:'combat',shove:'combat','environmental-action':'combat','ready-weapon':'combat',flee:'combat',reload:'combat','load-magazine':'combat','clear-malfunction':'combat','maintain-weapon':'combat','attach-weapon':'combat',cover:'combat','tactical-move':'combat',
 message:'communications','add-contact':'communications','share-number':'communications','contact-control':'communications','delete-message':'communications','leave-voicemail':'communications','phone-call':'communications','read-message':'communications','call-response':'communications','call-speak':'communications',conversation:'communications',
 crime:'law',report:'law','report-belief':'law','report-vehicle-theft':'law',collect:'law',custody:'law',case:'law','pay-bail':'law',
 buy:'economy',sell:'economy',bank:'economy',work:'economy','pay-rent':'economy',train:'training',check:'checks',treat:'health','assess-health':'health','clinical-care':'health','forensic-test':'health','identify-remains':'health','notify-death':'health',social:'relationships',cook:'needs',hygiene:'needs','request-assistance':'dispatch','dispatch-response':'dispatch','settle-estate':'estates'
};
export const enabled=(s:State,system:string)=>s.settings.campaign?.enabledSystems[system]!==false;
export const technology=(s:State,feature:string)=>s.settings.campaign?.technology.features[feature]!==false;
export const needsRate=(s:State)=>({off:0,light:0.5,grounded:1,intense:2}[s.settings.campaign?.needsIntensity??'grounded']);
export const injuryRate=(s:State)=>({restrained:0.5,grounded:1,intense:1.5}[s.settings.campaign?.injuryIntensity??'grounded']);
export function enforceActionPolicy(s:State,action:Action){
 const p=s.settings.campaign;if(!p)return;
 const system=actionSystems[action.type];if(!enabled(s,action.type)||system&&!enabled(s,system))throw new Error('system_disabled');
 if('phoneId'in action&&!technology(s,'phone'))throw new Error('phone_disabled');
 if(action.type==='message'&&!technology(s,action.medium))throw new Error('technology_disabled');
 if(['phone-call','call-response','call-speak','leave-voicemail'].includes(action.type)&&!technology(s,'calls'))throw new Error('technology_disabled');
 if(action.type==='travel'&&!technology(s,action.mode))throw new Error('technology_disabled');
 if(action.type==='social'&&action.intent==='intimacy'&&(p.contentRating==='general'||p.matureContent==='off'))throw new Error('mature_content_disabled');
}
export function lawResponseMinutes(s:State,agencyId:string,minutes:number){
 const law=s.settings.campaign?.lawEnforcement;if(!law||law.profileId&&law.profileId!==agencyId)return minutes;
 const authored=law.variance.responseMultiplier;
 const factor=typeof authored==='number'&&authored>0?authored:({authored:1,lax:2,balanced:1,strict:0.5}[law.posture]);
 return Math.max(1,Math.ceil(minutes*factor));
}
