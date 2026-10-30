import RemoteConsole from "./remote-console";
import PublicConsole from "./public-console";
import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
  isAllowedOwnerEmail,
} from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  if (!user) return <PublicConsole signInPath={chatGPTSignInPath("/")} />;

  if (process.env.NODE_ENV !== "development" && !isAllowedOwnerEmail(user.email)) {
    return (
      <main style={{ maxWidth: 560, margin: "12vh auto", padding: 24, fontFamily: "system-ui" }}>
        <h1>접근 권한이 없는 계정입니다.</h1>
        <p>Galaxy Remote 2.0 소유자 계정으로 다시 로그인해 주세요.</p>
        <a href={chatGPTSignOutPath("/")}>다른 ChatGPT 계정으로 로그인</a>
      </main>
    );
  }

  return (
    <RemoteConsole
      displayName={user.displayName}
      email={user.email}
      signOutPath={chatGPTSignOutPath("/")}
    />
  );
}
