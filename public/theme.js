// IDs stay stable so saved preferences and campaign policies remain compatible.
export const THEME_IDS=[
 'neon-green-terminal','neon-pink-scene','neon-purple-night','neon-blue-electric',
 'neon-red-heat','neon-amber','neon-cyan','neon-white-chrome',
 'soft-baby-pink','soft-baby-blue','soft-butter-yellow','soft-lavender','soft-mint','neon-orange','neon-yellow'
];
export const ACCESSIBILITY_MODES=['theme','high-contrast','emergency'];
export const THEMES={
 'neon-green-terminal':{label:'Pastel Green',mood:'sage / fresh air',accent:'heart',tokens:{base:'#eaf5e9',surface:'#f7fcf5',raised:'#d6ead2',text:'#203b27',muted:'#46634a',border:'#668568',glow:'#326842',selected:'#c5e0be',success:'#246141',warning:'#795400',danger:'#a12d43',focus:'#245232',chart:'#397748',pattern:'#9ecb9a'}},
 'neon-pink-scene':{label:'Rose Pink',mood:'rose / scrapbook',accent:'heart',tokens:{base:'#ffd1dc',surface:'#fff8fa',raised:'#ffebef',text:'#462333',muted:'#704354',border:'#9e5c72',glow:'#a23660',selected:'#ffb6c1',success:'#277452',warning:'#805600',danger:'#a72e36',focus:'#7c2457',chart:'#a23660',pattern:'#ff99aa'}},
 'neon-purple-night':{label:'Pastel Purple',mood:'lilac / daydream',accent:'heart',tokens:{base:'#eee4fa',surface:'#fcf9ff',raised:'#e0d0f2',text:'#352447',muted:'#665078',border:'#89709f',glow:'#70429a',selected:'#d5bce9',success:'#277452',warning:'#805600',danger:'#a72e36',focus:'#562a7b',chart:'#7945a3',pattern:'#bda0dd'}},
 'neon-blue-electric':{label:'Pastel Blue',mood:'sky / gentle clouds',accent:'heart',tokens:{base:'#e3f1fc',surface:'#f8fcff',raised:'#cce5f7',text:'#20374c',muted:'#49647d',border:'#6a8ba7',glow:'#316b9a',selected:'#bad8f0',success:'#236d4b',warning:'#735300',danger:'#a52e35',focus:'#184b79',chart:'#3176a8',pattern:'#9bc9e9'}},
 'neon-red-heat':{label:'Soft Coral',mood:'strawberry / warm blush',accent:'heart',tokens:{base:'#ffe9e6',surface:'#fff9f7',raised:'#ffd2cb',text:'#49282b',muted:'#785052',border:'#a06c6b',glow:'#a43c4c',selected:'#ffbdb8',success:'#277452',warning:'#805600',danger:'#a72e36',focus:'#7d2334',chart:'#a43c4c',pattern:'#f29c9e'}},
 'neon-amber':{label:'Soft Peach',mood:'peach / golden hour',accent:'heart',tokens:{base:'#fff0df',surface:'#fffbf5',raised:'#ffe0bb',text:'#463124',muted:'#74563d',border:'#9b7956',glow:'#92561f',selected:'#f6d1a8',success:'#277452',warning:'#805600',danger:'#a72e36',focus:'#704011',chart:'#92561f',pattern:'#eabc89'}},
 'neon-cyan':{label:'Powder Aqua',mood:'sea glass / calm',accent:'heart',tokens:{base:'#e1f5f4',surface:'#f6fdfd',raised:'#c9e9e8',text:'#203f43',muted:'#486970',border:'#668a8e',glow:'#256a73',selected:'#b6dfdf',success:'#216346',warning:'#805600',danger:'#a72e36',focus:'#174d55',chart:'#267982',pattern:'#91cdd0'}},
 'neon-white-chrome':{label:'Pearl',mood:'soft silver / moonlight',accent:'heart',tokens:{base:'#eeedf4',surface:'#fcfbff',raised:'#dfdce9',text:'#32313f',muted:'#626071',border:'#85808f',glow:'#625b7b',selected:'#d1cddd',success:'#277452',warning:'#805600',danger:'#a72e36',focus:'#453c60',chart:'#625b7b',pattern:'#b9b2cc'}},
 'soft-baby-pink':{label:'Soft Baby Pink',mood:'baby pink / sweetheart',accent:'bow',tokens:{base:'#ffebef',surface:'#fff8fa',raised:'#ffd1dc',text:'#462333',muted:'#704354',border:'#9e5c72',glow:'#a23660',selected:'#ffb6c1',success:'#277452',warning:'#805600',danger:'#a72e36',focus:'#7c2457',chart:'#a23660',pattern:'#ff99aa'}},
 'soft-baby-blue':{label:'Soft Baby Blue',mood:'baby blue / open sky',accent:'heart',tokens:{base:'#edf6ff',surface:'#fbfdff',raised:'#d9ecfc',text:'#1c3248',muted:'#4d657c',border:'#6f8da7',glow:'#3176a8',selected:'#c6e2f7',success:'#236d4b',warning:'#735300',danger:'#a52e35',focus:'#184b79',chart:'#3176a8',pattern:'#acd3f0'}},
 'soft-butter-yellow':{label:'Soft Butter Yellow',mood:'butter / sunshine',accent:'heart',tokens:{base:'#fffbea',surface:'#fffef7',raised:'#fff2c0',text:'#403820',muted:'#6c6547',border:'#978238',glow:'#806400',selected:'#f5e4a0',success:'#376c3b',warning:'#805600',danger:'#a3332e',focus:'#604f00',chart:'#876b00',pattern:'#ead389'}},
 'soft-lavender':{label:'Soft Lavender',mood:'lavender / little wishes',accent:'bow',tokens:{base:'#f6efff',surface:'#fffbff',raised:'#e9dcf8',text:'#302039',muted:'#665273',border:'#9271a6',glow:'#7945a3',selected:'#dfc9f1',success:'#277452',warning:'#805600',danger:'#a72e36',focus:'#642480',chart:'#7945a3',pattern:'#c7a9e3'}},
 'soft-mint':{label:'Soft Mint',mood:'mint / sweet breeze',accent:'heart',tokens:{base:'#effcf6',surface:'#fbfffd',raised:'#d8f0e3',text:'#193b2e',muted:'#48665b',border:'#668f7d',glow:'#267253',selected:'#bee3cd',success:'#216346',warning:'#805600',danger:'#a72e36',focus:'#174d39',chart:'#267253',pattern:'#9dcfb5'}},
 'neon-orange':{label:'Soft Apricot',mood:'apricot / warm wishes',accent:'heart',tokens:{base:'#fff0e5',surface:'#fffaf6',raised:'#ffdbc4',text:'#4a3024',muted:'#77533e',border:'#a27557',glow:'#955025',selected:'#f8c6a4',success:'#277452',warning:'#805600',danger:'#a72e36',focus:'#713612',chart:'#955025',pattern:'#eeb187'}},
 'neon-yellow':{label:'Pastel Lemon',mood:'lemon / happy days',accent:'heart',tokens:{base:'#faf9df',surface:'#fefef4',raised:'#eeedbb',text:'#39391c',muted:'#66643c',border:'#8a8750',glow:'#716c20',selected:'#e3e09e',success:'#277452',warning:'#805600',danger:'#a72e36',focus:'#514d12',chart:'#716c20',pattern:'#d0cd7b'}}
};
export function themeById(id){return THEMES[id]||THEMES['neon-green-terminal'];}
export function applyTheme(id,allowed=THEME_IDS){
 const safe=allowed.includes(id)&&THEME_IDS.includes(id)?id:(allowed.includes('neon-green-terminal')?'neon-green-terminal':allowed.find(value=>THEME_IDS.includes(value))||'neon-green-terminal');
 const theme=themeById(safe),root=document.documentElement;
 root.dataset.theme=safe;root.dataset.tone='pastel';root.dataset.texture='none';root.dataset.accent=theme.accent;
 try{localStorage.setItem('valor.theme',safe);}catch{}
 for(const [key,value] of Object.entries(theme.tokens))root.style.setProperty('--theme-'+key,value);
 root.style.colorScheme=root.dataset.accessibility==='emergency'?'dark':'light';
 const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=theme.tokens.base;
 return safe;
}
export function applyAccessibilityMode(value){
 const mode=ACCESSIBILITY_MODES.includes(value)?value:'theme',root=document.documentElement;
 root.dataset.accessibility=mode;root.style.colorScheme=mode==='emergency'?'dark':'light';
 try{localStorage.setItem('valor.accessibility',mode);}catch{}
 return mode;
}
export function applyDecorations(value){
 const enabled=value!==false&&value!=='off';document.documentElement.dataset.decorations=enabled?'on':'off';
 try{localStorage.setItem('valor.decorations',enabled?'on':'off');}catch{}
 return enabled;
}
