import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createLocalBreakStore } from "./storage/localBreakStore";
import { createLocalVirtueStore } from "./storage/virtueStore";

const now = () => new Date("2026-09-10T12:00:00.000Z");
const modulePreferenceKey = "relaxation-module-preference";

function createNavigationTestApp() {
  return {
    store: createLocalBreakStore(localStorage, now),
    virtueStore: createLocalVirtueStore(localStorage, now),
    now,
    createId: () => "navigation-test-record",
    random: () => 0,
    revealDelayMs: 0,
  };
}

function renderNavigationTestApp(overrides: Partial<ReturnType<typeof createNavigationTestApp>> = {}) {
  const app = { ...createNavigationTestApp(), ...overrides };
  return { app, ...render(<App {...app} />) };
}

function primaryModuleNavigation() {
  return screen.getByRole("navigation", { name: "一级模块" });
}

function breakModuleButton() {
  return within(primaryModuleNavigation()).getByRole("button", { name: /^课间松一松$/ });
}

function virtueModuleButton() {
  return within(primaryModuleNavigation()).getByRole("button", { name: /^功过格$/ });
}

async function openVirtueLedger(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /查看功过簿/ }));
  expect(screen.getByRole("heading", { name: "功过簿" })).toBeInTheDocument();
}

function seedHistoricalVirtueRecord() {
  localStorage.setItem("virtue-grid.v1", JSON.stringify({
    records: [{
      id: "historical-record",
      date: "2026-09-09",
      type: "good",
      description: "昨天帮助整理资料",
      reflection: null,
      corrections: [],
    }],
  }));
}

