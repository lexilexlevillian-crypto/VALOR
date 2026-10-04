// Only observer-visible locations/routes reach this UI. Selecting a pin never travels.
export function phoneMap({$,view,pc,button,row,group,heading,text,act}){
 const browser=view.locationBrowser,places=browser?.locations??view.entities.filter(e=>e.kind==='location').map(e=>({id:e.id,name:e.name,description:e.data.description,current:e.id===pc?.data.locationId,mapPresentation:e.data.mapPresentation??{},routes:[],open:true,accessible:true}));
 const root=$('section',{class:'phone-map-app'}),viewport=$('div',{class:'phone-map-canvas interactive-city-map',tabindex:0,'aria-label':'City map. Use zoom buttons and scroll to pan.'}),canvas=$('div',{class:'city-map-layer'}),image=$('figure',{class:'phone-map-image'},$('img',{src:'/city-map.png',alt:'Valor city map',width:960,height:1280}));
 canvas.append(image);viewport.append(canvas);
 const select=$('select',{'aria-label':'Map destination'},$('option',{value:''},'Choose a place…'),...places.map(p=>$('option',{value:p.id},p.name+(p.current?' · You are here':''))));
 const detail=$('div',{class:'map-place-detail','aria-live':'polite'});let zoom=1,routeLine=null;
 const setZoom=value=>{zoom=Math.max(1,Math.min(4,value));canvas.style.width=100*zoom+'%';};
 const choose=id=>{
  const place=places.find(p=>p.id===id);select.value=id;detail.replaceChildren();routeLine?.remove();if(!place)return;
  detail.append(heading(place.name),text(place.description||'A known place in Valor.'),text(place.current?'You are here.':!place.open?'Closed right now.':!place.accessible?'Entry is restricted.':'Choose a route below.'));
  if(place.current)return;
  const routes=(place.routes??[]).flatMap(r=>r.mode.map(mode=>({...r,travelMode:mode})));
  for(const route of routes){
   const label=route.travelMode[0].toUpperCase()+route.travelMode.slice(1),minutes=route.minutes;
   const routeBox=group(row(label,(route.estimated?'About ':'')+minutes+' min'+(route.distanceKm?' · '+route.distanceKm+' km':'')+(route.fareCents?' · $'+(route.fareCents/100).toFixed(2):'')));
   if(route.bridges?.length)routeBox.append(text('Via '+route.bridges.join(', ')+' · fictional crossings'));
   let vehicleSelect=null;
   if(route.travelMode==='drive'){const vehicles=view.entities.filter(e=>e.kind==='vehicle'&&e.data.locationId===pc?.data.locationId);vehicleSelect=$('select',{'aria-label':'Vehicle for directions'},$('option',{value:''},'Choose a vehicle…'),...vehicles.map(e=>$('option',{value:e.id},e.name)));routeBox.append(vehicleSelect);}
   const go=button('Travel · '+label,()=>act({type:'travel',destinationId:place.id,mode:route.travelMode,vehicleId:vehicleSelect?.value||null}));
   go.disabled=!place.open||!place.accessible||route.locked&&!route.canUnlock||!!vehicleSelect;vehicleSelect?.addEventListener('change',()=>{go.disabled=!vehicleSelect.value||!place.open||!place.accessible||route.locked&&!route.canUnlock;});if(route.locked)routeBox.append(text(route.canUnlock?'Your carried key opens this route.':'Locked · a matching key is required.'));routeBox.append(go);detail.append(routeBox);
  }
  if(!routes.length)detail.append(text('No direct route from here. Leave the room or building first, then choose your next destination.'));
  const points=(place.routes??[]).find(r=>r.points?.length)?.points;
  if(points){const ns='http://www.w3.org/2000/svg';routeLine=document.createElementNS(ns,'svg');routeLine.setAttribute('viewBox','0 0 960 1280');routeLine.classList.add('city-route-line');routeLine.setAttribute('aria-hidden','true');const line=document.createElementNS(ns,'polyline');line.setAttribute('points',points.map(p=>p.x+','+p.y).join(' '));routeLine.append(line);canvas.append(routeLine);}
 };
 const groups=new Map();for(const place of places){const p=place.mapPresentation;if(p?.hidden||p?.x==null||p?.y==null)continue;const key=p.x+','+p.y;if(!groups.has(key)||place.current)groups.set(key,place);}
 for(const place of groups.values()){const pin=button(place.current?'●':'◆',()=>choose(place.id));pin.classList.add('city-map-pin');pin.setAttribute('aria-label',(place.current?'Current location: ':'View ')+place.name);pin.title=place.name;pin.style.left=(place.mapPresentation.x/960*100)+'%';pin.style.top=(place.mapPresentation.y/1280*100)+'%';canvas.append(pin);}
 select.addEventListener('change',()=>choose(select.value));
 root.append($('div',{class:'mobile-toolbar'},button('Zoom +',()=>setZoom(zoom+.5)),button('Zoom −',()=>setZoom(zoom-.5)),button('Locate me',()=>{setZoom(2);const place=places.find(p=>p.current);if(place){choose(place.id);const p=place.mapPresentation;if(p?.x!=null&&p?.y!=null)viewport.scrollTo({left:p.x/960*canvas.scrollWidth-viewport.clientWidth/2,top:p.y/1280*canvas.scrollHeight-viewport.clientHeight/2});}})),viewport,$('label',{class:'mobile-field'},$('span',{},'Find a place'),select),detail,text(browser?.mapScale??'Known places only. Travel follows the game clock.'));
 const current=places.find(p=>p.current);if(current)choose(current.id);return root;
}
