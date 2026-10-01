// IDs stay stable so saved preferences and campaign policies remain compatible.
export const THEME_IDS=[
 'neon-green-terminal','neon-pink-scene','neon-purple-night','neon-blue-electric',
 'neon-red-heat','neon-amber','neon-cyan','neon-white-chrome',
 'soft-baby-pink','soft-baby-blue','soft-butter-yellow','soft-lavender','soft-mint','neon-orange','neon-yellow'
];
export const ACCESSIBILITY_MODES=['theme','high-contrast','emergency'];
export const THEMES={
 'neon-green-terminal':{label:'Neon Green Terminal',mood:'signal / motion',accent:'cross',tokens:{base:'#07110b',surface:'#0d1b12',raised:'#12261a',text:'#f2fff3',muted:'#b4d5b8',border:'#4b9b61',glow:'#69ff8c',selected:'#1e4e2d',success:'#79ff9a',warning:'#ffd166',danger:'#ff8f86',focus:'#d0ffda',chart:'#52e67a',pattern:'#39ff14'}},
 'neon-pink-scene':{label:'Neon Pink Scene',mood:'after-hours / pulse',accent:'heart',tokens:{base:'#180a16',surface:'#271027',raised:'#351435',text:'#fff2fb',muted:'#e0b8d5',border:'#a55691',glow:'#ff72cf',selected:'#62204e',success:'#70f0ba',warning:'#ffd166',danger:'#ff938d',focus:'#ffd0ed',chart:'#ef69c1',pattern:'#ff00aa'}},
 'neon-purple-night':{label:'Neon Purple Night',mood:'late streets / violet',accent:'star',tokens:{base:'#100b1c',surface:'#1b1230',raised:'#281a43',text:'#f7f0ff',muted:'#c9b7e0',border:'#7659a7',glow:'#bc8cff',selected:'#442d72',success:'#75e0ba',warning:'#ffd166',danger:'#ff928f',focus:'#e5d1ff',chart:'#a780ef',pattern:'#a020f0'}},
 'neon-blue-electric':{label:'Neon Blue Electric',mood:'current / glass',accent:'bolt',tokens:{base:'#07121c',surface:'#0e2232',raised:'#133047',text:'#effaff',muted:'#afd0e1',border:'#4c8caf',glow:'#66cfff',selected:'#184b68',success:'#72efbd',warning:'#ffd166',danger:'#ff928f',focus:'#c9f1ff',chart:'#59b9ee',pattern:'#008cff'}},
 'neon-red-heat':{label:'Neon Red / Black',mood:'pure red / black',accent:'star',tokens:{base:'#000000',surface:'#080000',raised:'#200000',text:'#fff5f5',muted:'#efcaca',border:'#ff0000',glow:'#ff0000',selected:'#350000',success:'#78e3ab',warning:'#ffd166',danger:'#ff958f',focus:'#ffffff',chart:'#ff0000',pattern:'#ff0000'}},
 'neon-amber':{label:'Neon Amber',mood:'streetlight / grit',accent:'spark',tokens:{base:'#171107',surface:'#251b0b',raised:'#36270e',text:'#fff8e9',muted:'#ddc69a',border:'#a4864d',glow:'#ffcf63',selected:'#5b4317',success:'#a8ed91',warning:'#ffd166',danger:'#ff958c',focus:'#ffe4a1',chart:'#eeb653',pattern:'#ffb000'}},
 'neon-cyan':{label:'Neon Cyan',mood:'cool room / scan',accent:'bolt',tokens:{base:'#061418',surface:'#0b2528',raised:'#10363a',text:'#edffff',muted:'#a9d6d6',border:'#4b9d9c',glow:'#65f4ee',selected:'#145a5a',success:'#78efb6',warning:'#ffd166',danger:'#ff958f',focus:'#c5fffc',chart:'#4dd9d5',pattern:'#00ffff'}},
 'neon-white-chrome':{label:'Neon Black & White',mood:'flash / clean edge',accent:'diamond',tokens:{base:'#000000',surface:'#1d2023',raised:'#292d31',text:'#ffffff',muted:'#c3c9ce',border:'#7f8991',glow:'#f1f7ff',selected:'#48525b',success:'#8bf0bd',warning:'#ffe08a',danger:'#ff9c96',focus:'#ffffff',chart:'#d9e8f5',pattern:'#ffffff'}},
 'soft-baby-pink':{label:'Soft Baby Pink',mood:'baby pink / sweetheart',accent:'heart',tokens:{base:'#ffebef',surface:'#fff8fa',raised:'#ffd1dc',text:'#462333',muted:'#704354',border:'#9e5c72',glow:'#a23660',selected:'#ffb6c1',success:'#277452',warning:'#805600',danger:'#a72e36',focus:'#7c2457',chart:'#a23660',pattern:'#ff99aa'}},
 'soft-baby-blue':{label:'Soft Baby Blue',mood:'baby blue / open sky',accent:'heart',tokens:{base:'#edf6ff',surface:'#fbfdff',raised:'#d9ecfc',text:'#1c3248',muted:'#4d657c',border:'#6f8da7',glow:'#3176a8',selected:'#c6e2f7',success:'#236d4b',warning:'#735300',danger:'#a52e35',focus:'#184b79',chart:'#3176a8',pattern:'#acd3f0'}},
 'soft-butter-yellow':{label:'Soft Butter Yellow',mood:'butter / sunshine',accent:'heart',tokens:{base:'#fffbea',surface:'#fffef7',raised:'#fff2c0',text:'#403820',muted:'#6c6547',border:'#978238',glow:'#806400',selected:'#f5e4a0',success:'#376c3b',warning:'#805600',danger:'#a3332e',focus:'#604f00',chart:'#876b00',pattern:'#ead389'}},
 'soft-lavender':{label:'Soft Lavender',mood:'lavender / little wishes',accent:'heart',tokens:{base:'#f6efff',surface:'#fffbff',raised:'#e9dcf8',text:'#302039',muted:'#665273',border:'#9271a6',glow:'#7945a3',selected:'#dfc9f1',success:'#277452',warning:'#805600',danger:'#a72e36',focus:'#642480',chart:'#7945a3',pattern:'#c7a9e3'}},
 'soft-mint':{label:'Soft Mint',mood:'mint / sweet breeze',accent:'heart',tokens:{base:'#effcf6',surface:'#fbfffd',raised:'#d8f0e3',text:'#193b2e',muted:'#48665b',border:'#668f7d',glow:'#267253',selected:'#bee3cd',success:'#216346',warning:'#805600',danger:'#a72e36',focus:'#174d39',chart:'#267253',pattern:'#9dcfb5'}},
 'neon-orange':{label:'Neon Orange',mood:'sunset / electric',accent:'spark',tokens:{base:'#1c0d06',surface:'#2a170b',raised:'#3d2310',text:'#fff6ed',muted:'#e0c3a9',border:'#ad8055',glow:'#ffad62',selected:'#653713',success:'#78e3ab',warning:'#ffe478',danger:'#ff958f',focus:'#ffe2c2',chart:'#ffad62',pattern:'#ff7800'}},
 'neon-yellow':{label:'Neon Yellow',mood:'high voltage / stars',accent:'star',tokens:{base:'#141405',surface:'#22220d',raised:'#303013',text:'#ffffe9',muted:'#d6d5a5',border:'#949552',glow:'#eeff61',selected:'#454a18',success:'#78e3ab',warning:'#ffcf79',danger:'#ff958f',focus:'#f6ffc2',chart:'#eeff61',pattern:'#ffff00'}}
};
export function themeById(id){return THEMES[id]||THEMES['neon-green-terminal'];}
export function applyTheme(id,allowed=THEME_IDS){
 const safe=allowed.includes(id)&&THEME_IDS.includes(id)?id:(allowed.includes('neon-green-terminal')?'neon-green-terminal':allowed.find(value=>THEME_IDS.includes(value))||'neon-green-terminal');
 const theme=themeById(safe),root=document.documentElement;
 root.dataset.theme=safe;root.dataset.tone=safe.startsWith('soft-')?'pastel':'neon';root.dataset.texture='none';root.dataset.accent=theme.accent;
 try{localStorage.setItem('valor.theme',safe);}catch{}
 for(const [key,value] of Object.entries(theme.tokens))root.style.setProperty('--theme-'+key,value);
 root.style.colorScheme=root.dataset.accessibility==='emergency'||!safe.startsWith('soft-')?'dark':'light';
 const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=theme.tokens.base;
 return safe;
}
export function applyAccessibilityMode(value){
 const mode=ACCESSIBILITY_MODES.includes(value)?value:'theme',root=document.documentElement;
 root.dataset.accessibility=mode;root.style.colorScheme=mode==='emergency'||!String(root.dataset.theme).startsWith('soft-')?'dark':'light';
 try{localStorage.setItem('valor.accessibility',mode);}catch{}
 return mode;
}
export function applyDecorations(value){
 const enabled=value!==false&&value!=='off';document.documentElement.dataset.decorations=enabled?'on':'off';
 try{localStorage.setItem('valor.decorations',enabled?'on':'off');}catch{}
 return enabled;
}
