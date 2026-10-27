'use strict';

/* ============================================================
   BOLOPOLY v0.5 — moteur de jeu et interface
   Dépend de data.js (SPACES, GROUPS, CHARACTERS, DECKS, CONFIG…)
   ============================================================ */

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PLAYER_COLORS = ['#e4002b', '#1565d8', '#16a34a', '#7b2fbe', '#ff8a00', '#111827'];
const COLOR_NAMES = ['Rouge', 'Bleu', 'Vert', 'Violet', 'Orange', 'Noir'];
const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
const money = (n) => `${fmt(n)} F`;
const rollDie = () => 1 + Math.floor(Math.random() * 6);
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const FAST = { move: 110, dice: 70 };

const state = {
  players: [], cur: 0, round: 1, props: {}, tontine: 0,
  hasRolled: false, doubles: 0, dice: [1, 1], focus: 0,
  over: false, busy: false, decks: {},
  actionMode: null, winMode: 'last', maxRounds: 30,
  season: 'calm', logLines: []
};

const setup = {
  count: 2, names: ['', '', '', ''],
  chars: ['commercante', 'planteur', 'chauffeur', 'etudiant'],
  kinds: ['human', 'bot', 'bot', 'bot'],
  diffs: ['normal', 'normal', 'normal', 'normal'],
  colors: [0, 1, 2, 3, 4, 5],   // indice dans PLAYER_COLORS, un par siège
  winMode: 'last', maxRounds: 30
};

/* Chaque siège garde une couleur unique : en cas de doublon, le siège suivant prend la première libre. */
function normalizeColors() {
  const used = new Set();
  for (let i = 0; i < 4; i += 1) {
    let c = setup.colors[i];
    if (!Number.isInteger(c) || c < 0 || c >= PLAYER_COLORS.length || used.has(c)) c = PLAYER_COLORS.findIndex((_, k) => !used.has(k));
    setup.colors[i] = c; used.add(c);
  }
}

const BAR_META = {
  build: { label: 'Construire', prompt: 'Clique sur le terrain à construire' },
  sell: { label: 'Vendre', prompt: 'Clique sur le bâtiment à vendre' },
  mortgage: { label: 'Hypothéquer', prompt: 'Clique sur le terrain à hypothéquer' },
  unmortgage: { label: 'Déshypothéquer', prompt: 'Clique sur le terrain à déshypothéquer' }
};

let actionActor = null;
let actionWait = null;
let keepBusy = false;
let tileConfirmWait = null;
let deedPinned = false;
let persistTimer = null;

/* ---------- Accès rapides ---------- */
const curP = () => state.players[state.cur];
const byId = (id) => state.players[id];
const activePlayers = () => state.players.filter((p) => !p.eliminated);
const charOf = (p) => CHARACTERS.find((c) => c.id === p.char);
const isOwnable = (s) => s.type === 'property' || s.type === 'transport' || s.type === 'utility';
const ownedIdx = (p) => Object.keys(state.props).map(Number).filter((i) => state.props[i].owner === p.id);
const ownsFull = (p, g) => GROUP_INDEX[g].every((i) => state.props[i].owner === p.id);
const groupHasBuildings = (g) => GROUP_INDEX[g].some((i) => state.props[i].level > 0);
const countOwned = (p, group) => GROUP_INDEX[group].filter((i) => state.props[i].owner === p.id && !state.props[i].mortgaged).length;
const networkLines = (p) => countOwned(p, 'transport');
const hasNetwork = (p) => networkLines(p) >= CONFIG.jamMinLines || (p.char === 'chauffeur' && networkLines(p) >= 1);
const roundK = (n) => Math.round(n / K) * K;
const stockLeft = () => CONFIG.buildStock - Object.values(state.props).reduce((n, x) => n + x.level, 0);

function freshProps() {
  const o = {};
  SPACES.forEach((s, i) => { if (isOwnable(s)) o[i] = { owner: null, level: 0, mortgaged: false }; });
  return o;
}

function priceFor(p, i) {
  const s = SPACES[i];
  return p.char === 'chauffeur' && s.type === 'transport' ? roundK(s.price * 0.7) : s.price;
}

function netWorth(p) {
  let total = p.cash;
  ownedIdx(p).forEach((i) => {
    const s = SPACES[i], pr = state.props[i];
    total += pr.mortgaged ? s.price * CONFIG.mortgageRate : s.price;
    if (s.type === 'property') total += pr.level * s.buildCost;
  });
  return total;
}

/* ---------- Loyers ---------- */
function rentFor(i, mult = 1) {
  const s = SPACES[i], pr = state.props[i];
  if (!pr || pr.owner === null || pr.mortgaged) return { amount: 0, note: '' };
  const owner = byId(pr.owner);
  let amt = 0, note = '';
  if (s.type === 'property') {
    amt = s.rents[pr.level];
    if (pr.level === 0 && ownsFull(owner, s.group)) { amt *= 2; note = 'Groupe complet : loyer doublé.'; }
    if (owner.char === 'planteur' && GROUPS[s.group].kind === 'agri') {
      amt = Math.round(amt * 1.25); note += ' Bonus du planteur : +25 %.';
    }
  } else if (s.type === 'transport') {
    amt = 25 * K * 2 ** (Math.max(1, networkLines(owner)) - 1);
    note = `${networkLines(owner)} ligne(s) au même propriétaire.`;
    if (currentSeason().transport === 0) { amt = 0; note = 'Grève des gbakas : les transports ne rapportent rien.'; }
  } else {
    const n = countOwned(owner, 'services');
    const total = state.dice[0] + state.dice[1];
    amt = total * (n >= 2 ? 10 * K : 4 * K);
    note = `Dés (${total}) × ${n >= 2 ? '10 000' : '4 000'} F.`;
  }
  const sm = seasonMult(i);
  if (sm !== 1 && amt > 0) {
    amt *= sm;
    note += sm > 1 ? ` Saison : +${Math.round((sm - 1) * 100)} %.` : ` Saison : ${Math.round((sm - 1) * 100)} %.`;
  }
  if (mult !== 1) note += ` Tarif ×${mult}.`;
  return { amount: roundK(amt * mult), note: note.trim() };
}

function currentSeason() {
  return SEASONS.find((s) => s.id === state.season) || SEASONS[0];
}
function seasonMult(i) {
  const se = currentSeason();
  if (se.tiles && se.tiles[i] != null) return se.tiles[i];
  const g = SPACES[i].group;
  if (se.groups && g && se.groups[g] != null) return se.groups[g];
  return 1;
}

/* ---------- Règles de construction ---------- */
function buildCheck(p, i) {
  const s = SPACES[i], pr = state.props[i];
  if (s.type !== 'property') return { ok: false, why: 'Non constructible' };
  if (!ownsFull(p, s.group)) return { ok: false, why: 'Il faut posséder tout le groupe' };
  const grp = GROUP_INDEX[s.group];
  if (grp.some((j) => state.props[j].mortgaged)) return { ok: false, why: 'Un terrain du groupe est hypothéqué' };
  if (pr.level >= CONFIG.maxLevel) return { ok: false, why: 'Niveau maximum' };
  if (pr.level > Math.min(...grp.map((j) => state.props[j].level))) return { ok: false, why: 'Construis d’abord les autres terrains du groupe' };
  if (stockLeft() < 1) return { ok: false, why: 'Plus de bâtiments en banque' };
  if (p.cash < s.buildCost) return { ok: false, why: 'Solde insuffisant' };
  return { ok: true, cost: s.buildCost };
}
function sellCheck(i) {
  const s = SPACES[i], pr = state.props[i];
  if (s.type !== 'property' || pr.level === 0) return { ok: false };
  if (pr.level < Math.max(...GROUP_INDEX[s.group].map((j) => state.props[j].level))) return { ok: false, why: 'Vends d’abord les niveaux les plus hauts du groupe' };
  return { ok: true, gain: s.buildCost / 2 };
}
function mortgageCheck(i) {
  const s = SPACES[i], pr = state.props[i];
  if (pr.mortgaged) return { ok: false };
  if (s.type === 'property' && groupHasBuildings(s.group)) return { ok: false, why: 'Vends d’abord les bâtiments du groupe' };
  return { ok: true, gain: s.price * CONFIG.mortgageRate };
}
const unmortgageCost = (i) => roundK(SPACES[i].price * CONFIG.unmortgageRate);

function actionCheck(p, i, act) {
  const pr = state.props[i];
  if (!pr || pr.owner !== p.id) return { ok: false, why: 'Ce terrain ne t’appartient pas' };
  if (act === 'build') return buildCheck(p, i);
  if (act === 'sell') {
    const c = sellCheck(i);
    return c.ok ? c : { ok: false, why: c.why || 'Rien à vendre ici' };
  }
  if (act === 'mortgage') {
    const c = mortgageCheck(i);
    return c.ok ? c : { ok: false, why: c.why || 'Déjà hypothéqué' };
  }
  if (act === 'unmortgage') {
    if (!pr.mortgaged) return { ok: false, why: 'Ce terrain n’est pas hypothéqué' };
    const cost = unmortgageCost(i);
    if (p.cash < cost) return { ok: false, why: 'Solde insuffisant' };
    return { ok: true, cost };
  }
  return { ok: false, why: 'Impossible' };
}
const eligibleIdxs = (p, act) => ownedIdx(p).filter((i) => actionCheck(p, i, act).ok);
function barWhy(p, act) {
  const own = ownedIdx(p);
  if (!own.length) return 'Tu ne possèdes aucun bien';
  const counts = {};
  own.forEach((i) => {
    const c = actionCheck(p, i, act);
    if (!c.ok) counts[c.why] = (counts[c.why] || 0) + 1;
  });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : 'Aucun terrain éligible';
}
function actionSummary(p, i, act) {
  const s = SPACES[i], chk = actionCheck(p, i, act);
  if (act === 'build') return { pay: chk.cost, gain: 0, detail: `Prochain niveau : ${TIERS[GROUPS[s.group].kind][state.props[i].level + 1]}.` };
  if (act === 'sell') return { pay: 0, gain: chk.gain, detail: 'Le bâtiment se revend à moitié prix.' };
  if (act === 'mortgage') return { pay: 0, gain: chk.gain, detail: 'Plus de loyer tant que le terrain est hypothéqué.' };
  return { pay: chk.cost, gain: 0, detail: 'Le terrain redevient louable.' };
}
function applyBarAction(p, i, act) {
  const s = SPACES[i], pr = state.props[i], chk = actionCheck(p, i, act);
  if (!chk.ok) { showToast(chk.why); return false; }
  if (act === 'build') {
    p.cash -= chk.cost; pr.level += 1;
    log(`${p.name} construit à ${s.name} : ${TIERS[GROUPS[s.group].kind][pr.level]}.`);
    if (p.char === 'tech') p.cash += Math.round(chk.cost * 0.1);
  } else if (act === 'sell') {
    pr.level -= 1; p.cash += chk.gain;
    log(`${p.name} revend un bâtiment à ${s.name}.`);
  } else if (act === 'mortgage') {
    pr.mortgaged = true; p.cash += chk.gain;
    log(`${p.name} hypothèque ${s.name}.`);
  } else if (act === 'unmortgage') {
    p.cash -= chk.cost; pr.mortgaged = false;
    log(`${p.name} lève l’hypothèque de ${s.name}.`);
  }
  persistSoon();
  return true;
}

