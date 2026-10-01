import {NEIGHBORHOODS,residencePlan} from './profile-rules.js';
const node=(tag,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
export function worldSettingsControls(getDraft){
 const root=node('div');root.className='friendly-world-settings';
 const section=(title,help)=>{const s=node('section'),h=node('h3',title);s.append(h,node('p',help));root.append(s);return s;};
 const add=(section,key,label,help,type='checkbox',options=null)=>{
  const field=node('div'),id='world-setting-'+key,control=node(options?'select':'input');field.className='field';control.id=id;
  if(options){for(const [value,text]of options){const option=node('option',text);option.value=value;control.append(option);}control.value=String(getDraft()[key]);}
  else{control.type=type;if(type==='checkbox')control.checked=!!getDraft()[key];else {control.value=getDraft()[key];if(type==='number'){control.min=0;control.max=1000000;control.step=1;}}}
  const caption=node('label',label);caption.htmlFor=id;const instructions=node('p',help);instructions.id=id+'-help';instructions.className='sheet-guidance';control.setAttribute('aria-describedby',instructions.id);
  control.addEventListener('change',()=>{getDraft()[key]=type==='checkbox'&&!options?control.checked:type==='number'?Number(control.value):control.value;});
  field.append(caption,control,instructions);section.append(field);return control;
 };
 const everyday=section('Everyday life','Turn on only the systems you want. Turning a system off does not delete its authored records.');
 add(everyday,'needs','Track hunger, thirst and tiredness','On: needs change as game time passes. Off: players can focus on story.');
 add(everyday,'fuel','Vehicles use fuel','On: driving consumes fuel. Off: do not track fuel use.');
 add(everyday,'weather','Starting weather','The weather at the beginning of a new life. Authored weather schedules can change it later.','select',['clear','rain','overcast','snow','fog'].map(v=>[v,v[0].toUpperCase()+v.slice(1)]));
 const tone=section('Relationships and story tone','These options do not remove consent or adult-age checks.');
 add(tone,'romance','Allow romance','Characters may pursue romantic relationships when the story and their choices allow it.');
 add(tone,'intimacy','Intimate scenes','Off: no intimate scenes. Fade to black: acknowledge consensual adult intimacy without graphic description.','select',[['off','Off'],['fade-to-black','Fade to black (non-graphic)']]);
 add(tone,'intensity','Description intensity','Restrained keeps injury descriptions lighter; grounded uses a more realistic tone.','select',[['restrained','Restrained'],['grounded','Grounded']]);
 const time=section('City clock','Valor is in Washington. Pacific time automatically accounts for daylight saving time. This changes the display and schedule timezone, not the saved instant.');
 const timezone=add(time,'timezone','Timezone','Recommended: America/Los_Angeles. Leave this alone unless you deliberately move the setting.','text');
 const pacific=node('button','Use Washington / Pacific time');pacific.type='button';pacific.addEventListener('click',()=>{timezone.value='America/Los_Angeles';getDraft().timezone=timezone.value;});time.append(pacific);
 const ai=section('AI usage limits','These are spending limits for narration, not character points. A token is roughly part of a word. Zero disables AI spending; grounded narration remains available. An API key must already be configured on the server.');
 add(ai,'tokenBudget','Total AI token allowance','Maximum tracked AI tokens available in this life. This is not a dollar amount.','number');
 add(ai,'userTokenBudget','AI token allowance per player','Each player must fit within both this allowance and the total allowance.','number');
 const rules=section('Action checks','Checks decide whether difficult actions succeed. Keep your existing rules or use the starter preset below. Advanced tuning is optional.');
 const status=node('p',getDraft().rules?'Action rules are configured.':'Action rules are not configured yet.');rules.append(status);
 const preset=node('button','Use starter action rules');preset.type='button';preset.addEventListener('click',()=>{getDraft().rules={dieSides:20,threshold:60,damage:5,treatmentMinutes:30,recoveryPerDay:5,unfamiliarPenalty:10,bleedPerMinute:0};status.textContent='Starter preset selected: d20 + attribute + skill, target 60; base damage 5, treatment 30 minutes, recovery 5/day, unfamiliar penalty 10, no timed bleeding. Save below to apply.';});rules.append(preset,node('p','The preset replaces only action-resolution rules when you save. It does not change character ratings or budgets.'));
 const housing=section('Apartment floor plans','Defaults: 8 apartments per floor; ordinary blocks and The Sync have 6 floors, Gateway blocks 12, First Harbor 20. Changes apply to new assignments, not existing residents. Unit 01 stays reserved for players.');
 const neighborhood=node('select');neighborhood.setAttribute('aria-label','Edit residence neighborhood');for(const name of NEIGHBORHOODS){const option=node('option',name);option.value=name;neighborhood.append(option);}housing.append(neighborhood);
 const floors=node('input'),units=node('input');floors.type=units.type='number';floors.min='3';floors.max='60';units.min='2';units.max='40';floors.step=units.step='1';const floorLabel=node('label','Floors'),unitLabel=node('label','Apartments per floor');floorLabel.append(floors);unitLabel.append(units);housing.append(floorLabel,unitLabel);
 const show=()=>{const plan=residencePlan(neighborhood.value,getDraft().residencePlans);floors.value=String(plan.floors);units.value=String(plan.unitsPerFloor);};const save=()=>{if(!floors.validity.valid||!units.validity.valid||!floors.value||!units.value)return;getDraft().residencePlans??={};getDraft().residencePlans[neighborhood.value]={floors:Number(floors.value),unitsPerFloor:Number(units.value)};};neighborhood.addEventListener('change',show);floors.addEventListener('change',save);units.addEventListener('change',save);show();
 return root;
}
