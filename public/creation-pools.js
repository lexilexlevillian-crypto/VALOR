import {ORIGINS,startingBudget,startingRatingMaximum,effectText,skillGrants,applyStartingGrants,traitSkillGrants,stockTrait,stockSkill,skillStatus,skillPointCost} from './creation-rules.js';
import {APPEARANCE_TRAITS} from './profile-rules.js';
import {ratingControl} from './studio.js';
const el=(tag,text='',cls='')=>{const node=document.createElement(tag);node.textContent=text;if(cls)node.className=cls;return node;};
const button=(text,action)=>{const node=el('button',text);node.type='button';node.addEventListener('click',action);return node;};
const views=new WeakMap();
const register=(character,render)=>{const list=views.get(character)??new Set();list.add(render);views.set(character,list);};
export const refreshCreationControls=character=>{for(const render of views.get(character)??[])render();};
export function changeSelection(character,entities,mutate,onchange){
 const snapshot=structuredClone(character),beforeBudget=startingBudget(character,entities),before=skillGrants(character,entities);mutate();const after=skillGrants(character,entities);character.skills??={};
 for(const id of new Set([...Object.keys(before),...Object.keys(after)])){
  const skill=entities.find(e=>e.id===id),scale=skill?.data.scale??{min:0,max:100,step:1};
  const paid=Math.max(0,(character.skills[id]??scale.min)-(before[id]?.value??scale.min));
  const next=Math.min(scale.max,(after[id]?.value??scale.min)+paid);
  if(!after[id]&&paid===0)delete character.skills[id];else character.skills[id]=Math.round(next*1e8)/1e8;
 }
 const afterBudget=startingBudget(character,entities),worsened=character.playable&&['attributes','skills','traits'].some(key=>afterBudget.remaining[key]<-1e-8&&afterBudget.remaining[key]<beforeBudget.remaining[key]-1e-8);
 if(worsened){for(const key of Object.keys(character))delete character[key];Object.assign(character,snapshot);refreshCreationControls(character);return false;}
 onchange(character);refreshCreationControls(character);return true;
}
function grantLines(grants,entities){
 return grants.map(grant=>{const skill=entities.find(e=>e.id===grant.skillId),scale=skill?.data.scale??{min:0,max:100,step:1};const rating=scale.min+Math.floor((scale.max-scale.min)*grant.fraction/scale.step+1e-8)*scale.step;return (skill?.name??'Unavailable skill')+': starts at '+rating+' ('+Math.round(grant.fraction*100)+'% of its bar), free';});
}
export function backgroundPicker(character,entities,onchange){
 character.background??={};if(!character.background.option1&&character.background.originChoice)character.background.option1=character.background.originChoice;
 delete character.background.originChoice;applyStartingGrants(character,entities);
 const root=el('div','','background-picker oc-background-options'),rows=[];
 root.append(el('p','Choose up to four different parts of your history. All bonuses are free. Repeated skill grants use the highest rating, not added ratings. Empty slots are fine.','sheet-guidance'));
 for(let n=1;n<=4;n++){
  const key='option'+n,label=el('label',n===1?'Primary background':'Background '+n+' (optional)'),select=el('select'),info=el('div','','background-effects');
  select.setAttribute('aria-label',label.textContent);info.setAttribute('aria-live','polite');
  const blank=el('option',n===1?'Choose a background':'None');blank.value='';select.append(blank);
  for(const row of [...ORIGINS].sort((a,b)=>a.name.localeCompare(b.name))){const option=el('option',row.name);option.value=row.id;select.append(option);}
  const legacy=character.background[key];if(legacy&&!ORIGINS.some(row=>row.id===legacy)){const option=el('option',legacy+' (saved history)');option.value=legacy;select.append(option);}
  select.addEventListener('change',()=>changeSelection(character,entities,()=>{character.background[key]=select.value;delete character.background.originChoice;},onchange));
  label.append(select);root.append(label,info);rows.push({key,select,info});
 }
 const render=()=>{for(const {key,select,info}of rows){
  select.value=character.background[key]??'';for(const option of select.options)option.disabled=Boolean(option.value&&option.value!==select.value&&[1,2,3,4].some(n=>character.background['option'+n]===option.value));
  const row=ORIGINS.find(row=>row.id===select.value);info.replaceChildren();
  if(row){info.append(el('p',row.description));
   for(const [name,fraction]of Object.entries(row.skills)){const skill=entities.find(e=>e.kind==='skill'&&e.name===name&&!e.archived);info.append(el('p',skill?grantLines([{skillId:skill.id,fraction}],entities)[0]:name+': training unavailable until this skill is published.'));}
  }else if(select.value)info.append(el('p','Saved written history. Choose a listed background to add automatic skill training.'));
 }};
 register(character,render);render();return root;
}
export function budgetPanel(character,entities,scale){
 applyStartingGrants(character,entities);
 const root=el('section','','starting-budget');root.setAttribute('aria-label','Starting point budgets');
 const refresh=()=>{root.hidden=true;root.replaceChildren();};
 refresh();return {root,refresh};
}
export function selectionPool(kind,character,entities,onchange){
 applyStartingGrants(character,entities);
 const root=el('section','','selection-pool'),points=kind==='traits'?el('small','','pool-points'):null,search=el('input'),grid=el('div','','choice-pool'),detail=el('div','','choice-detail'),selected=el('div','','selected-choices');
 search.type='search';search.placeholder='Find '+kind;search.setAttribute('aria-label','Search '+kind);detail.setAttribute('aria-live','polite');
 const choices=entities.filter(row=>row.kind===(kind==='traits'?'trait':'skill')&&!row.archived&&(kind!=='traits'||!APPEARANCE_TRAITS.includes(row.name))).sort((a,b)=>a.name.localeCompare(b.name));
 const isSelected=row=>kind==='traits'?(character.traits??[]).includes(row.id):Object.hasOwn(character.skills??{},row.id);
 const costLabel=row=>{const cost=row.data.mode==='costed'?Number(row.data.cost)||0:0;return cost>0?'Costs '+cost+' trait points':cost<0?'Refunds '+Math.abs(cost)+' trait points':'No point cost';};
 let focused=null;
 const mutateRow=(target,row)=>{const selected=kind==='traits'?(target.traits??[]).includes(row.id):Object.hasOwn(target.skills??{},row.id);if(kind==='traits'){target.traits??=[];target.traits=selected?target.traits.filter(id=>id!==row.id):[...target.traits,row.id];}else{target.skills??={};if(selected)delete target.skills[row.id];else target.skills[row.id]=row.data.scale?.min??0;}};
 const canToggle=row=>{if(!character.playable||kind!=='traits')return true;const candidate=structuredClone(character);return changeSelection(candidate,entities,()=>mutateRow(candidate,row),()=>{});};
 const toggle=row=>{
  if(kind==='skills'&&skillGrants(character,entities)[row.id])return;
  if(!canToggle(row))return;
  changeSelection(character,entities,()=>mutateRow(character,row),onchange);show(row);
 };
 const show=row=>{
  focused=row;const d=row.data,stock=kind==='skills'?stockSkill(row.name):stockTrait(row.name);
  const legacy=/^(Creator-editable skill descriptor\.|Optional game interpretation:|Training grants \+2 only on checks using )/.test(d.description??'')||(kind==='skills'&&d.description===stock?.legacyDescription);
  detail.replaceChildren(el('h4',row.name),el('p',legacy&&stock?stock.description:d.description||'A creator-authored '+kind.slice(0,-1)+'.'));
  if(kind==='traits'){
   detail.append(el('strong',costLabel(row)),el('p',effectText(d.modifiers)||'No general attribute bonus.'));
   for(const modifier of d.scopedCheckModifiers??[]){const skill=entities.find(e=>e.id===modifier.skillId);detail.append(el('p',(modifier.value>0?'+':'')+modifier.value+' '+(skill?.name||modifier.attribute||'checks')+(modifier.contexts?.length?' · only during '+modifier.contexts.join(', '):'')));}
   for(const effect of d.effects??[])detail.append(el('p',effect.name+': '+(effect.description||effect.type+' · '+effect.operation)+' ('+(effect.value>0?'+':'')+effect.value+'). Scope: '+[...(effect.scope?.attributes??[]),...(effect.scope?.skillIds??[]).map(id=>entities.find(e=>e.id===id)?.name??id),...(effect.scope?.contexts??[]),...(effect.scope?.needs??[])].join(', ')));
   for(const line of grantLines(traitSkillGrants(row,entities),entities))detail.append(el('p',line));
   if(!(d.effects??[]).length)detail.append(el('p','No additional status effect beyond the bonuses or penalties listed above.'));
   for(const [key,label]of [['opposes','Cannot combine with'],['prerequisites','Requires']])if(d[key]?.length)detail.append(el('p',label+': '+d[key].map(id=>entities.find(e=>e.id===id)?.name??'a campaign-defined trait').join(', ')));
   if(d.permanent||d.loss?.mode==='never')detail.append(el('p','Permanent after creation. Review carefully before starting.'));
   detail.append(el('p','Costs and refunds apply only to player creation. Total refunds are capped at 6 points; NPCs have no point budget.'));
  }else{
   const scale=d.scale??{min:0,max:100,step:1},grant=skillGrants(character,entities)[row.id];
   const paid=skillPointCost(row,character.skills?.[row.id]??scale.min,grant?.value);
   detail.append(el('strong','Allocated: '+paid+' skill points'),el('p','Reducing to the free/minimum rating returns '+paid+' skill points during creation. Free training has no refund.'));
   detail.append(el('p','Your rating is added to checks using this skill. A full bar costs 5 starting points; free training is not charged. Range '+scale.min+'–'+scale.max+'.'));
   if(skillStatus(row,scale.max).trained)detail.append(el('p','Status: Trained at '+(scale.min+(scale.max-scale.min)/2)+' or higher. +2 to checks using this skill.'+(row.name==='Athletics'?' Also slows ordinary fatigue buildup by 15%.':'')));
   if(skillStatus(row,scale.max).trained)detail.append(el('p','Trained threshold cost: '+skillPointCost(row,scale.min+(scale.max-scale.min)/2,grant?.value)+' skill points after free training.'));
   if(grant)detail.append(el('p','Free rating '+grant.value+' from '+grant.sources.join(', ')+'. Remove its background or trait to remove this grant.'));
  }
  const granted=kind==='skills'&&skillGrants(character,entities)[row.id];if(!granted){const action=button(isSelected(row)?'Remove '+row.name:'Choose '+row.name,()=>toggle(row));if(!canToggle(row)){action.disabled=true;action.title='This would exceed the player trait-point limit.';}detail.append(action);}
 };
 const draw=()=>{
  if(points){const remaining=startingBudget(character,entities).remaining.traits;points.textContent=character.playable?remaining+' trait points left':'Unlimited trait points for NPCs';points.dataset.budget='traits';points.classList.toggle('over-budget',remaining<0);}
  grid.replaceChildren();for(const row of choices){if(!row.name.toLowerCase().includes(search.value.toLowerCase()))continue;const choice=button(row.name,()=>show(row));choice.className='pool-choice';choice.dataset.choiceId=row.id;choice.setAttribute('aria-label',row.name);choice.setAttribute('aria-pressed',String(isSelected(row)));choice.append(el('small',kind==='traits'?costLabel(row):'5 skill points / full bar'));grid.append(choice);}
  selected.replaceChildren();const grants=skillGrants(character,entities);
  for(const row of choices.filter(isSelected)){
   const item=el('div','','selected-choice'),grant=grants[row.id];
   if(kind==='skills'){
    const scale=row.data.scale??{min:0,max:100,step:1};
    item.append(ratingControl(row.name,character.skills[row.id],value=>{character.skills[row.id]=Math.max(grant?.value??scale.min,value);onchange(character);for(const control of selected.querySelectorAll('.rating-control'))control.refreshRating?.();if(grant&&value<grant.value)draw();if(focused)show(focused);},{...scale,bubbles:true,hardMin:grant?.value??-1000000,maxAllowed:()=>startingRatingMaximum(character,entities,'skills',row.id,scale)}));
    if(grant)item.append(el('small','Free to '+grant.value+' · '+grant.sources.join(', ')));
   }else item.append(el('strong',row.name),el('small',costLabel(row)));
   if(kind!=='skills'||!grant)item.append(button('Remove '+row.name,()=>toggle(row)));
   item.append(button('Details: '+row.name,()=>show(row)));selected.append(item);
  }
  if(!choices.length)grid.append(el('p','No campaign '+kind+' are published yet. A Creator can install or publish the catalog in Creation Studio.'));
  if(focused)show(focused);
 };
 register(character,draw);search.addEventListener('input',draw);root.append(...(points?[points]:[]),el('p','Click an option to read its description, in-game effects and cost, then choose it. Free skills appear automatically.'),search,grid,detail,selected);draw();return root;
}

