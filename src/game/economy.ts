import {simulationId as randomUUID} from './turn-runtime.ts';
import {data,getEntity,validateEntity} from './model.ts';
import type {Data,Entity,State} from './model.ts';
import {carriedBy} from './items.ts';
import {heatValue,raiseHeat} from './investigation.ts';

export type PaymentMethod='cash'|'bank'|'card'|'account';
const requireCondition=(ok:unknown,code:string)=>{if(!ok)throw new Error(code);};
const safe=(value:number)=>{requireCondition(Number.isSafeInteger(value)&&value>=0,'money_overflow');return value;};

export function accountAccess(s:State,account:Entity,characterId:string,method:PaymentMethod='account'){
 const a=data(account,'account'),authorized=a.ownerId===characterId||a.authorizedUserIds.includes(characterId);if(!authorized||a.status!=='open')return false;
 if(method!=='card')return a.accessMode!=='card';
 return a.accessMode!=='account'&&a.cardItemIds.some(itemId=>{const item=s.entities.find(entity=>entity.id===itemId&&entity.kind==='item'&&!entity.archived);return !!item&&carriedBy(s,item,characterId)&&data(item,'item').category==='card';});
}

function debitAccount(s:State,characterId:string,accountId:string,amount:number,method:PaymentMethod){
 const account=getEntity(s,accountId,'account'),a=data(account,'account');requireCondition(accountAccess(s,account,characterId,method),'account_access_denied');
 if(a.accountType==='credit'){requireCondition(a.creditLimitCents-a.debtCents-a.pendingCents>=amount,'insufficient_funds');a.debtCents=safe(a.debtCents+amount);}
 else{requireCondition(!['debt'].includes(a.accountType)&&a.balanceCents-a.pendingCents>=amount,'insufficient_funds');a.balanceCents=safe(a.balanceCents-amount);}
 account.data=a as Entity['data'];return account.id;
}

function creditAccount(s:State,accountId:string,amount:number){
 const account=getEntity(s,accountId,'account'),a=data(account,'account');requireCondition(a.status==='open','account_unavailable');
 if(['credit','debt'].includes(a.accountType)){const applied=Math.min(a.debtCents,amount);a.debtCents-=applied;a.balanceCents=safe(a.balanceCents+amount-applied);}else a.balanceCents=safe(a.balanceCents+amount);
 account.data=a as Entity['data'];return account.id;
}

export function debitCharacter(s:State,characterId:string,amount:number,method:PaymentMethod,accountId:string|null){
 const character=getEntity(s,characterId,'character'),c=data(character,'character');safe(amount);
 if(method==='cash'){requireCondition(c.cash>=amount,'insufficient_funds');c.cash-=amount;character.data=c as Entity['data'];return null;}
 if(accountId)return debitAccount(s,characterId,accountId,amount,method);
 requireCondition(method==='bank'&&c.bank>=amount,'financial_account_required');c.bank-=amount;character.data=c as Entity['data'];return null;
}

export function creditCharacter(s:State,characterId:string,amount:number,method:'cash'|'account'|'bank',accountId:string|null){
 const character=getEntity(s,characterId,'character'),c=data(character,'character');safe(amount);
 if(method==='cash'){c.cash=safe(c.cash+amount);character.data=c as Entity['data'];return null;}
 if(accountId){const account=getEntity(s,accountId,'account'),a=data(account,'account');requireCondition(a.ownerId===characterId||a.authorizedUserIds.includes(characterId),'account_access_denied');return creditAccount(s,accountId,amount);}
 requireCondition(method==='bank','financial_account_required');c.bank=safe(c.bank+amount);character.data=c as Entity['data'];return null;
}

export function debitBusiness(s:State,business:Entity,amount:number){const b=data(business,'business');safe(amount);if(b.settlementAccountId){const account=getEntity(s,b.settlementAccountId,'account'),a=data(account,'account');requireCondition(a.ownerId===business.id&&a.status==='open'&&a.balanceCents-a.pendingCents>=amount,'employer_unavailable');a.balanceCents-=amount;account.data=a as Entity['data'];return account.id;}requireCondition(b.cash>=amount,'employer_unavailable');b.cash-=amount;business.data=b as Entity['data'];return null;}
export function creditBusiness(s:State,business:Entity,amount:number){const b=data(business,'business');safe(amount);if(b.settlementAccountId)return creditAccount(s,b.settlementAccountId,amount);b.cash=safe(b.cash+amount);business.data=b as Entity['data'];return null;}

