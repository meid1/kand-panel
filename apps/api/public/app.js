// VPanel admin — vanilla JS, без сборки. Работает на статике, ходит в /api с JWT.
const API = '/api';
let TOKEN = localStorage.getItem('vp_token') || '';

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
  const data = txt ? JSON.parse(txt) : {};
  if (!r.ok) throw new Error(data.message || ('HTTP ' + r.status));
  return data;
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
function showApp() {
  document.getElementById('login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  switchTab('nodes');
}

// ── tabs ─────────────────────────────────────────────────────────────────────
const RENDER = {};
function switchTab(name) {
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('main > div').forEach((d) => d.classList.add('hidden'));
  document.getElementById('tab-' + name).classList.remove('hidden');
  RENDER[name] && RENDER[name]();
}
document.querySelectorAll('nav button').forEach((b) => b.onclick = () => switchTab(b.dataset.tab));

// ── НОДЫ ─────────────────────────────────────────────────────────────────────
const PROTOS = ['reality-tcp', 'reality-grpc', 'hysteria2', 'xhttp'];
RENDER.nodes = async function () {
  const el = document.getElementById('tab-nodes');
  el.innerHTML = '<div class="card"><b>Добавить ноду</b>'
    + '<label class="fld">Название</label><input id="n_label" placeholder="🇳🇱 Нидерланды-1">'
    + '<div class="row"><div class="grow"><label class="fld">Хост/домен (для клиентов)</label><input id="n_addr" placeholder="nl1.example.com"></div>'
    + '<div class="grow"><label class="fld">IP сервера</label><input id="n_ip" placeholder="1.2.3.4"></div></div>'
    + '<label class="fld">Протоколы</label><div class="row" id="n_protos">'
    + PROTOS.map((p) => `<label class="pill"><input type="checkbox" value="${p}" ${p.startsWith('reality') ? 'checked' : ''} style="width:auto;margin:0 6px 0 0"> ${p}</label>`).join('')
    + '</div><label class="fld">Роль ноды</label><select id="n_role">'
    + '<option value="exit">Обычный выход (VPN)</option>'
    + '<option value="yt-ru">YouTube-РФ (без рекламы)</option>'
    + '<option value="bypass-origin">Origin для обхода</option></select>'
    + '<div style="margin-top:10px"><button class="btn" onclick="addNode()">Создать и получить команду</button></div>'
    + '<div id="n_install"></div></div><div class="card"><b>Ноды</b><div id="n_list" class="mut">загрузка…</div></div>';
  try {
    const nodes = await api('/nodes');
    document.getElementById('n_list').innerHTML = nodes.length ? '<table><tr><th>Нода</th><th>Хост</th><th>Протоколы</th><th></th></tr>'
      + nodes.map((n) => `<tr><td>${esc(n.label)} ${n.isActive ? '<span class="pill ok">вкл</span>' : '<span class="pill bad">выкл</span>'} ${n.online ? '<span class="pill ok">online</span>' : ''}</td>`
        + `<td class="mut">${esc(n.address)}<br>${esc(n.ip)}</td><td class="mut">${(n.protocols || []).join(', ')}</td>`
        + `<td class="row"><button class="btn sec sm" onclick="toggleNode('${n.id}',${!n.isActive})">${n.isActive ? 'выкл' : 'вкл'}</button>`
        + `<button class="btn bad sm" onclick="delNode('${n.id}')">×</button></td></tr>`).join('') + '</table>'
      : '<span class="mut">пока нет нод</span>';
  } catch (e) { document.getElementById('n_list').textContent = e.message; }
};
async function addNode() {
  const protocols = [...document.querySelectorAll('#n_protos input:checked')].map((i) => i.value);
  const body = {
    label: document.getElementById('n_label').value.trim(),
    address: document.getElementById('n_addr').value.trim(),
    ip: document.getElementById('n_ip').value.trim(),
    protocols,
    role: document.getElementById('n_role').value,
  };
  if (!body.label || !body.address || !body.ip || !protocols.length) return toast('заполни все поля и протоколы');
  try {
    const r = await api('/nodes', { method: 'POST', body: JSON.stringify(body) });
    document.getElementById('n_install').innerHTML =
      '<label class="fld">Команда установки (выполни на сервере ноды):</label><code>' + esc(r.install) + '</code>';
    toast('нода создана'); RENDER.nodes();
  } catch (e) { toast(e.message); }
}
async function toggleNode(id, active) { try { await api('/nodes/' + id, { method: 'PATCH', body: JSON.stringify({ isActive: active }) }); RENDER.nodes(); } catch (e) { toast(e.message); } }
async function delNode(id) { if (!confirm('Удалить ноду?')) return; try { await api('/nodes/' + id, { method: 'DELETE' }); RENDER.nodes(); } catch (e) { toast(e.message); } }

// ── КЛИЕНТЫ ──────────────────────────────────────────────────────────────────
RENDER.users = async function () {
  const el = document.getElementById('tab-users');
  el.innerHTML = '<div class="card"><b>Клиенты</b><div id="u_list" class="mut">загрузка…</div></div><div id="u_card"></div>';
  try {
    const users = await api('/users');
    document.getElementById('u_list').innerHTML = users.length ? '<table><tr><th>Клиент</th><th>Тариф до</th><th>Устройств</th><th></th></tr>'
      + users.map((u) => `<tr><td>${esc(u.tgName || u.tgUsername || u.tgId)} <span class="mut">${u.tenant ? esc(u.tenant.brand) : ''}</span></td>`
        + `<td class="mut">${u.expireAt ? new Date(u.expireAt).toLocaleDateString() : '—'}</td><td class="mut">${(u.devices || []).length}</td>`
        + `<td><button class="btn sec sm" onclick="openUser('${u.id}')">открыть</button></td></tr>`).join('') + '</table>'
      : '<span class="mut">нет клиентов</span>';
  } catch (e) { document.getElementById('u_list').textContent = e.message; }
};
async function openUser(id) {
  try {
    const u = await api('/users/' + id);
    let bp = null; try { bp = await api('/bypass/' + id); } catch (e) { /* нет данных */ }
    const bpLine = bp ? (bp.unlimited ? 'Обход: безлимит'
      : `Обход: ${bp.remainingGb != null ? bp.remainingGb.toFixed(1) : '?'} ГБ осталось (из ${bp.capGb.toFixed(1)}, использовано ${bp.usedGb.toFixed(1)})${bp.suspended ? ' — 🚫 ИСЧЕРПАН' : ''}`) : '';
    const devs = (u.devices || []).map((d) => `<tr><td>${esc(d.name)}</td><td class="mut">${esc(d.subToken.slice(0, 10))}…</td>`
      + `<td><code>/sub/${esc(d.subToken)}</code></td></tr>`).join('');
    document.getElementById('u_card').innerHTML = '<div class="card"><b>' + esc(u.tgName || u.tgId) + '</b>'
      + `<div class="mut">tenant: ${u.tenant ? esc(u.tenant.brand) : '—'} · до ${u.expireAt ? new Date(u.expireAt).toLocaleString() : '—'}</div>`
      + '<div class="row" style="margin:10px 0"><input id="u_days" type="number" placeholder="дней (+/−)" style="max-width:140px">'
      + `<button class="btn sm" onclick="grantDays('${id}')">начислить/списать дни</button></div>`
      + `<div class="mut" style="margin:6px 0">${esc(bpLine)}</div>`
      + '<div class="row" style="margin:0 0 10px"><input id="u_gb" type="number" placeholder="ГБ обхода" style="max-width:130px">'
      + `<button class="btn sm" onclick="bypassGb('${id}',true)">+ докупить</button>`
      + `<button class="btn sec sm" onclick="bypassGb('${id}',false)">− списать</button></div>`
      + `<div style="margin:6px 0"><button class="btn sec sm" onclick="diagnose('${id}')">🩺 Диагностика</button><span id="diag_${id}" class="mut" style="margin-left:8px"></span></div>`
      + '<b class="mut">Устройства</b><table>' + (devs || '<tr><td class="mut">нет</td></tr>') + '</table>'
      + `<button class="btn sec sm" style="margin-top:8px" onclick="addDevice('${id}')">+ устройство</button></div>`;
  } catch (e) { toast(e.message); }
}
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
async function bypassGb(id, add) {
  const gb = parseFloat(document.getElementById('u_gb').value);
  if (!gb || gb <= 0) return toast('введи число ГБ');
  try { await api('/bypass/' + id + (add ? '/add' : '/deduct'), { method: 'POST', body: JSON.stringify({ gb }) }); toast(add ? 'докуплено' : 'списано'); openUser(id); } catch (e) { toast(e.message); }
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
      }).join('') + '</div>';
  } catch (e) { el.innerHTML = '<div class="card">' + esc(e.message) + '</div>'; }
};
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

