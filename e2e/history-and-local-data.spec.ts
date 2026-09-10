import { expect, test } from "@playwright/test";

test("历史页展示最近七天统计、完成方式和记录详情", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.getByRole("button", { name: "开始本次课间" }).click();
  await expect(page.getByRole("heading", { name: "出去喝水" })).toBeVisible();
  await page.getByRole("button", { name: "活动完成" }).click();
  await page.getByRole("button", { name: "结束课间" }).click();
  await page.getByRole("button", { name: "确认结束" }).click();

  await page.getByRole("button", { name: "开始本次课间" }).click();
  await expect(page.getByRole("heading", { name: "出去喝水" })).toBeVisible();
  await page.getByRole("button", { name: "结束课间" }).click();
  await page.getByRole("button", { name: "确认结束" }).click();

  await page.getByRole("button", { name: /最近 7 天/ }).click();
  await expect(page.getByRole("heading", { name: "按日期看记录" })).toBeVisible();
  await expect(page.getByText(/抽取 2 · 完成 1 · 未完成 1/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "完成方式" })).toBeVisible();
  await expect(page.getByText(/出去喝水/).last()).toBeVisible();
  await page.locator("details").first().locator("summary").click();
  await expect(page.getByText(/开始时间：/).first()).toBeVisible();
  await expect(page.getByText(/结束时间：/).first()).toBeVisible();
});

test("进行中隐藏设置，结束后可清除历史并保留动画开关", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "开始本次课间" }).click();
  await expect(page.getByRole("heading", { name: "出去喝水" })).toBeVisible();
  await expect(page.getByRole("button", { name: "设置", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "结束课间" }).click();
  await page.getByRole("button", { name: "确认结束" }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const animationToggle = page.getByRole("checkbox", { name: "启用抽取动画" });
  await expect(animationToggle).toBeChecked();
  await animationToggle.uncheck();
  await page.getByRole("button", { name: "清除本地记录" }).click();
  await expect(page.getByRole("alertdialog", { name: "清除本地记录？" })).toBeVisible();
  await page.getByRole("button", { name: "确认清除" }).click();

  await expect(page.getByRole("button", { name: "开始本次课间" })).toBeVisible();
  await page.getByRole("button", { name: /最近 7 天/ }).click();
  await expect(page.getByText("还没有记录。下一次课间，从一口水开始。")).toBeVisible();
  await page.getByRole("button", { name: "返回课间松一松", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "启用抽取动画" })).not.toBeChecked();
});

test("跨午夜记录按开始日期归档", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const started = new Date();
    started.setDate(started.getDate() - 1);
    started.setHours(23, 59, 0, 0);
    const ended = new Date(started);
    ended.setDate(ended.getDate() + 1);
    ended.setHours(0, 3, 0, 0);
    localStorage.setItem("class-break-draw.v1", JSON.stringify({
      active: null,
      animationEnabled: true,
      history: [{ id: "midnight", startedAt: started.toISOString(), endedAt: ended.toISOString(), activityId: "water", completed: true }],
    }));
  });
  await page.reload();
  await page.getByRole("button", { name: /最近 7 天/ }).click();

  await expect(page.getByText(/抽取 1 · 完成 1 · 未完成 0/)).toBeVisible();
  const start = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  });
  await expect(page.getByText(new RegExp(`${start}.*周`))).toBeVisible();
});
