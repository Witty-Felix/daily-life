import { expect, test, type Page } from "@playwright/test";

const STORAGE_KEY = "class-break-draw.v1";

type SeedOptions = {
  randomValues: number[];
  animationEnabled?: boolean;
};

async function openFresh(page: Page, { randomValues, animationEnabled = false }: SeedOptions) {
  await page.addInitScript(({ values, animation }: { values: number[]; animation: boolean }) => {
    if (localStorage.getItem("__browser_acceptance_seeded") !== "1") {
      localStorage.clear();
      localStorage.setItem("class-break-draw.v1", JSON.stringify({ active: null, history: [], animationEnabled: animation }));
      localStorage.setItem("__browser_acceptance_seeded", "1");
    }
    let index = 0;
    Math.random = () => values[Math.min(index++, values.length - 1)];
  }, { values: randomValues, animation: animationEnabled });
  await page.goto("/");
}

async function finishBreak(page: Page, completed = false) {
  if (completed) await page.getByRole("button", { name: "活动完成" }).click();
  await page.getByRole("button", { name: "结束课间" }).click();
  await page.getByRole("button", { name: "确认结束" }).click();
}

test("开始课间会按预设权重落到对应的放松方式", async ({ page }) => {
  const cases = [
    [0, "出去喝水"],
    [0.1819, "散步"],
    [0.3637, "戒色练习"],
    [0.5152, "看书"],
    [0.6667, "唱歌"],
    [0.7778, "玩贪吃蛇"],
    [0.8889, "打球"],
  ] as const;

  for (const [value, name] of cases) {
    await openFresh(page, { randomValues: [value] });
    await page.getByRole("button", { name: "开始本次课间" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await page.evaluate(() => localStorage.clear());
  }
});

test("真实浏览器流程只保留一个进行中课间，并在刷新后恢复", async ({ page }) => {
  await openFresh(page, { randomValues: [0] });

  await page.getByRole("button", { name: "开始本次课间" }).click();
  await expect(page.getByRole("heading", { name: "出去喝水" })).toBeVisible();
  const firstId = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).active.id, STORAGE_KEY);

  await page.reload();
  await expect(page.getByText("本次课间进行中")).toBeVisible();
  await expect(page.getByRole("heading", { name: "出去喝水" })).toBeVisible();

  await page.getByRole("button", { name: "首页", exact: true }).click();
  await page.getByRole("button", { name: "开始本次课间" }).click();
  await expect(page.getByRole("status")).toContainText("已有进行中的课间");
  await expect(page.getByRole("heading", { name: "出去喝水" })).toBeVisible();
  await expect(page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).active.id, STORAGE_KEY)).resolves.toBe(firstId);
});

test("换一个排除当前结果、最多使用一次，并锁定最终正式结果", async ({ page }) => {
  await openFresh(page, { randomValues: [0] });

  await page.getByRole("button", { name: "开始本次课间" }).click();
  await expect(page.getByRole("heading", { name: "出去喝水" })).toBeVisible();
  const swap = page.getByRole("button", { name: "换一个" });
  await swap.click();

  await expect(page.getByRole("heading", { name: "散步" })).toBeVisible();
  await expect(page.getByText("已替换：出去喝水")).toBeVisible();
  await expect(swap).toBeDisabled();
  await expect(page.locator("h1")).toHaveCount(1);

  await page.getByRole("button", { name: "活动完成" }).click();
  await expect(page.getByRole("button", { name: "已完成" })).toBeDisabled();
  await expect(swap).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("heading", { name: "散步" })).toBeVisible();
  await expect(page.getByText("已替换：出去喝水")).toBeVisible();

  await finishBreak(page, false);
  await page.getByRole("button", { name: /最近 7 天/ }).click();
  await expect(page.getByText(/抽取 1 · 完成 1 · 未完成 0/)).toBeVisible();
  await expect(page.getByText("出去喝水").last()).toBeVisible();
});

test("换一个抽到贪吃蛇时仍需先完成一局才能确认活动", async ({ page }) => {
  await openFresh(page, { randomValues: [0] });
  await page.getByRole("button", { name: "开始本次课间" }).click();
  await page.evaluate(() => { Math.random = () => 0.8; });
  await page.getByRole("button", { name: "换一个" }).click();
  await expect(page.getByRole("heading", { name: "玩贪吃蛇" })).toBeVisible();
  await expect(page.getByRole("button", { name: "活动完成" })).toBeDisabled();
});

test("未完成结束会保留记录，且不产生第二条正式结果", async ({ page }) => {
  await openFresh(page, { randomValues: [0] });

  await page.getByRole("button", { name: "开始本次课间" }).click();
  await expect(page.getByRole("heading", { name: "出去喝水" })).toBeVisible();
  await finishBreak(page, false);

  await expect(page.getByRole("status")).toContainText("未完成");
  await page.getByRole("button", { name: /最近 7 天/ }).click();
  await expect(page.getByText(/抽取 1 · 完成 0 · 未完成 1/)).toBeVisible();
  await expect(page.getByText("出去喝水").last()).toBeVisible();
  await expect(page.getByText("未完成").last()).toBeVisible();
  await expect(page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).history, STORAGE_KEY)).resolves.toHaveLength(1);
});

