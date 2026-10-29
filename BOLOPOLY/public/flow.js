'use strict';

/* ============================================================
   BOLOPOLY — parcours avant la partie (écrans en étapes)
   Chargé après script.js et avant online.js.
   Les fonctions qui touchent à ONLINE ne tournent qu'une fois la page prête.
   ============================================================ */

const FLOW = { step: 'home', mode: 'local', heroSeat: 0 };

const STEP_LABELS = {
  mode: 'Mode de jeu', lobby: 'Salon en ligne', rules: 'La partie', seats: 'Les joueurs',
  heroes: 'Les personnages', recap: 'Lancement',
  'join-code': 'Le code', 'join-profile': 'Ton profil', 'join-wait': 'Salle d’attente'
};
const JOIN_PATH = ['join-code', 'join-profile', 'join-wait'];
const flowPath = (step) => (step === 'home' ? [] : JOIN_PATH.includes(step) ? JOIN_PATH
  : (FLOW.mode === 'online' ? ['mode', 'lobby', 'rules', 'seats', 'heroes', 'recap'] : ['mode', 'rules', 'seats', 'heroes', 'recap']));

const chById = (id) => CHARACTERS.find((c) => c.id === id);
const isRemoteSeat = (i) => ONLINE.role === 'host' && i === 1;
const isHostOnline = () => ONLINE.role === 'host';
function seatName(i) {
  const typed = (setup.names[i] || '').trim();
  if (typed) return typed;
  const ch = chById(setup.chars[i]);
  if (isRemoteSeat(i)) return 'Invité';
  return setup.kinds[i] === 'bot' ? `Bot · ${ch.short}` : `Joueur ${i + 1}`;
}

/* ---------- Navigation ---------- */
function goScreen(name, opts = {}) {
  const prev = FLOW.step, path = flowPath(name), prevPath = flowPath(prev);
  let dir = 'fwd';
  if (opts.dir) dir = opts.dir;
  else if (path === prevPath && path.indexOf(name) < path.indexOf(prev)) dir = 'back';
  FLOW.step = name;
  const flow = $('flow');
  flow.dataset.step = name;
  flow.dataset.dir = dir;
  document.body.dataset.screen = name;
  document.querySelectorAll('#flow .step').forEach((s) => s.classList.toggle('is-active', s.dataset.step === name));
  renderFlow();
  window.scrollTo(0, 0);
  const stage = document.querySelector('.flow-stage');
  if (stage) stage.scrollTop = 0;
  if (opts.focus !== false) {
    const h = document.querySelector(`#flow .step[data-step="${name}"] h2`);
    if (h) h.focus({ preventScroll: true });
  }
}

function renderRail() {
  const path = flowPath(FLOW.step), at = path.indexOf(FLOW.step);
  $('stepRail').innerHTML = path.map((s, i) => `
    <li class="${i < at ? 'done' : i === at ? 'now' : 'todo'}"${i === at ? ' aria-current="step"' : ''}>
      <span class="n">${i < at ? '✓' : i + 1}</span><span class="l">${STEP_LABELS[s]}</span>
    </li>`).join('');
  $('ftBar').style.width = path.length ? `${((at + 1) / path.length) * 100}%` : '0%';
  $('ftCount').textContent = path.length ? `Étape ${at + 1} sur ${path.length}` : '';
}

/* ---------- Rendu par étape ---------- */
function renderFlow() {
  normalizeColors();
  renderRail();
  switch (FLOW.step) {
    case 'home': paintResume(); break;
    case 'mode': renderMode(); break;
    case 'lobby': renderLobby(); break;
    case 'rules': renderRules(); break;
    case 'seats': renderSeats(); break;
    case 'heroes': renderHeroes(); break;
    case 'recap': renderRecap(); break;
    case 'join-profile': renderJoinProfile(); break;
    default: break;
  }
  updateFoot();
}

