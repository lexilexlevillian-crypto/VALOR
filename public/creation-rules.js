// Shared, deterministic starting rules. Ratings remain on each campaign's scale.
import {automaticTraitNames} from './profile-rules.js';
import {BACKGROUNDS,stockSkill} from './creation-backgrounds.js';
export const CREATION_BUDGETS={attributes:35,skills:12,traits:6,refundCap:6};
export const ORIGINS=BACKGROUNDS;
export const originFor=id=>ORIGINS.find(row=>row.id===id);
export const effectText=modifiers=>Object.entries(modifiers??{}).map(([name,value])=>(value>0?'+':'')+value+' '+name+' checks').join(' · ');
const round=value=>Math.round(value*1000)/1000;
export function startingBudget(character,entities,attributeScale){
 const scale=attributeScale??{min:0,max:100,step:1};
 const normalized=(value,s,max)=>s.max===s.min?0:Math.max(0,(Number(value)-s.min)/(s.max-s.min))*max;
 const attributes=round(Object.values(character.attributes??{}).reduce((total,value)=>total+normalized(value,scale,10),0));
 let skills=0,spent=0,refund=0;const grants=skillGrants(character,entities);
 for(const [id,value]of Object.entries(character.skills??{})){const skill=entities.find(e=>e.kind==='skill'&&e.id===id);if(skill){const s=skill.data.scale??{min:0,max:100,step:1};skills+=normalized(s.min+Math.max(0,Number(value)-(grants[id]?.value??s.min)),s,5);}}
 for(const id of character.traits??[]){const trait=entities.find(e=>e.kind==='trait'&&e.id===id);if(trait?.data.mode==='costed'){const cost=Number(trait.data.cost)||0;if(cost>=0)spent+=cost;else refund-=cost;}}
 for(const name of automaticTraitNames(character)){if((character.traits??[]).some(id=>entities.some(e=>e.id===id&&e.name===name)))continue;const cost=stockTrait(name)?.cost??0;if(cost>=0)spent+=cost;else refund-=cost;}
 const credit=Math.min(refund,CREATION_BUDGETS.refundCap),traits=round(spent-credit);
 return {attributes,skills:round(skills),traits,refund:credit,rawRefund:refund,remaining:{attributes:round(CREATION_BUDGETS.attributes-attributes),skills:round(CREATION_BUDGETS.skills-skills),traits:round(CREATION_BUDGETS.traits-traits)}};
}
export function startingRatingMaximum(character,entities,kind,key,scale){
 if(!character.playable)return scale.max;
 const current=Number(kind==='attributes'?character.attributes?.[key]:character.skills?.[key])||scale.min,remaining=startingBudget(character,entities,kind==='attributes'?scale:undefined).remaining[kind],fullBarCost=kind==='attributes'?10:5,raw=Math.min(scale.max,current+Math.max(0,remaining)*(scale.max-scale.min)/fullBarCost),step=Number(scale.step)||1;
 const snapped=scale.min+Math.floor((raw-scale.min+1e-8)/step)*step;
 return Math.max(current,Math.min(scale.max,Math.round(snapped*1e8)/1e8));
}
// Explicit authored game effects, not claims about real-world identities or diagnoses.
const rows={
 'Short':['Agility',1,'Strength',-1], 'Tall':['Strength',1,'Agility',-1],
 'Slim':['Agility',1,'Endurance',-1], 'Stocky':['Endurance',1,'Agility',-1],
 'Overweight':['Endurance',-1], 'Weak':['Strength',-2], 'Strong':['Strength',2],
 'Muscular':['Strength',2], 'Athletic':['Endurance',2], 'Graceful':['Agility',2], 'Clumsy':['Agility',-2],
 'Scarred':['Will',1], 'Intimidating appearance':['Presence',1], 'Distinctive appearance':['Presence',1],
 'Authored chronic limitation':['Endurance',-1],
 'Cunning':['Intellect',1], 'Observant':['Perception',2], 'Impulsive':['Will',-1],
 'Patient':['Will',1], 'Calculating':['Intellect',1], 'Manipulative':['Presence',1],
 'Charming':['Presence',2], 'Anxious':['Will',-1], 'Suspicious':['Perception',1,'Presence',-1],
 'Trusting':['Presence',1,'Perception',-1], 'Loyal':['Will',1], 'Jealous':['Will',-1],
 'Protective':['Will',1], 'Compassionate':['Presence',1], 'Callous':['Presence',-1],
 'Brave':['Will',2], 'Reckless':['Perception',-1], 'Disciplined':['Will',2],
 'Vindictive':['Will',-1], 'Honest':['Presence',1], 'Deceptive':['Presence',1],
 'Romantic':['Presence',1], 'Commitment-averse':['Will',-1],
 'Connected':['Presence',1], 'Respected':['Presence',2], 'Feared':['Presence',1],
 'Notorious':['Presence',-1], 'Affluent':['Presence',1], 'Poor':['Presence',-1],
 'Working class':['Endurance',1], 'Affiliated':['Presence',1], 'Criminal record':['Presence',-1],
 'Ex-convict':['Will',1,'Presence',-1], 'Informant':['Perception',1], 'Snitch reputation':['Presence',-1],
 'Flexible':['Agility',1], 'Steady hands':['Agility',1], 'Quick reflexes':['Agility',2], 'Sturdy':['Endurance',2],
 'Light sleeper':['Perception',1], 'Heavy sleeper':['Perception',-1], 'Keen hearing':['Perception',2], 'Keen eyesight':['Perception',2],
 'Motion sick':['Endurance',-1], 'Sure-footed':['Agility',2], 'Enduring':['Endurance',2], 'Fast runner':['Agility',2],
 'Curious':['Intellect',1], 'Resourceful':['Intellect',1], 'Methodical':['Will',1], 'Adaptable':['Will',1],
 'Optimistic':['Will',1], 'Pessimistic':['Will',-1], 'Skeptical':['Perception',1], 'Idealistic':['Will',1],
 'Diplomatic':['Presence',2], 'Blunt':['Presence',-1], 'Humorous':['Presence',1], 'Reserved':['Presence',-1],
 'Outgoing':['Presence',2], 'Perfectionist':['Will',1], 'Stubborn':['Will',1], 'Level-headed':['Will',2],
 'Easily distracted':['Perception',-1], 'Persistent':['Will',2], 'Creative':['Intellect',2], 'Pragmatic':['Intellect',1],
 'Generous':['Presence',1], 'Competitive':['Will',1], 'Cooperative':['Presence',1],
 'Local reputation':['Presence',1], 'Community leader':['Presence',2], 'Well traveled':['Perception',1],
 'New in town':['Presence',-1], 'Mentor':['Presence',1], 'Apprentice':['Will',1], 'Family ties':['Presence',1],
 'Union member':['Presence',1], 'Public figure':['Presence',1], 'Private person':['Presence',-1], 'Networker':['Presence',2]
};
const experience={'Street fighter':'Hand-to-hand','Boxer':'Hand-to-hand','Grappler':'Hand-to-hand','Firearms training':'Firearms: handguns','Police training':'Police procedure','Military training':'Firearms: rifles','Criminal experience':'Criminal knowledge','Driver':'Driving','Mechanic':'Mechanics','Medic':'First aid',Doctor:'Medicine','Nurse training':'Nursing',Surgeon:'Surgery',Therapist:'Counseling',Veterinarian:'Veterinary care','Teacher training':'Teaching',Researcher:'Research',Programmer:'Computer programming',Pilot:'Piloting',Sailor:'Sailing','Firefighter training':'Firefighting','Chef training':'Cooking',Musician:'Music',Artist:'Drawing','Journalist training':'Journalism',Lawyer:'Law',Accountant:'Accounting',Builder:'Construction',Farmer:'Agriculture',Interpreter:'Translation',Investigator:'Investigation',Survivalist:'Survival'};
function legacyStockTrait(name){
 if(experience[name])return {cost:2,modifiers:{},skill:experience[name],bonus:2,description:'Training grants +2 only on checks using '+experience[name]+'. It does not grant unrelated expertise.'};
 const row=rows[name];if(!row)return null;
 const modifiers={[row[0]]:row[1],...(row[2]?{[row[2]]:row[3]}:{})};
 const positive=Object.values(modifiers).filter(v=>v>0).reduce((a,b)=>a+b,0),negative=-Object.values(modifiers).filter(v=>v<0).reduce((a,b)=>a+b,0);
 return {cost:positive?Math.max(1,positive*2-negative): -negative*2,modifiers,description:'Optional game interpretation: '+effectText(modifiers)+'. This is an authored rule, not a judgment about real people.'};
}

