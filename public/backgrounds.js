// Original, code-native repeat patterns; no third-party image downloads.
export const BACKGROUNDS=['hearts','stars','checkerboard','leopard'];
const stored=(key,fallback)=>{try{return localStorage.getItem(key)??fallback;}catch{return fallback;}};
const save=(key,value)=>{try{localStorage.setItem(key,value);}catch{}};
const heart='M12 21C9 18 1 13 1 7C1 1 8-1 12 5C16-1 23 1 23 7C23 13 15 18 12 21Z';
const star='M12 1L15.2 8.3L23 9L17 14.2L18.8 22L12 18L5.2 22L7 14.2L1 9L8.8 8.3Z';
const positions=[[28,30,1.6,-18],[152,18,.9,12],[270,38,2.1,18],[340,138,1.2,-14],[206,129,1.5,-12],[80,136,2.2,12],[22,244,1.1,20],[153,252,1.9,-17],[286,261,1.1,10],[352,337,1.2,8],[235,344,1.5,-10],[71,349,1.3,-12]];
const spots=[
 'M4 10C3 3 11-1 18 3C25 1 32 8 28 16C32 23 23 29 17 26C8 31 0 24 4 18C0 15 2 13 4 10Z M10 11C8 15 8 21 15 21C21 24 24 17 21 12C19 8 13 7 10 11Z',
 'M3 7C7 1 15 2 19 0C27-2 32 7 29 12C33 18 27 27 21 25C17 32 5 28 5 22C-2 20-2 12 3 7Z M10 10C6 14 11 18 12 22C19 24 22 18 24 13C23 6 14 7 10 10Z',
 'M6 2C12-2 17 4 22 3C29 2 33 11 28 17C28 25 20 31 14 26C5 30-1 22 3 15C-2 10 1 5 6 2Z M10 9C7 12 12 15 10 20C15 25 22 19 22 14C25 8 17 7 15 10C13 8 12 7 10 9Z',
 'M2 12C-3 4 9-3 17 1C24 4 20 14 15 17C12 19 10 23 6 21C1 23-2 18 2 12Z'
];
export function patternMask(pattern){
 let art='';
 if(pattern==='checkerboard')art='<path fill="white" d="M0 0H40V40H0ZM40 40H80V80H40Z"/>';
 else if(pattern==='leopard'){
  for(let row=0;row<7;row++)for(let col=0;col<7;col++){
   const seed=row*31+col*17,x=col*57+(row%2?14:0)+(seed%11)-8,y=row*57+(seed%17)-8,scale=1.15+(seed%5)*.1;
   // Wrap edge spots into the adjacent tile, avoiding cut-off seams.
   const wrap=value=>[0,...(value<45?[400]:[]),...(value>335?[-400]:[])];
   for(const dx of wrap(x))for(const dy of wrap(y))art+='<g transform="translate('+(x+dx)+' '+(y+dy)+') rotate('+(seed%180)+' 20 20) scale('+scale+')"><path fill="white" fill-rule="evenodd" d="'+spots[(row+col*3)%spots.length]+'"/></g>';
  }
 }else{
  positions.forEach(([x,y,scale,angle],index)=>{art+='<g transform="translate('+x+' '+y+') rotate('+angle+') scale('+scale+')"><path d="'+(pattern==='stars'?star:heart)+'" fill="white" fill-opacity="'+(index%3===0?'.65':'.1')+'" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></g>';});
  for(const [x,y] of [[20,95],[170,84],[310,209],[122,204],[38,327],[240,225],[326,25],[228,318]])art+='<path d="M'+(x-4)+' '+y+'h8M'+x+' '+(y-4)+'v8" stroke="white" stroke-width="1.3"/>';
 }
 const size=pattern==='checkerboard'?80:400;
 return 'url("data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'">'+art+'</svg>')+'")';
}
export function applyBackground(value){
 const pattern=BACKGROUNDS.includes(value)?value:'hearts',root=document.documentElement;
 root.dataset.background=pattern;root.style.setProperty('--wallpaper-mask',patternMask(pattern));save('valor.background',pattern);return pattern;
}
export function applyBackgroundAnimation(value){
 const enabled=value!==false&&value!=='off';document.documentElement.dataset.backgroundMotion=enabled?'on':'off';save('valor.background-animation',enabled?'on':'off');return enabled;
}
export function initBackground(){
 if(!document.getElementById('valor-wallpaper')){const root=document.createElement('div'),layer=document.createElement('div');root.id='valor-wallpaper';root.setAttribute('aria-hidden','true');root.setAttribute('inert','');layer.className='wallpaper-layer';root.append(layer);document.body.prepend(root);}
 applyBackground(stored('valor.background','hearts'));applyBackgroundAnimation(stored('valor.background-animation','on'));
}
