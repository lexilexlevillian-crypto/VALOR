import {test} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {narrativeJsonSchema,narrationProbe,validateAnchoredNarration} from '../src/game/ai.ts';
import {DeepInfraProvider} from '../src/game/deepinfra.ts';
import {safeAiFailure,narrationFailureMessage} from '../src/ai/failures.ts';

test('narration contract only advertises event UUIDs, not background labels, and matches text limits',()=>{
 const {context}=narrationProbe({provider:'mock',model:'mock',configurationId:'mock-v1'});
 const schema=narrativeJsonSchema(context) as {properties:{paragraphs:{items:{properties:{sourceIds:{items:{enum:string[]}};text:{minLength:number;maxLength:number}}}}}};
 assert.deepEqual(schema.properties.paragraphs.items.properties.sourceIds.items.enum,context.fragments.map(f=>f.id));
 assert.deepEqual(schema.properties.paragraphs.items.properties.text,{type:'string',minLength:1,maxLength:4000});
 for(const bad of ['original-story-input','dossier','private_unknown_id']){
  try{validateAnchoredNarration({paragraphs:[{sourceIds:[bad],text:'Alex waited.'}]},context);assert.fail('invalid reference accepted');}
  catch(error){assert.equal(safeAiFailure(error,'output'),'ai_output_schema_invalid_source_ids');}
 }
 assert.equal(validateAnchoredNarration({paragraphs:[{sourceIds:context.fragments.map(f=>f.id),text:context.fragments.map(f=>f.text).join(' ')}]},context),context.fragments.map(f=>f.text).join(' '));
});

test('field diagnostics include only fixed structural names, not model keys, values, or issue messages',()=>{
 for(const [path,expected] of [[['paragraphs',0,'text'],'text'],[['paragraphs',0,'sourceIds',0],'source_ids'],[['paragraphs'],'paragraphs'],[['additions',0,'description'],'additions'],[['order',0],'order']] as const){
  const error=new z.ZodError([{code:'custom',path:[...path],message:'private_story_with_secret'}]);
  const code=safeAiFailure(error,'output');assert.equal(code,'ai_output_schema_invalid_'+expected);assert.doesNotMatch(narrationFailureMessage(code),/private_story|secret/);
 }
 const error=new z.ZodError([{code:'unrecognized_keys',keys:['secret_model_key'],path:[],message:'private_text'}]);
 assert.equal(safeAiFailure(error,'output'),'ai_output_schema_invalid');
});

test('DeepInfra startup probe uses the production contract with non-citable background and bounded tokens',async()=>{
 let calls=0;
 const provider=new DeepInfraProvider('test-secret','deepseek-ai/DeepSeek-V4-Pro',async(_url,options)=>{
  calls++;const body=JSON.parse(String(options?.body)),payload=JSON.parse(body.messages[1].content);
  assert.ok(payload.context.provenance.some((p:{id:string})=>p.id==='original-story-input'));
  assert.ok(payload.context.provenance.some((p:{id:string})=>p.id==='dossier'));
  assert.match(body.messages[0].content,/NEVER cite original-story-input/);
  assert.ok(Math.ceil(Buffer.byteLength(JSON.stringify(body))/2)<=2000);
  assert.equal(body.max_tokens,256);assert.doesNotMatch(String(options?.body),/test-secret/);
  const sourceIds=payload.context.provenance.filter((p:{source:string})=>p.source==='simulation').map((p:{id:string})=>p.id);
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({paragraphs:[{sourceIds,text:'Alex waited by the door.'}],additions:[]})}}],usage:{prompt_tokens:1000,completion_tokens:30}});
 });
 assert.equal((await provider.healthCheck(AbortSignal.timeout(1000))).status,'ok');assert.equal(calls,1);
});
