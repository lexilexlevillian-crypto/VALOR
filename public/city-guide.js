import {CITY_PARAGRAPHS} from './city-content.js';
const el=(tag,text='',className='')=>{const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node;};
export function cityGuide(){
 const root=el('section','','city-guide'),nav=el('nav','','city-guide-nav'),body=el('div','','city-guide-body');
 nav.setAttribute('aria-label','Explore Valor');
 const pages=[['City & history',1,12],['Holiday',22,56],['Greater Running',56,70],['Centennial',70,105],['Union',105,132],['Places to visit',132,278]];
 const draw=index=>{
  body.replaceChildren();for(const [i,button]of [...nav.children].entries())button.setAttribute('aria-pressed',String(i===index));
  const [title,start,end]=pages[index];body.append(el('h2',title));
  if(index===0){
   const figure=el('figure','','city-map'),image=el('img');image.src='/city-map.png';image.alt='Valor city map: Holiday in the north, Greater Running in the west, Centennial on the eastern island, and Union in the south.';image.width=960;image.height=1280;figure.append(image);
   const zoom=el('a','Open full-size map');zoom.href='/city-map.png';zoom.target='_blank';zoom.rel='noopener';body.append(figure,zoom,el('p','Choose a region above to read its districts and neighborhoods. The map follows your selected palette.','sheet-guidance'));
   for(let i=13;i<21;i+=2){body.append(el('h3',CITY_PARAGRAPHS[i]),el('p',CITY_PARAGRAPHS[i+1]));}
  }
  let search=null;if(index===5){search=el('input');search.type='search';search.placeholder='Find a place or neighborhood';search.setAttribute('aria-label','Search city places');body.append(search);}
  const prose=el('div','','city-prose');body.append(prose);
  let section=null,previous='';
  for(const p of CITY_PARAGRAPHS.slice(start,end)){
   const address=index===5&&previous.startsWith('☆')&&p.length<80&&!p.startsWith('☆');const heading=p.startsWith('☆')||!address&&p.length<80&&p===p.toUpperCase();previous=p;
   if(heading){section=el('section','','city-entry');prose.append(section);section.append(el(p.startsWith('☆')&&!/THE |HOT SPOTS/.test(p)?'h4':'h3',p.replace(/^☆\s*┇\s*/,'').replace(/:$/,'')));}
   else {if(!section){section=el('section','','city-entry');prose.append(section);}section.append(el('p',p));}
  }
  search?.addEventListener('input',()=>{const query=search.value.toLowerCase();for(const entry of prose.children)entry.hidden=!entry.textContent.toLowerCase().includes(query);});
 };
 pages.forEach(([title],index)=>{const button=el('button',title);button.type='button';button.addEventListener('click',()=>draw(index));nav.append(button);});
 root.append(el('h1','ABOUT VALOR'),nav,body);draw(0);return root;
}