function renderMode() {
  const online = FLOW.mode === 'online';
  [['modeLocal', !online], ['modeOnline', online]].forEach(([id, on]) => {
    $(id).classList.toggle('on', on);
    $(id).setAttribute('aria-checked', String(on));
  });
}

function renderLobby() {
  const chip = $('lobbyGuest');
  if (isHostOnline() && ONLINE.peer) {
    const ch = chById(setup.chars[1]);
    chip.innerHTML = `<span class="gc-dot" style="--pc:${PLAYER_COLORS[setup.colors[1]]}">${ch.emoji}</span><span><strong>${esc(seatName(1))}</strong> est connecté<small>${esc(ch.name)}</small></span>`;
    chip.classList.remove('hidden');
  } else chip.classList.add('hidden');
}

function renderRules() {
  $('countSeg').innerHTML = [2, 3, 4].map((n) => `<button type="button" role="radio" aria-checked="${setup.count === n}" data-count="${n}" class="${setup.count === n ? 'on' : ''}"><strong>${n}</strong><small>joueurs</small></button>`).join('');
  const timed = setup.winMode === 'timed';
  [['endLast', !timed], ['endTimed', timed]].forEach(([id, on]) => { $(id).classList.toggle('on', on); $(id).setAttribute('aria-checked', String(on)); });
  $('roundsField').classList.toggle('hidden', !timed);
  $('roundsVal').textContent = String(setup.maxRounds);
  $('modeHint').textContent = `Au bout de ${setup.maxRounds} tours, le plus riche (argent et biens) gagne.`;
}

function seatCard(i) {
  const col = PLAYER_COLORS[setup.colors[i]], ch = chById(setup.chars[i]), bot = setup.kinds[i] === 'bot';
  if (isRemoteSeat(i)) {
    const here = ONLINE.peer;
    return `<article class="seat remote${here ? '' : ' waiting'}" style="--pc:${col}">
      <span class="seat-n">${i + 1}</span>
      <div class="seat-main"><strong>${here ? esc(seatName(i)) : 'Ton ami en ligne'}</strong>
        <small>${here ? `🌐 Connecté · ${esc(ch.name)}` : '⏳ En attente de sa connexion…'}</small></div>
    </article>`;
  }
  const hostSeat = isHostOnline() && i === 0;
  const kind = hostSeat ? '<span class="tag">Toi</span>' : `
    <div class="seg mini" role="group" aria-label="Humain ou bot">
      <button type="button" data-kind="human" data-p="${i}" class="${bot ? '' : 'on'}" aria-pressed="${!bot}">Humain</button>
      <button type="button" data-kind="bot" data-p="${i}" class="${bot ? 'on' : ''}" aria-pressed="${bot}">Bot</button>
    </div>`;
  const diff = bot ? `
    <div class="seg mini" role="group" aria-label="Niveau du bot">
      ${Object.keys(BOT_DIFF).map((k) => `<button type="button" data-diff="${k}" data-p="${i}" class="${setup.diffs[i] === k ? 'on' : ''}" aria-pressed="${setup.diffs[i] === k}">${BOT_DIFF[k].label}</button>`).join('')}
    </div>` : '';
  return `<article class="seat" style="--pc:${col}">
    <span class="seat-n">${i + 1}</span>
    <div class="seat-main">
      <label class="text-field"><span>${bot ? 'Nom du bot' : `Joueur ${i + 1}`}</span>
        <input class="name-input" data-name="${i}" maxlength="18" autocomplete="off" placeholder="${bot ? `Bot · ${esc(ch.short)}` : `Nom du joueur ${i + 1}`}" value="${esc(setup.names[i])}"></label>
      <div class="seat-row">${kind}${diff}</div>
    </div>
  </article>`;
}

function renderSeats() {
  const active = document.activeElement;
  const keep = active && active.dataset && active.dataset.name !== undefined ? { i: active.dataset.name, pos: active.selectionStart } : null;
  $('seatList').innerHTML = Array.from({ length: setup.count }, (_, i) => seatCard(i)).join('');
  if (keep) {
    const el = $('seatList').querySelector(`[data-name="${keep.i}"]`);
    if (el) { el.focus(); try { el.setSelectionRange(keep.pos, keep.pos); } catch (e) { /* ignoré */ } }
  }
}

