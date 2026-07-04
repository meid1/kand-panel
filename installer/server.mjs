// Kand «Установить за меня» — сервис удалённой установки панели по SSH.
//
// БЕЗОПАСНОСТЬ (важно): принимаем root-доступ к ЧУЖОМУ серверу.
// - Пароль живёт ТОЛЬКО в памяти на время установки, НЕ пишется в лог/БД, стирается после.
// - Строгая валидация IP/логина/опций (никаких shell-инъекций: ssh-аргументы — массив,
//   значения проверены белым списком символов).
// - Рейт-лимит: не больше N одновременных установок и кулдаун на IP клиента.
//
// Запуск: node server.mjs  (нужен sshpass в системе). Порт — PORT (по умолч. 8091).
// install.sh берётся из INSTALL_SH (по умолч. ../install.sh рядом с репозиторием).

import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import net from 'node:net';

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8091;
const INSTALL_SH = process.env.INSTALL_SH || join(__dir, '..', 'install.sh');
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT) || 3;
const COOLDOWN_MS = Number(process.env.COOLDOWN_MS) || 60_000; // на IP клиента
const JOB_TTL_MS = 30 * 60_000; // храним лог задачи 30 мин

const FEATURES = ['bot', 'cabinet', 'payments', 'bypass', 'referral', 'promo', 'tickets', 'gifts', 'campaigns', 'franchises'];
const PROTOCOLS = ['reality-tcp', 'reality-grpc', 'hysteria2', 'xhttp'];

// ── состояние (только в памяти) ──────────────────────────────────────────────
const jobs = new Map(); // jobId → { status, log, result, createdAt }
const lastByIp = new Map(); // clientIp → ts (кулдаун)
let running = 0;

const rnd = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// ── валидация ────────────────────────────────────────────────────────────────
const isHost = (s) => typeof s === 'string' && (net.isIP(s) !== 0 || /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i.test(s));
const isUser = (s) => typeof s === 'string' && /^[a-z_][a-z0-9_-]{0,31}$/.test(s);
const isDomain = (s) => /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i.test(s);
const isBotToken = (s) => /^[0-9]{6,}:[A-Za-z0-9_-]{20,}$/.test(s);
const pickList = (arr, allow) => Array.isArray(arr) ? [...new Set(arr.filter((x) => allow.includes(x)))] : [];

// собрать безопасные флаги install.sh из проверенных данных
function buildFlags(b) {
  const f = [];
  if (b.domain && isDomain(b.domain)) f.push('--domain', b.domain);
  if (b.https) f.push('--https');
  if (b.port && Number.isInteger(+b.port) && +b.port >= 1 && +b.port <= 65535) f.push('--port', String(+b.port));
  if (b.botToken && isBotToken(b.botToken)) f.push('--bot-token', b.botToken);
  const protos = pickList(b.protocols, PROTOCOLS);
  if (protos.length) f.push('--protocols', protos.join(','));
  const disable = pickList(b.disable, FEATURES);
  if (disable.length) f.push('--disable', disable.join(','));
  const enable = pickList(b.enable, FEATURES);
  if (enable.length) f.push('--enable', enable.join(','));
  return f;
}

// ── запуск установки ──────────────────────────────────────────────────────────
function startInstall({ ip, user, password, flags }) {
  const id = rnd();
  const job = { status: 'running', log: '', result: null, createdAt: Date.now() };
  jobs.set(id, job);
  running++;

  const script = readFileSync(INSTALL_SH, 'utf8');
  const remoteCmd = ['bash', '-s', '--', ...flags].join(' '); // значения провалидированы → без инъекций
  const append = (s) => { job.log = (job.log + s).slice(-60_000); }; // ограничиваем размер лога

  append(`▶ Подключаюсь к ${user}@${ip}…\n`);
  const child = spawn('sshpass', [
    '-e', 'ssh',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ConnectTimeout=20',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=6',
    `${user}@${ip}`, remoteCmd,
  ], { env: { ...process.env, SSHPASS: password } });

  const killTimer = setTimeout(() => { append('\n⏱ Тайм-аут установки (20 мин) — прерываю.\n'); child.kill('SIGKILL'); }, 20 * 60_000);

  child.stdin.on('error', () => {}); // если ssh отвалился до записи
  child.stdin.write(script);
  child.stdin.end();
  child.stdout.on('data', (d) => append(d.toString()));
  child.stderr.on('data', (d) => append(d.toString()));

  child.on('close', (code) => {
    clearTimeout(killTimer);
    running--;
    if (code === 0) {
      job.status = 'done';
      // вытащить адрес/логин/пароль панели из вывода install.sh
      const panel = job.log.match(/Панель:\s*(\S+)/)?.[1];
      const login = job.log.match(/Логин:\s*(\S+)/)?.[1] || 'admin';
      const pass = job.log.match(/Пароль:\s*(\S+)/)?.[1];
      job.result = { panelUrl: panel || null, login, password: pass || null };
      append('\n✅ Готово.\n');
    } else {
      job.status = 'failed';
      append(`\n❌ Установка не удалась (код ${code}). Проверьте IP/логин/пароль и что сервер — чистый Ubuntu/Debian.\n`);
    }
  });
  child.on('error', (e) => {
    clearTimeout(killTimer); running--;
    job.status = 'failed';
    append(`\n❌ Ошибка запуска: ${e.code === 'ENOENT' ? 'sshpass не установлен на сервере' : e.message}\n`);
  });

  return id;
}

// ── HTTP ──────────────────────────────────────────────────────────────────────
const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};
const json = (res, code, obj) => { cors(res); res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const clientIp = (req) => (req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress || '?';

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

  // статус задачи
  const m = req.url.match(/^\/api\/install\/([a-z0-9]+)$/i);
  if (req.method === 'GET' && m) {
    const job = jobs.get(m[1]);
    if (!job) return json(res, 404, { error: 'задача не найдена' });
    return json(res, 200, { status: job.status, log: job.log, result: job.result });
  }

  // запуск установки
  if (req.method === 'POST' && req.url === '/api/install') {
    if (running >= MAX_CONCURRENT) return json(res, 429, { error: 'сейчас идёт много установок, попробуйте через минуту' });
    const ip = clientIp(req);
    const last = lastByIp.get(ip) || 0;
    if (Date.now() - last < COOLDOWN_MS) return json(res, 429, { error: 'подождите минуту перед следующей установкой' });

    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });
    req.on('end', () => {
      let b; try { b = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'битый запрос' }); }
      if (!isHost(b.server)) return json(res, 400, { error: 'неверный IP/хост сервера' });
      if (!isUser(b.user || 'root')) return json(res, 400, { error: 'неверный логин' });
      if (typeof b.password !== 'string' || !b.password || b.password.length > 256) return json(res, 400, { error: 'нужен пароль сервера' });

      lastByIp.set(ip, Date.now());
      const id = startInstall({ ip: b.server, user: b.user || 'root', password: b.password, flags: buildFlags(b) });
      // b.password больше нигде не держим (в job его нет)
      return json(res, 200, { jobId: id });
    });
    return;
  }

  json(res, 404, { error: 'not found' });
});

// уборка старых задач
setInterval(() => {
  const now = Date.now();
  for (const [id, j] of jobs) if (now - j.createdAt > JOB_TTL_MS) jobs.delete(id);
  for (const [ip, ts] of lastByIp) if (now - ts > COOLDOWN_MS * 5) lastByIp.delete(ip);
}, 60_000);

server.listen(PORT, '127.0.0.1', () => console.log(`Kand installer на 127.0.0.1:${PORT}`));
