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
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [sessions, setSessions] = useState<unknown[]>([]);
  const [accountBusy, setAccountBusy] = useState(false);
  const api = useMemo<HttpVirtueClient | null>(() => token ? createHttpVirtueApi({ baseUrl, getAccessToken: () => token }) : null, [baseUrl, token]);

  if (api) {
    return <>
      <div className="cloud-actions">
        <button type="button" className="settings-link" onClick={async () => { setAccountPanelOpen(!accountPanelOpen); if (!accountPanelOpen) { try { setSessions(await api.auth.listSessions()); } catch (cause) { setError(cause instanceof Error ? cause.message : "设备会话读取失败。"); } } }}>账户与设备</button>
        <button type="button" className="settings-link" disabled={passkeyBusy} onClick={async () => {
          setPasskeyBusy(true); setError("");
          try { const options = await api.auth.beginPasskeyRegistration(); await api.auth.finishPasskeyRegistration(await startRegistration({ optionsJSON: options as never })); setError("通行密钥已添加。"); }
          catch (cause) { setError(cause instanceof Error ? cause.message : "通行密钥添加失败。"); }
          finally { setPasskeyBusy(false); }
        }}>{passkeyBusy ? "处理中…" : "添加通行密钥"}</button>
        <button type="button" className="settings-link" onClick={() => { setToken(""); try { storage.removeItem(TOKEN_KEY); } catch { /* best effort */ } }}>退出云端账户</button>
      </div>
      {error && <p role="status" className="cloud-status">{error}</p>}
      {accountPanelOpen && <aside className="cloud-account-panel" role="dialog" aria-labelledby="cloud-account-title"><button type="button" className="drawer-close" onClick={() => setAccountPanelOpen(false)} aria-label="关闭账户设置">×</button><h2 id="cloud-account-title">账户与设备</h2><p>已登录设备：{sessions.length}</p><ul>{sessions.map((item) => { const session = item as { id: string; deviceName?: string; revokedAt?: string | null }; return <li key={session.id}>{session.deviceName ?? "未命名设备"}{session.revokedAt ? "（已撤销）" : <button type="button" onClick={async () => { await api.auth.revokeSession(session.id); setSessions(await api.auth.listSessions()); }}>撤销</button>}</li>; })}</ul><button type="button" disabled={accountBusy} onClick={async () => { setAccountBusy(true); try { await api.auth.revokeOtherSessions(); setSessions(await api.auth.listSessions()); } finally { setAccountBusy(false); } }}>退出其他设备</button><button type="button" disabled={accountBusy} onClick={async () => { setAccountBusy(true); try { const reauth = await api.auth.reauthenticate(); const next = await api.auth.rotateRecovery(reauth.proof); setError(`新的恢复码：${next}`); } finally { setAccountBusy(false); } }}>生成新恢复码</button><button type="button" className="danger-button" disabled={accountBusy} onClick={async () => { if (!window.confirm("确定永久删除账户及全部功过记录吗？")) return; setAccountBusy(true); try { const reauth = await api.auth.reauthenticate(); await api.auth.deleteAccount(reauth.proof); setToken(""); storage.removeItem(TOKEN_KEY); } finally { setAccountBusy(false); } }}>永久删除账户</button></aside>}
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
