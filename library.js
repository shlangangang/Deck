/* DECKED v3 offline library — IndexedDB metadata separate from audio blobs. */
(function(){
"use strict";
const $=id=>document.getElementById(id);
const DB="pocket-deck-local-music",VERSION=2;
const AUDIO_EXT=/\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|aif|aiff)$/i;
let instance=null, importQueue=Promise.resolve(), entries=[], noticeTimer=0;
function tell(message,error=false,silent=false){
 if(silent)return;
 const e=$("lib-message");if(!e)return;
 e.textContent=message;e.classList.toggle("error",Boolean(error));
 clearTimeout(noticeTimer);
 if(!error)noticeTimer=setTimeout(()=>{if(e.textContent===message)e.textContent=""},5000);
}
function accepted(file){return Boolean(file&&file.size>0&&file.size<=300*1024*1024&&
  (AUDIO_EXT.test(file.name||"")||(file.type||"").startsWith("audio/")))}
function open(){
 if(instance)return Promise.resolve(instance);
 return new Promise((resolve,reject)=>{
  if(!window.indexedDB)return reject(new Error("Saved storage is unavailable"));
  const req=indexedDB.open(DB,VERSION);
  req.onupgradeneeded=ev=>{
   const db=req.result,tx=req.transaction;
   if(!db.objectStoreNames.contains("songs"))db.createObjectStore("songs",{keyPath:"id"});
   if(!db.objectStoreNames.contains("blobs"))db.createObjectStore("blobs",{keyPath:"id"});
   // Preserve recordings previously stored by the older Pocket Deck version.
   if(ev.oldVersion<2&&db.objectStoreNames.contains("tracks")){
    const legacy=tx.objectStore("tracks"),songs=tx.objectStore("songs"),blobs=tx.objectStore("blobs");
    legacy.openCursor().onsuccess=e=>{
     const cur=e.target.result;if(!cur)return;
     const t=cur.value;
     if(t&&t.blob&&t.id){
      songs.put({id:t.id,title:t.title||"Untitled",filename:t.filename||((t.title||"Track")+".mp3"),
       type:t.blob.type||"audio/mpeg",size:t.size||t.blob.size||0,created:t.created||Date.now(),
       signature:t.signature||""});
      blobs.put({id:t.id,blob:t.blob});
     }
     cur.continue();
    };
   }
  };
  req.onsuccess=()=>{instance=req.result;instance.onversionchange=()=>{instance.close();instance=null};resolve(instance)};
  req.onerror=()=>reject(req.error||new Error("Could not open saved music"));
  req.onblocked=()=>tell("Close other open copies of DECKED and retry.",true);
 });
}
async function list(){
 const db=await open();
 return new Promise((resolve,reject)=>{
  const request=db.transaction("songs","readonly").objectStore("songs").getAll();
  request.onsuccess=()=>resolve(request.result||[]);
  request.onerror=()=>reject(request.error||new Error("Library read failed"));
 });
}
async function getAudio(id){
 const db=await open();
 return new Promise((resolve,reject)=>{
  const request=db.transaction("blobs","readonly").objectStore("blobs").get(id);
  request.onsuccess=()=>resolve(request.result?.blob||null);
  request.onerror=()=>reject(request.error||new Error("Audio storage read failed"));
 });
}
async function store(meta,blob){
 const db=await open();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(["songs","blobs"],"readwrite");
  tx.objectStore("songs").put(meta);
  tx.objectStore("blobs").put({id:meta.id,blob});
  tx.oncomplete=()=>resolve(true);
  tx.onerror=()=>reject(tx.error||new Error("Storage is full"));
  tx.onabort=()=>reject(tx.error||new Error("Storage rejected this file"));
 });
}
async function deleteAudio(id){
 const db=await open();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(["songs","blobs"],"readwrite");
  tx.objectStore("songs").delete(id);tx.objectStore("blobs").delete(id);
  tx.oncomplete=()=>resolve();
  tx.onerror=()=>reject(tx.error||new Error("Could not delete song"));
 });
}
function nameOf(file){
 return (file.name||"Untitled").replace(AUDIO_EXT,"").replace(/_/g," ").trim()||"Untitled";
}
function uniqueId(){
 return window.crypto&&crypto.randomUUID?crypto.randomUUID():
   Date.now().toString(36)+Math.random().toString(36).slice(2);
}
function size(bytes){return Math.round(bytes/1048576*10)/10+" MB"}
function element(tag,cls,value){const e=document.createElement(tag);if(cls)e.className=cls;if(value!==undefined)e.textContent=value;return e}
function action(label,cls,callback){
 const b=element("button",cls,label);b.type="button";b.addEventListener("click",callback);return b;
}
function render(){
 const count=$("lib-count"),target=$("lib-tracks"),search=$("lib-filter");
 if(!count||!target)return;
 count.textContent=entries.length+" TRACK"+(entries.length===1?"":"S");
 const query=(search?.value||"").trim().toLowerCase();
 target.replaceChildren();
 const filtered=entries.filter(e=>e.title.toLowerCase().includes(query)).sort((a,b)=>b.created-a.created);
 if(!filtered.length){
  target.append(element("div","no-songs",query?"No matches":"No songs yet"));
  return;
 }
 for(const item of filtered){
  const row=element("div","song-row"),info=element("div","song-info");
  const name=element("strong","song-name",item.title),detail=element("small","song-sub",size(item.size));
  info.append(name,detail);
  const controls=element("div","song-actions");
  controls.append(
   action("A","song-btn tone-a",()=>load(item.id,"a")),
   action("B","song-btn tone-b",()=>load(item.id,"b")),
   action("×","song-btn remove",()=>remove(item))
  );
  row.append(info,controls);target.append(row);
 }
}
async function refresh(){
 try{entries=await list();render();return entries;}
 catch(error){tell("Saved music unavailable. You can still load files directly into A or B.",true);return []}
}
async function saveSelected(selected, options={}){
 let saved=0,duplicates=0,failed=0;
 try{
  const current=await list();
  const sigs=new Set(current.map(x=>x.signature));
  for(const file of selected){
   if(!accepted(file)){failed++;continue}
   const signature=[file.name,file.size,file.lastModified||0].join("|");
   if(sigs.has(signature)){duplicates++;continue}
   const meta={id:uniqueId(),title:nameOf(file),filename:file.name||"audio.mp3",type:file.type||"audio/mpeg",
    size:file.size,signature,created:Date.now()};
   try{
    tell("Saving "+meta.title+"…",false,options.silent);
    const blob=file.slice(0,file.size,file.type||"application/octet-stream");
    try{await store(meta,blob)}
    catch(blobError){
     // Some WebKit storage implementations reject Blob cloning. Small files can
     // safely use a structured-cloneable Uint8Array instead.
     if(file.size>24*1024*1024)throw blobError;
     const bytes=new Uint8Array(await file.arrayBuffer());
     await store(meta,bytes);
    }
    sigs.add(signature);saved++;
   }catch(error){console.error("Audio save failed:",error);failed++;tell("iPhone storage is full or unavailable. You can still play the file directly.",true,options.silent)}
  }
  await refresh();
  if(!options.silent)tell(saved?saved+" track"+(saved===1?"":"s")+" added":duplicates?"Already in your library":failed?"Could not save this file":"Choose a supported audio file",Boolean(failed&&!saved));
  return {saved,duplicates,failed};
 }catch(error){
  tell("Can't save music on this device. Direct loading still works.",true,options.silent);
  return {saved,duplicates,failed:failed+1};
 }
}
function saveFiles(files, options={}){
 // Snapshot synchronously; jobs queue instead of being discarded on slow Safari storage.
 const selected=Array.from(files||[]);
 if(!selected.length)return Promise.resolve({saved:0,duplicates:0,failed:0});
 const next=importQueue.then(()=>saveSelected(selected,options));
 importQueue=next.catch(()=>{});
 return next;
}
async function load(id,side){
 const entry=entries.find(x=>x.id===id);
 if(!entry){tell("Track no longer in library.",true);return false}
 tell("Loading "+entry.title+"…");
 try{
  const blob=await getAudio(id);
  if(!blob||!(blob.size||blob.byteLength))throw new Error("Saved audio missing");
  const file=new File([blob],entry.filename||"track.mp3",{type:entry.type||blob.type||"audio/mpeg"});
  const ok=await window.decked.loadFile(side,file,{name:entry.title});
  if(!ok){tell("This track could not be loaded.",true);return false}
  tell(entry.title+" → "+side.toUpperCase());
  $("music-library").open=false;
  return true;
 }catch(error){
  console.error("Saved track load failed",error);
  tell("Could not open saved song. Try importing the original file.",true);
  return false;
 }
}
async function remove(item){
 if(!confirm("Delete "+item.title+" from this device?"))return;
 try{await deleteAudio(item.id);await refresh();tell("Removed")}catch(error){tell("Could not remove track.",true)}
}
function init(){
 const input=$("lib-files");
 if(!input)return;
 input.addEventListener("change",()=>{
  const chosen=Array.from(input.files||[]);
  input.value="";
  if(!chosen.length){tell("No files chosen");return}
  const first=chosen.find(accepted);
  if(first&&window.decked){
   const target=window.decked.isEmpty("a")?"a":window.decked.isEmpty("b")?"b":null;
   if(target)window.decked.loadFile(target,first);
  }
  saveFiles(chosen).catch(error=>tell("Import failed: "+error.message,true));
 });
 $("lib-filter").addEventListener("input",render);
 refresh();
}
window.deckedLibrary=Object.freeze({saveFiles,load,refresh});
window.pocketDeckLibrary=Object.freeze({importFiles:saveFiles,refresh,load});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();