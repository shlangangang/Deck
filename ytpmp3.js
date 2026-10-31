/* Pocket Deck x ytpmp3 beta connector — authorised downloads only.
   User-supplied keys are transient. No server secrets or scraping. */
(function(){
'use strict';
const API='https://api.ytpmp3.com/v1/convert';
const $=id=>document.getElementById(id);
let busy=false;
const text=(msg,bad=false)=>{const el=$('ytp-status');if(el){el.textContent=msg;el.classList.toggle('error',bad)}};
function getId(value){
 const v=String(value||'').trim();
 if(/^[A-Za-z0-9_-]{11}$/.test(v))return v;
 try{
  const url=new URL(v);
  const h=url.hostname.toLowerCase();
  if(h==='youtu.be'||h==='www.youtu.be'){const id=url.pathname.split('/')[1];return /^[A-Za-z0-9_-]{11}$/.test(id||'')?id:null}
  if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(h)){
   const id=url.searchParams.get('v')||(/\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})/.exec(url.pathname)||[])[1];
   return /^[A-Za-z0-9_-]{11}$/.test(id||'')?id:null;
  }
 }catch(e){}
 return null;
}
function safeDownload(url){
 try{const u=new URL(url);return u.protocol==='https:'?u.href:null}catch(e){return null}
}
function fallback(url,msg){
 const anchor=$('ytp-download');
 const safe=safeDownload(url);
 if(safe){anchor.href=safe;anchor.hidden=false;}
 text(msg,true);
}
function parseError(body,status){
 const detail=body&&typeof body==='object'?(body.error?.message||body.error||body.message||body.detail):null;
 const reason=typeof detail==='string'?detail.slice(0,220):'HTTP '+status;
 if(status===401)return 'ytpmp3 rejected this API key. Ask the provider for beta API access.';
 if(status===403)return 'ytpmp3 denied access. Your API key may not be activated.';
 if(status===429)return 'Free-tier rate limit reached. Retry after the provider resets your quota.';
 return 'ytpmp3 conversion error: '+reason;
}
async function run(){
 if(busy)return;
 const raw=$('ytp-url').value.trim()||$('yt-url')?.value.trim()||'';
 const videoId=getId(raw);
 const key=$('ytp-key').value.trim();
 const rights=$('ytp-rights').checked;
 const button=$('ytp-convert');
 $('ytp-download').hidden=true;
 if(!videoId){text('Paste a valid YouTube video link or ID first.',true);return}
 if(!rights){text('Confirm you own the audio or have permission to download it.',true);return}
 if(!key){text('ytpmp3 requires a beta API key. Request access from api@ytpmp3.com, then paste your key here. Or use the website and import your downloaded audio manually.',true);return}
 if(!window.pocketDeckLibrary?.importFiles){text('Music library is still loading. Refresh the page and try again.',true);return}
 busy=true;button.disabled=true;button.textContent='CONVERTING…';
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),90000);
 try{
  text('Requesting MP3 from ytpmp3. Only audio you have permission to download may be imported.');
  const response=await fetch(API,{
   method:'POST',mode:'cors',signal:controller.signal,cache:'no-store',
   headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
   body:JSON.stringify({url:'https://www.youtube.com/watch?v='+videoId,format:'mp3',quality:'320'})
  });
  let payload;
  try{payload=await response.json()}catch(e){throw new Error('Provider returned an unexpected response, not JSON.')}
  if(!response.ok||payload?.success===false)throw new Error(parseError(payload,response.status));
  const download=safeDownload(payload?.download_url||payload?.downloadUrl);
  if(!download)throw new Error('Conversion response did not include a safe HTTPS MP3 download URL.');
  text('Conversion complete. Importing MP3 into your saved library…');
  let media;
  try{
   const audio=await fetch(download,{signal:controller.signal,mode:'cors',redirect:'follow'});
   if(!audio.ok)throw new Error('Download returned '+audio.status);
   const type=(audio.headers.get('content-type')||'').toLowerCase();
   if(type.includes('text/html')||type.includes('application/json'))throw new Error('Provider returned a web page instead of audio');
   media=await audio.blob();
   if(!media.size||media.size>300*1024*1024)throw new Error('The converted audio is empty or over the 300 MB library limit');
  }catch(e){
   fallback(download,'Conversion succeeded, but Safari could not transfer the MP3 into the library automatically (possibly cross-origin restrictions). Tap DOWNLOAD MP3 below, save it to Files, then use SAVED MUSIC LIBRARY → IMPORT MUSIC. '+(e.name==='AbortError'?'Transfer timed out.':''));
   return;
  }
  const title=String(payload?.title||'YouTube audio '+videoId).replace(/[\u0000-\u001f\\/<>:"|?*]/g,' ').trim().slice(0,110)||'Converted Audio';
  const file=new File([media],title+'.mp3',{type:'audio/mpeg',lastModified:Date.now()});
  await window.pocketDeckLibrary.importFiles([file]);
  text('Downloaded MP3 handed to SAVED MUSIC LIBRARY. Find it there and tap A or B to load it.');
 }catch(e){
  if(e.name==='AbortError')text('ytpmp3 request timed out. Try again later or use its website manually.',true);
  else if(e instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(e.message||'')){
   text('Direct API request failed. This may be a network or browser CORS restriction on ytpmp3. GitHub Pages cannot override that; use the provider website and import the MP3 from Files.',true);
  }else text(e.message||'Conversion failed',true);
 }finally{clearTimeout(timeout);busy=false;button.disabled=false;button.textContent='CONVERT + SAVE MP3'}
}
function init(){
 const go=$('ytp-convert');if(!go)return;
 go.addEventListener('click',run);
 $('ytp-use-link').addEventListener('click',()=>{
  const link=$('yt-url')?.value.trim();
  if(link){$('ytp-url').value=link;text('Copied the YouTube link from the deck loader.')}
  else text('No YouTube link entered above. Paste one in the conversion field.',true);
 });
 $('ytp-url').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();run()}});
 text('Beta integration ready. An activated ytpmp3 API key is required; never put it in public GitHub code.');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();