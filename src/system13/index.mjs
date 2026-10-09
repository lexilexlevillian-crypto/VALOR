/**
 * Public isolated module. No imports from another numbered system.
 *
 * @typedef {null|boolean|number|string|Json[]|{[key:string]:Json}} Json
 * @typedef {{command_id:string,branch_id:string,principal_id:string,
 * principal_authority_ref:string,operation:string,payload:Object,
 * expected_revisions:Array<{kind:string,id:string,revision:number}>,
 * correlation_id:string,causation_id:string}} Command
 *
 * const engine = new JobsEngine({ world_id:'world', branch_id:'main',
 *   filename:'./jobs13.sqlite', owners:new FixedOwnerStubs(fixedFixtures) });
 * const response = engine.dispatch(command); // JSON only; runtime validated.
 * engine.close();
 *
 * Fixtures are trusted host input. Never populate them from a client command.
 * Default stubs return pending; they cannot fabricate successful external effects.
 * Run isolated tests: node --test tests/system13-jobs.test.mjs
 */
export { JobsEngine, stableId, ownerKey, canonical } from "./engine.mjs";
export { JobsState, RuleError, SCHEMAS, validateRecord } from "./schema.mjs";
export {
  FixedOwnerStubs,
  OWNER_STUBS,
  requestSystem1,
  requestSystem2,
  requestSystem3,
  requestSystem4,
  requestSystem5,
  requestSystem6,
  requestSystem7,
  requestSystem8,
  requestSystem9,
  requestSystem10,
  requestSystem11,
  requestSystem12,
  requestEconomy,
  requestInventorySecurity,
  requestHealth,
  requestLegalInstitutions,
  requestDemandArtifacts,
} from "./owners.mjs";
export { hourlyEntitlement, allocateTipPool } from "./money.mjs";
export {
  validateOrganization,
  validateDefinition,
  validatePack,
} from "./content.mjs";
export { createCareerDefinitions, createCareerPack } from "./packs.mjs";