describe("双模块导航", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("renders only two primary modules and exposes the parent module with aria-current", async () => {
    const user = userEvent.setup();
    renderNavigationTestApp();

    const navigation = primaryModuleNavigation();
    expect(within(navigation).getAllByRole("button")).toHaveLength(2);
    expect(breakModuleButton()).toHaveAttribute("aria-current", "page");
    expect(virtueModuleButton()).not.toHaveAttribute("aria-current");
    expect(within(navigation).queryByRole("button", { name: "首页" })).not.toBeInTheDocument();
    expect(within(navigation).queryByRole("button", { name: "进行中" })).not.toBeInTheDocument();
    expect(within(navigation).queryByRole("button", { name: /最近 7 天/ })).not.toBeInTheDocument();
    expect(within(navigation).queryByRole("button", { name: "功过簿" })).not.toBeInTheDocument();
    expect(within(navigation).queryByRole("button", { name: "设置" })).not.toBeInTheDocument();

    await user.click(virtueModuleButton());

    expect(screen.getByRole("heading", { name: /功过格，/ })).toBeInTheDocument();
    expect(virtueModuleButton()).toHaveAttribute("aria-current", "page");
    expect(breakModuleButton()).not.toHaveAttribute("aria-current");
  });

  it("keeps the parent module selected on a secondary page and exposes its module-local return action", async () => {
    const user = userEvent.setup();
    renderNavigationTestApp();

    await user.click(virtueModuleButton());
    await openVirtueLedger(user);

    expect(virtueModuleButton()).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /返回功过格/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^设置$/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /返回功过格/ }));
    expect(screen.getByRole("heading", { name: /功过格，/ })).toBeInTheDocument();
  });

  it("restores the selected primary module on remount but resets secondary pages", async () => {
    const user = userEvent.setup();
    const first = renderNavigationTestApp();

    await user.click(virtueModuleButton());
    await openVirtueLedger(user);
    expect(virtueModuleButton()).toHaveAttribute("aria-current", "page");

    first.unmount();
    renderNavigationTestApp();

    expect(screen.getByRole("heading", { name: /功过格，/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "功过簿" })).not.toBeInTheDocument();
    expect(virtueModuleButton()).toHaveAttribute("aria-current", "page");
  });

  it("defaults to 课间松一松 when the persisted module preference is absent or invalid", () => {
    renderNavigationTestApp();
    expect(screen.getByRole("button", { name: "开始本次课间" })).toBeInTheDocument();
    expect(breakModuleButton()).toHaveAttribute("aria-current", "page");

    cleanup();
    localStorage.setItem(modulePreferenceKey, "not-a-module");
    renderNavigationTestApp();

    expect(screen.getByRole("button", { name: "开始本次课间" })).toBeInTheDocument();
    expect(breakModuleButton()).toHaveAttribute("aria-current", "page");
  });

  it("keeps an active break intact while 功过格 exposes its accessible in-progress description", async () => {
    const user = userEvent.setup();
    renderNavigationTestApp();

    await user.click(screen.getByRole("button", { name: "开始本次课间" }));
    expect(await screen.findByRole("heading", { name: "出去喝水" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^设置$/ })).not.toBeInTheDocument();

    await user.click(virtueModuleButton());

    expect(screen.getByRole("heading", { name: /功过格，/ })).toBeInTheDocument();
    expect(breakModuleButton()).toHaveAccessibleName("课间松一松");
    expect(breakModuleButton()).toHaveAccessibleDescription("有进行中的课间");
    expect(virtueModuleButton()).toHaveAttribute("aria-current", "page");

    await user.click(breakModuleButton());

    expect(screen.getByRole("heading", { name: "出去喝水" })).toBeInTheDocument();
    expect(breakModuleButton()).toHaveAttribute("aria-current", "page");
  });

  it("keeps settings within the current module and closes a settings panel before switching modules", async () => {
    const user = userEvent.setup();
    renderNavigationTestApp();

    await user.click(screen.getByRole("button", { name: "开始本次课间" }));
    await screen.findByRole("heading", { name: "出去喝水" });
    await user.click(virtueModuleButton());
    await user.click(screen.getByRole("button", { name: /^设置$/ }));

    expect(screen.getByRole("dialog", { name: "把记录留在手边" })).toBeInTheDocument();
    await user.click(breakModuleButton());

    expect(screen.queryByRole("dialog", { name: "把记录留在手边" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "出去喝水" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^设置$/ })).not.toBeInTheDocument();

    await user.click(virtueModuleButton());
    expect(screen.getByRole("button", { name: /^设置$/ })).toBeInTheDocument();
  });

  it("does not prompt when a newly opened form is blank", async () => {
    const user = userEvent.setup();
    renderNavigationTestApp();

    await user.click(virtueModuleButton());
    await user.click(screen.getByRole("button", { name: /记善行/ }));
    await user.click(breakModuleButton());

    expect(screen.queryByRole("alertdialog", { name: "放弃未保存的输入？" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始本次课间" })).toBeInTheDocument();
  });

  it("confirms before abandoning a dirty new record and restores the last focused field after cancellation", async () => {
    const user = userEvent.setup();
    renderNavigationTestApp();

    await user.click(virtueModuleButton());
    await user.click(screen.getByRole("button", { name: /记善行/ }));
    const description = screen.getByLabelText("具体发生了什么？");
    await user.type(description, "主动整理共享资料");

    await user.click(breakModuleButton());

    const dialog = screen.getByRole("alertdialog", { name: "放弃未保存的输入？" });
    expect(within(dialog).getByRole("button", { name: "继续编辑" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "放弃并离开" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "继续编辑" }));

    expect(screen.getByLabelText("具体发生了什么？")).toHaveValue("主动整理共享资料");
    expect(screen.getByLabelText("具体发生了什么？")).toHaveFocus();

    await user.click(breakModuleButton());
    await user.click(screen.getByRole("button", { name: "放弃并离开" }));

    expect(screen.getByRole("button", { name: "开始本次课间" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "记善行" })).not.toBeInTheDocument();
  });

  it("treats changed type and reflection as dirty input", async () => {
    const user = userEvent.setup();
    renderNavigationTestApp();

    await user.click(virtueModuleButton());
    await user.click(screen.getByRole("button", { name: /记善行/ }));
    const form = screen.getByRole("dialog", { name: "记善行" });
    await user.click(within(form).getByRole("button", { name: /过失/ }));
    await user.click(breakModuleButton());
    expect(screen.getByRole("alertdialog", { name: "放弃未保存的输入？" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    await user.click(within(screen.getByRole("dialog", { name: "记过失" })).getByRole("button", { name: /善行/ }));
    await user.type(screen.getByLabelText("反思或修复行动 可选"), "下次先核对再提交");
    await user.click(breakModuleButton());
    expect(screen.getByRole("alertdialog", { name: "放弃未保存的输入？" })).toBeInTheDocument();
  });

  it("treats a historical correction note as dirty input", async () => {
    const user = userEvent.setup();
    seedHistoricalVirtueRecord();
    renderNavigationTestApp();

    await user.click(virtueModuleButton());
    await openVirtueLedger(user);
    await user.click(screen.getByRole("button", { name: /2026-09-09，有善行/ }));
    await user.click(screen.getByRole("button", { name: "追加修正" }));
    await user.type(screen.getByLabelText("本次修正说明 可选"), "补充核对后的情况");
    await user.click(breakModuleButton());

    expect(screen.getByRole("alertdialog", { name: "放弃未保存的输入？" })).toBeInTheDocument();
  });

  it("does not treat untouched or reverted initial edit values as dirty, but protects a changed edit", async () => {
    const user = userEvent.setup();
    const app = createNavigationTestApp();
    app.virtueStore.add({
      id: "existing-record",
      type: "good",
      description: "已经完成的善行",
      reflection: "继续保持",
    });
    render(<App {...app} />);

    await user.click(virtueModuleButton());
    await openVirtueLedger(user);
    await user.click(screen.getByRole("button", { name: "编辑" }));

    const description = screen.getByLabelText("具体发生了什么？");
    expect(description).toHaveValue("已经完成的善行");
    expect(screen.getByLabelText("反思或修复行动 可选")).toHaveValue("继续保持");

    await user.click(breakModuleButton());
    expect(screen.queryByRole("alertdialog", { name: "放弃未保存的输入？" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始本次课间" })).toBeInTheDocument();

    await user.click(virtueModuleButton());
    await openVirtueLedger(user);
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const revertedDescription = screen.getByLabelText("具体发生了什么？");
    await user.clear(revertedDescription);
    await user.type(revertedDescription, "暂时修改");
    await user.clear(revertedDescription);
    await user.type(revertedDescription, "已经完成的善行");
    await user.click(breakModuleButton());

    expect(screen.queryByRole("alertdialog", { name: "放弃未保存的输入？" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始本次课间" })).toBeInTheDocument();

    await user.click(virtueModuleButton());
    await openVirtueLedger(user);
    await user.click(screen.getByRole("button", { name: "编辑" }));
    await user.clear(screen.getByLabelText("具体发生了什么？"));
    await user.type(screen.getByLabelText("具体发生了什么？"), "修订后的善行");
    await user.click(breakModuleButton());

    expect(screen.getByRole("alertdialog", { name: "放弃未保存的输入？" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByLabelText("具体发生了什么？")).toHaveValue("修订后的善行");
    expect(screen.getByLabelText("具体发生了什么？")).toHaveFocus();
  });

  it("retains the current preference through each module's data clear and does not save a cancelled target", async () => {
    const user = userEvent.setup();
    const breakApp = renderNavigationTestApp();
    await user.click(screen.getByRole("button", { name: /^设置$/ }));
    await user.click(screen.getByRole("button", { name: "清除本地记录" }));
    await user.click(screen.getByRole("button", { name: "确认清除" }));
    breakApp.unmount();

    renderNavigationTestApp();
    expect(breakModuleButton()).toHaveAttribute("aria-current", "page");

    await user.click(virtueModuleButton());
    await user.click(screen.getByRole("button", { name: /^设置$/ }));
    await user.click(screen.getByRole("button", { name: "清空功过格记录" }));
    await user.click(screen.getByRole("button", { name: "确认清空" }));
    cleanup();

    renderNavigationTestApp();
    expect(virtueModuleButton()).toHaveAttribute("aria-current", "page");

    await user.click(screen.getByRole("button", { name: /记善行/ }));
    await user.type(screen.getByLabelText("具体发生了什么？"), "不应切换偏好");
    await user.click(breakModuleButton());
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    cleanup();
    renderNavigationTestApp();

    expect(screen.getByRole("heading", { name: /功过格，/ })).toBeInTheDocument();
    expect(virtueModuleButton()).toHaveAttribute("aria-current", "page");
  });

  it("preserves completed status after switching through 功过格", async () => {
    const user = userEvent.setup();
    renderNavigationTestApp();

    await user.click(screen.getByRole("button", { name: "开始本次课间" }));
    await screen.findByRole("heading", { name: "出去喝水" });
    await user.click(screen.getByRole("button", { name: "活动完成" }));
    expect(screen.getByRole("button", { name: "已完成" })).toBeDisabled();

    await user.click(virtueModuleButton());
    await user.click(breakModuleButton());

    expect(screen.getByRole("heading", { name: "出去喝水" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已完成" })).toBeDisabled();
  });

  it("preserves an abstinence subactivity choice after switching through 功过格", async () => {
    const user = userEvent.setup();
    renderNavigationTestApp({ random: () => 0.5 });

    await user.click(screen.getByRole("button", { name: "开始本次课间" }));
    await screen.findByRole("heading", { name: "戒色练习" });
    await user.click(screen.getByRole("button", { name: "内置提示文字" }));
    expect(screen.getByRole("heading", { name: "内置提示文字" })).toBeInTheDocument();

    await user.click(virtueModuleButton());
    await user.click(breakModuleButton());

    expect(screen.getByRole("heading", { name: "内置提示文字" })).toBeInTheDocument();
    expect(screen.getByText(/不展示色情内容/)).toBeInTheDocument();
  });
  it("preserves a replacement and a started snake round when returning through 功过格", async () => {
    const user = userEvent.setup();
    const randomValues = [0, 0.8];
    renderNavigationTestApp({ random: () => randomValues.shift() ?? 0.8 });

    await user.click(screen.getByRole("button", { name: "开始本次课间" }));
    expect(await screen.findByRole("heading", { name: "出去喝水" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "换一个" }));
    expect(screen.getByRole("heading", { name: "玩贪吃蛇" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "进入游戏" }));
    await user.click(screen.getByRole("button", { name: "开始游戏" }));
    await user.click(screen.getByRole("button", { name: "返回活动" }));

    await user.click(virtueModuleButton());
    await user.click(breakModuleButton());

    expect(screen.getByRole("heading", { name: "玩贪吃蛇" })).toBeInTheDocument();
    expect(screen.getByText(/贪吃蛇.*1\/3/)).toBeInTheDocument();
  });
});
