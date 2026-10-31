/* One true SCNet model smoke test. Calls Hugging Face and ONNX runtime from a real browser.
   Not run for each regular app push; only for changes to this test/workflow or manual dispatch. */
"use strict";
const {chromium}=require("playwright");
const http=require("node:http"),fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const root=path.resolve(__dirname,"..");
let srv;
function serve(){
 return new Promise(resolve=>{
  srv=http.createServer((req,res)=>{
   const name=new URL(req.url,"http://127.0.0.1/").pathname;
   const filepath=path.resolve(root,"."+ (name==="/"?"/index.html":name));
   if(!filepath.startsWith(root+path.sep)||!fs.existsSync(filepath)){res.writeHead(404);res.end();return}
   const ext=path.extname(filepath);
   res.setHeader("Content-Type",ext===".js"?"text/javascript":ext===".html"?"text/html":ext===".webmanifest"?"application/manifest+json":"application/octet-stream");
   res.setHeader("Cache-Control","no-store");
   fs.createReadStream(filepath).pipe(res);
  }).listen(0,"127.0.0.1",()=>resolve("http://127.0.0.1:"+srv.address().port+"/"));
 });
}
function makeWav(seconds=1.2){
 const rate=44100,n=Math.round(seconds*rate),arr=Buffer.alloc(44+n*4);
 arr.write("RIFF",0);arr.writeUInt32LE(36+n*4,4);arr.write("WAVEfmt ",8);
 arr.writeUInt32LE(16,16);arr.writeUInt16LE(1,20);arr.writeUInt16LE(2,22);
 arr.writeUInt32LE(rate,24);arr.writeUInt32LE(rate*4,28);arr.writeUInt16LE(4,32);arr.writeUInt16LE(16,34);
 arr.write("data",36);arr.writeUInt32LE(n*4,40);
 for(let i=0;i<n;i++){
  arr.writeInt16LE(Math.round(7000*Math.sin(i*2*Math.PI*220/rate)),44+i*4);
  arr.writeInt16LE(Math.round(5000*Math.sin(i*2*Math.PI*330/rate)),44+i*4+2);
 }
 return arr;
}
(async()=>{
 const url=await serve();
 const browser=await chromium.launch({headless:true,args:["--autoplay-policy=no-user-gesture-required"]});
 const page=await browser.newPage({acceptDownloads:true,viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 page.on("pageerror",error=>console.error("PAGE ERROR",error.message));
 page.on("console",msg=>{if(msg.type()==="error")console.warn("BROWSER ERROR",msg.text())});
 try{
  await page.goto(url,{waitUntil:"load"});
  await page.locator("#file-a").setInputFiles({name:"stem-smoke.wav",mimeType:"audio/wav",buffer:makeWav()});
  await page.waitForFunction('window.decked.status("a").loaded===true');
  console.log("SCNET_TEST_START real model from Hugging Face, audio remains local");
  const start=Date.now();
  await page.locator("#ai-a").click();
  await page.waitForFunction(()=>{
   const status=document.getElementById("ai-label-a");
   return window.decked.status("a").hasStems||status.classList.contains("error");
  },null,{timeout:230000,polling:700});
  const state=await page.evaluate(()=>({stemmed:window.decked.status("a").hasStems,
   text:document.getElementById("ai-label-a").textContent,
   track:document.getElementById("song-a").textContent}));
  console.log("SCNET_TEST_STATE",JSON.stringify(state));
  assert.ok(state.stemmed,"Real AI inference failed: "+state.text);
  await page.locator("#play-a").click();
  await page.waitForFunction('window.decked.status("a").playing',null,{timeout:15000});
  await page.locator("#mute-a-0").click();
  assert.ok(await page.locator("#mute-a-0").evaluate(el=>el.classList.contains("is-muted")));
  console.log("REAL_SCNET_SMOKE_PASS elapsed="+((Date.now()-start)/1000).toFixed(1)+"s");
 }finally{await browser.close();srv.close()}
})().catch(e=>{console.error("REAL_SCNET_SMOKE_FAIL",e.stack);process.exitCode=1});
