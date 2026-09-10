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
import { createLocalVirtueStore, type LocalVirtueStore } from "./storage/virtueStore";
import { getEffectiveVirtueRecord, type VirtueRecord, type VirtueType } from "./domain/virtue";
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
  virtueStore?: LocalVirtueStore;
};

type View = "home" | "active" | "history" | "snake" | "virtue" | "virtueHistory";

type AppVirtueType = VirtueType;

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function exportFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

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
  store: providedStore,
  random,
  now = () => new Date(),
  createId = () => crypto.randomUUID(),
  revealDelayMs = 900,
  virtueStore: providedVirtueStore,
}: AppProps) {
  const store = useMemo(() => providedStore ?? createLocalBreakStore(window.localStorage, undefined, getDefaultAnimationEnabled()), [providedStore]);
  const virtueStore = useMemo(() => providedVirtueStore ?? createLocalVirtueStore(window.localStorage, now), [providedVirtueStore, now]);
  const [session, setSession] = useState<BreakSession | null>(() => store.getActive());
  const [view, setView] = useState<View>(() => (store.getActive() ? "active" : "home"));
  const [isRevealing, setIsRevealing] = useState(false);
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState(() => store.getHistory());
  const [animationEnabled, setAnimationEnabled] = useState(() => store.getAnimationEnabled());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [virtues, setVirtues] = useState<VirtueRecord[]>(() => virtueStore.getRecords());
  const [virtueForm, setVirtueForm] = useState<{ open: boolean; type: AppVirtueType; record?: VirtueRecord }>({ open: false, type: "good" });
  const [virtueDate, setVirtueDate] = useState(() => dateKey(now()));
  const [virtueMonth, setVirtueMonth] = useState(() => { const d = now(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const [virtueClearOpen, setVirtueClearOpen] = useState(false);

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

  function openSnakeGame() {
    if (!session || session.activityId !== "snake" || session.completed || (session.snakeGamesStarted ?? 0) >= SNAKE_MAX_GAMES) return;
    setView("snake");
  }

  function leaveSnakeGame() {
    setView("active");
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

  function refreshVirtues() {
    setVirtues(virtueStore.getRecords());
  }

  function submitVirtue(type: AppVirtueType, description: string, reflection: string, note: string) {
    const clean = description.trim();
    if (!clean) return;
    const existing = virtueForm.record;
    try {
      if (!existing) {
        virtueStore.add({ id: createId(), type, description: clean, reflection });
      } else if (existing.date === dateKey(now())) {
        virtueStore.updateToday(existing.id, { type, description: clean, reflection });
      } else {
        virtueStore.correctHistorical(existing.id, { type, description: clean, reflection, note });
      }
      refreshVirtues();
      setVirtueForm({ open: false, type: "good" });
      setNotice(existing ? (existing.date === dateKey(now()) ? "今日记录已更新。" : "历史记录已追加修正。") : "已记下一件具体行为。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "记录暂时无法保存。");
    }
  }

  function deleteVirtue(id: string) {
    try {
      virtueStore.deleteToday(id);
      refreshVirtues();
      setNotice("今日记录已删除。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "记录暂时无法删除。");
    }
  }

  function clearVirtues() {
    virtueStore.clear();
    refreshVirtues();
    setVirtueClearOpen(false);
    setNotice("功过格记录已清空，课间记录不受影响。");
  }

  function exportVirtues(kind: "json" | "csv") {
    const content = kind === "json" ? virtueStore.exportJSON() : virtueStore.exportCSV();
    exportFile(`功过格-${dateKey(now())}.${kind}`, content, kind === "json" ? "application/json" : "text/csv;charset=utf-8");
    setNotice(`已导出功过格 ${kind.toUpperCase()}。`);
  }
  function openHistory() {
    setHistory(store.getHistory());
    setView("history");
  }

  function renderHeader() {
    return (
      <header className="topbar">
        <button className="brand" onClick={() => setView("home")} aria-label="回到首页">
          <span className="brand-mark" aria-hidden="true">☼</span>
          <span>课间松一松</span>
        </button>
        <nav className="topbar-actions" aria-label="页面导航">
          <button className={`nav-link ${view === "home" ? "is-current" : ""}`} aria-current={view === "home" ? "page" : undefined} onClick={() => setView("home")}>首页</button>
          {session && <button className={`nav-link ${view === "active" ? "is-current" : ""}`} aria-current={view === "active" ? "page" : undefined} onClick={() => setView("active")}>进行中</button>}
          <button className={`nav-link ${view === "virtue" ? "is-current" : ""}`} aria-current={view === "virtue" ? "page" : undefined} onClick={() => setView("virtue")}>功过格</button>
          <button className={`nav-link ${view === "virtueHistory" ? "is-current" : ""}`} aria-current={view === "virtueHistory" ? "page" : undefined} onClick={() => { setVirtueDate(dateKey(now())); setView("virtueHistory"); }}>功过簿</button>
          <button className={`nav-link history-link ${view === "history" ? "is-current" : ""}`} aria-current={view === "history" ? "page" : undefined} onClick={openHistory}>最近 7 天 <span aria-hidden="true">↗</span></button>
          <button className="settings-link" onClick={() => setSettingsOpen(true)}>设置</button>
        </nav>
      </header>
    );
  }

  if (view === "virtue" || view === "virtueHistory") {
    const isTodayView = view === "virtue";
    const today = dateKey(now());
    const openRecord = (record: VirtueRecord) => setVirtueForm({ open: true, type: getEffectiveVirtueRecord(record).type, record });
    return <div className="app-shell virtue-app-shell">{renderHeader()}<main className="main virtue-main">{isTodayView ? <VirtueHome today={today} records={virtues.filter((r) => r.date === today)} onAdd={(type) => setVirtueForm({ open: true, type })} onEdit={openRecord} onDelete={deleteVirtue} onLedger={() => setView("virtueHistory")} onSettings={() => setSettingsOpen(true)} /> : <VirtueLedger today={today} records={virtues} selectedDate={virtueDate} month={virtueMonth} onDateChange={setVirtueDate} onMonthChange={setVirtueMonth} onBack={() => setView("virtue")} onEdit={openRecord} />}</main>{notice && <div className="toast" role="status">{notice}</div>}{virtueForm.open && <VirtueEntryPanel today={today} initial={virtueForm.record} type={virtueForm.type} onClose={() => setVirtueForm({ open: false, type: "good" })} onSave={submitVirtue} />}{settingsOpen && <VirtueSettings onExport={exportVirtues} onClear={() => { setSettingsOpen(false); setVirtueClearOpen(true); }} onClose={() => setSettingsOpen(false)} />}{virtueClearOpen && <ClearVirtueDialog onCancel={() => setVirtueClearOpen(false)} onConfirm={clearVirtues} />}</div>;
  }

  if (view === "snake" && session?.activityId === "snake") {
    return <SnakeGamePage
      roundsStarted={session.snakeGamesStarted ?? 0}
      random={random}
      onStarted={startSnakeRound}
      onRoundFinished={() => {
        if ((session.snakeGamesStarted ?? 0) >= SNAKE_MAX_GAMES) leaveSnakeGame();
      }}
      onBack={leaveSnakeGame}
    />;
  }

  if (view === "history") {
    return <div className="app-shell">
      {renderHeader()}
      <HistoryView history={history} now={now()} onBack={() => setView(session ? "active" : "home")} />
      {notice && <div className="toast" role="status">{notice}</div>}
      {settingsOpen && <SettingsDialog animationEnabled={animationEnabled} onAnimationChange={updateAnimationEnabled} onRequestClear={() => setClearDialogOpen(true)} onClose={() => setSettingsOpen(false)} />}
      {clearDialogOpen && <ClearDataDialog onCancel={() => setClearDialogOpen(false)} onConfirm={clearLocalData} />}
    </div>;
  }

  return (
    <div className="app-shell">
      {renderHeader()}
      <main className={session && view === "active" ? "main active-main" : "main"}>
        {session && activity && view === "active" ? (
          <ActiveBreak
            key={`${session.id}:${session.activityId}`}
            session={session}
            activity={activity}
            isRevealing={isRevealing}
            onComplete={markComplete}
            onSwap={swapActivity}
            onOpenSnakeGame={openSnakeGame}
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

function ActiveBreak({ session, activity, isRevealing, onComplete, onSwap, onEnd, onOpenSnakeGame }: {
  session: BreakSession;
  activity: ReturnType<typeof getActivityById>;
  isRevealing: boolean;
  onComplete: () => void;
  onSwap: () => void;
  onEnd: () => void;
  onOpenSnakeGame: () => void;
}) {
  const [selectedSubActivityId, setSelectedSubActivityId] = useState<string | null>(null);
  const selectedSubActivity = activity.subActivities?.find((item) => item.id === selectedSubActivityId) ?? null;
  const snakeNeedsRound = activity.id === "snake" && (session.snakeGamesStarted ?? 0) < 1;

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
          {activity.id === "snake" && <SnakeGameEntry roundsStarted={session.snakeGamesStarted ?? 0} disabled={session.completed} onOpen={onOpenSnakeGame} />}
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

function SnakeGamePage({ roundsStarted, random, onStarted, onRoundFinished, onBack }: {
  roundsStarted: number;
  random?: () => number;
  onStarted: () => void;
  onRoundFinished: () => void;
  onBack: () => void;
}) {
  return <main className="snake-game-page">
    <div className="snake-game-header">
      <button className="back-link" aria-label="返回活动" onClick={onBack}>← 返回活动</button>
      <div className="snake-game-heading">
        <p className="kicker"><span className="kicker-dot" /> 独立游戏页面</p>
        <h1>贪吃蛇</h1>
        <p>点击“开始游戏”后才会开始计局。每次课间最多 3 局。</p>
      </div>
    </div>
    <div className="snake-game-shell">
      <SnakeGame roundsStarted={roundsStarted} random={random} onStarted={onStarted} onRoundFinished={onRoundFinished} />
    </div>
  </main>;
}

function SnakeGameEntry({ roundsStarted, disabled, onOpen }: { roundsStarted: number; disabled: boolean; onOpen: () => void }) {
  if (roundsStarted >= SNAKE_MAX_GAMES) {
    return <div className="snake-entry snake-entry-complete" aria-live="polite">
      <strong>贪吃蛇已完成 {SNAKE_MAX_GAMES}/{SNAKE_MAX_GAMES} 局</strong>
      <p>本次课间不能继续游戏，可以确认活动完成。</p>
    </div>;
  }

  return <div className="snake-entry">
    <div><strong>贪吃蛇局数 {roundsStarted}/{SNAKE_MAX_GAMES}</strong><p>进入独立游戏页面后，点击“开始游戏”才会计为一局。</p></div>
    <button className="primary-button" onClick={onOpen} disabled={disabled}>进入游戏</button>
  </div>;
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
    if (game?.status !== "game-over" && game?.status !== "ended") return;
    if (roundsStarted >= SNAKE_MAX_GAMES) onRoundFinished();
  }, [game?.status, onRoundFinished, roundsStarted]);
  function changeDirection(direction: SnakeDirection) { setGame((current) => current ? setSnakeDirection(current, direction) : current); }
  function start() { if (roundsStarted >= SNAKE_MAX_GAMES) return; onStarted(); setGame(startSnakeGame(createSnakeGame(random))); }
  function handleKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const directions: Record<string, SnakeDirection> = { ArrowUp: "up", w: "up", ArrowDown: "down", s: "down", ArrowLeft: "left", a: "left", ArrowRight: "right", d: "right" };
    const direction = directions[event.key] ?? directions[event.key.toLowerCase()];
    if (direction) { event.preventDefault(); changeDirection(direction); }
    if (event.key === " ") setGame((current) => current ? toggleSnakePause(current) : current);
  }
  const pointKey = (x: number, y: number) => `${x}-${y}`;
  if (!game || game.status === "idle") return <div className="snake-panel"><div><strong>贪吃蛇局数 {roundsStarted}/{SNAKE_MAX_GAMES}</strong><p>方向键/WASD 或手机滑动 · 边界可穿越</p></div><button className="primary-button" onClick={start} disabled={roundsStarted >= SNAKE_MAX_GAMES}>开始游戏</button></div>;
  return <div className="snake-panel" tabIndex={0} autoFocus onKeyDown={handleKey} onTouchStart={(event) => setTouchStart({ x: event.touches[0].clientX, y: event.touches[0].clientY })} onTouchEnd={(event) => { if (!touchStart) return; const dx = event.changedTouches[0].clientX - touchStart.x; const dy = event.changedTouches[0].clientY - touchStart.y; setTouchStart(null); if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return; changeDirection(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up")); }}>
    <div className="snake-toolbar"><strong>得分 {game.score}</strong><span>地图 {game.map.id} · {game.status === "paused" ? "已暂停" : game.status === "game-over" ? "本局结束" : game.status === "ended" ? "已结束" : "进行中"}</span></div>
    <p className="snake-input-hint">方向键 / WASD 控制 · 手机滑动控制</p>
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
  return <div className="dialog-backdrop"><section className="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" aria-label="本地数据设置"><p className="dialog-kicker">设置</p><h2 id="settings-title">本地数据设置</h2><p>记录只保存在当前浏览器，不会自动同步到其他设备；清除浏览器数据也可能让记录丢失。</p><label className="setting-toggle"><input aria-label="启用抽取动画" type="checkbox" checked={animationEnabled} onChange={(event) => onAnimationChange(event.target.checked)} /><span>启用抽取动画</span><small>默认遵循系统的减少动态效果偏好。</small></label><details className="rules-details"><summary>规则说明</summary><ul><li>每次课间只抽取一次，最多使用一次“换一个”。</li><li>完成活动后仍需点击“结束课间”保存记录；未完成也会保留。</li><li>贪吃蛇每次课间最多开始三局，方向键/WASD 和手机滑动都可操作。</li></ul></details><button className="danger-button" onClick={onRequestClear}>清除本地记录</button><div className="dialog-actions"><button className="secondary-button" onClick={onClose}>完成</button></div></section></div>;
}

function ClearDataDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return <div className="dialog-backdrop"><section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-dialog-title" aria-label="清除本地记录？"><p className="dialog-kicker">不可撤销</p><h2 id="clear-dialog-title">清除本地记录？</h2><p>这会删除最近 7 天历史记录和进行中的课间，但会保留动画设置。</p><div className="dialog-actions"><button className="secondary-button" onClick={onCancel}>取消</button><button className="danger-button" onClick={onConfirm}>确认清除</button></div></section></div>;
}


function formatVirtueScore(score: number) {
  return score > 0 ? `+${score}` : String(score);
}

function VirtueHome({ records, today, onAdd, onEdit, onDelete, onLedger, onSettings }: {
  records: VirtueRecord[];
  today: string;
  onAdd: (type: AppVirtueType) => void;
  onEdit: (record: VirtueRecord) => void;
  onDelete: (id: string) => void;
  onLedger: () => void;
  onSettings: () => void;
}) {
  const effectiveRecords = records.map(getEffectiveVirtueRecord);
  const goodCount = effectiveRecords.filter((record) => record.type === "good").length;
  const faultCount = effectiveRecords.filter((record) => record.type === "fault").length;
  const netScore = goodCount - faultCount * 2;
  return <section className="virtue-home">
    <div className="virtue-heading"><div><p className="kicker"><span className="kicker-dot" /> 今日 · {today}</p><h1>功过格，<em>记下这一日。</em></h1><p className="virtue-intro">把具体发生的事留下来，不作评判，只为看见今天。</p></div><button className="settings-link virtue-settings" onClick={onSettings}>设置</button></div>
    <div className="virtue-scoreboard"><div><span>善行</span><strong className="good-number">{goodCount}</strong><small>件 · 每件 +1</small></div><div><span>过失</span><strong className="mistake-number">{faultCount}</strong><small>件 · 每件 −2</small></div><div className="net-score"><span>今日净分</span><strong>{formatVirtueScore(netScore)}</strong><small>只是记录，不是评价</small></div></div>
    <div className="virtue-actions"><button className="virtue-action good-action" onClick={() => onAdd("good")}><span>＋</span><b>记善行</b><small>记录一件具体发生的事</small></button><button className="virtue-action mistake-action" onClick={() => onAdd("fault")}><span>−</span><b>记过失</b><small>写下反思或修复行动</small></button></div>
    <div className="virtue-list-header"><h2>今日记录</h2><button className="text-button" onClick={onLedger}>查看功过簿 →</button></div>
    {effectiveRecords.length === 0 ? <div className="virtue-empty"><span>一张还未落笔的纸</span><p>从一件具体的小事开始，给今天留下一笔。</p></div> : <ul className="virtue-record-list">{effectiveRecords.map((record) => <li key={record.id} className={`virtue-record ${record.type === "fault" ? "mistake" : "good"}`}><span className="virtue-record-mark">{record.type === "good" ? "善" : "过"}</span><div><strong>{record.description}</strong>{record.reflection && <p>{record.reflection}</p>}<small>{record.type === "good" ? "+1 善行" : "−2 过失"}{record.corrections.length ? ` · 已修正 ${record.corrections.length} 次` : ""}</small></div><div className="record-actions"><button onClick={() => onEdit(record)}>编辑</button><button onClick={() => onDelete(record.id)}>删除</button></div></li>)}</ul>}
  </section>;
}

function VirtueEntryPanel({ initial, type, today, onClose, onSave }: { initial?: VirtueRecord; type: AppVirtueType; today: string; onClose: () => void; onSave: (type: AppVirtueType, description: string, reflection: string, note: string) => void }) {
  const effective = initial ? getEffectiveVirtueRecord(initial) : undefined;
  const [kind, setKind] = useState<AppVirtueType>(effective?.type ?? type);
  const [description, setDescription] = useState(effective?.description ?? "");
  const [reflection, setReflection] = useState(effective?.reflection ?? "");
  const [note, setNote] = useState("");
  const historical = Boolean(initial && initial.date !== today);
  return <div className="dialog-backdrop"><section className="dialog virtue-entry-panel" role="dialog" aria-modal="true" aria-labelledby="virtue-entry-title"><p className="dialog-kicker">{initial ? (historical ? "追加历史修正" : "编辑今日记录") : "记下一件事"}</p><h2 id="virtue-entry-title">{kind === "good" ? "记善行" : "记过失"}</h2><div className="type-tabs"><button type="button" aria-pressed={kind === "good"} className={kind === "good" ? "selected" : ""} onClick={() => setKind("good")}>善行 ＋1</button><button type="button" aria-pressed={kind === "fault"} className={kind === "fault" ? "selected mistake-tab" : ""} onClick={() => setKind("fault")}>过失 −2</button></div><label>具体发生了什么？<textarea autoFocus value={description} onChange={(e) => setDescription(e.target.value)} placeholder="写一件具体的事，不必写得完美。" rows={4} /></label><label>反思或修复行动 <span>可选</span><textarea value={reflection} onChange={(e) => setReflection(e.target.value)} placeholder="下一步想怎么做？" rows={3} /></label>{historical && <label>本次修正说明 <span>可选</span><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="说明为什么需要修正，便于日后回看。" rows={2} /></label>}<div className="dialog-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!description.trim()} onClick={() => onSave(kind, description, reflection, note)}>{historical ? "追加修正" : "保存记录"}</button></div></section></div>;
}

function VirtueLedger({ records, selectedDate, month, today, onDateChange, onMonthChange, onBack, onEdit }: { records: VirtueRecord[]; selectedDate: string; month: string; today: string; onDateChange: (date: string) => void; onMonthChange: (month: string) => void; onBack: () => void; onEdit: (record: VirtueRecord) => void }) {
  const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const first = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).getDay();
  const dayRecords = records.filter((record) => record.date === selectedDate);
  const effectiveRecords = dayRecords.map(getEffectiveVirtueRecord);
  const goodCount = effectiveRecords.filter((record) => record.type === "good").length;
  const faultCount = effectiveRecords.filter((record) => record.type === "fault").length;
  const netScore = goodCount - faultCount * 2;
  return <section className="virtue-ledger"><button className="back-link" onClick={onBack}>← 回到功过格</button><div className="virtue-ledger-heading"><div><p className="kicker"><span className="kicker-dot" /> 按月份回看</p><h1>功过簿</h1><p>选一天，看看那一天留下了什么。</p></div><div className="month-switch"><button aria-label="上个月" onClick={() => { const d = new Date(`${month}-01`); d.setMonth(d.getMonth() - 1); onMonthChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); }}>←</button><strong>{month.replace("-", " · ")}</strong><button aria-label="下个月" disabled={month >= today.slice(0, 7)} onClick={() => { const d = new Date(`${month}-01`); d.setMonth(d.getMonth() + 1); onMonthChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); }}>→</button></div></div><div className="calendar" aria-label={`${month} 日历`}><div className="weekday-row">{["日", "一", "二", "三", "四", "五", "六"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{Array.from({ length: first }).map((_, index) => <span key={`blank-${index}`} />)}{Array.from({ length: days }, (_, index) => { const date = `${month}-${String(index + 1).padStart(2, "0")}`; const marked = records.filter((record) => record.date === date).map(getEffectiveVirtueRecord); const hasGood = marked.some((record) => record.type === "good"); const hasFault = marked.some((record) => record.type === "fault"); const label = hasGood && hasFault ? "有善行和过失" : hasGood ? "有善行" : hasFault ? "有过失" : "无记录"; const future = date > today; return <button type="button" key={date} disabled={future} aria-label={`${date}，${future ? "未来日期不可选" : label}`} className={`${selectedDate === date ? "selected" : ""} ${hasGood ? "has-good" : ""} ${hasFault ? "has-mistake" : ""}`} onClick={() => onDateChange(date)}>{index + 1}<i /></button>; })}</div></div><div className="ledger-detail"><p className="kicker">{selectedDate}</p><div className="ledger-stats"><span>善行 <b>{goodCount}</b></span><span>过失 <b>{faultCount}</b></span><span>净分 <b>{formatVirtueScore(netScore)}</b></span></div>{effectiveRecords.length ? <ul className="virtue-record-list">{effectiveRecords.map((record) => <li key={record.id} className={`virtue-record ${record.type === "fault" ? "mistake" : "good"}`}><span className="virtue-record-mark">{record.type === "good" ? "善" : "过"}</span><div><strong>{record.description}</strong>{record.reflection && <p>{record.reflection}</p>}<small>{record.type === "good" ? "+1 善行" : "−2 过失"} · {record.date === today ? "今日可编辑" : "历史记录可追加修正"}</small>{record.corrections.length > 0 && <details className="correction-details"><summary>查看修正记录（{record.corrections.length}）</summary>{record.corrections.map((correction) => <div key={correction.id} className="correction-entry"><strong>{correction.correctedOn} · {correction.note || "已更新记录内容"}</strong><span>修正前：{correction.before.type === "good" ? "善行" : "过失"} · {correction.before.description}</span><span>修正后：{correction.after.type === "good" ? "善行" : "过失"} · {correction.after.description}</span>{correction.before.reflection && <span>原反思：{correction.before.reflection}</span>}{correction.after.reflection && <span>新反思：{correction.after.reflection}</span>}</div>)}</details>}</div>{record.date === today ? <button className="record-edit-only" onClick={() => onEdit(record)}>编辑</button> : <button className="record-edit-only" onClick={() => onEdit(record)}>追加修正</button>}</li>)}</ul> : <div className="virtue-empty compact"><span>这一天还没有记录</span><p>可以回到今天，从一件具体的小事开始。</p></div>}</div></section>;
}

function VirtueSettings({ onExport, onClear, onClose }: { onExport: (kind: "json" | "csv") => void; onClear: () => void; onClose: () => void }) { return <div className="drawer-backdrop"><aside className="settings-drawer" role="dialog" aria-modal="true" aria-labelledby="virtue-settings-title"><button className="drawer-close" onClick={onClose} aria-label="关闭设置">×</button><p className="dialog-kicker">功过格设置</p><h2 id="virtue-settings-title">把记录留在手边</h2><p>数据只保存在当前浏览器。清除浏览器数据可能导致记录丢失，也不会自动同步到其他设备。</p><details open><summary>记录规则</summary><p>每件善行记 +1，每件过失记 −2；分值是本产品固定规则，不代表对人的评价，也不能修改。</p></details><details><summary>史料说明</summary><p>古籍启发：页面受到《了凡四训》中逐日登记、善加过减思想的启发。</p><p>后世流传：复杂功过条目和等级表属于后世流传，本第一版不把它们作为输入或评分标准。</p><p>现代产品规则：每件善行 +1、每件过失 −2 是本产品自定义规则，不承诺任何现实结果。</p></details><div className="drawer-actions"><button onClick={() => onExport("json")}>导出 JSON</button><button onClick={() => onExport("csv")}>导出 CSV</button><button className="danger-button" onClick={onClear}>清空功过格记录</button></div></aside></div>; }
function ClearVirtueDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) { return <div className="dialog-backdrop"><section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-virtue-title"><p className="dialog-kicker">不可撤销</p><h2 id="clear-virtue-title">清空功过格记录？</h2><p>只会删除功过格自己的记录，不影响课间数据和课间动画设置。</p><div className="dialog-actions"><button className="secondary-button" onClick={onCancel}>取消</button><button className="danger-button" onClick={onConfirm}>确认清空</button></div></section></div>; }

export { App };