/* ---------- Bots ---------- */
function diffOf(p) { return BOT_DIFF[p.diff] || BOT_DIFF.normal; }
function botPrefers(p, i) {
  const s = SPACES[i], g = GROUPS[s.group];
  if (p.char === 'planteur' && g?.kind === 'agri') return true;
  if (p.char === 'chauffeur' && s.type === 'transport') return true;
  if (p.char === 'tech' && s.type === 'utility') return true;
  if (p.char === 'commercante' && (s.group === 'populaire' || s.group === 'vivants')) return true;
  return false;
}
function botWants(p, i) {
  const d = diffOf(p);
  const price = priceFor(p, i);
  const keep = botPrefers(p, i) ? d.reserve * 0.45 : d.reserve;
  if (p.cash - price < keep) return false;
  const s = SPACES[i];
  const grp = GROUP_INDEX[s.group] || [];
  const owned = grp.filter((j) => state.props[j].owner === p.id).length;
  if (owned === grp.length - 1) return true;
  if (botPrefers(p, i)) return true;
  if (d.smart) return true;
  return Math.random() < d.buyBias;
}
function botAuctionBid(p, i, nexts, bid) {
  const d = diffOf(p);
  const cap = Math.min(p.cash, Math.max(0, Math.round(SPACES[i].price * d.auctionOf) - (p.cash < d.reserve ? d.reserve : 0)));
  const affordable = nexts.filter((n) => n <= p.cash && n <= cap);
  if (!affordable.length) return 0;
  if (!botWants(p, i) && bid > 0 && !d.smart) return 0;
  if (p.diff === 'easy') return Math.random() < 0.45 ? 0 : affordable[0];
  return affordable[affordable.length - 1];
}
function botOfferFactor(p) {
  const d = diffOf(p);
  if (p.char === 'commercante') return 0.9;
  return d.offer;
}
function botOwnerReply(owner, offer, counters) {
  const d = diffOf(owner);
  if (offer >= d.acceptAt) return 'ok';
  if (d.counter && counters.length) {
    const pick = owner.diff === 'hard' ? counters[counters.length - 1] : counters[0];
    return `c:${pick}`;
  }
  return 'dice';
}
function landingScore(p, dest) {
  const s = SPACES[dest], pr = state.props[dest];
  if (s.type === 'goToJail') return -9;
  if (s.type === 'tax') return -3;
  if (isOwnable(s) && pr.owner === null) {
    let v = botPrefers(p, dest) ? 5 : 2;
    const grp = GROUP_INDEX[s.group] || [];
    if (grp.some((j) => state.props[j].owner === p.id)) v += 4;
    return v;
  }
  if (isOwnable(s) && pr.owner !== null && pr.owner !== p.id && !pr.mortgaged) {
    const r = rentFor(dest).amount;
    return p.cash < r + diffOf(p).reserve ? -7 : -2;
  }
  if (s.type === 'tontine' && state.tontine > 40 * K) return 4;
  return 0;
}
function botPickSteps(p, opts) {
  if (!diffOf(p).smart) return opts[0];
  return [...opts].sort((a, b) => landingScore(p, (p.pos + b) % SPACES.length) - landingScore(p, (p.pos + a) % SPACES.length))[0];
}
function botJailChoice(p) {
  const d = diffOf(p);
  if (d.useCard && p.jailCards.length) return 'card';
  if (p.cash >= CONFIG.jailBail && (d.payBail && p.cash >= CONFIG.jailBail + d.reserve * 0.5 || p.jailTurns >= 2)) return 'pay';
  if (p.cash >= CONFIG.jailBail && p.diff === 'hard') return 'pay';
  return 'roll';
}
function botAcceptTrade(bot, offer) {
  const incoming = offer.give.reduce((n, i) => n + SPACES[i].price, 0) + offer.cashGive;
  const outgoing = offer.get.reduce((n, i) => n + SPACES[i].price, 0) + offer.cashGet;
  const completesFor = (ownerId, idxs) => idxs.some((i) => {
    const grp = GROUP_INDEX[SPACES[i].group] || [];
    return grp.every((j) => state.props[j].owner === ownerId || idxs.includes(j));
  });
  if (bot.diff === 'easy') return incoming >= outgoing * 0.65;
  if (completesFor(bot.id, offer.give)) return true;
  const other = curP();
  if (diffOf(bot).smart && completesFor(other.id, offer.get)) return incoming > outgoing + 80 * K;
  return incoming >= outgoing;
}
function botRaiseCash(p, need) {
  let guard = 48;
  while (p.cash < need && guard > 0) {
    guard -= 1;
    const sells = eligibleIdxs(p, 'sell');
    if (sells.length) { applyBarAction(p, sells[0], 'sell'); continue; }
    const morts = eligibleIdxs(p, 'mortgage').sort((a, b) => {
      const pa = botPrefers(p, a) ? 1 : 0, pb = botPrefers(p, b) ? 1 : 0;
      return pa - pb || SPACES[a].price - SPACES[b].price;
    });
    if (morts.length) { applyBarAction(p, morts[0], 'mortgage'); continue; }
    break;
  }
}
function botImprove(p) {
  const d = diffOf(p);
  eligibleIdxs(p, 'unmortgage').sort((a, b) => unmortgageCost(a) - unmortgageCost(b)).forEach((i) => {
    if (p.cash - unmortgageCost(i) < d.reserve) return;
    if (!d.smart && !botPrefers(p, i) && Math.random() > 0.55) return;
    applyBarAction(p, i, 'unmortgage');
  });
  eligibleIdxs(p, 'build')
    .sort((a, b) => (botPrefers(p, a) ? 0 : 1) - (botPrefers(p, b) ? 0 : 1) || SPACES[b].price - SPACES[a].price)
    .forEach((i) => {
      if (state.props[i].level >= d.buildMax) return;
      if (p.cash - SPACES[i].buildCost < d.reserve) return;
      if (p.diff === 'easy' && Math.random() > 0.4) return;
      applyBarAction(p, i, 'build');
    });
}
async function botPlayTurn() {
  const p = curP();
  if (!p?.isBot || state.over) return;
  const id = p.id;
  await sleep(diffOf(p).delay);
  if (state.over || curP()?.id !== id) return;
  if (!state.hasRolled) await onRoll();
  if (state.over || curP()?.id !== id) return;
  if (!state.hasRolled) {
    setTimeout(() => { if (curP()?.id === id && curP()?.isBot) botPlayTurn(); }, 0);
    return;
  }
  botImprove(curP());
  renderAll();
  persistSoon();
  await sleep(diffOf(curP()).delay);
  if (curP()?.id === id && state.hasRolled && !state.over) await onEndTurn();
}

/* ---------- Sauvegarde ---------- */
function cardByText(key, text) {
  return DECKS[key].cards.find((c) => c.text === text);
}
function snapshot() {
  return {
    v: 5,
    players: state.players.map((p) => ({
      id: p.id, name: p.name, color: p.color, char: p.char, cash: p.cash, pos: p.pos,
      inJail: p.inJail, jailTurns: p.jailTurns, skip: p.skip, eliminated: p.eliminated,
      isBot: !!p.isBot, diff: p.diff || 'normal',
      jailCards: (p.jailCards || []).map((jc) => ({ deck: jc.deck, text: jc.card.text }))
    })),
    cur: state.cur, round: state.round, props: state.props, tontine: state.tontine,
    hasRolled: state.hasRolled, doubles: state.doubles, dice: state.dice, focus: state.focus,
    winMode: state.winMode, maxRounds: state.maxRounds, season: state.season,
    logLines: state.logLines || [], elapsed: Date.now() - (state.t0 || Date.now()),
    decks: Object.fromEntries(Object.keys(state.decks).map((k) => [k, {
      pile: state.decks[k].pile.map((c) => c.text),
      discard: state.decks[k].discard.map((c) => c.text)
    }]))
  };
}
function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 80);
}
function persist() {
  if (!state.players.length || state.over || $('gamePanel').classList.contains('hidden')) return;
  if (state.busy && !state.hasRolled) return;
  try { localStorage.setItem(CONFIG.saveKey, JSON.stringify(snapshot())); } catch (err) { /* quota */ }
}
function clearSave() {
  try { localStorage.removeItem(CONFIG.saveKey); } catch (err) { /* ignore */ }
}
function readSave() {
  try {
    const raw = localStorage.getItem(CONFIG.saveKey);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.v !== 5 || !data.players?.length) return null;
    return data;
  } catch (err) { return null; }
}
function paintResume() {
  const box = $('resumeBox');
  const data = readSave();
  if (!box) return;
  box.classList.toggle('hidden', !data);
  if (!data) return;
  const names = data.players.map((p) => p.name).join(', ');
  $('resumeHint').textContent = `${names} · tour ${data.round}${data.winMode === 'timed' ? ` / ${data.maxRounds}` : ''}.`;
}

/* ============================================================
   Interface : journal, messages, fenêtres
   ============================================================ */
