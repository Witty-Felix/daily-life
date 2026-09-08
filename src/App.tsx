import { useEffect, useMemo, useState } from "react";
import {
  createBreakSession,
  getActivityById,
  type ActivityId,
  type BreakSession,
} from "./domain/relaxation";
import { endBreakSession, finishActivity } from "./domain/breakSession";
import { createLocalBreakStore } from "./storage/localBreakStore";
import type { ReactNode } from "react";
import "./styles.css";

type BreakStore = ReturnType<typeof createLocalBreakStore>;
type AppProps = {
  store?: BreakStore;
  random?: () => number;
  now?: () => Date;
  createId?: () => string;
  revealDelayMs?: number;
};

type View = "home" | "active" | "history";

const iconByActivity: Record<ActivityId, string> = {
  water: "◌",
  walk: "↗",
  abstinence: "◎",
  book: "▤",
  sing: "♪",
  snake: "⌁",
  ball: "○",
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function App({
  store = createLocalBreakStore(window.localStorage),
  random,
  now = () => new Date(),
  createId = () => crypto.randomUUID(),
  revealDelayMs = 900,
}: AppProps) {
  const [session, setSession] = useState<BreakSession | null>(() => store.getActive());
  const [view, setView] = useState<View>(() => (store.getActive() ? "active" : "home"));
  const [isRevealing, setIsRevealing] = useState(false);
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState(() => store.getHistory());

  const activity = useMemo(() => session ? getActivityById(session.activityId) : null, [session]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function startBreak() {
    const existing = store.getActive();
    if (existing) {
      setSession(existing);
      setView("active");
      setNotice("已有进行中的课间，已为你继续当前课间。");
      return;
    }

    const next = createBreakSession({ id: createId(), startedAt: now().toISOString(), random });
    store.saveActive(next);
    setSession(next);
    setView("active");
    setIsRevealing(revealDelayMs > 0);
    if (revealDelayMs > 0) {
      window.setTimeout(() => setIsRevealing(false), revealDelayMs);
    }
  }

  function markComplete() {
    if (!session || session.completed) return;
    const next = finishActivity(session);
    store.saveActive(next);
    setSession(next);
  }

  function confirmEnd() {
    if (!session) return;
    const ended = endBreakSession(session, now().toISOString());
    store.archive(ended);
    setSession(null);
    setHistory(store.getHistory());
    setEndDialogOpen(false);
    setView("home");
    setNotice(ended.completed ? "这次课间已记录为已完成。" : "这次课间已记录为未完成。下次继续就好。");
  }

  function renderHeader() {
    return (
      <header className="topbar">
        <button className="brand" onClick={() => !session && setView("home")} aria-label="回到首页">
          <span className="brand-mark" aria-hidden="true">☼</span>
          <span>课间松一松</span>
        </button>
        {!session && (
          <button className="history-link" onClick={() => { setHistory(store.getHistory()); setView("history"); }}>
            最近 7 天 <span aria-hidden="true">↗</span>
          </button>
        )}
      </header>
    );
  }

  if (view === "history" && !session) {
    return <div className="app-shell">{renderHeader()}<HistoryView history={history} onBack={() => setView("home")} /></div>;
  }

  return (
    <div className="app-shell">
      {renderHeader()}
      <main className={session ? "main active-main" : "main"}>
        {session && activity ? (
          <ActiveBreak
            session={session}
            activity={activity}
            isRevealing={isRevealing}
            onComplete={markComplete}
            onEnd={() => setEndDialogOpen(true)}
          />
        ) : (
          <HomeView onStart={startBreak} historyCount={history.length} />
        )}
      </main>
      {notice && <div className="toast" role="status">{notice}</div>}
      {endDialogOpen && <EndDialog onCancel={() => setEndDialogOpen(false)} onConfirm={confirmEnd} />}
    </div>
  );
}

function HomeView({ onStart, historyCount }: { onStart: () => void; historyCount: number }) {
  return (
    <section className="home-layout">
      <div className="home-copy">
        <p className="kicker"><span className="kicker-dot" /> 给自己一个短暂停顿</p>
        <h1>课间，<em>松一松。</em></h1>
        <p className="intro">不用费心决定。开始一次课间，让今天的你随机收到一项刚刚好的放松建议。</p>
        <button className="primary-button start-button" onClick={onStart}>开始本次课间 <span aria-hidden="true">→</span></button>
        <p className="privacy-note"><span aria-hidden="true">▣</span> 记录只保存在当前浏览器，不会自动同步到其他设备。</p>
      </div>
      <div className="home-orbit" aria-label="课间放松方式">
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
        <div className="orbit-center"><span>现在<br /><strong>休息</strong></span></div>
        <div className="orbit-label label-water">喝水</div>
        <div className="orbit-label label-walk">散步</div>
        <div className="orbit-label label-book">看书</div>
        <div className="orbit-label label-ball">打球</div>
      </div>
      <aside className="home-footer-card">
        <div><span className="footer-card-label">最近 7 天</span><strong>{historyCount} <small>次课间</small></strong></div>
        <span className="footer-card-arrow" aria-hidden="true">↗</span>
      </aside>
    </section>
  );
}

function ActiveBreak({ session, activity, isRevealing, onComplete, onEnd }: {
  session: BreakSession;
  activity: ReturnType<typeof getActivityById>;
  isRevealing: boolean;
  onComplete: () => void;
  onEnd: () => void;
}) {
  return (
    <section className="active-layout">
      <div className="active-meta"><span className="kicker-dot" /> 本次课间进行中 <time dateTime={session.startedAt}>{formatDate(session.startedAt)} 开始</time></div>
      <div className={`activity-card ${isRevealing ? "is-revealing" : ""}`} aria-live="polite">
        {isRevealing ? <RevealState /> : <>
          <div className="activity-symbol" aria-hidden="true">{iconByActivity[activity.id]}</div>
          <p className="activity-eyebrow">{activity.eyebrow}</p>
          <h1>{activity.name}</h1>
          <div className="activity-details"><span><b>怎么做</b>{activity.guidance}</span><span><b>预计时长</b>{activity.duration}</span></div>
        </>}
      </div>
      <div className="active-actions">
        <button className={`primary-button complete-button ${session.completed ? "completed" : ""}`} onClick={onComplete} disabled={session.completed}>
          <span aria-hidden="true">{session.completed ? "✓" : "○"}</span>{session.completed ? "已完成" : "活动完成"}
        </button>
        <button className="secondary-button" onClick={onEnd}>结束课间</button>
      </div>
      <p className="active-hint">完成活动后，仍需点击“结束课间”来保存这次记录。</p>
    </section>
  );
}

function RevealState() {
  return <div className="reveal-state"><div className="reveal-glyph">✦</div><p>正在为你挑一项…</p><span>轻轻松下来就好</span></div>;
}

function EndDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return <div className="dialog-backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="end-dialog-title" aria-label="结束这次课间？">
    <p className="dialog-kicker">结束确认</p><h2 id="end-dialog-title">结束这次课间？</h2><p>如果还没有完成活动，这次记录会保留为“未完成”，不会被丢掉。</p>
    <div className="dialog-actions"><button className="secondary-button" onClick={onCancel}>先不结束</button><button className="primary-button" onClick={onConfirm}>确认结束</button></div>
  </section></div>;
}

function HistoryView({ history, onBack }: { history: BreakSession[]; onBack: () => void }) {
  const completed = history.filter((item) => item.completed).length;
  return <section className="history-view"><button className="back-link" onClick={onBack}>← 回到首页</button><div className="history-heading"><p className="kicker"><span className="kicker-dot" /> 只看最近 7 天</p><h1>每次停一下，<br /><em>都算数。</em></h1></div><div className="history-summary"><div><span>课间次数</span><strong>{history.length}</strong></div><div><span>完成活动</span><strong>{completed}</strong></div><div><span>未完成</span><strong>{history.length - completed}</strong></div></div>{history.length === 0 ? <p className="empty-history">还没有记录。下一次课间，从一口水开始。</p> : <ul className="history-list">{history.map((item) => <li key={item.id}><span className="history-icon">{iconByActivity[item.activityId]}</span><div><strong>{getActivityById(item.activityId).name}</strong><small>{formatDate(item.startedAt)} · {item.completed ? "已完成" : "未完成"}</small></div><span className={item.completed ? "status-complete" : "status-incomplete"}>{item.completed ? "已完成" : "未完成"}</span></li>)}</ul>}</section>;
}

export { App };
