// The play surface uses only observer-filtered state supplied by app.js.
export function chronicleSurface({$,button,S,formatMoment,draft,saveDraft,submit,rebuild,openRoster,loadDeathBranch}){
 const view=S.view,pc=view.entities.find(e=>e.id===S.character.id),location=view.entities.find(e=>e.id===pc?.data.locationId);
 const root=$('section',{class:'story-strip','aria-label':'Chronicle transcript'},$('div',{class:'story-heading'},$('h1',{},'Chronicle'),$('span',{},location?.name??'Valor'),$('time',{datetime:view.clock},formatMoment(view.clock))));
 const transcript=$('div',{class:'story-text'});
 for(const [index,turn] of view.turns.entries()){
  const text=$('div',{class:'prose turn-narrative'},turn.narration),status=$('p',{class:'turn-status',role:'status'}),retry=$('button',{type:'button'},'Rebuild narration without rerolling'),cancel=$('button',{type:'button',hidden:true},'Cancel rebuild');
  retry.addEventListener('click',()=>rebuild(turn,text,{value:S.narrator},retry,cancel,status));cancel.addEventListener('click',()=>S.streamController?.abort());
  const tools=$('details',{class:'story-tools'},$('summary',{},'Story tools'),$('div',{class:'turn-controls'},retry,cancel));
  if(turn.notices?.length)tools.append($('ul',{},...turn.notices.map(n=>$('li',{},n.label+': '+n.detail))));
  const input=turn.input_text&&!['start.character','look','story','wait','say'].includes(turn.input_text)?$('p',{class:'story-input'},turn.input_text):null;
  transcript.append($('article',{class:'turn','aria-label':'Story turn '+(index+1)},input,text,tools,status));
 }
 if(!view.turns.length)transcript.append($('p',{class:'story-empty'},'A new life waited in Valor. Write what happened next.'));
 root.append(transcript);
 const encounter=view.entities.find(e=>e.kind==='combat'&&e.data.active===true&&(e.data.participants??[]).includes(S.character.id));
 if(encounter)root.append($('section',{class:'story-combat','aria-label':'Active encounter'},$('h2',{},'In combat'),$('p',{},'Describe the next move in the story below.'),...((encounter.data.participants??[]).map(id=>{const person=view.entities.find(e=>e.id===id);return person?$('div',{class:'combat-person'},$('strong',{},person.name),$('span',{},person.data.condition??'Present')):null;}))));
 if(pc?.data.condition==='dead'){root.append($('p',{},'This life has ended. Its story and possessions remain in the city record.'),...(S.deathTransition?.branchId?[button('Load protected pre-death branch',loadDeathBranch)]:[]),button('Return to life roster',openRoster));return root;}
 const composer=$('textarea',{id:'chronicle-action',maxlength:1000,rows:3,placeholder:'Continue the story… actions, dialogue, anything that happened next.','aria-describedby':'story-help'});
 composer.value=draft();composer.addEventListener('input',()=>saveDraft(composer.value));
 const status=$('p',{class:'composer-status',role:'status','aria-live':'polite'}),send=$('button',{type:'submit',class:'primary',disabled:!S.online},'Continue ↗');
 const form=$('form',{class:'composer story-composer',onsubmit:async e=>{
  e.preventDefault();if(S.busy||S.openingBusy||send.disabled||!composer.value.trim())return;
  send.disabled=true;status.textContent='Continuing the story…';
  try{await submit(composer.value,status);}finally{if(send.isConnected)send.disabled=!S.online;}
 }},$('label',{for:'chronicle-action',class:'sr-only'},'Continue the story'),composer,$('div',{class:'story-compose-footer'},$('small',{id:'story-help'},'Enter to continue · Shift + Enter for a new line'),send),status);
 composer.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();form.requestSubmit();}});
 root.append(form);return root;
}
export const phoneApps=[
 ['Character','My character','person'],['Health','Health','heart'],['Inventory','Inventory','bag'],['Journal / Cases','Journal','journal'],
 ['Jobs / Money','Jobs & money','jobs'],['Relationships','People','people'],['Skills / Traits','Skills & traits','star'],['Vehicles','Vehicles','car'],
 ['Phone','Calls & messages','phone'],['Map','Map','map'],['Lore','City guide','city'],['Save / Load','Save / load','save'],
 ['Equipment','Equipment','bag'],['Search / Loot','Nearby items','map'],['Settings','Settings','jobs']
];
const glyphs={
 person:'<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
 heart:'<path d="M20 5c-3-3-7-1-8 1-2-3-6-4-9-1-5 5 4 12 9 16 5-4 13-11 8-16Z"/>',
 bag:'<rect x="4" y="7" width="16" height="15" rx="2"/><path d="M8 8V6a4 4 0 0 1 8 0v2M8 13h8"/>',
 journal:'<path d="M5 2h14v20H5zM8 2v20M11 7h5M11 11h5M11 15h4"/>',
 jobs:'<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M8 7V3h8v4M2 12l10 4 10-4"/>',
 people:'<circle cx="8" cy="8" r="4"/><path d="M1 22v-2a7 7 0 0 1 14 0v2M17 4a4 4 0 0 1 0 8M19 15c3 1 3 3 3 7"/>',
 star:'<path d="m12 2 3 7h8l-6 5 2 8-7-5-7 5 2-8-6-5h8Z"/>',
 car:'<path d="m4 8 2-5h12l2 5M2 8h20v11H2zM5 19v3M19 19v3M5 12h2M17 12h2"/>',
 phone:'<rect x="6" y="1" width="12" height="22" rx="3"/><path d="M10 4h4M11 20h2"/>',
 map:'<path d="m2 5 6-3 8 3 6-3v17l-6 3-8-3-6 3ZM8 2v17M16 5v17"/>',
 city:'<path d="M2 22V8h6V2h8v10h6v10ZM11 5h2M11 9h2M5 12v2M18 16v2"/>',
 save:'<path d="M3 2h15l3 3v17H3zM7 2v7h10V2M7 22V13h10v9"/>'
};
function icon($,name){const span=$('span',{'aria-hidden':'true'});span.innerHTML='<svg viewBox="0 0 24 24" class="pocket-icon">'+glyphs[name]+'</svg>';return span;}
export function phoneLauncher($,open){return $('button',{type:'button',class:'pocket-launcher','aria-label':'Open phone',title:'Open phone','aria-haspopup':'dialog',onclick:open},icon($,'phone'));}
export function phoneOverlay({$,S,content,navigate,close}){
 const home=S.page==='Phone Home',screen=$('div',{class:'pocket-screen'}),dialog=$('dialog',{class:'pocket-dialog','aria-label':'Your phone'});
 const homeScreen=$('section',{class:'pocket-home','aria-label':'Phone home screen'},$('p',{class:'pocket-date'},new Date(S.view.clock).toLocaleDateString('en-US',{timeZone:S.campaign?.timezone??'America/Los_Angeles',weekday:'long',month:'long',day:'numeric',year:'numeric'})));
 const grid=$('div',{class:'pocket-grid'});
 for(const [page,label,glyph] of phoneApps)grid.append($('button',{type:'button',class:'pocket-app','data-pocket-app':page,onclick:()=>navigate(page)},$('span',{class:'pocket-app-icon pocket-'+glyph},icon($,glyph)),$('span',{},label)));
 homeScreen.append(grid);
 screen.append($('div',{class:'pocket-status'},$('span',{},'VALOR'),$('span',{},new Date(S.view.clock).toLocaleTimeString('en-US',{timeZone:S.campaign?.timezone??'America/Los_Angeles',hour:'numeric',minute:'2-digit'})),$('span',{},'▰')));
 if(home)screen.append(homeScreen);
 else screen.append($('div',{class:'pocket-nav'},$('button',{type:'button',onclick:()=>navigate('Phone Home')},'‹ Home'),$('strong',{},phoneApps.find(a=>a[0]===S.page)?.[1]??S.page)),$('div',{class:'pocket-content',tabindex:'0','aria-label':S.page},content));
 dialog.append($('div',{class:'pocket-caption'},$('span',{},'YOUR LIFE, IN YOUR POCKET'),$('button',{type:'button',onclick:close},'Put away ↘')),$('div',{class:'pocket-hardware'},$('div',{class:'pocket-speaker','aria-hidden':'true'}),screen,$('button',{type:'button',class:'pocket-home-button','aria-label':'Phone home',onclick:()=>navigate('Phone Home')},$('span',{}))));
 dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 return dialog;
}
