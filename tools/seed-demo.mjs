// Заполняет БД СИНТЕТИЧЕСКИМИ демо-данными для скриншотов/демо-стенда.
// НИКАКИХ реальных клиентов — только выдуманные имена и суммы.
//   DATABASE_URL=postgres://... node tools/seed-demo.mjs
import { PrismaClient } from '@prisma/client';
import { randomUUID, randomBytes } from 'crypto';

const db = new PrismaClient();
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const daysAgo = (d) => new Date(Date.now() - d * 86400_000);
const tok = () => randomBytes(16).toString('hex');

const FIRST = ['Александр', 'Мария', 'Дмитрий', 'Анна', 'Иван', 'Екатерина', 'Сергей', 'Ольга', 'Андрей', 'Наталья', 'Максим', 'Юлия', 'Артём', 'Виктория', 'Никита', 'Дарья', 'Роман', 'Полина', 'Павел', 'Алина'];
const NICKS = ['travel', 'gamer', 'coder', 'music', 'crypto', 'movies', 'student', 'work', 'stream', 'photo', 'life', 'pro', 'x', 'vpn', 'net'];

async function wipe() {
  // порядок: сначала зависимые
  await db.$transaction([
    db.keySyncStatus.deleteMany({}), db.promoRedemption.deleteMany({}), db.userHwid.deleteMany({}),
    db.bypassUsage.deleteMany({}), db.device.deleteMany({}), db.payment.deleteMany({}),
    db.inbound.deleteMany({}), db.node.deleteMany({}), db.promoCode.deleteMany({}),
    db.plan.deleteMany({}), db.ledgerEntry.deleteMany({}), db.user.deleteMany({}), db.tenant.deleteMany({}),
  ]);
}