let toastTimer;
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}
const clock = () => { const s = Math.floor((Date.now() - (state.t0 || Date.now())) / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
function log(msg) {
  const line = { t: clock(), msg };
  state.logLines = [line, ...(state.logLines || [])].slice(0, 60);
  const box = $('gameLog');
  if (!box) return;
  const li = document.createElement('li');
  li.innerHTML = `<time>${line.t}</time> ${esc(msg)}`;
  box.prepend(li);
  while (box.children.length > 60) box.lastElementChild.remove();
}
function paintLog() {
  const box = $('gameLog');
  if (!box) return;
  box.innerHTML = (state.logLines || []).map((l) => `<li><time>${esc(l.t)}</time> ${esc(l.msg)}</li>`).join('');
}
function setHint(msg) { $('turnHint').textContent = msg; }

const modalRoot = $('modalRoot');
function closeModal() { modalRoot.classList.add('hidden'); modalRoot.innerHTML = ''; state.modalActor = null; }
function openModalShell({ eyebrow = '', title = '', body = '', wide = false, tone = '' }) {
  modalRoot.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''} ${tone}" role="dialog" aria-modal="true">
      <div class="modal-head"><p class="eyebrow">${eyebrow}</p><h3>${title}</h3></div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot"></div>
    </div>`;
  modalRoot.classList.remove('hidden');
  return modalRoot.querySelector('.modal');
}
function addButtons(foot, buttons, done) {
  buttons.forEach((b) => {
    const btn = document.createElement('button');
    btn.className = `btn ${b.kind || 'primary'}`;
    btn.textContent = b.label;
    btn.disabled = !!b.disabled;
    btn.addEventListener('click', () => {
      const v = b.valueFn ? b.valueFn() : b.value;
      if (b.validate) {
        const err = b.validate(v);
        if (err) { showToast(err); return; }
      }
      done(v);
    });
    foot.appendChild(btn);
  });
}
function ask(opts, onMount) {
  return new Promise((resolve) => {
    const actor = opts.actor;
    if (actor?.isBot && !opts.forceHuman) {
      const delay = (BOT_DIFF[actor.diff] || BOT_DIFF.normal).delay;
      sleep(delay).then(() => {
        let v = true;
        try {
          v = typeof opts.bot === 'function' ? opts.bot(actor, opts) : true;
        } catch (err) {
          console.error(err);
          const buttons = (opts.buttons || [{ value: true }]).filter((b) => !b.disabled);
          v = buttons[0] ? (buttons[0].valueFn ? buttons[0].valueFn() : buttons[0].value) : true;
        }
        resolve(v);
      });
      return;
    }
    const modal = openModalShell(opts);
    state.modalActor = actor ? actor.id : null;
    addButtons(modal.querySelector('.modal-foot'), opts.buttons || [{ label: 'OK', value: true }], (v) => { closeModal(); resolve(v); });
    if (onMount) onMount(modal);
    const first = modal.querySelector('.modal-foot .btn:not(:disabled)');
    if (first) first.focus({ preventScroll: true });
  });
}

/* Fiche d'une case, utilisée dans plusieurs fenêtres */
function propCardHtml(i, opts = {}) {
  const s = SPACES[i];
  const color = GROUPS[s.group] ? GROUPS[s.group].color : '#999';
  let rows = '';
  if (s.type === 'property') {
    const tiers = TIERS[GROUPS[s.group].kind];
    rows = s.rents.map((r, k) => `<tr><td>${tiers[k]}</td><td>${money(r)}</td></tr>`).join('');
    rows += `<tr class="sub"><td>Construire</td><td>${money(s.buildCost)} par niveau</td></tr>`;
  } else if (s.type === 'transport') {
    rows = [1, 2, 3, 4].map((n) => `<tr><td>${n} ligne${n > 1 ? 's' : ''}</td><td>${money(25 * K * 2 ** (n - 1))}</td></tr>`).join('');
  } else {
    rows = `<tr><td>1 service</td><td>dés × 4 000 F</td></tr><tr><td>2 services</td><td>dés × 10 000 F</td></tr>`;
  }
  return `
    <div class="pcard">
      <div class="pcard-head" style="background:${color}"><strong>${esc(s.name)}</strong><span>${s.icon || ''}</span></div>
      <p class="pcard-blurb">${esc(s.blurb || '')}</p>
      <table class="rent-table">${rows}</table>
      <p class="pcard-price">Prix <strong>${money(opts.price || s.price)}</strong></p>
    </div>`;
}

/* ============================================================
   Plateau
   ============================================================ */
const SKYLINE = `
<svg class="skyline" viewBox="0 0 600 110" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
  <g fill="currentColor">
    <rect x="0" y="100" width="600" height="10"/>
    <rect x="14" y="62" width="22" height="38"/><rect x="40" y="48" width="18" height="52"/>
    <polygon points="76,100 104,40 132,100"/>
    <rect x="146" y="54" width="20" height="46"/><rect x="170" y="36" width="16" height="64"/>
    <rect x="190" y="58" width="22" height="42"/>
    <rect x="236" y="70" width="70" height="30"/><rect x="246" y="62" width="50" height="8"/>
    <path d="M251 62a25 25 0 0 1 40 0z"/><rect x="269" y="40" width="4" height="12"/><rect x="263" y="44" width="16" height="3"/>
    <rect x="330" y="30" width="5" height="70"/><rect x="430" y="30" width="5" height="70"/>
    <path d="M330 34 Q380 88 432 34" fill="none" stroke="currentColor" stroke-width="2.5"/>
    <path d="M330 34 L342 100M345 34 L354 100M432 34 L420 100M417 34 L408 100" stroke="currentColor" stroke-width="1" fill="none"/>
    <rect x="330" y="86" width="105" height="4"/>
    <rect x="462" y="56" width="22" height="44"/><rect x="488" y="44" width="18" height="56"/>
    <rect x="510" y="66" width="24" height="34"/>
    <path d="M556 100 V74 M556 74 q-14 -4 -22 4 M556 74 q14 -4 22 4 M556 76 q-8 -12 -20 -10 M556 76 q8 -12 20 -10" stroke="currentColor" stroke-width="2.4" fill="none"/>
  </g>
</svg>`;

function boardPosition(i) {
  if (i <= 9) return { row: 11, col: 11 - i, side: 'bottom' };
  if (i === 10) return { row: 11, col: 1, side: 'left' };
  if (i <= 19) return { row: 21 - i, col: 1, side: 'left' };
  if (i === 20) return { row: 1, col: 1, side: 'top' };
  if (i <= 29) return { row: 1, col: i - 19, side: 'top' };
  if (i === 30) return { row: 1, col: 11, side: 'right' };
  return { row: i - 29, col: 11, side: 'right' };
}
const isCorner = (i) => i % 10 === 0;

function createBoard() {
  const board = $('board');
  board.innerHTML = '';
  SPACES.forEach((s, i) => {
    const pos = boardPosition(i);
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = `tile t-${s.type} side-${pos.side}${isCorner(i) ? ' corner' : ''}${s.name.length >= 10 ? ' long' : ''}`;
    tile.style.gridRow = pos.row;
    tile.style.gridColumn = pos.col;
    tile.dataset.index = i;
    tile.setAttribute('aria-label', s.name);
    const color = s.group && GROUPS[s.group].kind !== 'transport' && GROUPS[s.group].kind !== 'service' ? GROUPS[s.group].color : null;
    if (color) tile.style.setProperty('--band', color);
    const price = s.price ? fmt(s.price) : s.amount ? `−${fmt(s.amount)}` : '';
    tile.innerHTML = `
      ${color ? '<span class="band"><span class="lv"></span></span>' : ''}
      ${s.icon ? `<span class="t-icon">${s.icon}</span>` : ''}
      <span class="t-name">${esc(s.name)}</span>
      ${price ? `<span class="t-price">${price}</span>` : ''}
      <span class="pawns"></span>
      <span class="own"></span>`;
    tile.addEventListener('click', () => onBoardTile(i));
    tile.addEventListener('mouseenter', () => {
      if (state.actionMode || !isOwnable(s)) return;
      showDeed(i, false);
    });
    tile.addEventListener('mouseleave', () => {
      if (!deedPinned) hideDeed();
    });
    board.appendChild(tile);
  });
  const center = document.createElement('div');
  center.className = 'board-center';
  center.innerHTML = `
    <div class="center-logo">Bolo<span>Poly</span></div>
    <div class="center-tag">Marchande. Cotise. Construis.</div>
    <div class="center-pot" id="centerPot"></div>
    <div class="center-season" id="centerSeason"></div>
    <div class="center-now" id="centerNow"></div>
    <div class="center-deed hidden" id="centerDeed"></div>
    ${SKYLINE}`;
  board.appendChild(center);
}

function showDeed(i, pin) {
  const el = $('centerDeed');
  if (!el || !isOwnable(SPACES[i])) return;
  el.innerHTML = propCardHtml(i);
  el.classList.remove('hidden');
  if (pin) deedPinned = true;
}
function hideDeed() {
  const el = $('centerDeed');
  if (el) el.classList.add('hidden');
  deedPinned = false;
}

function markActive() {
  document.querySelectorAll('#board .tile').forEach((t) => t.classList.toggle('active', Number(t.dataset.index) === state.focus));
}

function renderBoard() {
  const board = $('board');
  SPACES.forEach((s, i) => {
    const tile = board.children[i];
    const pawns = tile.querySelector('.pawns');
    pawns.innerHTML = state.players
      .filter((p) => !p.eliminated && p.pos === i)
      .map((p) => `<span class="pawn${p.inJail ? ' jailed' : ''}${p.id === state.cur && !state.over ? ' cur' : ''}" style="--pc:${p.color}" title="${esc(p.name)}">${charOf(p).emoji}</span>`)
      .join('');
    // la case clignote dans la couleur du pion qui s'y trouve (celui qui joue en priorité)
    const here = state.players.filter((p) => !p.eliminated && p.pos === i);
    const lead = here.find((p) => p.id === state.cur) || here[0];
    const other = lead && here.find((p) => p.color !== lead.color);
    tile.classList.toggle('occupied', !!lead);
    if (lead) tile.style.setProperty('--pc', lead.color); else tile.style.removeProperty('--pc');
    if (other) tile.style.setProperty('--pc2', other.color); else tile.style.removeProperty('--pc2');
    const pr = state.props[i];
    if (pr) {
      tile.querySelector('.own').style.background = pr.owner === null ? 'transparent' : byId(pr.owner).color;
      tile.classList.toggle('mortgaged', pr.mortgaged);
      const lv = tile.querySelector('.lv');
      if (lv) lv.textContent = pr.level === 5 ? '★' : '■'.repeat(pr.level);
    }
  });
  markActive();
}

/* ============================================================
   Rendu des panneaux
   ============================================================ */
function renderTurn() {
  const p = curP();
  if (!p) return;
  const c = charOf(p);
  $('curAvatar').textContent = c.emoji;
  $('curAvatar').style.setProperty('--pc', p.color);
  $('curName').textContent = p.name;
  $('curChar').textContent = c.name;
  $('curCash').innerHTML = `${fmt(p.cash)} <small>F</small>`;
  $('diceOne').textContent = DICE_FACES[state.dice[0] - 1];
  $('diceTwo').textContent = DICE_FACES[state.dice[1] - 1];
  $('diceTotal').textContent = state.hasRolled || state.doubles ? String(state.dice[0] + state.dice[1]) : '–';
  $('roundLabel').textContent = state.winMode === 'timed' ? `TOUR ${state.round} / ${state.maxRounds}` : `TOUR ${state.round}`;
  const tag = $('modeTag');
  if (tag) tag.textContent = state.winMode === 'timed' ? `${state.maxRounds} tours` : 'Dernier debout';
  $('curPower').textContent = p.isBot ? `${c.power} · Bot ${ (BOT_DIFF[p.diff] || BOT_DIFF.normal).label.toLowerCase() }` : c.power;
}

/* Joueurs : cartes repliables. Le joueur dont c'est le tour est déplié, les autres repliés ;
   un clic sur l'en-tête ouvre ou ferme (état local à chaque écran, remis à zéro à chaque tour). */
const uiFold = new Map();
let foldCur = -1;
function applyFolds() {
  if (foldCur !== state.cur) { uiFold.clear(); foldCur = state.cur; }
  document.querySelectorAll('#playersList .player-row').forEach((row) => {
    const pid = Number(row.dataset.pid);
    const open = uiFold.has(pid) ? uiFold.get(pid) : (pid === state.cur && !state.over);
    row.classList.toggle('open', open);
    const h = row.querySelector('.pr-head');
    if (h) h.setAttribute('aria-expanded', String(open));
  });
}
function toggleFold(pid) {
  const row = document.querySelector(`#playersList .player-row[data-pid="${pid}"]`);
  uiFold.set(pid, !(row && row.classList.contains('open')));
  applyFolds();
}
document.addEventListener('click', (e) => {
  const h = e.target.closest('.pr-head');
  if (h) toggleFold(Number(h.parentElement.dataset.pid));
});

function renderPlayers() {
  const list = $('playersList');
  list.innerHTML = '';
  state.players.forEach((p, idx) => {
    const c = charOf(p);
    const row = document.createElement('div');
    row.className = `player-row${idx === state.cur && !state.over ? ' current' : ''}${p.eliminated ? ' eliminated' : ''}`;
    row.dataset.pid = idx;
    row.style.setProperty('--pc', p.color);
    const owned = ownedIdx(p), n = owned.length;
    const houses = owned.reduce((a, i) => a + (state.props[i].level > 0 && state.props[i].level < 5 ? state.props[i].level : 0), 0);
    const hotels = owned.filter((i) => state.props[i].level === 5).length;
    row.innerHTML = `
      <button type="button" class="pr-head" aria-expanded="false">
        <span class="player-dot" style="--pc:${p.color}">${c.emoji}</span>
        <span class="pr-id"><strong>${esc(p.name)}</strong>
          <small>${p.eliminated ? 'En faillite' : `${p.isBot ? `Bot ${(BOT_DIFF[p.diff] || BOT_DIFF.normal).label} · ` : ''}${n} bien${n > 1 ? 's' : ''} · ${networkLines(p)} ligne${networkLines(p) > 1 ? 's' : ''}${p.inJail ? ' · au violon' : ''}`}</small></span>
        <span class="player-cash">${money(p.cash)}</span>
        <span class="pr-caret" aria-hidden="true">▾</span>
      </button>
      <div class="pr-body">
        <p class="pr-line"><span>Fortune <b>${money(netWorth(p))}</b></span><span title="Niveaux de construction">🏠 ${houses}</span><span title="Grands complexes">🏨 ${hotels}</span>${p.jailCards.length ? `<span title="Sortie du violon">🎫 ${p.jailCards.length}</span>` : ''}</p>
      </div>`;
    const grid = document.createElement('div');
    grid.className = 'set-grid';
    Object.keys(GROUPS).forEach((g) => {
      const cells = GROUP_INDEX[g].map((i) => `<i class="${state.props[i].owner === p.id ? 'on' : ''}" style="--gc:${GROUPS[g].color}"></i>`).join('');
      grid.insertAdjacentHTML('beforeend', `<span class="set">${cells}</span>`);
    });
    row.querySelector('.pr-body').appendChild(grid);
    list.appendChild(row);
  });
  applyFolds();
}

function renderCenter() {
  const p = curP();
  $('centerPot').innerHTML = `<small>POT DE LA TONTINE</small><strong>${money(state.tontine)}</strong>`;
  const se = currentSeason();
  const seasonEl = $('centerSeason');
  if (seasonEl) {
    seasonEl.innerHTML = `<small>SAISON</small><strong>${se.icon} ${esc(se.name)}</strong><span>${esc(se.blurb)}</span>`;
  }
  $('tontineAmount').textContent = money(state.tontine);
  $('bankStock').textContent = `${stockLeft()} / ${CONFIG.buildStock}`;
  if (!p) return;
  const wait = p.isBot ? 'Le bot joue…' : (state.hasRolled ? 'Fin de tour possible.' : 'À toi de jouer.');
  $('centerNow').innerHTML = state.over ? '<strong>Partie terminée</strong>' : `<strong>${esc(p.name)}</strong>${wait}`;
}

function renderAll() {
  renderBoard();
  paintActionTiles();
  renderTurn();
  renderPlayers();
  renderCenter();
  updateControls();
}

function updateControls() {
  const p = curP();
  if (!p) return;
  const off = state.busy || state.over;
  $('rollBtn').classList.toggle('hidden', state.hasRolled || state.over || p.isBot);
  $('rollBtn').disabled = off;
  $('rollBtn').textContent = p.inJail ? '🚔 Jouer depuis le violon' : state.doubles ? '🎲 Rejouer (double)' : '🎲 Lancer les dés';
  $('endTurnBtn').classList.toggle('hidden', !state.hasRolled || state.over || p.isBot);
  $('endTurnBtn').disabled = off;
  updateActionBar();
}

function paintActionTiles() {
  const p = actionActor, act = state.actionMode;
  document.querySelectorAll('#board .tile').forEach((t) => {
    t.classList.remove('mode-ok', 'mode-dim');
    if (!act || !p) return;
    const i = Number(t.dataset.index);
    if (actionCheck(p, i, act).ok) t.classList.add('mode-ok');
    else t.classList.add('mode-dim');
  });
}

function hideTileConfirm(reject) {
  const box = $('tileConfirm');
  box.classList.add('hidden');
  box.innerHTML = '';
  if (tileConfirmWait) {
    const done = tileConfirmWait;
    tileConfirmWait = null;
    if (reject) done(false);
  }
}

function confirmTile(p, i, act) {
  return new Promise((resolve) => {
    hideTileConfirm(true);
    const sum = actionSummary(p, i, act);
    const line = sum.pay ? `Tu paies <strong>${money(sum.pay)}</strong>.` : `Tu reçois <strong>${money(sum.gain)}</strong>.`;
    const box = $('tileConfirm');
    box.innerHTML = `<div class="tc-card">${propCardHtml(i)}<p>${line} ${esc(sum.detail)}</p>
      <div class="tc-actions"><button class="btn primary" data-ok="1" type="button">Confirmer</button>
      <button class="btn quiet" data-ok="0" type="button">Annuler</button></div></div>`;
    box.classList.remove('hidden');
    tileConfirmWait = resolve;
    box.onclick = (e) => {
      const b = e.target.closest('button[data-ok]');
      if (!b) return;
      const ok = b.dataset.ok === '1';
      hideTileConfirm(false);
      resolve(ok);
    };
  });
}

async function onBoardTile(i) {
  state.focus = i;
  markActive();
  if (!state.actionMode) showDeed(i, true);
  if (!state.actionMode || !actionActor) return;
  const chk = actionCheck(actionActor, i, state.actionMode);
  if (!chk.ok) { showToast(chk.why); return; }
  const ok = await confirmTile(actionActor, i, state.actionMode);
  if (!ok) return;
  applyBarAction(actionActor, i, state.actionMode);
  renderAll();
}

function enterActionMode(p, act) {
  hideTileConfirm(true);
  actionActor = p;
  state.actionMode = act;
  state.busy = true;
  $('actionBannerText').textContent = BAR_META[act].prompt;
  $('actionBanner').classList.remove('hidden');
  renderAll();
}

function exitActionMode() {
  hideTileConfirm(true);
  state.actionMode = null;
  actionActor = null;
  $('actionBanner').classList.add('hidden');
  if (!keepBusy && !state.over) state.busy = false;
  renderAll();
}

function finishActionMode() {
  const wait = actionWait;
  actionWait = null;
  exitActionMode();
  if (wait) wait();
}

function runActionMode(p, act) {
  return new Promise((resolve) => {
    keepBusy = true;
    actionWait = () => { keepBusy = false; state.busy = true; resolve(); };
    enterActionMode(p, act);
  });
}

function updateActionBar() {
  const bar = $('actionBar');
  const inGame = state.players.length > 0 && !$('gamePanel').classList.contains('hidden');
  bar.classList.toggle('hidden', !inGame);
  if (!inGame) return;
  const p = actionActor || curP();
  const locked = state.over || (state.busy && !state.actionMode);
  bar.querySelectorAll('[data-bar]').forEach((btn) => {
    const act = btn.dataset.bar;
    btn.classList.toggle('is-on', state.actionMode === act);
    const badge = btn.querySelector('.ab-badge');
    if (act === 'menu') {
      const modalOpen = !modalRoot.classList.contains('hidden');
      const disabled = state.over || modalOpen;
      btn.classList.toggle('is-off', disabled);
      btn.setAttribute('aria-disabled', String(disabled));
      btn.dataset.blocked = modalOpen ? 'Ferme d’abord cette fenêtre.' : '';
      return;
    }
    if (p?.isBot && act !== 'menu') {
      btn.classList.toggle('is-off', true);
      btn.setAttribute('aria-disabled', 'true');
      btn.dataset.blocked = 'C’est au bot de jouer.';
      if (badge) badge.classList.add('hidden');
      return;
    }
    if (act === 'trade') {
      const no = locked || keepBusy || activePlayers().length < 2;
      btn.classList.toggle('is-off', no);
      btn.setAttribute('aria-disabled', String(no));
      btn.dataset.blocked = keepBusy
        ? 'Termine d’abord de payer tes dettes.'
        : no ? (locked ? 'Attends la fin de l’action en cours.' : 'Il faut au moins deux joueurs.') : '';
      return;
    }
    const n = p ? eligibleIdxs(p, act).length : 0;
    if (badge) {
      badge.textContent = String(n);
      badge.classList.toggle('hidden', n < 1);
    }
    const blocked = locked || n < 1;
    btn.classList.toggle('is-off', blocked);
    btn.setAttribute('aria-disabled', String(blocked));
    btn.dataset.blocked = locked ? 'Attends la fin de l’action en cours.' : (n < 1 ? barWhy(p, act) : '');
  });
}

async function onBar(act) {
  if (act !== 'menu' && curP()?.isBot) { showToast('C’est au bot de jouer.'); return; }
  if (act === 'menu') {
    if (!modalRoot.classList.contains('hidden')) { showToast('Ferme d’abord cette fenêtre.'); return; }
    await openGameMenu();
    return;
  }
  if (state.over) return;
  if (act === 'trade') {
    if (keepBusy) { showToast('Termine d’abord de payer tes dettes.'); return; }
    if (state.busy && !state.actionMode) { showToast('Attends la fin de l’action en cours.'); return; }
    if (activePlayers().length < 2) { showToast('Il faut au moins deux joueurs.'); return; }
    if (state.actionMode) finishActionMode();
    await onTrade();
    return;
  }
  const p = actionActor || curP();
  if (!p) return;
  if (state.busy && !state.actionMode) { showToast('Attends la fin de l’action en cours.'); return; }
  const blocked = document.querySelector(`[data-bar="${act}"]`)?.dataset.blocked;
  if (!state.actionMode && blocked) { showToast(blocked); return; }
  if (state.actionMode === act) { finishActionMode(); return; }
  if (state.actionMode) {
    state.actionMode = act;
    actionActor = p;
    $('actionBannerText').textContent = BAR_META[act].prompt;
    renderAll();
    return;
  }
  if (!eligibleIdxs(p, act).length) { showToast(barWhy(p, act)); return; }
  enterActionMode(p, act);
}

async function openGameMenu() {
  if (state.over) return;
  const c = await ask({
    eyebrow: 'MENU', title: 'BoloPoly',
    body: '<p>Règles, nouvelle partie ou abandon du joueur en cours.</p>',
    buttons: [
      { label: 'Règles', value: 'rules', kind: 'secondary' },
      { label: 'Nouvelle partie', value: 'new' },
      { label: 'Abandonner', value: 'quit', kind: 'danger' },
      { label: 'Fermer', value: 'close', kind: 'quiet' }
    ]
  });
  if (c === 'rules') showRules();
  else if (c === 'new') {
    const ok = await ask({
      eyebrow: 'NOUVELLE PARTIE', title: 'Quitter cette partie ?',
      body: '<p>La partie en cours sera perdue.</p>',
      buttons: [{ label: 'Nouvelle partie', value: true }, { label: 'Continuer', value: false, kind: 'quiet' }]
    });
    if (ok) { finishActionMode(); clearSave(); returnToSetup(); }
  } else if (c === 'quit') await onQuit();
}

/* ============================================================
   Argent, dettes, faillite
   ============================================================ */
async function pay(debtor, amount, creditor, reason = '') {
  amount = Math.round(amount);
  if (amount <= 0) return true;
  if (debtor.isBot && debtor.cash < amount) {
    botRaiseCash(debtor, amount);
    renderAll();
    if (debtor.cash < amount) { await bankrupt(debtor, creditor); return false; }
  }
  while (debtor.cash < amount) {
    const acts = ['build', 'sell', 'mortgage', 'unmortgage'];
    const c = await ask({
      eyebrow: 'DETTE', tone: 'danger',
      title: `${esc(debtor.name)} doit ${money(amount)}`,
      body: `<p>${reason ? esc(reason) + '. ' : ''}Il manque <strong>${money(amount - debtor.cash)}</strong>. Vends ou hypothèque depuis le plateau, comme avec la barre d’actions.</p>`,
      buttons: [
        ...acts.map((act) => ({
          label: BAR_META[act].label + (eligibleIdxs(debtor, act).length ? ` · ${eligibleIdxs(debtor, act).length}` : ''),
          value: act,
          kind: 'quiet',
          disabled: !eligibleIdxs(debtor, act).length
        })),
        { label: 'Déclarer faillite', value: 'bankrupt', kind: 'danger' }
      ]
    });
    if (c === 'bankrupt') { await bankrupt(debtor, creditor); return false; }
    await runActionMode(debtor, c);
  }
  debtor.cash -= amount;
  if (creditor === 'tontine') state.tontine += amount;
  else if (creditor) creditor.cash += amount;
  renderAll();
  return true;
}

async function bankrupt(p, creditor) {
  p.eliminated = true;
  const idxs = ownedIdx(p);
  const toPlayer = creditor && creditor !== 'tontine';
  if (toPlayer) {
    creditor.cash += p.cash;
    idxs.forEach((i) => { state.props[i].owner = creditor.id; state.props[i].level = 0; });
    creditor.jailCards.push(...p.jailCards);
  } else {
    idxs.forEach((i) => { state.props[i] = { owner: null, level: 0, mortgaged: false }; });
    if (creditor === 'tontine') state.tontine += p.cash;
    p.jailCards.forEach((jc) => state.decks[jc.deck].discard.push(jc.card));
  }
  p.cash = 0; p.jailCards = []; p.inJail = false;
  log(`${p.name} est en faillite${toPlayer ? ` : ses biens passent à ${creditor.name}` : ' : ses biens retournent à la banque'}.`);
  showToast(`${p.name} est en faillite.`);
  renderAll();
  const alive = activePlayers();
  if (alive.length <= 1) await declareWinner(alive[0] ? `${alive[0].name} remporte BoloPoly !` : 'Personne ne gagne.');
}

async function declareWinner(title) {
  state.over = true;
  finishActionMode();
  renderAll();
  const ranked = [...activePlayers()].sort((a, b) => netWorth(b) - netWorth(a));
  const winner = ranked[0];
  await ask({
    eyebrow: 'FIN DE PARTIE',
    title: esc(title),
    body: winner
      ? `<p class="big-emoji">${charOf(winner).emoji}</p>
         <p>Fortune : <strong>${money(netWorth(winner))}</strong> · ${state.winMode === 'timed' ? `${state.round} / ${state.maxRounds} tours` : `${state.round} tour(s)`}.</p>
         <ol>${ranked.map((q) => `<li>${esc(q.name)} · ${money(netWorth(q))}</li>`).join('')}</ol>`
      : '',
    buttons: [{ label: 'Nouvelle partie', value: true }],
    forceHuman: true
  });
  clearSave();
  returnToSetup();
}

/* ============================================================
   Déplacements
   ============================================================ */
function tempo() {
  const p = curP();
  if (p?.isBot) return { move: 42, dice: 28, spins: 4 };
  return { move: FAST.move, dice: FAST.dice, spins: 7 };
}

async function rollDiceAnimated() {
  const t = tempo();
  for (let k = 0; k < t.spins; k += 1) {
    $('diceOne').textContent = DICE_FACES[rollDie() - 1];
    $('diceTwo').textContent = DICE_FACES[rollDie() - 1];
    $('diceOne').classList.add('tumble'); $('diceTwo').classList.add('tumble');
    await sleep(t.dice);
  }
  state.dice = [rollDie(), rollDie()];
  $('diceOne').classList.remove('tumble'); $('diceTwo').classList.remove('tumble');
  renderTurn();
  $('diceTotal').textContent = String(state.dice[0] + state.dice[1]);
}

function passStart(p) {
  const bonus = CONFIG.passStart + (p.char === 'etudiant' ? 50 * K : 0);
  p.cash += bonus;
  log(`${p.name} passe par Départ : +${money(bonus)}${p.char === 'etudiant' ? ' (bourse incluse)' : ''}.`);
  showToast(`+${money(bonus)} · Départ`);
  const due = Math.min(CONFIG.tontineDues, p.cash);
  p.cash -= due; state.tontine += due;
  log(`${p.name} cotise ${money(due)} à la tontine.`);
}

async function movePlayer(p, steps) {
  for (let k = 0; k < steps; k += 1) {
    p.pos = (p.pos + 1) % SPACES.length;
    if (p.pos === 0) passStart(p);
    state.focus = p.pos;
    renderBoard(); renderTurn(); renderPlayers();
    await sleep(tempo().move);
  }
}
const moveForwardTo = (p, to) => movePlayer(p, (to - p.pos + SPACES.length) % SPACES.length);

async function sendToJail(p) {
  p.pos = 10; p.inJail = true; p.jailTurns = 0; state.doubles = 0; state.focus = 10;
  log(`${p.name} part au violon.`);
  renderAll();
}

/* ============================================================
   Résolution d'une case
   ============================================================ */
async function resolveLanding(p, opts = {}) {
  if (p.eliminated || state.over) return;
  const i = p.pos, s = SPACES[i];
  state.focus = i; renderAll();
  switch (s.type) {
    case 'property': case 'transport': case 'utility': {
      const pr = state.props[i];
      if (pr.owner === null) await offerPurchase(p, i);
      else if (pr.owner === p.id) { log(`${p.name} est chez lui sur ${s.name}.`); setHint('Tu es chez toi.'); }
      else await payRent(p, i, opts.rentMult || 1);
      break;
    }
    case 'tax':
      log(`${p.name} paie ${money(s.amount)} (${s.name}).`);
      await pay(p, s.amount, null, s.name);
      break;
    case 'palabre': await drawCard(p, 'palabre'); break;
    case 'coupe': await drawCard(p, 'coupe'); break;
    case 'tontine': await collectTontine(p); break;
    case 'goToJail':
      await ask({ eyebrow: 'DESCENTE DE POLICE', title: 'Direction le violon', body: '<p>Tu ne touches pas la prime de Départ. Ton tour s’arrête ici.</p>', actor: p, bot: () => true });
      await sendToJail(p);
      break;
    default: break;
  }
}

async function collectTontine(p) {
  if (state.tontine <= 0) {
    log(`${p.name} arrive à la tontine, mais le pot est vide.`);
    setHint('Le pot de la tontine est vide.');
    return;
  }
  const pot = state.tontine;
  state.tontine = 0; p.cash += pot;
  log(`${p.name} ramasse la tontine : +${money(pot)}.`);
  renderAll();
  await ask({ eyebrow: 'TONTINE', title: 'Tu ramasses le pot !', body: `<p class="big-money">+${money(pot)}</p><p>Tous les joueurs recommencent à cotiser.</p>`, actor: p, bot: () => true });
}

async function offerPurchase(p, i) {
  const s = SPACES[i];
  setHint(`${s.name} est libre.`);
  while (true) {
    const price = priceFor(p, i);
    const c = await ask({
      eyebrow: s.type === 'property' ? 'TERRAIN LIBRE' : s.type === 'transport' ? 'LIGNE LIBRE' : 'SERVICE LIBRE',
      title: esc(s.name),
      body: `${propCardHtml(i, { price })}<p class="fine">Ton solde : <strong>${money(p.cash)}</strong>${price !== s.price ? ' · réduction du chauffeur appliquée' : ''}</p>`,
      actor: p,
      bot: () => (p.cash >= price && botWants(p, i) ? 'buy' : 'auction'),
      buttons: [
        { label: `Acheter · ${money(price)}`, value: 'buy', disabled: p.cash < price },
        { label: 'Gérer mes biens', value: 'manage', kind: 'quiet' },
        { label: 'Enchères', value: 'auction', kind: 'secondary' }
      ]
    });
    if (c === 'manage') { await openManage(p); continue; }
    if (c === 'buy') { doBuy(p, i, price); return; }
    await auction(p, i);
    return;
  }
}

function doBuy(p, i, price) {
  p.cash -= price;
  state.props[i].owner = p.id;
  log(`${p.name} achète ${SPACES[i].name} pour ${money(price)}.`);
  if (p.char === 'tech') {
    const back = Math.round(price * 0.1);
    p.cash += back;
    log(`Cashback mobile money : +${money(back)}.`);
  }
  setHint(`${SPACES[i].name} t’appartient.`);
  showToast(`${SPACES[i].name} acheté`);
  renderAll();
}

async function auction(starter, i) {
  const s = SPACES[i];
  let order = activePlayers();
  const start = order.findIndex((q) => q.id === starter.id);
  order = [...order.slice(start + 1), ...order.slice(0, start + 1)];
  let bid = 0, leader = null, idx = 0;
  while (order.length > 0 && !(order.length === 1 && leader)) {
    idx %= order.length;
    const q = order[idx];
    const step = CONFIG.minBid;
    const nexts = bid === 0 ? [step, step * 2, step * 5] : [bid + step / 2, bid + step, bid + step * 5];
    const c = await ask({
      eyebrow: 'ENCHÈRES', title: `${esc(s.name)} · à ${esc(q.name)}`,
      body: `<p>Mise actuelle : <strong>${bid ? money(bid) : 'aucune'}</strong>${leader ? ` (${esc(leader.name)})` : ''}. Solde de ${esc(q.name)} : ${money(q.cash)}.</p>
             <p class="fine">Prix catalogue : ${money(s.price)}. Mise minimale ${money(CONFIG.minBid)}.</p>`,
      actor: q,
      bot: () => botAuctionBid(q, i, nexts, bid),
      buttons: [
        ...nexts.map((n) => ({ label: `Miser ${money(n)}`, value: n, kind: 'secondary', disabled: n > q.cash })),
        { label: 'Passer', value: 0, kind: 'quiet' }
      ]
    });
    if (c === 0) { order.splice(idx, 1); } else { bid = c; leader = q; idx += 1; }
  }
  if (leader) {
    leader.cash -= bid;
    state.props[i].owner = leader.id;
    log(`${leader.name} remporte ${s.name} aux enchères pour ${money(bid)}.`);
    if (leader.char === 'tech') { const back = Math.round(bid * 0.1); leader.cash += back; log(`Cashback mobile money : +${money(back)}.`); }
    showToast(`${s.name} adjugé à ${leader.name}`);
  } else {
    log(`Personne ne mise sur ${s.name} : le terrain reste libre.`);
  }
  renderAll();
}

/* ---------- Loyer et marchandage ---------- */
async function payRent(p, i, mult) {
  const s = SPACES[i], pr = state.props[i], owner = byId(pr.owner);
  if (pr.mortgaged) { log(`${s.name} est hypothéqué : pas de loyer.`); setHint('Terrain hypothéqué : rien à payer.'); return; }
  const { amount, note } = rentFor(i, mult);
  if (amount <= 0) return;
  const c = await ask({
    eyebrow: 'LOYER', title: `${esc(s.name)} appartient à ${esc(owner.name)}`,
    body: `<p class="big-money">${money(amount)}</p><p class="fine">${esc(note)}</p>
           <p>Tu peux payer le tarif plein, ou faire une offre au propriétaire. S’il refuse, un lancer de dés tranche.</p>`,
    actor: p,
    bot: () => (p.diff === 'hard' && p.cash >= amount * 2.2 ? 'pay' : 'bargain'),
    buttons: [{ label: `Payer ${money(amount)}`, value: 'pay' }, { label: '🎲 Marchander', value: 'bargain', kind: 'secondary' }]
  });
  let due = amount;
  if (c === 'bargain') due = await haggle(p, owner, amount);
  log(`${p.name} paie ${money(due)} de loyer à ${owner.name} (${s.name}).`);
  setHint(`Loyer de ${money(due)} payé à ${owner.name}.`);
  await pay(p, due, owner, 'Loyer');
}

function offerList(p) {
  const list = [{ f: 0.8, kind: 'primary' }, { f: 0.6, kind: 'secondary' }];
  if (p.char === 'commercante') list.unshift({ f: 0.9, kind: 'secondary' });
  return list;
}
function counterSteps(offer) {
  const out = [];
  for (let x = Math.round((offer + 0.1) * 10); x < 10; x += 1) out.push(x / 10);
  return out;
}

async function haggle(p, owner, amount) {
  const offer = await ask({
    eyebrow: 'MARCHANDAGE', title: 'Quelle offre fais-tu ?',
    body: `<p>Loyer : <strong>${money(amount)}</strong>. ${esc(owner.name)} peut accepter, contrer, ou laisser les dés trancher (proche du tarif plein en moyenne).</p>`,
    actor: p,
    bot: () => botOfferFactor(p),
    buttons: [
      ...offerList(p).map((o) => ({
        label: `−${Math.round((1 - o.f) * 100)} % · ${money(roundK(amount * o.f))}`,
        value: o.f,
        kind: o.kind
      })),
      { label: 'Annuler', value: 0, kind: 'quiet' }
    ]
  });
  if (!offer) return amount;
  const due = roundK(amount * offer);
  const counters = counterSteps(offer);
  const choice = await ask({
    eyebrow: `À TOI, ${esc(owner.name).toUpperCase()}`,
    title: `${esc(p.name)} propose ${money(due)}`,
    body: `<p>Au lieu de ${money(amount)}. Un refus envoie le dossier aux dés : ni volé, ni cadeau.</p>`,
    actor: owner,
    bot: () => botOwnerReply(owner, offer, counters),
    buttons: [
      { label: 'J’accepte', value: 'ok' },
      ...counters.map((f) => ({ label: `Contre ${money(roundK(amount * f))}`, value: `c:${f}`, kind: 'secondary' })),
      { label: 'Les dés tranchent', value: 'dice', kind: 'quiet' }
    ]
  });
  if (choice === 'ok') { log(`${owner.name} accepte l’offre de ${p.name}.`); return due; }
  if (String(choice).startsWith('c:')) {
    const counter = roundK(amount * Number(String(choice).slice(2)));
    const acc = await ask({
      eyebrow: 'CONTRE-OFFRE', title: `${esc(owner.name)} demande ${money(counter)}`,
      body: `<p>Loyer initial ${money(amount)}. Tu prends ce compromis ?</p>`,
      actor: p,
      bot: () => counter <= amount * (p.diff === 'easy' ? 0.95 : 0.88),
      buttons: [{ label: `Payer ${money(counter)}`, value: true }, { label: 'Les dés tranchent', value: false, kind: 'secondary' }]
    });
    if (acc) { log(`${p.name} accepte la contre-offre de ${owner.name}.`); return counter; }
  }
  log(`${owner.name} et ${p.name} s’en remettent aux dés.`);
  return bargain(p, amount);
}

async function bargain(p, amount) {
  const a = rollDie(), b = rollDie();
  const bonus = CONFIG.bargainBonus[p.char] || 0;
  const t = a + b + bonus;
  const row = CONFIG.bargainTable.find((r) => t >= r.min) || CONFIG.bargainTable[CONFIG.bargainTable.length - 1];
  const due = roundK(amount * row.factor);
  await ask({
    eyebrow: 'MARCHANDAGE', title: row.text,
    body: `<p class="big-dice">${DICE_FACES[a - 1]} ${DICE_FACES[b - 1]}</p>
           <p class="fine">Total ${a + b}${bonus ? ` + ${bonus} (commerçante)` : ''} = ${t}</p>
           <p>Tu paieras <strong>${money(due)}</strong> au lieu de ${money(amount)}.</p>`,
    actor: p,
    bot: () => true
  });
  return due;
}

/* ============================================================
   Cartes
   ============================================================ */
function initDecks() {
  state.decks = {};
  Object.keys(DECKS).forEach((k) => { state.decks[k] = { pile: shuffle(DECKS[k].cards), discard: [] }; });
}

async function drawCard(p, key) {
  const deck = state.decks[key];
  if (!deck.pile.length) { deck.pile = shuffle(deck.discard); deck.discard = []; }
  const card = deck.pile.pop();
  if (!card) return;
  log(`${p.name} tire une carte ${DECKS[key].label} : ${card.text}`);
  setHint(card.text);
  await ask({ eyebrow: `CARTE ${DECKS[key].label.toUpperCase()}`, title: esc(card.text), tone: key, actor: p, bot: () => true });
  if (card.fx.t === 'jailFree') p.jailCards.push({ deck: key, card });
  else deck.discard.push(card);
  await applyCard(p, card.fx);
}

async function applyCard(p, fx) {
  switch (fx.t) {
    case 'gain': p.cash += fx.amount; break;
    case 'pay': await pay(p, fx.amount, null, 'Carte'); break;
    case 'payTontine': await pay(p, fx.amount, 'tontine', 'Cotisation'); break;
    case 'payEach':
      for (const q of activePlayers()) {
        if (q.id === p.id || p.eliminated) continue;
        await pay(p, fx.amount, q, 'Carte');
      }
      break;
    case 'collectEach':
      for (const q of activePlayers()) {
        if (q.id === p.id || q.eliminated || state.over) continue;
        await pay(q, fx.amount, p, 'Carte');
      }
      break;
    case 'allReceive': activePlayers().forEach((q) => { q.cash += fx.amount; }); break;
    case 'repairs': {
      const levels = ownedIdx(p).reduce((n, i) => n + state.props[i].level, 0);
      if (levels === 0) { log('Aucun bâtiment : rien à réparer.'); break; }
      await pay(p, levels * fx.perLevel, null, `${levels} niveau(x) à réparer`);
      break;
    }
    case 'jam':
      activePlayers().forEach((q) => {
        if (!hasNetwork(q)) { q.skip += 1; log(`${q.name} est bloqué dans les embouteillages.`); }
        else log(`${q.name} passe grâce à son réseau de transport.`);
      });
      break;
    case 'jailFree': break;
    case 'goJail': await sendToJail(p); break;
    case 'back':
      p.pos = (p.pos - fx.n + SPACES.length) % SPACES.length;
      renderAll();
      await resolveLanding(p);
      break;
    case 'moveTo': await moveForwardTo(p, fx.to); await resolveLanding(p); break;
    case 'nearestTransport': {
      const next = TRANSPORT_INDEXES.find((t) => t > p.pos);
      await moveForwardTo(p, next === undefined ? TRANSPORT_INDEXES[0] : next);
      await resolveLanding(p, { rentMult: 2 });
      break;
    }
    case 'collectPerOwned': {
      const n = ownedIdx(p).filter((i) => GROUPS[SPACES[i].group] && GROUPS[SPACES[i].group].kind === fx.kind).length;
      p.cash += fx.base + fx.per * n;
      log(`${p.name} encaisse ${money(fx.base + fx.per * n)} (${n} terrain(s) agricole(s)).`);
      break;
    }
    case 'utilityFee': {
      const idx = SPACES.findIndex((s) => s.key === fx.key);
      const owner = state.props[idx].owner;
      await pay(p, fx.amount, owner === null || owner === p.id ? null : byId(owner), SPACES[idx].name);
      break;
    }
    case 'collectTontine': await collectTontine(p); break;
    default: break;
  }
  renderAll();
}

/* ============================================================
   Gestion des biens (construire, vendre, hypothéquer)
   ============================================================ */
function openManage(p) {
  return new Promise((resolve) => {
    const modal = openModalShell({ eyebrow: 'MES BIENS', title: `Patrimoine de ${esc(p.name)}`, wide: true, body: '' });
    const body = modal.querySelector('.modal-body');
    const draw = () => {
      const idxs = ownedIdx(p);
      let html = `<div class="mg-top"><span>Solde</span><strong>${money(p.cash)}</strong><span>Fortune</span><strong>${money(netWorth(p))}</strong></div>`;
      if (!idxs.length) html += '<p class="fine">Tu ne possèdes encore aucun bien.</p>';
      const groups = [...new Set(idxs.map((i) => SPACES[i].group))];
      groups.forEach((g) => {
        const full = ownsFull(p, g) && GROUPS[g].kind !== 'transport' && GROUPS[g].kind !== 'service';
        html += `<div class="mg-group"><div class="mg-gh"><i class="chip" style="background:${GROUPS[g].color}"></i>${GROUPS[g].label}${full ? '<span class="badge">Groupe complet</span>' : ''}</div>`;
        idxs.filter((i) => SPACES[i].group === g).forEach((i) => {
          const s = SPACES[i], pr = state.props[i];
          const b = buildCheck(p, i), sl = sellCheck(i), mg = mortgageCheck(i);
          const status = pr.mortgaged ? 'Hypothéqué'
            : s.type === 'property' ? `${TIERS[GROUPS[g].kind][pr.level]} · loyer ${money(rentFor(i).amount)}`
            : s.type === 'transport' ? `Loyer ${money(rentFor(i).amount)}` : 'Loyer selon les dés';
          const unCost = unmortgageCost(i);
          html += `<div class="mg-row"><div class="mg-name"><strong>${esc(s.name)}</strong><small>${status}</small></div><div class="mg-actions">
            ${s.type === 'property' ? `<button class="btn mini secondary" data-act="build" data-i="${i}" ${b.ok ? '' : 'disabled'} title="${esc(b.why || '')}">+ ${money(s.buildCost)}</button>
            <button class="btn mini quiet" data-act="sell" data-i="${i}" ${sl.ok ? '' : 'disabled'} title="${esc(sl.why || '')}">Vendre +${money(s.buildCost / 2)}</button>` : ''}
            ${pr.mortgaged
              ? `<button class="btn mini" data-act="unmortgage" data-i="${i}" ${p.cash >= unCost ? '' : 'disabled'}>Lever −${money(unCost)}</button>`
              : `<button class="btn mini quiet" data-act="mortgage" data-i="${i}" ${mg.ok ? '' : 'disabled'} title="${esc(mg.why || '')}">Hypothéquer +${money(s.price * CONFIG.mortgageRate)}</button>`}
          </div></div>`;
        });
        html += '</div>';
      });
      html += '<p class="fine">Pour construire : posséder tout le groupe, sans hypothèque, en construisant à égalité. Les bâtiments se revendent à moitié prix.</p>';
      body.innerHTML = html;
    };
    body.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn || btn.disabled) return;
      const i = Number(btn.dataset.i), s = SPACES[i], pr = state.props[i];
      switch (btn.dataset.act) {
        case 'build': {
          const chk = buildCheck(p, i);
          if (!chk.ok) break;
          p.cash -= chk.cost; pr.level += 1;
          log(`${p.name} construit à ${s.name} : ${TIERS[GROUPS[s.group].kind][pr.level]}.`);
          if (p.char === 'tech') { p.cash += Math.round(chk.cost * 0.1); }
          break;
        }
        case 'sell': { const chk = sellCheck(i); if (chk.ok) { pr.level -= 1; p.cash += chk.gain; log(`${p.name} revend un bâtiment à ${s.name}.`); } break; }
        case 'mortgage': { const chk = mortgageCheck(i); if (chk.ok) { pr.mortgaged = true; p.cash += chk.gain; log(`${p.name} hypothèque ${s.name}.`); } break; }
        case 'unmortgage': { const c = unmortgageCost(i); if (p.cash >= c) { p.cash -= c; pr.mortgaged = false; log(`${p.name} lève l’hypothèque de ${s.name}.`); } break; }
        default: break;
      }
      draw(); renderAll();
    });
    addButtons(modal.querySelector('.modal-foot'), [{ label: 'Fermer', value: true }], () => { closeModal(); resolve(); });
    draw();
  });
}

