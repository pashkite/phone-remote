import Image from "next/image";
import ThemeToggle from "./components/theme-toggle";

export default function PublicConsole({ signInPath }: { signInPath: string }) {
  return (
    <main className="remote-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <Image unoptimized className="brand-symbol" src="/brand/symbol.svg" width="32" height="32" alt="" />
          <div><h1>Galaxy Remote <span className="version-label">2.0</span></h1></div>
        </div>
        <div className="owner-area"><ThemeToggle /><a className="guest-login" href={signInPath} target="_top">로그인</a></div>
      </header>
      <section className="console-grid" aria-label="Galaxy Remote 2.0 시작 화면">
        <article className="screen-card">
          <div className="card-heading">
            <div><p className="eyebrow">GALAXY REMOTE</p><h2>휴대폰 화면</h2></div>
          </div>
          <div className="screen-stage">
            <div className="phone-view">
              <div className="screen-placeholder">
                <div className="placeholder-orbit" aria-hidden="true"><span /></div>
                <strong>내 갤럭시를 PC에서</strong>
                <p>화면을 보고 터치하고, 키보드로 입력하세요. 연결할 때 소유자 계정을 확인합니다.</p>
                <span className="standby-badge">휴대폰 앱 등록 대기</span>
              </div>
            </div>
          </div>
        </article>
        <aside className="control-rail">
          <section className="control-card connect-card">
            <p className="eyebrow">GET CONNECTED</p>
            <h2>갤럭시에 연결하기</h2>
            <p>사이트는 로그인 없이 둘러볼 수 있어요. 휴대폰을 연결하거나 조작하려면 소유자 계정으로 로그인해 주세요.</p>
            <a className="primary-action guest-connect" href={signInPath} target="_top">로그인하여 연결</a>
          </section>
          <section className="control-card">
            <h3>휴대폰 앱 준비</h3>
            <p className="guest-description">Galaxy Remote 2.0 앱을 설치한 뒤, 로그인한 PC에서 등록 코드를 만들면 연결할 수 있어요.</p>
            <p className="install-warning">2.0 시험 앱은 아직 공개 배포하지 않았습니다. 전달받은 테스트 APK를 설치하세요. 기존 앱은 삭제하지 마세요.</p>
          </section>
          <section className="privacy-note"><span className="shield" aria-hidden="true">◇</span><div><strong>소유자만 연결할 수 있어요</strong><p>등록 기기와 연결 정보는 로그인한 소유자에게만 표시됩니다. 휴대폰에서 허용한 동안만 화면을 공유하고 조작할 수 있어요.</p></div></section>
        </aside>
      </section>
    </main>
  );
}
