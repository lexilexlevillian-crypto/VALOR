import type {BankEntry} from './master-bank-types.ts';

const SOURCE={label:'2012 US retail price basis',url:'https://www.bls.gov/cpi/factsheets/average-prices.htm',recordId:'generic-period-retail',notes:'Generic goods use representative 2012 US retail estimates. BLS average-price and CPI categories anchor staples; brand, region, tax, sale, and condition can vary.'};
type Category='object'|'clothing'|'jewelry'|'wallet'|'id'|'key'|'cash'|'card'|'document'|'food'|'drink'|'medicine'|'drug'|'substance'|'tool'|'container'|'camera'|'computer'|'storage-media'|'phone'|'weapon'|'firearm'|'magazine'|'ammo'|'armor';
type DurableSeed={slug:string;name:string;category:Category;price:number;year:number;weight:number;tags:string[];skill?:string;effect?:number;data?:Record<string,unknown>};
type ConsumableSeed={slug:string;name:string;category:'food'|'drink'|'medicine';unitPrice:number;year:number;weight:number;dose:number;tags:string[];packs:number[]};

const durable:DurableSeed[]=[
 {slug:'claw-hammer',name:'Claw hammer',category:'tool',price:1499,year:1867,weight:.75,tags:['carpentry','hammer'],skill:'Carpentry',effect:6},
 {slug:'ball-peen-hammer',name:'Ball-peen hammer',category:'tool',price:1699,year:1900,weight:.85,tags:['mechanics','hammer'],skill:'Mechanics',effect:5},
 {slug:'adjustable-wrench',name:'Adjustable wrench',category:'tool',price:1299,year:1892,weight:.45,tags:['mechanics','wrench'],skill:'Mechanics',effect:5},
 {slug:'socket-set',name:'Metric and SAE socket set',category:'tool',price:4999,year:1920,weight:4.5,tags:['mechanics','socket-set'],skill:'Mechanics',effect:10},
 {slug:'combination-wrench-set',name:'Combination wrench set',category:'tool',price:3999,year:1910,weight:3.2,tags:['mechanics','wrench-set'],skill:'Mechanics',effect:8},
 {slug:'screwdriver-set',name:'Screwdriver set',category:'tool',price:1999,year:1900,weight:1.2,tags:['repair','screwdriver'],skill:'Crafting',effect:5},
 {slug:'cordless-drill',name:'18 V cordless drill',category:'tool',price:9999,year:1980,weight:2.1,tags:['power-tool','drill'],skill:'Carpentry',effect:10},
 {slug:'circular-saw',name:'7 1/4-inch circular saw',category:'tool',price:7999,year:1924,weight:4.5,tags:['power-tool','saw'],skill:'Carpentry',effect:10},
 {slug:'handsaw',name:'Crosscut handsaw',category:'tool',price:1599,year:1800,weight:.65,tags:['saw','carpentry'],skill:'Carpentry',effect:5},
 {slug:'utility-knife',name:'Retractable utility knife',category:'tool',price:699,year:1950,weight:.18,tags:['cutting-tool'],skill:'Crafting',effect:3},
 {slug:'pliers-set',name:'Pliers set',category:'tool',price:2499,year:1900,weight:1.4,tags:['repair','pliers'],skill:'Electrical work',effect:6},
 {slug:'wire-stripper',name:'Wire stripper and crimper',category:'tool',price:1499,year:1915,weight:.25,tags:['electrical','wire-tool'],skill:'Electrical work',effect:8},
 {slug:'digital-multimeter',name:'Digital multimeter',category:'tool',price:3999,year:1977,weight:.5,tags:['electrical','meter'],skill:'Electrical work',effect:12},
 {slug:'soldering-iron',name:'30 W soldering iron kit',category:'tool',price:2499,year:1921,weight:.7,tags:['electronics','soldering'],skill:'2012 electronics / computers',effect:8},
 {slug:'flashlight',name:'LED flashlight',category:'tool',price:1999,year:1999,weight:.25,tags:['light','search'],skill:'Search',effect:4},
 {slug:'headlamp',name:'LED headlamp',category:'tool',price:2999,year:1999,weight:.12,tags:['light','hands-free'],skill:'Search',effect:6},
 {slug:'binoculars',name:'10x42 binoculars',category:'tool',price:8999,year:1950,weight:.75,tags:['optics','observation'],skill:'Search',effect:10},
 {slug:'magnifying-glass',name:'Hand magnifier',category:'tool',price:899,year:1250,weight:.12,tags:['optics','inspection'],skill:'Forensics',effect:4},
 {slug:'lockpick-set',name:'Lock pick set',category:'tool',price:2999,year:1850,weight:.18,tags:['lockpick','restricted-tool'],skill:'Lockpicking',effect:10},
 {slug:'pry-bar',name:'18-inch pry bar',category:'tool',price:1999,year:1900,weight:1.25,tags:['pry-tool','burglary'],skill:'Burglary',effect:7},
 {slug:'first-aid-kit',name:'Workplace first-aid kit',category:'medicine',price:3499,year:1888,weight:1.3,tags:['first-aid','bandage','antiseptic'],skill:'First aid',effect:12,data:{quantity:1}},
 {slug:'trauma-kit',name:'Trauma first-aid bag',category:'medicine',price:12999,year:1960,weight:3.5,tags:['first-aid','bandage','trauma-supply'],skill:'First aid',effect:18,data:{quantity:1}},
 {slug:'stethoscope',name:'Acoustic stethoscope',category:'tool',price:4999,year:1816,weight:.18,tags:['medical','assessment'],skill:'First aid',effect:8},
 {slug:'sewing-kit',name:'Household sewing kit',category:'tool',price:1299,year:1800,weight:.35,tags:['sewing','repair'],skill:'Sewing',effect:8},
 {slug:'chef-knife',name:'8-inch chef knife',category:'tool',price:3999,year:1900,weight:.25,tags:['kitchen','knife'],skill:'Cooking',effect:8},
 {slug:'cookware-set',name:'Ten-piece cookware set',category:'tool',price:9999,year:1900,weight:8,tags:['kitchen','cookware'],skill:'Cooking',effect:10},
 {slug:'camp-stove',name:'Two-burner propane camp stove',category:'tool',price:6999,year:1940,weight:5.4,tags:['camping','cooking'],skill:'Survival',effect:8},
 {slug:'compass',name:'Baseplate compass',category:'tool',price:1999,year:1933,weight:.06,tags:['navigation','compass'],skill:'Navigation',effect:12},
 {slug:'paper-road-atlas',name:'2012 road atlas',category:'document',price:1299,year:2011,weight:.7,tags:['map','navigation'],skill:'Navigation',effect:8},
 {slug:'gps-handheld',name:'Handheld GPS receiver',category:'tool',price:19999,year:1995,weight:.22,tags:['gps','navigation','battery-powered'],skill:'Navigation',effect:15},
 {slug:'fishing-rod',name:'Spinning rod and reel',category:'tool',price:4999,year:1948,weight:.8,tags:['fishing','rod'],skill:'Fishing',effect:10},
 {slug:'tackle-box',name:'Fishing tackle box',category:'container',price:2999,year:1930,weight:1.5,tags:['fishing','container'],skill:'Fishing',effect:6,data:{capacity:12}},
 {slug:'garden-tool-set',name:'Garden hand-tool set',category:'tool',price:2999,year:1900,weight:1.8,tags:['gardening','hand-tool'],skill:'Gardening',effect:8},
 {slug:'shovel',name:'Round-point shovel',category:'tool',price:2499,year:1900,weight:2.1,tags:['digging','garden-tool'],skill:'Gardening',effect:5},
 {slug:'crowbar',name:'36-inch crowbar',category:'tool',price:2999,year:1900,weight:2.4,tags:['pry-tool','heavy-tool'],skill:'Crafting',effect:6},
 {slug:'bolt-cutters',name:'24-inch bolt cutters',category:'tool',price:3999,year:1900,weight:2.6,tags:['cutting-tool','heavy-tool'],skill:'Burglary',effect:12},
 {slug:'duct-tape',name:'Duct tape roll',category:'tool',price:699,year:1942,weight:.35,tags:['repair','adhesive'],skill:'Crafting',effect:3},
 {slug:'toolbox',name:'Steel toolbox',category:'container',price:3999,year:1900,weight:4,tags:['tool-storage','container'],data:{capacity:25}},
 {slug:'backpack',name:'Day backpack',category:'container',price:4999,year:1938,weight:.9,tags:['bag','container'],data:{capacity:18}},
 {slug:'duffel-bag',name:'Large duffel bag',category:'container',price:3999,year:1915,weight:1.1,tags:['bag','container'],data:{capacity:30}},
 {slug:'hard-shell-suitcase',name:'Hard-shell suitcase',category:'container',price:9999,year:1970,weight:4.2,tags:['luggage','container'],data:{capacity:32}},
 {slug:'sleeping-bag',name:'Three-season sleeping bag',category:'object',price:7999,year:1876,weight:1.8,tags:['camping','sleep'],skill:'Survival',effect:5},
 {slug:'tent',name:'Four-person dome tent',category:'object',price:14999,year:1970,weight:5.8,tags:['camping','shelter'],skill:'Survival',effect:12},
 {slug:'rain-jacket',name:'Waterproof rain jacket',category:'clothing',price:7999,year:1950,weight:.6,tags:['outerwear','rain'],data:{wearState:'stowed'}},
 {slug:'work-boots',name:'Steel-toe work boots',category:'clothing',price:10999,year:1930,weight:1.9,tags:['footwear','protective'],data:{wearState:'stowed'}},
 {slug:'winter-coat',name:'Insulated winter coat',category:'clothing',price:12999,year:1900,weight:1.6,tags:['outerwear','cold-weather'],data:{capacity:2,wearState:'stowed'}},
 {slug:'leather-wallet',name:'Leather wallet',category:'wallet',price:2999,year:1900,weight:.12,tags:['wallet','personal']},
 {slug:'wristwatch',name:'Quartz wristwatch',category:'jewelry',price:7999,year:1969,weight:.08,tags:['watch','timepiece']},
 {slug:'point-shoot-camera',name:'Compact digital camera',category:'camera',price:14999,year:1996,weight:.22,tags:['camera','digital','photo'],skill:'Photography',effect:8},
 {slug:'dslr-camera',name:'Entry DSLR camera kit',category:'camera',price:64999,year:2003,weight:1.1,tags:['camera','digital','dslr'],skill:'Photography',effect:15},
 {slug:'voice-recorder',name:'Digital voice recorder',category:'storage-media',price:5999,year:1996,weight:.09,tags:['audio','recorder'],skill:'Investigation',effect:6},
 {slug:'usb-flash-drive',name:'16 GB USB flash drive',category:'storage-media',price:1499,year:2000,weight:.02,tags:['usb','storage','16gb']},
 {slug:'external-hard-drive',name:'1 TB USB hard drive',category:'storage-media',price:10999,year:2009,weight:.25,tags:['usb','storage','1tb']},
 {slug:'laptop',name:'2011 consumer laptop',category:'computer',price:69999,year:2011,weight:2.4,tags:['computer','laptop','wifi'],skill:'2012 electronics / computers',effect:10},
 {slug:'business-laptop',name:'2011 business laptop',category:'computer',price:119999,year:2011,weight:2.1,tags:['computer','laptop','wifi','business'],skill:'2012 electronics / computers',effect:15},
 {slug:'desktop-pc',name:'2011 desktop computer',category:'computer',price:79999,year:2011,weight:9,tags:['computer','desktop'],skill:'2012 electronics / computers',effect:12},
 {slug:'feature-phone',name:'Feature phone',category:'phone',price:4999,year:2005,weight:.11,tags:['phone','mobile'],data:{phoneType:'mobile',phoneApps:{contacts:true,messages:true,calls:true,voicemail:true,camera:true,photos:true,email:false,gps:false,social:false}}},
 {slug:'smartphone',name:'2011 smartphone',category:'phone',price:59999,year:2011,weight:.14,tags:['phone','mobile','smartphone'],data:{phoneType:'mobile'}},
 {slug:'basic-body-armor',name:'NIJ II concealable vest',category:'armor',price:49900,year:1987,weight:2.3,tags:['armor','ballistic'],data:{coverage:['torso'],protection:18,protectionClass:'II'}},
 {slug:'level-iiia-armor',name:'NIJ IIIA concealable vest',category:'armor',price:74900,year:1987,weight:3.1,tags:['armor','ballistic'],data:{coverage:['torso'],protection:25,protectionClass:'IIIA'}},
 {slug:'hard-plate-carrier',name:'NIJ III plate carrier',category:'armor',price:89900,year:1987,weight:8.5,tags:['armor','ballistic','plate'],data:{coverage:['torso'],protection:40,protectionClass:'III'}}
];

