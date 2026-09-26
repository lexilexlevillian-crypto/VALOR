import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {GeminiProvider,geminiFromEnvironment} from '../src/game/gemini.ts';
import {validateNarration} from '../src/game/ai.ts';
import type {IntentContext} from '../src/game/ai-intent.ts';
const context={promptVersion:'test',instructions:'Only order allowed IDs.',fragments:[{id:randomUUID(),text:'The authored consequence.'}]};
test('Gemini uses server-side header credentials, configured model and a bounded structured response',async()=>{
 let called=false;
 const fake:typeof fetch=async(url,options)=>{
  called=true;assert.equal(String(url),'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  assert.equal(new Headers(options?.headers).get('x-goog-api-key'),'test-secret');
  assert.doesNotMatch(String(url)+String(options?.body),/test-secret/);
  const body=JSON.parse(String(options?.body));assert.equal(body.generationConfig.responseFormat.text.mimeType,'application/json');assert.ok(body.generationConfig.maxOutputTokens<=2048);assert.equal(options?.redirect,'error');
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({order:context.fragments.map(f=>f.id)})}]}}]});
 };
 const provider=new GeminiProvider('test-secret','gemini-3.8-flash',fake);
 const raw=await provider.arrange(context,AbortSignal.timeout(1000));
 assert.equal(validateNarration(raw,context),'The authored consequence.');assert.equal(called,true);
 assert.ok(provider.estimateTokens(context)>Buffer.byteLength(JSON.stringify(context)));
 assert.equal(geminiFromEnvironment({}),undefined);assert.equal(geminiFromEnvironment({GOOGLE_API_KEY:'test-only'})?.id,'gemini');
 assert.throws(()=>new GeminiProvider('test-only','../other-host'),/model_invalid/);
});
test('Gemini interpretation sends only the approved candidate payload and returns a selection',async()=>{
 const context:IntentContext={version:'intent-v1',text:'Look around please',candidates:[{id:'0',label:'Look around',action:{type:'look'}}]};
 const provider=new GeminiProvider('test-only-key','gemini-3.8-flash',async(url,options)=>{
  const body=JSON.parse(String(options?.body));assert.equal(body.generationConfig.maxOutputTokens,256);assert.deepEqual(JSON.parse(body.contents[0].parts[0].text),context);assert.doesNotMatch(String(options?.body)+String(url),/test-only-key/);
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"choice":"0"}'}]}}]});
 });
 assert.ok(provider.estimateIntentTokens(context)>256);assert.deepEqual(await provider.interpret(context,AbortSignal.timeout(1000)),{choice:'0'});
});
test('Gemini rejects errors, oversized or incomplete output and cannot introduce model prose',async()=>{
 const provider=(response:Response)=>new GeminiProvider('test-secret','gemini-3.8-flash',async()=>response);
 await assert.rejects(()=>provider(new Response('test-secret',{status:401})).arrange(context,AbortSignal.timeout(1000)),/^Error: gemini_request_failed$/);
 await assert.rejects(()=>provider(new Response('x'.repeat(65537))).arrange(context,AbortSignal.timeout(1000)),/too_large/);
 await assert.rejects(()=>provider(Response.json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{}'}]}}]})).arrange(context,AbortSignal.timeout(1000)),/incomplete/);
 const raw=await provider(Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({order:context.fragments.map(f=>f.id),text:'invented player consent'})}]}}]})).arrange(context,AbortSignal.timeout(1000));
 assert.throws(()=>validateNarration(raw,context));
});
