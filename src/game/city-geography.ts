import {simulationId as randomUUID} from './turn-runtime.ts';
import {data,validateEntity,type Entity,type State} from './model.ts';

// Approximate anchors traced from the user's Valor map (960 x 1280).
// North/south scale: Whidbey ~60 km straight-line, ~89 km by road (US Navy).
// https://cnrnw.cnic.navy.mil/Installations/NAS-Whidbey-Island/About/Contact-Us/
export const cityAnchors=[
 ['Summit Park',373,65],['Parkcrest',372,125],['North Exchange',339,180],['Fairmont',280,240],['Capital District',283,348],['Brookline',220,392],
 ['Civic North',400,210],['Lindenvale',459,202],['Arbor',395,269],['University District',460,259],['Eastend',527,283],['Civic South',418,301],
 ['Saltwork',311,451],['Moody',245,453],['Hudson',158,476],['Forge Hill',263,491],['Flats',275,558],['Tracked',336,605],['Dockside',409,592],['Yard District',445,720],
 ['North Works',450,866],['South Works',459,974],['Civic Landing',526,860],['Cashlight District',606,864],['Vice Row',614,944],['Draftline',679,936],
 ['Sunnyside',619,980],['Langley',701,978],['Chinatown',710,1023],['Court District',782,1052],['Low End',548,1041],['Sparrow Ward',630,1044],['Knox',610,1087],
 ['North Crowns',687,1059],['South Crowns',653,1138],['Ashmont',758,1107],['First Harbor',793,1184],['Terminal',709,1196],
 ['Premiere',545,439],['Kingswell',593,410],['Collision',655,406],['Fort Losa',696,423],['Liberty Cross',705,461],['Trust Center',622,455],['Little Italy',594,486],['Waterside',551,487],
 ['Embassy',645,529],['Ashford',555,560],['Deckline',598,564],['Prescott',607,647],['Westbridge',590,695],['Northeast',640,688],['Northwest',624,724],['Southeast',749,805],['Southwest',772,837]
].map(([name,x,y])=>({name:String(name),x:Number(x),y:Number(y)}));
const chains=[
 'Summit Park|Parkcrest|North Exchange|Fairmont|Capital District|Brookline|Hudson|Moody|Saltwork|Forge Hill|Flats|Tracked|Dockside|Yard District|North Works|South Works',
 'North Exchange|Civic North|Lindenvale|Eastend|University District|Arbor|Civic South|Capital District',
 'Yard District|Civic Landing|Cashlight District|Vice Row|Sunnyside|Langley|Chinatown|Court District|Ashmont|First Harbor|Terminal|South Crowns|North Crowns|Knox|Low End|Sparrow Ward|Sunnyside',
 'North Works|Civic Landing|South Works','Cashlight District|Draftline|Langley','Chinatown|North Crowns',
 'Kingswell|Premiere|Waterside|Little Italy|Trust Center|Collision|Fort Losa|Liberty Cross|Embassy|Deckline|Ashford|Prescott|Westbridge|Northwest|Northeast|Southeast|Southwest'
];
// Provisional fictional crossings, not real Island County bridges.
export const cityBridges=[{from:'Eastend',to:'Collision',name:'Holiday–Centennial crossing'},{from:'Dockside',to:'Prescott',name:'Lee Way–Midland crossing'},{from:'First Harbor',to:'Southwest',name:'Gateway–Industrial crossing'}];
const edges=[...chains.flatMap(chain=>chain.split('|').slice(1).map((to,i)=>({from:chain.split('|')[i]!,to,name:''}))),...cityBridges];
const normalize=(name:string)=>name.toLowerCase().replace(/[^a-z]/g,'').replace('1stharbor','firstharbor').replace('lowend','lowend');
export function anchorFor(s:Pick<State,'entities'>,entity:Entity|undefined){
 const seen=new Set<string>();let current=entity;
 while(current&&!seen.has(current.id)){seen.add(current.id);const anchor=cityAnchors.find(a=>normalize(a.name)===normalize(current!.name));if(anchor)return anchor;current=s.entities.find(e=>e.id===current!.data.parentId);}
 return null;
}
export function atlasPath(from:string,to:string){
 const distances=new Map<string,number>([[from,0]]),previous=new Map<string,string>(),pending=new Set(cityAnchors.map(a=>a.name));
 while(pending.size){const current=[...pending].sort((a,b)=>(distances.get(a)??Infinity)-(distances.get(b)??Infinity))[0]!;if(!Number.isFinite(distances.get(current)))break;pending.delete(current);if(current===to)break;
  for(const edge of edges.filter(e=>e.from===current||e.to===current)){const next=edge.from===current?edge.to:edge.from,a=cityAnchors.find(p=>p.name===current)!,b=cityAnchors.find(p=>p.name===next)!,km=Math.hypot(a.x-b.x,a.y-b.y)*60/1280*(edge.name?1:1.25),distance=distances.get(current)!+km;if(distance<(distances.get(next)??Infinity)){distances.set(next,distance);previous.set(next,current);}}
 }
 if(!distances.has(to))return null;const path=[to];while(path[0]!==from){const before=previous.get(path[0]!);if(!before)return null;path.unshift(before);}
 return {distanceKm:Math.round(distances.get(to)!*10)/10,points:path.map(name=>cityAnchors.find(p=>p.name===name)!),bridges:cityBridges.filter(b=>path.some((name,i)=>name===b.from&&path[i+1]===b.to||name===b.to&&path[i+1]===b.from)).map(b=>b.name)};
}
export function mappedRoute(s:State,from:Entity,to:Entity,mode:'walk'|'drive'){
 if(!['district','neighborhood'].includes(String(from.data.category))||!['district','neighborhood'].includes(String(to.data.category)))return null;
 if(data(from,'location').access.policy!=='public'||data(to,'location').access.policy!=='public')return null;
 const a=anchorFor(s,from),b=anchorFor(s,to);if(!a||!b||a.name===b.name)return null;const path=atlasPath(a.name,b.name);if(!path)return null;
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:s.settings.timezone,hour:'numeric',hourCycle:'h23'}).format(new Date(s.clock))),rush=(hour>=7&&hour<10)||(hour>=16&&hour<19),speed=mode==='walk'?4.8:rush?20:32;
 const factor=s.settings.weather==='snow'?1.65:s.settings.weather==='rain'?1.12:s.settings.weather==='fog'&&mode==='drive'?1.25:1;
 return {...path,minutes:Math.max(1,Math.ceil(path.distanceKm/speed*60*factor)),mode,estimated:true};
}
export function ensureCityAtlas(s:State){
 if(s.settings.timezone!=='America/Los_Angeles'||!s.entities.some(e=>Array.isArray(e.data.tags)&&e.data.tags.some(tag=>typeof tag==='string'&&tag.startsWith('residence-district:'))))return;
 // The legacy city container is a hierarchy node, not a one-minute cross-city teleport.
 const city=s.entities.find(e=>e.kind==='location'&&Array.isArray(e.data.tags)&&e.data.tags.includes('residence-city:Valor'));
 if(city){for(const location of s.entities.filter(e=>e.kind==='location'&&(e.id===city.id||Array.isArray(e.data.tags)&&e.data.tags.some(tag=>typeof tag==='string'&&tag.startsWith('residence-district:'))))){const d=data(location,'location');d.exits=d.exits.filter(exit=>!(exit.minutes===1&&exit.modes.length===1&&exit.modes[0]==='walk'&&!exit.locked&&!exit.fare&&(exit.to===city.id||location.id===city.id&&s.entities.some(e=>e.id===exit.to&&e.data.parentId===city.id))));location.data=d;}}
 for(const anchor of cityAnchors){if(s.entities.some(e=>e.kind==='location'&&normalize(e.name)===normalize(anchor.name)))continue;
  s.entities.push(validateEntity({id:randomUUID(),kind:'location',name:anchor.name,visibility:'campaign',data:{category:'neighborhood',description:'A neighborhood on the public Valor city map.',tags:['valor-atlas'],discoverable:true,weatherExposed:true,mapPresentation:{x:anchor.x,y:anchor.y}}}));
 }
}
