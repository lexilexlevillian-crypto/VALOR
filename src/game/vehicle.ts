import type {Data} from './model.ts';

export type VehicleRandom={integer(maxExclusive:number):number};

export function vehicleOperational(vehicle:Data<'vehicle'>){
 if(vehicle.condition<=0)return false;
 return ['engine','tires','brakes'].every(component=>vehicle.components[component]===undefined||vehicle.components[component]>0);
}

export function vehiclePenalty(vehicle:Data<'vehicle'>){
 const values=Object.values(vehicle.components),health=values.length?Math.min(vehicle.condition,...values):vehicle.condition;
 return (100-health)/10;
}

export function damageVehicle(vehicle:Data<'vehicle'>,amount:number,rng:VehicleRandom){
 if(amount<=0)return null;
 const components=Object.keys(vehicle.components);
 if(!components.length){vehicle.condition=Math.max(0,vehicle.condition-amount);return null;}
 const component=components[rng.integer(components.length)]!,before=vehicle.components[component]??vehicle.condition,next=Math.max(0,before-amount);
 vehicle.components[component]=next;vehicle.condition=Math.min(vehicle.condition,next);return component;
}
