// Kand admin — vanilla JS, без сборки. Работает на статике, ходит в /api с JWT.
const APP_VERSION = 'v0.22.0'; // при каждом обновлении бампить + строку в CHANGELOG.md
const API = '/api';
let TOKEN = localStorage.getItem('vp_token') || '';
// показать версию (шапка + вход)
document.addEventListener('DOMContentLoaded', () => {
  const a = document.getElementById('ver'); if (a) a.textContent = APP_VERSION;
  const b = document.getElementById('ver_login'); if (b) b.textContent = APP_VERSION;
});

async function api(path, opts = {}) {
  const r = await fetch(API + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
      ...(opts.headers || {}),
    },
  });
  if (r.status === 401) { logout(); throw new Error('нужен вход'); }
  const txt = await r.text();
  let data;
  try { data = txt ? JSON.parse(txt) : {}; }
  catch { throw new Error(r.ok ? 'сервер вернул не JSON' : ('HTTP ' + r.status + ' — сервис недоступен')); }
  if (!r.ok) throw new Error(data.message || ('HTTP ' + r.status));
  return data;
}
// лёгкий синк дедуплицируется: параллельные вызовы (переключение вкладок/поиск) переиспользуют один запрос
let _syncLightP = null;
function syncLight() {
  if (_syncLightP) return _syncLightP;
  _syncLightP = api('/sync/light', { method: 'POST' }).catch(() => {}).finally(() => { _syncLightP = null; });
  return _syncLightP;
}
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── auth ─────────────────────────────────────────────────────────────────────
async function doLogin() {
  const password = document.getElementById('pw').value;
  try {
    const r = await fetch(API + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const d = await r.json();
    if (!r.ok || !d.token) throw new Error(d.message || 'неверный пароль');
    TOKEN = d.token; localStorage.setItem('vp_token', TOKEN);
    showApp();
  } catch (e) { document.getElementById('loginErr').textContent = e.message; }
}
function logout() {
  TOKEN = ''; localStorage.removeItem('vp_token');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login').classList.remove('hidden');
}
async function showApp() {
  document.getElementById('login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  // скрыть неактуальные вкладки (настройка ui.hidden_tabs) — напр. в гибриде
  try {
    const s = await api('/settings/texts');
    (s.hiddenTabs || '').split(',').map((x) => x.trim()).filter(Boolean).forEach((t) => {
      document.querySelectorAll(`nav button[data-tab="${t}"]`).forEach((b) => { b.style.display = 'none'; });
    });
  } catch (e) { /* норм */ }
  // скрыть вкладки ВЫКЛЮЧЕННЫХ фич (выбор клиента в конфигураторе установки)
  try {
    const feats = await api('/features');
    const map = { payments: 'payments', promo: 'promo', franchises: 'tenants', tickets: 'tickets', gifts: 'gifts', campaigns: 'campaigns' };
    Object.keys(map).forEach((f) => { if (feats[f] === false) document.querySelectorAll(`nav button[data-tab="${map[f]}"]`).forEach((b) => { b.style.display = 'none'; }); });
  } catch (e) { /* норм */ }
  initNavIcons();
  switchTab('dashboard');
}
// чистые линейные SVG-иконки навигации (как в MariusVPN), stroke=currentColor
const NAV_ICONS = (() => {
  const w = (p) => `<svg class="nic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  return {
    dashboard: w('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
    users: w('<circle cx="9" cy="8" r="3"/><path d="M3.5 20c0-3 2.7-5 5.5-5s5.5 2 5.5 5"/><path d="M16 6a3 3 0 0 1 0 6"/><path d="M16.5 15c2.3.3 4 2 4 5"/>'),
    txns: w('<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/>'),
    payments: w('<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/><path d="M6 15h4"/>'),
    finance: w('<path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v0"/><rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="16" cy="13.5" r="1.3"/>'),
    nodes: w('<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>'),
    traffic: w('<path d="M3 17l6-6 4 4 8-8"/><path d="M17 7h4v4"/>'),
    hwid: w('<path d="M12 2.5l8.5 4.7v9.6L12 21.5 3.5 16.8V7.2z"/><path d="M12 21.5V12M3.7 7.2 12 12l8.3-4.8"/>'),
    tickets: w('<path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.5L3 21l2-5.6A8.5 8.5 0 1 1 21 11.5z"/>'),
    audit: w('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>'),
    texts: w('<path d="M12 20h9"/><path d="M16.5 3.5a2 2 0 0 1 3 3L8 18l-4 1 1-4z"/>'),
    plans: w('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13V22"/>'),
    promo: w('<path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 6 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-6z"/><path d="M14 7v10"/>'),
    gifts: w('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M4 12v9h16v-9M12 8v13"/><path d="M12 8S9.5 3.5 7 4.8 8.5 8 12 8zM12 8s2.5-4.5 5-3.2S15.5 8 12 8z"/>'),
    promogroups: w('<path d="M20.6 12.6 12 21l-8.6-8.6a3 3 0 0 1 0-4.2l4.2-4.2a3 3 0 0 1 4.2 0l8.8 8.8z"/><circle cx="7.5" cy="7.5" r="1.3"/>'),
    campaigns: w('<path d="M3 11v2a1 1 0 0 0 1 1h3l4 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a4 4 0 0 1 0 7"/><path d="M18 6a7 7 0 0 1 0 12"/>'),
    withdrawals: w('<rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="2.5"/><path d="M6 6V4h12v2"/>'),
    polls: w('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    broadcast: w('<path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>'),
    tenants: w('<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 21v-4h6v4"/><path d="M8 7h.01M12 7h.01M16 7h.01M8 11h.01M12 11h.01M16 11h.01"/>'),
    brand: w('<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1"/><circle cx="12" cy="8" r="1"/><circle cx="15.5" cy="10" r="1"/><circle cx="10" cy="15" r="1"/>'),
  };
})();
function initNavIcons() {
  document.querySelectorAll('.side nav button').forEach((b) => {
    const t = b.dataset.tab; const label = b.textContent.replace(/^[^\wА-Яа-я]+/, '').trim();
    b.innerHTML = (NAV_ICONS[t] || '') + '<span>' + label + '</span>';
  });
}

// ── tabs ─────────────────────────────────────────────────────────────────────
const RENDER = {};
function switchTab(name) {
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('main > div').forEach((d) => d.classList.add('hidden'));
  document.getElementById('tab-' + name).classList.remove('hidden');
  document.getElementById('app').classList.remove('nav-open'); // закрыть меню на мобильном
  RENDER[name] && RENDER[name]();
}
document.querySelectorAll('nav button').forEach((b) => b.onclick = () => switchTab(b.dataset.tab));

// ── ДАШБОРД ──────────────────────────────────────────────────────────────────
function statCard(label, value, sub, hint) {
  return `<div class="card" style="flex:1;min-width:150px;margin:0"${hint ? ` title="${esc(hint)}"` : ''}>`
    + `<div class="mut" style="font-size:11px;letter-spacing:.04em;text-transform:uppercase">${label}${hint ? ' <span style="cursor:help;opacity:.6">ⓘ</span>' : ''}</div>`
    + `<div style="font-size:26px;font-weight:800;margin:6px 0">${value}</div>`
    + (sub ? `<div class="mut" style="font-size:12px">${sub}</div>` : '') + '</div>';
}
// дата ДД.ММ + значение для подсказки графика
function fmtDay(iso) { const p = String(iso).split('-'); return p.length === 3 ? p[2] + '.' + p[1] : iso; }
function chartTip(d, key, unit) { const v = unit === 'money' ? Number(d[key]).toLocaleString('ru-RU') + '₽' : d[key] + ' рег.'; return `${fmtDay(d.date)}: ${v}`; }
// подпись оси Y (число): 1200→1.2к
function fmtAxis(v, unit) { v = Math.round(v); if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace('.0', '') + 'к'; return String(v); }
function chartAxes(max, n, data, unit, W, H, padL, padR, padT, padB) {
  const ih = H - padT - padB, iw = W - padL - padR;
  let g = '';
  // сетка + подписи Y (4 деления)
  [0, 1, 2, 3].forEach((k) => {
    const v = max * (3 - k) / 3, y = (padT + ih * k / 3).toFixed(0);
    g += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--line)" stroke-width="1" opacity=".55"/>`;
    g += `<text x="${padL - 6}" y="${+y + 3}" text-anchor="end" font-size="10" fill="var(--mut)">${fmtAxis(v, unit)}</text>`;
  });
  // подписи X (~6 дат)
  const step = Math.max(1, Math.floor(n / 6));
  data.forEach((d, i) => {
    if (i % step === 0 || i === n - 1) {
      const x = (padL + (n > 1 ? i * iw / (n - 1) : iw / 2)).toFixed(0);
      g += `<text x="${x}" y="${H - 7}" text-anchor="middle" font-size="10" fill="var(--mut)">${fmtDay(d.date)}</text>`;
    }
  });
  return g;
}
// линия с осями, сеткой, заливкой, точками и наведением
function lineChart(data, key, color, unit) {
  const W = 700, H = 190, padL = 46, padR = 12, padT = 12, padB = 26, n = data.length; if (!n) return '';
  const max = Math.max(1, ...data.map((d) => d[key])), iw = W - padL - padR, ih = H - padT - padB;
  const xs = (i) => padL + (n > 1 ? i * iw / (n - 1) : iw / 2), ys = (v) => padT + ih - (v / max) * ih;
  const pts = data.map((d, i) => `${xs(i).toFixed(0)},${ys(d[key]).toFixed(0)}`);
  const area = `M${padL},${(padT + ih).toFixed(0)} L` + pts.join(' L') + ` L${(W - padR).toFixed(0)},${(padT + ih).toFixed(0)} Z`;
  const colw = iw / (n || 1), gid = 'g_' + key;
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">`
    + `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".3"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`
    + chartAxes(max, n, data, unit, W, H, padL, padR, padT, padB)
    + `<path d="${area}" fill="url(#${gid})"/>`
    + `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>`
    + data.map((d, i) => `<circle cx="${xs(i).toFixed(0)}" cy="${ys(d[key]).toFixed(0)}" r="2.5" fill="${color}"/>`).join('')
    + data.map((d, i) => `<rect x="${(xs(i) - colw / 2).toFixed(0)}" y="${padT}" width="${colw.toFixed(0)}" height="${ih}" fill="transparent" style="cursor:pointer"><title>${esc(chartTip(d, key, unit))}</title></rect>`).join('')
    + '</svg>';
}
// столбики с осями, сеткой и наведением
function barChart(data, key, color, unit) {
  const W = 700, H = 190, padL = 46, padR = 12, padT = 12, padB = 26, n = data.length; if (!n) return '';
  const max = Math.max(1, ...data.map((d) => d[key])), iw = W - padL - padR, ih = H - padT - padB, bw = iw / n;
  const ys = (v) => padT + ih - (v / max) * ih;
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">`
    + chartAxes(max, n, data, unit, W, H, padL, padR, padT, padB)
    + data.map((d, i) => { const bh = (d[key] / max) * ih, x = padL + i * bw; return `<rect x="${(x + 1.5).toFixed(0)}" y="${(ys(d[key])).toFixed(0)}" width="${Math.max(1, bw - 3).toFixed(0)}" height="${bh.toFixed(0)}" rx="2" fill="${color}"/>`; }).join('')
    + data.map((d, i) => `<rect x="${(padL + i * bw).toFixed(0)}" y="${padT}" width="${bw.toFixed(0)}" height="${ih}" fill="transparent" style="cursor:pointer"><title>${esc(chartTip(d, key, unit))}</title></rect>`).join('')
    + '</svg>';
}
function funnelRow(label, value, pct, color) {
  return `<div style="margin:12px 0"><div class="row" style="justify-content:space-between"><span>${label}</span><span><b>${(value || 0).toLocaleString('ru-RU')}</b> <span class="mut">· ${pct}%</span></span></div>`
    + `<div style="height:12px;background:#1b2740;border-radius:6px;overflow:hidden;margin-top:5px"><div style="height:100%;width:${Math.max(1, pct)}%;background:${color};border-radius:6px"></div></div></div>`;
}
RENDER.dashboard = async function () {
  const el = document.getElementById('tab-dashboard');
  el.innerHTML = '<div class="mut">загрузка…</div>';
  try {
    await syncLight(); // догнать свежие оплаты (дедуп)
    const s = await api('/dashboard/summary');
    const money = (v) => Number(v).toLocaleString('ru-RU') + '₽';
    const h = s.health || {}, f = s.funnel || {};
    if (!s.chart) s.chart = [];
    const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
    const mom = (h.momPct == null)
      ? '<span class="pill">выручка к пред. мес.: —</span>'
      : (h.momPct >= 0
        ? `<span class="pill ok">▲ +${h.momPct}% выручка к пред. мес.</span>`
        : `<span class="pill bad">▼ ${h.momPct}% выручка к пред. мес.</span>`);
    el.innerHTML =
      `<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px"><b style="font-size:17px">Здоровье бизнеса</b><span class="row" style="gap:8px" id="sync_box">${mom}</span></div>`
      + '<div class="row" style="gap:12px;flex-wrap:wrap;margin-bottom:14px">'
      + statCard('Выручка / 30 дн', money(h.revenueMonth), 'полученные оплаты', 'Реально полученные оплаты за последние 30 дней (оплата с баланса не считается повторно).')
      + statCard('Активных', h.active, 'действующих подписок', 'Клиенты с действующей подпиской прямо сейчас (не заблокированные, срок в будущем).')
      + statCard('Отток / 30 дн', (h.churnPct || 0) + '%', `${h.churnedPayers || 0} платящих ушло`, 'Только среди ПЛАТЯЩИХ: у кого подписка кончилась за 30 дн и не продлена. % = ушедшие ÷ (активные платящие + ушедшие). Триал/бесплатные не учитываются.')
      + statCard('ARPPU / 30 дн', money(h.arppu), `с 1 платящего · ${h.payingUsersMonth || 0} чел.`, 'Средняя выручка с одного ПЛАТЯЩЕГО клиента за 30 дней = выручка за 30 дн ÷ число платящих за 30 дн.')
      + statCard('LTV', money(h.ltv), `с 1 платящего всего · ${h.payingUsers || 0} чел.`, 'Средний доход с одного платящего за всё время = вся полученная выручка ÷ всех, кто хоть раз платил.')
      + '</div>'
      + '<div class="card"><b>Воронка (главный бот)</b>'
      + funnelRow('Зашли', f.entered, 100, 'var(--acc)')
      + funnelRow('Получили доступ', f.access, pct(f.access, f.entered), '#6b8afd')
      + funnelRow('Оплатили', f.paid, pct(f.paid, f.entered), 'var(--ok)')
      + '</div>'
      + '<div class="row" style="gap:12px;flex-wrap:wrap">'
      + `<div class="card" style="flex:1;min-width:280px"><div class="row" style="justify-content:space-between"><b>Выручка по дням</b><span class="pill ok">${money(h.revenueMonth)}</span></div><div class="mut" style="font-size:12px;margin:2px 0 6px">30 дней · наведи на график</div>${lineChart(s.chart, 'revenue', '#22D3EE', 'money')}</div>`
      + `<div class="card" style="flex:1;min-width:280px"><div class="row" style="justify-content:space-between"><b>Регистрации</b><span class="pill">${s.chart.reduce((a, c) => a + c.signups, 0)}</span></div><div class="mut" style="font-size:12px;margin:2px 0 6px">по дням · наведи на график</div>${barChart(s.chart, 'signups', '#34D399', 'count')}</div>`
      + '</div>'
      + (s.forecast ? '<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><b>Прогноз дохода</b><span class="pill">следующий месяц</span></div>'
        + `<div style="font-size:30px;font-weight:800;color:#fbbf24;margin:8px 0 2px">${money(s.forecast.next)}</div>`
        + `<div class="mut" style="font-size:12px">коридор ${money(s.forecast.low)} — ${money(s.forecast.high)}</div>`
        + '<div class="mut" style="font-size:11px;margin:10px 0 2px;text-transform:uppercase;letter-spacing:.04em">История по месяцам</div>'
        + lineChart(s.forecast.byMonth.map((m) => ({ date: m.month, revenue: m.amount })), 'revenue', '#fbbf24', 'money')
        + '<div class="mut" style="font-size:11px;margin-top:4px">Прогноз по факту последних 30 дней × тренд · точность ±25-30% (история короткая)</div></div>'
        : '')
      + '<div class="card"><b>Последние платежи</b>'
      + (s.recent.length ? '<table><tr><th>Клиент</th><th>Сумма</th><th>Способ</th><th>Когда</th></tr>'
        + s.recent.map((p) => `<tr><td>${esc(p.name)}</td><td>${money(p.amount)}${p.topup ? ' <span class="pill">пополнение</span>' : ''}</td>`
          + `<td class="mut">${esc(p.method)}</td><td class="mut">${p.paidAt ? new Date(p.paidAt).toLocaleString() : '—'}</td></tr>`).join('') + '</table>'
        : '<div class="mut">пока нет</div>') + '</div>';
    // живой бэкенд (если подключён мост) — реальные онлайны/трафик
    try {
      const bs = await api('/bridge/status');
      if (bs.enabled && bs.status) {
        const x = bs.status; const tb = (b) => (Number(b || 0) / 1073741824).toFixed(1) + ' ГБ';
        el.insertAdjacentHTML('afterbegin', '<div class="card"><b>🟢 Живой бэкенд</b>'
          + '<div class="row" style="gap:18px;flex-wrap:wrap;margin-top:6px">'
          + `<span>Онлайн: <b>${x.onlineUsers || 0}</b> юзеров · ${x.onlineDevices || 0} устройств</span>`
          + `<span class="mut">Ключей: ${x.clients || 0} (активных ${x.enabled || 0})</span>`
          + `<span class="mut">Трафик: ↑${tb(x.up)} ↓${tb(x.down)}</span>`
          + `<span class="mut">xray: ${x.xrayRunning ? '🟢 работает' : '🔴 стоп'}</span></div></div>`);
      }
    } catch (e) { /* моста нет — норм */ }
    loadSyncStatus();
    renderOnboarding(el);
  } catch (e) { el.innerHTML = '<div class="mut">' + esc(e.message) + '</div>'; }
};
// Мастер первой настройки: карточка «Быстрый старт» сверху, пока не пройдены 5 шагов
async function renderOnboarding(el) {
  if (localStorage.getItem('kand_onb_hidden')) return;
  let o; try { o = await api('/onboarding'); } catch (e) { return; }
  if (!o || o.complete) return;
  const STEPS = [
    ['servers', 'Добавьте первый сервер', 'Подключите ноду одной командой', 'nodes'],
    ['payments', 'Подключите платёжку', 'ЮKassa, крипта, Telegram Stars и др.', 'payments'],
    ['bot', 'Настройте Telegram-бота', 'Впишите токен бота — клиенты пойдут через него', 'texts'],
    ['plans', 'Задайте тарифы', 'Сроки и цены подписок', 'plans'],
    ['brand', 'Оформите бренд', 'Название и цвет вашего сервиса', 'brand'],
  ];
  const chk = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="color:var(--ok)"><path d="M4 12l5 5L20 6"/></svg>';
  const dot = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="color:var(--mut)"><circle cx="12" cy="12" r="8"/></svg>';
  const rows = STEPS.map(([k, title, hint, tab]) => {
    const ok = o.steps[k];
    return `<div class="row" style="align-items:center;gap:12px;padding:9px 0;border-top:1px solid var(--line)">`
      + `<span style="flex:none">${ok ? chk : dot}</span>`
      + `<span class="grow" style="min-width:0"><b style="font-size:14px;${ok ? 'opacity:.6;text-decoration:line-through' : ''}">${title}</b><div class="mut" style="font-size:12px">${hint}</div></span>`
      + (ok ? '' : `<button class="btn sm" onclick="switchTab('${tab}')">Настроить</button>`) + `</div>`;
  }).join('');
  const pct = Math.round(o.done / o.total * 100);
  const html = '<div class="card" style="border-color:rgba(34,211,238,.35);background:linear-gradient(150deg,rgba(34,211,238,.06),var(--card))">'
    + `<div class="row" style="justify-content:space-between;align-items:center"><b style="font-size:16px">🚀 Быстрый старт — настройте панель</b>`
    + `<span class="row" style="gap:10px"><span class="mut" style="font-size:13px">${o.done} из ${o.total}</span><button class="btn sec sm" onclick="localStorage.setItem('kand_onb_hidden','1');RENDER.dashboard()">Скрыть</button></span></div>`
    + `<div class="bar" style="height:7px;border-radius:6px;background:#0c1526;margin:10px 0 4px;overflow:hidden"><i style="display:block;height:100%;width:${pct}%;background:linear-gradient(90deg,var(--acc),#7dd3fc)"></i></div>`
    + rows + '</div>';
  el.insertAdjacentHTML('afterbegin', html);
}
// индикатор свежести данных (синк из БД бота) + ручной запуск
async function loadSyncStatus() {
  const box = document.getElementById('sync_box'); if (!box || box.dataset.synced) return;
  box.dataset.synced = '1'; // не дублировать кнопки при повторном вызове
  try {
    const s = await api('/sync/status');
    if (!s.enabled) return; // синк не настроен — ничего не показываем
    let label = 'ещё не запускался';
    if (s.last && s.last.at) {
      const mins = Math.round((Date.now() - new Date(s.last.at).getTime()) / 60000);
      label = mins <= 0 ? 'только что' : (mins === 1 ? 'минуту назад' : mins + ' мин назад');
    }
    box.insertAdjacentHTML('afterbegin',
      `<span class="pill ${s.running ? 'warn' : 'ok'}" title="Свежие данные из базы бота подтягиваются при каждом открытии страницы (в реальном времени)">🔄 данные: ${s.running ? 'синхронизирую…' : label}</span>`
      + `<button class="btn sec sm" onclick="syncNow(this)" ${s.running ? 'disabled' : ''}>Обновить</button>`);
  } catch (e) { /* нет эндпоинта — норм */ }
}
async function syncNow(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'синхронизирую…'; }
  try { const r = await api('/sync/catalyc', { method: 'POST' }); toast(r.skipped ? r.skipped : `обновлено: +${r.created || 0} клиентов, +${r.payments || 0} платежей`); RENDER.dashboard(); }
  catch (e) { toast(e.message); if (btn) { btn.disabled = false; btn.textContent = 'Обновить'; } }
}