export function selectedBackgrounds(character){
 const background=character.background??{},ids=[background.option1??background.originChoice,background.option2,background.option3,background.option4];
 // Earlier sheets used empty option1 alongside originChoice.
 if(!ids[0]&&background.originChoice)ids[0]=background.originChoice;
 return [...new Set(ids)].map(originFor).filter(Boolean);
}
export function skillGrants(character,entities){
 entities=character.playable?entities.filter(e=>!e.visibility||e.visibility==='campaign'):entities;
 const grants={};
 const add=(skill,fraction,source)=>{
  if(!skill||skill.archived)return;
  const scale=skill.data.scale??{min:0,max:100,step:1};
  const value=Math.min(scale.max,scale.min+Math.floor((scale.max-scale.min)*fraction/scale.step+1e-8)*scale.step);
  const existing=grants[skill.id];
  if(!existing||value>existing.value)grants[skill.id]={value,sources:[source]};
  else if(value===existing.value)existing.sources.push(source);
 };
 for(const background of selectedBackgrounds(character))for(const [name,fraction]of Object.entries(background.skills??{}))add(entities.find(e=>e.kind==='skill'&&e.name===name&&!e.archived),fraction,background.name);
 for(const id of character.traits??[]){
  const trait=entities.find(e=>e.kind==='trait'&&e.id===id&&!e.archived);
  for(const grant of trait?traitSkillGrants(trait,entities):[])add(entities.find(e=>e.kind==='skill'&&e.id===grant.skillId),grant.fraction,trait.name);
 }
 for(const name of automaticTraitNames(character)){if((character.traits??[]).some(id=>entities.some(e=>e.id===id&&e.name===name)))continue;for(const [skillName,fraction] of Object.entries(stockTrait(name)?.grants??{}))add(entities.find(e=>e.kind==='skill'&&e.name===skillName&&!e.archived),fraction,name);}
 return grants;
}
export function applyStartingGrants(character,entities){
 character.skills??={};
 for(const [id,grant]of Object.entries(skillGrants(character,entities)))character.skills[id]=Math.max(character.skills[id]??grant.value,grant.value);
 return character;
}
const traitDescriptions={
 Short:'A shorter frame favors nimble movement over leverage.',Tall:'A taller frame favors reach and leverage over nimble movement.',
 Slim:'A light build favors movement over sustained exertion.',Stocky:'A sturdy build favors stamina over nimble movement.',
 Overweight:'An authored build choice with a stamina tradeoff.',Weak:'Physical tasks take more effort.',Strong:'Physical force is a strength.',
 Muscular:'A muscular build supports physical force.',Athletic:'Regular conditioning improves stamina and provides starting athletic training.',Graceful:'Controlled movement and coordination come naturally.',Clumsy:'Precision movement is difficult.',
 Scarred:'Past hardship has reinforced resolve.', 'Intimidating appearance':'An imposing presentation can influence a first impression.',
 'Distinctive appearance':'A recognizable presentation helps you stand out.', 'Authored chronic limitation':'An individually authored limitation affects sustained exertion; use notes to describe it respectfully.',
 Cunning:'Quick thinking helps solve difficult problems.',Observant:'You pay attention to small details.',Impulsive:'You tend to act before pausing.',
 Patient:'You can wait and stay focused.',Calculating:'You think through consequences.',Manipulative:'You are practiced at influencing people.',
 Charming:'You are comfortable winning people over.',Anxious:'Pressure can make it harder to stay steady.',
 Suspicious:'You notice risks but find trust harder.',Trusting:'You build rapport but may overlook warning signs.',Loyal:'Commitment helps you stay the course.',
 Jealous:'Comparison can distract you.',Protective:'Protecting others strengthens your resolve.',Compassionate:'Concern for others supports rapport.',
 Callous:'Detachment can make rapport harder.',Brave:'You can stay steady in frightening situations.',Reckless:'You may overlook hazards.',
 Disciplined:'Habit and self-control keep you focused.',Vindictive:'Grudges can undermine composure.',Honest:'Straightforward communication can build rapport.',
 Deceptive:'You are practiced at presenting a misleading account.',Romantic:'You readily express affection.', 'Commitment-averse':'Long-term obligations can test resolve.',
 Connected:'An established network helps social confidence.',Respected:'A favorable reputation supports social confidence.',Feared:'A threatening reputation lends weight to your presence.',
 Notorious:'An unfavorable reputation can obstruct rapport.',Affluent:'A comfortable social background supports confidence; it does not create money.',
 Poor:'An authored social disadvantage; it does not set your cash balance.', 'Working class':'An authored work history supports stamina.',
 Affiliated:'Group connections support confidence; faction membership must still be authored.',
 'Criminal record':'A recorded past can obstruct rapport; this does not create a warrant.',
 'Ex-convict':'Past incarceration has shaped resolve and social obstacles; it does not create a current offense.',
 Informant:'Attention to detail supports information gathering.', 'Snitch reputation':'A reputation for sharing information can undermine trust.'
};
export function stockTrait(name){
 const rule=legacyStockTrait(name);if(!rule)return null;
 return {...rule,description:(traitDescriptions[name]??(rule.skill?'Practical training in '+rule.skill+'.':'A chosen character tendency affecting '+Object.keys(rule.modifiers).join(' and ')+'.'))+' In game: '+(effectText(rule.modifiers)||('+2 on checks using '+rule.skill))+'. These are authored game effects, not judgments about real people.',
 grants:rule.skill?{[rule.skill]:.5}:name==='Athletic'?{Athletics:.5}:{}};
}
// Existing untouched stock records gain these rules without rewriting user-authored records.
export function traitSkillGrants(trait,entities){
 if(trait.data.skillGrants?.length)return trait.data.skillGrants;
 const d=trait.data,stock=stockTrait(trait.name);
 if(!stock||d.mode!=='costed'||d.cost!==stock.cost||Object.keys(d.modifiers??{}).length!==Object.keys(stock.modifiers).length||Object.entries(stock.modifiers).some(([key,value])=>d.modifiers[key]!==value)||d.effects?.length||d.combinations?.length)return [];
 const old=legacyStockTrait(trait.name);
 if(d.description!==old.description&&d.description!==stock.description)return [];
 if(stock.skill){const scoped=d.scopedCheckModifiers??[];if(scoped.length!==1||scoped[0].value!==2||scoped[0].attribute||scoped[0].contexts?.length||entities.find(e=>e.id===scoped[0].skillId)?.name!==stock.skill)return [];}
 else if(d.scopedCheckModifiers?.length)return [];
 return Object.entries(stock.grants).flatMap(([name,fraction])=>{const skill=entities.find(e=>e.kind==='skill'&&e.name===name&&!e.archived);return skill?[{skillId:skill.id,fraction}]:[];});
}
export function skillStatus(skill,value){
 const stock=stockSkill(skill.name),scale=skill.data.scale??{min:0,max:100,step:1};
 const standard=stock&&(skill.data.description===stock.description||skill.data.description==='Creator-editable skill descriptor. Mechanical effects and prerequisites must be authored.');
 const trained=Boolean(standard&&scale.max>scale.min&&value>=scale.min+(scale.max-scale.min)/2);
 return {trained,checkBonus:trained?2:0,fatigueRate:trained&&skill.name==='Athletics'?-.15:0};
}
export {stockSkill};