test("贪吃蛇在浏览器中生成安全食物、支持键盘、边界穿越和三局上限", async ({ page }) => {
  // 随机值 0.8 抽到贪吃蛇、islands 地图和向右初始方向。
  await openFresh(page, { randomValues: [0.8] });

  await page.getByRole("button", { name: "开始本次课间" }).click();
  await expect(page.getByRole("heading", { name: "玩贪吃蛇" })).toBeVisible();
  await page.getByRole("button", { name: "开始游戏" }).click();
  await expect(page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).active.snakeGamesStarted, STORAGE_KEY)).resolves.toBe(1);
  await expect(page.getByText(/方向键 \/ WASD 控制 · 手机滑动控制/)).toBeVisible();
  await expect(page.locator(".snake-head")).toHaveCount(1);
  await expect(page.locator(".snake-body")).toHaveCount(2);
  await expect(page.locator(".snake-block").first()).toBeVisible();
  await expect(page.locator(".snake-food")).toHaveCount(1);
  await expect(page.locator("audio")).toHaveCount(0);

  // 暂停后逐步推进，确保从 x=9 穿越到 x=0，而不是依赖时间漂移。
  await page.getByRole("button", { name: "暂停" }).click();
  const initialHeadIndex = await page.locator(".snake-board > span").evaluateAll((cells) => cells.findIndex((cell) => cell.classList.contains("snake-head")));
  const initialX = initialHeadIndex % 20;
  expect(initialHeadIndex).toBeGreaterThanOrEqual(200);
  expect(initialHeadIndex).toBeLessThan(220);
  const stepsToWrap = 20 - initialX;
  for (let step = 0; step < stepsToWrap; step += 1) {
    await page.getByRole("button", { name: "继续" }).click();
    await page.waitForTimeout(210);
    await page.getByRole("button", { name: "暂停" }).click();
  }
  const wrappedHeadIndex = await page.locator(".snake-board > span").evaluateAll((cells) => cells.findIndex((cell) => cell.classList.contains("snake-head")));
  expect(wrappedHeadIndex % 20).toBeLessThanOrEqual(1);
  expect(Math.floor(wrappedHeadIndex / 20)).toBe(Math.floor(initialHeadIndex / 20));
  await expect(page.getByText(/地图 islands · 已暂停/)).toBeVisible();

  await page.getByRole("button", { name: "结束本局" }).click();
  await expect(page.getByRole("button", { name: "开始下一局" })).toBeVisible();

  await page.getByRole("button", { name: "开始下一局" }).click();
  await page.getByRole("button", { name: "结束本局" }).click();
  await page.getByRole("button", { name: "开始下一局" }).click();
  await page.getByRole("button", { name: "结束本局" }).click();
  await page.reload();
  await expect(page.getByText("贪吃蛇局数 3/3")).toBeVisible();
  await expect(page.getByRole("button", { name: "开始游戏" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "活动完成" })).toBeEnabled();
});

test("贪吃蛇撞到方块后结束本局，并在刷新后保留中断局数", async ({ page }) => {
  // lanes 地图的向上路径会撞到固定方块 (9,8)。
  await openFresh(page, { randomValues: [0.8] });
  await page.getByRole("button", { name: "开始本次课间" }).click();
  await page.evaluate(() => {
    let index = 0;
    const values = [0.34, 0, 0.5];
    Math.random = () => values[Math.min(index++, values.length - 1)];
  });
  await page.getByRole("button", { name: "开始游戏" }).click();
  await expect(page.getByText(/地图 lanes · 本局结束/)).toBeVisible({ timeout: 1_500 });
  await expect(page.getByRole("button", { name: "开始下一局" })).toBeVisible();

  await page.getByRole("button", { name: "开始下一局" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "玩贪吃蛇" })).toBeVisible();
  await expect(page.getByText("贪吃蛇局数 2/3")).toBeVisible();
});

test("手机滑动可以改变贪吃蛇方向", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFresh(page, { randomValues: [0.8] });
  await page.getByRole("button", { name: "开始本次课间" }).click();
  await page.getByRole("button", { name: "开始游戏" }).click();
  await page.getByRole("button", { name: "暂停" }).click();

  const initialHeadIndex = await page.locator(".snake-board > span").evaluateAll((cells) => cells.findIndex((cell) => cell.classList.contains("snake-head")));
  const initialX = initialHeadIndex % 20;
  await page.evaluate(async () => {
    const target = document.querySelector<HTMLElement>(".snake-panel");
    if (!target) throw new Error("snake panel not found");
    const point = (x: number, y: number) => new Touch({ identifier: 1, target, clientX: x, clientY: y });
    target.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [point(200, 220)] }));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    target.dispatchEvent(new TouchEvent("touchend", { bubbles: true, changedTouches: [point(200, 120)] }));
  });
  await page.getByRole("button", { name: "继续" }).click();
  await page.waitForTimeout(210);
  await page.getByRole("button", { name: "暂停" }).click();

  const headIndex = await page.locator(".snake-board > span").evaluateAll((cells) => cells.findIndex((cell) => cell.classList.contains("snake-head")));
  expect(headIndex).toBe(initialX + 9 * 20);
  await expect(page.getByText(/手机滑动控制/)).toBeVisible();
});
