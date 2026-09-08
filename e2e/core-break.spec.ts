import { expect, test } from "@playwright/test";

test("核心课间流程可以在真实浏览器中启动、恢复并结束", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "开始本次课间" })).toBeVisible();

  await page.getByRole("button", { name: "开始本次课间" }).click();
  await expect(page.getByText("本次课间进行中")).toBeVisible();
  await expect(page.getByText("怎么做")).toBeVisible();
  await expect(page.getByText("预计时长")).toBeVisible();
  await expect(page.getByRole("button", { name: "活动完成" })).toBeVisible();
  await expect(page.getByRole("button", { name: "结束课间" })).toBeVisible();

  await page.reload();
  await expect(page.getByText("本次课间进行中")).toBeVisible();
  await expect(page.getByRole("button", { name: "活动完成" })).toBeVisible();

  await page.getByRole("button", { name: "活动完成" }).click();
  await expect(page.getByRole("button", { name: "已完成" })).toBeDisabled();
  await page.getByRole("button", { name: "结束课间" }).click();
  await expect(page.getByRole("dialog", { name: "结束这次课间？" })).toBeVisible();
  await page.getByRole("button", { name: "确认结束" }).click();
  await expect(page.getByRole("status")).toContainText("已记录为已完成");
  await expect(page.getByRole("button", { name: "开始本次课间" })).toBeVisible();
});


test("戒色练习可以选择并重新选择子活动", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0.5; });
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "开始本次课间" }).click();

  await expect(page.getByRole("heading", { name: "戒色练习" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "选择一项练习" })).toBeVisible();
  await expect(page.getByRole("button", { name: "固肾功" })).toBeVisible();
  await page.getByRole("button", { name: "内置提示文字" }).click();
  await expect(page.getByRole("heading", { name: "内置提示文字" })).toBeVisible();
  await page.getByRole("button", { name: "重新选择子活动" }).click();
  await expect(page.getByRole("heading", { name: "选择一项练习" })).toBeVisible();
});


test("贪吃蛇支持局数、暂停、键盘和结束本局", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0.8; });
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "开始本次课间" }).click();

  await expect(page.getByRole("heading", { name: "玩贪吃蛇" })).toBeVisible();
  await expect(page.getByText("贪吃蛇局数 0/3")).toBeVisible();
  await page.getByRole("button", { name: "开始游戏" }).click();
  await expect(page.getByText("得分 0")).toBeVisible();
  await page.keyboard.press("ArrowUp");
  await page.getByRole("button", { name: "暂停" }).click();
  await expect(page.getByText(/已暂停/)).toBeVisible();
  await page.getByRole("button", { name: "继续" }).click();
  await page.getByRole("button", { name: "结束本局" }).click();
  await expect(page.getByRole("button", { name: "活动完成" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "开始下一局" })).toBeVisible();
});