const heroCardHtml = (c, on, takenBy, locked) => `
  <button type="button" role="radio" aria-checked="${on}" data-char="${c.id}" class="hero-card${on ? ' on' : ''}${takenBy ? ' taken' : ''}"${locked ? ' disabled' : ''}>
    <span class="hc-emoji" aria-hidden="true">${c.emoji}</span><strong>${c.short}</strong>
    ${takenBy ? `<em class="hc-tag">${esc(takenBy)}</em>` : ''}
  </button>`;

function colorRowHtml(current, takenFn, locked) {
  return PLAYER_COLORS.map((c, k) => {
    const holder = takenFn(k);
    return `<button type="button" class="color-opt${current === k ? ' on' : ''}${holder ? ' taken' : ''}" data-col="${k}" style="--c:${c}" role="radio" aria-checked="${current === k}" aria-label="${COLOR_NAMES[k]}" title="${COLOR_NAMES[k]}${holder ? ` (prise par ${esc(holder)})` : ''}"${locked ? ' disabled' : ''}></button>`;
  }).join('');
}

function renderHeroes() {
  const n = setup.count;
  if (FLOW.heroSeat >= n) FLOW.heroSeat = 0;
  const i = FLOW.heroSeat, locked = isRemoteSeat(i), sel = chById(setup.chars[i]);
  $('heroTabs').innerHTML = Array.from({ length: n }, (_, k) => `
    <button type="button" role="tab" aria-selected="${k === i}" data-seat="${k}" class="htab${k === i ? ' on' : ''}" style="--pc:${PLAYER_COLORS[setup.colors[k]]}">
      <span class="htab-dot">${chById(setup.chars[k]).emoji}</span><span class="htab-name">${esc(seatName(k))}</span>
    </button>`).join('');
  const holderOfChar = (cid) => { const k = setup.chars.findIndex((x, j) => x === cid && j < n && j !== i); return k >= 0 ? seatName(k) : ''; };
  const holderOfColor = (col) => { const k = setup.colors.findIndex((x, j) => x === col && j < n && j !== i); return k >= 0 ? seatName(k) : ''; };
  const who = locked ? 'Ami en ligne' : setup.kinds[i] === 'bot' ? 'Bot' : 'Humain';
  $('heroPanel').innerHTML = `
    <div class="hp-head"><h3>${esc(seatName(i))}</h3><span class="tag">${who}</span></div>
    ${locked ? '<p class="fine-note">Ton ami a choisi son personnage et sa couleur en rejoignant la partie.</p>' : ''}
    <div class="hero-grid" role="radiogroup" aria-label="Personnage de ${esc(seatName(i))}">
      ${CHARACTERS.map((c) => heroCardHtml(c, c.id === sel.id, holderOfChar(c.id), locked)).join('')}
    </div>
    <p class="power-note"><strong>${esc(sel.name)}.</strong> ${esc(sel.power)}</p>
    <p class="fb-label">Couleur du pion</p>
    <div class="color-row" role="radiogroup" aria-label="Couleur de ${esc(seatName(i))}">${colorRowHtml(setup.colors[i], holderOfColor, locked)}</div>`;
}

