import { useEffect, useMemo, useState } from "react";
import {
  createBreakSession,
  getActivityById,
  type ActivityId,
  type BreakSession,
} from "./domain/relaxation";
import { endBreakSession, finishActivity, replaceActivity } from "./domain/breakSession";
import { createSnakeGame, endSnakeGame, setSnakeDirection, startSnakeGame, stepSnakeGame, toggleSnakePause, SNAKE_GRID_SIZE, SNAKE_MAX_GAMES, type SnakeDirection, type SnakeGameState } from "./domain/snakeGame";
import { createLocalBreakStore } from "./storage/localBreakStore";
import { formatHistoryDate, formatHistoryDay, getCompletedActivityCounts, getHistoryDayStats } from "./domain/historyStats";
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

function getDefaultAnimationEnabled() {
  return typeof window === "undefined" || !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function formatDate(iso: string) {
  return formatHistoryDate(iso);
}

function App({
  store = createLocalBreakStore(window.localStorage, undefined, getDefaultAnimationEnabled()),
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
  const [animationEnabled, setAnimationEnabled] = useState(() => store.getAnimationEnabled());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

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
    const revealDuration = animationEnabled ? revealDelayMs : 0;
    setIsRevealing(revealDuration > 0);
    if (revealDuration > 0) {
      window.setTimeout(() => setIsRevealing(false), revealDuration);
    }
  }

  function swapActivity() {
    if (!session || session.completed || session.replacedActivityId != null) return;
    const next = replaceActivity(session, random);
    store.saveActive(next);
    setSession(next);
  }

  function startSnakeRound() {
    if (!session || session.activityId !== "snake" || (session.snakeGamesStarted ?? 0) >= SNAKE_MAX_GAMES) return;
    const next = { ...session, snakeGamesStarted: (session.snakeGamesStarted ?? 0) + 1 };
    store.saveActive(next);
    setSession(next);
  }

  function markComplete() {
    if (!session || session.completed || (session.activityId === "snake" && (session.snakeGamesStarted ?? 0) < 1)) return;
    const next = finishActivity(session);
    store.saveActive(next);
    setSession(next);
  }

  function updateAnimationEnabled(enabled: boolean) {
    store.setAnimationEnabled(enabled);
    setAnimationEnabled(enabled);
  }

  function clearLocalData() {
    const preservedAnimation = store.getAnimationEnabled();
    store.clear();
    setSession(null);
    setHistory([]);
    setAnimationEnabled(preservedAnimation);
    setSettingsOpen(false);
    setClearDialogOpen(false);
    setEndDialogOpen(false);
    setView("home");
    setNotice("本地记录和进行中的课间已清除，动画设置已保留。");
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
        <nav className="topbar-actions" aria-label="页面导航">
          {!session && (
            <button className="history-link" onClick={() => { setHistory(store.getHistory()); setView("history"); }}>
              最近 7 天 <span aria-hidden="true">↗</span>
            </button>
          )}
          <button className="settings-link" onClick={() => setSettingsOpen(true)}>设置</button>
        </nav>
      </header>
    );
  }

  if (view === "history" && !session) {
    return <div className="app-shell">
      {renderHeader()}
      <HistoryView history={history} now={now()} onBack={() => setView("home")} />
      {notice && <div className="toast" role="status">{notice}</div>}
      {settingsOpen && <SettingsDialog animationEnabled={animationEnabled} onAnimationChange={updateAnimationEnabled} onRequestClear={() => setClearDialogOpen(true)} onClose={() => setSettingsOpen(false)} />}
      {clearDialogOpen && <ClearDataDialog onCancel={() => setClearDialogOpen(false)} onConfirm={clearLocalData} />}
    </div>;
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
            onSwap={swapActivity}
            onSnakeGameStarted={startSnakeRound}
            snakeRandom={random}
            onEnd={() => setEndDialogOpen(true)}
          />
        ) : (
          <HomeView onStart={startBreak} historyCount={history.length} />
        )}
      </main>
      {notice && <div className="toast" role="status">{notice}</div>}
      {endDialogOpen && <EndDialog onCancel={() => setEndDialogOpen(false)} onConfirm={confirmEnd} />}
      {settingsOpen && <SettingsDialog animationEnabled={animationEnabled} onAnimationChange={updateAnimationEnabled} onRequestClear={() => setClearDialogOpen(true)} onClose={() => setSettingsOpen(false)} />}
      {clearDialogOpen && <ClearDataDialog onCancel={() => setClearDialogOpen(false)} onConfirm={clearLocalData} />}
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

