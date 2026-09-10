import { expect, test } from "@playwright/test";

test("手机保持横向等权双模块导航、内容区设置与无横向溢出", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const nav = page.getByRole("navigation", { name: "一级模块" });
  const breakModule = nav.getByRole("button", { name: "课间松一松", exact: true });
  const virtueModule = nav.getByRole("button", { name: "功过格", exact: true });
  await expect(nav.getByRole("button")).toHaveCount(2);
  await expect(breakModule).toBeVisible();
  await expect(virtueModule).toBeVisible();
  await expect(breakModule).toHaveAttribute("aria-current", "page");
  await expect(breakModule.locator("[aria-hidden=true]")).toContainText("☼");

  const [navBox, breakBox, virtueBox] = await Promise.all([
    nav.boundingBox(),
    breakModule.boundingBox(),
    virtueModule.boundingBox(),
  ]);
  expect(navBox).not.toBeNull();
  expect(breakBox).not.toBeNull();
  expect(virtueBox).not.toBeNull();
  expect(Math.abs(breakBox!.y - virtueBox!.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(breakBox!.width - virtueBox!.width)).toBeLessThanOrEqual(12);
  expect(breakBox!.height).toBeGreaterThanOrEqual(44);
  expect(virtueBox!.height).toBeGreaterThanOrEqual(44);

  const settings = page.getByRole("button", { name: "设置", exact: true });
  await expect(settings).toBeVisible();
  await expect(nav.getByRole("button", { name: "设置", exact: true })).toHaveCount(0);
  const settingsBox = await settings.boundingBox();
  expect(settingsBox).not.toBeNull();
  expect(settingsBox!.y).toBeGreaterThanOrEqual(navBox!.y + navBox!.height);

  await settings.click();
  await expect(page.getByRole("dialog", { name: "本地数据设置" })).toBeVisible();
  await page.getByText("规则说明").click();
  await expect(page.getByText(/最多使用一次“换一个”/)).toBeVisible();
  await page.getByRole("button", { name: "完成" }).click();

  await page.getByRole("button", { name: /最近 7 天/ }).click();
  await expect(page.getByRole("heading", { name: "按日期看记录" })).toBeVisible();
  await expect(page.getByRole("button", { name: /返回课间松一松/ })).toBeVisible();
  await expect(breakModule).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: /返回课间松一松/ }).click();

  await virtueModule.click();
  await expect(virtueModule).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: /功过格，/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "设置", exact: true })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await testInfo.attach("mobile-dual-module-navigation", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(nav.getByRole("button")).toHaveCount(2);
  await expect(virtueModule).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await testInfo.attach("desktop-dual-module-navigation", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
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
  await page.getByRole("button", { name: "进入游戏" }).click();
  await expect(page.getByRole("navigation", { name: "一级模块" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "返回活动" })).toBeVisible();
  await page.getByRole("button", { name: "开始游戏" }).click();
  await expect(page.getByText(/方向键 \/ WASD 控制 · 手机滑动控制/)).toBeVisible();
});