export function merchantPrice(business:Data<'business'>,baseCents:number,quantity:number,stockQuantity:number,sale=false){
 let multiplier=business.priceMultiplier*business.priceRule.neighborhoodMultiplier;
 if(!sale&&business.priceRule.scarcityTarget>0){const shortage=Math.max(0,business.priceRule.scarcityTarget-stockQuantity)/business.priceRule.scarcityTarget;multiplier*=1+shortage*business.priceRule.scarcityMarkup;}
 if(sale)multiplier*=business.priceRule.buybackMultiplier;
 let unit=Math.round(baseCents*multiplier);unit=Math.max(business.priceRule.minimumCents,unit);if(business.priceRule.maximumCents!==null)unit=Math.min(business.priceRule.maximumCents,unit);
 return {unitCents:safe(unit),totalCents:safe(unit*quantity)};
}

export function merchantAccess(s:State,business:Entity,characterId:string,operation:'buy'|'sell',stolen=false){
 const b=data(business,'business'),character=data(getEntity(s,characterId,'character'),'character');
 if(operation==='sell'){const allowed=!b.sellerPolicy.allowedCharacterIds.length||b.sellerPolicy.allowedCharacterIds.includes(characterId)||b.sellerIds.includes(characterId),tags=b.sellerPolicy.requiredTags.every(tag=>character.tags.includes(tag));requireCondition(allowed&&tags,'seller_not_authorized');requireCondition(!stolen||b.sellerPolicy.acceptsStolen||b.contraband,'merchant_refuses_stolen_goods');}
 if(b.contraband||['fence','contraband'].includes(b.category)){
  requireCondition(!b.availableLocationIds.length||!!character.locationId&&b.availableLocationIds.includes(character.locationId),'contraband_not_locally_available');
  const trust=b.factionId?data(getEntity(s,b.factionId,'faction'),'faction').reputation[characterId]??0:0;requireCondition(trust>=b.requiredTrust,'contraband_trust_required');
  const watcherId=b.factionId??business.id,heat=heatValue(s,characterId,watcherId,character.locationId);requireCondition(heat<=b.heatLimit,'contraband_heat_too_high');if(b.heatPerTransaction>0)raiseHeat(s,{subjectId:characterId,watcherId,locationId:character.locationId,reason:'contraband transaction',confidence:b.heatPerTransaction,resources:b.risk,sourceId:business.id});
 }
}

export function postTransaction(s:State,eventId:string,input:{ownerId:string;accountId?:string|null;sourceAccountId?:string|null;destinationAccountId?:string|null;direction:'debit'|'credit'|'transfer';category:Data<'transaction'>['category'];status?:'pending'|'posted'|'reversed';amountCents:number;counterpartyIds?:string[];itemIds?:string[];relatedId?:string|null;reason:string;source?:string;pendingUntil?:string|null}){
 const linkedEventId=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)?eventId:null,transaction=validateEntity({id:randomUUID(),kind:'transaction',name:input.reason,visibility:'owner',data:{ownerId:input.ownerId,accountId:input.accountId??null,sourceAccountId:input.sourceAccountId??null,destinationAccountId:input.destinationAccountId??null,direction:input.direction,category:input.category,status:input.status??'posted',amountCents:safe(input.amountCents),currency:'USD',counterpartyIds:[...new Set(input.counterpartyIds??[])],itemIds:[...new Set(input.itemIds??[])],relatedId:input.relatedId??null,eventId:linkedEventId,reason:input.reason,source:input.source??'simulation',occurredAt:s.clock,pendingUntil:input.pendingUntil??null}});s.entities.push(transaction);return transaction;
}

export function issueReceipt(s:State,eventId:string,input:{ownerId:string;businessId:string;buyerId?:string|null;sellerId?:string|null;transactionIds:string[];lines:Array<{itemId?:string|null;itemTypeId?:string|null;name:string;quantity:number;unitPriceCents:number;totalCents:number}>;paymentMethod:PaymentMethod;prefix?:string}){
 const total=input.lines.reduce((sum,line)=>safe(sum+line.totalCents),0),number=(input.prefix??'VALOR')+'-'+eventId.slice(0,8).toUpperCase();
 const receipt=validateEntity({id:randomUUID(),kind:'receipt',name:'Receipt '+number,visibility:'owner',data:{ownerId:input.ownerId,businessId:input.businessId,buyerId:input.buyerId??null,sellerId:input.sellerId??null,transactionIds:input.transactionIds,lines:input.lines.map(line=>({...line,itemId:line.itemId??null,itemTypeId:line.itemTypeId??null})),subtotalCents:total,totalCents:total,currency:'USD',paymentMethod:input.paymentMethod,issuedAt:s.clock,eventId,number}});s.entities.push(receipt);return receipt;
}

export function jobEligible(s:State,job:Data<'job'>,characterId:string){const character=data(getEntity(s,characterId,'character'),'character');return (!job.eligibility.allowedCharacterIds.length||job.eligibility.allowedCharacterIds.includes(characterId))&&job.eligibility.requiredTags.every(tag=>character.tags.includes(tag))&&Object.entries(job.eligibility.requiredSkills).every(([skillId,minimum])=>Number(character.skills[skillId]??0)>=minimum);}
