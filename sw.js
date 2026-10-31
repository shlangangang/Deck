/* DECKED v3 offline shell — network-first code updates, offline library remains in IndexedDB. */
const CACHE='decked-shell-v3.2.0';
const ASSETS=[
 './','./index.html','./decked.js?v=3.2.0','./library.js?v=3.0.4',
 './ytpmp3.js?v=3.0.4','./scratch-worklet.js?v=3.1.1','./stem-ai.js?v=3.2.0','./stem-worker.js?v=3.2.0','./manifest.webmanifest','./icon.svg'
];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys
  .filter(key=>key!==CACHE&&(key.startsWith('pocket-deck-')||key.startsWith('decked-shell-')))
  .map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
 const liveCode=request.mode==='navigate'||/\.(js|html)$/i.test(url.pathname);
 if(liveCode){
  event.respondWith(fetch(request).then(response=>{
   if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{});}
   return response;
  }).catch(async()=>await caches.match(request)||await caches.match('./index.html')));
 }else{
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request)));
 }
});