// ── ПЛАТЁЖКИ ─────────────────────────────────────────────────────────────────
RENDER.payments = async function () {
  const el = document.getElementById('tab-payments');
  el.innerHTML = '<div class="card mut">загрузка…</div>';
  try {
    const list = await api('/payments/providers');
    el.innerHTML = '<div class="card"><b>Платёжные системы</b><div class="mut">Включи нужные и впиши ключи. '
      + 'Для СБП (NSPK) — ЮKassa/Platega. Богатых интеграций не трогай без сверки с докой платёжки.</div>'
      + list.map((p) => `<div style="border-top:1px solid var(--line);padding-top:10px;margin-top:10px">`
        + `<label class="fld">${esc(p.title)} ${p.enabled ? '<span class="pill ok">вкл</span>' : '<span class="pill">выкл</span>'} <span class="mut">(${(p.kinds || []).join(', ')})</span></label>`
        + `<div class="row"><label class="pill"><input type="checkbox" id="pe_${p.id}" ${p.enabled ? 'checked' : ''} style="width:auto;margin:0 6px 0 0">включить</label></div>`
        + p.requiredKeys.map((k) => `<input id="pk_${p.id}_${k}" placeholder="${esc(k)}">`).join('')
        + `<button class="btn sm" onclick="savePay('${p.id}', ${JSON.stringify(p.requiredKeys).replace(/"/g, '&quot;')})">Сохранить</button></div>`).join('') + '</div>';
  } catch (e) { el.innerHTML = '<div class="card">' + esc(e.message) + '</div>'; }
};
async function savePay(id, keys) {
  const body = { enabled: document.getElementById('pe_' + id).checked };
  keys.forEach((k) => { const v = document.getElementById('pk_' + id + '_' + k).value; if (v) body[k] = v; });
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
    + '<div class="card"><b>Франшизы</b><div id="f_list" class="mut">загрузка…</div></div>';
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
      + '</div>';
  } catch (e) { el.innerHTML = '<div class="card">' + esc(e.message) + '</div>'; }
};
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
