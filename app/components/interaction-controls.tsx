"use client";
import type { InteractionHandle } from "../../lib/interaction/use-interaction";
import { isButtonKey, type InteractionMode } from "../../lib/interaction/profiles";
export default function InteractionControls({control,personal,connected,focusViewer}:{control:InteractionHandle;personal:boolean;connected:boolean;focusViewer:()=>void}) {
  const {profile:p,update,status}=control;
  const reading=(patch:Partial<typeof p.reading>)=>update({reading:{...p.reading,...patch}});
  const binding=p.bindings.find(m=>m.id===control.selectedBinding);
  const updateBinding=(patch:Partial<NonNullable<typeof binding>>)=>update({bindings:p.bindings.map(m=>m.id===control.selectedBinding?{...m,...patch}:m)});
  return <section className="interaction-controls" aria-label="모드별 조작 설정">
    {control.notice&&/중복|좌표는|실패|손상|읽을 수 없|형식/.test(control.notice)&&<p role="alert" className="interaction-alert">{control.notice}</p>}
    <div className="interaction-mode-tabs" role="group" aria-label="사용 모드">{([['game','게임'],['novel','소설'],['webtoon','웹툰']] as const).map(([mode,label])=><button key={mode} type="button" aria-pressed={p.mode===mode} onClick={()=>control.selectMode(mode as InteractionMode)}>{label}</button>)}</div>
    <div className="interaction-row"><label>프로필<select value={p.id} onChange={e=>control.selectProfile(e.target.value)}>{control.store.profiles.filter(v=>v.mode===p.mode).map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label><button type="button" onClick={control.addProfile} disabled={control.store.profiles.length>=12}>새 프로필</button><button type="button" disabled={!connected} onClick={focusViewer}>화면 입력 활성화</button></div>
    <p className="interaction-note">{personal?"개인 PC: 계정·기기별 로컬 저장":"공용 PC: 이번 세션에서만 사용"} · 보호된 화면/DRM 앱은 캡처가 제한될 수 있습니다.</p>
    {p.mode==='game'?<>
      <label><input type="checkbox" checked={p.mappingEnabled} onChange={e=>update({mappingEnabled:e.target.checked})}/> 키·마우스 매핑 활성화 (WASD/방향키)</label>
      <label><input type="checkbox" checked={p.experimentalMulti} onChange={e=>update({experimentalMulti:e.target.checked})}/> 연속 멀티터치 실험에 동의 · 기기 미검증, 최대 5포인터</label>
      <label><input type="checkbox" checked={p.gamepadEnabled} onChange={e=>update({gamepadEnabled:e.target.checked})}/> 표준 게임패드 → 터치 매핑</label>
      <label><input type="checkbox" checked={p.lookStick.enabled} onChange={e=>update({lookStick:{...p.lookStick,enabled:e.target.checked}})}/> 오른쪽 스틱 → 시점 터치 (실험)</label>
      <p className="interaction-note">{status.pad} · Android 네이티브 게임패드가 아닙니다. 매핑 입력은 새 Android 앱이 필요합니다.</p>
      <button type="button" aria-pressed={control.editing} onClick={()=>control.setEditing(!control.editing)}>{control.editing?'편집 종료 · 플레이':'키 매핑 편집'}</button>
      <button type="button" aria-pressed={control.showMappings} onClick={()=>control.setShowMappings(!control.showMappings)}>{control.showMappings?'매핑 숨김':'매핑 표시'}</button>
      {control.editing&&<fieldset><legend>편집 중 원격 입력 중지 · 마커 드래그/방향키 또는 화면 클릭</legend>
        <label>대상<select value={control.selectedBinding} onChange={e=>control.setSelectedBinding(e.target.value)}><option value="joystick">이동 조이스틱 중심</option><option value="look">오른쪽 스틱 중심</option>{p.bindings.map(m=><option key={m.id} value={m.id}>{m.key}</option>)}</select></label>
        <button type="button" disabled={p.bindings.length>=32} onClick={()=>{const key=Array.from('FGHJKLQERTYUIOPZXCVBNM').map(k=>`Key${k}`).find(k=>!p.bindings.some(m=>m.key===k));if(key)update({bindings:[...p.bindings,{id:`new-${Date.now()}`,key,x:.8,y:.5,size:.08,action:'hold'}]});}}>버튼 추가</button>
        {binding&&<><label>키 할당<input aria-label="매핑 키 할당" value={binding.key} readOnly onKeyDown={e=>{e.preventDefault();if(!e.altKey&&!e.ctrlKey&&!e.metaKey&&isButtonKey(e.code))updateBinding({key:e.code});}}/></label>
          <label>마우스/패드 코드<select aria-label="매핑 코드" value={/^(Mouse|Pad)/.test(binding.key)?binding.key:""} onChange={e=>{if(e.target.value)updateBinding({key:e.target.value});}}><option value="">키보드 지정란 사용</option>{['Mouse0','Mouse1','Mouse2','Mouse3','Mouse4',...Array.from({length:17},(_,i)=>`Pad${i}`)].map(k=><option key={k} value={k}>{k}</option>)}</select></label>
          <label>동작<select value={binding.action} onChange={e=>updateBinding({action:e.target.value as typeof binding.action})}><option value="hold">누르는 동안 유지</option><option value="tap">짧게 누르기</option><option value="longPress">650ms 길게 누르기</option></select></label>
          <label>X 좌표<input aria-label="매핑 X 좌표" type="number" min="0" max="1" step="0.01" value={binding.x} onChange={e=>updateBinding({x:e.target.valueAsNumber})}/></label>
          <label>Y 좌표<input aria-label="매핑 Y 좌표" type="number" min="0" max="1" step="0.01" value={binding.y} onChange={e=>updateBinding({y:e.target.valueAsNumber})}/></label>
          <label>버튼 크기<input type="range" min="0.03" max="0.25" step="0.01" value={binding.size} onChange={e=>updateBinding({size:Number(e.target.value)})}/></label>
          <button type="button" onClick={()=>update({bindings:p.bindings.filter(m=>m.id!==binding.id)})}>버튼 삭제</button></>}
        <label>조이스틱 반경<input type="range" min="0.02" max="0.2" step="0.01" value={p.joystick.radius} onChange={e=>update({joystick:{...p.joystick,radius:Number(e.target.value)}})}/></label>
        <label>오른쪽 스틱 반경<input type="range" min="0.02" max="0.2" step="0.01" value={p.lookStick.radius} onChange={e=>update({lookStick:{...p.lookStick,radius:Number(e.target.value)}})}/></label>
        <label>아날로그 감도<input type="range" min="0.25" max="3" step="0.05" value={p.sensitivity} onChange={e=>update({sensitivity:Number(e.target.value)})}/></label>
      </fieldset>}
    </>:<>
      <div className="interaction-row" data-auto-control="true"><button type="button" disabled={!connected} onClick={()=>{focusViewer();control.engine.startAuto();}}>자동 스크롤 시작</button><button type="button" disabled={!connected} onClick={()=>{focusViewer();if(status.auto==='paused')control.engine.resumeAuto();else control.engine.pauseAuto();}}>{status.auto==='paused'?'재개':'일시정지'}</button><button type="button" onClick={()=>control.engine.stopAuto()}>중지</button><output aria-live="polite" data-state={status.auto}>{{stopped:"중지됨",running:"실행 중",paused:"일시정지됨"}[status.auto]??status.auto}</output></div>
      <div className="interaction-row"><button type="button" disabled={!connected} onClick={()=>{focusViewer();control.engine.time(performance.now());control.engine.key(p.reading.previousKey,true);control.engine.key(p.reading.previousKey,false);}}>이전 페이지</button><button type="button" disabled={!connected} onClick={()=>{focusViewer();control.engine.time(performance.now());control.engine.key(p.reading.nextKey,true);control.engine.key(p.reading.nextKey,false);}}>다음 페이지</button></div>
      <p className="interaction-note">자동 스크롤은 반복 스와이프입니다. 현재 독서 진도나 페이지 위치는 알 수 없습니다.</p>
      <details><summary>독서 조작 설정</summary>
      <label>탐색 방식<select value={p.reading.navigation} onChange={e=>reading({navigation:e.target.value as typeof p.reading.navigation})}><option value="vertical">세로 스와이프</option><option value="horizontal">좌우 페이지 스와이프</option><option value="tap">좌우 탭 넘김</option></select></label>
      <label>휠 감도<input type="range" min="0.25" max="3" step="0.05" value={p.reading.speed} onChange={e=>reading({speed:Number(e.target.value)})}/></label>
      <label>스크롤 거리<input type="range" min="0.05" max="0.7" step="0.01" value={p.reading.distance} onChange={e=>reading({distance:Number(e.target.value)})}/></label>
      <label>자동 속도<input type="range" min="0.1" max="3" step="0.1" value={p.reading.autoSpeed} onChange={e=>reading({autoSpeed:Number(e.target.value)})}/></label>
      <label>자동 방향<select value={p.reading.autoDirection} onChange={e=>reading({autoDirection:Number(e.target.value) as 1|-1})}><option value="1">앞으로</option><option value="-1">뒤로</option></select></label>
      <label>자동 단축키<input value={p.reading.shortcut} readOnly onKeyDown={e=>{e.preventDefault();if(!e.altKey&&!e.ctrlKey&&!e.metaKey&&/^Key[A-Z]$/.test(e.code))reading({shortcut:e.code});}}/></label>
      <label>다음 이동 키<input readOnly value={p.reading.nextKey} onKeyDown={e=>{e.preventDefault();if(!e.altKey&&!e.ctrlKey&&!e.metaKey&&/^(Key[A-Z]|PageDown|Space)$/.test(e.code))reading({nextKey:e.code});}}/></label>
      <label>이전 이동 키<input readOnly value={p.reading.previousKey} onKeyDown={e=>{e.preventDefault();if(!e.altKey&&!e.ctrlKey&&!e.metaKey&&/^(Key[A-Z]|PageUp)$/.test(e.code))reading({previousKey:e.code});}}/></label>
      <label><input type="checkbox" checked={p.reading.reverse} onChange={e=>reading({reverse:e.target.checked})}/> 스크롤 방향 반전</label>
      <label><input type="checkbox" checked={p.reading.clickPages} onChange={e=>reading({clickPages:e.target.checked})}/> 좌우 영역 클릭으로 넘기기</label>
      <label>왼쪽 영역 경계<input type="range" min="0.05" max="0.45" step="0.05" value={p.reading.leftZone} onChange={e=>reading({leftZone:Number(e.target.value)})}/></label>
      <label>오른쪽 영역 경계<input type="range" min="0.55" max="0.95" step="0.05" value={p.reading.rightZone} onChange={e=>reading({rightZone:Number(e.target.value)})}/></label>
      </details>
      <p className="interaction-note">확대는 영상 표시 크기만 바꿉니다. 확대 후 Shift+드래그로 표시 이동. Page Up/Down·방향키·Space로 탐색합니다. 앱의 정확한 페이지/스크롤 위치는 알 수 없습니다.</p>
    </>}
      <label>표시 확대 {Math.round(p.zoom*100)}%<input type="range" min="0.5" max="3" step="0.05" value={p.zoom} onChange={e=>{update({zoom:Number(e.target.value)});control.setPan({x:0,y:0});}}/></label>
      <button type="button" onClick={()=>{update({zoom:1});control.setPan({x:0,y:0});}}>창에 맞춤</button>
      {p.mode!=='game'&&<label><input type="checkbox" checked={p.minimal} onChange={e=>update({minimal:e.target.checked})}/> 도구·커서 자동 숨김</label>}

    <button type="button" onClick={control.save}>프로필 저장</button>
    {control.notice&&<p className="interaction-note" role="status">{control.notice}</p>}
    <details><summary>프로필 · 화질 · 도움말</summary>
      <label>이름<input value={p.name} maxLength={48} onChange={e=>update({name:e.target.value})}/></label>
      <p>권장: 게임 저지연/가능 시 60fps, 소설·웹툰 선명도/30fps. 현재 화질을 기본적으로 유지합니다. 저장 화질은 직접 적용하거나 아래 선택 시 적용 옵션을 사용하세요.</p>
      <label>프로필 해상도<select value={p.quality.edge} onChange={e=>update({quality:{...p.quality,edge:Number(e.target.value) as typeof p.quality.edge}})}>{[540,720,1080,1440].map(n=><option key={n} value={n}>{n}p</option>)}</select></label>
      <label>프로필 FPS<select value={p.quality.fps} onChange={e=>update({quality:{...p.quality,fps:Number(e.target.value) as typeof p.quality.fps}})}>{[24,30,60].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
      <label><input type="checkbox" checked={p.quality.auto} onChange={e=>update({quality:{...p.quality,auto:e.target.checked}})}/> 네트워크 자동 화질</label>
      <label><input type="checkbox" checked={p.applyQualityOnSelect} onChange={e=>update({applyQualityOnSelect:e.target.checked})}/> 이 프로필 선택 시 저장한 화질 적용 (선택 사항)</label>
      <button type="button" onClick={control.applyQuality}>이 프로필 화질 적용</button>
      <button type="button" disabled={!personal} onClick={control.reload}>저장 설정 불러오기</button>
      <button type="button" onClick={()=>{if(window.confirm('이 기기의 게임·소설·웹툰 조작 프로필을 초기화할까요?'))control.reset();}}>조작 설정 초기화</button>
      <p>화면을 클릭하거나 입력 활성화를 눌러 조작합니다. 설정 입력창·Alt+R/H/B·브라우저 수정키는 매핑에서 제외합니다. 모드·프로필·회전·포커스·연결 변경 시 입력과 자동 스크롤을 해제합니다.</p>
    </details>
    {status.error&&<p role="status" className="interaction-note">{status.error}</p>}
  </section>;
}
