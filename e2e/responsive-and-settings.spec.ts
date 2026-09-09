import { expect, test } from "@playwright/test";

test("桌面和手机都能完成导航、设置与低干扰抽取", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await expect(page.getByRole("button", { name: "首页", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /最近 7 天/ })).toBeVisible();
  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("dialog", { name: "本地数据设置" })).toBeVisible();
  await page.getByText("规则说明").click();
  await expect(page.getByText(/最多使用一次“换一个”/)).toBeVisible();
  await page.getByRole("button", { name: "完成" }).click();

  await page.getByRole("button", { name: "开始本次课间" }).click();
  await expect(page.getByRole("heading", { name: "出去喝水" })).toBeVisible();
  await page.getByRole("button", { name: /最近 7 天/ }).click();
  await expect(page.getByRole("heading", { name: "按日期看记录" })).toBeVisible();
  await page.getByRole("button", { name: "进行中" }).click();
  await expect(page.getByRole("heading", { name: "出去喝水" })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test("抽取动画默认约一秒、减少动态效果时跳过，并显示贪吃蛇操作提示", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "开始本次课间" }).click();
  await expect(page.getByText("正在为你挑一项…")).toBeVisible();
  await expect(page.getByRole("heading", { name: "出去喝水" })).toBeVisible({ timeout: 2_000 });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "开始本次课间" }).click();
  await expect(page.getByText("正在为你挑一项…")).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "出去喝水" })).toBeVisible();

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.addInitScript(() => { Math.random = () => 0.8; });
  await page.reload();
  await page.getByRole("button", { name: "开始本次课间" }).click();
  await expect(page.getByRole("heading", { name: "玩贪吃蛇" })).toBeVisible();
  await page.getByRole("button", { name: "开始游戏" }).click();
  await expect(page.getByText(/方向键 \/ WASD 控制 · 手机滑动控制/)).toBeVisible();
});
