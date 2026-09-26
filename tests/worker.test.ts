import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sendGameDelivery} from '../src/notifications-worker.ts';
const event={id:randomUUID(),timelineId:randomUUID(),revision:3,type:'turn',effects:[{text:'safe'}],clock:'2012-06-01T12:00:00.000Z'};
test('notification worker posts leased events with deduplication headers and no URL credentials',async()=>{
 let request:{input:string|URL;init:RequestInit}|undefined;
 await sendGameDelivery(event,{url:'https://hooks.example.test/valor',secret:'x'.repeat(32),fetcher:async(input,init)=>{request={input,init:init!};return new Response(null,{status:204});}});
 assert.equal(String(request!.input),'https://hooks.example.test/valor');assert.equal(request!.init?.method,'POST');
 assert.equal(new Headers(request!.init?.headers).get('x-valor-event-id'),event.id);assert.equal(new Headers(request!.init?.headers).get('authorization'),'Bearer '+'x'.repeat(32));
 assert.deepEqual(JSON.parse(String(request!.init?.body)),event);
});
test('notification worker rejects unsafe endpoints and failed delivery',async()=>{
 await assert.rejects(()=>sendGameDelivery(event,{url:'https://user:pass@hooks.example.test/valor',secret:'x'.repeat(32),fetcher:async()=>new Response(null,{status:204})}),/invalid_webhook_url/);
 await assert.rejects(()=>sendGameDelivery(event,{url:'https://hooks.example.test/valor',secret:'x'.repeat(32),fetcher:async()=>new Response(null,{status:503})}),/notification_webhook_failed/);
});