// ── ПЛАТЕЖИ (транзакции) ─────────────────────────────────────────────────────
let P_SEARCH = '', P_STATUS = '', P_OFFSET = 0, _pT = null;
const P_PAGE = 50;
RENDER.txns = async function () {
  const el = document.getElementById('tab-txns');
  el.innerHTML = '<div class="phead" style="margin-bottom:12px"><h2>Платежи</h2><div class="sub">все транзакции: поиск, фильтр по статусу, ручная смена статуса</div></div>'
    + '<div class="card"><div class="row" style="gap:8px;flex-wrap:wrap;align-items:center"><b>Платежи</b>'
    + '<input id="p_search" placeholder="🔍 клиент / способ / invoice" style="flex:1;min-width:180px;max-width:320px" oninput="onPaySearch(this.value)">'
    + '<select id="p_status" onchange="onPayStatus(this.value)"><option value="">все статусы</option><option value="paid">оплачен</option><option value="pending">ожидает</option><option value="failed">неудача</option><option value="refunded">возврат</option><option value="granted">выдан(не доход)</option></select></div>'
    + '<div id="p_list" class="mut">загрузка…</div><div id="p_pager" class="row" style="margin-top:8px;gap:10px;align-items:center"></div></div>';
  P_OFFSET = 0; P_SEARCH = ''; P_STATUS = ''; loadTxns();
};
function onPaySearch(v) { P_SEARCH = v.trim(); P_OFFSET = 0; clearTimeout(_pT); _pT = setTimeout(loadTxns, 300); }
function onPayStatus(v) { P_STATUS = v; P_OFFSET = 0; loadTxns(); }
function pageTxns(d) { P_OFFSET = Math.max(0, P_OFFSET + d * P_PAGE); loadTxns(); }
async function loadTxns() {
  const list = document.getElementById('p_list'); if (!list) return;
  const money = (v) => Number(v).toLocaleString('ru-RU') + '₽';
  const badge = (s) => ({ paid: '<span class="pill ok">оплачен</span>', pending: '<span class="pill">ожидает</span>', failed: '<span class="pill bad">неудача</span>', refunded: '<span class="pill bad">возврат</span>', granted: '<span class="pill">выдан</span>' }[s] || esc(s));
  try {
    const q = new URLSearchParams({ limit: P_PAGE, offset: P_OFFSET });
    if (P_SEARCH) q.set('search', P_SEARCH);
    if (P_STATUS) q.set('status', P_STATUS);
    const r = await api('/payments?' + q.toString());
    const rows = r.rows || r; const total = r.total != null ? r.total : rows.length;
    list.innerHTML = rows.length ? '<table><tr><th>Клиент</th><th>Сумма</th><th>Способ</th><th>Статус</th><th>Когда</th><th>Сменить</th></tr>'
      + rows.map((p) => `<tr><td>${esc(p.user ? (p.user.tgName || p.user.tgUsername || p.user.tgId) : '—')}</td>`
        + `<td>${money(p.amount)}</td><td class="mut">${esc(p.method)}</td><td>${badge(p.status)}</td>`
        + `<td class="mut">${new Date(p.createdAt).toLocaleString()}</td>`
        + `<td><select onchange="setPayStatus('${p.id}',this.value)"><option value="">—</option><option value="paid">оплачен</option><option value="pending">ожидает</option><option value="failed">неудача</option><option value="refunded">возврат</option><option value="granted">выдан</option></select></td></tr>`).join('') + '</table>'
      : '<span class="mut">ничего не найдено</span>';
    const pg = document.getElementById('p_pager');
    if (pg) {
      const from = total ? P_OFFSET + 1 : 0, to = Math.min(P_OFFSET + P_PAGE, total);
      pg.innerHTML = `<span class="mut">${from}–${to} из ${total}</span>`
        + (P_OFFSET > 0 ? '<button class="btn sec sm" onclick="pageTxns(-1)">← назад</button>' : '')
        + (to < total ? '<button class="btn sec sm" onclick="pageTxns(1)">вперёд →</button>' : '');
    }
  } catch (e) { list.textContent = e.message; }
}
async function setPayStatus(id, status) {
  if (!status) return;
  try { await api('/payments/' + id + '/status', { method: 'POST', body: JSON.stringify({ status }) }); toast('статус изменён'); loadTxns(); } catch (e) { toast(e.message); }
}

// ── ПОДДЕРЖКА (тикеты) ───────────────────────────────────────────────────────
let TK_STATUS = 'open';
RENDER.tickets = async function () {
  const el = document.getElementById('tab-tickets');
  const st = [['open', 'Открытые'], ['answered', 'Отвечено'], ['closed', 'Закрытые'], ['', 'Все']];
  el.innerHTML = '<div class="phead" style="margin-bottom:12px"><h2>Поддержка</h2><div class="sub">обращения клиентов из бота и кабинета — отвечайте прямо отсюда</div></div>'
    + '<div class="row" style="gap:6px;margin-bottom:12px">' + st.map(([v, t]) => `<button class="qbtn ${TK_STATUS === v ? 'on' : ''}" onclick="setTkStatus('${v}')">${t}</button>`).join('') + '</div>'
    + '<div id="tk_list" class="mut">загрузка…</div>';
  try {
    const rows = await api('/tickets' + (TK_STATUS ? '?status=' + TK_STATUS : ''));
    const badge = (s) => ({ open: '<span class="pill bad">открыт</span>', answered: '<span class="pill ok">отвечено</span>', closed: '<span class="pill">закрыт</span>' }[s] || esc(s));
    document.getElementById('tk_list').innerHTML = rows.length ? '<table><tr><th>Клиент</th><th>Тема</th><th>Сообщений</th><th>Статус</th><th>Обновлён</th></tr>'
      + rows.map((t) => `<tr style="cursor:pointer" onclick="openTicket('${t.id}')"><td>${esc(t.user?.tgName || t.user?.tgUsername || t.user?.tgId || '—')}</td>`
        + `<td>${esc(t.subject)}</td><td class="mut">${t._count?.messages || 0}</td><td>${badge(t.status)}</td>`
        + `<td class="mut">${new Date(t.updatedAt).toLocaleString()}</td></tr>`).join('') + '</table>'
      : '<div class="mut">нет обращений</div>';
  } catch (e) { document.getElementById('tk_list').textContent = e.message; }
};
function setTkStatus(v) { TK_STATUS = v; RENDER.tickets(); }
async function openTicket(id) {
  try {
    const t = await api('/tickets/' + id);
    const msgs = t.messages.map((m) => `<div style="margin:8px 0;display:flex;${m.fromAdmin ? 'justify-content:flex-end' : ''}">`
      + `<div style="max-width:78%;padding:9px 13px;border-radius:12px;font-size:14px;${m.fromAdmin ? 'background:var(--acc);color:#04121a' : 'background:var(--cardhi);border:1px solid var(--line)'}">`
      + `${esc(m.text)}<div style="font-size:10.5px;opacity:.7;margin-top:3px">${new Date(m.createdAt).toLocaleString()}</div></div></div>`).join('');
    const box = document.createElement('div'); box.className = 'umodal'; box.onclick = (e) => { if (e.target === box) box.remove(); };
    box.innerHTML = `<div class="card umodal-box"><div class="row" style="justify-content:space-between;align-items:center"><b>${esc(t.subject)}</b>`
      + `<button class="btn sec sm" onclick="this.closest('.umodal').remove()">✕</button></div>`
      + `<div class="mut" style="font-size:12px;margin:2px 0 10px">${esc(t.user?.tgName || t.user?.tgUsername || t.user?.tgId || '')}</div>`
      + `<div style="max-height:46vh;overflow:auto;padding:4px 0">${msgs}</div>`
      + `<textarea id="tk_reply" placeholder="Ваш ответ клиенту…" style="margin-top:10px"></textarea>`
      + `<div class="row" style="justify-content:space-between;margin-top:8px"><div class="row" style="gap:6px">`
      + `<button class="btn" onclick="ticketReply('${t.id}')">Ответить</button>`
      + `<button class="btn sec sm" onclick="ticketStatus('${t.id}','closed')">Закрыть тикет</button></div></div></div>`;
    document.body.appendChild(box);
  } catch (e) { toast(e.message); }
}
async function ticketReply(id) {
  const text = document.getElementById('tk_reply').value.trim(); if (!text) return toast('впишите ответ');
  try { await api('/tickets/' + id + '/reply', { method: 'POST', body: JSON.stringify({ text }) }); toast('ответ отправлен клиенту'); document.querySelector('.umodal')?.remove(); RENDER.tickets(); } catch (e) { toast(e.message); }
}
async function ticketStatus(id, status) {
  try { await api('/tickets/' + id + '/status', { method: 'POST', body: JSON.stringify({ status }) }); toast('статус обновлён'); document.querySelector('.umodal')?.remove(); RENDER.tickets(); } catch (e) { toast(e.message); }
}

