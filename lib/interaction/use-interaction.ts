"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RemoteClient } from "../remote/client";
import { InteractionEngine } from "./engine";
import { defaultStore, defaultProfile, parseStore, profileStorageKey, sanitizeProfile, selectedProfile, type InteractionMode, type InteractionProfile } from "./profiles";
import { mappingProblem, savedProfileProblem } from "./validation";
export function useInteraction(options: {
  owner: string | null; device: string | null; personal: boolean; connected: boolean; blocked: boolean;
  client: RemoteClient | null; send: (command: Record<string,unknown>) => boolean; releaseLegacy: () => void;
  viewer: React.RefObject<HTMLElement | null>; detached: Window | null;
  applyQuality: (value: InteractionProfile["quality"]) => void;
}) {
  const latest = useRef(options);
  const [store,setStore]=useState(defaultStore);
  const [loaded,setLoaded]=useState<string|null>(null);
  const [editing,setEditing]=useState(false);
  const [showMappings,setShowMappings]=useState(false);
  const [notice,setNotice]=useState("");
  const preserveSaved=useRef(false);
  const [selectedBinding,setSelectedBinding]=useState("attack");
  const [status,setStatus]=useState({auto:"stopped",error:"",pointers:0,pad:"연결 없음",idle:false});
  const [pan,setPan]=useState({x:0,y:0});
  const lastActivity=useRef(0);
  const lastProfile=useRef("");
  const [engine]=useState(()=>new InteractionEngine(defaultProfile("game"),{available:()=>false,command:()=>false,pointers:()=>false}));
  useLayoutEffect(()=>{
    latest.current=options;
    engine.setTransport({available:()=>options.connected&&!options.blocked,command:command=>options.send(command),pointers:points=>options.client?.sendPointerFrame(points)??false});
  });
  const profile=useMemo(()=>selectedProfile(store),[store]);
  const key=profileStorageKey(options.owner,options.device);
  const storageIdentity=`${key}:${options.personal}`;
  useEffect(()=>{
    engine.cancel("기기/저장 정책 변경");latest.current.releaseLegacy();
    const timer=setTimeout(()=>{
      let saved=null;let problem="";try{if(latest.current.personal)saved=localStorage.getItem(key);}catch{problem="저장소를 읽을 수 없습니다. 이번 세션에서만 사용합니다.";}
      problem=problem||savedProfileProblem(saved)||"";preserveSaved.current=Boolean(problem);setNotice(problem);
      setStore(parseStore(problem?null:saved));setLoaded(storageIdentity);setEditing(false);setPan({x:0,y:0});
    },0);
    return()=>clearTimeout(timer);
  },[key,options.personal,engine,storageIdentity]);
  useEffect(()=>{
    if(loaded!==storageIdentity||!options.personal||preserveSaved.current)return;
    let message="개인 PC에 자동 저장됨";
    try{localStorage.setItem(key,JSON.stringify(parseStore(JSON.stringify(store))));}catch{message="저장 실패: 브라우저 저장소가 차단되었거나 용량이 부족합니다. 이번 세션 설정만 유지됩니다.";}
    const timer=setTimeout(()=>setNotice(message),0);return()=>clearTimeout(timer);
  },[store,key,loaded,options.personal,storageIdentity]);
  useEffect(()=>{
    engine.configure(profile);latest.current.releaseLegacy();
    const identity=profile.mode+":"+profile.id;
    if(lastProfile.current!==identity&&profile.applyQualityOnSelect)latest.current.applyQuality(profile.quality);
    lastProfile.current=identity;
  },[engine,profile]);
  useEffect(()=>{
    if(options.blocked||!options.connected){engine.cancel("연결/설정 변경");latest.current.releaseLegacy();}
  },[engine,options.blocked,options.connected]);
  useEffect(()=>{
    const owners=[window,...(options.detached?[options.detached]:[])];
    const excluded=(target:EventTarget|null)=>Boolean((target as Element|null)?.closest?.("input,textarea,select,button,summary,a,[contenteditable=true],.interaction-controls"));
    const focused=()=>owners.some(owner=>owner.document.hasFocus()&&!owner.document.hidden&&!excluded(owner.document.activeElement)&&
      (owner===window?Boolean(latest.current.viewer.current?.contains(owner.document.activeElement)&&owner.document.activeElement?.closest(".phone-view")):owner.document.activeElement?.closest(".detached-phone-view")));
    const cancel=()=>{engine.cancel("포커스 상실/숨김");latest.current.releaseLegacy();};
    const keyEvent=(event:KeyboardEvent,down:boolean)=>{
      if(!down){engine.time(performance.now());engine.key(event.code,false);return;}
      if(event.altKey||event.ctrlKey||event.metaKey||event.isComposing||latest.current.blocked||!latest.current.connected||excluded(event.target)||!focused()||editing)return;
      engine.time(performance.now());
      if(engine.key(event.code,down,event.repeat)){event.preventDefault();event.stopPropagation();lastActivity.current=performance.now();}
    };
    const down=(event:KeyboardEvent)=>keyEvent(event,true),up=(event:KeyboardEvent)=>keyEvent(event,false);
    const visibility=()=>{if(owners.some(o=>o.document.hidden))cancel();};
    const focus=(event:FocusEvent)=>{if((event.target as Element|null)?.closest?.("[data-auto-control]"))return;if(excluded(event.target)){engine.cancel("설정/입력창 포커스");latest.current.releaseLegacy();}};
    for(const owner of owners){owner.addEventListener("keydown",down,true);owner.addEventListener("keyup",up,true);owner.addEventListener("blur",cancel);owner.document.addEventListener("visibilitychange",visibility);owner.document.addEventListener("focusin",focus);}
    let lastUI=0;
    const timer=window.setInterval(()=>{
      const now=performance.now();
      const allowed=focused()&&!editing&&!latest.current.blocked&&latest.current.connected;
      let padText="입력 대기 · 화면을 활성화하세요";
      if(allowed){
        engine.tick(now);
        try{
          const pad=Array.from(navigator.getGamepads?.()??[]).find(p=>p?.connected);
          padText=pad?pad.mapping==="standard"?"표준 게임패드 연결됨 (터치 매핑)":"비표준 매핑 · 지원 제한":"연결 없음";
          engine.pad(pad??null);
        }catch{engine.pad(null);padText="Gamepad API 사용 불가";}
        if(latest.current.client?.inputError){engine.cancel(latest.current.client.inputError);latest.current.client.inputError=null;}
      }else if(engine.pointerCount||engine.auto!=="stopped")engine.cancel("입력 영역 비활성화");
      if(now-lastUI>200){lastUI=now;const next={auto:engine.auto,error:engine.error??"",pointers:engine.pointerCount,pad:padText,idle:now-lastActivity.current>2200};setStatus(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);}
    },32);
    return()=>{clearInterval(timer);cancel();for(const owner of owners){owner.removeEventListener("keydown",down,true);owner.removeEventListener("keyup",up,true);owner.removeEventListener("blur",cancel);owner.document.removeEventListener("visibilitychange",visibility);owner.document.removeEventListener("focusin",focus);}};
  },[engine,editing,options.detached]);
  const update=(patch:Partial<InteractionProfile>)=>{
    const problem=mappingProblem({...profile,...patch});
    if(problem){setNotice(problem);return false;}
    engine.cancel("설정 변경");latest.current.releaseLegacy();
    setNotice(latest.current.personal?"변경 적용 중":"공용 PC: 이번 세션에 적용됨 (저장하지 않음)");
    setStore(old=>({...old,profiles:old.profiles.map(p=>p.id===profile.id?sanitizeProfile({...p,...patch},p.mode,p.id):p)}));
  };
  const moveMapping=(id:string,x:number,y:number)=>{
    if(!editing)return;
    if(id==="joystick")update({joystick:{...profile.joystick,x,y}});
    else if(id==="look")update({lookStick:{...profile.lookStick,x,y}});
    else update({bindings:profile.bindings.map(m=>m.id===id?{...m,x,y}:m)});
  };
  return {store,profile,engine,status,editing,selectedBinding,pan,setPan,notice,showMappings,setShowMappings,moveMapping,
    save:()=>{if(loaded!==storageIdentity){setNotice("프로필을 불러오는 중입니다. 잠시 후 다시 저장하세요.");return;}if(!options.personal){setNotice("공용 PC: 이번 세션에서만 사용하며 저장하지 않습니다.");return;}try{localStorage.setItem(key,JSON.stringify(store));preserveSaved.current=false;setNotice("개인 PC에 저장했습니다.");}catch{setNotice("저장 실패: 브라우저 저장소 권한과 여유 공간을 확인하세요. 이번 세션 설정은 유지됩니다.");}},
    activity:()=>{lastActivity.current=performance.now();},
    update,
    setEditing:(value:boolean)=>{engine.cancel("편집 모드 변경");latest.current.releaseLegacy();setEditing(value);if(value)setShowMappings(true);},
    setSelectedBinding,
    selectMode:(mode:InteractionMode)=>{setNotice("");engine.cancel("모드 전환");latest.current.releaseLegacy();setEditing(false);setPan({x:0,y:0});setStore(old=>({...old,mode}));},
    selectProfile:(id:string)=>{setNotice("");engine.cancel("프로필 전환");setEditing(false);setPan({x:0,y:0});setStore(old=>({...old,selected:{...old.selected,[old.mode]:id}}));},
    reload:()=>{engine.cancel("설정 불러오기");latest.current.releaseLegacy();let data=null;try{if(latest.current.personal)data=localStorage.getItem(key);const problem=savedProfileProblem(data);preserveSaved.current=Boolean(problem);setNotice(problem||"저장 설정을 불러왔습니다.");setStore(parseStore(problem?null:data));setEditing(false);}catch{setNotice("저장소를 읽을 수 없습니다. 현재 설정을 유지합니다.");}},
    addProfile:()=>setStore(old=>old.profiles.length>=12?old:(()=>{const p=defaultProfile(old.mode,crypto.randomUUID());p.name=`새 ${old.mode} 프로필`;return {...old,selected:{...old.selected,[old.mode]:p.id},profiles:[...old.profiles,p]};})()),
    reset:()=>{engine.cancel("설정 초기화");latest.current.releaseLegacy();setStore(defaultStore());setEditing(false);setPan({x:0,y:0});},
    applyQuality:()=>latest.current.applyQuality(profile.quality),
    pick:(x:number,y:number)=>moveMapping(selectedBinding,x,y),
  };
}
export type InteractionHandle = ReturnType<typeof useInteraction>;
