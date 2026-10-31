/* DECKED: on-device SCNet four-stem separator. Model by ZFTurbo,
 ONNX browser export by Eli White (github.com/elicwhite/scnet-web-wasm).
 Downloads runtime/model only, never uploads your audio. */
"use strict";
const N=4096,H=1024,T=476,F=N/2+1,P=(T-1)*H+N,CHUNK=485100,OVER=2048,RATE=44100;
const URL_MODEL="https://huggingface.co/elicwhite/scnet-browser-onnx/resolve/main/scnet_base.onnx";
const URL_ORT="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/";
const NAMES=["drums","bass","other","vocals"];
let pendingSession=null,active=null;
const cancelled=new Set();
const report=(id,stage,percent,message)=>postMessage({type:"progress",id,stage,percent,message});
async function modelSession(id){
 if(pendingSession)return pendingSession;
 pendingSession=(async()=>{
  if(typeof ort==="undefined")importScripts(URL_ORT+"ort.all.min.js");
  if(typeof ort==="undefined")throw Error("ONNX runtime unavailable");
  ort.env.wasm.wasmPaths=URL_ORT;
  ort.env.wasm.numThreads=1;
  ort.env.wasm.simd=true;
  report(id,"model",3,"Loading AI model");
  let res=null;
  try{res=await (await caches.open("decked-scnet-v1")).match(URL_MODEL)}catch(e){}
  if(!res){
   res=await fetch(URL_MODEL,{mode:"cors"});
   if(!res.ok)throw Error("Model download HTTP "+res.status);
   try{
    const clone=res.clone();
    caches.open("decked-scnet-v1").then(c=>c.put(URL_MODEL,clone)).catch(()=>{});
   }catch(e){}
  }
  const length=Number(res.headers.get("content-length"))||0;
  let model;
  if(res.body&&res.body.getReader){
   const reader=res.body.getReader(),parts=[];let total=0;
   while(true){
    if(cancelled.has(id))throw Error("Cancelled");
    const result=await reader.read();
    if(result.done)break;
    parts.push(result.value);total+=result.value.length;
    if(length)report(id,"model",Math.min(20,3+Math.floor(17*total/length)),"Model "+Math.floor(100*total/length)+"%");
   }
   model=new Uint8Array(total);
   let pos=0;for(const part of parts){model.set(part,pos);pos+=part.length}
  }else model=new Uint8Array(await res.arrayBuffer());
  report(id,"model",21,"Starting neural engine");
  return ort.InferenceSession.create(model,{executionProviders:["wasm"],graphOptimizationLevel:"all"});
 })().catch(e=>{pendingSession=null;throw e});
 return pendingSession;
}
function fft(real,imag,inverse){
 const n=real.length;
 for(let i=1,j=0;i<n;i++){
  let bit=n>>1;
  while(j&bit){j^=bit;bit>>=1}
  j^=bit;
  if(i<j){let temp=real[i];real[i]=real[j];real[j]=temp;temp=imag[i];imag[i]=imag[j];imag[j]=temp}
 }
 for(let len=2;len<=n;len*=2){
  const ang=(inverse?2:-2)*Math.PI/len,stepR=Math.cos(ang),stepI=Math.sin(ang);
  for(let k=0;k<n;k+=len){
   let wr=1,wi=0;
   for(let t=0;t<len/2;t++){
    const a=k+t,b=a+len/2;
    const xr=real[b]*wr-imag[b]*wi,xi=real[b]*wi+imag[b]*wr;
    real[b]=real[a]-xr;imag[b]=imag[a]-xi;
    real[a]+=xr;imag[a]+=xi;
    const nxt=wr*stepR-wi*stepI;
    wi=wr*stepI+wi*stepR;wr=nxt;
   }
  }
 }
 if(inverse){for(let i=0;i<n;i++){real[i]/=n;imag[i]/=n}}
}
function stft(input){
 const re=new Float32Array(N),im=new Float32Array(N);
 const real=new Float32Array(F*T),imag=new Float32Array(F*T);
 const scale=1/Math.sqrt(N);
 for(let frame=0;frame<T;frame++){
  re.set(input.subarray(frame*H,frame*H+N));im.fill(0);fft(re,im,false);
  for(let f=0;f<F;f++){const at=f*T+frame;real[at]=re[f]*scale;imag[at]=im[f]*scale}
 }
 return {real,imag};
}
function istft(data,offset,len){
 const out=new Float32Array(len),re=new Float32Array(N),im=new Float32Array(N);
 for(let frame=0;frame<T;frame++){
  const at=frame*H;if(at>=len)break;
  re.fill(0);im.fill(0);
  for(let f=0;f<F;f++){
   const p=f*T+frame;re[f]=data[offset+p];im[f]=data[offset+F*T+p];
  }
  for(let f=1;f<F-1;f++){re[N-f]=re[f];im[N-f]=-im[f]}
  fft(re,im,true);
  const limit=Math.min(N,len-at);
  for(let n=0;n<limit;n++)out[at+n]+=re[n]*Math.sqrt(N);
 }
 for(let n=0;n<len;n++){
  const lo=Math.max(0,Math.ceil((n-N+1)/H)),hi=Math.min(T-1,Math.floor(n/H));
  out[n]/=Math.max(1,hi-lo+1);
 }
 return out;
}
function pcm(l,r,end){
 const samples=Math.max(0,end),buf=new ArrayBuffer(samples*4),v=new DataView(buf);
 for(let i=0;i<samples;i++){
  const x=Math.max(-1,Math.min(1,l[i])),y=Math.max(-1,Math.min(1,r[i]));
  v.setInt16(i*4,Math.round(x*(x<0?32768:32767)),true);
  v.setInt16(i*4+2,Math.round(y*(y<0?32768:32767)),true);
 }
 return buf;
}

