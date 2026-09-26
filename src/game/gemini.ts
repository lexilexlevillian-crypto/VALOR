import {z} from 'zod';
import type {NarrativeContext,NarrativeProvider} from './ai.ts';
const resultSchema=z.object({candidates:z.array(z.object({finishReason:z.string(),content:z.object({parts:z.array(z.object({text:z.string().optional(),thought:z.boolean().optional()}))})})).min(1)});
export class GeminiProvider implements NarrativeProvider{
 readonly id='gemini';
 readonly model:string;
 private apiKey:string;
 private request:typeof fetch;
 constructor(apiKey:string,model='gemini-3.8-flash',request:typeof fetch=fetch){
  if(!apiKey.trim())throw new Error('gemini_key_required');
  if(!/^gemini-[a-z0-9][a-z0-9.-]{0,80}$/.test(model))throw new Error('gemini_model_invalid');
  this.apiKey=apiKey;this.model=model;this.request=request;
 }
 private body(context:NarrativeContext){
  return {systemInstruction:{parts:[{text:context.instructions}]},
   contents:[{role:'user',parts:[{text:JSON.stringify({promptVersion:context.promptVersion,fragments:context.fragments,dossier:context.dossier})}]}],
   generationConfig:{candidateCount:1,maxOutputTokens:Math.min(2048,256+context.fragments.length*48),
    responseFormat:{text:{mimeType:'application/json',schema:{type:'object',properties:{order:{type:'array',items:{type:'string'},minItems:context.fragments.length,maxItems:context.fragments.length}},required:['order'],additionalProperties:false}}}}};
 }
 // Conservatively count every request byte as an input token, plus the output cap.
 estimateTokens(context:NarrativeContext){const body=this.body(context);return Buffer.byteLength(JSON.stringify(body))+body.generationConfig.maxOutputTokens;}
 async arrange(context:NarrativeContext,signal:AbortSignal){
  if(!context.fragments.length)return {order:[]};
  const response=await this.request('https://generativelanguage.googleapis.com/v1beta/models/'+this.model+':generateContent',
   {method:'POST',redirect:'error',signal,headers:{'content-type':'application/json','x-goog-api-key':this.apiKey},body:JSON.stringify(this.body(context))});
  if(!response.ok){await response.body?.cancel();throw new Error('gemini_request_failed');}
  const reader=response.body?.getReader();if(!reader)throw new Error('gemini_empty_response');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>65536){await reader.cancel();throw new Error('gemini_response_too_large');}chunks.push(chunk.value);}}finally{reader.releaseLock();}
  let payload:z.infer<typeof resultSchema>;
  try{payload=resultSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{throw new Error('gemini_invalid_response');}
  const candidate=payload.candidates[0]!;
  if(candidate.finishReason!=='STOP')throw new Error('gemini_incomplete_response');
  const text=candidate.content.parts.filter(part=>!part.thought&&typeof part.text==='string').map(part=>part.text).join('');
  try{return JSON.parse(text);}catch{throw new Error('gemini_invalid_output');}
 }
}
export function geminiFromEnvironment(env:NodeJS.ProcessEnv=process.env){
 const key=env.GEMINI_API_KEY?.trim()||env.GOOGLE_API_KEY?.trim();
 return key?new GeminiProvider(key,env.GEMINI_MODEL?.trim()||'gemini-3.8-flash'):undefined;
}