const consumable:ConsumableSeed[]=[
 {slug:'white-bread',name:'White bread loaf',category:'food',unitPrice:249,year:1928,weight:.57,dose:18,tags:['food','bread'],packs:[1,2,4]},
 {slug:'rice',name:'Long-grain rice, 1 lb',category:'food',unitPrice:129,year:1900,weight:.454,dose:15,tags:['food','grain'],packs:[1,5,10]},
 {slug:'pasta',name:'Dry pasta, 1 lb',category:'food',unitPrice:149,year:1900,weight:.454,dose:15,tags:['food','grain'],packs:[1,4,12]},
 {slug:'canned-soup',name:'Canned soup',category:'food',unitPrice:199,year:1897,weight:.53,dose:20,tags:['food','canned'],packs:[1,6,12]},
 {slug:'canned-beans',name:'Canned beans',category:'food',unitPrice:119,year:1900,weight:.45,dose:18,tags:['food','canned'],packs:[1,6,12]},
 {slug:'tuna-can',name:'Canned tuna',category:'food',unitPrice:129,year:1903,weight:.14,dose:12,tags:['food','canned','protein'],packs:[1,6,12]},
 {slug:'peanut-butter',name:'Peanut butter jar',category:'food',unitPrice:349,year:1904,weight:.51,dose:15,tags:['food','spread'],packs:[1,2,6]},
 {slug:'breakfast-cereal',name:'Breakfast cereal box',category:'food',unitPrice:399,year:1906,weight:.4,dose:12,tags:['food','cereal'],packs:[1,2,6]},
 {slug:'granola-bar',name:'Granola bar',category:'food',unitPrice:79,year:1975,weight:.042,dose:6,tags:['food','snack'],packs:[1,6,24]},
 {slug:'energy-bar',name:'Energy bar',category:'food',unitPrice:149,year:1986,weight:.068,dose:8,tags:['food','snack'],packs:[1,6,24]},
 {slug:'bottled-water',name:'Bottled water, 500 mL',category:'drink',unitPrice:129,year:1973,weight:.52,dose:25,tags:['drink','water'],packs:[1,6,24]},
 {slug:'soda-can',name:'Soda can, 12 oz',category:'drink',unitPrice:75,year:1955,weight:.37,dose:18,tags:['drink','soda'],packs:[1,12,24]},
 {slug:'sports-drink',name:'Sports drink, 20 oz',category:'drink',unitPrice:149,year:1965,weight:.62,dose:25,tags:['drink','sports'],packs:[1,6,12]},
 {slug:'coffee-ground',name:'Ground coffee, 12 oz',category:'drink',unitPrice:699,year:1900,weight:.34,dose:5,tags:['drink','coffee'],packs:[1,2,6]},
 {slug:'bandage-roll',name:'Sterile gauze roll',category:'medicine',unitPrice:249,year:1900,weight:.05,dose:0,tags:['first-aid','bandage'],packs:[1,6,24]},
 {slug:'adhesive-bandage',name:'Adhesive bandage',category:'medicine',unitPrice:15,year:1921,weight:.003,dose:0,tags:['first-aid','bandage'],packs:[20,40,100]},
 {slug:'antiseptic-wipe',name:'Antiseptic wipe',category:'medicine',unitPrice:12,year:1950,weight:.004,dose:0,tags:['first-aid','antiseptic'],packs:[10,50,100]},
 {slug:'ibuprofen',name:'Ibuprofen 200 mg tablet',category:'medicine',unitPrice:8,year:1974,weight:.001,dose:2,tags:['medicine','pain-relief'],packs:[24,50,100]},
 {slug:'acetaminophen',name:'Acetaminophen 500 mg tablet',category:'medicine',unitPrice:7,year:1955,weight:.001,dose:2,tags:['medicine','pain-relief'],packs:[24,50,100]},
 {slug:'antacid',name:'Antacid tablet',category:'medicine',unitPrice:10,year:1930,weight:.002,dose:1,tags:['medicine','antacid'],packs:[24,60,150]}
];