// ── ФИНАНСЫ ──────────────────────────────────────────────────────────────────
let FIN_DAYS = 0; // 0 = всё время
function setFinDays(d) { FIN_DAYS = d; RENDER.finance(); }
RENDER.finance = async function () {
  const el = document.getElementById('tab-finance');
  el.innerHTML = '<div class="mut">загрузка…</div>';
  try {
    const money = (v) => Number(v).toLocaleString('ru-RU') + '₽';
    const s = await api('/finance/summary' + (FIN_DAYS ? '?days=' + FIN_DAYS : ''));
    const led = await api('/finance/ledger');
    const maxM = Math.max(1, ...s.byMonth.map((m) => m.amount));
    const per = [[0, 'Всё время'], [30, '30 дней'], [90, '90 дней'], [365, 'Год']];
    el.innerHTML =
      '<div class="phead" style="margin-bottom:12px"><h2>Финансы</h2><div class="sub">доход, расходы и прибыль' + (FIN_DAYS ? ' за выбранный период' : ' за всё время') + '</div></div>'
      + '<div class="row" style="gap:6px;margin-bottom:12px">' + per.map(([d, t]) => `<button class="qbtn ${FIN_DAYS === d ? 'on' : ''}" onclick="setFinDays(${d})">${t}</button>`).join('') + '</div>'
      + '<div class="row" style="gap:12px;flex-wrap:wrap;margin-bottom:12px">'
      + statCard('Доход (платежи)', money(s.revenueTotal), 'реально полученные оплаты')
      + statCard('Внешние доходы', money(s.extraIncome), 'ручной учёт')
      + statCard('Расходы', money(s.expenses), 'сервера, реклама и т.п.')
      + statCard('Прибыль', money(s.profit), 'доход + внешние − расходы')
      + '</div>'
      + '<div class="card"><b>Доход по способам оплаты</b>'
      + (s.byMethod.length ? '<table><tr><th>Способ</th><th>Сумма</th><th>Платежей</th></tr>'
        + s.byMethod.map((m) => `<tr><td>${esc(m.method)}</td><td>${money(m.amount)}</td><td class="mut">${m.count}</td></tr>`).join('') + '</table>'
        : '<div class="mut">нет данных</div>') + '</div>'
      + '<div class="card"><b>Доход по месяцам</b><table>'
      + (s.byMonth.length ? s.byMonth.map((m) => `<tr><td class="mut" style="width:80px">${m.month}</td>`
        + `<td><div style="background:var(--acc);height:14px;border-radius:4px;width:${Math.max(2, m.amount / maxM * 100)}%;display:inline-block;vertical-align:middle"></div> ${money(m.amount)}</td></tr>`).join('')
        : '<tr><td class="mut">нет данных</td></tr>') + '</table></div>'
      + '<div class="card"><b>Учёт расходов и доходов</b>'
      + '<div class="row" style="margin:8px 0"><select id="l_kind" style="max-width:130px"><option value="expense">Расход</option><option value="income">Доход</option></select>'
      + '<input id="l_amount" type="number" placeholder="сумма ₽" style="max-width:120px"><input id="l_note" placeholder="комментарий" class="grow"><button class="btn sm" onclick="addLedger()">Добавить</button></div>'
      + (led.length ? '<table><tr><th>Дата</th><th>Тип</th><th>Сумма</th><th>Комментарий</th><th></th></tr>'
        + led.map((l) => `<tr><td class="mut">${new Date(l.createdAt).toLocaleDateString()}</td>`
          + `<td>${l.kind === 'expense' ? '<span class="pill bad">расход</span>' : '<span class="pill ok">доход</span>'}</td>`
          + `<td>${money(l.amount)}</td><td class="mut">${esc(l.note || '')}</td>`
          + `<td><button class="btn bad sm" onclick="delLedger('${l.id}')">×</button></td></tr>`).join('') + '</table>'
        : '<div class="mut">записей нет</div>') + '</div>';
  } catch (e) { el.innerHTML = '<div class="mut">' + esc(e.message) + '</div>'; }
};
async function addLedger() {
  const kind = document.getElementById('l_kind').value;
  const amount = parseFloat(document.getElementById('l_amount').value);
  const note = document.getElementById('l_note').value.trim();
  if (!amount || amount <= 0) return toast('введи сумму');
  try { await api('/finance/ledger', { method: 'POST', body: JSON.stringify({ kind, amount, note }) }); toast('добавлено'); RENDER.finance(); } catch (e) { toast(e.message); }
}
async function delLedger(id) {
  if (!confirm('Удалить запись?')) return;
  try { await api('/finance/ledger/' + id, { method: 'DELETE' }); toast('удалено'); RENDER.finance(); } catch (e) { toast(e.message); }
}

// ── ТРАФИК ───────────────────────────────────────────────────────────────────
RENDER.traffic = async function () {
  const el = document.getElementById('tab-traffic'); el.innerHTML = '<div class="mut">загрузка…</div>';
  const gb = (b) => (Number(b) / 1073741824).toFixed(2) + ' ГБ';
  try {
    const r = await api('/bridge/traffic-top');
    if (!r.enabled) { el.innerHTML = '<div class="card"><b>Трафик</b><div class="mut" style="margin-top:6px">Данные о трафике приходят из внешнего бэкенда (мост не подключён). Для нод Kand трафик считается модулем статистики.</div></div>'; return; }
    const top = r.top || [];
    el.innerHTML = '<div class="phead" style="margin-bottom:12px"><h2>Трафик</h2><div class="sub">топ клиентов по объёму (из живого бэкенда)</div></div>'
      + '<div class="card"><b>Топ по трафику</b><div class="mut" style="font-size:12px;margin:4px 0 8px">50 клиентов с наибольшим трафиком (из живого бэкенда)</div>'
      + (top.length ? '<table><tr><th>#</th><th>Клиент</th><th>Всего</th><th>↑</th><th>↓</th></tr>'
        + top.map((c, i) => `<tr><td class="mut">${i + 1}</td><td>${esc(c.email)} ${c.online ? '<span class="pill ok">online</span>' : ''}</td><td><b>${gb(c.total)}</b></td><td class="mut">${gb(c.up)}</td><td class="mut">${gb(c.down)}</td></tr>`).join('') + '</table>'
        : '<div class="mut">нет данных</div>') + '</div>';
  } catch (e) { el.innerHTML = '<div class="mut">' + esc(e.message) + '</div>'; }
};
// ── HWID ─────────────────────────────────────────────────────────────────────
RENDER.hwid = async function () {
  const el = document.getElementById('tab-hwid'); el.innerHTML = '<div class="mut">загрузка…</div>';
  try {
    const rows = await api('/users/hwid-top');
    el.innerHTML = '<div class="phead" style="margin-bottom:12px"><h2>HWID</h2><div class="sub">клиенты с максимумом устройств — возможный шеринг</div></div>'
      + '<div class="card"><b>HWID — подозрительные</b><div class="mut" style="font-size:12px;margin:4px 0 8px">Клиенты с наибольшим числом устройств (возможный шеринг). Считается по подпискам, которые отдаёт Kand (заголовок x-hwid от приложений).</div>'
      + (rows.length ? '<table><tr><th>Клиент</th><th>Устройств</th><th></th></tr>'
        + rows.map((u) => `<tr><td>${esc(u.tgName || u.tgUsername || u.tgId)} ${u.isBlocked ? '<span class="pill bad">заблок</span>' : ''}</td><td><span class="pill">${u.hwidCount} HWID</span></td><td><button class="btn bad sm" onclick="toggleBlock('${u.id}',true)">🚫 Бан</button> <button class="btn sec sm" onclick="openUser('${u.id}')">открыть</button></td></tr>`).join('') + '</table>'
        : '<div class="mut">подозрительных нет (или подписки идут через внешний бэкенд — тогда HWID считает он)</div>') + '</div>';
  } catch (e) { el.innerHTML = '<div class="mut">' + esc(e.message) + '</div>'; }
};

// ── НОДЫ ─────────────────────────────────────────────────────────────────────
const PROTOS = ['reality-tcp', 'reality-grpc', 'hysteria2', 'xhttp'];
RENDER.nodes = async function () {
  const el = document.getElementById('tab-nodes');
  const protoBoxes = (pre) => PROTOS.map((p) => `<label class="pill"><input type="checkbox" id="${pre}${p}" value="${p}" ${p.startsWith('reality') ? 'checked' : ''} style="width:auto;margin:0 6px 0 0"> ${p}</label>`).join('');
  el.innerHTML = '<div class="card"><b>Добавить сервер</b>'
    + '<div class="mut" style="font-size:12px;margin:4px 0 10px">Два способа: <b>автонастройка</b> (введи IP → получи команду, сервер настроится сам) или <b>вручную</b> (уже готовый сервер — введи его параметры).</div>'
    + '<label class="fld">Название <span class="mut">(показывается в подписке у клиента)</span></label><input id="n_label" placeholder="🇳🇱 Нидерланды-1">'
    + '<div class="row"><div class="grow"><label class="fld">IP сервера</label><input id="n_ip" placeholder="1.2.3.4"></div>'
    + '<div class="grow"><label class="fld">Хост/домен для клиентов <span class="mut">(необязательно)</span></label><input id="n_addr" placeholder="пусто = как IP"></div></div>'
    + '<div class="mut" style="font-size:11px;margin:-2px 0 8px">Хост/домен — адрес в клиентской ссылке. Обычно оставь пустым (будет = IP). Домен нужен, только если сервер стоит за CDN/прокси.</div>'
    + '<label class="fld">Протоколы</label><div class="row">' + protoBoxes('n_')
    + '</div><label class="fld">Роль сервера</label><select id="n_role">'
    + '<option value="exit">Обычный выход (VPN)</option>'
    + '<option value="yt-ru">YouTube-РФ (без рекламы)</option>'
    + '<option value="bypass-origin">Origin для обхода</option></select>'
    + '<div class="row" style="margin-top:8px"><label class="pill"><input type="checkbox" id="n_warp" style="width:auto;margin:0 6px 0 0">🤖 WARP — чистый IP для нейросетей (ChatGPT/Claude/Gemini)</label></div>'
    + '<div class="row" style="margin-top:10px"><button class="btn" onclick="addNode()">⚙️ Автонастройка — создать и получить команду</button>'
    + '<button class="btn sec" onclick="toggleManual()">✍️ Добавить готовый сервер вручную</button></div>'
    + '<div id="n_install"></div>'
    // ── ручное добавление готового сервера ──
    + '<div id="n_manual" style="display:none;margin-top:14px;border-top:1px solid var(--line);padding-top:12px">'
    + '<b>Ручное добавление готового сервера</b>'
    + '<div class="mut" style="font-size:12px;margin:4px 0 8px">Сервер уже настроен (xray + reality). Введи его параметры — Kand просто отдаст такие ссылки в подписке, ничего не устанавливая. Проще всего взять из рабочей vless-ссылки этого сервера: <code>pbk</code>, <code>sid</code>, <code>sni</code>, порт.</div>'
    + '<label class="fld">Название</label><input id="m_label" placeholder="🇩🇪 Мой сервер">'
    + '<div class="row"><div class="grow"><label class="fld">IP</label><input id="m_ip" placeholder="1.2.3.4"></div><div class="grow"><label class="fld">Хост/домен (необяз.)</label><input id="m_addr" placeholder="пусто = как IP"></div></div>'
    + '<div class="row"><div class="grow"><label class="fld">Порт (reality/tcp)</label><input id="m_port" value="443"></div><div class="grow"><label class="fld">SNI (serverName)</label><input id="m_sni" placeholder="www.google.com"></div></div>'
    + '<div class="row"><div class="grow"><label class="fld">Reality pbk (publicKey)</label><input id="m_pbk"></div><div class="grow"><label class="fld">Reality sid (shortId)</label><input id="m_sid"></div></div>'
    + '<div class="row"><div class="grow"><label class="fld">gRPC порт (если reality-grpc)</label><input id="m_gport" placeholder="2053"></div><div class="grow"><label class="fld">gRPC serviceName</label><input id="m_gsvc" placeholder="grpc"></div></div>'
    + '<label class="fld">Протоколы</label><div class="row">' + protoBoxes('m_') + '</div>'
    + '<div style="margin-top:10px"><button class="btn" onclick="addExistingNode()">Добавить готовый сервер</button></div>'
    + '</div>'
    + '</div>'
    + '<div class="card"><b>🤖 WARP (ИИ-трафик)</b><div class="mut" style="font-size:12px">Выход для нейросетей (ChatGPT/Claude/Gemini) через чистый IP Cloudflare. Если текущий endpoint притормозит — переключи на другой из пула (ротация перепушит конфиг на все WARP-ноды). WARP+ лицензия даёт больше скорости.</div><div id="warp_cfg" class="mut" style="margin-top:8px">загрузка…</div></div>'
    + '<div class="card"><b>Серверы</b><div id="cdn_nodes"></div><div id="n_list" class="mut">загрузка…</div></div>';
  loadCdnNodes(); loadWarpCfg();
  try {
    const nodes = await api('/nodes');
    window._nodes = nodes;
    document.getElementById('n_list').innerHTML = nodes.length ? '<div class="mut" style="font-size:12px;margin-bottom:6px">Порядок ↑↓ = очередь в подписке у клиента. Название в подписке = имя ноды.</div><table><tr><th>#</th><th>Нода</th><th>Хост</th><th>Протоколы</th><th></th></tr>'
      + nodes.map((n, i) => `<tr><td style="white-space:nowrap"><button class="btn sec sm" ${i === 0 ? 'disabled' : ''} onclick="moveNode(${i},-1)">↑</button> <button class="btn sec sm" ${i === nodes.length - 1 ? 'disabled' : ''} onclick="moveNode(${i},1)">↓</button></td>`
        + `<td>${esc(n.label)} ${n.isActive ? '<span class="pill ok">вкл</span>' : '<span class="pill bad">выкл</span>'} ${n.online ? '<span class="pill ok">online</span>' : '<span class="pill bad">offline</span>'}`
        + `<div class="mut" style="font-size:11px">${n.lastCheck ? 'проверка: ' + new Date(n.lastCheck).toLocaleString() : 'ещё не проверялась'} <span id="hc_${n.id}"></span></div></td>`
        + `<td class="mut">${esc(n.address)}<br>${esc(n.ip)}</td><td class="mut">${(n.protocols || []).join(', ')}</td>`
        + `<td class="row"><button class="btn sec sm" onclick="checkNode('${n.id}')">🔄 проверить</button>`
        + `<button class="btn sec sm" onclick="editNode('${n.id}')">✏️ изменить</button>`
        + `<button class="btn sec sm" onclick="setWarp('${n.id}',${!n.warp})">${n.warp ? '🤖 WARP✓' : '🤖 WARP'}</button>`
        + `<button class="btn sec sm" onclick="editCfg('${n.id}')">⚙ конфиг</button>`
        + `<button class="btn sec sm" onclick="manualNode('${n.id}')">🔧 ручная</button>`
        + `<button class="btn sec sm" onclick="toggleNode('${n.id}',${!n.isActive})">${n.isActive ? 'выкл' : 'вкл'}</button>`
        + `<button class="btn bad sm" onclick="delNode('${n.id}')">×</button></td></tr>`).join('') + '</table>'
        + '<div id="n_editor"></div>'
      : '<span class="mut">пока нет нод</span>';
  } catch (e) { document.getElementById('n_list').textContent = e.message; }
};
async function loadWarpCfg() {
  const box = document.getElementById('warp_cfg'); if (!box) return;
  try {
    const c = await api('/nodes/warp');
    box.innerHTML = '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px">'
      + '<span>Endpoint:</span><select id="warp_ep">' + c.endpoints.map((e) => `<option value="${e}" ${e === c.endpoint ? 'selected' : ''}>${e}</option>`).join('') + '</select>'
      + '<button class="btn sm" onclick="saveWarpEp()">Сохранить</button>'
      + '<button class="btn sec sm" onclick="warpRotate()">🔄 Переключить + пуш на ноды</button></div>'
      + '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px">'
      + `<span>WARP+ ${c.hasLicense ? '<span class="pill ok">задан</span>' : '<span class="pill">не задан</span>'}:</span>`
      + '<input id="warp_lic" placeholder="ключ WARP+ (необязательно)" class="grow">'
      + '<button class="btn sm" onclick="saveWarpLic()">Сохранить</button></div>';
  } catch (e) { box.textContent = e.message; }
}
async function saveWarpEp() { try { await api('/nodes/warp', { method: 'PUT', body: JSON.stringify({ endpoint: document.getElementById('warp_ep').value }) }); toast('endpoint сохранён (применится при (пере)включении WARP)'); loadWarpCfg(); } catch (e) { toast(e.message); } }
async function saveWarpLic() { try { await api('/nodes/warp', { method: 'PUT', body: JSON.stringify({ license: document.getElementById('warp_lic').value.trim() }) }); toast('WARP+ сохранён'); loadWarpCfg(); } catch (e) { toast(e.message); } }
async function warpRotate() { if (!confirm('Переключить WARP на следующий endpoint и перепушить на все WARP-ноды?')) return; toast('переключаю…'); try { const r = await api('/nodes/warp/rotate', { method: 'POST', body: '{}' }); toast(`endpoint: ${r.endpoint} · перепушено ${r.pushed}/${r.nodes} нод`); loadWarpCfg(); } catch (e) { toast(e.message); } }