async function separate(id,left,right){
 if(!(left instanceof Float32Array)||!(right instanceof Float32Array)||left.length!==right.length)
  throw Error("Audio analysis input is invalid.");
 const frames=left.length;
 if(frames<RATE/10)throw Error("Track is too short.");
 if(frames>RATE*240)throw Error("iPhone stem analysis is limited to 4-minute tracks.");
 const session=await modelSession(id);
 if(cancelled.has(id))throw Error("Cancelled");
 const chunks=Math.ceil(frames/CHUNK);
 let prior=null,emitted=0;
 report(id,"analysis",22,"Separating 4 stems");
 for(let index=0;index<chunks;index++){
  if(cancelled.has(id))throw Error("Cancelled");
  const start=Math.max(0,index*CHUNK-(index>0?OVER:0));
  const end=Math.min(frames,(index+1)*CHUNK);
  const count=end-start,final=index===chunks-1;
  const leftPadded=new Float32Array(P),rightPadded=new Float32Array(P);
  leftPadded.set(left.subarray(start,end));rightPadded.set(right.subarray(start,end));
  const L=stft(leftPadded),R=stft(rightPadded),plane=F*T;
  const data=new Float32Array(4*plane);
  data.set(L.real,0);data.set(L.imag,plane);
  data.set(R.real,plane*2);data.set(R.imag,plane*3);
  const tensor=new ort.Tensor("float32",data,[1,4,F,T]);
  let inference;
  try{inference=await session.run({spectrogram:tensor})}
  finally{if(typeof tensor.dispose==="function")tensor.dispose()}
  if(cancelled.has(id))throw Error("Cancelled");
  const source=inference?.separated?.data;
  if(!source||source.length!==16*plane)throw Error("SCNet returned unexpected output.");
  const outputs=[],tails=[];
  for(let stem=0;stem<4;stem++){
   const base=stem*4*plane;
   const chL=istft(source,base,count),chR=istft(source,base+plane*2,count);
   const overlap=index>0?Math.min(OVER,chL.length,prior?.[stem]?.l.length||0):0;
   if(overlap){
    for(let i=0;i<overlap;i++){
     const blend=(i+1)/(overlap+1);
     chL[i]=prior[stem].l[i]*(1-blend)+chL[i]*blend;
     chR[i]=prior[stem].r[i]*(1-blend)+chR[i]*blend;
    }
   }
   const reserve=final?0:Math.min(OVER,count-overlap);
   const emit=count-reserve;
   outputs.push(pcm(chL,chR,emit));
   tails.push(reserve?{l:chL.slice(emit),r:chR.slice(emit)}:{l:new Float32Array(0),r:new Float32Array(0)});
  }
  prior=tails;
  const pushed=outputs[0].byteLength/4;
  emitted+=pushed;
  postMessage({type:"chunk",id,outputs,frames:pushed,part:index+1,total:chunks},outputs);
  report(id,"analysis",22+Math.floor(74*(index+1)/chunks),(index+1)+" / "+chunks);
 }
 if(emitted!==frames)throw Error("Stem length mismatch ("+emitted+"/"+frames+").");
 report(id,"done",99,"Preparing stem mixer");
 postMessage({type:"done",id,frames,rate:RATE,names:NAMES});
}
self.onmessage=async event=>{
 const m=event.data||{};
 if(m.cmd==="cancel"){cancelled.add(m.id);return}
 if(m.cmd!=="run")return;
 if(active!==null){postMessage({type:"error",id:m.id,message:"Already analyzing another song."});return}
 active=m.id;
 try{
  await separate(m.id,new Float32Array(m.left),new Float32Array(m.right));
 }catch(error){
  postMessage({type:"error",id:m.id,message:error?.message||String(error)});
 }finally{
  active=null;
  cancelled.delete(m.id);
 }
};