function renderRecap() {
  const timed = setup.winMode === 'timed';
  const chips = [
    [FLOW.mode === 'online' ? '🌐' : '🖥️', FLOW.mode === 'online' ? 'En ligne' : 'Sur cet écran'],
    ['👥', `${setup.count} joueurs`],
    [timed ? '⏳' : '🏆', timed ? `${setup.maxRounds} tours` : 'Dernier debout'],
    ['💰', `${money(CONFIG.startingCash)} chacun`]
  ];
  $('recapRules').innerHTML = chips.map(([i, t]) => `<span class="rchip"><span aria-hidden="true">${i}</span>${esc(t)}</span>`).join('');
  $('recapSeats').innerHTML = Array.from({ length: setup.count }, (_, i) => {
    const ch = chById(setup.chars[i]), bot = setup.kinds[i] === 'bot', remote = isRemoteSeat(i);
    const tag = remote ? (ONLINE.peer ? 'Ami en ligne' : 'En attente…') : bot ? `Bot ${BOT_DIFF[setup.diffs[i]].label.toLowerCase()}` : (isHostOnline() && i === 0 ? 'Toi' : 'Humain');
    return `<article class="rseat${remote && !ONLINE.peer ? ' waiting' : ''}" style="--pc:${PLAYER_COLORS[setup.colors[i]]}">
      <span class="rs-token">${ch.emoji}</span>
      <div class="rs-main"><strong>${esc(seatName(i))}</strong><small>${esc(ch.name)}</small></div>
      <span class="tag">${tag}</span>
      <p class="rs-power">${esc(ch.power)}</p>
    </article>`;
  }).join('');
  $('recapNote').textContent = isHostOnline() && !ONLINE.peer ? 'Ton ami n’est pas connecté : la partie démarrera dès qu’il sera là.' : 'Tu retrouveras les règles à tout moment dans le menu de la partie.';
}

/* ---------- Rejoindre ---------- */
let chosenChar = CHARACTERS[0].id;
let chosenColor = 1;
function renderJoinProfile() {
  const sel = chById(chosenChar);
  $('joinChars').innerHTML = CHARACTERS.map((c) => heroCardHtml(c, c.id === chosenChar, '', false)).join('');
  $('joinPower').innerHTML = `<strong>${esc(sel.name)}.</strong> ${esc(sel.power)}`;
  $('joinColors').innerHTML = colorRowHtml(chosenColor, () => '', false);
}

/* ---------- Pied de page : Retour / Continuer ---------- */
function footSpec(step) {
  const online = FLOW.mode === 'online';
  switch (step) {
    case 'mode': return { back: ['← Accueil', () => goScreen('home')], next: ['Continuer →', onModeNext] };
    case 'lobby': return {
      back: ['← Changer de mode', () => { resetOnline(); goScreen('mode'); }],
      next: ['Continuer →', () => goScreen('rules')],
      off: !(isHostOnline() && ONLINE.peer), msg: isHostOnline() && ONLINE.peer ? '' : 'En attente de ton ami…'
    };
    case 'rules': return { back: ['← Retour', () => goScreen(online ? 'lobby' : 'mode')], next: ['Les joueurs →', () => goScreen('seats')] };
    case 'seats': {
      const err = seatsError();
      return { back: ['← Retour', () => goScreen('rules')], next: ['Les personnages →', () => goScreen('heroes')], off: !!err, msg: err };
    }
    case 'heroes': return { back: ['← Retour', () => goScreen('seats')], next: ['Récapitulatif →', () => goScreen('recap')] };
    case 'recap': {
      const wait = isHostOnline() && !ONLINE.peer;
      return { back: ['← Retour', () => goScreen('heroes')], next: ['🎲 Lancer la partie', startGame], off: wait, msg: wait ? 'Attends que ton ami soit connecté.' : '' };
    }
    case 'join-code': {
      const ok = $('joinCode').value.trim().length === 4;
      return { back: ['← Accueil', () => { resetOnline(); goScreen('home'); }], next: ['Continuer →', () => goScreen('join-profile')], off: !ok };
    }
    case 'join-profile': return { back: ['← Le code', () => goScreen('join-code')], next: ['Rejoindre la partie', doJoin] };
    case 'join-wait': return { back: ['Quitter le salon', () => { resetOnline(); goScreen('home'); }], next: null };
    default: return null;
  }
}
function seatsError() {
  const names = Array.from({ length: setup.count }, (_, i) => seatName(i).toLowerCase());
  if (new Set(names).size !== names.length) return 'Deux joueurs ont le même nom.';
  const humans = Array.from({ length: setup.count }, (_, i) => i).filter((i) => setup.kinds[i] === 'human' || isRemoteSeat(i)).length;
  return humans < 1 ? 'Il faut au moins un joueur humain.' : '';
}
let footNext = null, footBack = null;
function updateFoot() {
  const foot = document.querySelector('.flow-foot'), spec = footSpec(FLOW.step);
  foot.classList.toggle('hidden', !spec);
  if (!spec) return;
  $('flowBack').textContent = spec.back[0];
  footBack = spec.back[1];
  $('flowNext').classList.toggle('hidden', !spec.next);
  if (spec.next) { $('flowNext').textContent = spec.next[0]; footNext = spec.next[1]; }
  $('flowNext').disabled = !!spec.off;
  $('flowMsg').textContent = spec.msg || '';
}
function updateStart() { updateFoot(); }

