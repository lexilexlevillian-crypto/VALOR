import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {authoredCompatibility} from '../src/game/compatibility.ts';
import {settingsSchema,validateEntity,validateState} from '../src/game/model.ts';
test('authored compatibility weights influence NPC offers without inventing player emotion',()=>{
 const traitId=randomUUID(),fromId=randomUUID(),toId=randomUUID();
 const trait=validateEntity({id:traitId,kind:'trait',name:'Patient',visibility:'campaign',data:{}});
 const from=validateEntity({id:fromId,kind:'character',name:'NPC',visibility:'campaign',data:{compatibility:{traitWeights:{[traitId]:80},requiredTraits:[],minimum:0}}});
 const to=validateEntity({id:toId,kind:'character',name:'Player',visibility:'campaign',data:{traits:[traitId]}});
 const state={clock:'2012-06-01T12:00:00.000Z',settings:settingsSchema.parse({}),entities:[trait,from,to],facts:[],knowledge:[],beliefs:[],memories:[]};
 validateState(state);assert.equal(authoredCompatibility(state,fromId,toId),80);assert.equal(authoredCompatibility(state,toId,fromId),0);
});
test('required authored traits block an NPC compatibility profile at the bounded floor',()=>{
 const traitId=randomUUID(),fromId=randomUUID(),toId=randomUUID();
 const trait=validateEntity({id:traitId,kind:'trait',name:'Required',visibility:'campaign',data:{}});
 const from=validateEntity({id:fromId,kind:'character',name:'NPC',visibility:'campaign',data:{compatibility:{traitWeights:{},requiredTraits:[traitId],minimum:0}}});
 const to=validateEntity({id:toId,kind:'character',name:'Other',visibility:'campaign',data:{}});
 const state={clock:'2012-06-01T12:00:00.000Z',settings:settingsSchema.parse({}),entities:[trait,from,to],facts:[],knowledge:[],beliefs:[],memories:[]};
 validateState(state);assert.equal(authoredCompatibility(state,fromId,toId),-100);
});
