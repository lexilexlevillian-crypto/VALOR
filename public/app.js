const $=(tag,attrs={},...children)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k.startsWith('on'))e.addEventListener(k.slice(2).toLowerCase(),v);else if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k==='value')e.value=v;else if(k==='checked')e.checked=v;else if(v!==false&&v!=null)e.setAttribute(k,v===true?'':v);}for(const child of children.flat())if(child!=null)e.append(child instanceof Node?child:document.createTextNode(String(child)));return e;};
const S={user:null,csrf:'',campaign:null,timeline:null,character:null,view:null,creator:null,catalog:null,narrator:null,page:'Campaigns',busy:false,online:navigator.onLine};
const app=document.querySelector('#app'),notice=document.querySelector('#notice');
let noticeTimer;
function notify(message){notice.textContent=message;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.textContent='',9000);}
const labels={configure_resolution_rules_first:'Creator must configure the resolution rules before this action.',revision_conflict:'The world changed. Refresh and try again.',invalid_input:'Check the required fields and their values.',unauthenticated:'Please sign in.',reciprocal_consent_required:'There is no matching invitation or consent from the other character.',adult_age_verification_required:'Both characters need an authored adult date of birth.',entity_has_active_references:'This record is still referenced. Inspect its references before archiving.'};
async function api(path,body,method=body?'POST':'GET',retryKey=crypto.randomUUID()){
 if(!navigator.onLine)throw new Error('Offline. The shell remains available; changes need a connection.');
 const response=await fetch(path,{method,credentials:'same-origin',headers:{...(body?{'content-type':'application/json','x-csrf-token':S.csrf,'idempotency-key':retryKey}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const result=await response.json();if(!response.ok)throw new Error(labels[result.error]??String(result.error??'Request failed').replaceAll('_',' '));return result;
}
function button(text,handler,primary=false){return $('button',{type:'button',class:primary?'primary':'',onclick:()=>run(handler)},text);}
async function run(fn){if(S.busy)return;S.busy=true;document.documentElement.setAttribute('aria-busy','true');try{await fn();}catch(e){notify(e.message);}finally{S.busy=false;document.documentElement.removeAttribute('aria-busy');}}
function field(label,control){const id=control.id||'field-'+crypto.randomUUID();control.id=id;return $('div',{class:'field'},$('label',{for:id},label),control);}
function input(value='',type='text'){return $('input',{type,value});}
function title(text,kicker='VALOR / CITY RECORD'){return $('div',{},$('div',{class:'eyebrow'},kicker),$('h1',{},text),$('div',{class:'rule'}));}
const endpoint=(suffix)=>'/game/timelines/'+S.timeline.id+'/'+suffix;
const nav=['Chronicle','Character','Inventory','Equipment','Phone','Map','Relationships','Journal / Cases','Lore','Skills / Traits','Health','Vehicles','Jobs / Money','Combat','Search / Loot','Save / Load','Settings','Creator'];
function frame(content){
 const rail=$('aside',{class:'rail','aria-label':'Primary sidebar'},$('div',{class:'brand'},'VALOR',$('small',{},'THE CITY KEEPS A RECORD.')),
 $('div',{class:'eyebrow'},'CAMPAIGN DOSSIER'),$('nav',{'aria-label':'Game navigation'},
 button('Campaigns',()=>{S.page='Campaigns';return render();}),...(S.timeline?nav.filter(n=>n!=='Creator'||['creator','admin'].includes(S.campaign.role)).map(n=>{const b=button(n,()=>{S.page=n;return render();});if(n===S.page)b.setAttribute('aria-current','page');return b;}):[])),
 $('footer',{},$('div',{class:'eyebrow'},S.user?.role??''),button('Sign out',async()=>{await api('/auth/logout',{});S.user=null;S.csrf='';S.view=null;S.creator=null;S.character=null;S.timeline=null;S.campaign=null;loginScreen();})));
 const shell=$('div',{class:'shell'},rail,$('div',{class:'workspace'},
 $('header',{class:'topbar'},$('button',{type:'button',class:'mobile-menu','aria-label':'Toggle navigation',onclick:()=>{shell.classList.toggle('menu-open');}},'☰'),
 $('div',{class:'eyebrow'},S.campaign?.name??'PERSISTENT TEXT RPG / EST. 2012'),
 $('span',{class:S.online?'status':'status offline'},S.online?'● Connected':'● Offline')),
 $('main',{id:'main',tabindex:'-1'},content)));
 app.replaceChildren(shell);
}
function loginScreen(mode='login'){
 const signup=mode==='signup',email=input('','email'),password=input('','password');email.autocomplete='email';password.autocomplete=signup?'new-password':'current-password';email.required=true;password.required=true;
 const fields=[field('Email address',email),field('Password',password)];
 let confirmation;
 if(signup){confirmation=input('','password');confirmation.autocomplete='new-password';confirmation.required=true;fields.push(field('Confirm password',confirmation));}
 const form=$('form',{onsubmit:e=>{e.preventDefault();run(async()=>{if(signup&&password.value!==confirmation.value)throw new Error('Passwords do not match.');const result=await api(signup?'/auth/signup':'/auth/login',{email:email.value,password:password.value});S.user=result.user;S.csrf=result.csrfToken;password.value='';await render();});}},
 ...fields,$('button',{type:'submit',class:'primary'},signup?'Create account':'Enter Valor'));
 const switcher=$('p',{class:'auth-switch'},signup?'Already have an account? ':'Need an account? ',$('button',{type:'button',class:'link-button',onclick:()=>loginScreen(signup?'login':'signup')},signup?'Log in':'Sign up'));
 app.replaceChildren($('main',{id:'main',class:'login'},$('div',{class:'eyebrow'},'A PERSISTENT CRIME-DRAMA RPG'),$('div',{class:'brand'},'VALOR'),$('div',{class:'rule'}),$('h1',{},'Every choice leaves a trace.'),$('p',{},'A city written by its Creator. A life shaped by your decisions.'),form,switcher,$('p',{class:'muted'},signup?'Create a player account to begin your chronicle.':'Sign in to continue your chronicle.'),$('small',{class:S.online?'':'offline'},S.online?'Your session stays private.':'Offline — reconnect to sign in.')));
}
async function render(){
 if(!S.user)return loginScreen();
 if(S.page==='Campaigns')return campaigns();
 if(!S.timeline){S.page='Campaigns';return campaigns();}
 if(S.page==='Creator')return creator();
 if(S.page==='Save / Load')return saves();
 if(S.page==='Settings')return settings();
 if(!S.character)return roster();
 S.view=await api(endpoint('view')+'?characterId='+S.character.id);
 if(!S.catalog)S.catalog=await api('/game/catalog');
 if(!S.narrator)S.narrator=S.catalog.providers.includes('gemini')?'gemini':'grounded';
 if(S.page==='Chronicle')return chronicle();
 return dossier();
}
async function campaigns(){
 const list=await api('/campaigns');const content=$('div',{},title('Choose your story.','VALOR / MAIN MENU'),$('p',{class:'lead'},'Return to an existing campaign, or open a new city dossier. Characters, history, and consequences persist.'));
 const cards=$('div',{class:'grid'});
 for(const c of list.items)cards.append($('article',{class:'card'},$('span',{class:'badge'},c.role),$('h2',{},c.name),$('p',{},new Date(c.starting_at).toLocaleDateString()),button('Open campaign →',async()=>{S.campaign=c;let timelines=await api('/game/campaigns/'+c.id+'/timelines');if(!timelines.length&&['creator','admin'].includes(c.role))timelines=[await api('/game/campaigns/'+c.id+'/timelines',{})];S.timeline=timelines[0]??null;S.character=null;S.page='Chronicle';if(!S.timeline)notify('The Creator needs to initialize this campaign.');await render();},true)));
 content.append(cards);
 if(!list.items.length)content.append($('div',{class:'empty'},$('h3',{},'The city is unwritten.'),$('p',{},'Create a campaign, then author its locations and people in Creator. No city canon is generated automatically.')));
 if(['creator','admin'].includes(S.user.role)){
  const worlds=await api('/worlds'),worldName=input(''),campaignName=input(''),date=input('2012-01-01T08:00','datetime-local'),timezone=input('America/New_York');
  const worldSelect=$('select',{},...worlds.items.map(w=>$('option',{value:w.id},w.name)));
  const worldForm=$('form',{onsubmit:e=>{e.preventDefault();run(async()=>{await api('/worlds',{name:worldName.value});await campaigns();});}},field('Reusable world library name',worldName),$('button',{type:'submit'},'Create world library'));
  const campaignForm=$('form',{onsubmit:e=>{e.preventDefault();run(async()=>{await api('/campaigns',{worldId:worldSelect.value,name:campaignName.value,startingAt:new Date(date.value+'Z').toISOString(),timezone:timezone.value});await campaigns();});}},field('World library',worldSelect),field('Campaign name',campaignName),field('Starting date and time (UTC)',date),field('Display / schedule timezone',timezone),$('button',{type:'submit',class:'primary',disabled:!worlds.items.length},'Create campaign'));
  content.append($('div',{class:'rule'}),$('div',{class:'two'},$('section',{class:'card'},$('h3',{},'World library'),worldForm),$('section',{class:'card'},$('h3',{},'New campaign'),campaignForm)));
 }
 frame(content);
}
async function roster(){
 const characters=await api(endpoint('roster'));
 const content=$('div',{},title('Select a life.','VALOR / CHARACTER ROSTER'),$('p',{},'Choose a playable character assigned to your account.'));
 const grid=$('div',{class:'grid'});for(const c of characters)grid.append($('article',{class:'card'},$('span',{class:'badge'},c.condition),$('h2',{},c.name),$('p',{},c.description),button('Continue as '+c.name,async()=>{S.character=c;S.page='Chronicle';await render();},true)));
 content.append(grid);if(!characters.length)content.append($('div',{class:'empty'},$('h3',{},'No playable characters yet.'),$('p',{},'In Creator, add a location and a character. Enable playable and assign the character to your account.'),...(['creator','admin'].includes(S.campaign.role)?[button('Open Creator',()=>{S.page='Creator';return render();},true)]:[])));
 frame(content);
}
async function act(action,text){
 if(!navigator.onLine)throw new Error('Reconnect before taking an action.');
 const key=crypto.randomUUID();
 const payload={revision:S.view.timeline.revision,characterId:S.character.id,action,...(text?{text}:{})};
 const result=await api(endpoint('turns'),payload,'POST',key);
 if(S.narrator&&S.narrator!=='grounded')try{await api(endpoint('narrate'),{turnId:result.eventId,provider:S.narrator});}catch(error){notify('Turn saved. Grounded narration retained: '+error.message);}
 await render();
}
function chronicle(){
 const view=S.view,pc=view.entities.find(e=>e.id===S.character.id),location=view.entities.find(e=>e.id===pc?.data.locationId);
 const prose=$('div',{},title('Chronicle.','VALOR / '+S.character.name.toUpperCase()),$('div',{class:'scene'},$('span',{},location?.name??'LOCATION UNASSIGNED'),$('time',{datetime:view.clock},new Date(view.clock).toLocaleString())));
 if(!view.turns.length)prose.append($('div',{class:'empty'},$('h3',{},'A blank page. An open city.'),$('p',{},'Your first action starts the chronicle. Look around, speak in your own words, or choose a known destination.')));
 const provider=$('select',{},...(S.catalog.providers??['grounded']).map(id=>$('option',{value:id,selected:id===S.narrator},id)));
 provider.addEventListener('change',()=>{S.narrator=provider.value;});
 prose.append(field('Narration provider',provider));
 for(const turn of view.turns){
  const text=$('div',{class:'prose'},turn.narration);
  prose.append($('article',{class:'turn'},$('div',{class:'input'},'› '+turn.input_text),text,button('Rebuild narration without rerolling',async()=>{
   const response=await fetch(endpoint('narrate/stream'),{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-csrf-token':S.csrf},body:JSON.stringify({turnId:turn.id,provider:provider.value})});
   if(!response.ok){const error=await response.json();throw new Error(String(error.error??'Narration unavailable').replaceAll('_',' '));}
   const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',paragraphs=[];
   while(true){const chunk=await reader.read();pending+=decoder.decode(chunk.value??new Uint8Array(),{stream:!chunk.done});const lines=pending.split('\n');pending=lines.pop();for(const line of lines){if(!line)continue;const event=JSON.parse(line);if(event.type==='paragraph'){paragraphs.push(event.text);text.textContent=paragraphs.join('\n\n');}}if(chunk.done)break;}
   notify('Narration updated. Mechanics were not rerolled.');
  })));
 }
 const composer=$('textarea',{placeholder:'What do you do? Try “look”, “wait 10”, or “say …”.','aria-label':'Your explicit action',maxlength:1000});
 const proposal=$('section',{class:'card','aria-live':'polite'});
 const form=$('form',{class:'composer',onsubmit:e=>{e.preventDefault();run(async()=>{const text=composer.value;const parsed=await api(endpoint('parse'),{characterId:S.character.id,text});proposal.replaceChildren();if(!parsed.action)return notify(parsed.clarification);proposal.append($('h3',{},'Review proposed action'),$('p',{},'Nothing has happened yet. Confirm only if this matches your intention.'),renderValue(parsed.action),button('Confirm this action',()=>act(parsed.action,text),true),button('Cancel proposal',()=>proposal.replaceChildren()));});}},
 field('YOUR NEXT ACTION',composer),$('div',{class:'actions'},$('button',{type:'submit',class:'primary',disabled:!S.online},'Review action →'),button('Look around',()=>act({type:'look'})),button('Wait 10 min',()=>act({type:'wait',minutes:10}))));
 if(S.catalog.providers.includes('gemini'))form.append(button('Ask Gemini to interpret',async()=>{const text=composer.value;if(!text.trim())throw new Error('Enter an intended action first.');const parsed=await api(endpoint('interpret'),{characterId:S.character.id,text,provider:'gemini'});proposal.replaceChildren();if(!parsed.action)return notify(parsed.clarification);proposal.append($('h3',{},'Review Gemini proposal'),$('p',{},'Nothing has happened. Check the exact action and target before confirming.'),renderValue(parsed.action),button('Confirm this action',()=>act(parsed.action,text),true),button('Cancel proposal',()=>proposal.replaceChildren()));}));
 prose.append(form,proposal,universalActions());
 const aside=$('aside',{class:'scene-aside','aria-label':'Current scene'},$('h2',{},'Current dossier'),$('h3',{},S.character.name),$('p',{},pc?.data.description??''),$('div',{class:'badge'},pc?.data.condition??'Unknown'),$('h3',{},'Known surroundings'));
 for(const e of view.entities.filter(e=>e.kind==='character'&&e.id!==S.character.id))aside.append($('p',{},e.name));
 aside.append($('h3',{},'Routes'),...((location?.data.exits??[]).map(exit=>{const dest=view.entities.find(e=>e.id===exit.to);return dest?button(dest.name+' · '+exit.minutes+' min',()=>act({type:'travel',destinationId:dest.id,mode:'walk',vehicleId:null})):null;})),button('Change character',()=>{S.character=null;return roster();}));
 frame($('div',{class:'chronicle-layout'},prose,aside));
}
const pageKinds={'Character':['character'],'Inventory':['item'],'Equipment':['item'],'Phone':['item','message','dispatch'],'Map':['location'],'Relationships':['relationship'],'Journal / Cases':['quest','case','evidence','judgment','estate','dispatch'],'Lore':['lore','storycard','media'],'Skills / Traits':['skill','trait'],'Health':['injury','service','dispatch'],'Vehicles':['vehicle'],'Jobs / Money':['job','business','housing','recipe','service','estate'],'Combat':['combat'],'Search / Loot':['item','evidence']};
function dossier(){
 const content=$('div',{},title(S.page+'.','VALOR / DOSSIER'));
 let rows=S.view.entities.filter(e=>(pageKinds[S.page]??[]).includes(e.kind));
 if(S.page==='Character')rows=rows.filter(e=>e.id===S.character.id);
 if(['Inventory','Equipment'].includes(S.page))rows=rows.filter(e=>e.data.ownerId===S.character.id);
 if(S.page==='Equipment')rows=rows.filter(e=>e.data.equipped);
 if(S.page==='Phone')rows=rows.filter(e=>e.kind==='message'||e.data.category==='phone');
 if(S.page==='Search / Loot')content.append(button('Search current location',()=>act({type:'search'}),true));
 if(S.page==='Jobs / Money'){const pc=S.view.entities.find(e=>e.id===S.character.id);content.append($('p',{class:'prose'},'Cash: $'+(Number(pc?.data.cash??0)/100).toFixed(2)));}
 const grid=$('div',{class:'grid'});
 for(const entity of rows){
  const card=$('article',{class:'card'},$('span',{class:'badge'},entity.kind),$('h3',{},entity.name),$('p',{},entity.data.description??''));
  for(const id of (entity.kind==='media'?[entity.id]:entity.data.mediaIds??[])){const asset=S.view.entities.find(e=>e.id===id&&e.kind==='media');if(asset)card.append($('img',{class:'media-image',src:endpoint('media')+'/'+id+'?characterId='+S.character.id,alt:asset.data.alt||asset.name,loading:'lazy'}));}
  const details=$('details',{},$('summary',{},'Record details'),renderValue(entity.data));
  card.append(details,...entityActions(entity));grid.append(card);
 }
 content.append(grid);if(!rows.length)content.append($('div',{class:'empty'},$('h3',{},'No permitted records.'),$('p',{},'Nothing in this category is currently known to this character.')));
 if(S.page==='Journal / Cases'){
  content.append($('h2',{},'Memories'),...S.view.memories.slice(-20).map(m=>$('p',{},m.text)));
  content.append($('h2',{},'Beliefs'),...S.view.beliefs.map(b=>$('p',{},b.proposition+' · confidence '+Math.round(b.confidence*100)+'%')));
 }
 if(S.page==='Combat')content.append(actionForm());
 content.append(universalActions());
 frame(content);
}
function renderValue(value){if(value===null)return $('span',{class:'muted'},'—');if(Array.isArray(value))return $('div',{},...value.map(v=>$('div',{},renderValue(v))));if(typeof value==='object')return $('dl',{},...Object.entries(value).filter(([k])=>!['sections'].includes(k)).flatMap(([k,v])=>[$('dt',{class:'eyebrow'},k.replace(/([A-Z])/g,' $1')),$('dd',{},renderValue(v))]));return $('span',{},String(value));}
function choose(label,entities){return field(label,$('select',{},$('option',{value:''},'Choose…'),...entities.map(e=>$('option',{value:e.id},e.name))));}
function entityActions(e){
 const nodes=[],owned=S.view.entities.filter(x=>x.kind==='item'&&x.data.ownerId===S.character.id),people=S.view.entities.filter(x=>x.kind==='character'&&x.id!==S.character.id);
 if(e.kind==='item'&&e.data.ownerId===S.character.id){nodes.push($('div',{class:'actions'},button(e.data.equipped?'Unequip':'Equip',()=>act({type:'equip',itemId:e.id,equipped:!e.data.equipped}))));
  if(['food','drink','medicine','substance'].includes(e.data.category))nodes.push(button('Consume one',()=>act({type:'consume',itemId:e.id})));
  if(e.data.category==='firearm')for(const ammo of owned.filter(x=>x.data.category==='ammo'&&x.data.caliber===e.data.caliber))nodes.push(button('Reload from '+ammo.name,()=>act({type:'reload',weaponId:e.id,ammoId:ammo.id})));
  if(e.data.category==='phone'){const to=choose('Contact',(e.data.contacts??[]).map(c=>({id:c.characterId,name:c.label}))),message=$('textarea',{maxlength:1000});nodes.push($('form',{onsubmit:event=>{event.preventDefault();run(()=>act({type:'message',phoneId:e.id,toId:to.querySelector('select').value,text:message.value,medium:'sms'}));}},to,field('SMS message',message),$('button',{type:'submit'},'Send SMS')));}
 }else if(e.kind==='item'&&!e.data.ownerId)nodes.push(button('Take',()=>act({type:'take',itemId:e.id})));
 if(e.kind==='location')nodes.push(button('Walk here',()=>act({type:'travel',destinationId:e.id,mode:'walk',vehicleId:null})));
 if(e.kind==='job')nodes.push(button('Work assigned shift',()=>act({type:'work',jobId:e.id})));
 if(e.kind==='housing')nodes.push(button('Pay rent',()=>act({type:'pay-rent',housingId:e.id})));
 if(e.kind==='injury')for(const medicine of owned.filter(x=>x.data.category==='medicine'))nodes.push(button('Treat with '+medicine.name,()=>act({type:'treat',injuryId:e.id,medicineId:medicine.id})));
 if(e.kind==='relationship'){const target=people.find(p=>p.id===e.data.fromId||p.id===e.data.toId);if(target)nodes.push(button('Greet '+target.name,()=>act({type:'social',targetId:target.id,intent:'greet',consent:false})));}
 return nodes;
}
function actionForm(){
 const target=choose('Target',S.view.entities.filter(e=>e.kind==='character'&&e.id!==S.character.id)),weapon=choose('Weapon (optional)',S.view.entities.filter(e=>e.kind==='item'&&e.data.ownerId===S.character.id&&['weapon','firearm'].includes(e.data.category)));
 return $('section',{class:'card'},$('h3',{},'Conflict actions'),target,weapon,$('div',{class:'actions'},button('Initiate conflict',()=>act({type:'combat',targetId:target.querySelector('select').value})),button('Attack',()=>act({type:'attack',targetId:target.querySelector('select').value,weaponId:weapon.querySelector('select').value||null,bodyPart:'torso'})),button('Defend',()=>act({type:'defend',defense:'dodge'})),button('Surrender',()=>act({type:'surrender'}))));
}
function schemaDefault(schema){
 if('const'in schema)return schema.const;
 if('default'in schema)return structuredClone(schema.default);
 if(schema.anyOf){const nonNull=schema.anyOf.find(x=>x.type!=='null');return schema.anyOf.some(x=>x.type==='null')?null:schemaDefault(nonNull);}
 if(schema.type==='object')return Object.fromEntries(Object.entries(schema.properties??{}).map(([k,v])=>[k,schemaDefault(v)]));
 if(schema.type==='array')return [];if(schema.type==='boolean')return false;if(schema.type==='number'||schema.type==='integer')return schema.minimum??0;
 if(schema.format==='uuid')return crypto.randomUUID();if(schema.enum)return schema.enum[0];return '';
}
function schemaEditor(schema,value,onchange,key='',depth=0){
 if('const'in schema)return field(key,$('input',{value:schema.const,readonly:true}));
 if(schema.$ref||schema.anyOf?.length>2){const control=$('textarea',{value:JSON.stringify(value??null,null,2)});control.addEventListener('change',()=>{try{onchange(JSON.parse(control.value));control.setCustomValidity('');}catch{control.setCustomValidity('Enter valid JSON.');}});return field(key+' (JSON value)',control);}
 if(schema.anyOf){const nonNull=schema.anyOf.find(x=>x.type!=='null');if(schema.anyOf.some(x=>x.type==='null')){
  const enabled=$('input',{type:'checkbox',checked:value!==null&&value!==undefined}),body=$('div',{}),holder=$('div',{},field(key+' · enabled',enabled),body);
  const redraw=()=>{body.replaceChildren();if(enabled.checked)body.append(schemaEditor(nonNull,value??schemaDefault(nonNull),v=>{value=v;onchange(v);},key,depth));};
  enabled.addEventListener('change',()=>{value=enabled.checked?schemaDefault(nonNull):null;onchange(value);redraw();});redraw();return holder;
 }return schemaEditor(nonNull,value,onchange,key,depth);}
 if(schema.type==='object'){
  let current=value&&typeof value==='object'?value:schemaDefault(schema);
  const box=$('div',{class:depth?'':'field-grid'});
  for(const[k,property]of Object.entries(schema.properties??{})){
   const editor=schemaEditor(property,current[k],v=>{current[k]=v;onchange(current);},k,depth+1);
   if(['object','array'].includes(property.type)||property.anyOf?.some(p=>p.type==='object'))box.append($('details',{},$('summary',{},k.replace(/([A-Z])/g,' $1')),editor));else box.append(editor);
  }
  if(schema.additionalProperties&&typeof schema.additionalProperties==='object'){
   const entries=$('div',{});const redraw=()=>{entries.replaceChildren();for(const[k,v]of Object.entries(current))entries.append($('div',{class:'array-item'},schemaEditor(schema.additionalProperties,v,x=>{current[k]=x;onchange(current);},k,depth+1),button('Remove '+k,()=>{delete current[k];onchange(current);redraw();})));};
   const newKey=input('');box.append(entries,$('div',{class:'row'},field('New property name',newKey),button('Add property',()=>{const k=newKey.value.trim();if(!k||['__proto__','constructor','prototype'].includes(k))throw new Error('Choose a safe property name.');current[k]=schemaDefault(schema.additionalProperties);onchange(current);newKey.value='';redraw();})));redraw();
  }
  return box;
 }
 if(schema.type==='array'){
  let items=Array.isArray(value)?value:[],list=$('div',{});const container=$('div',{},list);
  const redraw=()=>{list.replaceChildren();items.forEach((item,i)=>list.append($('div',{class:'array-item'},schemaEditor(schema.items,item,v=>{items[i]=v;onchange(items);},key+' '+(i+1),depth+1),$('div',{class:'actions'},button('Move up',()=>{if(i>0){[items[i-1],items[i]]=[items[i],items[i-1]];onchange(items);redraw();}}),button('Remove',()=>{items.splice(i,1);onchange(items);redraw();})))));};
  container.append(button('Add '+key,()=>{items.push(schemaDefault(schema.items));onchange(items);redraw();}));redraw();return container;
 }
 let control;
 if(schema.enum)control=$('select',{},...schema.enum.map(v=>$('option',{value:v,selected:v===value},v)));
 else if(schema.type==='boolean')control=$('input',{type:'checkbox',checked:!!value});
 else if(schema.format==='uuid'&&key!=='id'&&!key.startsWith('id ')){
  const options=[...((S.page==='Creator'?S.creator?.entities:S.view?.entities)??[]).filter(e=>!e.archived).map(e=>({id:e.id,name:e.name+' ['+e.kind+']'})),{id:S.user.id,name:'Current account'}];
  control=$('select',{},$('option',{value:''},'Choose record…'),...options.map(e=>$('option',{value:e.id,selected:e.id===value},e.name)));
 }else if(schema.type==='number'||schema.type==='integer')control=$('input',{type:'number',value:value??schema.minimum??0,min:schema.minimum,max:schema.maximum,step:schema.type==='integer'?1:'any'});
 else if(schema.format==='date')control=input(value??'','date');
 else if(schema.format==='date-time')control=input(value??'');
 else if((schema.maxLength??0)>1000)control=$('textarea',{value:value??''});
 else control=input(value??'');
 if(key==='id')control.readOnly=true;
 control.addEventListener('input',()=>onchange(schema.type==='boolean'?control.checked:schema.type==='number'||schema.type==='integer'?Number(control.value):control.value));
 return field(key.replace(/([A-Z])/g,' $1'),control);
}
async function creator(){
 if(!S.catalog)S.catalog=await api('/game/catalog');S.creator=await api(endpoint('creator'));
 const list=$('div',{class:'entity-list'}),editor=$('section',{class:'card'},$('h2',{},'Creator studio'),$('p',{},'Author the city, its people, objects and rules. Every record is stored on the server. Player views filter hidden fields.'));
 const filter=input(''),kind=$('select',{},...S.catalog.kinds.map(k=>$('option',{value:k},k)));
 function drawList(){list.replaceChildren();for(const e of S.creator.entities.filter(e=>!e.archived&&(!filter.value||(e.name+' '+e.kind).toLowerCase().includes(filter.value.toLowerCase()))))list.append($('button',{type:'button',onclick:()=>edit(e)},e.name,$('small',{},e.kind)));}
 filter.addEventListener('input',drawList);
 function edit(original){
  const draft=structuredClone(original),schema=S.catalog.schemas[draft.kind],name=input(draft.name),visibility=$('select',{},...['creator','campaign','owner','knowledge'].map(v=>$('option',{value:v,selected:v===draft.visibility},v)));
  editor.replaceChildren($('span',{class:'badge'},draft.kind),$('h2',{},draft.name||'New record'),field('Name',name),field('Visibility',visibility));
  editor.append(schemaEditor(schema,draft.data,v=>draft.data=v));
  const save=async()=>{draft.name=name.value;draft.visibility=visibility.value;await api(endpoint(draft.kind==='media'?'media':'entities'),{revision:S.creator.timeline.revision,entity:draft});notify('Saved.');await creator();};
  editor.append($('div',{class:'actions'},button('Save record',save,true),button('Duplicate',()=>{const clone=structuredClone(draft);clone.id=crypto.randomUUID();clone.name=(name.value||draft.name)+' copy';clone.revision=1;edit(clone);}),button('Archive',async()=>{draft.archived=true;await save();})));
  const refs=S.creator.references.filter(r=>r.target_id===draft.id);if(refs.length)editor.append($('p',{},'Referenced by: '+refs.map(r=>S.creator.entities.find(e=>e.id===r.entity_id)?.name??r.entity_id).join(', ')));
 }
 drawList();
 const left=$('aside',{'aria-label':'Creator records'},field('Search records / NPC list',filter),field('Record type',kind),button('New record',()=>{
  const type=kind.value,defaults=schemaDefault(S.catalog.schemas[type]);
  if(type==='character'){defaults.controllerUserId=S.user.id;}
  edit({id:crypto.randomUUID(),kind:type,name:'',visibility:'creator',data:defaults,revision:1,archived:false});
 },true),list);
 const content=$('div',{},title('Creator.','VALOR / CONTENT STUDIO'),$('p',{},'No neighborhoods, people, gangs or laws are supplied as canon. Start with a location, then create a playable character and assign its location.'),button('Install editable skills and traits catalog',async()=>{const result=await api(endpoint('catalog'),{revision:S.creator.timeline.revision});notify(result.created+' editable catalog records added.');await creator();}),$('div',{class:'editor-layout'},left,editor));
 const factSubject=choose('Subject / observer',S.creator.entities.filter(e=>!e.archived)),layer=$('select',{},...['truth','knowledge','belief','memory','correct-belief','retire-truth','refresh-memory'].map(l=>$('option',{value:l},l))),text=$('textarea',{}),factId=input(''),recordId=input('');
 content.append($('details',{},$('summary',{},'World truth, knowledge, beliefs and memories'),$('form',{onsubmit:e=>{e.preventDefault();run(async()=>{await api(endpoint('epistemic'),{revision:S.creator.timeline.revision,layer:layer.value,subjectId:factSubject.querySelector('select').value,text:text.value,...(factId.value?{factId:factId.value}:{}),...(recordId.value?{recordId:recordId.value}:{})});await creator();});}},field('Layer',layer),factSubject,field('Authored proposition / memory',text),field('Fact UUID (knowledge, correction or retirement)',factId),field('Belief / memory UUID (correction or refresh)',recordId),$('button',{type:'submit'},'Record explicitly')),renderValue({facts:S.creator.facts,beliefs:S.creator.beliefs,memories:S.creator.memories})));
 content.append($('details',{},$('summary',{},'Developer event history'),button('Load authorized event trace',async()=>{const result=await api(endpoint('history'));content.append($('pre',{},JSON.stringify(result,null,2)));})));
 const previewCharacter=choose('Preview as character',S.creator.entities.filter(e=>e.kind==='character'&&!e.archived)),debug=$('div',{});
 content.append($('details',{},$('summary',{},'Read-only diagnostics and visibility preview'),previewCharacter,button('Run diagnostics',async()=>{debug.replaceChildren(renderValue(await api(endpoint('diagnostics'))));}),button('Preview observer-permitted state',async()=>{const id=previewCharacter.querySelector('select').value;if(!id)throw new Error('Choose a character.');debug.replaceChildren(renderValue(await api(endpoint('preview')+'?characterId='+id)));}),debug));
 const mediaFile=$('input',{type:'file',accept:'image/png,image/jpeg,image/webp'}),mediaAlt=input('');
 content.append($('details',{},$('summary',{},'Private image assets'),$('p',{},'PNG, JPEG or WebP, at most 256 KiB. Images are stored with the game database and exports. Uploads begin Creator-only; edit visibility and attach the media UUID to a record deliberately.'),field('Image file',mediaFile),field('Image description (alt text)',mediaAlt),button('Upload private image',async()=>{const file=mediaFile.files[0];if(!file||file.size>262144)throw new Error('Choose an image no larger than 256 KiB.');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let offset=0;offset<bytes.length;offset+=16384)binary+=String.fromCharCode(...bytes.subarray(offset,offset+16384));await api(endpoint('media'),{revision:S.creator.timeline.revision,entity:{id:crypto.randomUUID(),kind:'media',name:file.name,visibility:'creator',data:{mime:file.type,body:btoa(binary),alt:mediaAlt.value}}});notify('Private image saved.');await creator();})));
 const batch=$('textarea',{'aria-label':'Creator entity batch JSON',placeholder:'Paste an array of complete entity records (maximum 100).',maxlength:2*1024*1024});
 content.append($('details',{},$('summary',{},'Atomic bulk editing'),$('p',{},'Advanced tool: all records are validated and committed together, or none are changed. References may point to other records in the same batch. The current timeline revision prevents stale overwrites.'),batch,button('Commit validated batch',async()=>{const entities=JSON.parse(batch.value);if(!Array.isArray(entities)||!entities.length||entities.length>100)throw new Error('Supply 1–100 complete records.');await api(endpoint('entities/bulk'),{revision:S.creator.timeline.revision,entities});notify('Batch committed.');await creator();})));
 frame(content);
}
async function saves(){
 const list=await api(endpoint('saves')),timelines=await api('/game/campaigns/'+S.campaign.id+'/timelines'),saveName=input('Checkpoint'),branchName=input('New timeline'),templateName=input('World template');
 const content=$('div',{},title('Keep the record.','VALOR / SAVES & TIMELINES'),$('p',{},'Restore by creating a child timeline. The parent and its history remain intact.'),$('div',{class:'two'},$('section',{class:'card'},field('Save name',saveName),button('Save now',async()=>{await api(endpoint('saves'),{name:saveName.value});await saves();},true)), $('section',{class:'card'},field('New branch name',branchName))));
 content.append($('h2',{},'Timelines'),$('div',{class:'actions'},...timelines.map(t=>button(t.name+(t.id===S.timeline.id?' · current':''),async()=>{S.timeline=t;S.character=null;S.page='Chronicle';await render();}))));
 for(const save of list)content.append($('article',{class:'card'},$('div',{class:'section-head'},$('div',{},$('h3',{},save.name),$('small',{},'Revision '+save.revision+' · '+new Date(save.created_at).toLocaleString())),button('Create timeline from here',async()=>{S.timeline=await api(endpoint('branch'),{saveId:save.id,name:branchName.value});S.character=null;S.page='Chronicle';await render();}))));
 if(['creator','admin'].includes(S.campaign.role)){
  const comparison=$('section',{class:'card'});
  content.append($('details',{},$('summary',{},'Compare or recover individual records'),$('p',{},'Comparison and record recovery are Creator-only. Recovery creates a new audited revision; the old save and parent timeline remain intact.'),...list.map(save=>button('Compare '+save.name,async()=>{
   const diff=await api(endpoint('saves/compare')+'?saveId='+save.id);comparison.replaceChildren(renderValue(diff),button('Verify save compatibility',async()=>{comparison.append(renderValue(await api(endpoint('saves/compatibility')+'?saveId='+save.id)));}));
   for(const record of diff.changed)comparison.append(button('Restore '+record.name+' from this save',async()=>{const current=await api(endpoint('creator'));await api(endpoint('entities/restore'),{revision:current.timeline.revision,saveId:save.id,entityId:record.id});notify('Record restored as a new revision.');await saves();}));
  })),comparison));
  const upload=$('input',{type:'file',accept:'.json,application/json'});let bundle;
  const result=$('p',{role:'status'});
  const templates=await api(endpoint('templates'));
  content.append($('details',{},$('summary',{},'Reusable world templates'),...templates.map(t=>button('Start timeline from '+t.name,async()=>{const created=await api(endpoint('templates/use'),{templateId:t.id,name:t.name+' copy'});S.timeline=created;S.character=null;S.page='Chronicle';await render();}))));
  upload.addEventListener('change',()=>run(async()=>{const file=upload.files[0];if(!file)return;if(file.size>8*1024*1024)throw new Error('Import is limited to 8 MB.');bundle=JSON.parse(await file.text());const check=await api(endpoint('import'),{name:'Imported timeline',bundle,dryRun:true});result.textContent='Validated '+check.entities+' records. Import creates a separate timeline.';}));
  content.append($('details',{},$('summary',{},'Portable export, import and templates'),button('Download versioned export',async()=>{const bundle=await api(endpoint('export'));const url=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'}));const a=$('a',{href:url,download:'valor-save.json'});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}),field('Import file (validated before applying)',upload),result,button('Import as new timeline',async()=>{if(!bundle)throw new Error('Validate a file first.');const imported=await api(endpoint('import'),{name:'Imported timeline',bundle,dryRun:false});S.timeline=imported;S.character=null;await saves();}),field('Reusable template name',templateName),button('Save world template',async()=>{await api(endpoint('template'),{name:templateName.value});notify('Reusable template saved.');})));
 }
 frame(content);
}
async function settings(){
 if(!S.catalog)S.catalog=await api('/game/catalog');
 const creatorRole=['creator','admin'].includes(S.campaign.role),content=$('div',{},title('Settings.','VALOR / CAMPAIGN POLICY'));
 if(!creatorRole){content.append($('p',{},'Campaign settings are controlled by its Creator.'));frame(content);return;}
 const state=await api(endpoint('creator'));let draft=structuredClone(state.settings);
 content.append($('p',{},'Resolution rules are deliberately unset until you author them. The current resolver uses a die plus the selected attribute and skill against the authored threshold. Mature scenes are disabled by default; enabled intimacy fades to black.'));
 const schema={type:'object',properties:{needs:{type:'boolean'},fuel:{type:'boolean'},weather:{enum:['clear','rain','overcast','snow','fog']},romance:{type:'boolean'},intimacy:{enum:['off','fade-to-black']},intensity:{enum:['restrained','grounded']},difficulty:{enum:['custom','narrative']},traitBudget:{type:'number',minimum:0,maximum:1000},tokenBudget:{type:'integer',minimum:0,maximum:1000000},contextTokens:{type:'integer',minimum:256,maximum:16000},timezone:{type:'string'},npcBudget:{type:'integer',minimum:1,maximum:10000},rules:{anyOf:[{type:'object',properties:{dieSides:{type:'integer',minimum:2,maximum:1000},threshold:{type:'number',minimum:1},damage:{type:'number',minimum:0,maximum:100},treatmentMinutes:{type:'integer',minimum:1,maximum:1440},recoveryPerDay:{type:'number',minimum:0,maximum:100},unfamiliarPenalty:{type:'number',minimum:0,maximum:100},bleedPerMinute:{type:'number',minimum:0,maximum:10}}},{type:'null'}]}}};
 schema.properties.userTokenBudget={type:'integer',minimum:0,maximum:1000000};
 if(S.catalog.settings)Object.assign(schema,S.catalog.settings);
 content.append($('section',{class:'card'},schemaEditor(schema,draft,v=>draft=v),button('Save campaign settings',async()=>{await api(endpoint('settings'),{revision:state.timeline.revision,settings:draft});notify('Settings saved.');await settings();},true)));
 frame(content);
}

function universalActions(){
 const actions=S.catalog?.actions??[],select=$('select',{},...actions.map(a=>$('option',{value:a.properties.type.const},a.properties.type.const.replaceAll('-',' ')))),body=$('div',{});let draft;
 const draw=()=>{const schema=actions.find(a=>a.properties.type.const===select.value);if(!schema)return;draft=schemaDefault(schema);body.replaceChildren(schemaEditor(schema,draft,v=>draft=v));};
 select.addEventListener('change',draw);draw();
 return $('details',{},$('summary',{},'All explicit game actions'),$('p',{},'Choose the action and its targets. The server checks access, conditions, time, resources and authored rules before committing.'),field('Action',select),body,button('Commit selected action',()=>act(draft),true));
}
window.addEventListener('offline',()=>{S.online=false;notify('Connection lost. Changes are disabled until you reconnect.');if(!S.user)loginScreen();});
window.addEventListener('online',()=>{S.online=true;notify('Connection restored.');run(()=>render());});
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
try{const session=await api('/auth/session');S.user=session.user;S.csrf=session.csrfToken;await render();}catch{loginScreen();}
