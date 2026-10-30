"use client";
import { useEffect,useState } from "react";
import type { InteractionProfile } from "../../lib/interaction/profiles";
export default function InteractionOverlay({profile,selected,video,host}:{profile:InteractionProfile;selected:string;video:React.RefObject<HTMLVideoElement|null>;host:React.RefObject<HTMLDivElement|null>}) {
  const [box,setBox]=useState({left:0,top:0,width:0,height:0});
  useEffect(()=>{
    const v=video.current,h=host.current;if(!v||!h)return;
    const measure=()=>{const b=v.getBoundingClientRect(),outer=h.getBoundingClientRect();const ratio=v.videoWidth&&v.videoHeight?v.videoWidth/v.videoHeight:b.width/b.height;const width=Math.min(b.width,b.height*ratio),height=width/ratio;setBox({left:b.left-outer.left-h.clientLeft+(b.width-width)/2,top:b.top-outer.top-h.clientTop+(b.height-height)/2,width,height});};
    const id=requestAnimationFrame(measure);const observer=new ResizeObserver(measure);observer.observe(v);observer.observe(h);
    v.addEventListener('loadedmetadata',measure);v.addEventListener('resize',measure);window.addEventListener('resize',measure);document.addEventListener('fullscreenchange',measure);
    return()=>{cancelAnimationFrame(id);observer.disconnect();v.removeEventListener('loadedmetadata',measure);v.removeEventListener('resize',measure);window.removeEventListener('resize',measure);document.removeEventListener('fullscreenchange',measure);};
  },[video,host]);
  return <div className="interaction-overlay" aria-hidden="true" style={box}>
    <span className={selected==='joystick'?'mapping-marker selected':'mapping-marker'} style={{left:`${profile.joystick.x*100}%`,top:`${profile.joystick.y*100}%`,width:`${profile.joystick.radius*200}%`,aspectRatio:'1'}}><small>WASD</small></span>
    {profile.lookStick.enabled&&<span className={selected==='look'?'mapping-marker selected':'mapping-marker'} style={{left:`${profile.lookStick.x*100}%`,top:`${profile.lookStick.y*100}%`,width:`${profile.lookStick.radius*200}%`,aspectRatio:'1'}}><small>RS</small></span>}
    {profile.bindings.map(b=><span key={b.id} className={selected===b.id?'mapping-marker selected':'mapping-marker'} style={{left:`${b.x*100}%`,top:`${b.y*100}%`,width:`${b.size*100}%`,aspectRatio:'1'}}><small>{b.key}</small></span>)}
  </div>;
}