function ActiveBreak({ session, activity, isRevealing, onComplete, onSwap, onEnd, onSnakeGameStarted, snakeRandom }: {
  session: BreakSession;
  activity: ReturnType<typeof getActivityById>;
  isRevealing: boolean;
  onComplete: () => void;
  onSwap: () => void;
  onEnd: () => void;
  onSnakeGameStarted: () => void;
  snakeRandom?: () => number;
}) {
  const [selectedSubActivityId, setSelectedSubActivityId] = useState<string | null>(null);
  const [snakeRoundFinished, setSnakeRoundFinished] = useState(false);
  const selectedSubActivity = activity.subActivities?.find((item) => item.id === selectedSubActivityId) ?? null;
  const snakeNeedsRound = activity.id === "snake" && !snakeRoundFinished;
  function handleSnakeStarted() {
    setSnakeRoundFinished(false);
    onSnakeGameStarted();
  }

  return (
    <section className="active-layout">
      <div className="active-meta"><span className="kicker-dot" /> 本次课间进行中 <time dateTime={session.startedAt}>{formatDate(session.startedAt)} 开始</time></div>
      <div className={`activity-card ${isRevealing ? "is-revealing" : ""}`} aria-live="polite">
        {isRevealing ? <RevealState /> : <>
          <div className="activity-symbol" aria-hidden="true">{iconByActivity[activity.id]}</div>
          {session.replacedActivityId && <p className="replacement-note">已替换：{getActivityById(session.replacedActivityId).name}</p>}<p className="activity-eyebrow">{activity.eyebrow}</p>
          <h1>{activity.name}</h1>
          <div className="activity-details"><span><b>怎么做</b>{activity.guidance}</span><span><b>预计时长</b>{activity.duration}</span></div>
          {activity.subActivities && <AbstinenceChoice activities={activity.subActivities} selected={selectedSubActivity} onSelect={setSelectedSubActivityId} onReselect={() => setSelectedSubActivityId(null)} />}
          {activity.id === "snake" && <SnakeGame roundsStarted={session.snakeGamesStarted ?? 0} random={snakeRandom} onStarted={handleSnakeStarted} onRoundFinished={() => setSnakeRoundFinished(true)} />}
        </>}
      </div>
      <div className="active-actions">
        <button className={`primary-button complete-button ${session.completed ? "completed" : ""}`} onClick={onComplete} disabled={session.completed || snakeNeedsRound}>
          <span aria-hidden="true">{session.completed ? "✓" : "○"}</span>{session.completed ? "已完成" : "活动完成"}
        </button>
        <button className="secondary-button swap-button" onClick={onSwap} disabled={session.completed || session.replacedActivityId != null}>换一个</button>
        <button className="secondary-button" onClick={onEnd}>结束课间</button>
      </div>
      <p className="active-hint">{snakeNeedsRound ? "先开始并结束一局贪吃蛇，再确认活动完成。" : "完成活动后，仍需点击“结束课间”来保存这次记录。"}</p>
    </section>
  );
}

