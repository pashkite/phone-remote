import RemoteConsole from "./remote-console";
import {
  chatGPTSignOutPath,
  getChatGPTUser,
  isAllowedOwnerEmail,
  requireChatGPTUser,
} from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const authenticatedUser = await getChatGPTUser();
  const user = authenticatedUser ?? (
    process.env.NODE_ENV === "development"
      ? { displayName: "Preview Owner", email: "preview@local.test" }
      : await requireChatGPTUser("/")
  );

  if (process.env.NODE_ENV !== "development" && !isAllowedOwnerEmail(user.email)) {
    return (
      <main style={{ maxWidth: 560, margin: "12vh auto", padding: 24, fontFamily: "system-ui" }}>
        <h1>접근 권한이 없는 계정입니다.</h1>
        <p>Galaxy Remote 소유자 계정으로 다시 로그인해 주세요.</p>
        <a href={chatGPTSignOutPath("/")}>다른 ChatGPT 계정으로 로그인</a>
      </main>
    );
  }

  return (
    <RemoteConsole
      displayName={user.displayName}
      email={user.email}
    />
  );
}
