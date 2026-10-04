import {test} from 'node:test';
import assert from 'node:assert/strict';
import {data,validateEntity} from '../src/game/model.ts';
import {Game} from '../src/game/engine.ts';
import {instantiateMasterBankEntry,listMasterBank,masterBankCount,masterBankEntry} from '../src/game/master-bank.ts';
import {fixture,key,login} from './helpers.ts';

test('the 2012 master bank is paginated, priced, pre-cutoff, unique, and every template validates',()=>{
 const first=listMasterBank({limit:100});
 assert.equal(masterBankCount,1414);
 assert.deepEqual(first.counts,{all:1414,item:243,weapon:107,vehicle:1064});
 const ids:string[]=[];
 for(let offset=0;offset<masterBankCount;offset+=100){
  const page=listMasterBank({offset,limit:100});
  for(const summary of page.items){
   assert.ok(summary.price2012Cents>0,summary.id);
   assert.ok(Date.parse(summary.introducedOn)<Date.parse('2012-01-01'),summary.id);
   const source=masterBankEntry(summary.id),instance=instantiateMasterBankEntry(summary.id);
   assert.equal(source.id,summary.id);assert.equal(instance.data.bankId,summary.id);
   const totalPrice=instance.kind==='item'&&data(instance,'item').quantity>1?data(instance,'item').price*data(instance,'item').quantity:instance.data.price;
   assert.equal(totalPrice,summary.price2012Cents);
   validateEntity(instance);ids.push(summary.id);
  }
 }
 assert.equal(ids.length,masterBankCount);assert.equal(new Set(ids).size,masterBankCount);
});

test('weapon and EPA vehicle records expose real-world operating fields and exact compatibility',()=>{
 const glock=listMasterBank({q:'Glock 17 Gen3',kind:'weapon'}).items.find(row=>row.id==='weapon:glock-17-gen3');assert.ok(glock);
 const pistol=data(instantiateMasterBankEntry(glock.id),'item');
 assert.equal(pistol.caliber,'9x19mm');assert.equal(pistol.magazine,17);assert.equal(pistol.actionType,'semi-automatic');assert.ok(pistol.compatibleAmmoTypes.includes('FMJ'));assert.ok(pistol.damage>0);assert.ok(pistol.muzzleVelocityMps>0);
 const ammunition=listMasterBank({q:'9x19mm FMJ',kind:'weapon'}).items.find(row=>row.category==='ammo');assert.ok(ammunition);assert.equal(data(instantiateMasterBankEntry(ammunition.id),'item').caliber,pistol.caliber);
 const vehicleSummary=listMasterBank({q:'2012 Ford',kind:'vehicle',limit:100}).items[0];assert.ok(vehicleSummary);
 const vehicle=data(instantiateMasterBankEntry(vehicleSummary.id),'vehicle');
 assert.equal(vehicle.year,2012);assert.ok(vehicle.epaCombinedMpg>0);assert.ok(vehicle.fuelEconomyCombinedLPer100Km>0);assert.ok(vehicle.fuelTankLiters>0);assert.ok(vehicle.annualFuelCost2012Cents>0);assert.equal(vehicle.priceConfidence,'low');
});

test('the authenticated bank endpoint searches and Creator import is audited',async()=>{
 const f=await fixture(),game=new Game(f.store);try{
  await f.domain.setUserMode(f.creator,{mode:'developer',expectedRevision:0});const timeline=await game.initialize(f.creator,f.campaign.id),auth=await login(f);
  const search=await f.app.inject({method:'GET',url:'/game/master-bank?q=Glock%2017&kind=weapon&limit=5',headers:{cookie:auth.cookie}});
  assert.equal(search.statusCode,200);assert.equal(search.json().items[0].id,'weapon:glock-17-gen3');
  const response=await f.app.inject({method:'POST',url:'/game/timelines/'+timeline.id+'/master-bank/import',headers:{cookie:auth.cookie,origin:f.settings.origin,'x-csrf-token':auth.csrf,'idempotency-key':key()},payload:{revision:1,bankId:'weapon:glock-17-gen3'}});
  assert.equal(response.statusCode,200,response.body);const imported=response.json().entity;assert.equal(imported.data.bankId,'weapon:glock-17-gen3');assert.equal(imported.visibility,'creator');
  assert.ok((await game.load(timeline.id)).entities.some(entity=>entity.id===imported.id));
  assert.ok(await f.store.get('SELECT 1 FROM audit_log WHERE action=?','creator.master-bank.import'));
 }finally{await f.close();}
});
