// Shared, deterministic starting rules. Ratings remain on each campaign's scale.
export const CREATION_BUDGETS={attributes:35,skills:12,traits:6,refundCap:6};
export const ORIGINS=[
 {id:'local',name:'Local regular',description:'You learned the city by living in it.',modifiers:{Perception:1,Presence:1}},
 {id:'laborer',name:'Manual laborer',description:'Long shifts taught you how to pace physical work.',modifiers:{Strength:1,Endurance:1}},
 {id:'student',name:'Dedicated student',description:'Study and practice built your patience and knowledge.',modifiers:{Intellect:1,Will:1}},
 {id:'performer',name:'Performer',description:'Practice on a stage sharpened your timing and confidence.',modifiers:{Agility:1,Presence:1}},
 {id:'caregiver',name:'Caregiver',description:'Caring for others taught you to notice needs and stay steady.',modifiers:{Perception:1,Will:1}},
 {id:'athlete',name:'Amateur athlete',description:'Regular training built coordination and stamina.',modifiers:{Agility:1,Endurance:1}},
 {id:'apprentice',name:'Workshop apprentice',description:'Hands-on learning combined practical strength with problem solving.',modifiers:{Strength:1,Intellect:1}},
 {id:'organizer',name:'Community organizer',description:'Listening, organizing and following through developed your resolve.',modifiers:{Presence:1,Will:1}}
];
export const originFor=id=>ORIGINS.find(row=>row.id===id);
export const effectText=modifiers=>Object.entries(modifiers??{}).map(([name,value])=>(value>0?'+':'')+value+' '+name+' checks').join(' · ');
const round=value=>Math.round(value*1000)/1000;
export function startingBudget(character,entities,attributeScale){
 const scale=attributeScale??{min:0,max:100,step:1};
 const normalized=(value,s,max)=>s.max===s.min?0:Math.max(0,(Number(value)-s.min)/(s.max-s.min))*max;
 const attributes=round(Object.values(character.attributes??{}).reduce((total,value)=>total+normalized(value,scale,10),0));
 let skills=0,spent=0,refund=0;
 for(const [id,value]of Object.entries(character.skills??{})){const skill=entities.find(e=>e.kind==='skill'&&e.id===id);if(skill)skills+=normalized(value,skill.data.scale??{min:0,max:100,step:1},5);}
 for(const id of character.traits??[]){const trait=entities.find(e=>e.kind==='trait'&&e.id===id);if(trait?.data.mode==='costed'){const cost=Number(trait.data.cost)||0;if(cost>=0)spent+=cost;else refund-=cost;}}
 const credit=Math.min(refund,CREATION_BUDGETS.refundCap),traits=round(spent-credit);
 return {attributes,skills:round(skills),traits,refund:credit,rawRefund:refund,remaining:{attributes:round(CREATION_BUDGETS.attributes-attributes),skills:round(CREATION_BUDGETS.skills-skills),traits:round(CREATION_BUDGETS.traits-traits)}};
}
// Explicit authored game effects, not claims about real-world identities or diagnoses.
const rows={
 'Short':['Agility',1,'Strength',-1], 'Tall':['Strength',1,'Agility',-1],
 'Slim':['Agility',1,'Endurance',-1], 'Stocky':['Endurance',1,'Agility',-1],
 'Overweight':['Endurance',-1], 'Weak':['Strength',-2], 'Strong':['Strength',2],
 'Athletic':['Endurance',2], 'Graceful':['Agility',2], 'Clumsy':['Agility',-2],
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
 'Ex-convict':['Will',1,'Presence',-1], 'Informant':['Perception',1], 'Snitch reputation':['Presence',-1]
};
const experience={'Street fighter':'Hand-to-hand','Boxer':'Hand-to-hand','Grappler':'Hand-to-hand','Firearms training':'Firearms: handguns','Police training':'Police procedure','Military training':'Firearms: rifles','Criminal experience':'Criminal knowledge','Driver':'Driving','Mechanic':'Mechanics','Medic':'First aid'};
export function stockTrait(name){
 if(experience[name])return {cost:2,modifiers:{},skill:experience[name],bonus:2,description:'Training grants +2 only on checks using '+experience[name]+'. It does not grant unrelated expertise.'};
 const row=rows[name];if(!row)return null;
 const modifiers={[row[0]]:row[1],...(row[2]?{[row[2]]:row[3]}:{})};
 const positive=Object.values(modifiers).filter(v=>v>0).reduce((a,b)=>a+b,0),negative=-Object.values(modifiers).filter(v=>v<0).reduce((a,b)=>a+b,0);
 return {cost:positive?Math.max(1,positive*2-negative): -negative*2,modifiers,description:'Optional game interpretation: '+effectText(modifiers)+'. This is an authored rule, not a judgment about real people.'};
}
