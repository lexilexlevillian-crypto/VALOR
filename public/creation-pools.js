import {ORIGINS,CREATION_BUDGETS,startingBudget,effectText} from './creation-rules.js';
import {ratingControl} from './studio.js';
const el=(tag,text='',cls='')=>{const node=document.createElement(tag);node.textContent=text;if(cls)node.className=cls;return node;};
const button=(text,action)=>{const node=el('button',text);node.type='button';node.addEventListener('click',action);return node;};
export function budgetPanel(character,entities,scale){
 const root=el('section','','starting-budget');root.setAttribute('aria-label','Starting point budgets');
 const refresh=()=>{
  root.hidden=!character.playable;if(root.hidden)return;
  const budget=startingBudget(character,entities,scale);
  root.replaceChildren(el('h2','Your starting points'),el('p','Spend up to 35 attribute points, 12 skill points and 6 trait points. Negative traits refund up to 6 points. You may leave points unused. NPCs have no point budgets.'));
  for(const key of ['attributes','skills','traits']){const remaining=budget.remaining[key],line=el('p',key[0].toUpperCase()+key.slice(1)+': '+remaining+' points left','budget-line');line.dataset.budget=key;line.classList.toggle('over-budget',remaining<0);root.append(line);}
  root.append(el('p','Attribute cost: 10 points for a full bar. Skill cost: 5 points for a full bar. Costs scale proportionally, including fractional values. Descriptive ratings do not spend points.','sheet-guidance'));
 };
 refresh();return {root,refresh};
}
export function selectionPool(kind,character,entities,onchange){
 const root=el('section','','selection-pool'),search=el('input'),grid=el('div','','choice-pool'),detail=el('div','','choice-detail'),selected=el('div','','selected-choices');
 search.type='search';search.placeholder='Find '+kind;search.setAttribute('aria-label','Search '+kind);
 detail.setAttribute('aria-live','polite');
 const choices=(kind==='backgrounds'?ORIGINS.map(row=>({...row,data:row})):entities.filter(row=>row.kind===(kind==='traits'?'trait':'skill')&&!row.archived)).sort((a,b)=>a.name.localeCompare(b.name));
 const isSelected=row=>kind==='backgrounds'?character.background?.originChoice===row.id:kind==='traits'?(character.traits??[]).includes(row.id):Object.hasOwn(character.skills??{},row.id);
 const changed=()=>{onchange(character);draw();};
 const toggle=row=>{
  if(kind==='backgrounds'){character.background??={};character.background.originChoice=isSelected(row)?'':row.id;}
  else if(kind==='traits'){character.traits??=[];character.traits=isSelected(row)?character.traits.filter(id=>id!==row.id):[...character.traits,row.id];}
  else {character.skills??={};if(isSelected(row))delete character.skills[row.id];else character.skills[row.id]=row.data.scale?.min??0;}
  changed();show(row);
 };
 const show=row=>{
  const definition=row.data;
  detail.replaceChildren(el('h4',row.name),el('p',kind==='skills'&&definition.description?.startsWith('Creator-editable skill descriptor.')?'Practice and knowledge used for '+row.name.toLowerCase()+'.':definition.description||'An authored '+kind.slice(0,-1)+'.'));
  if(kind==='backgrounds')detail.append(el('p',effectText(definition.modifiers)),el('p','Choose one background. Its +2 total check bonus is free and does not change your base ratings.'));
  if(kind==='traits'){
   const cost=definition.mode==='costed'?Number(definition.cost)||0:0;
   detail.append(el('strong',cost>0?'Costs '+cost+' trait points':cost<0?'Refunds '+Math.abs(cost)+' trait points':'No point cost'),el('p',effectText(definition.modifiers)||''));
   for(const modifier of definition.scopedCheckModifiers??[]){const skill=entities.find(e=>e.id===modifier.skillId);detail.append(el('p',(modifier.value>0?'+':'')+modifier.value+' '+(skill?.name||modifier.attribute||'checks')+(modifier.contexts?.length?' · '+modifier.contexts.join(', '):'')));}
   for(const effect of definition.effects??[])detail.append(el('p',effect.description||effect.name));
   for(const [key,label]of [['opposes','Cannot combine with'],['prerequisites','Requires']])if(definition[key]?.length)detail.append(el('p',label+': '+definition[key].map(id=>entities.find(e=>e.id===id)?.name??'a campaign-defined trait').join(', ')));
   if(definition.permanent||definition.loss?.mode==='never')detail.append(el('p','Permanent after creation. Review carefully before starting.'));
  }
  if(kind==='skills'){const scale=definition.scale??{min:0,max:100,step:1};detail.append(el('p','Adds its rating to checks that use this skill. Range '+scale.min+'–'+scale.max+'. A full bar costs 5 starting skill points.'));}
  detail.append(button(isSelected(row)?'Remove '+row.name:'Choose '+row.name,()=>toggle(row)));
 };
 const draw=()=>{
  grid.replaceChildren();for(const row of choices){if(!row.name.toLowerCase().includes(search.value.toLowerCase()))continue;const choice=button(row.name,()=>show(row));choice.className='pool-choice';choice.dataset.choiceId=row.id;choice.setAttribute('aria-pressed',String(isSelected(row)));grid.append(choice);}
  selected.replaceChildren();
  for(const row of choices.filter(isSelected)){
   const item=el('div','','selected-choice');
   if(kind==='skills')item.append(ratingControl(row.name,character.skills[row.id],value=>{character.skills[row.id]=value;onchange(character);},{...(row.data.scale??{min:0,max:100,step:1}),bubbles:true}));
   else item.append(el('strong',row.name));
   item.append(button('Remove '+row.name,()=>toggle(row)));selected.append(item);
  }
  if(!choices.length)grid.append(el('p','No campaign '+kind+' are published yet. A Creator can install or publish the catalog in Creation Studio.'));
 };
 search.addEventListener('input',draw);root.append(el('p',kind==='backgrounds'?'Pick one background to see its story and check bonuses. Your written background below is kept.':'Click any option to read what it does, then choose it. Selected options appear below.'),search,grid,detail,selected);draw();return root;
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
