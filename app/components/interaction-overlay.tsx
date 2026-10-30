"use client";
import { useEffect, useRef, useState } from "react";
import type { InteractionProfile } from "../../lib/interaction/profiles";
export default function InteractionOverlay({profile,selected,video,host,editing,onMove,onSelect,pan}:{profile:InteractionProfile;selected:string;video:React.RefObject<HTMLVideoElement|null>;host:React.RefObject<HTMLDivElement|null>;editing:boolean;onMove:(id:string,x:number,y:number)=>void;onSelect:(id:string)=>void;pan:{x:number;y:number}}) {
  const [box,setBox]=useState({left:0,top:0,width:0,height:0});
  const overlay=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const v=video.current,h=host.current;if(!v||!h)return;
    const measure=()=>{const b=v.getBoundingClientRect(),outer=h.getBoundingClientRect();const ratio=v.videoWidth&&v.videoHeight?v.videoWidth/v.videoHeight:b.width/b.height;const width=Math.min(b.width,b.height*ratio),height=width/ratio;setBox({left:b.left-outer.left-h.clientLeft+(b.width-width)/2,top:b.top-outer.top-h.clientTop+(b.height-height)/2,width,height});};
    const id=requestAnimationFrame(measure);const observer=new ResizeObserver(measure);observer.observe(v);observer.observe(h);
    v.addEventListener('loadedmetadata',measure);v.addEventListener('resize',measure);window.addEventListener('resize',measure);document.addEventListener('fullscreenchange',measure);
    return()=>{cancelAnimationFrame(id);observer.disconnect();v.removeEventListener('loadedmetadata',measure);v.removeEventListener('resize',measure);window.removeEventListener('resize',measure);document.removeEventListener('fullscreenchange',measure);};
  },[video,host,profile.zoom,pan.x,pan.y]);
  const points=[{id:'joystick',key:'WASD',...profile.joystick,size:profile.joystick.radius*2},...(profile.lookStick.enabled?[{id:'look',key:'RS',...profile.lookStick,size:profile.lookStick.radius*2}]:[]),...profile.bindings];
  const move=(id:string,event:React.PointerEvent<HTMLButtonElement>)=>{
    const b=overlay.current?.getBoundingClientRect();if(!b?.width||!b.height)return;
    onMove(id,Math.max(0,Math.min(1,(event.clientX-b.left)/b.width)),Math.max(0,Math.min(1,(event.clientY-b.top)/b.height)));
  };
  return <div ref={overlay} className={`interaction-overlay ${editing?'is-editing':''}`} aria-hidden={!editing} style={box}>
    {points.map(b=>editing?<button key={b.id} type="button" className={selected===b.id?'mapping-marker selected':'mapping-marker'} aria-label={`${b.key} 위치 이동`} style={{left:`${b.x*100}%`,top:`${b.y*100}%`,width:`${b.size*100}%`,aspectRatio:'1'}}
      onPointerDown={e=>{e.preventDefault();e.stopPropagation();e.currentTarget.focus();onSelect(b.id);e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{e.stopPropagation();if(e.currentTarget.hasPointerCapture(e.pointerId))move(b.id,e);}}
      onPointerUp={e=>{e.stopPropagation();if(e.currentTarget.hasPointerCapture(e.pointerId)){move(b.id,e);e.currentTarget.releasePointerCapture(e.pointerId);}}}
      onPointerCancel={e=>{e.stopPropagation();if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
      onLostPointerCapture={e=>e.stopPropagation()}
      onClick={e=>{e.stopPropagation();onSelect(b.id);}}
      onKeyDown={e=>{e.stopPropagation();if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)){e.preventDefault();const step=e.shiftKey?.05:.01;onMove(b.id,Math.max(0,Math.min(1,b.x+(e.code==='ArrowRight'?step:e.code==='ArrowLeft'?-step:0))),Math.max(0,Math.min(1,b.y+(e.code==='ArrowDown'?step:e.code==='ArrowUp'?-step:0))));}}}><small>{b.key}</small></button>:<span key={b.id} className="mapping-marker" style={{left:`${b.x*100}%`,top:`${b.y*100}%`,width:`${b.size*100}%`,aspectRatio:'1'}}><small>{b.key}</small></span>)}
  </div>;
}