/* ============================================================
   Échanges
   ============================================================ */
async function openTrade(p) {
  const others = activePlayers().filter((o) => o.id !== p.id);
  let q;
  if (others.length === 1) q = others[0];
  else {
    const id = await ask({
      eyebrow: 'ÉCHANGE', title: 'Avec qui veux-tu échanger ?',
      buttons: [...others.map((o) => ({ label: `${charOf(o).emoji} ${o.name}`, value: o.id, kind: 'secondary' })), { label: 'Annuler', value: -1, kind: 'quiet' }]
    });
    if (id < 0) return;
    q = byId(id);
  }
  const tradable = (pl) => ownedIdx(pl).filter((i) => !groupHasBuildings(SPACES[i].group));
  const list = (pl, side) => {
    const items = tradable(pl);
    return items.length
      ? items.map((i) => `<label class="tr-item"><input type="checkbox" data-side="${side}" value="${i}"><i class="chip" style="background:${GROUPS[SPACES[i].group].color}"></i>${esc(SPACES[i].name)}${state.props[i].mortgaged ? ' <small>(hypothéqué)</small>' : ''}</label>`).join('')
      : '<p class="fine">Rien à échanger (les terrains avec bâtiments sont exclus).</p>';
  };
  const read = (root) => ({
    give: [...root.querySelectorAll('input[data-side="give"]:checked')].map((x) => Number(x.value)),
    get: [...root.querySelectorAll('input[data-side="get"]:checked')].map((x) => Number(x.value)),
    cashGive: Math.max(0, Number(root.querySelector('#trCashGive').value) || 0),
    cashGet: Math.max(0, Number(root.querySelector('#trCashGet').value) || 0)
  });
  const offer = await ask({
    eyebrow: 'ÉCHANGE', title: `${esc(p.name)} et ${esc(q.name)}`, wide: true,
    body: `<div class="tr-cols">
      <div><h4>Tu donnes</h4>${list(p, 'give')}<label class="tr-cash">Argent (F)<input id="trCashGive" type="number" min="0" step="5000" value="0"></label></div>
      <div><h4>Tu reçois</h4>${list(q, 'get')}<label class="tr-cash">Argent (F)<input id="trCashGet" type="number" min="0" step="5000" value="0"></label></div></div>`,
    buttons: [
      { label: 'Proposer', valueFn: () => read(modalRoot), validate: (v) => (!v.give.length && !v.get.length && !v.cashGive && !v.cashGet) ? 'Choisis au moins un élément.' : v.cashGive > p.cash ? 'Tu n’as pas cette somme.' : v.cashGet > q.cash ? `${q.name} n’a pas cette somme.` : null },
      { label: 'Annuler', value: null, kind: 'quiet' }
    ]
  });
  if (!offer) return;
  const names = (a) => (a.length ? a.map((i) => esc(SPACES[i].name)).join(', ') : 'rien');
  const ok = await ask({
    eyebrow: 'PROPOSITION', title: `${esc(q.name)}, tu acceptes ?`,
    body: `<p><strong>${esc(p.name)}</strong> te donne : ${names(offer.give)}${offer.cashGive ? ` + ${money(offer.cashGive)}` : ''}.</p>
           <p>Il demande : ${names(offer.get)}${offer.cashGet ? ` + ${money(offer.cashGet)}` : ''}.</p>`,
    actor: q,
    bot: () => botAcceptTrade(q, offer),
    buttons: [{ label: 'Accepter', value: true }, { label: 'Refuser', value: false, kind: 'quiet' }]
  });
  if (!ok) { log(`${q.name} refuse l’échange proposé par ${p.name}.`); showToast('Échange refusé'); return; }
  offer.give.forEach((i) => { state.props[i].owner = q.id; });
  offer.get.forEach((i) => { state.props[i].owner = p.id; });
  p.cash += offer.cashGet - offer.cashGive; q.cash += offer.cashGive - offer.cashGet;
  log(`Échange conclu entre ${p.name} et ${q.name}.`);
  showToast('Échange conclu');
  renderAll();
}