async function checkNode(id) {
  const box = document.getElementById('hc_' + id);
  if (box) box.innerHTML = '<span class="mut">проверяю…</span>';
  try {
    const r = await api('/nodes/' + id + '/health');
    if (box) box.innerHTML = r.online
      ? `<span style="color:var(--ok)">● online${r.latencyMs != null ? ' · ' + r.latencyMs + ' мс' : ''}</span>`
      : `<span style="color:var(--bad)">● offline (${esc(r.error || 'нет ответа')})</span>`;
  } catch (e) { if (box) box.textContent = e.message; }
}
async function editNode(id) {
  try {
    const n = await api('/nodes/' + id);
    const box = document.getElementById('n_editor');
    box.innerHTML = '<div class="card"><b>Изменить ноду</b>'
      + `<label class="fld">Название</label><input id="e_label" value="${esc(n.label || '')}">`
      + `<div class="row"><div class="grow"><label class="fld">Хост/домен</label><input id="e_addr" value="${esc(n.address || '')}"></div>`
      + `<div class="grow"><label class="fld">IP</label><input id="e_ip" value="${esc(n.ip || '')}"></div></div>`
      + `<div class="row"><div class="grow"><label class="fld">SNI</label><input id="e_sni" value="${esc(n.sni || '')}"></div>`
      + `<div class="grow"><label class="fld">Порядок</label><input id="e_sort" type="number" value="${n.sortOrder || 0}"></div></div>`
      + `<div class="row" style="margin-top:10px"><button class="btn" onclick="saveNodeEdit('${id}')">Сохранить</button>`
      + `<button class="btn sec" onclick="document.getElementById('n_editor').innerHTML=''">Отмена</button></div></div>`;
    box.scrollIntoView({ behavior: 'smooth' });
  } catch (e) { toast(e.message); }
}
async function saveNodeEdit(id) {
  const body = {
    label: document.getElementById('e_label').value.trim(),
    address: document.getElementById('e_addr').value.trim(),
    ip: document.getElementById('e_ip').value.trim(),
    sni: document.getElementById('e_sni').value.trim() || undefined,
    sortOrder: parseInt(document.getElementById('e_sort').value, 10) || 0,
  };
  try { await api('/nodes/' + id, { method: 'PATCH', body: JSON.stringify(body) }); toast('сохранено'); document.getElementById('n_editor').innerHTML = ''; RENDER.nodes(); } catch (e) { toast(e.message); }
}
async function editCfg(id) {
  try {
    const cfg = await api('/nodes/' + id + '/config');
    const box = document.getElementById('n_editor');
    box.innerHTML = '<div class="card"><b>Конфиг ноды (xray)</b><div class="mut">Правь и сохрани — конфиг запушится на установленный сервер (с рестартом xray) и восстановит клиентов.</div>'
      + `<textarea id="cfg_area" style="min-height:280px;font-family:monospace;font-size:12px">${esc(JSON.stringify(cfg, null, 1))}</textarea>`
      + `<div class="row"><button class="btn" onclick="saveCfg('${id}')">Сохранить и запушить</button><button class="btn sec" onclick="document.getElementById('n_editor').innerHTML=''">Отмена</button></div></div>`;
    box.scrollIntoView({ behavior: 'smooth' });
  } catch (e) { toast(e.message); }
}
async function saveCfg(id) {
  let config; try { config = JSON.parse(document.getElementById('cfg_area').value); } catch (e) { return toast('невалидный JSON'); }
  try { const r = await api('/nodes/' + id + '/config', { method: 'PUT', body: JSON.stringify({ config }) }); toast(r.pushed ? 'сохранено и запушено на сервер' : 'сохранено (сервер офлайн — применится позже)'); } catch (e) { toast(e.message); }
}
async function manualNode(id) {
  try {
    const m = await api('/nodes/' + id + '/manual');
    const box = document.getElementById('n_editor');
    box.innerHTML = '<div class="card"><b>Ручная установка ноды</b><div class="mut">Если не хочешь ставить одной командой — поставь xray + vpanel-agent сам и разложи это:</div>'
      + `<label class="fld">Порт агента</label><code>${m.agentPort}</code>`
      + `<label class="fld">AGENT_JWT_SECRET (env агента)</label><code>${esc(m.env.AGENT_JWT_SECRET)}</code>`
      + Object.entries(m.files).map(([p, c]) => `<label class="fld">${esc(p)}</label><textarea style="min-height:70px;font-size:11px">${esc(c)}</textarea>`).join('')
      + `<label class="fld">/usr/local/etc/xray/config.json</label><textarea style="min-height:160px;font-family:monospace;font-size:11px">${esc(JSON.stringify(m.xrayConfig, null, 1))}</textarea>`
      + `<div class="mut">${esc(m.hint)}</div><button class="btn sec" onclick="document.getElementById('n_editor').innerHTML=''" style="margin-top:8px">Закрыть</button></div>`;
    box.scrollIntoView({ behavior: 'smooth' });
  } catch (e) { toast(e.message); }
}
function checkedProtos(pre) { return PROTOS.filter((p) => { const el = document.getElementById(pre + p); return el && el.checked; }); }
function toggleManual() { const m = document.getElementById('n_manual'); m.style.display = m.style.display === 'none' ? 'block' : 'none'; if (m.style.display === 'block') m.scrollIntoView({ behavior: 'smooth' }); }
async function addNode() {
  const protocols = checkedProtos('n_');
  const body = {
    label: document.getElementById('n_label').value.trim(),
    address: document.getElementById('n_addr').value.trim() || undefined,
    ip: document.getElementById('n_ip').value.trim(),
    protocols,
    role: document.getElementById('n_role').value,
    warp: document.getElementById('n_warp').checked,
  };
  if (!body.label || !body.ip || !protocols.length) return toast('нужны название, IP и хотя бы один протокол');
  try {
    const r = await api('/nodes', { method: 'POST', body: JSON.stringify(body) });
    document.getElementById('n_install').innerHTML =
      '<label class="fld">Команда установки (выполни на сервере):</label><code>' + esc(r.install) + '</code>';
    toast('сервер создан'); RENDER.nodes();
  } catch (e) { toast(e.message); }
}
async function addExistingNode() {
  const body = {
    label: document.getElementById('m_label').value.trim(),
    ip: document.getElementById('m_ip').value.trim(),
    address: document.getElementById('m_addr').value.trim() || undefined,
    port: Number(document.getElementById('m_port').value) || 443,
    sni: document.getElementById('m_sni').value.trim() || undefined,
    realityPbk: document.getElementById('m_pbk').value.trim(),
    realitySid: document.getElementById('m_sid').value.trim(),
    grpcPort: Number(document.getElementById('m_gport').value) || undefined,
    grpcServiceName: document.getElementById('m_gsvc').value.trim() || undefined,
    protocols: checkedProtos('m_'),
  };
  if (!body.ip || !body.protocols.length) return toast('нужны IP и хотя бы один протокол');
  try { await api('/nodes/existing', { method: 'POST', body: JSON.stringify(body) }); toast('сервер добавлен'); RENDER.nodes(); } catch (e) { toast(e.message); }
}
// живые серверы внешнего бэкенда (cdn_api) — только показать
async function loadCdnNodes() {
  const box = document.getElementById('cdn_nodes'); if (!box) return;
  try {
    const r = await api('/bridge/nodes');
    if (!r.enabled || !r.nodes || !r.nodes.length) { box.innerHTML = ''; return; }
    window._cdnNodes = r.nodes;
    const onlineCnt = r.nodes.filter((n) => n.online && n.xrayRunning).length;
    box.innerHTML = '<div class="row" style="justify-content:space-between;color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding:0 4px 8px"><span>Сервер (как видит клиент)</span><span>' + onlineCnt + ' из ' + r.nodes.length + ' онлайн · показ в подписке</span></div>'
      + r.nodes.map((n, i) => {
        const st = !n.online ? 'off' : (n.xrayRunning ? 'on' : 'warn');
        const port = n.grpc_port || n.port;
        const load = n.online ? `CPU ${(+n.cpu || 0).toFixed(0)}% · RAM ${(+n.ram || 0).toFixed(0)}%` : 'офлайн';
        const net = n.online && (n.netRx || n.netTx) ? ` · ↓${(+n.netRx || 0).toFixed(1)}/↑${(+n.netTx || 0).toFixed(1)} МБ/с` : '';
        const users = n.online ? `<span class="pill ${n.onlineUsers ? 'ok' : ''}" style="font-size:11px">👥 ${n.onlineUsers || 0} онлайн</span>` : '';
        return `<div class="srv">`
          + `<span style="display:flex;flex-direction:column;gap:2px"><button class="btn sec sm" ${i === 0 ? 'disabled' : ''} onclick="cdnMove(${i},-1)" style="padding:0 7px;line-height:1.5">↑</button><button class="btn sec sm" ${i === r.nodes.length - 1 ? 'disabled' : ''} onclick="cdnMove(${i},1)" style="padding:0 7px;line-height:1.5">↓</button></span>`
          + `<span class="dot ${st}" title="${st === 'on' ? 'онлайн' : st === 'warn' ? 'xray не запущен' : 'офлайн'}"></span>`
          + `<span class="grow" style="min-width:0;display:flex;flex-direction:column;gap:4px">`
            + `<span class="row" style="gap:8px"><span class="name">${esc(n.remark || '—')} <button class="btn sec sm" onclick='cdnRename(${i},${JSON.stringify(n.remark || '')})' style="padding:2px 7px" title="переименовать">✏️</button></span>${users}</span>`
            + `<span class="mut" style="font-size:12.5px">${esc(n.host || '')}${port ? ':' + port : ''} · ${esc((n.protos || []).join(', '))} · ${load}${net}</span>`
          + `</span>`
          + `<button class="sw ${n.hidden ? '' : 'on'}" onclick="cdnToggle(${i},${!n.hidden})" title="${n.hidden ? 'скрыт из подписки' : 'показан в подписке'}"></button>`
          + `</div>`;
      }).join('')
      + '<div style="height:14px"></div>';
  } catch (e) { box.innerHTML = ''; }
}
async function cdnRename(idx, current) {
  const name = prompt('Название сервера (видит клиент в подписке):', current);
  if (name === null || !name.trim()) return;
  try { await api('/bridge/nodes/' + idx, { method: 'PATCH', body: JSON.stringify({ remark: name.trim() }) }); toast('переименовано'); loadCdnNodes(); } catch (e) { toast(e.message); }
}
async function cdnToggle(idx, hidden) {
  try { await api('/bridge/nodes/' + idx, { method: 'PATCH', body: JSON.stringify({ hidden }) }); toast(hidden ? 'скрыт из подписки' : 'показан в подписке'); loadCdnNodes(); } catch (e) { toast(e.message); }
}
async function cdnMove(i, dir) {
  const n = (window._cdnNodes || []).length; const j = i + dir; if (j < 0 || j >= n) return;
  const order = [...Array(n).keys()];
  [order[i], order[j]] = [order[j], order[i]];
  try { await api('/bridge/nodes/reorder', { method: 'POST', body: JSON.stringify({ order }) }); toast('порядок изменён'); loadCdnNodes(); } catch (e) { toast(e.message); }
}
async function toggleNode(id, active) { try { await api('/nodes/' + id, { method: 'PATCH', body: JSON.stringify({ isActive: active }) }); RENDER.nodes(); } catch (e) { toast(e.message); } }
async function setWarp(id, enable) { toast(enable ? 'включаю WARP…' : 'выключаю WARP…'); try { const r = await api('/nodes/' + id + '/warp', { method: 'POST', body: JSON.stringify({ enable }) }); toast(r.pushed ? 'WARP применён на сервере' : 'сохранено (сервер офлайн — применится позже)'); RENDER.nodes(); } catch (e) { toast(e.message); } }
async function delNode(id) { if (!confirm('Удалить ноду?')) return; try { await api('/nodes/' + id, { method: 'DELETE' }); RENDER.nodes(); } catch (e) { toast(e.message); } }
// порядок нод в подписке: меняем местами соседей и сохраняем через /nodes/reorder
async function moveNode(i, dir) {
  const arr = (window._nodes || []).map((n) => n.id);
  const j = i + dir; if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  try { await api('/nodes/reorder', { method: 'PUT', body: JSON.stringify({ ids: arr }) }); RENDER.nodes(); } catch (e) { toast(e.message); }
}

