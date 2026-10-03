/* LoreGram/StaticGram Upgrader — WebApp */
// === НАСТРОЙКА: адрес бэкенда (API) ===
// Локальный тест на ПК:  http://127.0.0.1:8081
// Прод (VPS/https):      https://upgrader-api.staticgram.top  (пример)
const API_BASE = 'https://gbot.neforbg.workers.dev';

const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#0b0c0f'); tg.setBackgroundColor('#0b0c0f'); }

const API = {
  hdr() { return { 'Content-Type': 'application/json', 'X-Init-Data': tg?.initData || '' }; },
  async get(path) { const r = await fetch(API_BASE + path, { headers: this.hdr() }); return r.json(); },
  async post(path, body) { const r = await fetch(API_BASE + path, { method: 'POST', headers: this.hdr(), body: JSON.stringify(body || {}) }); return r.json(); },
};

const DEFAULTS = {
  balance: 0, deposited: 0, withdrawn: 0, total_bet: 0, total_won: 0, bets_count: 0,
  multipliers: [1.5, 2.0, 3.0, 5.0, 10.0, 50.0, 100.0], house_pct: 95,
  max_bet: 10000, min_bet: 10,
};
DEFAULTS.chances = Object.fromEntries(
  DEFAULTS.multipliers.map(m => [String(m), Math.round(DEFAULTS.house_pct / m * 100) / 100]));

let ME = DEFAULTS;
let multiplier = 1.5;
let spinning = false;

const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString('ru-RU');
const esc = s => String(s ?? '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));

/* ---------- кольцо ---------- */
const R = 130, CIRC = 2 * Math.PI * R;

function setWinzone(pct) {
  const zone = $('winzone');
  zone.setAttribute('stroke-dasharray', `${CIRC * pct / 100} ${CIRC}`);
}

function spinRing(roll, chance, onDone) {
  const dot = $('dot');
  const finalAngle = (roll / 100) * 360;           // где реально выпал ролл (0 = верх, по часовой)
  const total = 360 * 4 + finalAngle;              // 4 полных оборота + докрутка
  const dur = 3400, start = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - start) / dur);
    const ease = 1 - Math.pow(1 - t, 3);            // ease-out cubic
    const angle = total * ease;
    const rad = (angle - 90) * Math.PI / 180;       // 0° = верх круга
    dot.setAttribute('cx', 160 + R * Math.cos(rad));
    dot.setAttribute('cy', 160 + R * Math.sin(rad));
    if (t < 1) requestAnimationFrame(frame);
    else onDone();
  }
  requestAnimationFrame(frame);
}

/* ---------- состояние ---------- */
function renderMe(me) {
  ME = me;
  $('balance').textContent = fmt(me.balance);
  const row = $('mult-row');
  row.innerHTML = '';
  const fmtM = m => (m < 10 ? m.toFixed(1) : String(m)) + 'x';
  for (const m of me.multipliers) {
    const b = document.createElement('button');
    b.className = 'mult-chip' + (m === multiplier ? ' active' : '');
    b.textContent = fmtM(m);
    b.onclick = () => { multiplier = m; renderMe(ME); };
    row.appendChild(b);
  }
  const chance = me.chances[String(multiplier)] ?? Math.round((me.house_pct || 95) / multiplier * 100) / 100;
  $('chance-right').textContent = chance.toFixed(2).replace(/\.00$/, '') + '% шанс';
  const bet = clampBet(parseInt($('bet').value || '0'));
  const target = Math.floor(bet * multiplier);
  $('ring-mult').textContent = fmtM(multiplier);
  $('ring-chance').textContent = `шанс: ${chance.toFixed(2)}%`;
  $('ring-target').textContent = `+${fmt(target)} звёзд`;
  $('target-line').textContent = `цель: ${fmt(target)} звёзд`;
  setWinzone(chance);
}

function clampBet(v) {
  if (!v || v < (ME?.min_bet ?? 10)) v = (ME?.min_bet ?? 10);
  if (v > (ME?.max_bet ?? 10000)) v = (ME?.max_bet ?? 10000);
  return Math.floor(v);
}

/* ---------- ставки ---------- */
async function placeBet() {
  if (spinning) return;
  spinning = true;
  $('btn-bet').disabled = true;
  $('result-banner').style.visibility = 'hidden';
  const amount = clampBet(parseInt($('bet').value || '0'));
  const res = await API.post('/api/bet', { amount, multiplier });
  if (res.error) {
    spinning = false; $('btn-bet').disabled = false;
    alert({ unauthorized: 'Открой бота заново', insufficient_funds: 'Недостаточно звёзд',
            bad_amount: `Ставка от ${ME.min_bet} до ${ME.max_bet}★` }[res.error] || res.error);
    return;
  }
  // анимация: докрутка к выпавшему ролику
  $('result-banner').style.visibility = 'hidden';
  spinRing(res.roll, res.chance, async () => {
    const banner = $('result-banner');
    if (res.win) {
      banner.textContent = `победа! +${fmt(res.payout)} звёзд (ролл: ${res.roll.toFixed(2)})`;
      banner.className = 'result-banner win';
    } else {
      banner.textContent = `неудача −${fmt(res.amount)} звёзд (ролл: ${res.roll.toFixed(2)})`;
      banner.className = 'result-banner lose';
    }
    banner.style.visibility = 'visible';
    $('balance').textContent = fmt(res.balance);
    ME.balance = res.balance;
    spinning = false; $('btn-bet').disabled = false;
    loadFeed();
  });
}