/* ============================================================
   Tour de jeu
   ============================================================ */
async function normalRoll(p) {
  await rollDiceAnimated();
  const [a, b] = state.dice;
  const dbl = a === b;
  log(`${p.name} lance ${a} + ${b}.`);
  if (dbl) {
    state.doubles += 1;
    if (state.doubles >= 3) {
      await ask({ eyebrow: 'TROP DE DOUBLES', title: 'Trois doubles de suite', body: '<p>Ça paraît louche à la police. Direction le violon.</p>', actor: p, bot: () => true });
      await sendToJail(p);
      return false;
    }
  }
  let steps = a + b;
  if (hasNetwork(p)) {
    const opts = [...new Set([a + b, a, b])];
    if (opts.length > 1) {
      steps =       await ask({
        eyebrow: 'RÉSEAU DE TRANSPORT', title: 'Choisis ton trajet',
        body: `<p>Grâce à tes lignes, tu peux avancer de la somme des dés ou d’un seul dé.</p>`,
        actor: p,
        bot: () => botPickSteps(p, opts),
        buttons: opts.map((n) => ({ label: `${n} case${n > 1 ? 's' : ''} → ${SPACES[(p.pos + n) % SPACES.length].name}`, value: n, kind: n === a + b ? 'primary' : 'secondary' }))
      });
    }
  }
  await movePlayer(p, steps);
  await resolveLanding(p);
  return dbl;
}