// ── КЛИЕНТЫ ──────────────────────────────────────────────────────────────────
let U_SEARCH = '', U_OFFSET = 0, _uSearchT = null;
const U_PAGE = 50;
let U_STATUS = '';
RENDER.users = async function () {
  const el = document.getElementById('tab-users');
  el.innerHTML = '<div class="phead row" style="justify-content:space-between;align-items:flex-start"><div><h2>Клиенты</h2><div class="sub" id="u_count">…</div></div>'
    + '<button class="btn sm" onclick="createManualKey()">🔑 Создать ключ</button></div>'
    + '<div class="card"><div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">'
    + '<input id="u_search" placeholder="🔍 Имя, @username, ID" style="flex:1;min-width:200px" oninput="onUserSearch(this.value)">'
    + '<select id="u_stsel" style="max-width:170px" onchange="onUserStatus(this.value)"><option value="">Все статусы</option><option value="active">Активные</option><option value="expired">Истёкшие</option><option value="blocked">Заблокированные</option></select></div>'
    + '<div id="u_bulk" style="margin-top:10px"></div>'
    + '<div id="u_list" class="mut" style="margin-top:10px">загрузка…</div><div id="u_pager" class="row" style="margin-top:10px;gap:10px;align-items:center"></div></div><div id="u_card"></div>';
  U_OFFSET = 0; U_SEARCH = ''; U_STATUS = ''; U_SEL.clear(); loadUsers();
  api('/promo-groups').then((g) => { U_GROUPS = g || []; renderBulkBar(); }).catch(() => {});
};
// ── массовый выбор клиентов (bulk) ───────────────────────────────────────────
let U_SEL = new Set();
let U_GROUPS = [];
function toggleSel(id, on) { if (on) U_SEL.add(id); else U_SEL.delete(id); renderBulkBar(); }
function toggleSelAll(on) { document.querySelectorAll('.u-sel').forEach((cb) => { cb.checked = on; if (on) U_SEL.add(cb.value); else U_SEL.delete(cb.value); }); renderBulkBar(); }
function clearSel() { U_SEL.clear(); document.querySelectorAll('.u-sel').forEach((cb) => { cb.checked = false; }); const h = document.getElementById('u_selall'); if (h) h.checked = false; renderBulkBar(); }
function renderBulkBar() {
  const b = document.getElementById('u_bulk'); if (!b) return;
  if (!U_SEL.size) { b.innerHTML = ''; return; }
  b.innerHTML = '<div class="card" style="margin:0;border-color:var(--acc,#22D3EE)"><div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">'
    + `<b>Выбрано: ${U_SEL.size}</b>`
    + '<button class="btn sm" onclick="bulkAction(\'extend\')">＋ дни</button>'
    + '<button class="btn sm" onclick="bulkAction(\'balance\')">₽ баланс</button>'
    + '<button class="btn bad sm" onclick="bulkAction(\'block\')">🚫 заблокировать</button>'
    + '<button class="btn sec sm" onclick="bulkAction(\'unblock\')">🔓 разблокировать</button>'
    + (U_GROUPS.length ? `<span class="row" style="gap:6px"><select id="u_grpsel" style="max-width:190px"><option value="">— в промо-группу —</option>${U_GROUPS.map((g) => `<option value="${esc(g.id)}">${esc(g.name)} (−${g.discountPct}%)</option>`).join('')}<option value="__clear__">убрать из группы</option></select><button class="btn sm" onclick="bulkGroup()">🎯 назначить</button></span>` : '')
    + '<button class="btn sec sm" onclick="clearSel()">снять выбор</button></div></div>';
}
async function bulkGroup() {
  const sel = document.getElementById('u_grpsel'); if (!sel) return;
  let v = sel.value; if (!v) return toast('выберите группу');
  if (v === '__clear__') v = '';
  const ids = [...U_SEL]; if (!ids.length) return;
  toast('применяю…');
  try { const r = await api('/users/bulk', { method: 'POST', body: JSON.stringify({ action: 'promoGroup', ids, value: v }) }); toast(`готово: ${r.done}`); clearSel(); loadUsers(); } catch (e) { toast(e.message); }
}
async function bulkAction(action) {
  const ids = [...U_SEL]; if (!ids.length) return;
  let value;
  if (action === 'extend') { const v = prompt(`Начислить/списать дней для ${ids.length} клиентов (можно −):`, '30'); if (v === null) return; value = Number(v); if (!value) return toast('нужно число'); }
  if (action === 'balance') { const v = prompt(`Изменить баланс для ${ids.length} клиентов, ₽ (можно −):`, '100'); if (v === null) return; value = Number(v); if (!value) return toast('нужно число'); }
  if ((action === 'block' || action === 'unblock') && !confirm(`${action === 'block' ? 'Заблокировать' : 'Разблокировать'} ${ids.length} клиентов?`)) return;
  toast('применяю…');
  try {
    const r = await api('/users/bulk', { method: 'POST', body: JSON.stringify({ action, ids, value }) });
    toast(`готово: ${r.done}${r.failed && r.failed.length ? `, ошибок ${r.failed.length}` : ''}`);
    clearSel(); loadUsers();
  } catch (e) { toast(e.message); }
}
function onUserSearch(v) { U_SEARCH = v.trim(); U_OFFSET = 0; clearTimeout(_uSearchT); _uSearchT = setTimeout(loadUsers, 300); }
function onUserStatus(v) { U_STATUS = v; U_OFFSET = 0; loadUsers(); }
function pageUsers(d) { U_OFFSET = Math.max(0, U_OFFSET + d * U_PAGE); loadUsers(); }
async function loadUsers() {
  const list = document.getElementById('u_list'); if (!list) return;
  try {
    await syncLight(); // догнать свежие оплаты (дедуп)
    const q = new URLSearchParams({ limit: U_PAGE, offset: U_OFFSET });
    if (U_SEARCH) q.set('search', U_SEARCH);
    if (U_STATUS) q.set('status', U_STATUS);
    const r = await api('/users?' + q.toString());
    const rows = r.rows || r; const total = r.total != null ? r.total : rows.length;
    const cnt = document.getElementById('u_count'); if (cnt) cnt.textContent = total.toLocaleString('ru-RU') + ' найдено';
    const now = Date.now();
    list.innerHTML = rows.length ? '<table><tr><th style="width:26px"><input type="checkbox" id="u_selall" onclick="toggleSelAll(this.checked)" title="выбрать всё на странице"></th><th>Пользователь</th><th>TG-ID</th><th>Баланс</th><th>Подписка</th><th>Статус</th><th></th></tr>'
      + rows.map((u) => {
        const expMs = u.expireAt ? new Date(u.expireAt).getTime() : null;
        const active = !u.isBlocked && expMs && expMs > now;
        const dleft = expMs ? Math.ceil((expMs - now) / 86400000) : null;
        const st = u.isBlocked ? '<span class="pill bad">заблок.</span>' : active ? '<span class="pill ok">активна</span>' : '<span class="pill warn">истекла</span>';
        const sub = expMs
          ? (active ? `<span style="color:var(--ok)">${dleft} дн.</span> <span class="mut">${new Date(expMs).toLocaleDateString()}</span>`
            : `<span style="color:var(--bad)">истекла</span> <span class="mut">${new Date(expMs).toLocaleDateString()}</span>`)
          : '<span class="mut">—</span>';
        const badge = u.tenant && u.tenant.kind === 'franchise' ? ` <span class="pill brand">🤖 ${esc(u.tenant.brand)}</span>` : '';
        return `<tr style="cursor:pointer" onclick="openUser('${u.id}')"><td onclick="event.stopPropagation()"><input type="checkbox" class="u-sel" value="${u.id}" ${U_SEL.has(u.id) ? 'checked' : ''} onchange="toggleSel('${u.id}',this.checked)"></td><td><b>${esc(u.tgName || 'без имени')}</b>${u.tgUsername ? ` <span class="mut">@${esc(u.tgUsername)}</span>` : ''}${badge}</td>`
          + `<td class="mut">${u.tgId}</td><td>${Number(u.balance || 0)}₽</td><td>${sub}</td><td>${st}</td><td class="mut" style="text-align:right;font-size:18px">›</td></tr>`;
      }).join('') + '</table>'
      : '<span class="mut">ничего не найдено</span>';
    renderBulkBar();
    const pg = document.getElementById('u_pager');
    if (pg) {
      const from = total ? U_OFFSET + 1 : 0, to = Math.min(U_OFFSET + U_PAGE, total);
      pg.innerHTML = `<span class="mut">${from}–${to} из ${total}</span>`
        + (U_OFFSET > 0 ? '<button class="btn sec sm" onclick="pageUsers(-1)">← назад</button>' : '')
        + (to < total ? '<button class="btn sec sm" onclick="pageUsers(1)">вперёд →</button>' : '');
    }
  } catch (e) { list.textContent = e.message; }
}
// Ручное создание ключа (выдать кому-то без Telegram). Показываем готовые ссылки.
async function createManualKey() {
  const name = prompt('Название ключа (кому выдаём):', 'Ручной ключ');
  if (name === null) return;
  const d = prompt('На сколько дней? (0 = бессрочно, потом продлите вручную)', '30');
  if (d === null) return;
  try {
    const r = await api('/users/manual', { method: 'POST', body: JSON.stringify({ name: name || 'Ручной ключ', days: Number(d) || 0 }) });
    const L = r.links || {};
    const box = document.getElementById('u_card');
    box.innerHTML = '<div class="card"><b>🔑 Ключ создан</b>'
      + `<div class="mut" style="margin:6px 0">${esc(name || 'Ручной ключ')}${Number(d) > 0 ? ' · ' + Number(d) + ' дн.' : ' · бессрочно'}</div>`
      + '<div style="margin:8px 0"><div class="mut">Ссылка подписки (в приложение):</div><code style="word-break:break-all">' + esc(L.sub || '') + '</code></div>'
      + '<div style="margin:8px 0"><div class="mut">Веб-кабинет (для клиента):</div><code style="word-break:break-all">' + esc(L.cabinet || '') + '</code></div>'
      + '<div style="margin:8px 0"><div class="mut">Код для ТВ:</div><code>' + esc(L.tv || '') + '</code></div>'
      + '<button class="btn sm" style="margin-top:8px" onclick="navigator.clipboard.writeText(' + JSON.stringify(L.sub || '') + ');toast(\'скопировано\')">📋 Скопировать ссылку</button>'
      + '</div>';
    RENDER.users();
    toast('ключ создан');
  } catch (e) { toast(e.message); }
}
async function openUser(id) {
  try {
    await api('/sync/user-by-id/' + id, { method: 'POST' }).catch(() => {}); // моментально свежий клиент из базы бота
    const u = await api('/users/' + id);
    let bp = null; try { bp = await api('/bypass/' + id); } catch (e) { /* нет данных */ }
    const bpLine = bp ? (bp.unlimited ? 'Обход: безлимит'
      : `Обход: ${bp.remainingGb != null ? bp.remainingGb.toFixed(1) : '?'} ГБ осталось (из ${bp.capGb.toFixed(1)}, использовано ${bp.usedGb.toFixed(1)})${bp.suspended ? ' — 🚫 ИСЧЕРПАН' : ''}`) : '';
    const base = location.origin;
    const devs = (u.devices || []).map((d) => {
      const link = `${base}/sub/${d.subToken}`;
      return `<tr><td>${esc(d.name)}</td>`
        + `<td class="mut">${esc(d.subToken.slice(0, 10))}…</td>`
        + `<td><button class="btn sec sm" onclick='copyText(${JSON.stringify(link)})'>📋 ссылка</button>`
        + ` <button class="btn bad sm" onclick="delDevice('${id}','${d.id}')">×</button></td></tr>`;
    }).join('');
    document.getElementById('u_card').innerHTML = '<div class="umodal" onclick="if(event.target===this)closeUser()"><div class="card umodal-box"><div class="row" style="justify-content:space-between;align-items:center"><b>' + esc(u.tgName || u.tgUsername || u.tgId) + '</b>'
      + `<span class="row" style="gap:6px"><button class="btn ${u.isBlocked ? '' : 'bad'} sm" onclick="toggleBlock('${id}',${!u.isBlocked})">${u.isBlocked ? '🔓 Разблокировать' : '🚫 Заблокировать'}</button><button class="btn sec sm" onclick="closeUser()">✕</button></span></div>`
      + `<div class="mut">ID ${u.tgId} · тариф до ${u.expireAt ? new Date(u.expireAt).toLocaleString() : '—'}${u.isBlocked ? ' · <span class="pill bad">заблокирован</span>' : ''}</div>`
      + '<div class="row" style="margin:10px 0"><input id="u_days" type="number" placeholder="дней (+/−)" style="max-width:140px">'
      + `<button class="btn sm" onclick="grantDays('${id}')">начислить/списать дни</button></div>`
      + `<div class="row" style="margin:0 0 10px"><span class="mut">Баланс: <b>${Number(u.balance||0)}₽</b></span><input id="u_bal" type="number" placeholder="₽ (+/−)" style="max-width:120px"><button class="btn sm" onclick="adjBal('${id}')">изменить баланс</button></div>`
      + `<div class="mut" style="margin:6px 0">${esc(bpLine)}</div>`
      + '<div class="row" style="margin:0 0 10px"><input id="u_gb" type="number" placeholder="ГБ обхода" style="max-width:130px">'
      + `<button class="btn sm" onclick="bypassGb('${id}',true)">+ докупить</button>`
      + `<button class="btn sec sm" onclick="bypassGb('${id}',false)">− списать</button>`
      + `<button class="btn sec sm" onclick="resetBypass('${id}')">↺ обнулить счётчик</button></div>`
      + `<div class="row" style="margin:0 0 10px"><span class="mut">Тумблер обхода:</span><button class="btn sec sm" onclick="toggleBypass('${id}',true)">🔥 С обходом</button><button class="btn sec sm" onclick="toggleBypass('${id}',false)">📶 Без обхода</button><button class="btn sec sm" onclick="forceEnable('${id}')">⚡ Принудительно включить ключ</button></div>`
      + `<div class="row" style="margin:0 0 10px"><span class="mut">Ключ:</span><button class="btn sec sm" onclick="issueKey('${id}')">🔑 Выдать ключ</button><button class="btn bad sm" onclick="deleteKeyUser('${id}')">🗑 Удалить ключ</button></div>`
      + `<div style="margin:6px 0"><button class="btn sec sm" onclick="diagnose('${id}')">🩺 Диагностика</button><span id="diag_${id}" class="mut" style="margin-left:8px"></span></div>`
      + '<b class="mut">Устройства (подписки)</b><table>' + (devs || '<tr><td class="mut">нет</td></tr>') + '</table>'
      + `<button class="btn sec sm" style="margin-top:8px" onclick="addDevice('${id}')">+ устройство</button>`
      + `<div id="hwids_${id}" class="mut" style="margin-top:10px"></div></div></div>`;
    loadHwids(id);
  } catch (e) { toast(e.message); }
}
function closeUser() { const c = document.getElementById('u_card'); if (c) c.innerHTML = ''; }
async function loadHwids(id) {
  try {
    const hw = await api('/users/' + id + '/hwids');
    const box = document.getElementById('hwids_' + id); if (!box) return;
    box.innerHTML = hw.length ? '<b>HWID-устройства:</b> ' + hw.map(h => `<span class="pill">${esc(h.hwid.slice(0, 12))}${h.os ? ' · ' + esc(h.os) : ''} <a href="#" onclick="delHwid('${id}','${h.id}');return false" style="color:var(--bad)">×</a></span>`).join(' ') : '';
  } catch (e) {}
}
async function delHwid(id, hwidId) { try { await api('/users/' + id + '/hwids/' + hwidId, { method: 'DELETE' }); loadHwids(id); toast('устройство сброшено'); } catch (e) { toast(e.message); } }
async function diagnose(id) {
  const box = document.getElementById('diag_' + id);
  box.textContent = 'проверяю…';
  try {
    const d = await api('/users/' + id + '/diagnose');
    const rows = d.checks.map(c => `${c.ok ? '✅' : '❌'} ${esc(c.name)} <span class="mut">(${esc(c.detail)})</span>`).join('<br>');
    box.innerHTML = '<br>' + rows + '<br><i>' + esc(d.hint) + '</i>' +
      (d.canFix ? ` <button class="btn sm" onclick="fixUser('${id}')">Починить</button>` : '');
  } catch (e) { box.textContent = e.message; }
}
async function fixUser(id) {
  try { const r = await api('/users/' + id + '/fix', { method: 'POST' }); toast('Починка: ' + r.reconciled); diagnose(id); } catch (e) { toast(e.message); }
}
async function adjBal(id) {
  const amount = parseFloat(document.getElementById('u_bal').value);
  if (!amount) return toast('введи сумму');
  try { const r = await api('/users/' + id + '/balance', { method: 'POST', body: JSON.stringify({ amount }) }); toast('баланс: ' + r.balance + '₽'); openUser(id); } catch (e) { toast(e.message); }
}
async function bypassGb(id, add) {
  const gb = parseFloat(document.getElementById('u_gb').value);
  if (!gb || gb <= 0) return toast('введи число ГБ');
  try { await api('/bypass/' + id + (add ? '/add' : '/deduct'), { method: 'POST', body: JSON.stringify({ gb }) }); toast(add ? 'докуплено' : 'списано'); openUser(id); } catch (e) { toast(e.message); }
}
function copyText(t) { navigator.clipboard.writeText(t); toast('скопировано'); }
async function toggleBlock(id, block) {
  try { await api('/users/' + id + '/block', { method: 'PATCH', body: JSON.stringify({ blocked: block }) }); toast(block ? 'заблокирован' : 'разблокирован'); openUser(id); } catch (e) { toast(e.message); }
}
async function resetBypass(id) {
  if (!confirm('Обнулить счётчик обхода клиента (использованные ГБ → 0)?')) return;
  try { await api('/bypass/' + id + '/reset', { method: 'POST' }); toast('счётчик обнулён'); openUser(id); } catch (e) { toast(e.message); }
}
async function toggleBypass(id, on) {
  try { await api('/bypass/' + id + '/toggle', { method: 'POST', body: JSON.stringify({ on }) }); toast(on ? 'обход включён' : 'обход выключен'); } catch (e) { toast(e.message); }
}
async function forceEnable(id) {
  try { await api('/users/' + id + '/force-enable', { method: 'POST' }); toast('ключ принудительно включён'); openUser(id); } catch (e) { toast(e.message); }
}
async function issueKey(id) {
  try { await api('/users/' + id + '/issue-key', { method: 'POST' }); toast('ключ выдан'); openUser(id); } catch (e) { toast(e.message); }
}
async function deleteKeyUser(id) {
  if (!confirm('Удалить ключ клиента во внешнем бэкенде? Доступ пропадёт.')) return;
  try { await api('/users/' + id + '/delete-key', { method: 'POST' }); toast('ключ удалён'); openUser(id); } catch (e) { toast(e.message); }
}
async function delDevice(id, did) {
  if (!confirm('Удалить устройство? Его ссылка подписки перестанет работать.')) return;
  try { await api('/devices/' + did, { method: 'DELETE' }); toast('устройство удалено'); openUser(id); } catch (e) { toast(e.message); }
}
async function grantDays(id) {
  const days = parseInt(document.getElementById('u_days').value, 10);
  if (!days) return toast('введи число дней');
  try { await api('/users/' + id + '/grant-days', { method: 'POST', body: JSON.stringify({ days }) }); toast('готово'); openUser(id); } catch (e) { toast(e.message); }
}
async function addDevice(id) { try { await api('/users/' + id + '/devices', { method: 'POST', body: JSON.stringify({}) }); openUser(id); } catch (e) { toast(e.message); } }

