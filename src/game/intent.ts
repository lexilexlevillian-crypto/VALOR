import {actionSchema} from './model.ts';
import type {State,Action,Kind} from './model.ts';
import {observerView} from './epistemics.ts';
export type IntentProposal={action:Action|null;requiresConfirmation:true;clarification?:string};
export function proposeIntent(s:State,characterId:string,text:string):IntentProposal{
 const input=text.trim(),view=observerView(s,characterId);
 const propose=(action:unknown):IntentProposal=>({action:actionSchema.parse(action),requiresConfirmation:true});
 const unclear=(message='Choose an explicit action and target. No action has been taken.'):IntentProposal=>({action:null,requiresConfirmation:true,clarification:message});
 if(/^(look|search|surrender)$/i.test(input))return propose({type:input.toLowerCase()});
 const say=/^say\s+([\s\S]+)$/i.exec(input);if(say)return propose({type:'say',text:say[1]});
 const wait=/^(wait|sleep)\s+(\d+)(?:\s+minutes?)?$/i.exec(input);if(wait)return propose({type:wait[1]!.toLowerCase(),minutes:Number(wait[2])});
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