async function jailTurn(p) {
  while (true) {
    const c = await ask({
      eyebrow: `AU VIOLON · ESSAI ${p.jailTurns + 1} SUR 3`, tone: 'danger', title: 'Comment sortir ?',
      body: `<p>Verse la caution (${money(CONFIG.jailBail)}), utilise une carte, ou tente un double. Au troisième échec, la caution est obligatoire.</p>`,
      actor: p,
      bot: () => botJailChoice(p),
      buttons: [
        { label: `Payer la caution · ${money(CONFIG.jailBail)}`, value: 'pay', disabled: p.cash < CONFIG.jailBail },
        ...(p.jailCards.length ? [{ label: 'Carte Sortie du violon', value: 'card', kind: 'secondary' }] : []),
        { label: '🎲 Tenter un double', value: 'roll', kind: 'secondary' },
        { label: 'Gérer mes biens', value: 'manage', kind: 'quiet' }
      ]
    });
    if (c === 'manage') { await openManage(p); continue; }
    if (c === 'pay') {
      await pay(p, CONFIG.jailBail, null, 'Caution');
      if (p.eliminated) return 'dead';
      p.inJail = false; log(`${p.name} paie la caution et sort.`); return 'free';
    }
    if (c === 'card') {
      const jc = p.jailCards.shift();
      state.decks[jc.deck].discard.push(jc.card);
      p.inJail = false; log(`${p.name} sort du violon grâce à une carte.`); return 'free';
    }
    await rollDiceAnimated();
    const [a, b] = state.dice;
    log(`${p.name} tente un double : ${a} et ${b}.`);
    if (a === b) { p.inJail = false; log(`${p.name} sort du violon avec un double.`); await movePlayer(p, a + b); await resolveLanding(p); return 'moved'; }
    p.jailTurns += 1;
    if (p.jailTurns >= 3) {
      await ask({ eyebrow: 'TROISIÈME ÉCHEC', title: 'Caution obligatoire', body: `<p>Tu paies ${money(CONFIG.jailBail)} et tu avances de ${a + b} cases.</p>`, actor: p, bot: () => true });
      await pay(p, CONFIG.jailBail, null, 'Caution');
      if (p.eliminated) return 'dead';
      p.inJail = false; await movePlayer(p, a + b); await resolveLanding(p); return 'moved';
    }
    await ask({ eyebrow: 'RATÉ', title: 'Pas de double', body: '<p>Tu restes au violon. Ton tour s’arrête.</p>', actor: p, bot: () => true });
    return 'stay';
  }
}

