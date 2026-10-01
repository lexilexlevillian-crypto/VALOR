export type CreationEntity={id:string;kind:string;name?:string;data:any};
export const CREATION_BUDGETS:{attributes:number;skills:number;traits:number;refundCap:number};
export const ORIGINS:Array<{id:string;name:string;description:string;modifiers:Record<string,number>}>;
export function originFor(id:unknown):typeof ORIGINS[number]|undefined;
export function effectText(modifiers:Record<string,number>):string;
export function startingBudget(character:any,entities:CreationEntity[],attributeScale?:{min:number;max:number;step:number}):{attributes:number;skills:number;traits:number;refund:number;rawRefund:number;remaining:{attributes:number;skills:number;traits:number}};
export function stockTrait(name:string):{cost:number;modifiers:Record<string,number>;skill?:string;bonus?:number;description:string}|null;