import {WORKPLACES} from './city-content.js';

export function occupationPicker(onchange){
 const root=el('div','','occupation-picker'),toggle=el('input'),label=el('label','Choose my own starting jobs'),rows=el('div'),add=button('Add job',()=>{if(jobs.length<3){jobs.push({placeOfWork:'',position:''});draw();}});toggle.type='checkbox';label.prepend(toggle);let jobs=[];
 const publish=()=>onchange(toggle.checked?jobs.map(row=>({...row})):undefined);
 const draw=()=>{
  rows.replaceChildren();rows.hidden=!toggle.checked;add.hidden=!toggle.checked;add.disabled=jobs.length>=3;
  for(const [index,job]of jobs.entries()){
   const box=el('div','','field-grid'),work=el('select'),position=el('select'),workLabel=el('label','Place of work · job '+(index+1)),roleLabel=el('label','Occupation · job '+(index+1));
   work.setAttribute('aria-label','Place of work · job '+(index+1));position.setAttribute('aria-label','Occupation · job '+(index+1));work.required=true;position.required=true;
   for(const name of ['',...WORKPLACES.map(row=>row.name)]){const option=el('option',name||'Choose a workplace');option.value=name;option.selected=name===job.placeOfWork;work.append(option);}
   const roles=()=>{position.replaceChildren();for(const name of ['',...(WORKPLACES.find(row=>row.name===job.placeOfWork)?.positions??[])]){const option=el('option',name||'Choose an occupation');option.value=name;option.selected=name===job.position;position.append(option);}};
   work.addEventListener('change',()=>{job.placeOfWork=work.value;job.position='';roles();publish();});position.addEventListener('change',()=>{job.position=position.value;publish();});roles();workLabel.append(work);roleLabel.append(position);box.append(workLabel,roleLabel,button('Remove job '+(index+1),()=>{jobs.splice(index,1);draw();}));rows.append(box);
  }publish();
 };
 toggle.addEventListener('change',draw);root.append(label,el('p','Leave off to keep the package’s jobs. Choose up to three profile occupations. Wages, shifts and employment contracts are set by campaign job records, not this dropdown.','sheet-guidance'),rows,add);draw();return root;
}
