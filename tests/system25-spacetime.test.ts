import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {actionSchema,data,settingsSchema,validateEntity,validateState} from '../src/game/model.ts';
import type {Entity,State} from '../src/game/model.ts';
import {resolveAction} from '../src/game/actions.ts';
import {locationBrowser,observerView} from '../src/game/epistemics.ts';

const seed='25'.repeat(32),eventId='25252525-2525-4252-8252-252525252525';
const make=(kind:Entity['kind'],name:string,raw:Record<string,unknown>={},visibility:Entity['visibility']='campaign')=>validateEntity({id:randomUUID(),kind,name,visibility,data:raw});
const state=(entities:Entity[],settings:Record<string,unknown>={},clock='2012-06-01T12:00:00.000Z'):State=>({clock,settings:settingsSchema.parse({timezone:'America/New_York',calendar:{hemisphere:'north',sunriseHour:6,sunsetHour:20},...settings}),entities,facts:[],knowledge:[],beliefs:[],memories:[],eventIds:[]});
const act=(s:State,actorId:string,raw:unknown)=>resolveAction(s,actorId,actionSchema.parse(raw),eventId,seed);

test('closed venues and restricted destinations reject travel without advancing the city clock',()=>{
 const closed=make('location','Closed shop',{discoverable:true,hours:{opens:9,closes:17}}),restricted=make('location','Residents only',{discoverable:true,access:{policy:'restricted',description:'Residents only'}}),origin=make('location','Sidewalk',{exits:[{to:closed.id,minutes:5,modes:['walk']},{to:restricted.id,minutes:2,modes:['walk']}]}),player=make('character','Player',{playable:true,locationId:origin.id},'owner'),s=state([closed,restricted,origin,player]),before=s.clock;
 assert.throws(()=>act(s,player.id,{type:'travel',destinationId:closed.id,mode:'walk',vehicleId:null}),/destination_closed/);
 assert.throws(()=>act(s,player.id,{type:'travel',destinationId:restricted.id,mode:'walk',vehicleId:null}),/destination_access_denied/);
 assert.equal(s.clock,before);assert.equal(data(player,'character').locationId,origin.id);
 const browser=locationBrowser(s,player.id),restrictedRow=browser.locations.find(location=>location.id===restricted.id)!;assert.equal(restrictedRow.accessible,false);assert.equal(restrictedRow.reasonableToGo,false);
});

test('authored travel interruption controls arrival, discovery, elapsed time, and travel scale',()=>{
 const destination=make('location','Station',{discoverable:true}),encounter=make('location','Service alley',{description:'An authored interruption.'},'knowledge'),origin=make('location','Avenue',{exits:[{to:destination.id,minutes:20,modes:['walk'],distanceKm:1.5,interruption:{locationId:encounter.id,afterMinutes:5}}]}),player=make('character','Player',{playable:true,locationId:origin.id},'owner'),s=state([destination,encounter,origin,player]),before=Date.parse(s.clock);
 assert.ok(!locationBrowser(s,player.id).locations.some(location=>location.id===encounter.id));
 const result=act(s,player.id,{type:'travel',destinationId:destination.id,mode:'walk',vehicleId:null});
 assert.deepEqual(result.time,{minutes:5,scale:'travel'});assert.equal(Date.parse(s.clock)-before,5*60000);assert.equal(data(player,'character').locationId,encounter.id);assert.ok(data(encounter,'location').visitedByIds.includes(player.id));assert.ok(locationBrowser(s,player.id).locations.some(location=>location.id===encounter.id));
});

test('schedule boundaries arrive exactly and wait/sleep/work use explicit time scales',()=>{
 const work=make('location','Office'),origin=make('location','Home'),player=make('character','Player',{playable:true,locationId:origin.id},'owner'),npc=make('character','Coworker',{locationId:origin.id,schedule:[{id:randomUUID(),minute:480,locationId:work.id,activity:'opening shift',days:[5],kind:'work',required:true}]}),s=state([work,origin,player,npc],{},'2012-06-01T11:59:00.000Z');
 const waited=act(s,player.id,{type:'wait',minutes:1});assert.deepEqual(waited.time,{minutes:1,scale:'short'});assert.equal(data(npc,'character').locationId,work.id);assert.equal(data(npc,'character').activity,'opening shift');
 const slept=act(s,player.id,{type:'sleep',minutes:480});assert.deepEqual(slept.time,{minutes:480,scale:'overnight'});
 const forwarded=act(s,player.id,{type:'fast-forward',minutes:1440});assert.deepEqual(forwarded.time,{minutes:1440,scale:'overnight'});
});

test('text browser filters unknown places and presents hierarchy, occupants, forecast, and configured weather effects',()=>{
 const city=make('location','New Bordeaux',{category:'city'}),district=make('location','Riverside',{category:'district',parentId:city.id}),room=make('location','Apartment 2A',{category:'room',parentId:district.id,weatherExposed:true,mapPresentation:{label:'Home',order:1},safety:{level:'safe',notes:'Occupied building.'}}),learned=make('location','Bus depot',{category:'building',parentId:district.id},'knowledge'),unknown=make('location','HIDDEN PLACE',{category:'building',parentId:district.id},'knowledge'),player=make('character','Player',{playable:true,locationId:room.id},'owner'),neighbor=make('character','Neighbor',{locationId:room.id}),bus=make('transportService','Number 8 bus',{mode:'bus',scheduleMode:'fixed',routes:[{fromId:room.id,toId:learned.id,departures:[500],minutes:12,fareCents:200}]}),forecastAt='2012-06-01T14:00:00.000Z',s=state([city,district,room,learned,unknown,player,neighbor,bus],{weather:'rain',weatherVisibilityPenalties:{rain:20},weatherMood:{rain:'weathered'},weatherSchedule:[{at:forecastAt,weather:'snow',status:'forecast',issuedAt:'2012-06-01T10:00:00.000Z'}]});
 const learnedData=data(learned,'location');learnedData.discoveredByIds.push(player.id);learned.data=learnedData;
 const browser=locationBrowser(s,player.id),home=browser.locations.find(location=>location.id===room.id)!;
 assert.deepEqual(browser.breadcrumbs,['New Bordeaux','Riverside','Apartment 2A']);assert.equal(home.name,'Home');assert.equal(home.visibilityPenalty,20);assert.deepEqual(home.occupants.map(person=>person.name).sort(),['Neighbor','Player']);assert.equal(browser.weather.actual,'rain');assert.deepEqual(browser.weather.forecast,[{at:forecastAt,weather:'snow',issuedAt:'2012-06-01T10:00:00.000Z'}]);const depot=browser.locations.find(location=>location.id===learned.id)!;assert.ok(depot);assert.ok(depot.routes.some(route=>route.mode.includes('transit')&&route.serviceId===bus.id));assert.ok(!JSON.stringify(observerView(s,player.id)).includes('HIDDEN PLACE'));validateState(s);
});
