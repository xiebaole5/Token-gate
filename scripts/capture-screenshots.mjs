#!/usr/bin/env node
/**
 * TokenGate 参赛截图 — 准备数据 + Playwright 截 6 张
 * 用法: node scripts/capture-screenshots.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'screenshots');
const BASE = 'http://127.0.0.1:8787';
const APP = 'http://localhost:5173';

const NO_PROXY = { env: { ...process.env, http_proxy: '', https_proxy: '', all_proxy: '', NO_PROXY: '*' } };

function curl(args) {
  return execSync(`curl -s --noproxy '*' ${args}`, { encoding: 'utf8', ...NO_PROXY });
}

function curlJson(method, url, body) {
  const data = body ? `-H 'Content-Type: application/json' -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'` : '';
  const out = execSync(`curl -s --noproxy '*' -X ${method} ${data} ${url}`, { encoding: 'utf8', ...NO_PROXY });
  return JSON.parse(out || '{}');
}

async function waitServices() {
  for (let i = 0; i < 30; i++) {
    try {
      const f = curl(`-o /dev/null -w "%{http_code}" ${APP}/`);
      const b = curl(`-o /dev/null -w "%{http_code}" ${BASE}/api/health`);
      if (f === '200' && b === '200') return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('TokenGate 服务未就绪，请先 npm start');
}

function prepareData() {
  console.log('[1/3] 清理旧 provider…');
  const existing = curlJson('GET', `${BASE}/api/providers`);
  for (const p of existing.providers ?? []) {
    curl(`-X DELETE ${BASE}/api/providers/${p.id}`);
  }

  console.log('[2/3] 创建演示 provider + 造数据…');
  const a = curlJson('POST', `${BASE}/api/providers`, {
    name: 'OpenAI 主号',
    baseUrl: 'http://127.0.0.1:8787/api/_mock',
    category: '国外',
    plan: '按量 $50',
    quotaUsd: 50,
    models: ['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet'],
  });
  const b = curlJson('POST', `${BASE}/api/providers`, {
    name: 'DeepSeek 主号',
    baseUrl: 'http://127.0.0.1:8787/api/_mock',
    category: '国内',
    plan: '充值 ¥100',
    quotaUsd: 14,
    models: ['deepseek-chat', 'deepseek-reasoner'],
  });
  const PID_A = a.provider?.id;
  const PID_B = b.provider?.id;
  if (!PID_A || !PID_B) throw new Error('创建 provider 失败');

  for (const m of ['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet', 'gpt-4o']) {
    curlJson('POST', `${BASE}/proxy/${PID_A}/v1/chat/completions`, {
      model: m,
      messages: [{ role: 'user', content: 'x'.repeat(200) }],
    });
  }
  for (const m of ['deepseek-chat', 'deepseek-reasoner', 'deepseek-chat', 'deepseek-chat']) {
    curlJson('POST', `${BASE}/proxy/${PID_B}/v1/chat/completions`, {
      model: m,
      messages: [{ role: 'user', content: 'y'.repeat(300) }],
    });
  }
  console.log('  provider A/B + 8 笔代理消耗 OK');
  return { PID_A, PID_B };
}

async function shot(page, file, fn) {
  await fn();
  await page.waitForTimeout(600);
  const target = page.locator('.app');
  await target.waitFor({ state: 'visible', timeout: 15000 });
  await target.screenshot({ path: file, type: 'png' });
  console.log('  ✓', path.basename(file));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await waitServices();
  prepareData();

  console.log('[3/3] Playwright 截图…');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  // 清空本地预算/流水，避免旧数据干扰
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem(
      'tokengate.state.v1',
      JSON.stringify({ records: [], budgets: [], quotas: [], gateLogs: [] }),
    );
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // 01 驾驶舱首页
  await shot(page, path.join(OUT, '01-dashboard.png'), async () => {
    await page.getByRole('button', { name: '总览' }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForSelector('text=检测到的 AI 工具', { timeout: 20000 });
    await page.waitForSelector('text=消耗趋势', { timeout: 15000 });
  });

  // 02 provider 卡 + 排行榜
  await shot(page, path.join(OUT, '02-provider-cards-and-rank.png'), async () => {
    await page.getByRole('button', { name: '总览' }).click();
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('h3')].find((h) =>
        h.textContent?.includes('各 API 模块'),
      );
      el?.scrollIntoView({ block: 'start' });
    });
    await page.waitForSelector('text=各 API 模块', { timeout: 10000 });
    await page.waitForSelector('text=模型 Token 排行榜', { timeout: 10000 });
  });

  // 03 接入与监听
  await shot(page, path.join(OUT, '03-providers-page.png'), async () => {
    await page.getByRole('button', { name: '接入与监听' }).click();
    await page.waitForSelector('text=OpenAI 主号', { timeout: 10000 });
    await page.waitForSelector('text=DeepSeek 主号', { timeout: 10000 });
    await page.evaluate(() => window.scrollTo(0, 0));
  });

  // 设预算 $0.01（为第 4 张做准备）
  await page.getByRole('button', { name: '预算与闸门' }).click();
  await page.locator('.budget-form select').selectOption('total');
  await page.locator('.budget-form input[type="number"]').fill('0.01');
  await page.locator('.budget-form button[type="submit"]').click();
  await page.waitForSelector('text=整体', { timeout: 5000 });

  // 04 预算闸拦截弹窗
  await shot(page, path.join(OUT, '04-budget-gate-block.png'), async () => {
    await page.getByRole('button', { name: '记一笔' }).click();
    await page.locator('.entry-form select').selectOption('gpt-4o');
    await page.locator('.entry-form input[type="number"]').nth(0).fill('500');
    await page.locator('.entry-form input[type="number"]').nth(1).fill('5000');
    await page.locator('.entry-form input[list="known-projects"]').fill('测试拦截');
    await page.locator('.entry-form button[type="submit"]').click();
    await page.waitForSelector('text=预算闸已拦截', { timeout: 8000 });
    await page.waitForSelector('text=上限', { timeout: 5000 });
  });

  // 取消，留 blocked 闸门记录
  await page.getByRole('button', { name: '取消，不花这笔钱' }).click();
  await page.waitForSelector('text=预算闸已拦截', { state: 'hidden', timeout: 5000 });

  // 05 流水与闸门
  await shot(page, path.join(OUT, '05-records-and-gate-log.png'), async () => {
    await page.getByRole('button', { name: '流水与闸门' }).click();
    await page.waitForSelector('text=消耗流水', { timeout: 10000 });
    await page.waitForSelector('text=闸门记录', { timeout: 10000 });
    await page.waitForSelector('text=拦下', { timeout: 10000 });
    await page.evaluate(() => window.scrollTo(0, 0));
  });

  // 06 AI 管家
  await shot(page, path.join(OUT, '06-butler-local-llm.png'), async () => {
    await page.getByRole('button', { name: 'AI 管家' }).click();
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollTo(0, 0));
  });

  await browser.close();

  console.log('\n完成，目录:', OUT);
  execSync(`ls -lh "${OUT}"/*.png`, { stdio: 'inherit' });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