/* ---------- тикер и история ---------- */
function tickerItem(b) {
  const el = document.createElement('span');
  el.className = 'ticker-item';
  el.innerHTML = `<b>@${esc(b.username || 'player')}</b> <span class="mult-badge">${b.multiplier.toFixed(2)}x</span> +${fmt(b.payout)} зв.`;
  return el;
}

async function loadFeed() {
  const feed = await API.get('/api/feed');
  const track = $('ticker');
  track.innerHTML = '';
  for (const b of feed.wins) track.appendChild(tickerItem(b));
  if (!feed.wins.length) track.innerHTML = '<span class="ticker-item dim">апгрейдер ждёт первую победу…</span>';
}

async function openHistory() {
  const h = await API.get('/api/history');
  const rows = $('hist-rows');
  rows.innerHTML = '';
  for (const b of h.bets) {
    const r = document.createElement('div');
    r.className = 'hist-row ' + (b.win ? 'win' : 'lose');
    r.innerHTML = `<span>${fmt(b.amount)}</span><span>${b.multiplier.toFixed(2)}x</span>` +
      `<span>${b.chance.toFixed(2)}%</span><span>${b.roll.toFixed(2)}</span>` +
      `<span>${b.win ? '+' : '−'}${fmt(b.win ? b.payout : b.amount)}</span>`;
    rows.appendChild(r);
  }
  $('history-modal').classList.add('open');
}

async function openProfile() {
  const me = ME || await API.get('/api/me');
  $('profile-body').innerHTML = `
    <div class="row"><span>игрок</span><b>@${esc(me.username || me.id)}</b></div>
    <div class="row"><span>⭐ баланс</span><b>${fmt(me.balance)}</b></div>
    <div class="row"><span>📈 ставок</span><b>${me.bets_count} (на ${fmt(me.total_bet)}★)</b></div>
    <div class="row"><span>🏆 выиграно</span><b>${fmt(me.total_won)}★</b></div>
    <div class="row"><span>⬆️ пополнено</span><b>${fmt(me.deposited)}★</b></div>
    <div class="row"><span>⬇️ выведено</span><b>${fmt(me.withdrawn)}★</b></div>`;
  $('profile-modal').classList.add('open');
}

/* ---------- пополнить / вывести ---------- */
let amountMode = 'deposit';
function openAmount(mode) {
  amountMode = mode;
  $('amount-title').textContent = mode === 'deposit' ? 'пополнить' : 'вывести';
  $('amount').value = '';
  $('amount-hint').textContent = mode === 'deposit'
    ? 'Оплата звёздами через инвойс StaticGram.'
    : `Минимум 100★. Заявку проверит админ.`;
  $('amount-modal').classList.add('open');
}

async function submitAmount() {
  const amount = parseInt($('amount').value || '0');
  if (!amount || amount <= 0) return;
  if (amountMode === 'deposit') {
    const res = await API.post('/api/deposit-link', { amount });
    if (res.url) {
      // StaticGram: openInvoice принимает только t.me/$<slug>
      let inv = res.url;
      if (inv.includes('staticgram.top/invoice/')) inv = 'https://t.me/$' + inv.split('/').pop();
      if (tg) tg.openInvoice(inv);
      else window.open(inv);
      $('amount-modal').classList.remove('open');
    } else alert(res.description || res.error);
  } else {
    const res = await API.post('/api/withdraw', { amount });
    if (res.ok) {
      alert(res.message);
      $('amount-modal').classList.remove('open');
      refresh();
    } else alert(res.error === 'min_withdraw' ? `Минимум ${res.min}★` : res.error === 'insufficient_funds' ? 'Недостаточно звёзд' : (res.description || res.error));
  }
}

/* ---------- init ---------- */
function offline(on, detail) {
  const b = document.getElementById('result-banner');
  if (!b) return;
  b.style.visibility = 'visible';
  b.className = 'result-banner lose';
  b.textContent = on ? ('нет связи ' + (detail || '')) : '';
}

async function refresh() {
  const hasId = tg && tg.initData ? 'есть(' + tg.initData.length + 'симв)' : 'ПУСТО';
  try {
    const r = await fetch(API_BASE + '/api/me', { headers: API.hdr() });
    const me = await r.json();
    if (r.status !== 200 || me.error) throw new Error(r.status + ' ' + JSON.stringify(me).slice(0, 80));
    offline(false);
    renderMe(me);
    loadFeed();
  } catch (e) {
    renderMe(DEFAULTS);
    offline(true, '[' + e.message + '] initData ' + hasId);
  }
}

$('btn-bet').onclick = placeBet;
$('btn-history').onclick = openHistory;
$('btn-profile').onclick = openProfile;
$('btn-plus').onclick = () => openAmount('deposit');
$('btn-deposit').onclick = () => openAmount('deposit');
$('btn-withdraw').onclick = () => openAmount('withdraw');
$('amount-ok').onclick = submitAmount;
$('btn-half').onclick = () => { $('bet').value = clampBet(Math.floor(parseInt($('bet').value || '0') / 2)); renderMe(ME); };
$('btn-double').onclick = () => { $('bet').value = clampBet(parseInt($('bet').value || '0') * 2); renderMe(ME); };
$('btn-max').onclick = () => {
  const cap = Math.max(ME.min_bet, Math.min(ME.max_bet, ME.balance || ME.min_bet));
  $('bet').value = cap;
  renderMe(ME);
};
$('bet').oninput = () => renderMe(ME);
document.querySelectorAll('[data-close]').forEach(b => b.onclick = e => e.target.closest('.modal').classList.remove('open'));
document.querySelectorAll('.modal').forEach(m => m.onclick = e => { if (e.target === m) m.classList.remove('open'); });

refresh();
setInterval(() => { if (!spinning) refresh(); }, 15000);