async function onRoll() {
  if (state.busy || state.over || state.hasRolled) return;
  const p = curP();
  state.busy = true; updateControls();
  let again = false;
  try {
    if (p.inJail) {
      const r = await jailTurn(p);
      if (r === 'free') again = await normalRoll(p);
    } else {
      again = await normalRoll(p);
    }
  } catch (err) { console.error(err); showToast('Erreur inattendue : voir la console.'); }
  if (state.over) { state.busy = false; return; }
  if (p.eliminated || p.inJail) { await advanceTurn(); return; }
  if (p.inJail === false && again && !p.eliminated) {
    state.hasRolled = false; setHint('Double ! Tu rejoues.'); showToast('Double : rejoue');
  } else { state.hasRolled = true; state.doubles = 0; setHint(p.isBot ? 'Le bot termine son tour.' : 'Termine ton tour quand tu es prêt.'); }
  state.busy = false;
  renderAll();
  persistSoon();
}

async function changeSeason(announce) {
  const pool = SEASONS.filter((s) => s.id !== state.season);
  const next = pool[Math.floor(Math.random() * pool.length)] || SEASONS[0];
  state.season = next.id;
  log(`Nouvelle saison : ${next.name}. ${next.blurb}`);
  if (announce) {
    await ask({
      eyebrow: 'SAISON EN VILLE', title: `${next.icon} ${esc(next.name)}`,
      body: `<p>${esc(next.blurb)}</p>`,
      actor: curP(),
      bot: () => true
    });
  }
  renderAll();
}

async function beginTurn() {
  const p = curP();
  state.hasRolled = false; state.doubles = 0; state.focus = p.pos;
  hideDeed();
  state.busy = true; renderAll();
  if (state.over) return;
  if (p.skip > 0) {
    p.skip -= 1;
    await ask({ eyebrow: 'EMBOUTEILLAGE', title: `${esc(p.name)} est coincé dans les bouchons`, body: '<p>Tu passes ton tour. Une deuxième ligne de transport t’éviterait ça.</p>', actor: p, bot: () => true });
    await advanceTurn(); return;
  }
  state.busy = false;
  setHint(p.isBot ? 'Le bot réfléchit…' : (p.inJail ? 'Tu es au violon. Joue ton tour pour tenter d’en sortir.' : 'Lance les dés.'));
  renderAll();
  persistSoon();
  if (p.isBot) setTimeout(() => { if (!state.over && curP()?.id === p.id && curP()?.isBot) botPlayTurn(); }, 0);
}

async function advanceTurn() {
  if (state.over) return;
  state.busy = true;
  do {
    state.cur = (state.cur + 1) % state.players.length;
    if (state.cur === 0) {
      if (state.winMode === 'timed' && state.round >= state.maxRounds) {
        const ranked = [...activePlayers()].sort((a, b) => netWorth(b) - netWorth(a));
        await declareWinner(`Temps écoulé : ${ranked[0] ? ranked[0].name : 'personne'} gagne !`);
        return;
      }
      state.round += 1;
      if ((state.round - 1) % CONFIG.seasonEvery === 0) await changeSeason(true);
    }
  } while (curP().eliminated);
  await beginTurn();
}

async function onEndTurn() {
  if (state.busy || !state.hasRolled || state.over) return;
  await advanceTurn();
}

async function onTrade() {
  if (state.busy || state.over) return;
  state.busy = true; updateControls();
  await openTrade(curP());
  state.busy = false; renderAll();
}

async function onQuit() {
  if (state.over) return;
  if (state.busy && !state.actionMode) return;
  const p = curP();
  if (state.actionMode) finishActionMode();
  state.busy = true; updateControls();
  const ok = await ask({ eyebrow: 'ABANDON', tone: 'danger', title: `${esc(p.name)} abandonne ?`, body: '<p>Tes biens retournent à la banque.</p>', buttons: [{ label: 'Abandonner', value: true, kind: 'danger' }, { label: 'Annuler', value: false, kind: 'quiet' }] });
  if (ok) {
    await bankrupt(p, null);
    if (!state.players.length) return;
    if (!state.over) { await advanceTurn(); return; }
    return;
  }
  state.busy = false; renderAll();
}

/* ============================================================
   Préparation de la partie
   ============================================================ */
