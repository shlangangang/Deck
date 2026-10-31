/* Test actual SCNet worker pre/post DSP without downloading external model.
   Feed an identity spectrogram across four pretend stems and verify roundtrip. */
"use strict";
const vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
const assert=require("node:assert/strict");
const code=fs.readFileSync(path.join(__dirname,"..","stem-worker.js"),"utf8");
const F=2049,T=476,PLANE=F*T;
const fakeOrt={
 env:{wasm:{}},
 Tensor:class{constructor(kind,data,dims){this.kind=kind;this.data=data;this.dims=dims}dispose(){}},
 InferenceSession:{create:async()=>({
  run:async({spectrogram})=>{
   assert.deepEqual(Array.from(spectrogram.dims),[1,4,F,T]);
   const out=new Float32Array(4*4*PLANE);
   for(let stem=0;stem<4;stem++){
    for(let plane=0;plane<4;plane++){
     const data=spectrogram.data.subarray(plane*PLANE,(plane+1)*PLANE);
     const dst=stem*4*PLANE+plane*PLANE;
     for(let i=0;i<data.length;i++)out[dst+i]=data[i]/4;
    }
   }
   return {separated:{data:out}};
  }
 })}
};
async function run(frames){
 const id="stem-unit-"+frames,posted=[],left=new Float32Array(frames),right=new Float32Array(frames);
 for(let i=0;i<frames;i++){
  left[i]=.34*Math.sin(2*Math.PI*220*i/44100);
  right[i]=.19*Math.sin(2*Math.PI*330*i/44100);
 }
 let resolve,reject;const done=new Promise((yes,no)=>{resolve=yes;reject=no});
 const scope={
  ort:fakeOrt,
  self:{},
  postMessage:msg=>{
   posted.push(msg);
   if(msg.type==="done")resolve(msg);
   if(msg.type==="error")reject(new Error(msg.message));
  },
  caches:{open:async()=>({match:async()=>new Response(new Uint8Array([1]),{headers:{"Content-Length":"1"}})})},
  fetch:async()=>{throw Error("Unexpected network fetch")},
  importScripts:()=>{throw Error("Unexpected runtime import")},
  Response,Float32Array,Uint8Array,ArrayBuffer,DataView,Math,Number,
  Set,Promise,Error,console
 };
 vm.createContext(scope);
 vm.runInContext(code,scope,{filename:"stem-worker.js",timeout:9000});
 scope.self.onmessage({data:{cmd:"run",id,left:left.buffer,right:right.buffer}});
 const complete=await Promise.race([done,new Promise((_,fail)=>setTimeout(()=>fail(Error("Timeout")),75000))]);
 assert.equal(complete.frames,frames);
 const chunks=posted.filter(m=>m.type==="chunk");
 assert.equal(chunks.reduce((n,m)=>n+m.frames,0),frames);
 assert.ok(chunks.length>=1);
 const merged=Array.from({length:4},()=>new Int16Array(frames*2));
 let at=0;
 for(const chunk of chunks){
  assert.equal(chunk.outputs.length,4);
  for(let stem=0;stem<4;stem++){
   assert.equal(chunk.outputs[stem].byteLength,chunk.frames*4);
   merged[stem].set(new Int16Array(chunk.outputs[stem]),at*2);
  }
  at+=chunk.frames;
 }
 let maxError=0,sum=0;
 for(let i=0;i<frames;i++){
  const l=[0,1,2,3].reduce((v,stem)=>v+merged[stem][i*2]/32768,0);
  const r=[0,1,2,3].reduce((v,stem)=>v+merged[stem][i*2+1]/32768,0);
  maxError=Math.max(maxError,Math.abs(l-left[i]),Math.abs(r-right[i]));
  sum+=(l-left[i])**2+(r-right[i])**2;
 }
 const rmse=Math.sqrt(sum/(frames*2));
 assert.ok(rmse<.0003,"Audio mismatch: "+rmse);
 assert.ok(maxError<.001,"Signal reconstruction error: "+maxError);
 console.log("PASS STEM DSP "+frames+" frames, "+chunks.length+" chunk(s), RMSE "+rmse+", max "+maxError);
}
(async()=>{
 await run(44100);
 await run(485100+44100);
 console.log("ALL STEM DSP TESTS PASSED");
})().catch(e=>{console.error(e.stack);process.exitCode=1});
