/* DECKED AI Stem controls. Local SCNet inference, no uploads or paid service.
 * Four stems: Vocals, Drums, Bass, Other. Mobile-friendly processing UI. */
(function(){
"use strict";
const $=id=>document.getElementById(id);
const SR=44100,ORDER=["vocals","drums","bass","other"],MODEL_ORDER=["drums","bass","other","vocals"];
let running=null,sequence=0;
const archives={a:null,b:null};
function describe(side,message,percent=0,failed=false){
 const label=$("ai-label-"+side),bar=$("ai-bar-"+side),button=$("ai-"+side);
 if(label){label.textContent=message;label.classList.toggle("error",!!failed)}
 if(bar){bar.style.width=Math.min(100,Math.max(0,percent))+"%"}
 if(button){button.classList.toggle("is-working",!!running&&running.side===side)}
}
function toast(message,failed=false){
 const el=$("message");
 if(!el)return;
 el.textContent=message;el.classList.add("visible");el.classList.toggle("error",failed);
 clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("visible"),4500);
}
function wavHeader(frames,rate=SR){
 const bytes=frames*4,buf=new ArrayBuffer(44),d=new DataView(buf);
 const word=(at,value)=>{for(let i=0;i<value.length;i++)d.setUint8(at+i,value.charCodeAt(i))};
 word(0,"RIFF");d.setUint32(4,36+bytes,true);
 word(8,"WAVE");word(12,"fmt ");d.setUint32(16,16,true);
 d.setUint16(20,1,true);d.setUint16(22,2,true);
 d.setUint32(24,rate,true);d.setUint32(28,rate*4,true);
 d.setUint16(32,4,true);d.setUint16(34,16,true);
 word(36,"data");d.setUint32(40,bytes,true);
 return buf;
}
async function decode(file){
 if(!window.OfflineAudioContext)throw Error("This browser cannot decode audio locally.");
 const offline=new OfflineAudioContext(2,1,SR);
 const bytes=await file.arrayBuffer();
 const audio=await offline.decodeAudioData(bytes);
 if(!audio||!audio.length)throw Error("Unsupported audio file. Try MP3, WAV or unprotected M4A.");
 if(audio.length>SR*240)throw Error("This iPhone-friendly model supports songs up to 4 minutes.");
 const l=new Float32Array(audio.getChannelData(0));
 const r=new Float32Array(audio.getChannelData(audio.numberOfChannels>1?1:0));
 return {left:l,right:r};
}
function stopJob(message="CANCELLED"){
 if(!running)return false;
 const old=running;running=null;
 try{old.worker?.terminate()}catch(e){}
 describe(old.side,message,0);
 const control=$("ai-"+old.side);
 if(control)control.textContent="✦ AI SPLIT";
 return true;
}
function onDeckChange(side){
 archives[side]=null;
 if(running&&running.side===side)stopJob("CANCELLED");
 else describe(side,"",0);
}
function rename(original,kind){return (original?.name||"Track").replace(/\.[^.]+$/,"").slice(0,76)+" "+kind+".wav"}
async function finish(job,message){
 if(running!==job)return;
 if(message.frames!==job.frames)throw Error("Stem sample count does not match original audio.");
 const files=[];
 for(const kind of ORDER){
  const i=MODEL_ORDER.indexOf(kind),parts=job.parts[i];
  const actual=parts.reduce((sum,p)=>sum+p.byteLength,0);
  if(actual!==message.frames*4)throw Error(kind+" stem is incomplete.");
  files.push(new File([wavHeader(message.frames,message.rate),...parts],rename(job.file,kind),{type:"audio/wav"}));
 }
 if(window.decked.getFile(job.side)!==job.file)throw Error("Original track has changed.");
 running=null;
 try{job.worker.terminate()}catch(e){}
 const btn=$("ai-"+job.side);
 if(btn)btn.textContent="✦ AI SPLIT";
 const ok=await window.decked.loadStems(job.side,files,{
  ai:true,title:job.title,originalFile:job.file,preserveTime:true
 });
 if(!ok)throw Error("Failed to load the generated stems.");
 archives[job.side]={files,created:Date.now()};
 describe(job.side,"4 STEMS READY",100);
 $("stem-panel-"+job.side).hidden=false;
 $("stems-"+job.side).classList.add("is-on");
 toast("4 AI stems ready in Deck "+job.side.toUpperCase()+" · press ▶");
}
async function analyze(side){
 const btn=$("ai-"+side);
 if(running){
  if(running.side===side){stopJob("CANCELLED");toast("Stem analysis cancelled");}
  else toast("Finish or cancel Deck "+running.side.toUpperCase()+" first.");
  return;
 }
 const file=window.decked?.getFile?.(side);
 if(!file){toast("Load one audio track into Deck "+side.toUpperCase()+" first.",true);return}
 if(window.decked.status(side)?.hasStems){toast("Deck already has four stems.",true);return}
 if(!window.Worker){toast("Stem separation needs browser Worker support.",true);return}
 const id=side+"-"+(++sequence),title=window.decked.status(side)?.name||"Track";
 const job={side,id,file,title,worker:null,parts:[[],[],[],[]],frames:0};
 running=job;
 btn.textContent="× CANCEL";
 describe(side,"READING TRACK",0);
 try{
  // Decode while regular HTMLAudioElement continues playing.
  const audio=await decode(file);
  if(running!==job)return;
  job.worker=new Worker("./stem-worker.js?v=3.2.0");
  job.worker.onerror=event=>{
   if(running!==job)return;
   const message=event?.message||"Could not initialize AI stem worker.";
   stopJob("FAILED");describe(side,message,0,true);toast(message,true);
  };
  job.worker.onmessage=event=>{
   if(running!==job)return;
   const m=event.data||{};
   if(m.id!==job.id)return;
   if(m.type==="progress"){
    const p=Number(m.percent)||0;
    describe(side,m.message||"ANALYZING",p);
   }else if(m.type==="chunk"){
    if(!Array.isArray(m.outputs)||m.outputs.length!==4){stopJob("FAILED");toast("Invalid AI stem output.",true);return}
    for(let i=0;i<4;i++)job.parts[i].push(m.outputs[i]);
    job.frames+=m.frames;
   }else if(m.type==="done"){
    finish(job,m).catch(error=>{
     const text=error.message||String(error);
     if(running===job)stopJob("FAILED");
     describe(side,text,0,true);toast(text,true);
    });
   }else if(m.type==="error"){
    const text=m.message||"Stem separation failed";
    stopJob("FAILED");describe(side,text,0,true);toast(text,true);
   }
  };
  describe(side,"STARTING AI MODEL",2);
  job.worker.postMessage({
   cmd:"run",id:job.id,left:audio.left.buffer,right:audio.right.buffer
  },[audio.left.buffer,audio.right.buffer]);
 }catch(error){
  if(running!==job)return;
  stopJob("FAILED");
  describe(side,error.message||"AI separation failed",0,true);
  toast(error.message||"AI separation failed",true);
 }
}
function init(){
 for(const side of ["a","b"]){
  const btn=$("ai-"+side);
  if(btn)btn.addEventListener("click",()=>analyze(side));
 }
}
window.deckedStemAI=Object.freeze({analyze,onDeckChange,cancel:stopJob,get busy(){return !!running},getGenerated:side=>archives[side]?.files||null});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();