function renderSetup() {
  normalizeColors();
  const box = $('playerNames');
  box.innerHTML = '';
  for (let i = 0; i < setup.count; i += 1) {
    const sel = CHARACTERS.find((c) => c.id === setup.chars[i]);
    const block = document.createElement('div');
    block.className = 'pl-block';
    block.style.setProperty('--pc', PLAYER_COLORS[setup.colors[i]]);
    const bot = setup.kinds[i] === 'bot';
    block.innerHTML = `
      <label class="name-field"><span><i class="name-color"></i>Joueur ${i + 1}</span>
        <input class="name-input" id="playerName${i}" type="text" maxlength="18" autocomplete="off" placeholder="${bot ? 'Nom du bot' : 'Nom du joueur ' + (i + 1)}" value="${esc(setup.names[i])}"></label>
      <div class="color-row" role="radiogroup" aria-label="Couleur du joueur ${i + 1}">
        ${PLAYER_COLORS.map((c, k) => {
          const holder = setup.colors.findIndex((x, j) => x === k && j < setup.count && j !== i);
          return `<button type="button" class="color-opt${setup.colors[i] === k ? ' on' : ''}${holder >= 0 ? ' taken' : ''}" data-p="${i}" data-col="${k}" style="--c:${c}" role="radio" aria-checked="${setup.colors[i] === k}" aria-label="${COLOR_NAMES[k]}" title="${COLOR_NAMES[k]}${holder >= 0 ? ' (prise par le joueur ' + (holder + 1) + ' : un clic échange)' : ''}"></button>`;
        }).join('')}
      </div>
      <div class="seat-row">
        <div class="kind-toggle" role="group" aria-label="Humain ou bot">
          <button type="button" class="${bot ? '' : 'on'}" data-kind="human" data-p="${i}">Humain</button>
          <button type="button" class="${bot ? 'on' : ''}" data-kind="bot" data-p="${i}">Bot</button>
        </div>
        <label class="${bot ? '' : 'hidden'}">Niveau
          <select data-diff="${i}">
            ${Object.keys(BOT_DIFF).map((k) => `<option value="${k}" ${setup.diffs[i] === k ? 'selected' : ''}>${BOT_DIFF[k].label}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="char-grid" role="radiogroup" aria-label="Personnage du joueur ${i + 1}">
        ${CHARACTERS.map((c) => `<button type="button" class="char-opt${c.id === sel.id ? ' on' : ''}" data-p="${i}" data-c="${c.id}" role="radio" aria-checked="${c.id === sel.id}"><span>${c.emoji}</span>${c.short}</button>`).join('')}
      </div>
      <p class="char-power"><strong>${sel.name}.</strong> ${sel.power}</p>`;
    box.appendChild(block);
  }
  box.querySelectorAll('.name-input').forEach((inp, i) => inp.addEventListener('input', () => { setup.names[i] = inp.value; }));
  box.querySelectorAll('[data-kind]').forEach((btn) => btn.addEventListener('click', () => {
    setup.kinds[Number(btn.dataset.p)] = btn.dataset.kind;
    renderSetup();
  }));
  box.querySelectorAll('select[data-diff]').forEach((selEl) => selEl.addEventListener('change', () => {
    setup.diffs[Number(selEl.dataset.diff)] = selEl.value;
  }));
  box.querySelectorAll('.color-opt').forEach((btn) => btn.addEventListener('click', () => {
    const pi = Number(btn.dataset.p), col = Number(btn.dataset.col);
    const holder = setup.colors.findIndex((x, k) => x === col && k < setup.count && k !== pi);
    if (holder >= 0) setup.colors[holder] = setup.colors[pi];
    setup.colors[pi] = col;
    renderSetup();
  }));
  box.querySelectorAll('.char-opt').forEach((btn) => btn.addEventListener('click', () => {
    const pi = Number(btn.dataset.p), cid = btn.dataset.c;
    const holder = setup.chars.findIndex((c, k) => c === cid && k < setup.count && k !== pi);
    if (holder >= 0) setup.chars[holder] = setup.chars[pi];
    setup.chars[pi] = cid;
    renderSetup();
  }));
}

function showTable() {
  $('setupSection').classList.add('hidden');
  $('heroSection').classList.add('hidden');
  $('gamePanel').classList.remove('hidden');
  $('actionBar').classList.remove('hidden');
  document.body.classList.add('playing');
}
function startClock() {
  clearInterval(state.clockTimer);
  state.clockTimer = setInterval(() => { if ($('clock')) $('clock').textContent = clock(); }, 1000);
}

function startGame() {
  const humans = setup.kinds.slice(0, setup.count).filter((k) => k === 'human').length;
  if (humans < 1) { showToast('Il faut au moins un joueur humain.'); return; }
  clearSave();
  state.players = Array.from({ length: setup.count }, (_, i) => {
    const isBot = setup.kinds[i] === 'bot';
    const ch = CHARACTERS.find((c) => c.id === setup.chars[i]);
    return {
      id: i,
      name: (setup.names[i] || '').trim() || (isBot ? `Bot · ${ch.short}` : `Joueur ${i + 1}`),
      color: PLAYER_COLORS[setup.colors[i]], char: setup.chars[i],
      cash: CONFIG.startingCash, pos: 0, inJail: false, jailTurns: 0, skip: 0, jailCards: [],
      eliminated: false, isBot, diff: setup.diffs[i] || 'normal'
    };
  });
  state.t0 = Date.now();
  startClock();
  Object.assign(state, {
    cur: 0, round: 1, props: freshProps(), tontine: 0, hasRolled: false, doubles: 0, dice: [1, 1],
    focus: 0, over: false, busy: false, actionMode: null, logLines: [],
    winMode: setup.winMode, maxRounds: setup.maxRounds, season: 'calm'
  });
  initDecks();
  $('gameLog').innerHTML = '';
  showTable();
  createBoard();
  changeSeason(false);
  log(`La partie commence. Chaque joueur reçoit ${money(CONFIG.startingCash)}.`);
  persistSoon();
  beginTurn();
}

function resumeGame() {
  const data = readSave();
  if (!data) { showToast('Aucune sauvegarde.'); return; }
  const decks = {};
  let ok = true;
  Object.keys(DECKS).forEach((k) => {
    const pile = (data.decks?.[k]?.pile || []).map((t) => cardByText(k, t));
    const discard = (data.decks?.[k]?.discard || []).map((t) => cardByText(k, t));
    if (pile.some((c) => !c) || discard.some((c) => !c)) ok = false;
    decks[k] = { pile, discard };
  });
  if (!ok) { showToast('Sauvegarde trop ancienne, nouvelle partie.'); clearSave(); paintResume(); return; }
  state.players = data.players.map((p) => ({
    ...p,
    jailCards: (p.jailCards || []).map((jc) => {
      const card = cardByText(jc.deck, jc.text);
      return card ? { deck: jc.deck, card } : null;
    }).filter(Boolean)
  }));
  Object.assign(state, {
    cur: data.cur, round: data.round, props: data.props, tontine: data.tontine,
    hasRolled: data.hasRolled, doubles: data.doubles, dice: data.dice, focus: data.focus,
    over: false, busy: false, actionMode: null, decks,
    winMode: data.winMode, maxRounds: data.maxRounds, season: data.season || 'calm',
    logLines: data.logLines || [], t0: Date.now() - (data.elapsed || 0)
  });
  startClock();
  showTable();
  createBoard();
  paintLog();
  renderAll();
  if ($('clock')) $('clock').textContent = clock();
  if (!state.hasRolled) beginTurn();
  else persistSoon();
}

function returnToSetup() {
  if (typeof goScreen === 'function') goScreen('setup');
  closeModal();
  hideTileConfirm(true);
  state.actionMode = null;
  actionActor = null;
  actionWait = null;
  keepBusy = false;
  $('actionBanner').classList.add('hidden');
  $('actionBar').classList.add('hidden');
  setBigBoard(false);
  document.body.classList.remove('playing');
  Object.assign(state, { players: [], over: false, busy: false, actionMode: null });
  $('gamePanel').classList.add('hidden');
  $('setupSection').classList.remove('hidden');
  $('heroSection').classList.remove('hidden');
  renderSetup();
  window.scrollTo({ top: 0 });
}

function showRules() {
  ask({
    eyebrow: 'RÈGLES', title: 'Comment on joue à BoloPoly', wide: true,
    body: `<div class="rules">
      <p>Chaque joueur reçoit un personnage et 1 500 000 F. On lance les dés, on achète des terrains, on perçoit des loyers. Fin de partie : dernier debout, ou le plus riche après N tours.</p>
      <ul>
        <li><strong>Départ</strong> : 200 000 F à chaque passage.</li>
        <li><strong>Terrains et groupes</strong> : posséder un groupe complet double le loyer du terrain nu et permet de construire (étal, maquis, restaurant, immeuble, grand complexe). Les terres agricoles ont leurs propres bâtiments.</li>
        <li><strong>Marchandage</strong> : tu proposes −20 % ou −40 % (la commerçante a aussi −10 %). Le propriétaire accepte, contre, ou laisse les dés décider. Le jet est proche du tarif plein en moyenne (−30 % à +30 %).</li>
        <li><strong>Tontine</strong> : chacun cotise 20 000 F à chaque passage par Départ. Celui qui s’arrête sur la case tontine ramasse le pot.</li>
        <li><strong>Transports</strong> : avec 2 lignes (1 pour le chauffeur), tu choisis ton trajet et tu évites les embouteillages.</li>
        <li><strong>Services</strong> : SODECI et CIE. Loyer = dés × 4 000 F, ou × 10 000 F avec les deux.</li>
        <li><strong>Cartes</strong> : Palabre (obligations, imprévus) et Coupé-Décalé (fêtes, bonnes surprises).</li>
        <li><strong>Violon</strong> : caution de 50 000 F, carte « Sortie du violon » ou un double (3 essais). Trois doubles de suite mènent au violon.</li>
        <li><strong>Banque</strong> : le nombre de niveaux de construction est limité à 36.</li>
        <li><strong>Enchères</strong> : si tu refuses d’acheter un terrain, tout le monde peut miser.</li>
        <li><strong>Barre d’actions</strong> : Construire, Vendre, Hypothéquer, Déshypothéquer, Échanger. Clique un terrain qui clignote, confirme, enchaîne, puis Terminé ou Échap.</li>
        <li><strong>Dettes</strong> : si tu ne peux pas payer, les mêmes actions s’ouvrent. Sinon c’est la faillite.</li>
        <li><strong>Saisons</strong> : toutes les ${CONFIG.seasonEvery} tours, un événement de ville (cacao, Nord, grève des gbakas, CAN) change les loyers. Le bandeau au centre du plateau l’affiche.</li>
        <li><strong>Bots</strong> : chaque siège peut être humain ou bot (facile, normal, difficile). Le bot achète, construit, marchande et hypothèque selon son niveau et son personnage.</li>
        <li><strong>Sauvegarde</strong> : la partie se enregistre toute seule sur cet appareil. Tu peux la reprendre après un rafraîchissement.</li>
      </ul></div>`,
    buttons: [{ label: 'Compris', value: true }]
  });
}

/* ---------- Branchements ---------- */
function syncSetupMode() {
  const timed = $('gameMode').value === 'timed';
  setup.winMode = timed ? 'timed' : 'last';
  setup.maxRounds = Math.max(5, Math.min(99, Number($('maxRounds').value) || CONFIG.defaultMaxRounds));
  $('roundsField').classList.toggle('hidden', !timed);
  $('modeHint').textContent = timed
    ? `Au bout de ${setup.maxRounds} tours, le plus riche (argent + biens) gagne.`
    : 'Le dernier joueur encore solvable gagne. Choisis « Durée limitée » pour arrêter après N tours.';
}
$('playerCount').addEventListener('change', (e) => { setup.count = Number(e.target.value); renderSetup(); });
$('gameMode').addEventListener('change', syncSetupMode);
$('maxRounds').addEventListener('input', syncSetupMode);
$('startGameBtn').addEventListener('click', startGame);
$('resumeBtn').addEventListener('click', resumeGame);
$('discardSaveBtn').addEventListener('click', () => { clearSave(); paintResume(); });
$('rollBtn').addEventListener('click', onRoll);
$('endTurnBtn').addEventListener('click', onEndTurn);
$('actionBar').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-bar]');
  if (btn) onBar(btn.dataset.bar);
});
$('actionDoneBtn').addEventListener('click', () => finishActionMode());
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('tileConfirm').classList.contains('hidden') || state.actionMode) {
    e.preventDefault();
    finishActionMode();
  }
});
$('rulesBtn').addEventListener('click', () => { if (!state.busy || !state.players.length) showRules(); });

window.addEventListener('beforeunload', persist);
syncSetupMode();
renderSetup();
paintResume();
createBoard();

/* ============================================================
   Plein écran du navigateur (la mise en page grand plateau est déjà active pendant la partie)
   ============================================================ */
function setBigBoard(on) {
  const el = document.documentElement;
  try {
    if (on) {
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req && !document.fullscreenElement) Promise.resolve(req.call(el)).catch(() => {});
    } else if (document.fullscreenElement) {
      document.exitFullscreen();
    }
  } catch (e) { /* le navigateur refuse */ }
}
const syncFsBtn = () => {
  const on = !!document.fullscreenElement, btn = $('fsBtn');
  btn.textContent = on ? '⤡ Quitter' : '⛶ Plein écran';
  btn.setAttribute('aria-pressed', String(on));
};
if (!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)) $('fsBtn').classList.add('hidden');
$('fsBtn').addEventListener('click', () => setBigBoard(!document.fullscreenElement));
document.addEventListener('fullscreenchange', syncFsBtn);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'f' && e.key !== 'F') return;
  if (e.ctrlKey || e.metaKey || e.altKey || !document.body.classList.contains('playing')) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) return;
  setBigBoard(!document.fullscreenElement);
});
