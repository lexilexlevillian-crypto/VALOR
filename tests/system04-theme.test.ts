import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture,key,login} from './helpers.ts';
import {themeIds} from '../src/theme.ts';

const rgb=(hex:string)=>{const value=hex.replace('#','');const parts=value.length===3?[...value].map(x=>x+x):[value.slice(0,2),value.slice(2,4),value.slice(4,6)];return parts.map(x=>parseInt(x,16)/255);};
const luminance=(hex:string)=>{const values=rgb(hex).map(v=>v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4));const r=values[0]??0,g=values[1]??0,b=values[2]??0;return .2126*r+.7152*g+.0722*b;};
const contrast=(a:string,b:string)=>{const one=luminance(a),two=luminance(b);return (Math.max(one,two)+.05)/(Math.min(one,two)+.05);};

test('System 04 theme catalog exposes every required family with readable token pairs',async()=>{
 const source=readFileSync('public/theme.js','utf8');
 for(const id of themeIds){
  assert.match(source,new RegExp("'"+id+"':\\{"));
  const match=source.match(new RegExp("'"+id+"':\\{[^\\n]+"));
  assert.ok(match, id);
  for(const token of ['base','surface','raised','text','muted','border','glow','selected','success','warning','danger','focus','chart'])assert.match(match![0],new RegExp(token+':'));
  const text=match![0].match(/text:'(#[0-9a-f]+)'/)![1]!,surface=match![0].match(/surface:'(#[0-9a-f]+)'/)![1]!,focus=match![0].match(/focus:'(#[0-9a-f]+)'/)![1]!,border=match![0].match(/border:'(#[0-9a-f]+)'/)![1]!;
  assert.ok(contrast(text,surface)>=4.5,id+' text/surface');
  assert.ok(contrast(focus,surface)>=3,id+' focus/surface');
  assert.ok(contrast(border,surface)>=3,id+' border/surface');
 }
 const css=readFileSync('public/style.css','utf8');
 assert.match(css,/min-height:44px/);
 assert.match(css,/prefers-reduced-motion/);
 assert.match(css,/var\(--focus\)/);
 assert.match(css,/--base:var\(--theme-base\)/);
 assert.match(css,/\[data-accessibility=emergency\]/);
 const app=readFileSync('public/app.js','utf8');
 assert.match(app,/OVERVIEW/);assert.match(app,/STATS/);assert.match(app,/BACKGROUND/);
 assert.match(app,/Emergency high visibility/);
 assert.match(source,/applyAccessibilityMode/);
});

test('System 04 user theme persistence and Creator campaign palette policy are authorized and revisioned',async()=>{
 const f=await fixture();
 try{
  const creator=await login(f),player=await login(f,'player@example.test');
  const creatorHeaders={cookie:creator.cookie,origin:f.settings.origin,'x-csrf-token':creator.csrf,'idempotency-key':key()};
  const playerHeaders={cookie:player.cookie,origin:f.settings.origin,'x-csrf-token':player.csrf,'idempotency-key':key()};
  const initial=await f.app.inject({url:'/me/theme',headers:creatorHeaders});
  assert.equal(initial.statusCode,200);assert.equal(initial.json().themeId,'neon-green-terminal');
  const saved=await f.app.inject({method:'POST',url:'/me/theme',headers:creatorHeaders,payload:{themeId:'soft-baby-blue',expectedRevision:initial.json().revision}});
  assert.equal(saved.statusCode,200);assert.equal(saved.json().themeId,'soft-baby-blue');
  const replayRead=await f.app.inject({url:'/me/theme',headers:creatorHeaders});
  assert.equal(replayRead.json().revision,saved.json().revision);
  const policy=await f.app.inject({url:'/campaigns/'+f.campaign.id+'/theme',headers:{cookie:player.cookie}});
  assert.equal(policy.statusCode,200);assert.equal(policy.json().allowedThemes.length,themeIds.length);
  const update=await f.app.inject({method:'POST',url:'/campaigns/'+f.campaign.id+'/theme',headers:creatorHeaders,payload:{recommendedThemeId:'soft-baby-pink',allowedThemes:['soft-baby-pink','soft-baby-blue'],expectedRevision:policy.json().revision,reason:'System 04 test'}});
  assert.equal(update.statusCode,200);
  const denied=await f.app.inject({method:'POST',url:'/campaigns/'+f.campaign.id+'/theme',headers:playerHeaders,payload:{recommendedThemeId:'neon-red-heat',allowedThemes:['neon-red-heat'],expectedRevision:update.json().themeRevision}});
  assert.equal(denied.statusCode,403);
  const after=await f.domain.campaignTheme(f.creator,f.campaign.id);
  assert.deepEqual(after.allowedThemes,['soft-baby-pink','soft-baby-blue']);
  const artifact=await f.store.get<{n:number}>("SELECT count(*) n FROM artifact_schema_versions WHERE artifact_type='campaign_theme_setting' AND artifact_id=?",f.campaign.id);
  assert.equal(artifact!.n,1);
 }finally{await f.close();}
});