const quality=[{slug:'economy',label:'Economy',price:.7,condition:75,effect:.75},{slug:'standard',label:'Standard',price:1,condition:90,effect:1},{slug:'professional',label:'Professional',price:2.25,condition:100,effect:1.25}];
const slugify=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

export const itemBank:BankEntry[]=[
 ...durable.flatMap(seed=>quality.map(tier=>{
  const price=Math.max(1,Math.round(seed.price*tier.price)),id='item:'+seed.slug+'-'+tier.slug,effect=seed.skill&&seed.effect?{equipmentEffects:[{name:tier.label+' '+seed.name,value:Math.round(seed.effect*tier.effect),attributes:[],skillNames:[seed.skill],contexts:[],requiresEquipped:true}]}:{};
  return {id,kind:'item' as const,category:seed.category,name:seed.name,variant:tier.label,introducedOn:String(seed.year).padStart(4,'0')+'-01-01',price2012Cents:price,priceBasis:'2012-typical-retail' as const,priceConfidence:'medium' as const,source:SOURCE,template:{kind:'item' as const,name:tier.label+' '+seed.name,visibility:'creator' as const,data:{description:tier.label+' 2012-market '+seed.name.toLowerCase()+'.',tags:['2012-master-bank',...seed.tags,tier.slug],bankId:id,introducedOn:String(seed.year).padStart(4,'0')+'-01-01',price,priceBasis:'2012-typical-retail',priceSource:SOURCE.url,priceConfidence:'medium',category:seed.category,weight:seed.weight,condition:tier.condition,...effect,...(seed.data??{})}}};
 })),
 ...consumable.flatMap(seed=>seed.packs.map(pack=>{
  const id='item:'+seed.slug+'-'+pack,price=seed.unitPrice*pack;
  return {id,kind:'item' as const,category:seed.category,name:seed.name,variant:pack+' count',introducedOn:String(seed.year).padStart(4,'0')+'-01-01',price2012Cents:price,priceBasis:'2012-typical-retail' as const,priceConfidence:'medium' as const,source:SOURCE,template:{kind:'item' as const,name:seed.name+' ('+pack+')',visibility:'creator' as const,data:{description:pack+'-count 2012 retail package.',tags:['2012-master-bank',...seed.tags],bankId:id,introducedOn:String(seed.year).padStart(4,'0')+'-01-01',price:seed.unitPrice,priceBasis:'2012-typical-retail',priceSource:SOURCE.url,priceConfidence:'medium',category:seed.category,quantity:pack,weight:seed.weight,dose:seed.dose}}};
 }))
];

// Fail module load if a hand-edited seed could collide after expansion.
if(new Set(itemBank.map(entry=>entry.id)).size!==itemBank.length)throw new Error('duplicate_master_bank_item_id');
if(itemBank.some(entry=>entry.id!=='item:'+slugify(entry.id.slice(5))))throw new Error('invalid_master_bank_item_id');
