const CACHE='valor-shell-v20';const ASSETS=['/app','/play-ui.js','/play-ui.css','/style.css','/studio.css','/app.js','/studio.js','/theme.js','/backgrounds.js','/city-content.js','/city-guide.js','/world-settings.js','/profile-rules.js','/profile-controls.js','/creation-backgrounds.js','/creation-rules.js','/creation-pools.js','/city-map.png','/manifest.webmanifest','/icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin||event.request.method!=='GET')return;
 if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(()=>caches.match('/app')));return;}
 if(ASSETS.includes(url.pathname))event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
 // Never cache session responses, API state, hidden records or mutations.
});
