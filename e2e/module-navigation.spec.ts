import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const PREFERENCE_KEY = "relaxation-module-preference";

async function resetBrowserData(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

function moduleNav(page: Page) {
  return page.getByRole("navigation", { name: "一级模块" });
}

async function openSecondTab(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto("/");
  return page;
}

test("一级导航偏好只持久化模块，不恢复二级页，并使用独立存储键", async ({ page, context }) => {
  await resetBrowserData(page);

  const nav = moduleNav(page);
  const breakModule = nav.getByRole("button", { name: "课间松一松", exact: true });
  const virtueModule = nav.getByRole("button", { name: "功过格", exact: true });

  await expect(nav.getByRole("button")).toHaveCount(2);
  await expect(breakModule).toHaveAttribute("aria-current", "page");
  await expect(breakModule.locator("[aria-hidden=true]")).toContainText("☼");
  await expect(virtueModule).not.toHaveAttribute("aria-current", "page");

  await virtueModule.click();
  await expect(virtueModule).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: /功过格，/ })).toBeVisible();
  await expect(page.evaluate((key) => localStorage.getItem(key), PREFERENCE_KEY)).resolves.toBe("virtue");

  await page.setViewportSize({ width: 800, height: 360 });
  await page.getByRole("button", { name: /查看功过簿/ }).click();
  await expect(page.getByRole("heading", { name: "功过簿" })).toBeVisible();
  await expect(virtueModule).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "返回功过格", exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: /功过格，/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "功过簿" })).toHaveCount(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  const secondTab = await openSecondTab(context);
  await expect(moduleNav(secondTab).getByRole("button", { name: "功过格", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(secondTab.getByRole("heading", { name: /功过格，/ })).toBeVisible();

  await breakModule.click();
  await expect(page.evaluate((key) => localStorage.getItem(key), PREFERENCE_KEY)).resolves.toBe("break");
  await page.getByRole("button", { name: /最近 7 天/ }).click();
  await expect(page.getByRole("heading", { name: "按日期看记录" })).toBeVisible();
  await expect(moduleNav(page).getByRole("button", { name: "课间松一松", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: /返回课间松一松/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "开始本次课间" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "按日期看记录" })).toHaveCount(0);
});

test("无效模块偏好在真实浏览器刷新后回退到课间松一松", async ({ page }) => {
  await resetBrowserData(page);
  await page.evaluate((key) => localStorage.setItem(key, "unknown-module"), PREFERENCE_KEY);
  await page.reload();

  await expect(moduleNav(page).getByRole("button", { name: "课间松一松", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "开始本次课间" })).toBeVisible();
});

test("已打开标签页不实时同步模块，新标签页读取最新偏好", async ({ page, context }) => {
  await resetBrowserData(page);
  const other = await openSecondTab(context);

  await expect(moduleNav(page).getByRole("button", { name: "课间松一松", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(moduleNav(other).getByRole("button", { name: "课间松一松", exact: true })).toHaveAttribute("aria-current", "page");

  await moduleNav(page).getByRole("button", { name: "功过格", exact: true }).click();
  await expect(moduleNav(page).getByRole("button", { name: "功过格", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(moduleNav(other).getByRole("button", { name: "课间松一松", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(other.getByRole("button", { name: "开始本次课间" })).toBeVisible();

  const newest = await openSecondTab(context);
  await expect(moduleNav(newest).getByRole("button", { name: "功过格", exact: true })).toHaveAttribute("aria-current", "page");
});

test("进行中课间与功过记录跨刷新共存，清除任一模块不损伤另一模块或偏好", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  await resetBrowserData(page);

  await page.getByRole("button", { name: "开始本次课间" }).click();
  await expect(page.getByRole("heading", { name: "出去喝水" })).toBeVisible();
  await page.getByRole("button", { name: "换一个" }).click();
  await expect(page.getByRole("heading", { name: "散步" })).toBeVisible();
  await page.getByRole("button", { name: "活动完成" }).click();
  await moduleNav(page).getByRole("button", { name: "功过格", exact: true }).click();
  await page.getByRole("button", { name: "记善行" }).click();
  await page.getByLabel("具体发生了什么？").fill("课间与功过记录跨刷新共存");
  await page.getByRole("button", { name: "保存记录" }).click();

  await page.reload();
  await expect(moduleNav(page).getByRole("button", { name: "功过格", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("课间与功过记录跨刷新共存")).toBeVisible();
  const breakModule = moduleNav(page).getByRole("button", { name: "课间松一松", exact: true });
  await expect(breakModule).toHaveAttribute("aria-describedby", "active-break-status");
  await expect(page.locator("#active-break-status")).toHaveText("有进行中的课间");

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "清空功过格记录" }).click();
  await page.getByRole("button", { name: "确认清空" }).click();
  await expect(page.getByText("课间与功过记录跨刷新共存")).toHaveCount(0);
  await expect(page.getByText(/课间记录不受影响/)).toBeVisible();
  await expect(page.evaluate((key) => localStorage.getItem(key), PREFERENCE_KEY)).resolves.toBe("virtue");

  await breakModule.click();
  await expect(page.getByRole("heading", { name: "散步" })).toBeVisible();
  await expect(page.getByText("已替换：出去喝水")).toBeVisible();
  await expect(page.getByRole("button", { name: "已完成" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "换一个" })).toBeDisabled();
  await page.getByRole("button", { name: "结束课间" }).click();
  await page.getByRole("button", { name: "确认结束" }).click();

  await moduleNav(page).getByRole("button", { name: "功过格", exact: true }).click();
  await page.getByRole("button", { name: "记善行" }).click();
  await page.getByLabel("具体发生了什么？").fill("清除课间后仍保留的功过记录");
  await page.getByRole("button", { name: "保存记录" }).click();
  await moduleNav(page).getByRole("button", { name: "课间松一松", exact: true }).click();

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "清除本地记录" }).click();
  await page.getByRole("button", { name: "确认清除" }).click();
  await expect(page.getByRole("button", { name: "开始本次课间" })).toBeVisible();
  await page.getByRole("button", { name: /最近 7 天/ }).click();
  await expect(page.getByText("还没有记录。下一次课间，从一口水开始。")).toBeVisible();
  await page.getByRole("button", { name: /返回课间松一松/ }).click();
  await expect(page.evaluate((key) => localStorage.getItem(key), PREFERENCE_KEY)).resolves.toBe("break");

  await moduleNav(page).getByRole("button", { name: "功过格", exact: true }).click();
  await expect(page.getByText("清除课间后仍保留的功过记录")).toBeVisible();
});

test("功过表单脏输入拦截离开，继续编辑保留内容，确认后丢弃", async ({ page }) => {
  await resetBrowserData(page);
  await moduleNav(page).getByRole("button", { name: "功过格", exact: true }).click();
  await page.getByRole("button", { name: "记善行" }).click();
  const description = page.getByLabel("具体发生了什么？");
  await description.fill("尚未保存的重要输入");

  await moduleNav(page).getByRole("button", { name: "课间松一松", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "放弃未保存的输入？" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "继续编辑" }).click();
  await expect(description).toHaveValue("尚未保存的重要输入");
  await expect(description).toBeFocused();
  await expect(moduleNav(page).getByRole("button", { name: "功过格", exact: true })).toHaveAttribute("aria-current", "page");

  await moduleNav(page).getByRole("button", { name: "课间松一松", exact: true }).click();
  await page.getByRole("alertdialog", { name: "放弃未保存的输入？" }).getByRole("button", { name: "放弃并离开" }).click();
  await expect(page.getByRole("button", { name: "开始本次课间" })).toBeVisible();
  await expect(page.getByText("尚未保存的重要输入")).toHaveCount(0);

  await moduleNav(page).getByRole("button", { name: "功过格", exact: true }).click();
  await page.getByRole("button", { name: "记善行" }).click();
  await moduleNav(page).getByRole("button", { name: "课间松一松", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "放弃未保存的输入？" })).toHaveCount(0);
});

test("模块切换会关闭各自设置面板且保持目标模块归属", async ({ page }) => {
  await resetBrowserData(page);

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "本地数据设置" })).toBeVisible();
  await moduleNav(page).getByRole("button", { name: "功过格", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "本地数据设置" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /功过格，/ })).toBeVisible();

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "把记录留在手边" })).toBeVisible();
  await moduleNav(page).getByRole("button", { name: "课间松一松", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "把记录留在手边" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "开始本次课间" })).toBeVisible();
});

test("戒色子活动在跨模块切换后保持，课间活动状态不被重置", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0.5; });
  await resetBrowserData(page);

  await page.getByRole("button", { name: "开始本次课间" }).click();
  await expect(page.getByRole("heading", { name: "戒色练习" })).toBeVisible();
  await page.getByRole("button", { name: "内置提示文字" }).click();
  await expect(page.getByRole("heading", { name: "内置提示文字" })).toBeVisible();

  await moduleNav(page).getByRole("button", { name: "功过格", exact: true }).click();
  await expect(page.getByRole("heading", { name: /功过格，/ })).toBeVisible();
  await moduleNav(page).getByRole("button", { name: "课间松一松", exact: true }).click();

  await expect(page.getByRole("heading", { name: "戒色练习" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "内置提示文字" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新选择子活动" })).toBeVisible();
});
