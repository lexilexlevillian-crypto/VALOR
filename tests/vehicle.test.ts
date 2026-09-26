import {test} from 'node:test';
import assert from 'node:assert/strict';
import {data,validateEntity} from '../src/game/model.ts';
import {damageVehicle,vehicleOperational,vehiclePenalty} from '../src/game/vehicle.ts';
import {randomUUID} from 'node:crypto';
test('authored vehicle components lower operational health and deterministic penalties',()=>{
 const entity=validateEntity({id:randomUUID(),kind:'vehicle',name:'Fixture car',visibility:'campaign',data:{condition:100,components:{engine:100,tires:100,brakes:100}}});
 const vehicle=data(entity,'vehicle');assert.equal(vehicleOperational(vehicle),true);assert.equal(vehiclePenalty(vehicle),0);
 assert.equal(damageVehicle(vehicle,40,{integer:()=>0}),'engine');assert.equal(vehicle.components.engine,60);assert.equal(vehicle.condition,60);assert.equal(vehiclePenalty(vehicle),4);
 assert.equal(vehicleOperational(vehicle),true);assert.equal(damageVehicle(vehicle,60,{integer:()=>0}),'engine');assert.equal(vehicleOperational(vehicle),false);
});
test('legacy vehicles without components retain overall-condition behavior',()=>{
 const entity=validateEntity({id:randomUUID(),kind:'vehicle',name:'Legacy car',visibility:'campaign',data:{condition:30}});
 const vehicle=data(entity,'vehicle');assert.equal(vehicleOperational(vehicle),true);assert.equal(damageVehicle(vehicle,40,{integer:()=>0}),null);assert.equal(vehicle.condition,0);assert.equal(vehicleOperational(vehicle),false);
});