// ── ТЕКСТЫ И КНОПКИ ──────────────────────────────────────────────────────────
RENDER.texts = async function () {
  const el = document.getElementById('tab-texts');
  el.innerHTML = '<div class="card mut">загрузка…</div>';
  try {
    const d = await api('/settings/texts');
    el.innerHTML = '<div class="card"><b>Тексты и кнопки бота</b>'
      + '<div class="mut">Поля всегда показывают актуальный текст. Плейсхолдеры: {brand}, {support}, {expire}, {days}. '
      + 'Премиум-эмодзи в кнопках Telegram не поддерживает; для богатых сообщений используй рассылку через бота.</div>'
      + d.texts.map((t) => {
        const field = t.kind === 'button'
          ? `<input id="t_${esc(t.key)}" value="${esc(t.value)}">`
          : `<textarea id="t_${esc(t.key)}">${esc(t.value)}</textarea>`;
        return `<div style="border-top:1px solid var(--line);padding-top:10px;margin-top:10px">`
          + `<label class="fld">${esc(t.title)} ${t.isCustom ? '<span class="pill">изменено</span>' : '<span class="pill">по умолчанию</span>'}`
          + `${t.premium ? ' <span class="pill">возможна премиум-версия через бота</span>' : ''}</label>${field}`
          + `<div class="row"><button class="btn sm" onclick="saveText('${esc(t.key)}')">Сохранить</button>`
          + `<button class="btn sec sm" onclick="resetText('${esc(t.key)}')">Сбросить к дефолту</button></div></div>`;
      }).join('') + '</div>'
      + '<div class="card" id="btns_card"><b>Кнопки бота (свои)</b><div class="mut">Добавь свою кнопку: ссылку или показ текста. Появится в меню бота.</div><div id="btns_list"></div>'
      + '<div class="row" style="margin-top:8px"><input id="cb_text" placeholder="Текст кнопки" class="grow"><select id="cb_action"><option value="url">Ссылка</option><option value="text">Показать текст</option></select></div>'
      + '<input id="cb_value" placeholder="URL или текст сообщения"><div style="margin-top:6px"><button class="btn sm" onclick="addBtn()">Добавить кнопку</button></div></div>';
    renderBtns();
  } catch (e) { el.innerHTML = '<div class="card">' + esc(e.message) + '</div>'; }
};
let BTNS = [];
async function renderBtns() {
  try { BTNS = await api('/settings/buttons'); } catch { BTNS = []; }
  const box = document.getElementById('btns_list'); if (!box) return;
  box.innerHTML = BTNS.length ? BTNS.map((b, i) => `<div class="row" style="border-top:1px solid var(--line);padding-top:8px;margin-top:8px"><div class="grow">${esc(b.text)} <span class="pill">${b.action === 'url' ? 'ссылка' : 'текст'}</span> <span class="mut">${esc((b.value || '').slice(0, 40))}</span></div><button class="btn bad sm" onclick="delBtn(${i})">×</button></div>`).join('') : '<div class="mut">пока нет своих кнопок</div>';
}
async function addBtn() {
  const b = { text: document.getElementById('cb_text').value.trim(), action: document.getElementById('cb_action').value, value: document.getElementById('cb_value').value.trim() };
  if (!b.text || !b.value) return toast('заполни текст и значение');
  BTNS.push(b);
  try { await api('/settings/buttons', { method: 'PUT', body: JSON.stringify({ buttons: BTNS }) }); toast('кнопка добавлена'); document.getElementById('cb_text').value = ''; document.getElementById('cb_value').value = ''; renderBtns(); } catch (e) { toast(e.message); }
}
async function delBtn(i) { BTNS.splice(i, 1); try { await api('/settings/buttons', { method: 'PUT', body: JSON.stringify({ buttons: BTNS }) }); renderBtns(); } catch (e) { toast(e.message); } }
async function saveText(key) {
  const val = document.getElementById('t_' + key).value;
  try { await api('/settings/texts/' + encodeURIComponent(key), { method: 'PUT', body: JSON.stringify({ value: val }) }); toast('сохранено'); RENDER.texts(); } catch (e) { toast(e.message); }
}
async function resetText(key) {
  try { await api('/settings/texts/' + encodeURIComponent(key) + '/reset', { method: 'POST' }); toast('сброшено'); RENDER.texts(); } catch (e) { toast(e.message); }
}

// ── ТАРИФЫ ───────────────────────────────────────────────────────────────────
RENDER.plans = async function () {
  const el = document.getElementById('tab-plans');
  el.innerHTML = '<div class="card"><b>Новый тариф</b>'
    + '<div class="row"><input id="pl_title" placeholder="Название (1 месяц)" class="grow"><input id="pl_days" type="number" placeholder="дней" style="max-width:90px"><input id="pl_price" type="number" placeholder="цена ₽" style="max-width:100px"><input id="pl_dev" type="number" placeholder="устройств (0=∞)" style="max-width:130px"></div>'
    + '<div style="margin-top:8px"><button class="btn" onclick="addPlan()">Создать тариф</button></div></div>'
    + '<div class="card"><b>Тарифы</b><div id="pl_list" class="mut">загрузка…</div></div>';
  try {
    const list = await api('/plans/all');
    document.getElementById('pl_list').innerHTML = list.length ? '<table><tr><th>Тариф</th><th>Дней</th><th>Цена</th><th>Устройств</th><th></th></tr>'
      + list.map(p => `<tr><td>${esc(p.title)} ${p.isActive ? '' : '<span class="pill">выкл</span>'}</td><td class="mut">${p.days}</td>`
        + `<td class="mut">${p.price} ₽</td><td class="mut">${p.deviceLimit || '∞'}</td>`
        + `<td class="row"><button class="btn sec sm" onclick="togglePlan('${p.id}',${!p.isActive})">${p.isActive ? 'выкл' : 'вкл'}</button>`
        + `<button class="btn bad sm" onclick="delPlan('${p.id}')">×</button></td></tr>`).join('') + '</table>'
      : '<span class="mut">тарифов нет</span>';
  } catch (e) { document.getElementById('pl_list').textContent = e.message; }
};
async function addPlan() {
  const body = { title: document.getElementById('pl_title').value.trim(), days: +document.getElementById('pl_days').value, price: +document.getElementById('pl_price').value, deviceLimit: +document.getElementById('pl_dev').value || 0 };
  if (!body.title || !body.days || !body.price) return toast('заполни название, дни, цену');
  try { await api('/plans', { method: 'POST', body: JSON.stringify(body) }); toast('тариф создан'); RENDER.plans(); } catch (e) { toast(e.message); }
}
async function togglePlan(id, active) { try { await api('/plans/' + id, { method: 'PATCH', body: JSON.stringify({ isActive: active }) }); RENDER.plans(); } catch (e) { toast(e.message); } }
async function delPlan(id) { if (!confirm('Удалить тариф?')) return; try { await api('/plans/' + id, { method: 'DELETE' }); RENDER.plans(); } catch (e) { toast(e.message); } }

// ── ПРОМОКОДЫ ────────────────────────────────────────────────────────────────
RENDER.promo = async function () {
  const el = document.getElementById('tab-promo');
  el.innerHTML = '<div class="card"><b>Новый промокод</b>'
    + '<div class="row"><input id="pm_code" placeholder="Код (WELCOME)" class="grow"><select id="pm_type"><option value="days">дни</option><option value="bypass_gb">ГБ обхода</option><option value="balance">баланс ₽</option></select><input id="pm_val" type="number" placeholder="значение" style="max-width:110px"><input id="pm_max" type="number" placeholder="исп." style="max-width:80px"></div>'
    + '<div style="margin-top:8px"><button class="btn" onclick="addPromo()">Создать промокод</button></div></div>'
    + '<div class="card"><b>Промокоды</b><div id="pm_list" class="mut">загрузка…</div></div>';
  try {
    const list = await api('/promo');
    document.getElementById('pm_list').innerHTML = list.length ? '<table><tr><th>Код</th><th>Тип</th><th>Значение</th><th>Использовано</th><th></th></tr>'
      + list.map(p => `<tr><td><code>${esc(p.code)}</code></td><td class="mut">${p.type}</td><td class="mut">${p.value}</td><td class="mut">${p.usedCount}/${p.maxUses}</td><td><button class="btn sec sm" onclick="editPromo('${p.id}',${p.value},${p.maxUses})">изм.</button> <button class="btn bad sm" onclick="delPromo('${p.id}')">×</button></td></tr>`).join('') + '</table>'
      : '<span class="mut">нет промокодов</span>';
  } catch (e) { document.getElementById('pm_list').textContent = e.message; }
};
async function addPromo() {
  const body = { code: document.getElementById('pm_code').value.trim(), type: document.getElementById('pm_type').value, value: +document.getElementById('pm_val').value, maxUses: +document.getElementById('pm_max').value || 1 };
  if (!body.code || !body.value) return toast('заполни код и значение');
  try { await api('/promo', { method: 'POST', body: JSON.stringify(body) }); toast('промокод создан'); RENDER.promo(); } catch (e) { toast(e.message); }
}
async function delPromo(id) { if (!confirm('Удалить промокод?')) return; try { await api('/promo/' + id, { method: 'DELETE' }); RENDER.promo(); } catch (e) { toast(e.message); } }
async function editPromo(id, value, maxUses) {
  const v = prompt('Значение промокода:', value);
  if (v === null) return;
  const m = prompt('Макс. использований:', maxUses);
  if (m === null) return;
  try { await api('/promo/' + id, { method: 'PATCH', body: JSON.stringify({ value: Number(v), maxUses: Number(m) }) }); toast('промокод изменён'); RENDER.promo(); } catch (e) { toast(e.message); }
}

