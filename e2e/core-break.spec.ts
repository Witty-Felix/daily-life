import { expect, test } from "@playwright/test";

test("核心课间流程可以在真实浏览器中启动、恢复并结束", async ({ page }) => {
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
