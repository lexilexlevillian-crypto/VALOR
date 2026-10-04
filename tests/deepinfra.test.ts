import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DeepInfraProvider,deepInfraFromEnvironment} from '../src/game/deepinfra.ts';
import {directProvidersFromEnvironment,preferredDirectProvider} from '../src/game/direct-provider.ts';
import {validateNarration} from '../src/game/ai.ts';
import type {IntentContext} from '../src/game/ai-intent.ts';

const context={promptVersion:'test',instructions:'Only order allowed IDs.',fragments:[{id:randomUUID(),text:'The authored consequence.'}]};
const completion=(output:unknown,finish_reason='stop')=>Response.json({choices:[{finish_reason,message:{role:'assistant',content:JSON.stringify(output)}}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}});

test('DeepInfra uses its server-side bearer token, configured model and bounded JSON response',async()=>{
 let called=false;
 const fake:typeof fetch=async(url,options)=>{
  called=true;assert.equal(String(url),'https://api.deepinfra.com/v1/openai/chat/completions');
  assert.equal(new Headers(options?.headers).get('authorization'),'Bearer test-secret');
  assert.doesNotMatch(String(url)+String(options?.body),/test-secret/);
  const body=JSON.parse(String(options?.body));assert.equal(body.model,'deepseek-ai/DeepSeek-V4-Pro');assert.deepEqual(body.response_format,{type:'json_object'});assert.ok(body.max_tokens<=2048);assert.equal(options?.redirect,'error');
  return completion({order:context.fragments.map(fragment=>fragment.id)});
 };
 const provider=new DeepInfraProvider('test-secret','deepseek-ai/DeepSeek-V4-Pro',fake),raw=await provider.arrange(context,AbortSignal.timeout(1000));
 assert.equal(validateNarration(raw,context),'The authored consequence.');assert.equal(called,true);assert.ok(provider.estimateTokens(context)>Buffer.byteLength(JSON.stringify(context)));
 assert.equal(deepInfraFromEnvironment({}),undefined);assert.equal(deepInfraFromEnvironment({DEEPINFRA_API_KEY:'test-only'})?.id,'deepinfra');
 assert.throws(()=>new DeepInfraProvider('test-only','https://other-host/model'),/model_invalid/);
});

test('DeepInfra interpretation sends only the approved candidate payload and returns a selection',async()=>{
 const intent:IntentContext={version:'intent-v1',text:'Look around please',candidates:[{id:'0',label:'Look around',action:{type:'look'}}]};
 const provider=new DeepInfraProvider('test-only-key','deepseek-ai/DeepSeek-V4-Pro',async(url,options)=>{
  const body=JSON.parse(String(options?.body));assert.equal(body.max_tokens,256);assert.deepEqual(JSON.parse(body.messages[1].content),intent);assert.doesNotMatch(String(options?.body)+String(url),/test-only-key/);
  return completion({choice:'0'});
 });
 assert.ok(provider.estimateIntentTokens(intent)>256);assert.deepEqual(await provider.interpret(intent,AbortSignal.timeout(1000)),{choice:'0'});
});

test('DeepInfra rejects errors, oversized and incomplete output',async()=>{
 const provider=(response:Response)=>new DeepInfraProvider('test-secret','deepseek-ai/DeepSeek-V4-Pro',async()=>response);
 await assert.rejects(()=>provider(new Response('unauthorized',{status:401})).arrange(context,AbortSignal.timeout(1000)),/^Error: deepinfra_request_failed$/);
 await assert.rejects(()=>provider(new Response('x'.repeat(65537))).arrange(context,AbortSignal.timeout(1000)),/too_large/);
 await assert.rejects(()=>provider(completion({},'length')).arrange(context,AbortSignal.timeout(1000)),/incomplete/);
});

test('DeepInfra is preferred by default while AI_PROVIDER can retain Gemini',()=>{
 const env={DEEPINFRA_API_KEY:'deepinfra-test',GEMINI_API_KEY:'gemini-test'},providers=directProvidersFromEnvironment(env);
 assert.deepEqual(providers.map(provider=>provider.id),['deepinfra','gemini']);assert.equal(preferredDirectProvider(providers,env)?.id,'deepinfra');assert.equal(preferredDirectProvider(providers,{...env,AI_PROVIDER:'gemini'})?.id,'gemini');
});
