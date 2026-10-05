import {actionSchema} from './model.ts';
import type {State,Action,Kind} from './model.ts';
import {observerView} from './epistemics.ts';
export type IntentProposal={action:Action|null;requiresConfirmation:true;originalText:string;classification:'proposal'|'clarification';alternatives?:Action[];clarification?:string};
export function proposeIntent(s:State,characterId:string,text:string):IntentProposal{
 const input=text.trim(),view=observerView(s,characterId);
 const propose=(action:unknown):IntentProposal=>({action:actionSchema.parse(action),requiresConfirmation:true,originalText:text,classification:'proposal'});
 const unclear=(message='Choose an explicit action and target. No action has been taken.',alternatives?:Action[]):IntentProposal=>({action:null,requiresConfirmation:true,originalText:text,classification:'clarification',...(alternatives?.length?{alternatives}:{}),clarification:message});
 const spoken=/^say\s+([\s\S]+)$/i.exec(input);if(spoken)return propose({type:'say',text:spoken[1]});
 const pieces=input.split(/\s*(?:;|\bthen\b|\band\b)\s*/i).filter(Boolean);
 if(pieces.length>1){
  const candidates=pieces.map(piece=>proposeIntent(s,characterId,piece)).filter(candidate=>candidate.action!==null).map(candidate=>candidate.action!);
  if(candidates.length>1)return unclear('This could mean several incompatible actions. Choose one action to take first; nothing has happened.',candidates);
 }
 if(/^(look|search|surrender)$/i.test(input))return propose({type:input.toLowerCase()});
 const inspect=/^inspect\s+(.+)$/i.exec(input);
 if(inspect){const query=inspect[1]!.toLowerCase(),matches=view.entities.filter(entity=>entity.id!==characterId&&entity.name.toLowerCase()===query);return matches.length===1?propose({type:'inspect',targetId:matches[0]!.id}):unclear(matches.length?'Several known records share that name. Choose the exact target using the action panel.':'No uniquely known target matches that name.');}
 const say=/^say\s+([\s\S]+)$/i.exec(input);if(say)return propose({type:'say',text:say[1]});
 const wait=/^(wait|sleep|fast[- ]forward)\s+(\d+)(?:\s+minutes?)?$/i.exec(input);if(wait)return propose({type:wait[1]!.toLowerCase().replace(' ','-'),minutes:Number(wait[2])});
 const named=/^(go to|go|travel to|travel|take|equip|unequip|consume|cook)\s+(.+)$/i.exec(input);
 if(!named)return unclear();
 const verb=named[1]!.toLowerCase(),name=named[2]!.toLowerCase();
 const kind:Kind=verb==='cook'?'recipe':['go to','go','travel to','travel'].includes(verb)?'location':'item';
 const matches=view.entities.filter(e=>e.kind===kind&&e.name.toLowerCase()===name);
 if(matches.length!==1)return unclear(matches.length?'Several known records share that name. Choose the exact target using the action panel.':'No uniquely known target matches that name.');
 const target=matches[0]!;
 if(kind==='location')return propose({type:'travel',destinationId:target.id,mode:'walk',vehicleId:null});
 if(kind==='recipe')return propose({type:'cook',recipeId:target.id});
 if(verb==='equip'||verb==='unequip')return propose({type:'equip',itemId:target.id,equipped:verb==='equip'});
 return propose({type:verb,itemId:target.id});
}
