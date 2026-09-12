import { useMemo, useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { createHttpVirtueApi, type HttpVirtueClient } from "./api/httpVirtueApi";
import { App } from "./App";
import "./styles.css";

const TOKEN_KEY = "virtue-session-token";
const ACCOUNT_KEY = "virtue-account-id";

type CloudVirtueAppProps = { baseUrl: string; storage?: Storage };

export function CloudVirtueApp({ baseUrl, storage = window.localStorage }: CloudVirtueAppProps) {
  const [accountId, setAccountId] = useState(() => { try { return storage.getItem(ACCOUNT_KEY) ?? ""; } catch { return ""; } });
  const [token, setToken] = useState(() => { try { return storage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; } });
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const api = useMemo<HttpVirtueClient | null>(() => token ? createHttpVirtueApi({ baseUrl, getAccessToken: () => token }) : null, [baseUrl, token]);

  if (api) {
    return <>
      <div className="cloud-actions">
        <button type="button" className="settings-link" disabled={passkeyBusy} onClick={async () => {
          setPasskeyBusy(true); setError("");
          try { const options = await api.auth.beginPasskeyRegistration(); await api.auth.finishPasskeyRegistration(await startRegistration({ optionsJSON: options as never })); setError("通行密钥已添加。"); }
          catch (cause) { setError(cause instanceof Error ? cause.message : "通行密钥添加失败。"); }
          finally { setPasskeyBusy(false); }
        }}>{passkeyBusy ? "处理中…" : "添加通行密钥"}</button>
        <button type="button" className="settings-link" onClick={() => { setToken(""); try { storage.removeItem(TOKEN_KEY); } catch { /* best effort */ } }}>退出云端账户</button>
      </div>
      {error && <p role="status" className="cloud-status">{error}</p>}
      <App virtueApi={api} />
    </>;
  }

  async function login(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const loginApi = createHttpVirtueApi({ baseUrl });
      const result = await loginApi.auth.loginWithRecovery(accountId.trim(), code.trim(), deviceName.trim() || undefined);
      setToken(result.token);
      try { storage.setItem(TOKEN_KEY, result.token); storage.setItem(ACCOUNT_KEY, result.accountId); } catch { /* best effort */ }
      setCode("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "登录失败，请稍后重试。"); }
    finally { setBusy(false); }
  }

  return <main className="main cloud-login-shell"><section className="dialog cloud-login-card" aria-labelledby="cloud-login-title"><p className="dialog-kicker">功过格云端</p><h1 id="cloud-login-title">回到你的记录</h1><p>使用被邀请账户和一次性恢复码登录。恢复码只使用一次，登录后可在设备设置中管理会话。</p><form onSubmit={login}><label>账户标识<input value={accountId} onChange={(event) => setAccountId(event.target.value)} autoComplete="username" required /></label><label>一次性恢复码<input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" required /></label><label>设备名称 <span>可选</span><input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} placeholder="例如：我的手机" /></label>{error && <p role="alert" className="error-text">{error}</p>}<button className="primary-button" type="submit" disabled={busy || !accountId.trim() || !code.trim()}>{busy ? "登录中…" : "使用恢复码登录"}</button>
      <button className="secondary-button" type="button" disabled={busy || !accountId.trim()} onClick={async () => {
        setBusy(true); setError("");
        try { const loginApi = createHttpVirtueApi({ baseUrl }); const options = await loginApi.auth.beginPasskeyLogin(accountId.trim()); const response = await startAuthentication({ optionsJSON: options as never }); const result = await loginApi.auth.finishPasskeyLogin(accountId.trim(), response, deviceName.trim() || undefined); setToken(result.token); try { storage.setItem(TOKEN_KEY, result.token); storage.setItem(ACCOUNT_KEY, result.accountId); } catch { /* best effort */ } }
        catch (cause) { setError(cause instanceof Error ? cause.message : "通行密钥登录失败。"); }
        finally { setBusy(false); }
      }}>使用通行密钥登录</button></form></section></main>;
}
