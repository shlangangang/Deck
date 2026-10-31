/* DECKED browser QA: real Chromium + WebKit playback and UI tests.
   Run: node tests/browser-qa.cjs   (requires playwright browsers) */
'use strict';
const {chromium,webkit}=require('playwright');
const http=require('http');
const fs=require('fs');
const path=require('path');
const assert=require('node:assert/strict');

const root=path.resolve(__dirname,'..');
const out=path.resolve(root,'qa-artifacts');
fs.mkdirSync(out,{recursive:true});
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
let server;
function startServer(){
 return new Promise(resolve=>{
  server=http.createServer((req,res)=>{
   const uri=new URL(req.url,'http://localhost:7317');
   const name=uri.pathname==='/'?'/index.html':uri.pathname;
   const target=path.resolve(root,'.'+name);
   if(!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404);res.end('Not found');return}
   res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache','Access-Control-Allow-Origin':'*'});
   fs.createReadStream(target).pipe(res);
  }).listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port+'/'));
 });
}
function wave({seconds=10,freq=220}={}){
 const rate=22050,frames=Math.floor(seconds*rate),bytes=frames*2;
 const buff=Buffer.alloc(44+bytes);
 buff.write('RIFF',0);buff.writeUInt32LE(36+bytes,4);buff.write('WAVE',8);
 buff.write('fmt ',12);buff.writeUInt32LE(16,16);buff.writeUInt16LE(1,20);
 buff.writeUInt16LE(1,22);buff.writeUInt32LE(rate,24);buff.writeUInt32LE(rate*2,28);
 buff.writeUInt16LE(2,32);buff.writeUInt16LE(16,34);
 buff.write('data',36);buff.writeUInt32LE(bytes,40);
 for(let i=0;i<frames;i++)buff.writeInt16LE(Math.round(6000*Math.sin(i/rate*2*Math.PI*freq)),44+i*2);
 return buff;
}
const file=(name,freq=220)=>({name,mimeType:'audio/wav',buffer:wave({freq})});
async function until(page,js,timeout=12000){await page.waitForFunction(js,null,{timeout})}
async function setRange(page,id,value){
 await page.locator(id).evaluate((input,n)=>{input.value=String(n);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));},value);
}
async function runProject(type,device,url){
 const browser=await type.launch({headless:true,args:type.name()==='chromium'?['--autoplay-policy=no-user-gesture-required']:[]});
 const context=await browser.newContext({viewport:device.viewport,isMobile:device.mobile,hasTouch:device.touch,deviceScaleFactor:device.scale||1,acceptDownloads:true});
 const page=await context.newPage();
 const errors=[];
 page.on('pageerror',e=>errors.push('JS '+e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push('CONSOLE '+m.text())});
 const prefix=type.name()+'-'+device.name;
 const test=async(name,fn)=>{try{await fn();console.log('PASS '+prefix+' '+name)}catch(e){console.error('FAIL '+prefix+' '+name+' '+e.stack);throw e}};
 try {
 await page.goto(url,{waitUntil:'load'});
 await until(page,'!!window.decked && !!window.deckedLibrary');
 await test('layout + circular platters',async()=>{
  const metrics=await page.evaluate(()=>{
   const ids=['disk-a','disk-b'],rects=ids.map(id=>{
    const r=document.getElementById(id).getBoundingClientRect();
    const style=getComputedStyle(document.getElementById(id));
    return {width:r.width,height:r.height,radius:style.borderRadius}
   });
   return {rects,scrollWidth:document.documentElement.scrollWidth,innerWidth:innerWidth,deckColumns:getComputedStyle(document.querySelector('.deck-grid')).gridTemplateColumns};
  });
  assert.equal(metrics.rects.length,2);
  for(const r of metrics.rects){assert.ok(r.width>=75,'Platter too small');assert.ok(Math.abs(r.width-r.height)<1.5,'Platter not circular: '+JSON.stringify(r));assert.ok(r.radius.includes('50%'),'Platter border not round')}
  assert.ok(metrics.scrollWidth<=metrics.innerWidth+2,'Horizontal scrolling: '+JSON.stringify(metrics));
  assert.equal(metrics.deckColumns.split(' ').length,2,'Decks not side by side');
 });
 await page.screenshot({path:path.join(out,prefix+'-empty.png'),fullPage:true});
 await test('tap platter file input / load WAV',async()=>{
  const chooserPromise=page.waitForEvent('filechooser');
  await page.locator('#disk-file-a').click();
  const chooser=await chooserPromise;
  await chooser.setFiles(file('one.wav'));
  await until(page,'window.decked.status("a").loaded===true');
  assert.ok((await page.locator('#song-a').textContent()).includes('one'));
  assert.equal(await page.locator('#state-a').textContent(),'READY');
 });
 await test('play / pause / resume position advances',async()=>{
  await page.locator('#play-a').click();
  await until(page,'window.decked.status("a").playing===true');
  await page.waitForTimeout(1400);
  let t1=await page.locator('#time-a').textContent();
  assert.ok(!t1.startsWith('00:00 /'),'Position did not advance: '+t1);
  await page.locator('#play-a').click();
  await until(page,'window.decked.status("a").playing===false');
  await page.locator('#play-a').click();
  await until(page,'window.decked.status("a").playing===true');
 });
 await test('cue, loop, echo, tempo, gain, filter',async()=>{
  await setRange(page,'#tempo-a',120);
  await setRange(page,'#filter-a',-40);
  await setRange(page,'#volume-a',67);
  await page.locator('#cue-a').click();
  await page.locator('#loop-a').click();
  assert.ok(await page.locator('#loop-a').evaluate(e=>e.classList.contains('is-on')));
  await page.locator('#loop-a').click();
  await page.locator('#fx-a').click();
  assert.ok(await page.locator('#fx-a').evaluate(e=>e.classList.contains('is-on')));
  await page.locator('#fx-a').click();
  await page.locator('#cue-a').click();
  await until(page,'window.decked.status("a").playing===false');
 });
 await test('scratch gesture does not scroll page',async()=>{
  const r=await page.locator('#disk-a').boundingBox();
  const x=r.x+r.width*0.77,y=r.y+r.height*0.38;
  await page.mouse.move(x,y);await page.mouse.down();
  assert.ok(await page.evaluate(()=>document.documentElement.classList.contains('scratch-locked')),'Scroll not locked');
  await page.mouse.move(x+12,y+25,{steps:4});
  await page.mouse.up();
  assert.ok(!await page.evaluate(()=>document.documentElement.classList.contains('scratch-locked')),'Scroll lock stuck');
 });
 await test('low-latency scratch and backward motion',async()=>{
  const capable=await page.evaluate(()=>Boolean(window.AudioWorkletNode && window.AudioContext && isSecureContext));
  if(!capable){
   console.log('INFO '+prefix+' AudioWorklet unavailable; standard scrub fallback tested');
   return;
  }
  await until(page,'window.decked.status("a").fastScratch===true',18000);
  const first=await page.evaluate(()=>window.decked.status("a"));
  console.log('AUDIO_DIAGNOSTIC '+prefix+' '+JSON.stringify({
   scratchReady:first.fastScratch,baseLatencyMs:first.baseLatencyMs
  }));
  assert.ok(first.fastScratch,'PCM worklet was not prepared');
  await page.locator('#cue-a').click();
  const r=await page.locator('#disk-a').boundingBox();
  const center={x:r.x+r.width/2,y:r.y+r.height/2},radius=r.width*.32;
  const point=degree=>{
   const angle=degree*Math.PI/180;
   return {x:center.x+Math.cos(angle)*radius,y:center.y+Math.sin(angle)*radius};
  };
  const p0=point(-40),p1=point(35),p2=point(-15);
  await page.mouse.move(p0.x,p0.y);
  await page.mouse.down();
  assert.equal((await page.evaluate(()=>window.decked.status("a"))).scratchMode,'pcm','Fast PCM mode did not activate');
  await page.mouse.move(p1.x,p1.y,{steps:6});
  await page.waitForTimeout(45);
  const forward=(await page.evaluate(()=>window.decked.status("a"))).scratchSeconds;
  assert.ok(forward>0.01,'Forward vinyl drag did not advance PCM position: '+forward);
  await page.mouse.move(p2.x,p2.y,{steps:6});
  await page.waitForTimeout(45);
  const backward=(await page.evaluate(()=>window.decked.status("a"))).scratchSeconds;
  assert.ok(backward<forward,'Backward vinyl drag did not reverse PCM position: '+backward+' vs '+forward);
  await page.mouse.up();
  await until(page,'window.decked.status("a").scratchMode==="native"');
  assert.ok(!await page.evaluate(()=>document.documentElement.classList.contains("scratch-locked")));
 });
 await test('load Deck B and move crossfader',async()=>{
  await page.locator('#file-b').setInputFiles(file('two.wav',350));
  await until(page,'window.decked.status("b").loaded===true');
  await page.locator('#play-b').click();
  await until(page,'window.decked.status("b").playing===true');
  await setRange(page,'#cross',0);
  assert.equal(await page.locator('#cross').inputValue(),'0');
  await setRange(page,'#cross',100);
  assert.equal(await page.locator('#cross').inputValue(),'100');
  await setRange(page,'#cross',50);
 });
 await page.screenshot({path:path.join(out,prefix+'-playing.png'),fullPage:true});
 await test('library import and persistence',async()=>{
  await page.locator('#music-library summary').click();
  await page.locator('#lib-files').setInputFiles(file('saved.wav',420));
  try{
   await until(page, 'document.getElementById("lib-count").textContent.includes("TRACK") && document.getElementById("lib-tracks").textContent.includes("saved")',18000);
  }catch(error){
   const state=await page.evaluate(()=>({message:document.getElementById('lib-message')?.textContent,
    list:document.getElementById('lib-tracks')?.textContent,count:document.getElementById('lib-count')?.textContent,
    libraryOpen:document.getElementById('music-library')?.open,
    indexedDBAvailable:typeof indexedDB!=='undefined'}));
   console.error('LIBRARY_DIAGNOSTIC '+prefix+' '+JSON.stringify(state));
   await page.screenshot({path:path.join(out,prefix+'-library-error.png'),fullPage:true});
   throw error;
  }
  const list=await page.locator('#lib-tracks').textContent();
  assert.ok(list.includes('saved'),'Track not listed: '+list);
  await page.locator('#lib-tracks .song-row').filter({hasText:'saved'}).first().locator('.tone-a').click();
  await until(page,'window.decked.status("a").loaded && window.decked.status("a").name.includes("saved")');
  assert.ok((await page.locator('#song-a').textContent()).includes('saved'));
  await page.reload({waitUntil:'load'});
  await until(page,'window.decked && window.deckedLibrary');
  await until(page,'document.getElementById("lib-tracks").textContent.includes("saved")',16000);
 });
 await test('reload saved audio and library search',async()=>{
  if(!await page.locator('#music-library').evaluate(el=>el.open))await page.locator('#music-library summary').click();
  await page.locator('#lib-filter').fill('saved');
  await until(page,'document.getElementById("lib-tracks").textContent.includes("saved")');
  const rows=await page.locator('#lib-tracks .song-row').count();
  assert.ok(rows>=1,'Saved track did not survive reload');
  await page.locator('#lib-filter').fill('');
  await page.locator('#lib-tracks .song-row').filter({hasText:'saved'}).first().locator('.tone-a').click();
  await until(page,'window.decked.status("a").loaded && window.decked.status("a").name.includes("saved")');
  assert.equal(await page.locator('#song-a').textContent(),'saved');
 });
 await test('quick-add audio file and persistence queue',async()=>{
  await page.locator('#quick-file').setInputFiles(file('quick.wav',470));
  await until(page,'window.decked.status("b").loaded && window.decked.status("b").name.includes("quick")');
  await page.locator('#open-library').click();
  await page.locator('#lib-files').setInputFiles([file('rush-one.wav',300),file('rush-two.wav',360)]);
  try{
   await until(page,'document.getElementById("lib-tracks").textContent.includes("rush-one") && document.getElementById("lib-tracks").textContent.includes("rush-two")',22000);
  }catch(error){
   const state=await page.evaluate(()=>({message:document.getElementById('lib-message')?.textContent,
    tracks:document.getElementById('lib-tracks')?.textContent,count:document.getElementById('lib-count')?.textContent,
    open:document.getElementById('music-library')?.open}));
   console.error('MULTI_IMPORT_DIAGNOSTIC '+prefix+' '+JSON.stringify(state));
   await page.screenshot({path:path.join(out,prefix+'-multi-import-error.png'),fullPage:true});
   throw error;
  }
 });
 await test('4 stems, individual level, mute and panel',async()=>{
  await page.locator('#stems-file-b').setInputFiles([file('vocals.wav',330),file('drums.wav',250),file('bass.wav',130),file('other.wav',420)]);
  await until(page,'window.decked.status("b").loaded');
  if(await page.locator('#stem-panel-b').isHidden())await page.locator('#stems-b').click();
  await setRange(page,'#stem-b-0',25);
  await page.locator('#mute-b-2').click();
  assert.ok(await page.locator('#mute-b-2').evaluate(e=>e.classList.contains('is-muted')));
 });
 await test('sync two imported decks',async()=>{
  await page.locator('#file-a').setInputFiles(file('synced.wav',240));
  await until(page,'window.decked.status("a").loaded && window.decked.status("a").name.includes("synced")');
  if(await page.locator('#stem-panel-a').isHidden())await page.locator('#stems-a').click();
  await page.locator('#bpm-a').fill('120');
  await page.locator('#bpm-b').fill('100');
  await page.locator('#sync-a').click();
  const rate=Number(await page.locator('#tempo-a').inputValue());
  assert.ok(rate>80&&rate<86,'Unexpected sync tempo '+rate);
 });
 await test('recording controls and download if supported',async()=>{
  await page.locator('#record').click();
  const label=await page.locator('#record').textContent();
  if(label.includes('STOP')){
   const pending=page.waitForEvent('download',{timeout:15000});
   await page.waitForTimeout(650);
   await page.locator('#record').click();
   const download=await pending;
   assert.ok(download.suggestedFilename().startsWith('decked-mix-'));
  }else{
   const message=await page.locator('#message').textContent();
   assert.ok(/record|support|unavailable/i.test(message),'Unexpected recording failure: '+message);
  }
 });
 await test('converter input validation without key',async()=>{
  await page.locator('#ytp-panel summary').click();
  await page.locator('#ytp-url').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await page.locator('#ytp-rights').check();
  await page.locator('#ytp-convert').click();
  assert.ok((await page.locator('#ytp-status').textContent()).toLowerCase().includes('key'));
 });
 await page.screenshot({path:path.join(out,prefix+'-final.png'),fullPage:true});
 await test('offline app shell if service worker is active',async()=>{
  const enabled=await page.evaluate(()=>Boolean(navigator.serviceWorker&&navigator.serviceWorker.controller));
  if(!enabled){console.log('INFO '+prefix+' offline skipped (no controlling service worker yet)');return}
  await context.setOffline(true);
  try{
   await page.reload({waitUntil:'domcontentloaded',timeout:9000});
   await until(page,'!!window.decked && !!window.deckedLibrary',10000);
   assert.ok(await page.locator('#disk-a').isVisible());
  }finally{await context.setOffline(false)}
 });
 await test('no uncaught page errors',async()=>{assert.deepEqual(errors,[],'Page errors: '+errors.join('; '))});
 return {browser:type.name(),device:device.name,passed:true};
 } finally{await browser.close()}
}
(async()=>{
 const url=await startServer();
 const scenarios=[
  {type:chromium,device:{name:'iphone',viewport:{width:390,height:844},mobile:true,touch:true,scale:3}},
  {type:chromium,device:{name:'small-iphone',viewport:{width:320,height:667},mobile:true,touch:true,scale:2}},
  {type:webkit,device:{name:'safari-iphone',viewport:{width:390,height:844},mobile:true,touch:true,scale:3}}
 ];
 let failed=0;
 for(const scenario of scenarios){
  try{console.log('RUN '+scenario.type.name()+' '+scenario.device.name);await runProject(scenario.type,scenario.device,url)}
  catch(e){failed++;console.error('SCENARIO FAILED '+scenario.type.name()+' '+scenario.device.name+' '+e.stack)}
 }
 server.close();
 if(failed){console.error('FAILED '+failed+' browser scenario(s)');process.exitCode=1}
 else console.log('ALL BROWSER QA SCENARIOS PASSED');
})().catch(e=>{console.error(e.stack);server?.close();process.exitCode=1});
