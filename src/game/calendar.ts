import type {Action,State} from './model.ts';

const formatters=new Map<string,Intl.DateTimeFormat>();
export function localTime(at:string,timezone:string){
 let formatter=formatters.get(timezone);
 if(!formatter){formatter=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',weekday:'short',hourCycle:'h23'});formatters.set(timezone,formatter);}
 const parts=formatter.formatToParts(new Date(at)),value=(key:string)=>parts.find(part=>part.type===key)!.value;
 return {year:Number(value('year')),month:Number(value('month')),dayOfMonth:Number(value('day')),hour:Number(value('hour')),minute:Number(value('minute')),minuteOfDay:Number(value('hour'))*60+Number(value('minute')),weekday:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(value('weekday')),date:value('year')+'-'+value('month')+'-'+value('day')};
}

export function calendarView(s:State){
 const time=localTime(s.clock,s.settings.timezone),rule=s.settings.calendar,seasons=['winter','spring','summer','autumn'],index=Math.floor(time.month%12/3);
 return {year:time.year,month:time.month,day:time.dayOfMonth,hour:time.hour,minute:time.minute,date:time.date,timezone:s.settings.timezone,holidays:s.settings.holidays.filter(holiday=>holiday.date===time.date).map(holiday=>holiday.label),season:rule?seasons[(index+(rule.hemisphere==='south'?2:0))%4]:null,daylight:rule?(rule.sunriseHour<rule.sunsetHour?time.hour>=rule.sunriseHour&&time.hour<rule.sunsetHour:time.hour>=rule.sunriseHour||time.hour<rule.sunsetHour):null};
}

type Hours={opens:number;closes:number;days?:number[];closedOnHolidays?:boolean};
export function hoursOpen(s:State,hours:Hours|null,closedDates:string[]=[],closedWeather:string[]=[]){
 if(closedWeather.includes(s.settings.weather))return false;
 const time=localTime(s.clock,s.settings.timezone);
 if(closedDates.includes(time.date)||hours?.closedOnHolidays&&s.settings.holidays.some(holiday=>holiday.date===time.date))return false;
 if(!hours)return true;
 if(hours.days&&!hours.days.includes(time.weekday))return false;
 if(hours.opens===hours.closes)return true;
 const hour=Math.floor(time.minuteOfDay/60);
 return hours.closes>hours.opens?hour>=hours.opens&&hour<hours.closes:hour>=hours.opens||hour<hours.closes;
}

export function weatherView(s:State){
 const now=Date.parse(s.clock),entries=s.settings.weatherSchedule.slice().sort((left,right)=>left.at.localeCompare(right.at));
 const actual=entries.filter(entry=>entry.status==='actual'&&Date.parse(entry.at)<=now).at(-1);
 const forecast=entries.filter(entry=>entry.status==='forecast'&&Date.parse(entry.at)>now).map(entry=>({at:entry.at,weather:entry.weather,issuedAt:entry.issuedAt}));
 return {actual:s.settings.weather,actualSince:actual?.at??null,forecast};
}

export type TimeScale='negligible'|'short'|'scene'|'travel'|'shift'|'overnight';
export function actionTime(action:Action,minutes:number):{minutes:number;scale:TimeScale}{
 if(minutes<=0)return {minutes:0,scale:'negligible'};
 if(action.type==='travel'||action.type==='flee')return {minutes,scale:'travel'};
 if(action.type==='sleep'&&minutes>=360||minutes>=720)return {minutes,scale:'overnight'};
 if(action.type==='work'||minutes>=240)return {minutes,scale:'shift'};
 return {minutes,scale:minutes<15?'short':'scene'};
}
