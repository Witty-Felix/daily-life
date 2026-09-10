import { expect, test, type Page } from "@playwright/test";

const VIRTUE_KEY = "virtue-grid.v1";

async function openFresh(page: Page) {
  await page.addInitScript((key) => {
    if (localStorage.getItem("__virtue_test_seeded") !== "1") {
      localStorage.clear();
      localStorage.setItem(key, "[]");
      localStorage.setItem("__virtue_test_seeded", "1");
    }
  }, VIRTUE_KEY);
  await page.goto("/");
}

test("功过格支持主导航、善行过失记录、负分提示与刷新恢复", async ({ page }) => {
  await openFresh(page);
  await page.getByRole("button", { name: "功过格", exact: true }).click();
  await expect(page.getByRole("heading", { name: /功过格，/ })).toBeVisible();

  await page.getByRole("button", { name: "记善行" }).click();
  await page.getByLabel("具体发生了什么？").fill("主动帮助同学");
  await page.getByRole("button", { name: "保存记录" }).click();
  await page.getByRole("button", { name: "记过失" }).click();
  await page.getByLabel("具体发生了什么？").fill("忘记回复消息");
  await page.getByRole("button", { name: "保存记录" }).click();
  await expect(page.getByText("主动帮助同学")).toBeVisible();
  await expect(page.getByText("忘记回复消息")).toBeVisible();
  await expect(page.getByText("-1", { exact: true })).toBeVisible();
  await expect(page.getByText(/失败|坏人|惩罚/)).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("button", { name: "功过格", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "功过格", exact: true }).click();
  await expect(page.getByText("主动帮助同学")).toBeVisible();
  await expect(page.getByText("忘记回复消息")).toBeVisible();
});

test("功过簿日历与设置清空只影响功过格，课间可并行使用", async ({ page }) => {
  await openFresh(page);
  await page.getByRole("button", { name: "开始本次课间" }).click();
  await expect(page.getByText("本次课间进行中")).toBeVisible();
  await page.getByRole("button", { name: "功过格", exact: true }).click();
  await page.getByRole("button", { name: "记善行" }).click();
  await page.getByLabel("具体发生了什么？").fill("课间也保持共存");
  await page.getByRole("button", { name: "保存记录" }).click();
  await page.getByRole("button", { name: /查看功过簿/ }).click();
  await expect(page.getByRole("heading", { name: "功过簿" })).toBeVisible();
  await expect(page.locator("button.has-good").first()).toBeVisible();
  const futureDay = page.getByRole("button", { name: /未来日期不可选/ }).first();
  if (await futureDay.count()) await expect(futureDay).toBeDisabled();

  await page.getByRole("button", { name: "功过格", exact: true }).click();
  await page.locator("button.virtue-settings").click();
  await expect(page.getByRole("dialog", { name: "把记录留在手边" })).toBeVisible();
  await page.getByRole("button", { name: "清空功过格记录" }).click();
  await page.getByRole("button", { name: "确认清空" }).click();
  await expect(page.getByText("课间记录不受影响")).toBeVisible();
  await page.getByRole("button", { name: "进行中", exact: true }).click();
  await expect(page.getByText("本次课间进行中")).toBeVisible();
});

test("过往记录只能追加可追溯修正并更新历史统计", async ({ page }) => {
  await openFresh(page);
  const yesterday = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    const key = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    const dateKey = key(date);
    localStorage.setItem("virtue-grid.v1", JSON.stringify({ records: [{
      id: "historical-test-1",
      date: dateKey,
      type: "fault",
      description: "昨天忘记整理资料",
      reflection: null,
      corrections: [],
    }] }));
    return dateKey;
  });
  await page.reload();
  await page.getByRole("button", { name: "功过簿", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(yesterday) }).click();
  await expect(page.getByText("昨天忘记整理资料")).toBeVisible();
  await page.getByRole("button", { name: "追加修正" }).click();
  await page.getByLabel("具体发生了什么？").fill("昨天已整理资料");
  await page.getByLabel("本次修正说明").fill("补充核对后的实际情况");
  await page.getByRole("dialog").getByRole("button", { name: "追加修正" }).click();
  await expect(page.getByText("昨天已整理资料", { exact: true })).toBeVisible();
  await expect(page.getByText(/查看修正记录（1）/)).toBeVisible();
  await page.getByText(/查看修正记录（1）/).click();
  await expect(page.getByText("补充核对后的实际情况")).toBeVisible();
  await expect(page.getByText(/修正前：过失/)).toBeVisible();
  await expect(page.getByText(/修正后：善行|修正后：过失/)).toBeVisible();
});
