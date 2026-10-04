import type {State} from './model.ts';

// Deterministic fictional 2012 weather, not live weather or a historical observation.
// Maritime seasonality/rain shadow: https://www.islandcountywa.gov/545/Surface-Water
const hash=(value:number)=>{let x=value|0;x=Math.imul(x^(x>>>16),0x45d9f3b);x=Math.imul(x^(x>>>16),0x45d9f3b);return ((x^(x>>>16))>>>0)/4294967296;};
export function islandWeather(at:string){
 const instant=new Date(at),parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',hourCycle:'h23'}).formatToParts(instant);
 const n=(key:string)=>Number(parts.find(p=>p.type===key)!.value),month=n('month'),day=Math.floor((Date.UTC(n('year'),month-1,n('day'))-Date.UTC(n('year'),0,0))/86400000);
 const block=Math.floor(instant.getTime()/10800000),roll=hash(block),winter=[11,12,1,2,3].includes(month),summer=[6,7,8].includes(month);
 const weather=roll<(summer?.10:winter?.43:.29)?'rain':roll<(summer?.18:.51)?'fog':roll<(summer?.42:.82)?'overcast':'clear';
 const seasonal=11+6*Math.cos((month-7)*Math.PI/6),temperatureC=Math.round(seasonal+2*Math.sin((n('hour')-9)*Math.PI/12)+(hash(block+117)-.5)*6);
 const latitude=48.1*Math.PI/180,declination=23.44*Math.PI/180*Math.sin(2*Math.PI*(284+day)/365);
 const daylightHours=24*Math.acos(-Math.tan(latitude)*Math.tan(declination))/Math.PI;
 const offsetHours=(Date.UTC(n('year'),month-1,n('day'),n('hour'),n('minute'))-Math.floor(instant.getTime()/60000)*60000)/3600000;
 const solarNoon=12+122.6/15+offsetHours,sunrise=solarNoon-daylightHours/2,sunset=solarNoon+daylightHours/2;
 const format=(hours:number)=>{const minutes=Math.round(hours*60);return String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');};
 return {weather:(temperatureC<=1&&weather==='rain'?'snow':weather) as State['settings']['weather'],temperatureC,windKph:Math.round(4+hash(block+433)*(winter?32:18)),sunrise:format(sunrise),sunset:format(sunset),daylight:n('hour')+n('minute')/60>=sunrise&&n('hour')+n('minute')/60<sunset,season:summer?'summer':winter?'winter':[4,5].includes(month)?'spring':'autumn'};
}
export const islandClimateEnabled=(s:State)=>s.settings.weatherSimulation==='island-county'&&s.settings.timezone==='America/Los_Angeles';
export function syncWeather(s:State){
 const actual=s.settings.weatherSchedule.filter(w=>w.status==='actual'&&w.at<=s.clock).sort((a,b)=>a.at.localeCompare(b.at)).at(-1);
 if(actual)s.settings.weather=actual.weather;
 else if(islandClimateEnabled(s))s.settings.weather=islandWeather(s.clock).weather;
}
export function islandForecast(s:State){
 return Array.from({length:6},(_,i)=>{const at=new Date((Math.floor(Date.parse(s.clock)/10800000)+i+1)*10800000).toISOString();return {at,...islandWeather(at),issuedAt:s.clock};});
}