/* ---------- Actions ---------- */
function onModeNext() {
  if (FLOW.mode === 'online') { if (!ONLINE.role) hostRoom(); goScreen('lobby'); }
  else goScreen('rules');
}

function hostRoom() {
  if (ONLINE.role) return;
  if (setup.count < 2) setup.count = 2;
  setup.kinds[0] = 'human'; setup.kinds[1] = 'human';
  ONLINE.role = 'host'; ONLINE.me = 0; ONLINE.guestId = 1;
  $('lobbyCode').textContent = '····';
  $('lobbyRetry').classList.add('hidden');
  status('Connexion au serveur de jeu…');
  renderFlow();
  connect(() => wsSend({ t: 'host' }));
  watchServer();
}

/* Le profil de l'invité arrive : on le place sans doublon de personnage ni de couleur. */
function applyGuestProfile(m) {
  const others = (arr, v) => arr.findIndex((x, k) => x === v && k < 4 && k !== 1);
  const wantChar = CHARACTERS.some((c) => c.id === m.char) ? m.char : setup.chars[1];
  const oldChar = setup.chars[1];
  const hold = others(setup.chars, wantChar);
  if (hold >= 0) setup.chars[hold] = oldChar === wantChar ? CHARACTERS.find((c) => !setup.chars.includes(c.id)).id : oldChar;
  setup.chars[1] = wantChar;
  setup.kinds[1] = 'human';
  setup.names[1] = m.name || 'Invité';
  if (Number.isInteger(m.color) && m.color >= 0 && m.color < PLAYER_COLORS.length) {
    const oldCol = setup.colors[1], holdC = others(setup.colors, m.color);
    if (holdC >= 0) setup.colors[holdC] = oldCol;
    setup.colors[1] = m.color;
  }
}

function setMode(mode) {
  if (FLOW.mode === mode) return;
  FLOW.mode = mode;
  if (mode === 'local') {
    if (ONLINE.role === 'host') { resetOnline(); setup.names[1] = ''; setup.kinds[1] = 'bot'; }
  }
  renderFlow();
}

function doJoin() {
  const code = $('joinCode').value.trim().toUpperCase();
  if (ONLINE.role) return;
  if (code.length !== 4) { goScreen('join-code'); status('Entre le code à 4 lettres de la partie.', true); return; }
  ONLINE.role = 'guest'; ONLINE.me = 1;
  status('Connexion…');
  goScreen('join-wait');
  connect(() => wsSend({ t: 'join', code, name: $('joinName').value.trim(), char: chosenChar, color: chosenColor }));
  watchServer();
}

const copyText = (t) => { if (!t) return; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => showToast('Copié !'), () => window.prompt('Copie ceci :', t)); };