// ── ПОДАРКИ ──────────────────────────────────────────────────────────────────
RENDER.gifts = async function () {
  const el = document.getElementById('tab-gifts');
  el.innerHTML = '<div class="card"><b>Выпустить подарочные коды</b>'
    + '<div class="mut">Код на N дней подписки. Клиент активирует его в боте (кнопка «🎁 Промокод»). Можно выпустить сразу пачку.</div>'
    + '<div class="row" style="margin-top:8px"><input id="gf_days" type="number" placeholder="дней" style="max-width:110px"><input id="gf_count" type="number" placeholder="сколько кодов" value="1" style="max-width:150px"><input id="gf_code" placeholder="свой код (необязательно)" class="grow"></div>'
    + '<div style="margin-top:8px"><button class="btn" onclick="addGift()">Выпустить</button></div></div>'
    + '<div class="card"><b>Подарочные коды</b><div id="gf_list" class="mut">загрузка…</div></div>';
  try {
    const list = await api('/gifts');
    document.getElementById('gf_list').innerHTML = list.length ? '<table><tr><th>Код</th><th>Дней</th><th>Статус</th><th></th></tr>'
      + list.map(g => `<tr><td><code>${esc(g.code)}</code></td><td class="mut">${g.days}</td><td>${g.redeemedBy ? '<span class="pill">активирован</span>' : '<span class="pill ok">активен</span>'}</td><td>${g.redeemedBy ? '' : `<button class="btn bad sm" onclick="delGift('${g.id}')">×</button>`}</td></tr>`).join('') + '</table>'
      : '<span class="mut">нет подарочных кодов</span>';
  } catch (e) { document.getElementById('gf_list').textContent = e.message; }
};
async function addGift() {
  const body = { days: +document.getElementById('gf_days').value, count: +document.getElementById('gf_count').value || 1, code: document.getElementById('gf_code').value.trim() };
  if (!body.days) return toast('укажи количество дней');
  if (body.code) delete body.count; // свой код — только один
  try { const r = await api('/gifts', { method: 'POST', body: JSON.stringify(body) }); toast('выпущено кодов: ' + (r.length || 0)); RENDER.gifts(); } catch (e) { toast(e.message); }
}
async function delGift(id) { if (!confirm('Удалить подарочный код?')) return; try { await api('/gifts/' + id, { method: 'DELETE' }); RENDER.gifts(); } catch (e) { toast(e.message); } }

// ── ПРОМО-ГРУППЫ ─────────────────────────────────────────────────────────────
RENDER.promogroups = async function () {
  const el = document.getElementById('tab-promogroups');
  el.innerHTML = '<div class="card"><b>Новая промо-группа</b>'
    + '<div class="mut">Сегмент клиентов с фиксированной скидкой на оплату и продление. Клиентов добавляйте во вкладке «Клиенты»: выделите галочками → «🎯 назначить».</div>'
    + '<div class="row" style="margin-top:8px"><input id="pg_name" placeholder="Название (VIP, Друзья…)" class="grow"><input id="pg_disc" type="number" placeholder="скидка %" style="max-width:120px"></div>'
    + '<div style="margin-top:8px"><button class="btn" onclick="addPromoGroup()">Создать группу</button></div></div>'
    + '<div class="card"><b>Промо-группы</b><div id="pg_list" class="mut">загрузка…</div></div>';
  try {
    const list = await api('/promo-groups');
    document.getElementById('pg_list').innerHTML = list.length ? '<table><tr><th>Название</th><th>Скидка</th><th>Клиентов</th><th></th></tr>'
      + list.map((g) => `<tr><td><b>${esc(g.name)}</b></td><td class="mut">−${g.discountPct}%</td><td class="mut">${g.members}</td><td><button class="btn sec sm" onclick='editPromoGroup(${JSON.stringify(g.id)},${JSON.stringify(g.name)},${g.discountPct})'>изм.</button> <button class="btn bad sm" onclick='delPromoGroup(${JSON.stringify(g.id)})'>×</button></td></tr>`).join('') + '</table>'
      : '<span class="mut">нет групп</span>';
  } catch (e) { document.getElementById('pg_list').textContent = e.message; }
};
async function addPromoGroup() {
  const body = { name: document.getElementById('pg_name').value.trim(), discountPct: +document.getElementById('pg_disc').value || 0 };
  if (!body.name) return toast('укажи название');
  try { await api('/promo-groups', { method: 'POST', body: JSON.stringify(body) }); toast('группа создана'); RENDER.promogroups(); } catch (e) { toast(e.message); }
}
async function editPromoGroup(id, name, disc) {
  const n = prompt('Название группы:', name); if (n === null) return;
  const d = prompt('Скидка, %:', disc); if (d === null) return;
  try { await api('/promo-groups/' + id, { method: 'PATCH', body: JSON.stringify({ name: n, discountPct: Number(d) }) }); toast('сохранено'); RENDER.promogroups(); } catch (e) { toast(e.message); }
}
async function delPromoGroup(id) { if (!confirm('Удалить группу? Клиенты останутся без скидки.')) return; try { await api('/promo-groups/' + id, { method: 'DELETE' }); RENDER.promogroups(); } catch (e) { toast(e.message); } }

// ── КАМПАНИИ (UTM) ───────────────────────────────────────────────────────────
RENDER.campaigns = async function () {
  const el = document.getElementById('tab-campaigns');
  el.innerHTML = '<div class="card"><b>Новая кампания</b>'
    + '<div class="mut">Метка для отслеживания воронки: клик по ссылке → регистрация в боте → оплата. Раздавайте ссылку в рекламе (VK, каналы, блогеры).</div>'
    + '<div class="row" style="margin-top:8px"><input id="cm_name" placeholder="Название (Реклама VK)" class="grow"><input id="cm_code" placeholder="метка VK1 (латиница)" style="max-width:170px"></div>'
    + '<label class="fld" style="margin-top:8px">S2S-postback URL партнёра <span class="mut">(необязательно)</span></label>'
    + '<input id="cm_pb" placeholder="https://partner.com/pb?clickid={sub_id}&event={event}&sum={payout}">'
    + '<div class="mut" style="font-size:11px;margin-top:4px">Макросы: <code>{event}</code> (reg/sale), <code>{sub_id}</code> (click id из ссылки <code>/c/КОД?sub=XXX</code>), <code>{payout}</code> (сумма оплаты), <code>{code}</code>. Дёргается при регистрации и оплате привязанного клиента.</div>'
    + '<div style="margin-top:8px"><button class="btn" onclick="addCampaign()">Создать</button></div></div>'
    + '<div class="card"><b>Кампании</b><div id="cm_list" class="mut">загрузка…</div></div>';
  try {
    const r = await api('/campaigns');
    const list = r.campaigns || [];
    if (!r.botUsername) el.querySelector('.card .mut').innerHTML += '<br><span style="color:var(--warn,#f0ad4e)">⚠ Бот не настроен — ссылки появятся после подключения бота.</span>';
    document.getElementById('cm_list').innerHTML = list.length ? '<table><tr><th>Кампания</th><th>Ссылка</th><th>Клики</th><th>Рег.</th><th>Оплат</th><th>Доход</th><th></th></tr>'
      + list.map((c) => {
        const cr = c.regs ? Math.round((c.paid / c.regs) * 100) : 0;
        const linkUrl = location.origin + '/c/' + c.code;
        return `<tr><td><b>${esc(c.name)}</b> <span class="mut">${esc(c.code)}</span>${c.postbackUrl ? ' <span class="pill">S2S</span>' : ''}</td>`
          + `<td>${c.link ? `<button class="btn sec sm" onclick='copyText(${JSON.stringify(linkUrl)})'>📋 ссылка</button>` : '<span class="mut">—</span>'}</td>`
          + `<td class="mut">${c.clicks}</td><td class="mut">${c.regs}</td><td class="mut">${c.paid} <span class="mut">(${cr}%)</span></td><td>${Number(c.revenue).toLocaleString('ru-RU')}₽</td>`
          + `<td><button class="btn bad sm" onclick='delCampaign(${JSON.stringify(c.id)})'>×</button></td></tr>`;
      }).join('') + '</table>'
      : '<span class="mut">нет кампаний</span>';
  } catch (e) { document.getElementById('cm_list').textContent = e.message; }
};
async function addCampaign() {
  const body = { name: document.getElementById('cm_name').value.trim(), code: document.getElementById('cm_code').value.trim(), postbackUrl: document.getElementById('cm_pb').value.trim() };
  if (!body.name) return toast('укажи название');
  try { await api('/campaigns', { method: 'POST', body: JSON.stringify(body) }); toast('кампания создана'); RENDER.campaigns(); } catch (e) { toast(e.message); }
}
async function delCampaign(id) { if (!confirm('Удалить кампанию? Привязка клиентов снимется.')) return; try { await api('/campaigns/' + id, { method: 'DELETE' }); RENDER.campaigns(); } catch (e) { toast(e.message); } }

// ── ВЫВОДЫ РЕФ-СРЕДСТВ ────────────────────────────────────────────────────────
let WD_STATUS = 'pending';
function wdBadge(s) { return s === 'paid' ? '<span class="pill ok">выплачено</span>' : s === 'rejected' ? '<span class="pill bad">отклонено</span>' : '<span class="pill warn">ожидает</span>'; }
function setWdStatus(s) { WD_STATUS = s; RENDER.withdrawals(); }
RENDER.withdrawals = async function () {
  const el = document.getElementById('tab-withdrawals');
  el.innerHTML = '<div class="card"><b>Заявки на вывод реф-средств</b>'
    + '<div class="mut" style="font-size:12px">Клиент копит реф-баланс деньгами (настройка «Реферал: ₽ за 1-ю оплату» в Бренде) и запрашивает вывод в боте. Выплати вручную по реквизитам и отметь «выплатил».</div>'
    + '<div class="row" style="gap:6px;margin:8px 0"><button class="btn sec sm" onclick="setWdStatus(\'pending\')">Ожидают</button><button class="btn sec sm" onclick="setWdStatus(\'paid\')">Выплачены</button><button class="btn sec sm" onclick="setWdStatus(\'\')">Все</button></div>'
    + '<div id="wd_list" class="mut">загрузка…</div></div>';
  try {
    const list = await api('/withdrawals' + (WD_STATUS ? '?status=' + WD_STATUS : ''));
    document.getElementById('wd_list').innerHTML = list.length ? '<table><tr><th>Клиент</th><th>Сумма</th><th>Реквизиты</th><th>Статус</th><th>Дата</th><th></th></tr>'
      + list.map((w) => `<tr><td>${esc(w.user?.tgName || w.user?.tgId || '—')}${w.user?.tgUsername ? ` <span class="mut">@${esc(w.user.tgUsername)}</span>` : ''}</td><td><b>${Number(w.amount)}₽</b></td><td class="mut">${esc(w.requisites)}</td><td>${wdBadge(w.status)}</td><td class="mut">${new Date(w.createdAt).toLocaleString()}</td><td>${w.status === 'pending' ? `<button class="btn sm" onclick="wdSet('${w.id}','paid')">✅ выплатил</button> <button class="btn bad sm" onclick="wdSet('${w.id}','rejected')">✕ отклонить</button>` : ''}</td></tr>`).join('') + '</table>'
      : '<span class="mut">нет заявок</span>';
  } catch (e) { document.getElementById('wd_list').textContent = e.message; }
};
async function wdSet(id, status) { if (status === 'rejected' && !confirm('Отклонить заявку? Деньги вернутся клиенту на реф-баланс.')) return; try { await api('/withdrawals/' + id + '/status', { method: 'POST', body: JSON.stringify({ status }) }); toast('готово'); RENDER.withdrawals(); } catch (e) { toast(e.message); } }

// ── ОПРОСЫ / КОНКУРСЫ ─────────────────────────────────────────────────────────
RENDER.polls = async function () {
  const el = document.getElementById('tab-polls');
  el.innerHTML = '<div class="card"><b>Новый опрос / конкурс</b>'
    + '<div class="mut" style="font-size:12px">Клиент голосует в боте один раз и получает награду (дни). Кнопка «📊 Опросы» появляется в боте, пока опрос активен.</div>'
    + '<label class="fld" style="margin-top:8px">Вопрос</label><input id="pl_q" placeholder="Какой сервер добавить следующим?">'
    + '<label class="fld">Варианты (по одному в строке, минимум 2)</label><textarea id="pl_opts" placeholder="🇯🇵 Япония&#10;🇰🇷 Корея&#10;🇸🇬 Сингапур"></textarea>'
    + '<div class="row" style="margin-top:8px"><input id="pl_reward" type="number" placeholder="награда, дней" style="max-width:160px"><button class="btn" onclick="addPoll()">Создать опрос</button></div></div>'
    + '<div class="card"><b>Опросы</b><div id="pl_list" class="mut">загрузка…</div></div>';
  try {
    const list = await api('/polls');
    document.getElementById('pl_list').innerHTML = list.length ? list.map((p) => {
      const total = p.options.reduce((s, o) => s + o.votes, 0);
      const bars = p.options.map((o) => { const pct = total ? Math.round((o.votes / total) * 100) : 0; return `<div style="margin:4px 0"><div class="row" style="justify-content:space-between"><span>${esc(o.text)}</span><span class="mut">${o.votes} · ${pct}%</span></div><div style="height:8px;background:#1b2740;border-radius:4px;overflow:hidden"><div style="height:100%;width:${Math.max(2, pct)}%;background:var(--acc,#22D3EE)"></div></div></div>`; }).join('');
      return `<div style="border-top:1px solid var(--line);padding-top:10px;margin-top:10px"><div class="row" style="justify-content:space-between"><b>${esc(p.question)}</b> <span>${p.isActive ? '<span class="pill ok">активен</span>' : '<span class="pill">завершён</span>'}</span></div><div class="mut" style="font-size:12px">награда ${p.rewardDays} дн. · проголосовало ${p._count.votes}</div>${bars}<div class="row" style="margin-top:6px"><button class="btn sec sm" onclick="togglePoll('${p.id}',${!p.isActive})">${p.isActive ? 'завершить' : 'активировать'}</button> <button class="btn bad sm" onclick="delPoll('${p.id}')">удалить</button></div></div>`;
    }).join('') : '<span class="mut">нет опросов</span>';
  } catch (e) { document.getElementById('pl_list').textContent = e.message; }
};
async function addPoll() {
  const options = document.getElementById('pl_opts').value.split('\n').map((s) => s.trim()).filter(Boolean);
  const body = { question: document.getElementById('pl_q').value.trim(), options, rewardDays: +document.getElementById('pl_reward').value || 0 };
  if (!body.question) return toast('укажи вопрос');
  if (options.length < 2) return toast('нужно минимум 2 варианта');
  try { await api('/polls', { method: 'POST', body: JSON.stringify(body) }); toast('опрос создан'); RENDER.polls(); } catch (e) { toast(e.message); }
}
async function togglePoll(id, active) { try { await api('/polls/' + id, { method: 'PATCH', body: JSON.stringify({ isActive: active }) }); RENDER.polls(); } catch (e) { toast(e.message); } }
async function delPoll(id) { if (!confirm('Удалить опрос?')) return; try { await api('/polls/' + id, { method: 'DELETE' }); RENDER.polls(); } catch (e) { toast(e.message); } }

