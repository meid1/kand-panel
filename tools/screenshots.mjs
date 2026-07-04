// Генерация скриншотов админки и кабинета для README.
// Требует запущенную панель (API_PORT) и системный Chrome. Демо-данные — из dev-БД.
//   node tools/screenshots.mjs http://localhost:3120 <ADMIN_PASSWORD> <cabinetToken>
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const [base, password, cabinetToken] = process.argv.slice(2);
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots');

const TABS = [
  ['dashboard', '02-admin-dashboard'],
  ['nodes', '03-admin-nodes'],
  ['users', '04-admin-users'],
  ['plans', '05-admin-plans'],
  ['txns', '06-admin-payments'],
  ['tenants', '07-admin-franchises'],
  ['finance', '08-admin-finance'],
  ['traffic', '09-admin-traffic'],
  ['tickets', '11-admin-tickets'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

// логин
await page.goto(base, { waitUntil: 'networkidle' });
await page.fill('#pw', password);
await page.screenshot({ path: join(OUT, '01-login.png') });
await page.click('#login button');
await page.waitForSelector('#app:not(.hidden)', { timeout: 10000 });
await sleep(1200);

for (const [tab, name] of TABS) {
  const btn = await page.$(`nav button[data-tab="${tab}"]`);
  if (!btn || !(await btn.isVisible())) { console.log('· пропуск (скрыта):', name); continue; }
  await btn.click();
  await sleep(1500); // дать прогрузиться данным/графику
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log('✓', name);
}

// кабинет клиента
if (cabinetToken) {
  await page.goto(`${base}/cabinet/${cabinetToken}`, { waitUntil: 'networkidle' });
  await sleep(1500);
  await page.screenshot({ path: join(OUT, '10-cabinet.png'), fullPage: true });
  console.log('✓ 10-cabinet');
}

await browser.close();
console.log('готово →', OUT);
