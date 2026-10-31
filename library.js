/* Pocket Deck saved local music library. No YouTube extraction or external upload. */
(function(){
'use strict';
const $lib=id=>document.getElementById(id);
const DBNAME='pocket-deck-local-music',SIZE_LIMIT=300*1024*1024;
let db=null, tracks=[],working=false;
const fmt=n=>(Math.max(0,Number(n)||0)/1048576).toFixed(1)+' MB';
function status(s,bad=false){const el=$lib('lib-message');if(el){el.textContent=s;el.classList.toggle('error',bad)}}
function openDB(){
 if(db)return Promise.resolve(db);
 return new Promise((ok,fail)=>{
  if(!window.indexedDB)return fail(new Error('Your browser does not support saved music'));
  const req=indexedDB.open(DBNAME,1);
  req.onupgradeneeded=()=>{
   const db=req.result;
   if(!db.objectStoreNames.contains('tracks'))db.createObjectStore('tracks',{keyPath:'id'});
  };
  req.onsuccess=()=>{db=req.result;db.onversionchange=()=>{db.close();db=null};ok(db)};
  req.onerror=()=>fail(req.error||new Error('Could not open library'));
 });
}
async function all(){
 const database=await openDB();
 return new Promise((ok,fail)=>{
  const req=database.transaction('tracks','readonly').objectStore('tracks').getAll();
  req.onsuccess=()=>ok(req.result||[]);req.onerror=()=>fail(req.error);
 });
}
async function read(id){
 const database=await openDB();
 return new Promise((ok,fail)=>{
  const req=database.transaction('tracks','readonly').objectStore('tracks').get(id);
  req.onsuccess=()=>ok(req.result||null);req.onerror=()=>fail(req.error);
 });
}
async function put(item){
 const database=await openDB();
 return new Promise((ok,fail)=>{
  const tx=database.transaction('tracks','readwrite');
  tx.objectStore('tracks').put(item);
  tx.oncomplete=()=>ok();tx.onerror=()=>fail(tx.error||new Error('Storage limit reached'));
  tx.onabort=()=>fail(tx.error||new Error('Storage limit reached'));
 });
}
async function del(id){
 const database=await openDB();
 return new Promise((ok,fail)=>{
  const tx=database.transaction('tracks','readwrite');
  tx.objectStore('tracks').delete(id);
  tx.oncomplete=()=>ok();tx.onerror=()=>fail(tx.error);
 });
}
const id=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
function isAudio(file){return file&&(file.type?.startsWith('audio/')||/\.(mp3|m4a|aac|wav|flac|oga|ogg|opus|aiff?)$/i.test(file.name||''))}
function node(tag,cls,value){const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=value;return n}
function button(value,cls,callback){const e=node('button',cls,value);e.type='button';e.addEventListener('click',callback);return e}
function render(){
 const counter=$lib('lib-count'),target=$lib('lib-tracks');
 if(!counter||!target)return;
 counter.textContent=tracks.length+' songs · '+fmt(tracks.reduce((a,t)=>a+(t.size||0),0));
 target.replaceChildren();
 const query=$lib('lib-filter').value.toLowerCase().trim();
 const shown=tracks.filter(t=>(t.title||'').toLowerCase().includes(query)).sort((a,b)=>b.created-a.created);
 if(!shown.length){target.append(node('p','lib-empty',tracks.length?'No songs match your search.':'Nothing saved yet — import MP3, M4A or WAV files to start.'));return}
 for(const t of shown.slice(0,120)){
  const row=node('div','lib-item');const info=node('div','lib-info');
  info.append(node('strong','lib-title',t.title),node('span','lib-detail',fmt(t.size)+' · saved on this device'));
  const acts=node('div','lib-acts');
  acts.append(button('A','lib-target a',()=>load(t.id,'a')),button('B','lib-target b',()=>load(t.id,'b')),button('×','lib-delete',()=>remove(t)));
  row.append(info,acts);target.append(row);
 }
 if(shown.length>120)target.append(node('p','lib-empty','Showing first 120 results. Filter to find other songs.'));
}
async function refresh(){tracks=await all();render()}
async function importFiles(files){
 if(working)return status('Wait for the current import to finish');
 working=true;
 try{
  await refresh();
  const existing=new Set(tracks.map(t=>t.signature));
  let saved=0,dup=0,failed=0;
  for(const file of Array.from(files||[])){
   if(!isAudio(file)||!file.size||file.size>SIZE_LIMIT){failed++;continue}
   const signature=[file.name,file.size,file.lastModified||0].join('/');
   if(existing.has(signature)){dup++;continue}
   status('Saving '+file.name+'…');
   const title=file.name.replace(/\.[^.]+$/,'').slice(0,160);
   try{await put({id:id(),signature,title,size:file.size,blob:file,created:Date.now()});existing.add(signature);saved++}
   catch(e){failed++;status('Storage error: '+e.message,true)}
  }
  await refresh();
  if(saved)status('Saved '+saved+' song'+(saved===1?'':'s')+'. Use A / B to load. '+(failed?failed+' could not be stored.':''));
  else if(dup&&!failed)status('These tracks are already in the library.');
  else if(failed)status('Could not save '+failed+' file(s). Use audio files and check available device storage.',true);
  else status('Select some audio files to import.');
  return {saved,duplicates:dup,failed};
 }catch(e){status('Library import failed: '+e.message,true);throw e}
 finally{working=false}
}
async function load(trackId,side){
 try{
  status('Loading saved track into Deck '+side.toUpperCase()+'…');
  const track=await read(trackId);
  if(!track||!track.blob)throw new Error('Saved audio was not found');
  if(typeof importTrack!=='function'||typeof deck==='undefined')throw new Error('DJ engine is not ready');
  const file=new File([track.blob],track.title+'.'+(track.blob.type?.includes('wav')?'wav':track.blob.type?.includes('mp4')?'m4a':'mp3'),{type:track.blob.type||'audio/mpeg'});
  await importTrack(deck[side],file);
  status('Sent '+track.title+' to Deck '+side.toUpperCase()+'. Press ▶ to play.');
  const section=$lib('music-library');
  if(section)section.open=false;
 }catch(e){status('Could not load track: '+e.message,true)}
}
async function remove(t){
 if(!window.confirm('Remove "'+t.title+'" from this device’s music library?'))return;
 try{await del(t.id);await refresh();status('Removed '+t.title+' from the library.')}catch(e){status('Remove failed: '+e.message,true)}
}
async function init(){
 if(!$lib('lib-tracks'))return;
 $lib('lib-import-btn').addEventListener('click',()=>$lib('lib-files').click());
 $lib('lib-files').addEventListener('change',e=>{const files=e.target.files;importFiles(files);e.target.value=''});
 $lib('lib-filter').addEventListener('input',render);
 try{await refresh();status('Saved locally on this iPhone. Keep an original backup in Files — browser storage can be cleared.')}
 catch(e){status('Music library unavailable: '+e.message,true)}
}
window.pocketDeckLibrary=Object.freeze({importFiles,refresh,load});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();