// ── ПЛАТЁЖКИ ─────────────────────────────────────────────────────────────────
RENDER.payments = async function () {
  const el = document.getElementById('tab-payments');
  el.innerHTML = '<div class="card mut">загрузка…</div>';
  try {
    const [list, stars] = await Promise.all([api('/payments/providers'), api('/payments/stars').catch(() => ({ enabled: false, rubPerStar: 2 }))]);
    const starsCard = '<div class="card"><b>⭐ Telegram Stars</b>'
      + '<div class="mut">Нативная оплата звёздами прямо в Telegram (без внешней платёжки и ключей). Курс — сколько рублей в одной звезде (цена тарифа делится на него).</div>'
      + `<div class="row" style="margin-top:8px"><label class="pill"><input type="checkbox" id="st_en" ${stars.enabled ? 'checked' : ''} style="width:auto;margin:0 6px 0 0">включить</label>`
      + `<input id="st_rate" type="number" step="0.1" value="${stars.rubPerStar}" placeholder="₽ за звезду" style="max-width:150px"></div>`
      + '<button class="btn sm" style="margin-top:8px" onclick="saveStars()">Сохранить</button></div>';
    el.innerHTML = starsCard + '<div class="card"><b>Платёжные системы</b><div class="mut">Включи нужные и впиши ключи. '
      + 'Для СБП (NSPK) — ЮKassa/Platega. Богатых интеграций не трогай без сверки с докой платёжки.</div>'
      + list.map((p) => `<div style="border-top:1px solid var(--line);padding-top:10px;margin-top:10px">`
        + `<label class="fld">${esc(p.title)} ${p.enabled ? '<span class="pill ok">вкл</span>' : '<span class="pill">выкл</span>'} <span class="mut">(${(p.kinds || []).join(', ')})</span></label>`
        + `<div class="row"><label class="pill"><input type="checkbox" id="pe_${p.id}" ${p.enabled ? 'checked' : ''} style="width:auto;margin:0 6px 0 0">включить</label></div>`
        + p.requiredKeys.map((k) => `<input id="pk_${p.id}_${k}" placeholder="${esc(k)}">`).join('')
        + (p.supportsRecurrent ? `<div class="row"><label class="pill" title="Сохранять карту клиента и автопродлевать без его участия"><input type="checkbox" id="pr_${p.id}" ${p.recurrent ? 'checked' : ''} style="width:auto;margin:0 6px 0 0">рекуррент (автосписание с карты)</label></div>` : '')
        + `<button class="btn sm" onclick="savePay('${p.id}', ${JSON.stringify(p.requiredKeys).replace(/"/g, '&quot;')})">Сохранить</button></div>`).join('') + '</div>';
  } catch (e) { el.innerHTML = '<div class="card">' + esc(e.message) + '</div>'; }
};
async function saveStars() {
  const body = { enabled: document.getElementById('st_en').checked, rubPerStar: Number(document.getElementById('st_rate').value) || 2 };
  try { await api('/payments/stars', { method: 'PUT', body: JSON.stringify(body) }); toast('сохранено'); RENDER.payments(); } catch (e) { toast(e.message); }
}
async function savePay(id, keys) {
  const body = { enabled: document.getElementById('pe_' + id).checked };
  keys.forEach((k) => { const v = document.getElementById('pk_' + id + '_' + k).value; if (v) body[k] = v; });
  const rec = document.getElementById('pr_' + id);
  if (rec) body.recurrent = rec.checked ? '1' : '0';
  try { await api('/settings/pay/' + id, { method: 'PUT', body: JSON.stringify(body) }); toast('сохранено'); RENDER.payments(); } catch (e) { toast(e.message); }
}

// ── РАССЫЛКА ─────────────────────────────────────────────────────────────────
RENDER.broadcast = async function () {
  const el = document.getElementById('tab-broadcast');
  el.innerHTML = '<div class="card"><b>Рассылка</b>'
    + '<div class="mut">Обычный текст — впиши ниже. Для премиум-эмодзи/медиа: отправь сообщение своему боту, '
    + 'узнай его message_id и chat_id, вставь в «копию» — бот разошлёт копию всем (премиум-эмодзи сохранятся).</div>'
    + '<label class="fld">Текст (HTML)</label><textarea id="b_text" placeholder="Привет! Акция…"></textarea>'
    + '<button class="btn" onclick="startBroadcast(false)">Разослать текст</button>'
    + '<div style="border-top:1px solid var(--line);margin:14px 0;padding-top:10px"><b>Копия сообщения (с премиум-эмодзи)</b>'
    + '<div class="row"><input id="b_chat" placeholder="from_chat_id (ваш id)" class="grow"><input id="b_mid" placeholder="message_id" class="grow"></div>'
    + '<button class="btn" onclick="startBroadcast(true)">Разослать копию</button></div>'
    + '<div id="b_status" class="mut" style="margin-top:10px"></div></div>';
  pollBroadcast();
};
async function startBroadcast(copy) {
  let body;
  if (copy) {
    body = { fromChatId: document.getElementById('b_chat').value.trim(), messageId: parseInt(document.getElementById('b_mid').value, 10) };
    if (!body.fromChatId || !body.messageId) return toast('нужны from_chat_id и message_id');
  } else {
    body = { text: document.getElementById('b_text').value };
    if (!body.text.trim()) return toast('впиши текст');
  }
  try { const r = await api('/broadcast', { method: 'POST', body: JSON.stringify(body) }); toast('старт: ' + r.total + ' получателей'); pollBroadcast(); } catch (e) { toast(e.message); }
}
async function pollBroadcast() {
  try {
    const s = await api('/broadcast/status');
    const box = document.getElementById('b_status');
    if (!box) return;
    box.innerHTML = s.startedAt ? `Отправлено ${s.sent}/${s.total} (ошибок ${s.failed}) ${s.running ? '⏳ идёт…' : '✅ готово'}` : 'рассылок ещё не было';
    if (s.running) setTimeout(pollBroadcast, 2000);
  } catch (e) { /* тихо */ }
}

// ── ФРАНШИЗЫ (опционально) ───────────────────────────────────────────────────
RENDER.tenants = async function () {
  const el = document.getElementById('tab-tenants');
  el.innerHTML = '<div class="card"><b>Новая франшиза</b>'
    + '<div class="mut">Опционально. Если франшиз нет — панель работает как одиночная. У франшизы свой бренд, бот и домен, клиенты изолированы.</div>'
    + '<div class="row"><input id="f_brand" placeholder="Бренд (название)" class="grow"><input id="f_bot" placeholder="Токен бота (опц.)" class="grow"></div>'
    + '<div class="row"><input id="f_domain" placeholder="домен (опц.)" class="grow"><input id="f_owner" placeholder="Telegram id владельца (опц.)" class="grow"></div>'
    + '<div class="row"><input id="f_share" type="number" placeholder="доля франшизы %" class="grow"><input id="f_price" type="number" placeholder="цена/мес" class="grow"></div>'
    + '<div style="margin-top:8px"><button class="btn" onclick="addTenant()">Создать франшизу</button></div></div>'
    + '<div class="card"><b>Франшизы</b><div id="f_list" class="mut">загрузка…</div></div>'
    + '<div class="card"><b>Финансы и выплаты</b><div id="f_finance" class="mut">загрузка…</div></div>';
  try {
    const list = await api('/tenants');
    document.getElementById('f_list').innerHTML = list.length ? '<table><tr><th>Бренд</th><th>Домен</th><th>Клиентов</th><th>Доля</th><th></th></tr>'
      + list.map((t) => `<tr><td>${esc(t.brand)} ${t.isActive ? '' : '<span class="pill bad">выкл</span>'}</td>`
        + `<td class="mut">${t.domain ? esc(t.domain) + (t.domainVerified ? ' <span class="pill ok">HTTPS</span>' : ' <span class="pill">не подтв.</span>') : '—'}</td>`
        + `<td class="mut">${t._count ? t._count.users : 0}</td><td class="mut">${t.sharePercent}%</td>`
        + `<td class="row"><button class="btn sec sm" onclick="editTenant('${t.id}')">изм.</button>`
        + `<button class="btn bad sm" onclick="delTenant('${t.id}')">×</button></td></tr>`).join('') + '</table>'
      : '<span class="mut">франшиз нет (панель одиночная)</span>';
  } catch (e) { document.getElementById('f_list').textContent = e.message; }
  // финансы/выплаты франшиз
  try {
    const f = await api('/tenants/finance');
    const box = document.getElementById('f_finance');
    if (!box) return;
    const money = (v) => Number(v).toLocaleString('ru-RU') + '₽';
    box.innerHTML = f.rows.length ? '<table><tr><th>Бренд</th><th>Клиентов</th><th>Получено</th><th>За 30д</th><th>Доля фр.</th><th>Франшизе</th><th>Платформе</th></tr>'
      + f.rows.map((r) => `<tr><td>${esc(r.brand)}</td><td class="mut">${r.users}</td><td>${money(r.revenue)}</td>`
        + `<td class="mut">${money(r.revenueMonth)}</td><td class="mut">${r.sharePercent}%</td>`
        + `<td><b>${money(r.franchiseEarn)}</b></td><td class="mut">${money(r.platformEarn)}</td></tr>`).join('')
      + `<tr><td colspan="5" style="text-align:right"><b>Итого к выплате:</b></td><td><b>${money(f.totals.franchise)}</b></td><td class="mut">${money(f.totals.platform)}</td></tr>`
      + '</table><div class="mut" style="font-size:12px;margin-top:6px">«Франшизе» — сколько заработала франшиза со своей доли; «Платформе» — ваша часть. Оплата с баланса клиента не задваивает доход.</div>'
      : '<span class="mut">нет данных</span>';
  } catch (e) { /* тихо */ }
};
async function addTenant() {
  const body = {
    brand: document.getElementById('f_brand').value.trim(),
    botToken: document.getElementById('f_bot').value.trim() || undefined,
    domain: document.getElementById('f_domain').value.trim() || undefined,
    ownerTgId: parseInt(document.getElementById('f_owner').value, 10) || undefined,
    sharePercent: parseInt(document.getElementById('f_share').value, 10) || undefined,
    pricePerMonth: parseFloat(document.getElementById('f_price').value) || undefined,
  };
  if (!body.brand) return toast('впиши бренд');
  try { await api('/tenants', { method: 'POST', body: JSON.stringify(body) }); toast('франшиза создана'); RENDER.tenants(); } catch (e) { toast(e.message); }
}
async function editTenant(id) {
  const brand = prompt('Новый бренд (пусто — не менять):');
  const domain = prompt('Домен (пусто — не менять):');
  const body = {};
  if (brand) body.brand = brand;
  if (domain) body.domain = domain;
  if (!Object.keys(body).length) return;
  try { await api('/tenants/' + id, { method: 'PATCH', body: JSON.stringify(body) }); toast('сохранено'); RENDER.tenants(); } catch (e) { toast(e.message); }
}
async function delTenant(id) { if (!confirm('Удалить франшизу?')) return; try { await api('/tenants/' + id, { method: 'DELETE' }); RENDER.tenants(); } catch (e) { toast(e.message); } }

// ── БРЕНД ────────────────────────────────────────────────────────────────────
RENDER.brand = async function () {
  const el = document.getElementById('tab-brand');
  try {
    const d = await api('/settings/texts');
    const flags = await api('/settings/flags');
    el.innerHTML = '<div class="card"><b>Бренд</b><div class="mut">Подставляется в тексты вместо {brand}/{support}. Никакого хардкода.</div>'
      + `<label class="fld">Название бренда</label><input id="br_name" value="${esc(d.brand)}">`
      + `<label class="fld">Контакт поддержки</label><input id="br_sup" value="${esc(d.support)}">`
      + '<div style="margin-top:10px"><button class="btn" onclick="saveBrand()">Сохранить бренд</button></div></div>'
      + '<div class="card"><b>Настройки</b><div class="mut">Обязательная подписка, согласие, триал, реф-бонусы, токен бота. Тумблеры: 1=вкл, 0=выкл.</div>'
      + flags.map(f => `<label class="fld">${esc(f.title)}</label><div class="row"><input id="fl_${esc(f.key)}" value="${esc(f.value)}" class="grow"><button class="btn sm" onclick="saveFlag('${esc(f.key)}')">OK</button></div>`).join('')
      + '</div>'
      + '<div class="card"><b>Маршрутизация — свои сайты</b><div class="mut">Добавь домены (по одному в строку). Применяется в умном конфиге. Напрямую = мимо VPN; Блок = не открывать; Через VPN = принудительно через сервер.</div>'
      + `<label class="fld">Напрямую (мимо VPN)</label><textarea id="rt_direct" placeholder="example.ru\nmybank.ru"></textarea>`
      + `<label class="fld">Блокировать</label><textarea id="rt_block" placeholder="ads.example.com"></textarea>`
      + `<label class="fld">Через VPN (принудительно)</label><textarea id="rt_proxy" placeholder="instagram.com"></textarea>`
      + '<div style="margin-top:8px"><button class="btn" onclick="saveRouting()">Сохранить маршрутизацию</button></div></div>';
    try { const rt = await api('/settings/routing'); document.getElementById('rt_direct').value = rt.direct || ''; document.getElementById('rt_block').value = rt.block || ''; document.getElementById('rt_proxy').value = rt.proxy || ''; } catch (e) {}
  } catch (e) { el.innerHTML = '<div class="card">' + esc(e.message) + '</div>'; }
};
async function saveRouting() {
  const body = { direct: document.getElementById('rt_direct').value, block: document.getElementById('rt_block').value, proxy: document.getElementById('rt_proxy').value };
  try { await api('/settings/routing', { method: 'PUT', body: JSON.stringify(body) }); toast('маршрутизация сохранена'); } catch (e) { toast(e.message); }
}
async function saveFlag(key) {
  const v = document.getElementById('fl_' + key).value;
  try { await api('/settings/flag/' + encodeURIComponent(key), { method: 'PUT', body: JSON.stringify({ value: v }) }); toast('сохранено'); } catch (e) { toast(e.message); }
}
async function saveBrand() {
  try { await api('/settings/brand', { method: 'PUT', body: JSON.stringify({ brand: document.getElementById('br_name').value, support: document.getElementById('br_sup').value }) }); toast('сохранено'); } catch (e) { toast(e.message); }
}

// ── АУДИТ ────────────────────────────────────────────────────────────────────
RENDER.audit = async function () {
  const el = document.getElementById('tab-audit');
  el.innerHTML = '<div class="card"><b>Аудит действий</b><div class="mut">Кто и что менял в админке (секреты скрыты).</div><div id="a_list" class="mut" style="margin-top:8px">загрузка…</div></div>';
  try {
    const rows = await api('/audit');
    document.getElementById('a_list').innerHTML = rows.length ? '<table><tr><th>Когда</th><th>Действие</th><th>IP</th><th>Данные</th></tr>'
      + rows.map((r) => `<tr><td class="mut">${new Date(r.createdAt).toLocaleString()}</td><td>${esc(r.action)}</td>`
        + `<td class="mut">${esc(r.ip || '')}</td><td class="mut">${esc(r.meta || '')}</td></tr>`).join('') + '</table>'
      : '<span class="mut">пока пусто</span>';
  } catch (e) { document.getElementById('a_list').textContent = e.message; }
};

// ── boot ─────────────────────────────────────────────────────────────────────
if (TOKEN) showApp();
