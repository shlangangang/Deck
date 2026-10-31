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
function wave({seconds=3,freq=220}={}){
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
  await page.locator('#disk-file-a').setInputFiles(file('one.wav'));
  await until(page,'window.decked.status("a").loaded===true');
  assert.ok((await page.locator('#song-a').textContent()).includes('one'));
  assert.equal(await page.locator('#state-a').textContent(),'READY');
 });
 await test('play / pause / resume position advances',async()=>{
  await page.locator('#play-a').click();
  await until(page,'window.decked.status("a").playing===true');
  await page.waitForTimeout(650);
  let t1=await page.locator('#time-a').textContent();
  assert.ok(!t1.startsWith('00:00 /'),'Position did not advance: '+t1);
  await page.locator('#play-a').click();
  await until(page,'window.decked.status("a").playing===false');
  await page.locator('#play-a').click();
  await until(page,'window.decked.status("a").playing===true');
 });
 await test('cue, loop, echo, tempo, gain, filter',async()=>{
  await page.locator('#tempo-a').fill('120');
  await page.locator('#filter-a').fill('-40');
  await page.locator('#volume-a').fill('67');
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
 await test('load Deck B and move crossfader',async()=>{
  await page.locator('#file-b').setInputFiles(file('two.wav',350));
  await until(page,'window.decked.status("b").loaded===true');
  await page.locator('#play-b').click();
  await until(page,'window.decked.status("b").playing===true');
  await page.locator('#cross').fill('0');
  assert.equal(await page.locator('#cross').inputValue(),'0');
  await page.locator('#cross').fill('100');
  assert.equal(await page.locator('#cross').inputValue(),'100');
  await page.locator('#cross').fill('50');
 });
 await page.screenshot({path:path.join(out,prefix+'-playing.png'),fullPage:true});
 await test('library import and persistence',async()=>{
  await page.locator('#music-library summary').click();
  await page.locator('#lib-files').setInputFiles(file('saved.wav',420));
  await until(page, 'document.getElementById("lib-count").textContent.includes("TRACK") && document.getElementById("lib-tracks").textContent.includes("saved")',18000);
  const list=await page.locator('#lib-tracks').textContent();
  assert.ok(list.includes('saved'),'Track not listed: '+list);
  await page.locator('#lib-tracks .song-row').first().locator('.tone-a').click();
  await until(page,'window.decked.status("a").loaded');
  assert.ok((await page.locator('#song-a').textContent()).includes('saved'));
  await page.reload({waitUntil:'load'});
  await until(page,'window.decked && window.deckedLibrary');
  await until(page,'document.getElementById("lib-tracks").textContent.includes("saved")',16000);
 });
 await test('4 stems, individual level, mute and panel',async()=>{
  await page.locator('#stems-file-b').setInputFiles([file('vocals.wav',330),file('drums.wav',250),file('bass.wav',130),file('other.wav',420)]);
  await until(page,'window.decked.status("b").loaded');
  if(await page.locator('#stem-panel-b').isHidden())await page.locator('#stems-b').click();
  await page.locator('#stem-b-0').fill('25');
  await page.locator('#mute-b-2').click();
  assert.ok(await page.locator('#mute-b-2').evaluate(e=>e.classList.contains('is-muted')));
 });
 await test('converter input validation without key',async()=>{
  await page.locator('#ytp-panel summary').click();
  await page.locator('#ytp-url').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await page.locator('#ytp-rights').check();
  await page.locator('#ytp-convert').click();
  assert.ok((await page.locator('#ytp-status').textContent()).toLowerCase().includes('key'));
 });
 await page.screenshot({path:path.join(out,prefix+'-final.png'),fullPage:true});
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
