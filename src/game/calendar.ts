import type {State} from './model.ts';
export function calendarView(s:State){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:s.settings.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(s.clock));
 const value=(key:string)=>parts.find(p=>p.type===key)!.value;
 const date=value('year')+'-'+value('month')+'-'+value('day'),hour=Number(value('hour')),month=Number(value('month')),rule=s.settings.calendar;
 const seasons=['winter','spring','summer','autumn'],index=Math.floor(month%12/3);
 return {date,timezone:s.settings.timezone,holidays:s.settings.holidays.filter(h=>h.date===date).map(h=>h.label),season:rule?seasons[(index+(rule.hemisphere==='south'?2:0))%4]:null,daylight:rule?(rule.sunriseHour<rule.sunsetHour?hour>=rule.sunriseHour&&hour<rule.sunsetHour:hour>=rule.sunriseHour||hour<rule.sunsetHour):null};
}
