import {z} from 'zod';
import {aiProviderResponseSchema,type AiProviderAdapter,type AiRequest} from './contracts.ts';

export class HttpAiProvider implements AiProviderAdapter {
 readonly id:string;private readonly endpoint:string;private readonly secret:string;private readonly request:typeof fetch;
 constructor(id:string,endpoint:string,secret:string,request:typeof fetch=fetch){
  if(!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(id))throw new Error('provider_id_invalid');
  const url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error('provider_requires_https');
  if(secret.length<32)throw new Error('provider_secret_too_short');this.id=id;this.endpoint=endpoint;this.secret=secret;this.request=request;
 }
 async complete(request:AiRequest,signal:AbortSignal){
  const response=await this.request(this.endpoint,{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:'Bearer '+this.secret},body:JSON.stringify(request),signal});
  if(!response.ok){await response.body?.cancel();throw new Error('provider_request_failed');}
  const reader=response.body?.getReader();if(!reader)throw new Error('provider_empty_response');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>65_536){await reader.cancel();throw new Error('provider_response_too_large');}chunks.push(chunk.value);}}finally{reader.releaseLock();}
  try{return aiProviderResponseSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(error){if(error instanceof z.ZodError)throw new Error('provider_invalid_response',{cause:error});throw new Error('provider_invalid_json',{cause:error});}
 }
}