async function main() {
  await wipe();

  // ── тенант-платформа + 2 франшизы ──
  const platform = await db.tenant.create({ data: { kind: 'platform', brand: 'DemoVPN', brandColor: '#22D3EE' } });
  await db.tenant.create({ data: { kind: 'franchise', brand: 'SwiftVPN', brandColor: '#8B5CF6', sharePercent: 60, balance: 12400, pricePerMonth: 149, botUsername: 'swiftvpn_bot' } });
  await db.tenant.create({ data: { kind: 'franchise', brand: 'NordLine', brandColor: '#34D399', sharePercent: 50, balance: 5300, pricePerMonth: 199, botUsername: 'nordline_bot' } });
  const tenantId = platform.id;

  // ── тарифы ──
  const plans = [
    { title: '7 дней (проб.)', days: 7, price: 0, sortOrder: 0 },
    { title: '1 месяц', days: 30, price: 199, sortOrder: 1 },
    { title: '3 месяца', days: 90, price: 499, sortOrder: 2 },
    { title: '6 месяцев', days: 180, price: 899, sortOrder: 3 },
    { title: '1 год', days: 365, price: 1490, deviceLimit: 5, sortOrder: 4 },
    { title: 'Обход +10 ГБ', days: 0, price: 99, sortOrder: 5 },
  ];
  for (const p of plans) await db.plan.create({ data: { tenantId, ...p } });

  // ── ноды (выдуманные IP из документационных диапазонов) ──
  const nodes = [
    ['🇳🇱 Нидерланды-1', '203.0.113.11', ['reality-tcp', 'reality-grpc'], true],
    ['🇩🇪 Германия-1', '203.0.113.24', ['reality-grpc'], true],
    ['🇫🇮 Финляндия', '198.51.100.7', ['reality-tcp'], true],
    ['🇺🇸 США (нейросети)', '198.51.100.42', ['reality-tcp', 'xhttp'], true],
    ['🇹🇷 Турция', '192.0.2.55', ['reality-grpc'], true],
    ['🇰🇿 Казахстан', '192.0.2.80', ['reality-tcp'], false], // скрыт из подписки (демо тумблера)
  ];
  let i = 0;
  for (const [label, ip, protocols, showInSub] of nodes) {
    await db.node.create({ data: {
      tenantId, label, address: ip, ip, secretKey: randomBytes(12).toString('base64'),
      protocols, sni: 'www.microsoft.com', realityPbk: randomBytes(16).toString('base64url'),
      realitySid: randomBytes(4).toString('hex'), online: showInSub, showInSub, sortOrder: i++,
      role: label.includes('нейросети') ? 'warp' : 'exit', lastCheck: daysAgo(0),
    } });
  }

  // ── клиенты ──
  const N = 170;
  const users = [];
  for (let k = 0; k < N; k++) {
    const created = daysAgo(rnd(60) + (Math.random() < 0.4 ? 0 : rnd(60))); // больше свежих
    const roll = Math.random();
    const justReg = Math.random() < 0.16; // зашли, но доступ ещё не получили (для воронки)
    let expireAt = null, isTrial = false, isBlocked = false;
    if (justReg) { /* без подписки и устройств */ }
    else if (roll < 0.44) expireAt = new Date(Date.now() + (rnd(300) + 5) * 86400_000);        // активные
    else if (roll < 0.62) { expireAt = new Date(Date.now() + (rnd(20) + 3) * 86400_000); isTrial = true; } // триал
    else if (roll < 0.92) expireAt = daysAgo(rnd(40) + 1);                                  // истёкшие
    else { isBlocked = true; expireAt = daysAgo(rnd(30)); }                                 // заблок
    const name = pick(FIRST);
    const u = await db.user.create({ data: {
      tenantId, tgId: BigInt(100000 + k), tgName: name,
      tgUsername: Math.random() < 0.6 ? `${pick(NICKS)}_${rnd(999)}` : null,
      expireAt, isTrial, isBlocked, createdAt: created, balance: Math.random() < 0.2 ? rnd(5) * 100 : 0,
    } });
    users.push(u);
    // устройства для ~70% (кроме «только зашли»)
    if (!justReg && Math.random() < 0.82) {
      const dc = 1 + rnd(Math.random() < 0.15 ? 4 : 2); // немного «шерингеров» для HWID
      for (let d = 0; d < dc; d++) {
        await db.device.create({ data: { userId: u.id, name: pick(['iPhone', 'Android', 'ПК Windows', 'MacBook', 'Android TV']), vlessUuid: randomUUID(), subToken: tok(), tvCode: Math.random() < 0.3 ? String(100000 + rnd(899999)) : null } });
      }
      if (dc >= 3) for (let h = 0; h < dc; h++) await db.userHwid.create({ data: { userId: u.id, hwid: randomUUID(), os: pick(['iOS', 'Android', 'Windows', 'macOS']), model: pick(['iPhone 14', 'Pixel 7', 'Galaxy S23', 'MacBook Air']) } });
    }
    // обход-лимит части клиентов
    if (Math.random() < 0.5) await db.bypassUsage.create({ data: { userId: u.id, totalBytes: BigInt(rnd(9) * 1073741824), capGb: pick([30, 50, 100]), purchasedBytes: BigInt(0) } });
  }

  // ── платежи за 90 дней (для графиков/ARPPU/LTV/прогноза) ──
  const methods = ['yookassa', 'yookassa', 'yookassa', 'cryptobot', 'cryptomus', 'lava'];
  const amounts = [199, 199, 299, 499, 899, 1490];
  const payers = users.filter(() => Math.random() < 0.55);
  for (const u of payers) {
    const times = 1 + rnd(4); // повторные оплаты → LTV
    for (let t = 0; t < times; t++) {
      const amount = pick(amounts);
      const when = daysAgo(rnd(90));
      const status = Math.random() < 0.9 ? 'paid' : pick(['pending', 'failed']);
      await db.payment.create({ data: {
        tenantId, userId: u.id, amount, method: pick(methods),
        status, days: pick([30, 90, 180, 365]), invoiceId: 'demo_' + tok().slice(0, 12),
        createdAt: when, paidAt: status === 'paid' ? when : null,
      } });
    }
  }

  // ── промокоды + учёт расходов/доходов ──
  await db.promoCode.create({ data: { code: 'WELCOME', type: 'days', value: 7, maxUses: 1000, usedCount: 213 } });
  await db.promoCode.create({ data: { code: 'SALE50', type: 'balance', value: 100, maxUses: 500, usedCount: 87 } });
  await db.promoCode.create({ data: { code: 'GB10', type: 'bypass_gb', value: 10, maxUses: 300, usedCount: 41 } });
  await db.ledgerEntry.create({ data: { tenantId, kind: 'expense', amount: 8400, note: 'Аренда серверов (мес.)', createdAt: daysAgo(12) } });
  await db.ledgerEntry.create({ data: { tenantId, kind: 'expense', amount: 15000, note: 'Реклама (Telegram Ads)', createdAt: daysAgo(20) } });
  await db.ledgerEntry.create({ data: { tenantId, kind: 'income', amount: 6000, note: 'Партнёрская выплата', createdAt: daysAgo(8) } });

  const cnt = { users: await db.user.count(), payments: await db.payment.count(), nodes: await db.node.count(), tenants: await db.tenant.count() };
  console.log('seed готов:', JSON.stringify(cnt));
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