/* ---------- Branchements ---------- */
function wireFlow() {
  $('createBtn').addEventListener('click', () => goScreen('mode'));
  $('joinGoBtn').addEventListener('click', () => goScreen('join-code'));
  $('homeRulesBtn').addEventListener('click', () => $('rulesBtn').click());
  $('flowBack').addEventListener('click', () => footBack && footBack());
  $('flowNext').addEventListener('click', () => { if (!$('flowNext').disabled && footNext) footNext(); });

  $('modeLocal').addEventListener('click', () => setMode('local'));
  $('modeOnline').addEventListener('click', () => setMode('online'));
  $('lobbyRetry').addEventListener('click', () => { $('lobbyRetry').classList.add('hidden'); resetOnline(); hostRoom(); });
  $('copyCode').addEventListener('click', () => copyText(ONLINE.code));
  $('copyLink').addEventListener('click', () => copyText(ONLINE.code && `${location.origin}/?code=${ONLINE.code}`));

  $('countSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-count]');
    if (!b) return;
    setup.count = Number(b.dataset.count);
    renderFlow();
  });
  $('endLast').addEventListener('click', () => { setup.winMode = 'last'; renderFlow(); });
  $('endTimed').addEventListener('click', () => { setup.winMode = 'timed'; renderFlow(); });
  const bump = (d) => { setup.maxRounds = Math.max(5, Math.min(95, (Math.round(setup.maxRounds / 5) * 5) + d)); renderFlow(); };
  $('roundsMinus').addEventListener('click', () => bump(-5));
  $('roundsPlus').addEventListener('click', () => bump(5));

  const seatList = $('seatList');
  seatList.addEventListener('input', (e) => {
    const el = e.target.closest('[data-name]');
    if (el) { setup.names[Number(el.dataset.name)] = el.value; updateFoot(); }
  });
  seatList.addEventListener('click', (e) => {
    const k = e.target.closest('[data-kind]'), d = e.target.closest('[data-diff]');
    if (k) { setup.kinds[Number(k.dataset.p)] = k.dataset.kind; renderFlow(); }
    else if (d) { setup.diffs[Number(d.dataset.p)] = d.dataset.diff; renderFlow(); }
  });

  $('heroTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-seat]');
    if (b) { FLOW.heroSeat = Number(b.dataset.seat); renderFlow(); }
  });
  $('heroPanel').addEventListener('click', (e) => {
    const i = FLOW.heroSeat, n = setup.count;
    const c = e.target.closest('[data-char]'), col = e.target.closest('[data-col]');
    if (c) {
      const holder = setup.chars.findIndex((x, k) => x === c.dataset.char && k < n && k !== i);
      if (holder >= 0) { if (isRemoteSeat(holder)) { showToast('Ce personnage est celui de ton ami.'); return; } setup.chars[holder] = setup.chars[i]; }
      setup.chars[i] = c.dataset.char;
      renderFlow();
    } else if (col) {
      const v = Number(col.dataset.col), holder = setup.colors.findIndex((x, k) => x === v && k < n && k !== i);
      if (holder >= 0) { if (isRemoteSeat(holder)) { showToast('Cette couleur est celle de ton ami.'); return; } setup.colors[holder] = setup.colors[i]; }
      setup.colors[i] = v;
      renderFlow();
    }
  });

  $('joinCode').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 4);
    $('joinStatus').textContent = ''; $('joinStatus').classList.remove('err');
    updateFoot();
  });
  $('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !$('flowNext').disabled) footNext(); });
  $('joinChars').addEventListener('click', (e) => { const b = e.target.closest('[data-char]'); if (b) { chosenChar = b.dataset.char; renderJoinProfile(); } });
  $('joinColors').addEventListener('click', (e) => { const b = e.target.closest('[data-col]'); if (b) { chosenColor = Number(b.dataset.col); renderJoinProfile(); } });
  $('joinName').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
}

window.addEventListener('DOMContentLoaded', () => {
  wireFlow();
  const urlCode = (new URLSearchParams(location.search).get('code') || '').toUpperCase();
  if (/^[A-Z]{4}$/.test(urlCode)) { $('joinCode').value = urlCode; goScreen('join-profile', { focus: false }); }
  else goScreen('home', { focus: false });
});
