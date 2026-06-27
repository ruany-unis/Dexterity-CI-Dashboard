// service-worker.js — app-shell offline cache (PWA). Data offline is handled by
// Firestore's persistentLocalCache, not here. Bumped to v2 for the Firebase files.
const CACHE='aurora-dex-redesign-v4';
const SDK_CACHE='aurora-fb-sdk-v1';
const ASSETS=[
  './','./index.html','./styles.css','./app.js','./config.js','./firebase.js',
  './services/auth.js','./services/database.js','./services/reports.js',
  './manifest.json','./icon.svg',
  './assets/maersk-portal.png','./assets/maersk-logo.jpg','./assets/dex-robot.jpg'
];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k!==SDK_CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return; // let Firestore POST/streaming pass through untouched
  const url=e.request.url;
  // Cache-first for the Firebase SDK modules so the app loads offline after first run.
  if(url.includes('gstatic.com/firebasejs')){
    e.respondWith(caches.open(SDK_CACHE).then(async c=>{
      const hit=await c.match(e.request); if(hit)return hit;
      const res=await fetch(e.request); c.put(e.request,res.clone()); return res;
    }));
    return;
  }
  // App shell: cache-first, fall back to network.
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
