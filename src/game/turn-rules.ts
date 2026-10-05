import type {SystemOwner} from './system-interfaces.ts';
import {authorityFor,type WriteGrant} from './turn-audit.ts';
import {actionSchema,kinds,type Action,type State} from './model.ts';
import {resolveAction,type CheckRecord} from './actions.ts';
import type {Effect} from './simulation.ts';
import type {actionTime} from './calendar.ts';

export const coreRulesetVersion='core-turn-v3';

export type RuleResolution={
 status:'SUCCEEDED'|'FAILED'|'PARTIAL'|'INTERRUPTED'|'NO_EFFECT';
 effects:Effect[];checks:CheckRecord[];draws:number;time:ReturnType<typeof actionTime>;
};
export interface TurnRuleProvider {
 readonly id:string;
 resolve(state:State,actorId:string,action:Action,eventId:string,seed:string):RuleResolution;
}
// A registry dispatches trusted owning code, never model-supplied executables.
// There is exactly one owner per action, so ordering cannot choose an outcome.
export class TurnRuleRegistry {
 private providers=new Map<Action['type'],TurnRuleProvider>();
 private grants=new Map<Action['type'],readonly WriteGrant[]>();
 register(actionType:Action['type'],provider:TurnRuleProvider,grants:readonly WriteGrant[]=[]){
  if(this.providers.has(actionType))throw new Error('duplicate_rule_owner');
  this.providers.set(actionType,Object.freeze({...provider}));this.grants.set(actionType,structuredClone(grants));return this;
 }
 permissions(actionType:Action['type']){return structuredClone(this.grants.get(actionType)??[]);}
 owner(actionType:Action['type']){
  const provider=this.providers.get(actionType);
  if(!provider)throw new Error('rule_provider_unavailable');
  return provider;
 }
}
export function existingTurnRules(){
 const registry=new TurnRuleRegistry(),adapter:TurnRuleProvider={id:'domain-router-v2',resolve(state,actorId,action,eventId,seed){
  const resolved=resolveAction(state,actorId,action,eventId,seed);
  const status=resolved.status??(resolved.effects.some(effect=>effect.type==='turn.interrupted')?'INTERRUPTED':resolved.checks.some(check=>check.outcome==='partial')?'PARTIAL':resolved.checks.some(check=>!['success','success-at-cost','critical','no-roll'].includes(check.outcome))?'FAILED':'SUCCEEDED');
  return {...resolved,status};
 }};
 // These are server-owned integration grants. A provider's self-declared id
 // never grants writes. The legacy router invokes the listed domain owners and
 // scheduler; authored catalogs, canon, revisions and settings stay protected.
 const runtimeKinds=kinds.filter(kind=>!['itemType','trait','traitTemplate','skill','checkDefinition','recipe','service','socialRule','media','law','transportService'].includes(kind));
 const grants:WriteGrant[]=runtimeKinds.map(kind=>({ownerSystem:authorityFor(kind),kind,fields:['data.*','name','visibility','archived','revision'],create:true,archive:true}));
 for(const root of ['clock','facts','knowledge','beliefs','memories'] as const)grants.push({ownerSystem:root==='clock'?'spacetime':'knowledge',root,fields:['value']});
 grants.push({ownerSystem:'spacetime',root:'settings',fields:['weather']});
 // Authored social rules are immutable except for their once-only execution marker.
 grants.push({ownerSystem:'relationships',kind:'socialRule',fields:['data.firedAt']});
 for(const option of actionSchema.options)registry.register(option.shape.type.value,{...adapter,id:ruleOwner(option.shape.type.value)},grants);
 return registry;
}

// Explicit composition precedence. The primary coordinator may call other domains;
// those domains keep their existing entity authorities and checked write grants.
// New actions must choose an owner at compile time, never fall through a regex.
export const actionOwners={
  "story": "world-actions",
  "physical": "items",
  "take": "items",
  "give": "items",
  "steal": "items",
  "equip": "items",
  "consume": "items",
  "conceal": "items",
  "store": "items",
  "retrieve": "items",
  "examine-item": "items",
  "split-stack": "items",
  "transfer-item": "items",
  "discard-item": "items",
  "wear-item": "items",
  "search": "items",
  "persuade": "relationships",
  "say": "relationships",
  "conversation": "relationships",
  "social": "relationships",
  "quit-job": "economy",
  "cook": "economy",
  "hygiene": "economy",
  "buy": "economy",
  "sell": "economy",
  "bank": "economy",
  "work": "economy",
  "pay-rent": "economy",
  "pay-bill": "economy",
  "wait-until": "spacetime",
  "move-within": "spacetime",
  "wait": "spacetime",
  "fast-forward": "spacetime",
  "sleep": "spacetime",
  "travel": "spacetime",
  "request-assistance": "health",
  "dispatch-response": "health",
  "settle-estate": "health",
  "clinical-care": "health",
  "assess-health": "health",
  "identify-remains": "health",
  "notify-death": "health",
  "treat": "health",
  "tactical-move": "combat",
  "cover": "combat",
  "combat": "combat",
  "ready-weapon": "combat",
  "escape-restraint": "combat",
  "environmental-action": "combat",
  "attack": "combat",
  "defend": "combat",
  "grapple": "combat",
  "restrain": "combat",
  "disarm": "combat",
  "shove": "combat",
  "surrender": "combat",
  "flee": "combat",
  "chase": "combat",
  "chase-action": "combat",
  "read-message": "communications",
  "phone-call": "communications",
  "call-response": "communications",
  "call-speak": "communications",
  "leave-voicemail": "communications",
  "delete-message": "communications",
  "contact-control": "communications",
  "share-number": "communications",
  "message": "communications",
  "add-contact": "communications",
  "vehicle-access": "vehicles",
  "vehicle-custody": "vehicles",
  "report-vehicle-theft": "vehicles",
  "recover-vehicle": "vehicles",
  "vehicle-service": "vehicles",
  "pay-bail": "law",
  "crime": "law",
  "report": "law",
  "report-belief": "law",
  "case": "law",
  "forensic-test": "investigation",
  "custody": "investigation",
  "evidence-state": "investigation",
  "analyze-evidence": "investigation",
  "consult-informant": "investigation",
  "collect": "investigation",
  "look": "knowledge",
  "inspect": "knowledge",
  "share": "knowledge",
  "reload": "weapons",
  "load-magazine": "weapons",
  "clear-malfunction": "weapons",
  "maintain-weapon": "weapons",
  "attach-weapon": "weapons",
  "content-filter": "romance",
  "safety-exit": "romance",
  "check": "mechanics",
  "train": "mechanics",
  "event-action": "events",
  "faction-membership": "factions",
  "spread-rumor": "factions",
  "correct-rumor": "factions"
} as const satisfies Record<Action['type'],SystemOwner>;
export function ruleOwner(type:Action['type']):SystemOwner{
 const owner=Object.hasOwn(actionOwners,type)?actionOwners[type]:undefined;
 if(!owner)throw new Error('rule_provider_unavailable');
 return owner;
}
