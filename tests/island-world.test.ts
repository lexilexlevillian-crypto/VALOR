import {test} from 'node:test';
import assert from 'node:assert/strict';
import {islandWeather,syncWeather} from '../src/game/island-weather.ts';
import {calendarView,weatherView} from '../src/game/calendar.ts';
import {atlasPath,mappedRoute,ensureCityAtlas} from '../src/game/city-geography.ts';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {validateEntity} from '../src/game/model.ts';
import {resolveAction} from '../src/game/actions.ts';
import {observerView} from '../src/game/epistemics.ts';
test('Island County climate is repeatable, seasonal, DST-aware and respects authored overrides',async()=>{
 const f=await fixture(),game=new Game(f.store);try{
 const t=await game.initialize(f.creator,f.campaign.id),s=await game.load(t.id);s.settings.timezone='America/Los_Angeles';
 s.clock='2012-07-01T19:00:00Z';syncWeather(s);assert.deepEqual(islandWeather(s.clock),islandWeather(s.clock));assert.equal(calendarView(s).hour,12);assert.equal(calendarView(s).daylight,true);assert.equal(weatherView(s).forecast.length,6);
 const summer=islandWeather(s.clock);s.clock='2012-01-01T20:00:00Z';const winter=islandWeather(s.clock);assert.ok(summer.temperatureC>winter.temperatureC);assert.ok(summer.sunrise<winter.sunrise);
 s.clock='2012-03-11T09:59:00Z';assert.equal(calendarView(s).hour,1);s.clock='2012-03-11T10:00:00Z';assert.equal(calendarView(s).hour,3);
 s.settings.weatherSchedule=[{at:'2012-01-01T00:00:00Z',weather:'snow',status:'actual',issuedAt:null}];syncWeather(s);assert.equal(s.settings.weather,'snow');assert.equal(weatherView(s).temperatureC,null);
 }finally{await f.close();}
});
test('map routes use land corridors/fictional bridges, speed, weather and the actual travel clock',async()=>{
 const f=await fixture(),game=new Game(f.store);try{
 const t=await game.initialize(f.creator,f.campaign.id),s=await game.load(t.id);s.settings.timezone='America/Los_Angeles';s.settings.weatherSimulation='authored';s.settings.weather='clear';s.clock='2012-06-01T19:00:00Z';
 const from=validateEntity({id:key(),kind:'location',name:'North Crowns',visibility:'campaign',data:{category:'district',tags:['residence-district:North Crowns']}}),pc=validateEntity({id:key(),kind:'character',name:'Alex',visibility:'owner',data:{playable:true,controllerUserId:f.player.id,locationId:from.id}});
 s.entities.push(from,pc);ensureCityAtlas(s);const count=s.entities.length;ensureCityAtlas(s);assert.equal(s.entities.length,count);
 const to=s.entities.find(e=>e.name==='Court District')!,walk=mappedRoute(s,from,to,'walk')!,drive=mappedRoute(s,from,to,'drive')!;assert.ok(walk.minutes>drive.minutes);assert.ok(atlasPath('Eastend','Collision')!.bridges.length);
 s.settings.weather='rain';assert.ok(mappedRoute(s,from,to,'walk')!.minutes>walk.minutes);s.settings.weather='clear';
 const projected=observerView(s,pc.id).locationBrowser.locations.find(e=>e.id===to.id)!;assert.equal(projected.routes.find(r=>(r.mode as string[]).includes('walk'))!.minutes,walk.minutes);
 const before=Date.parse(s.clock);resolveAction(s,pc.id,{type:'travel',destinationId:to.id,mode:'walk',vehicleId:null},key(),'a'.repeat(64));assert.equal(Date.parse(s.clock)-before,walk.minutes*60000);assert.equal(pc.data.locationId,to.id);
 from.data.access={policy:'private',requiredItemIds:[],requiredTags:[],allowedCharacterIds:[],description:''};assert.equal(mappedRoute(s,from,to,'walk'),null);
 }finally{await f.close();}
});
