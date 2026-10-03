// Creation controls preserve server validation, visibility and exact stored ratings.
const el=(tag,attrs={},...children)=>{const node=document.createElement(tag);for(const [key,value] of Object.entries(attrs)){if(key==='class')node.className=value;else if(key==='value')node.value=value;else node.setAttribute(key,String(value));}for(const child of children.flat())if(child!=null)node.append(child);return node;};
export const readable=value=>String(value).replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
// Plain-language authoring help. Labels never rename the saved schema fields.
const characterHelp={
 dob:['Date of birth','Optional. Choose a birth date; leave blank if unknown.'],
 sex:['Sex','Optional character detail. Use your own words or leave blank.'],
 gender:['Gender','Optional. For example: woman, man, nonbinary.'],
 identity:['Other identity details','Optional named notes, such as language: Spanish. Add only what matters to this character.'],
 cultureContext:['Culture & upbringing','Describe traditions or communities that shaped them. Example: grew up speaking two languages.'],
 originLocationId:['Hometown / original place','Optional. Link an existing place record; this is not their current location.'],
 classContext:['Financial background','Describe their upbringing, such as working-class family or wealthy household. This does not set their money.'],
 familyBackground:['Family history','Write a few sentences about relatives and important family experiences.'],
 employerOccupation:['Work background','Describe past or general work experience. Use the Occupation section above for their current jobs.'],
 education:['Education','For example: finished high school, nursing student, or learned on the job.'],
 beliefsContext:['Beliefs & values','Describe what matters to them. This is character background, not a game rule.'],
 appearance:['Other appearance details','Optional named notes. Example: hair texture: curly.'],
 hair:['Hair','Describe color, style or length. Example: short black curls.'],
 scars:['Scars','Optional. Add one description per entry, such as a scar on the left eyebrow.'],
 tattoos:['Tattoos','Optional. Add one description per entry, such as a rose on the shoulder.'],
 disabilities:['Disabilities & access needs','Optional authored details. Describe relevant needs without assuming ability or personality.'],
 presentation:['Style & presentation','For example: practical work clothes, bright makeup, or a formal uniform.'],
 socialPresentation:['How they present in different settings','Optional named notes. Example: at work: polite and reserved.'],
 attractivenessContext:['How others may see them','Optional, context-dependent description. Do not use a universal beauty score.'],
 locationId:['Current location','Choose the place where this character starts. Create the place in Places first if it is missing.'],
 homeId:['Home','Optional. Link their home record. Leave unset if they have no authored home.'],
 cash:['Cash on hand (dollars and cents)','Enter the amount in dollars and cents, such as 25.00. Leave 0.00 if they start with no cash.'],
 bank:['Bank balance (dollars and cents)','Enter the amount in dollars and cents, such as 100.00. Leave 0.00 for no starting balance.'],
 condition:['Consciousness / life state','Usually leave conscious. Unconscious means unable to act; dead means the character has died.'],
 blood:['Blood level','0–100. Usually leave 100 for a healthy starting character. Lower values mean blood loss.'],
 fatigue:['Tiredness','0–100. 0 means rested; higher numbers mean more tired.'],
 hunger:['Hunger','0–100. 0 means not hungry; higher numbers mean hungrier.'],
 thirst:['Thirst','0–100. 0 means not thirsty; higher numbers mean thirstier.'],
 hygiene:['Cleanliness','0–100. 100 means clean; lower numbers mean they need to wash.'],
 intoxication:['Intoxication','0–100. Usually leave 0 for a sober starting character.'],
 restrainedBy:['Restrained by','Optional. Link whoever is restraining this character. Leave unset if they are free.'],
 dependence:['Substance dependence level','0–100. Usually leave 0. Set only for an intentionally authored dependence.'],
 withdrawal:['Withdrawal level','0–100. Usually leave 0. Higher numbers mean stronger withdrawal symptoms.'],
 lastDoseAt:['Last substance use time','Optional. Use a full timestamp, such as 2012-06-15T18:30:00Z. Leave unset unless this history matters.'],
 reproductive:['Optional reproductive health settings','Usually leave off. Use only if this system is enabled for the campaign and relevant to the character.'],
 needsContext:['Daily-care notes','Optional context about food, rest or care. Example: works nights and sleeps during the day.'],
 mood:['Starting mood','A short description, such as nervous but hopeful.'],
 goals:['Goals','Add one goal per entry. Example: save enough money to move out. These notes do not automatically schedule actions.'],
 fears:['Fears','Add one fear per entry. Example: losing their job. Leave empty if not needed.'],
 voice:['Speaking style','Describe how they talk. Example: short sentences, dry humor, rarely swears.'],
 instructions:['Narration guidance','Optional writing instructions. Example: show nervousness through gestures. This does not override game rules or permissions.'],
 aiBehavior:['NPC behavior notes','Describe how the NPC tends to react. Example: avoids arguments but helps close friends. These notes do not grant extra access or force actions.'],
 secrets:['Secret backstory','Optional hidden story ideas. Visibility is controlled separately; typing here is not a replacement for checking permissions.'],
 notes:['Creator notes','Your extra authoring notes. Leave blank if nothing else is needed. Check visibility before sharing the record.'],
 traits:['Traits','Choose existing trait records. Create traits in Skills & systems first if needed.'],
 factionIds:['Groups & factions','Choose existing groups this character belongs to. Leave empty for none.'],
 preferences:['Likes & dislikes','Optional named notes. Example: music: jazz; dislikes: crowds.'],
 boundaries:['Personal boundaries','Add one boundary per entry. Example: does not want to be touched by strangers. This never replaces player consent.'],
 compatibility:['Relationship matching rules','Optional advanced rules for NPC preferences. Leave the defaults unless you want particular traits to affect matching.'],
 traitWeights:['Trait preferences','Optional trait ID → score pairs. Positive favors a trait; negative disfavors it. Use existing trait IDs only.'],
 requiredTraits:['Required traits in a match','Optional. Choose traits a match must have. Empty means no required traits.'],
 minimum:['Minimum match score','Leave the default unless you want to reject lower-scoring matches.'],
 schedule:['Daily routine','Optional. Add a time, existing place and activity for each routine. Example: 09:00, cafe, work shift. Jobs above can be written without adding a routine here.'],
 minute:['Time of day','Choose the local in-game time this routine begins.'],
 days:['Days of the week','For routine entries use 0 = Sunday, 1 = Monday, through 6 = Saturday. Leave the default seven entries for every day.'],
 activity:['Current activity','Briefly describe what they are doing, such as working or resting.'],
 kind:['Routine type','Choose the closest activity type. Routine is a normal recurring activity.'],
 required:['Must attend this routine','Turn on if this routine is required rather than optional.'],
 plans:['Automatic NPC actions','Optional advanced rules. Each plan needs an action type and target. Leave empty if you do not want to author extra automatic actions.'],
 type:['Action type','Choose the action this plan should attempt, such as work, travel or socialize.'],
 targetId:['Action target','Choose the existing person, place or other record this action targets.'],
 auxiliaryId:['Extra linked record','Optional second record needed by the chosen action. Leave unset if not needed.'],
 priority:['Priority','Higher numbers give this plan greater priority. Leave 0 if you have no preference.'],
 cooldownMinutes:['Wait between attempts (minutes)','For example: 60 means wait at least one in-game hour between attempts.'],
 enabled:['Enabled','Turn on to allow this setting or plan to be used.'],
 conditions:['When this action can happen','Optional checks that must pass. Leave empty for no extra checks.'],
 constraints:['Extra restrictions','Optional checks that further restrict the action. Leave empty unless needed.'],
 threshold:['Required amount','The amount the selected check compares against. For example, a health check may use a health value.'],
 negate:['Reverse this check','Turn on to require the opposite of the selected condition. Usually leave off.'],
 expiresAt:['Stop trying after','Optional timestamp. Leave unset if the plan should not expire.'],
 maxRunsPerDay:['Maximum attempts per day','Limits how often the plan may run in one in-game day.'],
 fallback:['If the action cannot happen','Skip leaves it for later; retry tries again later; disable switches it off; next-plan moves on.'],
 playable:['Playable character','On means a player can control this character. Off means NPC.'],
 controllerUserId:['Player account allowed to control them','For a playable character, choose the controlling account. Unset allows authorized creators, not every player. NPCs do not need a player account.'],
 profileVisibility:['Who may see each profile field','Each entry names a field, such as legalName. Campaign shares it with campaign players; creator limits it to creators; owner limits it to the controlling player; knowledge requires the observer to know it. Existing observer rules still apply. Leave the defaults if unsure.'],
 registryStatus:['Registry status','Usually leave active. Missing means their whereabouts are unknown; inactive or retired keeps the record without treating it as active.'],
 arrested:['Currently arrested','Turn on only if this character starts under arrest.'],
 retirementNarrative:['Retirement story','Optional explanation for why this character is retired.'],
 tags:['Search labels','Optional short labels, one per entry. Example: cafe staff. These help organize records.'],
 mediaIds:['Additional pictures / media','Optional. Choose existing uploaded media records.'],
 heat:['Attention from law enforcement','Advanced: use existing faction IDs as names and 0–100 values. Leave empty if no attention has been authored.'],
 training:['Training history','Usually managed during play. Existing progress is preserved; this is not required to create a character.'],
 journey:['Travel in progress','Usually managed during play. Leave unset for a character who is not traveling.'],
 characterSchemaVersion:['Internal format version','Managed by VALOR. Do not change this to create a character.'],
 lastSimulated:['Last simulation update','Managed by VALOR when the world advances.'],
 simulationTier:['Simulation detail level','Managed by VALOR according to the character’s relevance.'],
 simulationTierReason:['Reason for simulation detail','Explanation recorded by VALOR.'],
 activityTimeline:['Recorded activity history','Past actions recorded by VALOR. Not a list of actions you need to fill out.'],
 traitEffectTrace:['Trait calculation history','Diagnostic record of trait effects. Not needed for normal character creation.'],
 mergedIntoId:['Merged character reference','Managed by the NPC merge tools.'],
 mergeRecordId:['Merge history reference','Managed by the NPC merge tools.'],
 lastActiveAt:['Last active time','Recorded by VALOR.'],
 id:['Internal reference','Generated automatically. Leave unchanged.']
};
export function characterFieldGuide(key,schema){
 const baseKey=key.replace(/ \d+$/,''),money=['cash','bank','cents'].includes(baseKey)||/Cents$/.test(baseKey),known=characterHelp[baseKey],label=known?.[0]??(money?readable(baseKey).replace(/ cents$/i,'')+' (dollars and cents)':readable(key));
 let help=known?.[1]??(schema.enum?'Choose one of the listed options.':schema.type==='boolean'?'Turn on for yes; leave off for no.':schema.type==='array'?'Optional list. Use Add for one entry at a time; leave empty if not needed.':schema.type==='object'?'Optional details. Add only information you know; existing values are kept when closed.':schema.format==='uuid'?'Choose an existing record. Create that record first if it is missing.':schema.type==='number'||schema.type==='integer'?'Enter a number. Keep the current value if you are unsure.':'Optional. Write a short description in your own words; leave blank if not needed.');
 if(money&&!known)help='Enter the amount in dollars and cents, such as 25.50.';
 if(['number','integer'].includes(schema.type)&&(schema.minimum!==undefined||schema.maximum!==undefined))help+=money?' Allowed range: '+(schema.minimum===undefined?'no minimum':'$'+(schema.minimum/100).toFixed(2))+' to '+(schema.maximum===undefined?'no maximum':'$'+(schema.maximum/100).toFixed(2))+'.':' Allowed range: '+(schema.minimum??'no minimum')+' to '+(schema.maximum??'no maximum')+'.';
 return {label:label+(baseKey!==key?' · entry '+key.slice(baseKey.length).trim():''),help};
}
export function helpTip(label,description){
 const id='help-'+crypto.randomUUID(),tip=el('span',{id,role:'tooltip',class:'section-tooltip'},description),trigger=el('button',{type:'button',class:'section-help','aria-label':'Help: '+label,'aria-describedby':id,'aria-expanded':'false'},'?'),wrap=el('span',{class:'help-wrap'},trigger,tip);
 const close=()=>{wrap.classList.remove('help-open');wrap.classList.add('help-dismissed');trigger.setAttribute('aria-expanded','false');};
 trigger.addEventListener('click',()=>{wrap.classList.remove('help-dismissed');const open=wrap.classList.toggle('help-open');trigger.setAttribute('aria-expanded',String(open));});wrap.addEventListener('pointerenter',()=>wrap.classList.remove('help-dismissed'));trigger.addEventListener('focus',()=>wrap.classList.remove('help-dismissed'));
 wrap.addEventListener('keydown',event=>{if(event.key==='Escape'){close();event.stopPropagation();}});wrap.addEventListener('focusout',event=>{if(!wrap.contains(event.relatedTarget))close();});return wrap;
}
export function sheetSection(title,description,...children){return el('section',{class:'sheet-section'},el('header',{class:'sheet-heading'},el('h3',{},title),helpTip(title,description)),el('div',{class:'sheet-body'},...children));}
export function moreDetails(title,description,...children){return el('details',{class:'sheet-more'},el('summary',{},title),el('p',{class:'sheet-guidance'},description),...children);}
export function ratingControl(label,value,onchange,{min=0,max=100,step=1,bubbles=false,hardMin=-1000000,hardMax=1000000,showNumber=true,showScale=true,maxAllowed=()=>max}={}){
 let current=Number(value??0);const id='rating-'+crypto.randomUUID(),rangeId=id+'-bar',number=showNumber?el('input',{id,type:'number',min:hardMin,max:hardMax,step:'any',value:current,'aria-label':label+' exact value'}):null,range=el('input',{id:rangeId,type:'range',min,max,step,value:current,'aria-label':label+' visual scale'}),marks=el('span',{class:'rating-marks','aria-hidden':'true'},...Array.from({length:10},()=>el('i'))),meter=el('div',{class:'rating-meter'+(bubbles?' rating-bubbles':'')},marks,range),scale=showScale?el('small',{class:'rating-scale'},min+'–'+max):null,row=el('div',{class:'rating-control'+(!showNumber&&!showScale?' rating-control--bar-only':'')},el('label',{for:showNumber?id:rangeId},readable(label)),meter,number,scale);
 if(number)number.required=true;
 const paint=()=>{const allowed=Math.max(min,Math.min(max,Number(maxAllowed())));range.max=String(allowed);if(number)number.max=String(Math.min(hardMax,allowed));[...marks.children].forEach((mark,i)=>mark.classList.toggle('filled',current>min+(max-min)*i/10));range.value=String(Math.max(min,Math.min(allowed,current)));range.setAttribute('aria-valuetext',String(current));if(number)number.value=String(current);};
 const refresh=()=>paint();row.refreshRating=refresh;range.addEventListener('pointerdown',refresh);range.addEventListener('focus',refresh);
 range.addEventListener('input',()=>{current=Number(range.value);paint();onchange(current);paint();});if(number)number.addEventListener('input',()=>{if(number.value!==''){current=Math.max(Number(number.min),Math.min(Number(range.max),Number(number.value)));paint();onchange(current);paint();}});paint();return row;
}
export function ratingMap(schema,value,onchange,{label='Skills',scale={min:0,max:100,step:1},bubbles=false,allowAdd=true,choices=[]}={}){
 const current={...(value??{})},root=el('div',{class:'rating-map'}),list=el('div',{class:'rating-list'}),draw=()=>{list.replaceChildren();for(const [key,number] of Object.entries(current)){const choice=choices.find(item=>item.id===key),row=el('div',{class:'rating-entry'},ratingControl(choice?.name??key,number,n=>{current[key]=n;onchange({...current});},{...(choice?.scale??scale),bubbles}));if(allowAdd){const remove=el('button',{type:'button',class:'rating-remove','aria-label':'Remove '+(choice?.name??key)},'×');remove.addEventListener('click',()=>{delete current[key];onchange({...current});draw();});row.append(remove);}list.append(row);}};
 root.append(list);draw();
 if(allowAdd){const name=el('select',{'aria-label':'Add authored '+label.toLowerCase()},el('option',{value:''},choices.length?'Choose a skill…':'No authored skills yet'),...choices.map(choice=>el('option',{value:choice.id},choice.name))),add=el('button',{type:'button'},'Add '+label.toLowerCase().replace(/s$/,'')),message=el('span',{role:'status',class:'muted'});add.addEventListener('click',()=>{const key=name.value,choice=choices.find(item=>item.id===key);if(!choice||Object.hasOwn(current,key)){message.textContent='Choose a skill not already on this sheet.';return;}current[key]=choice.scale?.min??0;onchange({...current});name.value='';message.textContent='';draw();});root.append(el('div',{class:'rating-add'},name,add),message);}
 root.append(el('p',{class:'sheet-guidance'},'Use the visual control or enter an exact value. Campaign rules still apply.'));return root;
}
