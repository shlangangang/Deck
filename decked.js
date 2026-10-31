/* DECKED v3 — local-first iPhone DJ engine. No file decoding required to load. */
(function () {
"use strict";
const $ = id => document.getElementById(id);
const by = (selector, root=document) => Array.from(root.querySelectorAll(selector));
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|aif|aiff)$/i;
const MIN = (n,min,max) => Math.max(min, Math.min(max, n));
const decks = {
 a: {id:"a", voices:[], loaded:false, playing:false, loading:false, rate:1, gain:0.9, filter:0, cue:0, looping:false, loopStart:0, loopEnd:0, fx:false, scratch:false, scratchWasPlaying:false, name:"", bpm:120, urls:[], offsets:[1,1,1,1], mute:[false,false,false,false]},
 b: {id:"b", voices:[], loaded:false, playing:false, loading:false, rate:1, gain:0.9, filter:0, cue:0, looping:false, loopStart:0, loopEnd:0, fx:false, scratch:false, scratchWasPlaying:false, name:"", bpm:120, urls:[], offsets:[1,1,1,1], mute:[false,false,false,false]}
};
let audioCtx=null, master=null, recordingDest=null, recorder=null, chunks=[], toastTimer=0;
let scratchWorkletModule=null;
let crossValue=0.5, lastFrame=0, firstInteraction=false;
const supports = file => Boolean(file && file.size>0 && (AUDIO_EXT.test(file.name||"") || /^audio\//.test(file.type||"")));
function alertMessage(message, error=false) {
 const e=$("message");
 if(!e) return;
 e.textContent=message;
 e.classList.toggle("error", Boolean(error));
 e.classList.add("visible");
 clearTimeout(toastTimer);
 toastTimer=setTimeout(()=>e.classList.remove("visible"), error?6500:3400);
}
function time(sec) {
 sec=Number(sec);if(!Number.isFinite(sec)||sec<0)sec=0;
 return Math.floor(sec/60).toString().padStart(2,"0")+":"+Math.floor(sec%60).toString().padStart(2,"0");
}
function titleOf(file){
 return (file.name||"Untitled").replace(/\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|aif|aiff)$/i,"").replace(/[_]+/g," ").trim()||"Untitled";
}
function createVoice(file, d, index){
 const el=new Audio();
 el.preload="metadata";el.playsInline=true;el.setAttribute("playsinline","");
 el.crossOrigin=null;
 const url=URL.createObjectURL(file);
 d.urls.push(url);
 el.src=url;el.playbackRate=d.rate;el.volume=MIN(d.gain * (d.offsets[index]||1),0,1);
 el.addEventListener("error",()=>{
  if(!d.voices.includes(el)) return;
  d.loading=false;
  d.loaded=false;
  d.playing=false;
  draw(d);
  alertMessage("Can't play this file. Try an MP3 or unprotected M4A from Files.",true);
 });
 el.addEventListener("loadedmetadata",()=> {
  if(!d.voices.includes(el))return;
  d.loaded=true;d.loading=false;draw(d);
 });
 el.addEventListener("canplay",()=>{if(d.voices.includes(el)){d.loaded=true;d.loading=false;draw(d)}});
 el.addEventListener("ended",()=>{if(d.voices[0]===el&&!d.looping){d.playing=false;draw(d)}});
 el.load();
 return el;
}
function drop(d) {
 const old=d.voices.slice();
 for(const a of old){try{a.pause();a.removeAttribute("src");a.load()}catch(e){}}
 d.voices=[];
 if(d.graph && d.graph.inputs){for(const input of d.graph.inputs){try{input.source.disconnect();input.gain.disconnect()}catch(e){}}d.graph.inputs=[]}
 for(const url of d.urls){try{URL.revokeObjectURL(url)}catch(e){}}
 d.urls=[];d.loaded=false;d.loading=false;d.playing=false;d.looping=false;d.fx=false;d.scratch=false;
 d.originalFile=null;d.generatedStems=false;
 d.scratchGeneration=(d.scratchGeneration||0)+1;
 d.scratchFile=null;d.scratchReady=false;d.scratchPreparing=false;d.scratchMode="native";
 if(d.scratchNode){try{d.scratchNode.port.postMessage({cmd:"clear"})}catch(e){}}
}
function ensureGraph(){
 if(audioCtx)return true;
 const Context=window.AudioContext||window.webkitAudioContext;
 if(!Context)return false;
 try{
  const ctx=new Context({latencyHint:"interactive"});
  const compressor=ctx.createDynamicsCompressor();
  compressor.threshold.value=-8;compressor.knee.value=8;compressor.ratio.value=9;
  compressor.attack.value=0.008;compressor.release.value=0.14;
  master=ctx.createGain();master.gain.value=0.75;
  master.connect(compressor);compressor.connect(ctx.destination);
  recordingDest=ctx.createMediaStreamDestination();
  compressor.connect(recordingDest);
  for(const d of Object.values(decks)){
   const eq=ctx.createBiquadFilter();eq.type="allpass";
   const level=ctx.createGain();level.gain.value=d.gain;
   const fade=ctx.createGain();
   eq.connect(level);level.connect(fade);fade.connect(master);
   const delay=ctx.createDelay(2);delay.delayTime.value=0.28;
   const send=ctx.createGain();send.gain.value=0;
   const feedback=ctx.createGain();feedback.gain.value=0.22;
   eq.connect(send);send.connect(delay);delay.connect(level);delay.connect(feedback);feedback.connect(delay);
   d.graph={eq,level,fade,delay,send,feedback,inputs:[]};
  }
  audioCtx=ctx;
  for(const d of Object.values(decks)){
   attachVoices(d);
   if(d.scratchFile)prepareScratch(d);
  }
  applyMix();
  return true;
 }catch(error){
  console.warn("Web Audio unavailable; using media elements",error);
  try{audioCtx?.close()}catch(e){}
  audioCtx=null;return false;
 }
}

/* Prepare a PCM scratch deck *after* the native track is already usable.
   AudioWorklet runs 128 sample frames per quantum, avoiding slow HTMLMediaElement seeks.
   This is optional on large files or unsupported browsers. */
async function prepareScratch(d){
 if(!audioCtx||!audioCtx.audioWorklet||!window.AudioWorkletNode||!d.scratchFile||
    d.voices.length!==1||d.scratchReady||d.scratchPreparing)return;
 const file=d.scratchFile,generation=d.scratchGeneration;
 if(file.size>32*1024*1024){d.scratchMode="native";return}
 d.scratchPreparing=true;
 try{
  if(!scratchWorkletModule){
   scratchWorkletModule=audioCtx.audioWorklet.addModule("./scratch-worklet.js?v=3.1.1")
     .catch(error=>{scratchWorkletModule=null;throw error});
  }
  await scratchWorkletModule;
  if(generation!==d.scratchGeneration)return;
  // Decode in parallel with normal playback, never block the first play tap.
  const bytes=await file.arrayBuffer();
  if(generation!==d.scratchGeneration)return;
  const decoded=await audioCtx.decodeAudioData(bytes);
  if(generation!==d.scratchGeneration)return;
  // Prevent large mobile RAM spikes (WebKit may terminate oversized tabs).
  if(decoded.length>audioCtx.sampleRate*15*60)return;
  const left=decoded.getChannelData(0).slice();
  const right=decoded.numberOfChannels>1?decoded.getChannelData(1).slice():left.slice();
  if(generation!==d.scratchGeneration)return;
  if(!d.scratchNode){
   const node=new AudioWorkletNode(audioCtx,"decked-scratch",{outputChannelCount:[2]});
   node.connect(d.graph.eq);
   d.scratchNode=node;
   node.port.onmessage=event=>{
    const m=event.data||{};
    if(m.cmd==="ready"&&m.generation===d.scratchGeneration){
     d.scratchReady=true;d.scratchSampleRate=audioCtx.sampleRate;
     if($("state-"+d.id))$("state-"+d.id).title="Low-latency scratch ready";
    }
    if(m.cmd==="position"&&d.scratch&&d.scratchMode==="pcm"&&Number.isFinite(m.position)){
     if(performance.now()-(d.scratchLastPointerAt||0)>75){
      d.scratchSeconds=MIN(m.position/audioCtx.sampleRate,0,duration(d));
      draw(d);
     }
    }
   };
  }
  d.scratchNode.port.postMessage({cmd:"load",left,right,generation},[left.buffer,right.buffer]);
 }catch(error){
  console.warn("Fast vinyl scratch unavailable; using normal file playback",error);
  d.scratchReady=false;
 }finally{
  if(generation===d.scratchGeneration)d.scratchPreparing=false;
 }
}

function attachVoices(d) {
 if(!audioCtx||!d.graph)return;
 for(let i=d.graph.inputs.length;i<d.voices.length;i++){
  const voice=d.voices[i];
  try{
   const source=audioCtx.createMediaElementSource(voice);
   const gain=audioCtx.createGain();
   source.connect(gain);gain.connect(d.graph.eq);
   d.graph.inputs.push({source,gain,voice});
  }catch(error){console.warn("Audio routing failed",error);return}
 }
 setVoiceGains(d);
}
function setVoiceGains(d){
 if(d.graph&&audioCtx){
  d.graph.inputs.forEach((entry,i)=>{
   const gain=d.mute[i]?0:(d.offsets[i]??1);
   entry.gain.gain.setTargetAtTime(gain,audioCtx.currentTime,0.015);
  });
 }else{
  d.voices.forEach((voice,i)=>{voice.volume=d.mute[i]?0:MIN(d.gain*(d.offsets[i]??1)*(d.id==="a"?Math.cos(crossValue*Math.PI/2):Math.sin(crossValue*Math.PI/2)),0,1)});
 }
}
function applyMix(){
 const a=Math.cos(crossValue*Math.PI/2),b=Math.sin(crossValue*Math.PI/2);
 for(const d of Object.values(decks)){
  if(d.graph&&audioCtx){
   d.graph.level.gain.setTargetAtTime(d.gain,audioCtx.currentTime,0.009);
   d.graph.fade.gain.setTargetAtTime(d.id==="a"?a:b,audioCtx.currentTime,0.006);
  }else setVoiceGains(d);
 }
}
function applyFilter(d){
 if(!d.graph||!audioCtx)return;
 const eq=d.graph.eq,f=d.filter;
 if(Math.abs(f)<4){eq.type="allpass";return}
 eq.type=f<0?"lowpass":"highpass";
 const hz=f<0?18000*Math.pow(0.017,Math.abs(f)/100):50*Math.pow(150,Math.abs(f)/100);
 eq.frequency.setTargetAtTime(MIN(hz,70,19000),audioCtx.currentTime,0.01);
 eq.Q.value=0.7;
}
function applyEcho(d){
 if(d.graph&&audioCtx)d.graph.send.gain.setTargetAtTime(d.fx?0.28:0,audioCtx.currentTime,0.015);
}
function primary(d){return d.voices[0]||null}
function position(d){return primary(d)?.currentTime||0}
function duration(d){const v=primary(d);return v&&Number.isFinite(v.duration)?v.duration:0}
function seek(d,seconds){
 const end=duration(d);
 const t=MIN(Number(seconds)||0,0,Math.max(0,end-0.01));
 for(const voice of d.voices){try{voice.currentTime=t}catch(e){}}
 draw(d);return t;
}
function setRate(d){d.voices.forEach(v=>{v.playbackRate=d.rate});}
function draw(d){
 const song=$("song-"+d.id),state=$("state-"+d.id),disk=$("disk-"+d.id),play=$("play-"+d.id);
 song.textContent=d.name||"Choose a track";
 state.textContent=d.loading?"LOADING":d.loaded?(d.playing?"PLAYING":"READY"):"EMPTY";
 state.classList.toggle("is-playing",d.playing);
 disk.classList.toggle("is-playing",d.playing);
 disk.classList.toggle("is-empty",!d.loaded);
 disk.classList.toggle("scratching",d.scratch);
 play.textContent=d.playing?"❚❚":"▶";
 play.setAttribute("aria-label",(d.playing?"Pause":"Play")+" deck "+d.id.toUpperCase());
 const now=d.scratch&&d.scratchMode==="pcm"?d.scratchSeconds:position(d);
 $("time-"+d.id).textContent=time(now)+" / "+time(duration(d));
 const length=duration(d),percent=length?MIN(now/length*100,0,100):0;
 const seekbar=$("seek-"+d.id);
 if(!seekbar.matches(":active")&&!seekbar.dataset.dragging)seekbar.value=String(percent);
 seekbar.style.setProperty("--progress",percent+"%");
 $("loop-"+d.id).classList.toggle("is-on",d.looping);
 $("fx-"+d.id).classList.toggle("is-on",d.fx);
 $("stems-"+d.id).classList.toggle("is-on",d.voices.length===4);
 $("tempo-label-"+d.id).textContent=Math.round(d.rate*100)+"%";
}
async function loadFile(side,file,opts={}){
 const d=decks[side];if(!d){alertMessage("Invalid deck",true);return false}
 if(!supports(file)){alertMessage("Select an MP3, M4A or WAV file from Files.",true);return false}
 window.deckedStemAI?.onDeckChange?.(side);
 drop(d);
 d.originalFile=file;d.generatedStems=false;
 d.name=opts.name||titleOf(file);d.loading=true;d.voices=[createVoice(file,d,0)];
 d.scratchFile=file;d.scratchReady=false;
 if(audioCtx){attachVoices(d);prepareScratch(d)}
 d.cue=0;d.rate=1;d.gain=0.9;d.offsets=[1,1,1,1];d.mute=[false,false,false,false];
 $("tempo-"+side).value="100";$("volume-"+side).value="90";$("filter-"+side).value="0";
 d.filter=0;applyFilter(d);applyMix();setRate(d);draw(d);
 alertMessage("Loaded "+d.name+" → "+side.toUpperCase()+". Tap ▶");
 return true;
}
async function loadStems(side,files,opts={}){
 const picked=Array.from(files||[]);
 if(picked.length!==4||picked.some(f=>!supports(f))){
  alertMessage("Select 4 audio stems: vocals, drums, bass and other.",true);return false;
 }
 const map=["vocal","drum","bass","other"],ordered=[];
 for(const name of map){const f=picked.find(f=>f.name.toLowerCase().includes(name));if(f&&!ordered.includes(f))ordered.push(f);}
 for(const f of picked)if(!ordered.includes(f))ordered.push(f);
 const d=decks[side];
 if(!opts.ai)window.deckedStemAI?.onDeckChange?.(side);
 const previousTime=opts.preserveTime?position(d):0;
 drop(d);d.name=opts.title||titleOf(ordered[0]).replace(/vocals?/i,"").trim()||"4 stems";
 d.originalFile=opts.originalFile||null;d.generatedStems=!!opts.ai;
 d.loading=true;d.voices=ordered.map((file,i)=>createVoice(file,d,i));
 if(previousTime>0){
  const first=d.voices[0];
  first.addEventListener("loadedmetadata",()=>seek(d,previousTime),{once:true});
 }
 if(audioCtx)attachVoices(d);
 d.scratchFile=null;d.scratchReady=false;
 d.offsets=[1,1,1,1];d.mute=[false,false,false,false];
 d.cue=0;d.rate=1;d.gain=0.9;d.filter=0;
 $("tempo-"+side).value=100;$("volume-"+side).value=90;$("filter-"+side).value=0;
 for(let i=0;i<4;i++){$("stem-"+side+"-"+i).value=100;$("mute-"+side+"-"+i).classList.remove("is-muted");}
 $("stem-panel-"+side).hidden=false;
 applyMix();setVoiceGains(d);draw(d);
 alertMessage("4 stems loaded into "+side.toUpperCase());
 return true;
}
async function toggle(side){
 const d=decks[side];if(!d.loaded&&!d.loading){alertMessage("Tap + on "+side.toUpperCase()+" to add a track.");return}
 const voices=d.voices;
 if(d.playing){voices.forEach(v=>v.pause());d.playing=false;draw(d);return}
 if(!voices.length)return;
 if(ensureGraph()) {
  attachVoices(d);applyMix();applyFilter(d);prepareScratch(d);
  const res=audioCtx.resume();res.catch(error=>console.warn("Audio resume",error));
 }
 try{
  const results=voices.map(a=>a.play());
  await Promise.all(results);
  d.playing=true;draw(d);
 }catch(error){
  d.playing=false;draw(d);alertMessage("Playback blocked. Tap ▶ again, or try an unprotected MP3.",true);
 }
}
function cue(side){const d=decks[side];if(!d.voices.length)return;d.voices.forEach(v=>v.pause());d.playing=false;seek(d,d.cue);draw(d)}
function loop(side){
 const d=decks[side];if(!d.loaded)return;
 d.looping=!d.looping;
 if(d.looping){
  const bpm=MIN(parseInt($("bpm-"+side).value,10)||120,50,250);
  const start=position(d),end=Math.min(duration(d),start+4*60/bpm);
  if(end-start<0.25){d.looping=false;alertMessage("Move the track earlier to loop.",true)}
  else{d.loopStart=start;d.loopEnd=end}
 }
 draw(d);
}
function fx(side){
 const d=decks[side];d.fx=!d.fx;
 if(d.voices.length&&!audioCtx){ensureGraph();if(audioCtx)audioCtx.resume().catch(()=>{})}
 applyEcho(d);draw(d);
}
function playStateUpdate(){
 for(const d of Object.values(decks)){
  if(!d.scratch&&d.looping&&d.playing&&position(d)>=d.loopEnd){seek(d,d.loopStart)}
  if(d.voices.length===4&&d.playing){
   const p=position(d);
   for(const v of d.voices.slice(1))if(Math.abs(v.currentTime-p)>0.13){try{v.currentTime=p}catch(e){}}
  }
  draw(d);
 }
}
function scratchSetup(d){
 const disk=$("disk-"+d.id);
 let lastAngle=0,lastT=0,held=false,wasPlaying=false,quietTimer=null,lastFallback=0;
 const angle=e=>{
  const r=disk.getBoundingClientRect();
  return Math.atan2(e.clientY-(r.top+r.height/2),e.clientX-(r.left+r.width/2));
 };
 function down(e){
  if(!d.loaded)return; // The big + overlay opens the native file picker on empty decks.
  e.preventDefault();
  held=true;wasPlaying=d.playing;
  d.scratch=true;d.scratchWasPlaying=wasPlaying;
  try{disk.setPointerCapture(e.pointerId)}catch(err){}
  document.documentElement.classList.add("scratch-locked");
  lastAngle=angle(e);lastT=performance.now();lastFallback=lastT;
  const graphReady=ensureGraph();
  if(graphReady){
   attachVoices(d);applyMix();audioCtx.resume().catch(()=>{});
   if(!d.scratchReady)prepareScratch(d);
  }
  const fast=Boolean(graphReady&&d.scratchReady&&d.scratchNode&&d.voices.length===1);
  d.scratchMode=fast?"pcm":"native";
  d.scratchSeconds=position(d);
  d.scratchLastPointerAt=performance.now();
  if(fast){
   // Silence the high-latency media source and render direct PCM in the AudioWorklet.
   d.voices.forEach(v=>v.pause());
   d.scratchNode.port.postMessage({cmd:"start",position:Math.floor(d.scratchSeconds*audioCtx.sampleRate)});
   d.scratchNode.port.postMessage({cmd:"speed",speed:0});
  }else{
   // Graceful fallback while decoding or when AudioWorklet is unavailable.
   d.voices.forEach(v=>{try{v.playbackRate=0.5;v.play().catch(()=>{})}catch(err){}});
  }
  disk.classList.add("scratching");draw(d);
 }
 function move(e){
  if(!held)return;
  e.preventDefault();
  const now=performance.now(),a=angle(e);
  let diff=a-lastAngle;
  while(diff>Math.PI)diff-=Math.PI*2;
  while(diff< -Math.PI)diff+=Math.PI*2;
  if(Math.abs(diff)>0.0005){
   const dt=Math.max(0.008,(now-lastT)/1000);
   // Clockwise full turn = 1.8 seconds of audio at 33 RPM.
   const delta=diff/Math.PI*0.9;
   const velocity=MIN(delta/dt,-4,4);
   if(d.scratchMode==="pcm"){
    d.scratchSeconds=MIN(d.scratchSeconds+delta,0,Math.max(0,duration(d)-0.01));
    d.scratchLastPointerAt=now;
    d.scratchNode.port.postMessage({
     cmd:"seek",position:Math.round(d.scratchSeconds*audioCtx.sampleRate),speed:velocity
    });
    draw(d);
    clearTimeout(quietTimer);
    quietTimer=setTimeout(()=>{
     if(held&&d.scratchMode==="pcm")d.scratchNode.port.postMessage({cmd:"speed",speed:0});
    },55);
   }else if(now-lastFallback>45){
    // Throttle native seeks: old code issued one per event, causing queue backlogs.
    seek(d,position(d)+delta);
    const speed=MIN(Math.abs(velocity),0.45,3);
    d.voices.forEach(v=>{try{v.playbackRate=speed}catch(err){}});
    lastFallback=now;
   }
   lastAngle=a;lastT=now;
   const degrees=Number(disk.dataset.rotation||"0")+diff*180/Math.PI;
   disk.style.setProperty("--scratch-angle",degrees+"deg");
   disk.dataset.rotation=String(degrees);
  }
 }
 function end(){
  if(!held)return;
  held=false;d.scratch=false;
  clearTimeout(quietTimer);disk.classList.remove("scratching");
  if(!Object.values(decks).some(x=>x.scratch))document.documentElement.classList.remove("scratch-locked");
  if(d.scratchMode==="pcm"&&d.scratchNode){
   d.scratchNode.port.postMessage({cmd:"stop"});
   seek(d,d.scratchSeconds);
   if(wasPlaying){
    const pending=d.voices.map(v=>{v.playbackRate=d.rate;return v.play()});
    Promise.all(pending).then(()=>{d.playing=true;draw(d)}).catch(()=>{d.playing=false;draw(d)});
   }else d.playing=false;
  }else{
   d.voices.forEach(v=>{v.playbackRate=d.rate;if(!wasPlaying)v.pause()});
   d.playing=wasPlaying;
  }
  d.scratchMode="native";draw(d);
 }
 disk.addEventListener("pointerdown",down,{passive:false});
 disk.addEventListener("pointermove",move,{passive:false});
 disk.addEventListener("pointerup",end);
 disk.addEventListener("pointercancel",end);
 disk.addEventListener("lostpointercapture",end);
 disk.addEventListener("contextmenu",e=>e.preventDefault());
}

function updateStemControls(d){
 for(let i=0;i<4;i++){
  const input=$("stem-"+d.id+"-"+i),mute=$("mute-"+d.id+"-"+i);
  if(!input||!mute)continue;
  input.addEventListener("input",()=>{d.offsets[i]=Number(input.value)/100;setVoiceGains(d)});
  mute.addEventListener("click",()=>{d.mute[i]=!d.mute[i];mute.classList.toggle("is-muted",d.mute[i]);setVoiceGains(d)});
 }
}
function recordToggle(){
 if(recorder&&recorder.state==="recording"){recorder.stop();$("record").classList.remove("is-on");$("record").textContent="● REC";return}
 if(!ensureGraph()||!window.MediaRecorder||!recordingDest){alertMessage("Recording isn't available in this browser.",true);return}
 audioCtx.resume().catch(()=>{});
 try{
  const type=["audio/mp4","audio/webm;codecs=opus","audio/webm"].find(x=>MediaRecorder.isTypeSupported(x));
  chunks=[];recorder=new MediaRecorder(recordingDest.stream,type?{mimeType:type}:{});
  recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};
  recorder.onstop=()=>{
   const mime=recorder.mimeType||"audio/mp4",ext=mime.includes("webm")?"webm":"m4a";
   const blob=new Blob(chunks,{type:mime}),url=URL.createObjectURL(blob);
   const a=document.createElement("a");a.href=url;a.download="decked-mix-"+Date.now()+"."+ext;
   document.body.appendChild(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),30000);
   alertMessage("Mix saved to Downloads.");
  };
  recorder.start(250);$("record").classList.add("is-on");$("record").textContent="■ STOP";
 }catch(e){alertMessage("Recording unavailable: "+e.message,true)}
}
function fileInput(id,action) {
 const input=$(id);
 input.addEventListener("change",()=>{
  const files=Array.from(input.files||[]);input.value="";
  if(!files.length){alertMessage("No file selected.");return}
  action(files);
 });
}
function setup(){
 for(const d of Object.values(decks)){
  scratchSetup(d);updateStemControls(d);
  $("play-"+d.id).addEventListener("click",()=>toggle(d.id));
  $("cue-"+d.id).addEventListener("click",()=>cue(d.id));
  $("loop-"+d.id).addEventListener("click",()=>loop(d.id));
  $("fx-"+d.id).addEventListener("click",()=>fx(d.id));
  $("stems-"+d.id).addEventListener("click",()=>{$("stem-panel-"+d.id).hidden=!$("stem-panel-"+d.id).hidden});
  $("tempo-"+d.id).addEventListener("input",e=>{d.rate=Number(e.target.value)/100;setRate(d);draw(d)});
  $("volume-"+d.id).addEventListener("input",e=>{d.gain=Number(e.target.value)/100;applyMix();setVoiceGains(d)});
  $("filter-"+d.id).addEventListener("input",e=>{d.filter=Number(e.target.value);applyFilter(d)});
  const seekbar=$("seek-"+d.id);
  seekbar.addEventListener("pointerdown",()=>{seekbar.dataset.dragging="true"});
  seekbar.addEventListener("pointerup",()=>{delete seekbar.dataset.dragging});
  seekbar.addEventListener("input",e=>{if(d.loaded)seek(d,Number(e.target.value)/100*duration(d))});
  $("setcue-"+d.id).addEventListener("click",()=>{d.cue=position(d);alertMessage("Cue set · "+d.id.toUpperCase())});
  $("sync-"+d.id).addEventListener("click",()=> {
   const other=decks[d.id==="a"?"b":"a"];
   if(!d.loaded||!other.loaded){alertMessage("Load both decks to sync.");return}
   const bpm=Math.max(1,Number($("bpm-"+d.id).value)||120);
   const otherBpm=Math.max(1,Number($("bpm-"+other.id).value)||120);
   const target=MIN(otherBpm*other.rate/bpm,0.7,1.3);
   d.rate=target;$("tempo-"+d.id).value=Math.round(target*100);setRate(d);draw(d);
   alertMessage("Tempo synced to "+other.id.toUpperCase());
  });
  const assignTrack=files=>{
   // Loading a deck must never wait on Safari storage. Save only via LIBRARY + MUSIC.
   loadFile(d.id,files[0]);
  };
  fileInput("file-"+d.id,assignTrack);
  fileInput("disk-file-"+d.id,assignTrack);
  fileInput("stems-file-"+d.id,files=>loadStems(d.id,files));
  draw(d);
 }
 fileInput("quick-file",files=>{
  const file=files[0],side=!decks.a.loaded&&!decks.a.loading?"a":!decks.b.loaded&&!decks.b.loading?"b":"a";
  loadFile(side,file);
 });
 $("cross").addEventListener("input",e=>{crossValue=Number(e.target.value)/100;applyMix()});
 $("open-library").addEventListener("click",()=>{
  const panel=$("music-library");panel.open=true;panel.scrollIntoView({behavior:"smooth",block:"start"});
 });
 $("record").addEventListener("click",recordToggle);
 // No audio decoding before a track becomes READY. Native media elements own file playback.
 setInterval(playStateUpdate,160);
 document.addEventListener("visibilitychange",()=>{if(document.hidden)return;for(const d of Object.values(decks))draw(d)});
 alertMessage("Choose a track with +");
}
window.decked={
 loadFile,loadStems,play:toggle,
 getFile:side=>decks[side]?.originalFile||null,
 getPosition:side=>decks[side]?position(decks[side]):0,
 isEmpty:side=>!decks[side]?.loaded&&!decks[side]?.loading,
 status:side=>decks[side]?{loaded:decks[side].loaded,loading:decks[side].loading,playing:decks[side].playing,name:decks[side].name,hasStems:decks[side].voices.length===4,generatedStems:!!decks[side].generatedStems,fastScratch:!!decks[side].scratchReady,scratchMode:decks[side].scratchMode||'native',scratchSeconds:decks[side].scratchSeconds||0,baseLatencyMs:audioCtx&&Number.isFinite(audioCtx.baseLatency)?Math.round(audioCtx.baseLatency*1000):null}:null,
 readFile:supports
};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",setup,{once:true});else setup();
})();