#!/usr/bin/env node
/**
 * VPanel — экстрактор данных из ЧУЖИХ панелей в наш нормализованный формат.
 * Читает SQLite / MySQL / PostgreSQL и выдаёт JSON для импорта в VPanel
 * (POST /api/import/dry-run|run).
 *
 * Драйверы ставятся ПО НУЖДЕ (только для нужного движка):
 *   npm i better-sqlite3      # для 3x-ui / marzban(sqlite)
 *   npm i mysql2              # для marzban(mysql)
 *   npm i pg                  # для remnawave / marzban(postgres)
 *
 * Примеры:
 *   node extract.mjs --preset 3x-ui --db /etc/x-ui/x-ui.db --out out.json
 *   node extract.mjs --preset marzban --engine sqlite --db /var/lib/marzban/db.sqlite3 --out out.json
 *   node extract.mjs --preset marzban --engine mysql --conn "mysql://u:p@host/db" --out out.json
 *   node extract.mjs --preset remnawave --conn "postgresql://u:p@host:5432/db" --out out.json
 *
 * Итог out.json = { users:[...], usage:[...] }. Загрузи:
 *   users:  {source:"normalized", entity:"users", rows:<users>}
 *   usage:  {source:"normalized", entity:"usage", rows:<usage>}
 */
import fs from 'fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => {
  if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? true : arr[i + 1]]);
  return a;
}, []));

function die(m) { console.error('ОШИБКА:', m); process.exit(1); }
const iso = (d) => (d ? new Date(d).toISOString() : null);

// ── адаптеры движков (lazy) ──────────────────────────────────────────────────
async function sqliteRows(dbPath, sql) {
  let DB; try { DB = (await import('better-sqlite3')).default; }
  catch { die('нет драйвера SQLite. Установи: npm i better-sqlite3'); }
  const db = new DB(dbPath, { readonly: true });
  return db.prepare(sql).all();
}
async function mysqlRows(conn, sql) {
  let mysql; try { mysql = await import('mysql2/promise'); }
  catch { die('нет драйвера MySQL. Установи: npm i mysql2'); }
  const c = await mysql.createConnection(conn);
  const [rows] = await c.query(sql); await c.end(); return rows;
}
async function pgRows(conn, sql) {
  let pg; try { pg = (await import('pg')).default; }
  catch { die('нет драйвера PostgreSQL. Установи: npm i pg'); }
  const c = new pg.Client({ connectionString: conn }); await c.connect();
  const r = await c.query(sql); await c.end(); return r.rows;
}

