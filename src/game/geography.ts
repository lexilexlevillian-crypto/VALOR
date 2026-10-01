import {getCountries,getStatesOfCountry,getCitiesOfState} from '@countrystatecity/countries';
import {z} from 'zod';
export const geographyQuery=z.strictObject({country:z.string().regex(/^[A-Z]{2}$/).optional(),state:z.string().regex(/^[A-Za-z0-9-]{1,20}$/).optional(),q:z.string().max(80).default('')});
export async function geography(raw:unknown){
 const query=geographyQuery.parse(raw);
 const countries=await getCountries();
 if(!query.country)return {countries:countries.map(c=>({code:c.iso2,name:c.name,nationality:c.nationality})),attribution:'Countries States Cities Database · ODbL 1.0'};
 if(!countries.some(c=>c.iso2===query.country))throw new Error('unknown_birth_country');
 const states=await getStatesOfCountry(query.country);
 if(!query.state)return {states:states.map(s=>({code:s.iso2,name:s.name}))};
 if(!states.some(s=>s.iso2===query.state))throw new Error('unknown_birth_region');
 const matches=(await getCitiesOfState(query.country,query.state)).filter(c=>c.name.toLocaleLowerCase().includes(query.q.toLocaleLowerCase()));
 return {cities:matches.slice(0,200).map(c=>({id:String(c.id),name:c.name,latitude:c.latitude,longitude:c.longitude})),more:matches.length>200};
}