function SnakeGame({ roundsStarted, random, onStarted, onRoundFinished }: { roundsStarted: number; random?: () => number; onStarted: () => void; onRoundFinished: () => void }) {
  const [game, setGame] = useState<SnakeGameState | null>(null);
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!game || game.status !== "running") return;
    const timer = window.setInterval(() => setGame((current) => current ? stepSnakeGame(current) : current), 180);
    return () => window.clearInterval(timer);
  }, [game?.status]);
  useEffect(() => {
    if (!game || game.status === "game-over" || game.status === "ended") return;
    const pause = () => setGame((current) => current?.status === "running" ? toggleSnakePause(current) : current);
    document.addEventListener("visibilitychange", pause);
    window.addEventListener("blur", pause);
    return () => { document.removeEventListener("visibilitychange", pause); window.removeEventListener("blur", pause); };
  }, [game]);
  useEffect(() => {
    if (game?.status === "game-over" || game?.status === "ended") onRoundFinished();
  }, [game?.status, onRoundFinished]);
  function changeDirection(direction: SnakeDirection) { setGame((current) => current ? setSnakeDirection(current, direction) : current); }
  function start() { if (roundsStarted >= SNAKE_MAX_GAMES) return; onStarted(); setGame(startSnakeGame(createSnakeGame(random))); }
  function handleKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const directions: Record<string, SnakeDirection> = { ArrowUp: "up", w: "up", ArrowDown: "down", s: "down", ArrowLeft: "left", a: "left", ArrowRight: "right", d: "right" };
    const direction = directions[event.key];
    if (direction) { event.preventDefault(); changeDirection(direction); }
    if (event.key === " ") setGame((current) => current ? toggleSnakePause(current) : current);
  }
  const pointKey = (x: number, y: number) => `${x}-${y}`;
  if (!game || game.status === "idle") return <div className="snake-panel"><div><strong>贪吃蛇局数 {roundsStarted}/{SNAKE_MAX_GAMES}</strong><p>方向键/WASD 或手机滑动 · 边界可穿越</p></div><button className="primary-button" onClick={start} disabled={roundsStarted >= SNAKE_MAX_GAMES}>开始游戏</button></div>;
  return <div className="snake-panel" tabIndex={0} autoFocus onKeyDown={handleKey} onTouchStart={(event) => setTouchStart({ x: event.touches[0].clientX, y: event.touches[0].clientY })} onTouchEnd={(event) => { if (!touchStart) return; const dx = event.changedTouches[0].clientX - touchStart.x; const dy = event.changedTouches[0].clientY - touchStart.y; setTouchStart(null); if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return; changeDirection(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up")); }}>
    <div className="snake-toolbar"><strong>得分 {game.score}</strong><span>地图 {game.map.id} · {game.status === "paused" ? "已暂停" : game.status === "game-over" ? "本局结束" : game.status === "ended" ? "已结束" : "进行中"}</span></div>
    <div className="snake-board" aria-label="贪吃蛇棋盘">{Array.from({ length: SNAKE_GRID_SIZE * SNAKE_GRID_SIZE }, (_, index) => { const x = index % SNAKE_GRID_SIZE; const y = Math.floor(index / SNAKE_GRID_SIZE); const isHead = game.snake[0]?.x === x && game.snake[0]?.y === y; const isSnake = game.snake.some((part) => part.x === x && part.y === y); const isFood = game.food?.x === x && game.food?.y === y; const isBlock = game.map.obstacles.some((part) => part.x === x && part.y === y); return <span key={pointKey(x, y)} className={`${isHead ? "snake-head" : isSnake ? "snake-body" : isFood ? "snake-food" : isBlock ? "snake-block" : ""}`} />; })}</div>
    <div className="snake-controls"><button className="secondary-button" onClick={() => setGame(toggleSnakePause(game))} disabled={game.status === "game-over" || game.status === "ended"}>{game.status === "paused" ? "继续" : "暂停"}</button><button className="secondary-button" onClick={() => setGame(endSnakeGame(game))} disabled={game.status === "game-over" || game.status === "ended"}>结束本局</button>{(game.status === "game-over" || game.status === "ended") && roundsStarted < SNAKE_MAX_GAMES && <button className="primary-button" onClick={start}>开始下一局</button>}</div>
  </div>;
}
function AbstinenceChoice({
  activities,
  selected,
  onSelect,
  onReselect,
}: {
  activities: NonNullable<ReturnType<typeof getActivityById>["subActivities"]>;
  selected: NonNullable<ReturnType<typeof getActivityById>["subActivities"]>[number] | null;
  onSelect: (id: string) => void;
  onReselect: () => void;
}) {
  if (selected) {
    return <div className="sub-activity-selected" aria-live="polite">
      <h2>{selected.name}</h2>
      <p>{selected.guidance}</p>
      <button className="secondary-button" onClick={onReselect}>重新选择子活动</button>
    </div>;
  }

  return <div className="sub-activity-picker">
    <h2>选择一项练习</h2>
    <div className="sub-activity-options">
      {activities.map((item) => <button key={item.id} className="secondary-button" onClick={() => onSelect(item.id)}>{item.name}</button>)}
    </div>
  </div>;
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

function HistoryView({ history, now, onBack }: { history: BreakSession[]; now: Date; onBack: () => void }) {
  const stats = getHistoryDayStats(history, now);
  const counts = getCompletedActivityCounts(history);
  const completed = history.filter((item) => item.completed).length;
  const records = [...history].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return <section className="history-view">
    <button className="back-link" onClick={onBack}>← 回到首页</button>
    <div className="history-heading"><p className="kicker"><span className="kicker-dot" /> 只看最近 7 天</p><h1>每次停一下，<br /><em>都算数。</em></h1></div>
    <div className="history-summary"><div><span>课间次数</span><strong>{history.length}</strong></div><div><span>完成活动</span><strong>{completed}</strong></div><div><span>未完成</span><strong>{history.length - completed}</strong></div></div>
    <section className="history-section" aria-labelledby="daily-stats-title"><h2 id="daily-stats-title">按日期看记录</h2><div className="daily-stats">{stats.map((day) => <div className="daily-stat" key={day.date}><strong>{formatHistoryDay(day.date)}</strong><span>抽取 {day.drawn} · 完成 {day.completed} · 未完成 {day.incomplete}</span></div>)}</div></section>
    <section className="history-section" aria-labelledby="activity-stats-title"><h2 id="activity-stats-title">完成方式</h2><div className="activity-counts">{Object.keys(iconByActivity).map((id) => <div key={id}><span>{getActivityById(id as ActivityId).name}</span><strong>{counts[id as ActivityId] ?? 0}</strong></div>)}</div></section>
    <section className="history-section" aria-labelledby="records-title"><h2 id="records-title">每条记录</h2>{records.length === 0 ? <p className="empty-history">还没有记录。下一次课间，从一口水开始。</p> : <ul className="history-list">{records.map((item) => <li key={item.id}><span className="history-icon">{iconByActivity[item.activityId]}</span><div className="history-record"><details><summary><strong>{getActivityById(item.activityId).name}</strong><small>{formatDate(item.startedAt)} · {item.completed ? "已完成" : "未完成"}</small></summary><p>开始时间：{formatDate(item.startedAt)}</p><p>结束时间：{item.endedAt ? formatDate(item.endedAt) : "进行中"}</p><p>记录状态：{item.completed ? "已完成" : "未完成"}</p></details></div><span className={item.completed ? "status-complete" : "status-incomplete"}>{item.completed ? "已完成" : "未完成"}</span></li>)}</ul>}</section>
  </section>;
}

function SettingsDialog({ animationEnabled, onAnimationChange, onRequestClear, onClose }: { animationEnabled: boolean; onAnimationChange: (enabled: boolean) => void; onRequestClear: () => void; onClose: () => void }) {
  return <div className="dialog-backdrop"><section className="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" aria-label="本地数据设置"><p className="dialog-kicker">设置</p><h2 id="settings-title">本地数据设置</h2><p>记录只保存在当前浏览器，不会自动同步到其他设备；清除浏览器数据也可能让记录丢失。</p><label className="setting-toggle"><input aria-label="启用抽取动画" type="checkbox" checked={animationEnabled} onChange={(event) => onAnimationChange(event.target.checked)} /><span>启用抽取动画</span><small>默认遵循系统的减少动态效果偏好。</small></label><button className="danger-button" onClick={onRequestClear}>清除本地记录</button><div className="dialog-actions"><button className="secondary-button" onClick={onClose}>完成</button></div></section></div>;
}

function ClearDataDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return <div className="dialog-backdrop"><section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-dialog-title" aria-label="清除本地记录？"><p className="dialog-kicker">不可撤销</p><h2 id="clear-dialog-title">清除本地记录？</h2><p>这会删除最近 7 天历史记录和进行中的课间，但会保留动画设置。</p><div className="dialog-actions"><button className="secondary-button" onClick={onCancel}>取消</button><button className="danger-button" onClick={onConfirm}>确认清除</button></div></section></div>;
}

export { App };





