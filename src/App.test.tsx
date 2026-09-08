import { afterEach, describe, expect, it } from "vitest";
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
});






