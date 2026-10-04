import {ensureCityAtlas} from './city-geography.ts';
import {randomUUID} from 'node:crypto';
import {validateEntity,data} from './model.ts';
import type {State,Data,Entity} from './model.ts';
import {automaticTraitNames,syncAppearanceTraits,residencePlan,PLAYER_NEIGHBORHOODS,playerFloors,apartmentNumber} from '../../public/profile-rules.js';
import {stockTrait} from '../../public/creation-rules.js';
export function prepareAppearance(s:State,character:Data<'character'>,previous?:Data<'character'>){
 const changed=!previous||character.heightCm!==previous.heightCm||character.build!==previous.build;
 if(!changed)return;
 if(previous&&character.heightCm===null&&previous.heightCm!==null)character.traits=character.traits.filter(id=>!s.entities.some(e=>e.id===id&&['Short','Tall'].includes(e.name)));
 if(previous&&!character.build&&previous.build)character.traits=character.traits.filter(id=>!s.entities.some(e=>e.id===id&&['Slim','Stocky','Athletic','Overweight','Muscular'].includes(e.name)));
 if(character.heightCm!==null&&(!previous||character.heightCm!==previous.heightCm)){
  const inches=character.heightCm/2.54;
  if(inches<51-1e-6||inches>96+1e-6)throw new Error('height_must_be_4ft3_to_8ft');
 }
 for(const name of automaticTraitNames(character)){
  if(s.entities.some(e=>e.kind==='trait'&&e.name===name&&!e.archived&&(!character.playable||e.visibility==='campaign')))continue;
  const stock=stockTrait(name);if(!stock)throw new Error('appearance_trait_unavailable');
  s.entities.push(validateEntity({id:randomUUID(),kind:'trait',name,visibility:'campaign',data:{category:'physical',description:stock.description,mode:'costed',cost:stock.cost,balance:stock.cost>0?'advantage':stock.cost<0?'disadvantage':'neutral',modifiers:stock.modifiers}}));
 }
 syncAppearanceTraits(character,s.entities);
}
export function assignResidence(s:State,entity:Entity,previous?:Data<'character'>){
 const c=data(entity,'character'),choice=c.residence;
 if(c.playable&&c.originNeighborhood&&(!previous||!previous.playable||previous.originNeighborhood!==c.originNeighborhood||JSON.stringify(previous.residence)!==JSON.stringify(choice))&&!PLAYER_NEIGHBORHOODS.includes(c.originNeighborhood))throw new Error('player_union_residence_required');
 if(!choice)return;
 const plan=residencePlan(c.originNeighborhood,s.settings.residencePlans);
 if(!plan||choice.neighborhood!==c.originNeighborhood)throw new Error('residence_does_not_match_neighborhood');
 if(previous&&JSON.stringify(previous.residence)===JSON.stringify(choice)&&previous.originNeighborhood===c.originNeighborhood)return;
 const floors=playerFloors(plan);
 let floor=choice.floor,unit=Number(choice.apartment)%100;
 if(c.playable){floor=floors[Number.parseInt(entity.id.replaceAll('-','').slice(0,8),16)%floors.length]!;unit=1;}
 else if(!floor||!choice.apartment){
  const free=(floor?[floor]:floors).flatMap(f=>Array.from({length:plan.unitsPerFloor-1},(_,i)=>({floor:f,unit:i+2}))).find(candidate=>!s.entities.some(e=>e.kind==='character'&&!e.archived&&e.id!==entity.id&&e.data.residence&&((e.data.residence as Data<'character'>['residence'])!.neighborhood===plan.neighborhood)&&(e.data.residence as NonNullable<Data<'character'>['residence']>).apartment===apartmentNumber(candidate.floor,candidate.unit)));
  if(!free)throw new Error('no_available_apartments');floor=free.floor;unit=free.unit;
 }
 if(!Number.isInteger(floor)||floor<1||floor>plan.floors||!Number.isInteger(unit)||unit<1||unit>plan.unitsPerFloor||!c.playable&&unit===1||!c.playable&&choice.apartment&&choice.apartment!==apartmentNumber(floor,unit))throw new Error('invalid_or_reserved_apartment');
 const apartment=apartmentNumber(floor,unit);
 if(s.entities.some(e=>e.kind==='character'&&!e.archived&&e.id!==entity.id&&e.data.residence&&(e.data.residence as NonNullable<Data<'character'>['residence']>).neighborhood===plan.neighborhood&&(e.data.residence as NonNullable<Data<'character'>['residence']>).apartment===apartment))throw new Error('apartment_already_occupied');
 c.residence={neighborhood:plan.neighborhood,name:plan.name,building:1,floor,apartment};
 const make=(name:string,category:'city'|'district'|'building'|'room',parentId:string|null,tag:string,ownerId:string|null)=>{
  const found=s.entities.find(e=>e.kind==='location'&&!e.archived&&(e.data.tags as string[]|undefined)?.includes(tag));if(found)return found;
  const created=validateEntity({id:randomUUID(),kind:'location',name,visibility:ownerId?'owner':'campaign',data:{category,parentId,tags:[tag],ownerId,description:category==='room'?'Assigned residence. Rent and contracts are authored separately.':'Residential location.'}});s.entities.push(created);return created;
 };
 const city=s.entities.find(e=>e.kind==='location'&&!e.archived&&e.name==='Valor'&&e.data.category==='city')??make('Valor','city',null,'residence-city:Valor',null);
 const district=s.entities.find(e=>e.kind==='location'&&!e.archived&&e.name===plan.neighborhood&&['district','neighborhood'].includes(String(e.data.category)))??make(plan.neighborhood,'district',city.id,'residence-district:'+plan.neighborhood,null);
 const building=make(plan.name+' · Building 1','building',district.id,'residence-building:'+plan.neighborhood,null);
 const home=make(plan.name+' · Building 1 · Apartment '+apartment,'room',building.id,'residence-unit:'+plan.neighborhood+':'+apartment,entity.id);
 // Reassign a vacated unit without exposing the former occupant's private home.
 home.data.ownerId=entity.id;
 const connect=(from:Entity,to:Entity)=>{const d=data(from,'location');if(!d.exits.some(e=>e.to===to.id)){d.exits.push({to:to.id,minutes:1,modes:['walk'],locked:false,keyId:null,fare:0,interruption:null,terrainPenalty:0,trafficPenalty:0});from.data=d;}};
 connect(city,district);connect(district,city);connect(district,building);connect(building,district);connect(building,home);connect(home,building);
 ensureCityAtlas(s);
 if(!previous||!c.locationId||c.locationId===previous.homeId)c.locationId=home.id;
 c.homeId=home.id;entity.data=c;
}
