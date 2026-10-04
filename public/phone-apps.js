import {skillStatus} from './creation-rules.js';
// Dedicated phone screens. Inputs come only from authorized, observer-filtered APIs.
export const nativePhonePages=new Set(['Character','Health','Inventory','Equipment','Journal / Cases','Jobs / Money','Relationships','Skills / Traits','Vehicles','Phone','Messages','Contacts','Weather','News','Map','Lore','Save / Load','Search / Loot','Settings','Mail','Photos','Social']);
export function availableContacts(view,device,selfId){
 return (view.facts??[]).filter(f=>['phone-number','phone-number-shared'].includes(f.predicate)&&f.subjectId!==selfId&&!device.contacts.some(c=>c.characterId===f.subjectId)).flatMap(f=>{
  const person=view.entities.find(e=>e.kind==='character'&&e.id===f.subjectId),number=typeof f.value==='string'?f.value:f.value?.number;
  return person&&typeof number==='string'&&number?[{id:person.id,name:person.name,number,factId:f.id}]:[];
 }).filter((row,index,rows)=>rows.findIndex(other=>other.id===row.id)===index);
}
export function messageThreads(messages,selfId,contacts=[]){
 const groups=new Map();
 for(const message of messages.filter(m=>['sms','mms'].includes(m.medium))){
  const outgoing=message.fromId===selfId,personId=outgoing?message.toId:message.fromId,number=outgoing?message.toNumber:message.fromNumber,key=personId||number||message.threadId||message.id;
  const contact=contacts.find(c=>personId?c.characterId===personId:c.number===number);
  if(!groups.has(key))groups.set(key,{id:key,personId,number,name:contact?.savedName||contact?.label||number||'Unknown sender',blocked:contact?.blocked??false,messages:[]});
  groups.get(key).messages.push(message);
 }
 return [...groups.values()].map(thread=>({...thread,messages:thread.messages.sort((a,b)=>a.at.localeCompare(b.at))})).sort((a,b)=>b.messages.at(-1).at.localeCompare(a.messages.at(-1).at));
}
export async function nativePhoneApp({$,S,api,endpoint,act,run,navigate,formatMoment,entityActions,openStyle,openDeveloperSettings,loadBranch}){
 const view=S.view,entities=view.entities,pc=entities.find(e=>e.id===S.character.id),kind=k=>entities.filter(e=>e.kind===k),name=id=>entities.find(e=>e.id===id)?.name??'Unknown',human=value=>String(value??'').replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('-',' '),root=$('section',{class:'native-app','data-native-app':S.page});
 const perform=fn=>run(async()=>{try{return await fn();}catch(error){const host=document.querySelector('.native-app')??root;let alert=host.querySelector('.phone-app-error');if(!alert){alert=$('p',{class:'phone-app-error',role:'alert'});host.prepend(alert);}alert.textContent=error.message||'That action could not be completed.';throw error;}});
 const text=(value,cls='mobile-note')=>$('p',{class:cls},value),empty=message=>$('div',{class:'mobile-empty'},text(message)),heading=value=>$('h2',{class:'mobile-section-title'},value);
 const button=(label,fn,cls='')=>$('button',{type:'button',class:'mobile-button '+cls,onclick:()=>perform(fn)},label);
 const row=(label,value,fn)=>$(fn?'button':'div',{...(fn?{type:'button',onclick:()=>perform(fn)}:{}),class:'mobile-row'},$('span',{class:'mobile-row-main'},$('strong',{},label),value!==undefined?$('small',{},value):null),fn?$('span',{'aria-hidden':'true'},'›'):null);
 const group=(...children)=>$('div',{class:'mobile-group'},...children),toolbar=(...children)=>$('div',{class:'mobile-toolbar'},...children);
 const field=(label,input)=>$('label',{class:'mobile-field'},$('span',{},label),input);
 const detail=(label,body)=>{root.replaceChildren(toolbar(button('‹ Back',()=>navigate(S.page))),heading(label),body);};
 const money=cents=>'$'+(Number(cents??0)/100).toFixed(2);
 const list=(items,draw,message)=>items.length?items.map(draw):[empty(message)];
 const records=(items,description='description')=>list(items,e=>row(e.name,e.data[description]||human(e.kind),()=>detail(e.name,$('div',{class:'mobile-detail'},text(e.data[description]||'No description recorded.','mobile-body'),group(...['status','condition','category','dueAt','position','schedule','terms'].filter(key=>typeof e.data[key]==='string').map(key=>row(human(key),e.data[key]))),toolbar(...entityActions(e))))),'Nothing recorded yet.');
 const rating=(label,value,max=100)=>$('div',{class:'mobile-rating'},row(human(label),String(value)), $('progress',{max:Math.max(max,Number(value)),value:Number(value),'aria-label':human(label)}));
 if(S.page==='Weather'){
  root.classList.add('mobile-weather');const weather=view.weather??{actual:view.settings.weather,forecast:[]},symbols={clear:'☀',rain:'☂',overcast:'☁',snow:'❄',fog:'≋'};
  root.append(text(pc?.data.originNeighborhood||'Valor','weather-city'),$('div',{class:'weather-symbol','aria-hidden':'true'},symbols[weather.actual]??'☁'),$('h2',{},human(weather.actual)),text(formatMoment(view.clock),'weather-time'),heading('Forecast'),group(...list(weather.forecast??[],f=>row(formatMoment(f.at),human(f.weather)),'No forecast has been issued.')),text('In-game weather · Pacific time. Temperature is not tracked.'));return root;
 }
 if(['Phone','Messages','Contacts','Mail','Photos','Social','News'].includes(S.page)){
  const phone=await api(endpoint('phone')+'?characterId='+encodeURIComponent(S.character.id)),devices=phone.phones;
  if(S.phoneDeviceTimeline!==S.timeline.id){S.phoneDevice=null;S.phoneThread=null;S.phoneDeviceTimeline=S.timeline.id;}
  const device=devices.find(d=>d.id===S.phoneDevice)??devices[0];
  if(!device){root.append(empty('No usable phone. Your device may be missing, locked, out of battery, or without service.'));return root;}
  if(devices.length>1){const select=$('select',{'aria-label':'Phone device'},...devices.map(d=>$('option',{value:d.id,selected:d.id===device.id},d.name)));select.onchange=()=>{S.phoneDevice=select.value;S.phoneThread=null;run(()=>navigate(S.page));};root.append(field('Device',select));}
  phone.messages=phone.messages.filter(m=>m.phoneId===device.id||m.recipientPhoneId===device.id);
  const contacts=device.apps.contacts?device.contacts:[],target=c=>c.characterId?{toId:c.characterId}:{toId:null,number:c.number};
  const tabs=()=>toolbar(...[['Phone','Calls'],['Messages','Messages'],['Contacts','Contacts']].map(([page,label])=>button(label,()=>navigate(page),page===S.page?'selected':'')));
  if(S.page==='News'){
   root.classList.add('mobile-news');root.append($('header',{class:'news-masthead'},text('THE CITY, AS YOU KNOW IT'),$('h2',{},'VALOR WIRE'),text(formatMoment(phone.clock))),heading('Latest updates'));
   root.append(...list(phone.notifications??[],n=>$('article',{class:'news-story'},text(human(n.classification),'news-category'),$('h3',{},n.text),text(formatMoment(n.at)),button('Read more',()=>navigate(n.target.kind==='message'?'Messages':'Journal / Cases'))),'No news updates have reached your character.'));
   return root;
  }
  const capability={Phone:'calls',Messages:'messages',Contacts:'contacts',Mail:'email',Photos:'photos',Social:'social'}[S.page];
  if(!device.apps[capability]){root.append(empty('This app is disabled on this device or by the world’s technology settings.'));return root;}
  if(S.page==='Contacts'){
   const search=$('input',{type:'search',placeholder:'Search contacts','aria-label':'Search contacts'}),results=group(),draw=()=>{results.replaceChildren(...list(contacts.filter(c=>(c.savedName+' '+c.number).toLowerCase().includes(search.value.toLowerCase())).sort((a,b)=>a.savedName.localeCompare(b.savedName)),c=>row((c.favorite?'★ ':'')+c.savedName,c.number,()=>detail(c.savedName,$('div',{},$('div',{class:'contact-avatar','aria-hidden':'true'},c.savedName.slice(0,1)),group(row('mobile',c.number),row('Nickname',c.alias||'—')),toolbar(...(!c.blocked?[...(device.apps.calls?[button('Call',()=>act({type:'phone-call',phoneId:device.id,...target(c)}),'call-button')]:[]),...(device.apps.messages?[button('Message',()=>{S.phoneThread={personId:c.characterId,number:c.number,name:c.savedName};return navigate('Messages');})]:[])]:[]),...(c.characterId?[button(c.favorite?'Unfavorite':'Favorite',()=>act({type:'contact-control',phoneId:device.id,contactId:c.characterId,operation:c.favorite?'unfavorite':'favorite'})),button(c.blocked?'Unblock':'Block',()=>act({type:'contact-control',phoneId:device.id,contactId:c.characterId,operation:c.blocked?'unblock':'block'})),button('Remove contact',()=>{if(window.confirm('Remove '+c.savedName+' from this phone?'))return act({type:'contact-control',phoneId:device.id,contactId:c.characterId,operation:'delete'});})]:[]))))),'No matching contacts.'));};search.oninput=draw;
   const add=()=>{const known=availableContacts(view,device,S.character.id),person=$('select',{'aria-label':'Known phone number'},$('option',{value:''},'Choose someone'),...known.map(c=>$('option',{value:c.id},c.name+' · '+c.number))),savedName=$('input',{maxlength:160,placeholder:'Contact name'}),alias=$('input',{maxlength:1000,placeholder:'Optional nickname'});
    person.onchange=()=>{savedName.value=known.find(c=>c.id===person.value)?.name??'';};
    detail('New contact',$('form',{class:'mobile-form',onsubmit:e=>{e.preventDefault();perform(async()=>{const selected=known.find(c=>c.id===person.value);if(!selected||!savedName.value.trim())throw new Error('Choose a known number and enter a name.');await act({type:'add-contact',phoneId:device.id,contactId:selected.id,label:savedName.value.trim(),alias:alias.value,factId:selected.factId});});}},text('Save numbers your character has learned or exchanged. Ask someone for their number in the story first.'),field('Person',person),field('Save as',savedName),field('Nickname',alias),known.length?$('button',{type:'submit',class:'mobile-button'},'Save contact'):empty('You have not learned any new phone numbers yet.')));
   };
   root.append(tabs(),toolbar(search,button('+',add,'add-contact')),results);draw();return root;
  }
  if(S.page==='Messages'){
   const threads=messageThreads(phone.messages,S.character.id,contacts),drawThread=thread=>{
    S.phoneThread={personId:thread.personId,number:thread.number,name:thread.name};
    const bubbles=$('div',{class:'message-conversation','aria-label':'Conversation with '+thread.name});
    for(const m of thread.messages??[]){
     const options=$('details',{class:'sms-options'},$('summary',{},'Options'));
     if(m.toId===S.character.id&&['received','delivered'].includes(m.status))options.append(button('Mark read',()=>act({type:'read-message',phoneId:device.id,messageId:m.id})));
     options.append(button('Delete message',()=>{if(window.confirm('Delete this message from your view?'))return act({type:'delete-message',phoneId:device.id,messageId:m.id,operation:'delete'});}));
     bubbles.append($('article',{class:'sms '+(m.fromId===S.character.id?'outgoing':'incoming')},text(m.body,'sms-body'),$('small',{},formatMoment(m.at)+' · '+human(m.status)),m.failureReason?text(human(m.failureReason)):null,options));
    }
    if(!thread.messages?.length)bubbles.append(empty('No messages yet.'));
    const compose=$('textarea',{rows:2,maxlength:160,placeholder:'Text message','aria-label':'Text message'}),form=$('form',{class:'sms-compose',onsubmit:e=>{e.preventDefault();if(!compose.value.trim())return;perform(()=>act({type:'message',phoneId:device.id,toId:thread.personId??null,...(!thread.personId?{number:thread.number}:{}),medium:'sms',text:compose.value}));}},compose,$('button',{type:'submit'},'Send'));
    root.replaceChildren(toolbar(button('‹ Messages',()=>{S.phoneThread=null;return navigate('Messages');}),$('strong',{},thread.name)),bubbles,thread.blocked?empty('This contact is blocked. Unblock them in Contacts to reply.'):form);
   };
   root.append(tabs(),heading('Messages'),button('New message',()=>{const recipients=contacts.filter(c=>!c.blocked);detail('New message',group(...list(recipients,c=>row(c.savedName,c.number,()=>drawThread({personId:c.characterId,number:c.number,name:c.savedName,messages:[]})),'Add a contact before starting a conversation.')));}),group(...list(threads,t=>row(t.name,t.messages.at(-1).body,()=>drawThread(t)),'No conversations yet.')));
   if(S.phoneThread){const selected=threads.find(t=>t.personId? t.personId===S.phoneThread.personId:t.number===S.phoneThread.number);drawThread(selected??{...S.phoneThread,messages:[]});}return root;
  }
  if(S.page==='Phone'){
   for(const call of phone.messages.filter(m=>m.medium==='call'&&['ringing','active'].includes(m.callState))){
    const incoming=call.toId===S.character.id,controls=toolbar(),caller=contacts.find(c=>c.characterId===(incoming?call.fromId:call.toId));
    if(call.callState==='ringing'&&incoming)controls.append(button('Answer',()=>act({type:'call-response',messageId:call.id,phoneId:device.id,response:'answer'}),'call-button'),button('Decline',()=>act({type:'call-response',messageId:call.id,phoneId:device.id,response:'decline'})));
    else controls.append(button('End call',()=>act({type:'call-response',messageId:call.id,phoneId:device.id,response:'end'})));
    const speech=$('textarea',{maxlength:1000,'aria-label':'Say on this call',placeholder:'Say something…'});
    root.append(group(heading(call.callState==='active'?'Call in progress':incoming?'Incoming call':'Calling…'),row(caller?.savedName||(incoming?call.fromNumber:call.toNumber)||'Unknown caller',human(call.callState)),controls,...(call.callState==='active'?[field('Say on this call',speech),button('Speak',()=>act({type:'call-speak',messageId:call.id,phoneId:device.id,text:speech.value}))]:[])));
   }
   const number=$('input',{type:'tel',maxlength:40,'aria-label':'Phone number',placeholder:'Enter number',class:'dial-number'}),pad=$('div',{class:'dial-pad'});
   for(const digit of ['1','2 ABC','3 DEF','4 GHI','5 JKL','6 MNO','7 PQRS','8 TUV','9 WXYZ','*','0 +','#'])pad.append(button(digit,()=>{number.value=(number.value+digit[0]).slice(0,40);}));
   root.append(tabs(),number,pad,toolbar(button('⌫',()=>{number.value=number.value.slice(0,-1);}),button('Call',()=>act({type:'phone-call',phoneId:device.id,toId:null,number:number.value}),'call-button')),heading('Recent calls'),group(...list(phone.messages.filter(m=>m.medium==='call').slice().reverse(),m=>row((m.fromId===S.character.id?'Outgoing':'Incoming')+' · '+(m.toNumber||m.fromNumber||'Unknown number'),formatMoment(m.at)+' · '+human(m.callState??m.status),()=>detail('Call details',$('div',{},text(m.body||human(m.callState??m.status)),...(device.apps.voicemail&&m.fromId===S.character.id&&['missed','declined','ended'].includes(m.callState)?[(()=>{const note=$('textarea',{maxlength:1000,'aria-label':'Voicemail'});return group(field('Voicemail',note),button('Leave voicemail',()=>act({type:'leave-voicemail',phoneId:device.id,callId:m.id,text:note.value})));})()]:[])))),'No recent calls.')));
   if(device.apps.voicemail)root.append(heading('Voicemail'),group(...list(phone.messages.filter(m=>m.medium==='voicemail'),m=>row(m.body,formatMoment(m.at),()=>act({type:'read-message',phoneId:device.id,messageId:m.id})),'No voicemail.')));return root;
  }
  if(S.page==='Mail'){root.append(heading('Inbox'),group(...list(phone.messages.filter(m=>m.medium==='email').slice().reverse(),m=>row(m.name,m.body.slice(0,70),()=>detail(m.name,$('div',{},text(formatMoment(m.at)),text(m.body,'mobile-body')))),'Your inbox is empty.')));return root;}
  if(S.page==='Photos'){root.append(heading('Camera roll'),$('div',{class:'photo-roll'},...list(device.photoIds??[],id=>{const asset=entities.find(e=>e.kind==='media'&&e.id===id);return asset?$('img',{src:endpoint('media')+'/'+id+'?characterId='+S.character.id,alt:asset.data.alt||asset.name,loading:'lazy'}):null;},'No photos saved.')));return root;}
  root.append(heading('Friends feed'),...list(phone.socialFeed,p=>$('article',{class:'mobile-post'},$('strong',{},p.name),text(p.platform+' · '+formatMoment(p.at)),text(p.body,'mobile-body')),'No visible posts yet.'));return root;
 }
 if(S.page==='Character'){
  root.append($('header',{class:'mobile-profile'},$('div',{class:'contact-avatar','aria-hidden':'true'},pc.name.slice(0,1)),$('h2',{},pc.name),text(pc.data.occupations?.map(job=>job.position).filter(Boolean).join(', ')||pc.data.employerOccupation||pc.data.originNeighborhood||'Valor resident')),group(...[['Age',pc.data.ageYears??pc.data.age],['Height',pc.data.heightCm?Math.floor(Math.round(pc.data.heightCm/2.54)/12)+'′ '+Math.round(pc.data.heightCm/2.54)%12+'″':null],['Build',pc.data.build],['Home',pc.data.residence?pc.data.residence.name+' · '+pc.data.residence.apartment:null]].filter(([,v])=>v!=null&&v!=='').map(([k,v])=>row(k,String(v)))),heading('About me'),text(pc.data.description||pc.data.backstory||'Your story is just beginning.','mobile-body'),heading('Attributes'),group(...Object.entries(pc.data.attributes??{}).map(([key,value])=>rating(key,value))));return root;
 }
 if(S.page==='Health'){
  root.classList.add('mobile-health');root.append($('div',{class:'health-summary'},$('span',{'aria-hidden':'true'},'♥'),$('h2',{},human(pc.data.condition||'No known condition'))),heading('How you feel'));
  const summary=pc.data.healthSummary??{},needs=pc.data.needsSummary??{};
  root.append(group(...Object.entries(summary).filter(([,v])=>typeof v==='string'||typeof v==='number').map(([k,v])=>row(human(k),String(v)))));
  if(view.settings.needs)root.append(group(...Object.entries(needs).filter(([,v])=>typeof v==='string'||typeof v==='number').map(([k,v])=>row(human(k),String(v)))));
  root.append(heading('Known conditions'),group(...records(kind('injury'))));return root;
 }
 if(['Inventory','Equipment'].includes(S.page)){
  const inventory=await api(endpoint('inventory')+'?characterId='+encodeURIComponent(S.character.id)+(S.page==='Equipment'?'&equipped=true':'')),search=$('input',{type:'search',placeholder:'Find an item','aria-label':'Find an item'}),items=group();
  const draw=()=>items.replaceChildren(...list(inventory.items.filter(i=>i.name.toLowerCase().includes(search.value.toLowerCase())),i=>row(i.name,'×'+i.quantity+' · '+human(i.category)+(i.equipped?' · equipped':''),()=>detail(i.name,$('div',{},text(i.description||'No description.','mobile-body'),group(row('Condition',i.condition+'%'),row('Quantity',String(i.quantity)),row('Carried',human(i.wearState))),toolbar(button('Examine',()=>act({type:'examine-item',itemId:i.id})),...entityActions(entities.find(e=>e.id===i.id)??{id:i.id,kind:'item',data:{...i,possessorId:S.character.id}})),$('details',{class:'mobile-group'},$('summary',{},'Manage item'),...(['clothing','jewelry','armor'].includes(i.category)?[button(i.wearState==='worn'?'Remove':'Wear',()=>act({type:'wear-item',itemId:i.id,worn:i.wearState!=='worn'}))]:[]),...(i.stackability?.mode==='stackable'&&i.quantity>1?[(()=>{const amount=$('input',{type:'number',min:1,max:i.quantity-1,value:1,'aria-label':'Split quantity'});return group(amount,button('Split stack',()=>act({type:'split-stack',itemId:i.id,quantity:Number(amount.value)})));})()]:[]),(()=>{const people=entities.filter(e=>e.kind==='character'&&e.id!==pc.id&&e.data.locationId===pc.data.locationId),recipient=$('select',{'aria-label':'Give item to'},...people.map(e=>$('option',{value:e.id},e.name)));return people.length?group(recipient,button('Give item',()=>act({type:'transfer-item',itemId:i.id,toId:recipient.value,quantity:i.quantity,transferOwnership:true}))):null;})(),button('Discard',()=>{if(window.confirm('Discard '+i.name+'?'))return act({type:'discard-item',itemId:i.id,quantity:i.quantity});}))))),'No matching items.'));
  search.oninput=draw;root.append(toolbar(search),items);draw();return root;
 }
 if(S.page==='Journal / Cases'){
  root.classList.add('mobile-journal');root.append(heading('Notebook'),...list(view.journal??[],e=>$('details',{class:'journal-entry'},$('summary',{},e.name),text(e.premise,'mobile-body'),text(e.status),...e.objectives.map(o=>row(o.title,o.status)),...e.entries.map(n=>text(n.text,'mobile-body'))),'No journal entries yet.'),heading('Case files'),...list(view.caseFiles??[],e=>$('details',{class:'journal-entry'},$('summary',{},e.name),...['proven','discovered','suspected','rumored'].map(key=>group(heading(human(key)),...(e[key]??[]).map(n=>text(n.text,'mobile-body'))))),'No open case files.'),heading('Memories'),...(view.memories??[]).slice(-20).map(m=>text(m.text,'mobile-body')),heading('Beliefs'),...(view.beliefs??[]).map(b=>text(b.proposition,'mobile-body')));return root;
 }
 if(S.page==='Map'){
  const current=entities.find(e=>e.id===pc.data.locationId),exits=new Set((current?.data.exits??[]).map(e=>e.to));root.classList.add('mobile-map');
  root.append($('div',{class:'phone-map-canvas'},$('figure',{class:'phone-map-image'},$('img',{src:'/city-map.png',alt:'Map of Valor',width:960,height:1280}))),group(row('You are here',current?.name??'Unknown location')),heading('Directions'),group(...list(kind('location').filter(e=>exits.has(e.id)),e=>row(e.name,'Walk from your current location',()=>act({type:'travel',destinationId:e.id,mode:'walk',vehicleId:null})),'No known walking exits.')),heading('Known places'),group(...records(kind('location'))));return root;
 }
 if(S.page==='Jobs / Money'){
  root.append($('header',{class:'wallet-balance'},text('CASH ON HAND'),$('h2',{},money(pc.data.cash))),heading('Accounts'),group(...kind('account').map(e=>row(e.name,money(e.data.balanceCents)))),heading('Work'),group(...records(kind('job'))),heading('Bills & rent'),group(...records([...kind('bill'),...kind('housing')])),heading('Receipts'),group(...records(kind('receipt'))));return root;
 }
 if(S.page==='Skills / Traits'){
  const trained=kind('skill').filter(e=>Object.hasOwn(pc.data.skills??{},e.id)&&skillStatus(e,pc.data.skills[e.id]).trained);
  root.append(heading('Active skill statuses'),group(...list(trained,e=>text(e.name+' · Trained: +2 on checks using this skill.'+(e.name==='Athletics'?' Ordinary fatigue builds 15% slower when needs are enabled.':'')),'No trained skill statuses yet.')));
  root.append(heading('My skills'),group(...Object.entries(pc.data.skills??{}).map(([id,value])=>row(name(id),String(value),()=>detail(name(id),$('div',{},text(entities.find(e=>e.id===id)?.data.description||'An acquired skill.','mobile-body'),rating(name(id),value)))))),heading('My traits'),group(...records(kind('trait').filter(e=>(pc.data.traits??[]).includes(e.id)))));return root;
 }
 if(S.page==='Relationships'){
  const social=await api(endpoint('relationships')+'?characterId='+encodeURIComponent(S.character.id));
  const filters=social.contentRules?.filters;
  if(filters){
   const romance=$('input',{type:'checkbox',checked:filters.romance==='enabled'}),initiative=$('input',{type:'checkbox',checked:filters.allowNpcInitiative}),mature=$('select',{},...['campaign','off','implicit','fade-to-black','allowed-description'].map(value=>$('option',{value,selected:value===filters.matureContent},human(value)))),blocked=$('select',{multiple:true,size:4},...['flirt','date','confess','commit','exclusive','cohabit','marry','reconcile','intimacy','confront-jealousy'].map(value=>$('option',{value,selected:filters.blockedIntents.includes(value)},human(value))));
   root.append($('details',{class:'mobile-group'},$('summary',{},'Relationship preferences'),text('Your boundaries carry no relationship penalty.'),field('Allow romance',romance),field('Allow NPC initiative',initiative),field('Scene boundary',mature),field('Blocked advances',blocked),button('Save preferences',()=>act({type:'content-filter',romance:romance.checked?'enabled':'off',matureContent:mature.value,blockedIntents:[...blocked.selectedOptions].map(option=>option.value),allowNpcInitiative:initiative.checked}))));
  }
  root.append(heading('People in your life'),group(...list(social.relationships,r=>row(r.other.name,r.labels.map(l=>l.label).join(' · ')||'No known label',()=>detail(r.other.name,$('div',{},text(r.direction),...r.history.slice(-20).map(h=>text(formatMoment(h.at)+' · '+h.reason)),...(r.consentRequests??[]).filter(q=>q.status==='pending').map(q=>group(text(q.intent+' · '+q.direction),...(q.direction==='incoming'?[button('Accept',()=>act({type:'social',targetId:r.other.id,intent:q.intent,response:'accept',consentRequestId:q.id,consent:true})),button('Decline',()=>act({type:'social',targetId:r.other.id,intent:q.intent,response:'decline',consentRequestId:q.id,consent:false}))]:[button('Withdraw',()=>act({type:'social',targetId:r.other.id,intent:q.intent,response:'withdraw',consentRequestId:q.id,consent:false}))])))))),'You have not formed any known relationships yet.')),heading('Favors & debts'),group(...social.obligations.map(o=>row(human(o.kind),o.terms))),heading('Reputation'),group(...social.reputations.map(r=>row(r.audience.label,String(r.score)))),button('Exit romantic scene safely',()=>act({type:'safety-exit',targetId:null})));return root;
 }
 if(S.page==='Search / Loot'){
  root.append(heading('Nearby'),button('Search this place',()=>act({type:'search',method:'visual',minutes:5,acceptRisk:false})),group(...records(kind('item').filter(e=>e.data.locationId===pc.data.locationId))));return root;
 }
 if(S.page==='Vehicles'){root.append(heading('Garage & transport'),group(...records([...kind('vehicle'),...kind('transportService')])));return root;}
 if(S.page==='Lore'){root.append(heading('City guide'),group(...records([...kind('lore'),...kind('storycard')])));return root;}
 if(S.page==='Save / Load'){
  const saves=await api(endpoint('saves')),saveName=$('input',{value:'Checkpoint',maxlength:160,'aria-label':'Checkpoint name'});root.append(heading('Checkpoints'),group(field('Name',saveName),button('Save now',async()=>{await api(endpoint('saves'),{name:saveName.value});await navigate('Save / Load');})),text('Loading a checkpoint creates a separate branch. Your current story remains saved.'),group(...list(saves,s=>row(s.name,formatMoment(s.created_at),async()=>{if(window.confirm('Continue from '+s.name+' in a separate branch?'))await loadBranch(await api(endpoint('branch'),{saveId:s.id,name:s.name+' · continued'}));}),'No checkpoints yet.')));return root;
 }
 if(S.page==='Settings'){
  const narrator=$('select',{'aria-label':'Story narrator'},...(S.catalog?.providers??['grounded']).map(id=>$('option',{value:id,selected:id===S.narrator},id==='grounded'?'Grounded (no AI)':id==='deepinfra'?'DeepSeek via DeepInfra':'Gemini')));
  narrator.onchange=()=>{S.narrator=narrator.value;try{localStorage.setItem('valor.narrator.'+S.user.id,S.narrator);}catch{}};
  root.append(heading('Personal settings'),group(field('Story narrator',narrator),row('Appearance','Colors, backgrounds & animation',openStyle)),text('These settings belong to this device and account.'),heading('Current life'),group(row('Life',S.campaign.name),row('Timeline',S.timeline.name)),button('Manage this life’s settings',openDeveloperSettings),text('Opens the settings for this life, not the shared authoring world. Developer permission is required for world rules.'));return root;
 }
 root.append(empty('This app has no information yet.'));return root;
}
