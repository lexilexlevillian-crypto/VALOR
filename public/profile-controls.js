import {HEIGHTS,BUILDS,EYE_COLORS,SKIN_COLORS,ETHNICITIES,APPEARANCE_TRAITS,NEIGHBORHOODS,automaticTraitNames,syncAppearanceTraits,residencePlan,playerFloors,apartmentNumber} from './profile-rules.js';
import {stockTrait} from './creation-rules.js';
import {changeSelection} from './creation-pools.js';
const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
function labeled(label,control,help=''){
 const root=el('div','','field'),id='profile-'+crypto.randomUUID(),caption=el('label',label);control.id=id;caption.htmlFor=id;root.append(caption,control);
 if(help){const note=el('p',help,'sheet-guidance');note.id=id+'-help';control.setAttribute('aria-describedby',note.id);root.append(note);}return root;
}
function options(select,rows,value,empty='Choose…'){
 select.replaceChildren();for(const row of [{value:'',label:empty},...rows]){const option=el('option',row.label);option.value=row.value;select.append(option);}
 if(value&&!rows.some(row=>row.value===value)){const saved=el('option',value+' (saved)');saved.value=value;select.append(saved);}
 select.value=value??'';
}
export function profileControls(character,entities,onchange,settings={},lookup=async path=>{const response=await fetch(path);if(!response.ok)throw new Error('Lookup unavailable');return response.json();}){
 const appearance=el('div','','field-grid'),identity=el('div','','field-grid'),residence=el('section','','residence-picker'),automatic=el('div','','automatic-traits');automatic.setAttribute('aria-live','polite');
 const update=mutate=>{changeSelection(character,entities,()=>{mutate();syncAppearanceTraits(character,entities);},onchange);showAutomatic();};
 const showAutomatic=()=>{
  automatic.replaceChildren(el('strong','Traits from height & build'));
  const names=automaticTraitNames(character);
  for(const name of names){const trait=entities.find(e=>e.kind==='trait'&&e.name===name&&!e.archived),cost=trait?.data.mode==='costed'?trait.data.cost:stockTrait(name)?.cost??0;automatic.append(el('p',name+' · '+(cost>0?'costs '+cost+' trait points':cost<0?'refunds '+(-cost)+' trait points':'no point cost')));}
  automatic.append(el('p',names.length?'Change height or build to change these traits. NPCs do not pay points.':'No automatic traits. Below 5′ 5″ gives Short; above 5′ 11″ gives Tall.','sheet-guidance'));
 };
 const selectField=(key,label,choices,help='')=>{
  const select=el('select');options(select,choices.map(value=>({value,label:value})),character[key]??'','Not specified');
  const custom=el('input');custom.type='text';custom.maxLength=160;custom.placeholder='Describe in your own words';custom.hidden=true;
  select.addEventListener('change',()=>{custom.hidden=!/self-described|self-describe|Mixed \/ multiple/.test(select.value);update(()=>{character[key]=select.value;if(key==='build'&&!select.value)character.traits=(character.traits??[]).filter(id=>!entities.some(e=>e.id===id&&APPEARANCE_TRAITS.includes(e.name)&&!['Short','Tall'].includes(e.name)));});});
  custom.addEventListener('input',()=>update(()=>{character[key]=custom.value;}));
  const holder=labeled(label,select,help);custom.setAttribute('aria-label',label+' · your description');holder.append(custom);return holder;
 };
 const height=el('select');options(height,HEIGHTS.map(row=>({value:String(row.cm),label:row.label})),character.heightCm==null?'':String(character.heightCm),'Not specified');
 height.addEventListener('change',()=>update(()=>{character.heightCm=height.value?Number(height.value):null;if(!height.value)character.traits=(character.traits??[]).filter(id=>!entities.some(e=>e.id===id&&['Short','Tall'].includes(e.name)));}));
 appearance.append(labeled('Height (feet & inches)',height,'4′ 3″–8′ 0″. Short below 5′ 5″; Tall above 5′ 11″.'),
 selectField('build','Body build',BUILDS.map(row=>row.name),'Some builds add the matching trait automatically.'),
 selectField('eyes','Eye color',EYE_COLORS),selectField('complexion','Skin color',SKIN_COLORS),automatic);
 identity.append(selectField('ethnicityContext','Ethnicity',ETHNICITIES,'Self-described identity only; no stat effects. Choose Mixed / multiple or Other to write any identity not listed.'));
 const nationality=el('select');options(nationality,[],character.nationality??'','Loading countries…');nationality.addEventListener('change',()=>update(()=>{character.nationality=nationality.value;}));
 const nationalityField=labeled('Nationality',nationality,'Countries and territories, plus dual nationality or self-description.');const nationalityCustom=el('input');nationalityCustom.type='text';nationalityCustom.maxLength=160;nationalityCustom.hidden=true;nationalityCustom.setAttribute('aria-label','Nationality · your description');nationalityField.append(nationalityCustom);
 nationality.addEventListener('change',()=>{nationalityCustom.hidden=!['Dual / multiple nationalities','Other / self-described','Stateless'].includes(nationality.value);});nationalityCustom.addEventListener('input',()=>update(()=>{character.nationality=nationalityCustom.value;}));identity.append(nationalityField);
 const birthMode=el('select'),birthDetails=el('div','','field-grid'),birthCountry=el('select'),birthState=el('select'),birthCity=el('select'),search=el('input'),customBirth=el('input'),birthNotice=el('p','','sheet-guidance');
 options(birthMode,[{value:'Valor, Washington, United States',label:'Valor, Washington, United States'},{value:'lookup',label:'Elsewhere — choose country, region and city'},{value:'custom',label:'Other / custom birthplace'}],character.birthplace??'','Not specified');
 customBirth.type='text';customBirth.maxLength=160;customBirth.hidden=true;customBirth.value=character.birthplace??'';customBirth.setAttribute('aria-label','Place of birth · your description');customBirth.addEventListener('input',()=>update(()=>{character.birthplace=customBirth.value;for(const key of ['birthCountryCode','birthStateCode','birthCityCode','birthLatitude','birthLongitude'])delete character.identity?.[key];}));
 search.type='search';search.placeholder='Search cities in the selected region';birthDetails.hidden=true;
 birthDetails.append(labeled('Birth country',birthCountry),labeled('Birth region / state',birthState),labeled('Find birth city',search),labeled('Birth city / town',birthCity),birthNotice);
 const birthField=labeled('Place of birth',birthMode,'Internal country / region / city directory. Use Other for small towns, historical names or places missing from the directory.');birthField.append(birthDetails,customBirth);const credit=el('a','Place directory: Countries States Cities Database (ODbL 1.0)');credit.href='https://github.com/dr5hn/countries-states-cities-database';credit.target='_blank';credit.rel='noopener';birthField.append(credit);identity.append(birthField);
 birthCountry.disabled=birthState.disabled=birthCity.disabled=search.disabled=true;
 birthMode.addEventListener('change',()=>{birthCountry.disabled=birthState.disabled=birthCity.disabled=search.disabled=birthMode.value!=='lookup';birthCountry.required=birthState.required=birthCity.required=birthMode.value==='lookup';birthDetails.hidden=birthMode.value!=='lookup';customBirth.hidden=birthMode.value!=='custom';if(!['lookup','custom'].includes(birthMode.value))update(()=>{character.birthplace=birthMode.value;for(const key of ['birthCountryCode','birthStateCode','birthCityCode','birthLatitude','birthLongitude'])delete character.identity?.[key];});});
 let countries=[],states=[],cities=[],request=0,timer;
 const countryName=()=>countries.find(row=>row.code===birthCountry.value)?.name??'';
 const loadCities=async()=>{const serial=++request;options(birthCity,[],'','Loading…');if(!birthState.value)return;try{const result=await lookup('/game/geography?country='+encodeURIComponent(birthCountry.value)+'&state='+encodeURIComponent(birthState.value)+'&q='+encodeURIComponent(search.value));if(serial!==request)return;cities=result.cities;options(birthCity,cities.map(row=>({value:row.id,label:row.name})),'','Choose a city');birthNotice.textContent=result.more?'Showing the first 200 matches. Type a city name to narrow the list.':'Missing a place? Choose Other / custom birthplace above.';}catch{if(serial===request)birthNotice.textContent='City lookup unavailable. You can use Other / custom birthplace.';}};
 birthCountry.addEventListener('change',async()=>{const serial=++request;options(birthState,[],'','Loading…');options(birthCity,[],'','Choose a region first');try{const result=await lookup('/game/geography?country='+encodeURIComponent(birthCountry.value));if(serial!==request)return;states=result.states;options(birthState,states.map(row=>({value:row.code,label:row.name})),'','Choose a region');}catch{birthNotice.textContent='Region lookup unavailable. Use a custom birthplace.';}});
 birthState.addEventListener('change',loadCities);search.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(loadCities,180);});
 birthCity.addEventListener('change',()=>{const city=cities.find(row=>row.id===birthCity.value);if(!city)return;update(()=>{character.birthplace=[city.name,states.find(row=>row.code===birthState.value)?.name,countryName()].filter(Boolean).join(', ').slice(0,160);character.identity={...character.identity,birthCountryCode:birthCountry.value,birthStateCode:birthState.value,birthCityCode:city.id,birthLatitude:String(city.latitude),birthLongitude:String(city.longitude)};});});
 lookup('/game/geography').then(result=>{countries=result.countries;options(nationality,[...countries.map(row=>({value:(row.nationality||row.name)+' ('+row.name+')',label:(row.nationality||row.name)+' ('+row.name+')'})),...['Dual / multiple nationalities','Stateless','Other / self-described'].map(value=>({value,label:value}))],character.nationality??'','Not specified');options(birthCountry,countries.map(row=>({value:row.code,label:row.name})),'','Choose a country');}).catch(()=>{nationalityField.append(el('p','Country lookup unavailable. Use your description below.'));nationalityCustom.hidden=false;});
 const neighborhood=el('select');options(neighborhood,NEIGHBORHOODS.map(value=>({value,label:value})),character.originNeighborhood??'','Not specified');
 const neighborhoodField=labeled('Neighborhood',neighborhood);identity.append(neighborhoodField,residence);
 const drawResidence=()=>{
  residence.replaceChildren(el('h4','Residence'));const plan=residencePlan(character.originNeighborhood,settings.residencePlans);
  if(!plan){residence.append(el('p','Choose a listed neighborhood to assign a residence. Saved custom neighborhood names are preserved.'));return;}
  const select=el('select');options(select,[{value:plan.name,label:plan.name}],character.residence?plan.name:'','Keep existing home / no assignment');
  select.addEventListener('change',()=>{character.residence=select.value?{neighborhood:plan.neighborhood,name:plan.name,building:1,floor:0,apartment:''}:null;onchange(character);drawResidence();});residence.append(labeled('Residence',select));
  if(!character.residence)return;
  if(character.playable){residence.append(el('p',plan.name+' · Building 1 · '+playerFloors(plan).map(f=>apartmentNumber(f,1)).join(' or ')+'. A middle-floor apartment is assigned when this life starts.'));return;}
  const floor=el('select');options(floor,Array.from({length:plan.floors},(_,i)=>({value:String(i+1),label:'Floor '+(i+1)})),String(character.residence.floor||playerFloors(plan)[0]),'Choose a floor');
  const apartment=el('select'),fillUnits=()=>{const current=character.residence.apartment,available=Array.from({length:plan.unitsPerFloor-1},(_,i)=>apartmentNumber(Number(floor.value),i+2)).filter(number=>!entities.some(e=>e.kind==='character'&&!e.archived&&e.data!==character&&e.data.residence?.neighborhood===plan.neighborhood&&e.data.residence?.apartment===number&&number!==current));options(apartment,available.map(value=>({value,label:'Apartment '+value})),available.includes(current)?current:'','Choose an available apartment');};fillUnits();
  floor.addEventListener('change',()=>{character.residence.floor=Number(floor.value);character.residence.apartment='';fillUnits();onchange(character);});apartment.addEventListener('change',()=>{character.residence.floor=Number(floor.value);character.residence.apartment=apartment.value;onchange(character);});
  residence.append(labeled('Residence floor',floor),labeled('Apartment number',apartment,'Unit 01 on each floor is reserved for player starts. Occupied units are unavailable. Blank lets the server assign an available middle-floor unit.'));
 };
 neighborhood.addEventListener('change',()=>{character.originNeighborhood=neighborhood.value;const plan=residencePlan(neighborhood.value,settings.residencePlans);character.residence=plan?{neighborhood:plan.neighborhood,name:plan.name,building:1,floor:0,apartment:''}:null;onchange(character);drawResidence();});drawResidence();showAutomatic();
 return {appearance,identity,drawResidence};
}
