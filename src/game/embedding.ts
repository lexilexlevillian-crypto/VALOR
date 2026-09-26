const DIMENSIONS=96;
function hash(text:string){
 let value=2166136261;
 for(const char of text){value^=char.charCodeAt(0);value=Math.imul(value,16777619);}
 return value>>>0;
}
export function embedText(text:string,dimensions=DIMENSIONS){
 const vector=Array.from({length:dimensions},()=>0),terms=text.toLowerCase().match(/[a-z0-9]+/g)??[];
 for(let index=0;index<terms.length;index++){
  const term=terms[index]!;
  const first=hash('t:'+term),second=hash('n:'+term+' '+(terms[index+1]??''));
  vector[first%dimensions]!+=1;
  vector[second%dimensions]!+=(first&1)?-0.5:0.5;
 }
 const norm=Math.hypot(...vector);return norm?vector.map(value=>value/norm):vector;
}
export function cosine(a:number[],b:number[]){
 if(!a.length||a.length!==b.length)return 0;
 let dot=0,left=0,right=0;for(let i=0;i<a.length;i++){dot+=a[i]!*(b[i]??0);left+=a[i]!**2;right+=(b[i]??0)**2;}
 const norm=Math.sqrt(left*right);return norm?dot/norm:0;
}
