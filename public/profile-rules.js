import {CITY_PARAGRAPHS} from './city-content.js';
export const HEIGHTS=Array.from({length:46},(_,i)=>{const inches=i+51;return {inches,cm:Math.round(inches*2.54*100)/100,label:Math.floor(inches/12)+"′ "+inches%12+"″"};});
export const BUILDS=[
 {name:'Average',trait:null},{name:'Slim',trait:'Slim'},{name:'Lean',trait:'Slim'},
 {name:'Stocky',trait:'Stocky'},{name:'Athletic',trait:'Athletic'},
 {name:'Muscular',trait:'Muscular'},{name:'Fat',trait:'Overweight'},{name:'Soft / curvy',trait:null}
];
export const EYE_COLORS=['Brown','Dark brown','Light brown','Hazel','Amber','Green','Blue','Gray','Blue-gray','Green-gray','Heterochromia','Other / self-described'];
export const SKIN_COLORS=['Very fair','Fair','Light','Light-medium','Medium','Olive','Tan','Brown','Dark brown','Deep brown','Other / self-described'];
export const ETHNICITIES=[
 'African American','Afro-Caribbean','Afro-Latin American','Akan','Amhara','Amazigh / Berber','Arab','Armenian','Assyrian','Aymara','Azeri','Baloch','Bambara','Bashkir','Basque','Bengali','Bosniak','Breton','Bulgarian','Buryat','Cajun','Caribbean','Catalan','Cham','Chamorro','Chechen','Cherokee','Chickasaw','Chinese','Choctaw','Circassian','Cornish','Cree','Croat','Cuban','Czech','Dakota','Danish','Dinka','Dominican','Dutch','English','Estonian','Ewe','Fijian','Finnish','Flemish','French','Fulani','Ga','Gagauz','Garifuna','Georgian','German','Greek','Gujarati','Haitian','Han Chinese','Hausa','Hawaiian','Hazaragi / Hazara','Hmong','Hungarian','Ibibio','Igbo','Ilocano','Inuit','Irish','Italian','Jamaican','Japanese','Javanese','Jewish — Ashkenazi','Jewish — Mizrahi','Jewish — Sephardi','Kannadiga','Karen','Kashmiri','Kazakh','Khmer','Kikuyu','Kinh / Vietnamese','Kongo','Korean','Kurdish','Kyrgyz','Ladino','Lakota','Lao','Latvian','Lithuanian','Luba','Luo','Maasai','Macedonian','Madurese','Malagasy','Malay','Malayali','Maltese','Mandinka','Māori','Marathi','Maya','Métis','Mexican','Minangkabau','Mizo','Mongol','Montenegrin','Nahua','Navajo / Diné','Ndebele','Nepali','Newar','Norwegian','Nuer','Odia','Ojibwe','Oromo','Ossetian','Palestinian','Pashtun','Persian','Polish','Portuguese','Puerto Rican','Punjabi','Quechua','Roma','Romanian','Russian','Rusyn','Sámi','Samoan','Sardinian','Scottish','Serb','Shan','Shona','Sicilian','Sindhi','Sinhalese','Slovak','Slovene','Somali','Songhai','Sotho','Spanish','Sundanese','Swahili','Swazi','Swedish','Tagalog','Tajik','Tamil','Tatar','Telugu','Thai','Tibetan','Tigrayan','Tongan','Torres Strait Islander','Tsonga','Tswana','Turkish','Turkmen','Ukrainian','Uyghur','Uzbek','Venda','Visayan','Welsh','Wolof','Xhosa','Yoruba','Zapotec','Zulu',
 'Aboriginal Australian — self-describe nation','Native American — self-describe nation','First Nations — self-describe nation','Pacific Islander — self-describe community','Mixed / multiple ethnicities','Other / self-described','Not specified'
].sort((a,b)=>a.localeCompare(b));
export const APPEARANCE_TRAITS=['Short','Tall','Slim','Stocky','Athletic','Overweight','Muscular'];
export function automaticTraitNames(character){
 const names=[],height=character.heightCm;
 if(height!==null&&height!==undefined){if(height<165.1-1e-6)names.push('Short');else if(height>180.34+1e-6)names.push('Tall');}
 const build=BUILDS.find(row=>row.name.toLowerCase()===(character.build??'').toLowerCase());if(build?.trait)names.push(build.trait);
 return names;
}
export function syncAppearanceTraits(character,entities){
 const managed=[...(character.heightCm!=null?['Short','Tall']:[]),...(BUILDS.some(row=>row.name.toLowerCase()===(character.build??'').toLowerCase())?APPEARANCE_TRAITS.filter(name=>!['Short','Tall'].includes(name)):[])];
 character.traits=(character.traits??[]).filter(id=>!entities.some(e=>e.id===id&&managed.includes(e.name)));
 for(const name of automaticTraitNames(character)){const entity=entities.find(e=>e.kind==='trait'&&e.name===name&&!e.archived&&(!character.playable||!e.visibility||e.visibility==='campaign'));if(entity&&!character.traits.includes(entity.id))character.traits.push(entity.id);}
}
const extra=['North Crowns','South Crowns','First Harbor','Ashmont','Terminal','Gateway','North Works','South Works','Saltwork','Moody','Hudson','Tracked','Dockside','Yard District','Civic Landing','Northeast','Northwest','Southeast','Southwest','Low End'];
export const NEIGHBORHOODS=[...new Set([...CITY_PARAGRAPHS.slice(22,132).filter(p=>p.startsWith('☆')&&!p.includes('HOT SPOTS')).map(p=>p.replace(/^☆\s*┇\s*/,'').replace(/:$/,'')),...extra])].sort((a,b)=>a.localeCompare(b));
export const PLAYER_NEIGHBORHOODS=['Langley','Court District','First Harbor','Chinatown','North Crowns','South Crowns','Sparrow Ward','Low End'];
const names={'North Crowns':'The Sync','South Crowns':'City Lights Reserve','Langley':'Riflerange Apartments','Court District':'The Soverighn','First Harbor':'First Harbor Flats','Chinatown':'The Crane Apartments','Sparrow Ward':'Visonary Apartments','Low End':'The Hampton Collection','Lowend Market':'The Hampton Collection','Gateway':'Gateway Apartments'};
export function residencePlan(neighborhood,overrides={}){
 if(!NEIGHBORHOODS.includes(neighborhood))return null;
 return {neighborhood,name:names[neighborhood]??neighborhood+' Apartments',floors:neighborhood==='First Harbor'?20:['Gateway','Ashmont','Terminal'].includes(neighborhood)?12:6,unitsPerFloor:8,...(overrides[neighborhood]??{})};
}
export function playerFloors(plan){
 if(plan.name==='The Sync')return [2,3].filter(n=>n<plan.floors);
 const min=Math.max(2,Math.floor(plan.floors*.35)),max=Math.max(min,Math.min(plan.floors-1,Math.floor(plan.floors*.6)));
 return Array.from({length:max-min+1},(_,i)=>min+i);
}
export const apartmentNumber=(floor,unit)=>String(floor*100+unit);
