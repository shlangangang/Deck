/* DECKED low-latency vinyl scratch DSP.
   128-frame Web Audio quantum; bidirectional PCM interpolation, no media-element seeks. */
class DeckedScratchProcessor extends AudioWorkletProcessor{
 constructor(){
  super();
  this.left=null;this.right=null;this.length=0;
  this.position=0;this.active=false;
  this.targetSpeed=0;this.speed=0;this.level=0;
  this.counter=0;
  this.port.onmessage=event=>{
   const data=event.data||{};
   if(data.cmd==='load'){
    this.left=data.left||null;
    this.right=data.right||this.left;
    this.length=this.left?this.left.length:0;
    this.position=0;this.active=false;
    this.targetSpeed=0;this.speed=0;this.level=0;
    this.port.postMessage({cmd:'ready',length:this.length,generation:data.generation});
   }else if(data.cmd==='start'){
    this.position=Math.max(0,Math.min(Math.max(0,this.length-2),data.position||0));
    this.speed=0;this.targetSpeed=0;this.level=0;
    this.active=true;
   }else if(data.cmd==='speed'){
    this.targetSpeed=Math.max(-4,Math.min(4,data.speed||0));
   }else if(data.cmd==='seek'){
    // PCM positioning is cheap; tracking finger position directly avoids reversal lag.
    if(this.length>2&&Number.isFinite(data.position)){
     this.position=Math.max(0,Math.min(this.length-2,data.position));
    }
    if(Number.isFinite(data.speed)){
     this.targetSpeed=Math.max(-4,Math.min(4,data.speed));
     this.speed=this.targetSpeed;
    }
   }else if(data.cmd==='stop'){
    this.active=false;this.targetSpeed=0;
    this.port.postMessage({cmd:'stopped',position:this.position});
   }else if(data.cmd==='clear'){
    this.active=false;this.targetSpeed=0;
    this.left=null;this.right=null;this.length=0;this.position=0;
    this.speed=0;this.level=0;
   }
  };
 }
 interp(samples,position){
  if(!samples)return 0;
  const i=Math.floor(position);
  const a=samples[i]||0;
  return a+((samples[i+1]===undefined?a:samples[i+1])-a)*(position-i);
 }
 process(_inputs,outputs){
  const output=outputs[0];
  if(!output||!output.length)return true;
  const L=output[0],R=output[1]||L;
  const available=Boolean(this.left&&this.length>2);
  for(let i=0;i<L.length;i++){
   // ≈5 ms velocity smoothing, ≈3 ms amplitude fades to prevent pops.
   this.speed+=(this.targetSpeed-this.speed)*0.0045;
   const desiredGain=this.active&&available&&Math.abs(this.targetSpeed)>0.025?1:0;
   this.level+=(desiredGain-this.level)*0.008;
   if(this.level>0.0001&&available){
    L[i]=this.interp(this.left,this.position)*this.level;
    if(R!==L)R[i]=this.interp(this.right,this.position)*this.level;
    this.position+=this.speed;
    if(this.position>=this.length-2)this.position=this.length-2;
    if(this.position<0)this.position=0;
   }else{L[i]=0;if(R!==L)R[i]=0}
  }
  if(this.active&&this.counter++%12===0)this.port.postMessage({cmd:'position',position:this.position});
  return true;
 }
}
registerProcessor('decked-scratch',DeckedScratchProcessor);
