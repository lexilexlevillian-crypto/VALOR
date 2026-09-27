import {ensure} from './contracts.ts';

const sensitiveKey=/^(?:password(?:_hash)?|passphrase|token(?:_hash)?|accessToken|refreshToken|access_?key|secrets?|instructions?|credentials?|authorization|cookie|csrf(?:Token)?|contacts?|phone(?:Number)?|email|messageBody|messageText|body)$/i;

export function redactSensitive(value:unknown,depth=0):unknown{
 if(depth>20)return '[REDACTED:DEPTH]';
 if(Array.isArray(value))return value.map(item=>redactSensitive(item,depth+1));
 if(value&&typeof value==='object'){
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[
   key,sensitiveKey.test(key)?'[REDACTED]':redactSensitive(item,depth+1)
  ]));
 }
 return value;
}

export function auditJson(value:unknown){
 return value===undefined||value===null?null:JSON.stringify(redactSensitive(value));
}

export function jsonBytes(value:unknown){
 return Buffer.byteLength(JSON.stringify(value),'utf8');
}

export function ensureJsonBytes(value:unknown,maximum:number,code:string,status=413){
 ensure(jsonBytes(value)<=maximum,status,code);
}
