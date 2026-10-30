"use client";
import {useEffect, useState} from 'react';
import {DEVICE_TEST_BUILD_ID} from '../../lib/brand';
type Info = {buildId:string;protocolVersion:number;signalingOrigin:string};
export default function TestConnectionInfo(){
  const [info,setInfo]=useState<Info|null>(null);
  const [error,setError]=useState('서버 버전 확인 중');
  useEffect(()=>{
    let active=true;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),10000);
    void fetch('/api/build-info',{cache:'no-store',signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error(response.status===401?'다시 로그인한 뒤 연결 정보를 확인하세요.':'서버의 테스트 빌드를 확인할 수 없습니다.');
      let value:Partial<Info>|null;
      try {value=await response.json();} catch {throw new Error('서버가 린로 시험 정보를 제공하지 않습니다. 배포 버전과 로그인 상태를 확인하세요.');}
      if(!value||typeof value!=='object'||value.buildId!==DEVICE_TEST_BUILD_ID||value.protocolVersion!==1||typeof value.signalingOrigin!=='string')throw new Error('웹과 APK의 시험 버전이 다릅니다. 검토된 QA 웹을 확인하세요.');
      if(active&&!controller.signal.aborted)setInfo(value as Info);
    }).catch(e=>{if(active)setError(controller.signal.aborted?'서버 확인 시간이 초과되었습니다. 연결을 확인한 뒤 설정을 다시 여세요.':e instanceof TypeError?'서버에 연결하지 못했습니다. 네트워크와 QA 주소를 확인하세요.':e instanceof Error?e.message:'서버를 확인할 수 없습니다.');}).finally(()=>clearTimeout(timer));
    return()=>{active=false;controller.abort();clearTimeout(timer);};
  },[]);
  return <details className="install-help"><summary>테스트 연결 정보</summary>
    <p>시험 버전: {DEVICE_TEST_BUILD_ID}</p>
    {info?<p>웹·시그널링 주소: <strong>{info.signalingOrigin}</strong><br/>입력 프로토콜: v{info.protocolVersion}</p>:<p role="status">{error}</p>}
    <p>린로 앱의 ‘전송·대기·진단 → 테스트 연결 정보’와 주소·시험 버전을 비교하세요. 기존 등록 주소는 업데이트로 바뀌지 않습니다. 화면 OFF와 실기기 동작은 미검증입니다.</p>
  </details>;
}