// ── ПРЕСЕТЫ ──────────────────────────────────────────────────────────────────
const presets = {
  // 3x-ui: клиенты в JSON inbounds.settings.clients[], трафик в client_traffics по email.
  async ['3x-ui']() {
    if (!args.db) die('нужен --db /etc/x-ui/x-ui.db');
    const inbounds = await sqliteRows(args.db, 'SELECT id, protocol, settings FROM inbounds');
    const traf = await sqliteRows(args.db, 'SELECT email, up, down FROM client_traffics');
    const byEmail = new Map(traf.map((t) => [t.email, Number(t.up || 0) + Number(t.down || 0)]));
    const users = [], usage = [];
    for (const ib of inbounds) {
      let clients = [];
      try { clients = JSON.parse(ib.settings || '{}').clients || []; } catch { /* skip */ }
      for (const c of clients) {
        const email = c.email; if (!email) continue;
        const extId = `3xui_${email}`;
        const expMs = Number(c.expiryTime || 0); // МИЛЛИСЕКУНДЫ
        users.push({
          externalId: extId,
          tgId: c.tgId ? String(c.tgId) : undefined,
          username: email,
          expireAt: expMs > 0 ? iso(expMs) : null,
          isBlocked: c.enable === false,
          // vless uuid + СОХРАНЕНИЕ ССЫЛКИ: subId 3x-ui → subToken (ссылка /sub/<subId> не меняется)
          devices: c.id ? [{ uuid: c.id, subToken: c.subId || undefined }] : [],
        });
        usage.push({ userExternalId: extId, usedBytes: byEmail.get(email) || 0 });
      }
    }
    return { users, usage };
  },

  // Marzban: users + proxies(vless). У юзеров НЕТ telegram_id → externalId=username.
  async marzban() {
    const engine = args.engine || 'sqlite';
    const sql = `SELECT u.username, u.expire, u.data_limit, u.used_traffic, u.status,
      (SELECT p.settings FROM proxies p WHERE p.user_id=u.id AND p.type='vless' LIMIT 1) AS vless
      FROM users u`;
    let rows;
    if (engine === 'sqlite') { if (!args.db) die('нужен --db'); rows = await sqliteRows(args.db, sql); }
    else if (engine === 'mysql') { if (!args.conn) die('нужен --conn'); rows = await mysqlRows(args.conn, sql); }
    else if (engine === 'postgres') { if (!args.conn) die('нужен --conn'); rows = await pgRows(args.conn, sql); }
    else die('engine: sqlite|mysql|postgres');
    const users = [], usage = [];
    for (const r of rows) {
      const extId = `marzban_${r.username}`;
      let uuid; try { uuid = JSON.parse(r.vless || '{}').id; } catch { /* */ }
      users.push({
        externalId: extId, username: r.username,
        expireAt: r.expire ? iso(Number(r.expire) * 1000) : null, // СЕКУНДЫ
        isBlocked: r.status && String(r.status).toLowerCase() !== 'active',
        // ссылку Marzban сохранить нельзя (её sub-токен — крипто/JWT от секрета панели),
        // клиентам выдаётся новая ссылка подписки. Переносим uuid — сам VPN-доступ сохраняется.
        devices: uuid ? [uuid] : [],
      });
      usage.push({ userExternalId: extId, usedBytes: Number(r.used_traffic || 0) });
    }
    return { users, usage };
  },

  // Remnawave 2.x: PostgreSQL, users + user_traffic. Есть telegram_id и vless_uuid.
  async remnawave() {
    if (!args.conn) die('нужен --conn postgresql://…');
    const sql = `SELECT u.telegram_id, u.username, u.expire_at, u.status, u.vless_uuid, u.uuid, u.short_uuid,
      ut.used_traffic_bytes
      FROM users u LEFT JOIN user_traffic ut ON ut.t_id = u.t_id`;
    const rows = await pgRows(args.conn, sql);
    const users = [], usage = [];
    for (const r of rows) {
      const extId = `rw_${r.uuid}`;
      users.push({
        externalId: extId,
        tgId: r.telegram_id ? String(r.telegram_id) : undefined,
        username: r.username,
        expireAt: r.expire_at ? iso(r.expire_at) : null,
        isBlocked: r.status && String(r.status).toUpperCase() !== 'ACTIVE',
        // vless uuid + СОХРАНЕНИЕ ССЫЛКИ: short_uuid → subToken (ссылка /sub/<short_uuid> не меняется)
        devices: r.vless_uuid ? [{ uuid: r.vless_uuid, subToken: r.short_uuid || undefined }] : [],
      });
      usage.push({ userExternalId: extId, usedBytes: Number(r.used_traffic_bytes || 0) });
    }
    return { users, usage };
  },
};

// ── main ─────────────────────────────────────────────────────────────────────
const p = args.preset;
if (!p || !presets[p]) die('--preset 3x-ui | marzban | remnawave');
const out = await presets[p]();
const dest = args.out || 'vpanel-import.json';
fs.writeFileSync(dest, JSON.stringify(out, null, 2));
console.log(`✅ ${out.users.length} клиентов, ${out.usage.length} счётчиков → ${dest}`);
console.log('Дальше: dry-run, потом импорт (см. docs/migration.md).');
