import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createLocalBreakStore } from "./storage/localBreakStore";

function createTestApp() {
  localStorage.clear();
  return {
    store: createLocalBreakStore(localStorage, () => new Date("2026-09-08T12:00:00.000Z")),
    now: () => new Date("2026-09-08T12:00:00.000Z"),
    createId: () => "break-test-1",
    revealDelayMs: 0,
  };
}

describe("课间核心界面", () => {
  afterEach(() => cleanup());
  it("lets the user start one break and shows the drawn guidance", async () => {
    const user = userEvent.setup();
    render(<App {...createTestApp()} random={() => 0} />);

    expect(screen.getByRole("button", { name: "开始本次课间" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "开始本次课间" }));

    expect(await screen.findByRole("heading", { name: "出去喝水" })).toBeInTheDocument();
    expect(screen.getByText("去接一杯水，离开屏幕，慢慢喝完再回来。")).toBeInTheDocument();
    expect(screen.getByText("约 2 分钟")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "活动完成" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "结束课间" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "开始本次课间" })).not.toBeInTheDocument();
  });

  it("lets the user replace the result once and locks the final result", async () => {
    const user = userEvent.setup();
    const app = createTestApp();
    const randomValues = [0, 0.99];
    render(<App {...app} random={() => randomValues.shift() ?? 0} />);
    await user.click(screen.getByRole("button", { name: "开始本次课间" }));
    await screen.findByRole("heading", { name: "出去喝水" });

    expect(screen.getByRole("button", { name: "换一个" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "换一个" }));

    expect(await screen.findByRole("heading", { name: "打球" })).toBeInTheDocument();
    expect(screen.getByText("已替换：出去喝水")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "换一个" })).toBeDisabled();
    expect(app.store.getActive()).toMatchObject({ activityId: "ball", replacedActivityId: "water" });

    await user.click(screen.getByRole("button", { name: "活动完成" }));
    expect(screen.getByRole("button", { name: "换一个" })).toBeDisabled();
    expect(screen.getByText("已替换：出去喝水")).toBeInTheDocument();
  });

  it("keeps completion separate from ending and records an incomplete break", async () => {
    const user = userEvent.setup();
    const app = createTestApp();
    render(<App {...app} random={() => 0} />);
    await user.click(screen.getByRole("button", { name: "开始本次课间" }));
    await screen.findByRole("heading", { name: "出去喝水" });

    await user.click(screen.getByRole("button", { name: "活动完成" }));
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "结束课间" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "结束课间" }));
    expect(screen.getByRole("dialog", { name: "结束这次课间？" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认结束" }));
    expect(await screen.findByText("这次课间已记录为已完成。")).toBeInTheDocument();
    expect(app.store.getActive()).toBeNull();
    expect(app.store.getHistory()).toHaveLength(1);
    expect(app.store.getHistory()[0].completed).toBe(true);
  });

  it("restores an active break from local storage after reopening", async () => {
    const app = createTestApp();
    const user = userEvent.setup();
    const { unmount } = render(<App {...app} random={() => 18.5 / 99} />);
    await user.click(screen.getByRole("button", { name: "开始本次课间" }));
    await screen.findByRole("heading", { name: "散步" });
    unmount();

    render(<App {...app} random={() => 0} />);
    expect(await screen.findByRole("heading", { name: "散步" })).toBeInTheDocument();
    expect(screen.getByText("走一圈，或走到一个指定地点再回来，不用赶路。")).toBeInTheDocument();
  });

  it("does not allow a second active break to replace the first one", async () => {
    const app = createTestApp();
    const user = userEvent.setup();
    render(<App {...app} random={() => 0} />);
    await user.click(screen.getByRole("button", { name: "开始本次课间" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "出去喝水" })).toBeInTheDocument());

    expect(app.store.getHistory()).toEqual([]);
    expect(app.store.getActive()?.id).toBe("break-test-1");
  });

  it("lets the user choose and reselect a戒色练习子活动 without a new draw", async () => {
    const user = userEvent.setup();
    const random = vi.fn(() => 0.5);
    const app = createTestApp();
    render(<App {...app} random={random} />);

    await user.click(screen.getByRole("button", { name: "开始本次课间" }));
    await screen.findByRole("heading", { name: "戒色练习" });
    expect(screen.getByRole("heading", { name: "选择一项练习" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "内置提示文字" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "阅读自备文章" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "听或观看自选内容" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "俯卧撑" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "固肾功" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "自我反思或呼吸练习" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "内置提示文字" }));
    expect(screen.getByRole("heading", { name: "内置提示文字" })).toBeInTheDocument();
    expect(screen.getByText(/不展示色情内容/)).toBeInTheDocument();
    expect(random).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "重新选择子活动" }));
    expect(screen.getByRole("heading", { name: "选择一项练习" })).toBeInTheDocument();
    expect(random).toHaveBeenCalledTimes(1);
  });

  it("integrates snake rounds with the break count and completion gate", async () => {
    const user = userEvent.setup();
    const app = createTestApp();
    render(<App {...app} random={() => 0.8} />);

    await user.click(screen.getByRole("button", { name: "开始本次课间" }));
    expect(await screen.findByRole("heading", { name: "玩贪吃蛇" })).toBeInTheDocument();
    expect(screen.getByText("贪吃蛇局数 0/3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "活动完成" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "开始游戏" }));
    expect(app.store.getActive()?.snakeGamesStarted).toBe(1);
    expect(screen.getByText("得分 0")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "结束本局" }));
    expect(screen.getByRole("button", { name: "活动完成" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "开始下一局" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "开始下一局" }));
    expect(app.store.getActive()?.snakeGamesStarted).toBe(2);
  });

});







