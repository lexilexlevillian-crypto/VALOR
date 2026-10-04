export type BankKind='item'|'weapon'|'vehicle';
export type PriceBasis='2012-msrp'|'2012-typical-retail'|'2012-used-value'|'estimated-2012-new-retail';
export type PriceConfidence='high'|'medium'|'low';

export type BankEntry={
 id:string;
 kind:BankKind;
 category:string;
 name:string;
 variant:string;
 introducedOn:string;
 price2012Cents:number;
 priceBasis:PriceBasis;
 priceConfidence:PriceConfidence;
 source:{label:string;url:string;recordId:string;notes:string};
 template:{kind:'item'|'vehicle';name:string;visibility:'creator';data:Record<string,unknown>};
};
