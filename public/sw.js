const CACHE='valor-shell-v6';const ASSETS=['/app','/style.css','/app.js','/theme.js','/manifest.webmanifest','/icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin||event.request.method!=='GET')return;
 if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(()=>caches.match('/app')));return;}
 if(ASSETS.includes(url.pathname))event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
 // Never cache session responses, API state, hidden records or mutations.
});
