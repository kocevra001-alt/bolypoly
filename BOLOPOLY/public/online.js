/* BOLOPOLY en ligne — l'hôte fait tourner le jeu, l'invité reçoit l'écran et renvoie ses clics. */
const ONLINE = { role: null, ws: null, code: null, me: 0, guestId: 1, peer: false, last: {}, strikes: 0, deadline: null, sig: '' };
const MOVE_SECONDS = window.BOLO_MOVE_SECONDS || 30;
const ROOTS = { board: '#board', side: '.game-sidebar', bar: '#actionBar', banner: '#actionBanner', confirm: '#tileConfirm', modal: '#modalRoot', label: '#roundLabel' };
const rootEl = (k) => document.querySelector(ROOTS[k]);
window.DiceNetSend = (m) => { if (ONLINE.role === 'host' && ONLINE.peer) wsSend({ t: 'dice', ...m }); };
const wsSend = (o) => { if (ONLINE.ws && ONLINE.ws.readyState === 1) ONLINE.ws.send(JSON.stringify(o)); };
const modalOpen = () => !rootEl('modal').classList.contains('hidden');
const controllerId = () => (modalOpen() && state.modalActor != null ? state.modalActor : state.cur);
const fire = (el, type = 'click') => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
function pathOf(root, el) { const p = []; while (el && el !== root) { const par = el.parentElement; p.unshift(Array.prototype.indexOf.call(par.children, el)); el = par; } return p; }
function byPath(root, p) { let el = root; for (const i of p) el = el && el.children[i]; return el; }
const status = (msg, err) => {
  const ids = ONLINE.role === 'guest' ? ['joinStatus', 'waitStatus'] : ['lobbyStatus'];
  ids.forEach((id) => { const el = $(id); el.textContent = msg; el.classList.toggle('err', !!err); });
};
let wasPlaying = false;

/* ---------- Connexion ---------- */
const NO_SERVER = 'Le serveur BOLOPOLY ne répond pas. Tu as sans doute ouvert le jeu avec un autre outil (Live Server, double-clic sur le fichier…). Lance le serveur du jeu : double-clique sur start.bat (ou tape npm start dans le dossier), puis ouvre http://localhost:8787.';
function watchServer() {
  clearTimeout(ONLINE.watch);
  ONLINE.watch = setTimeout(() => { const guest = ONLINE.role === 'guest'; status(NO_SERVER, true); if (ONLINE.role === 'host') $('lobbyRetry').classList.remove('hidden'); resetOnline(); if (guest) goScreen('join-code'); }, 6000);
}
function resetOnline() {
  clearTimeout(ONLINE.watch);
  if (ONLINE.ws) { try { ONLINE.ws.onclose = null; ONLINE.ws.close(); } catch (e) { /* déjà fermé */ } }
  Object.assign(ONLINE, { role: null, ws: null, code: null, peer: false, last: {} });
}
function connect(onOpen) {
  const fail = (msg) => { const guest = ONLINE.role === 'guest'; status(msg, true); if (ONLINE.role === 'host') $('lobbyRetry').classList.remove('hidden'); ONLINE.role = null; ONLINE.ws = null; if (guest) goScreen('join-code'); };
  if (location.protocol === 'file:') { fail('Le jeu est ouvert depuis un fichier. Lance le serveur (npm start) et ouvre http://localhost:8787.'); return; }
  let opened = false;
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ONLINE.ws = ws;
  ws.onopen = () => { opened = true; onOpen(); };
  ws.onmessage = (e) => onMsg(JSON.parse(e.data));
  ws.onclose = () => {
    if (!opened) { fail('Impossible de joindre le serveur de jeu. Ouvre le jeu depuis l’adresse du serveur (Render ou http://localhost:8787), pas depuis un simple hébergement de fichiers.'); return; }
    if (ONLINE.role) { ONLINE.peer = false; status('Connexion perdue. Reviens à l’accueil et recommence.', true); showToast('Connexion perdue.'); renderFlow(); }
  };
}

function onMsg(m) {
  if (m.t === 'hosted') { clearTimeout(ONLINE.watch); ONLINE.code = m.code; $('lobbyCode').textContent = m.code; status('En attente de ton ami… Donne-lui ce code ou ce lien.'); }
  else if (m.t === 'error') { const guest = ONLINE.role === 'guest'; status(m.msg, true); resetOnline(); if (guest) goScreen('join-code'); }
  else if (m.t === 'guest-in') {
    ONLINE.peer = true;
    applyGuestProfile(m);
    renderFlow();
    status(`${setup.names[1]} est connecté. Tu peux continuer !`);
    snap(true);
  }
  else if (m.t === 'joined') { clearTimeout(ONLINE.watch); status('Connecté ! L’hôte va lancer la partie…'); wsSend({ t: 'hello' }); }
  else if (m.t === 'hello') snap(true);
  else if (m.t === 'peer-left') {
    if (ONLINE.role === 'host') { ONLINE.peer = false; status('Ton ami s’est déconnecté. Il peut se reconnecter avec le même code.', true); renderFlow(); }
    else { status('L’hôte a quitté la partie.', true); document.body.classList.remove('playing'); $('gamePanel').classList.add('hidden'); resetOnline(); goScreen('join-code'); }
    showToast('L’autre joueur s’est déconnecté.');
  }
  else if (m.t === 'snap') applySnap(m);
  else if (m.t === 'timer') showChip(m.left, m.name, m.clock);
  else if (m.t === 'click' || m.t === 'field') onRemoteInput(m);
  else if (m.t === 'dice') { if (window.Dice3D && Dice3D.mirror) Dice3D.mirror(m); }
}

/* ---------- Hôte : envoi de l'écran ---------- */
const pickState = () => { const { players, cur, round, props, tontine, hasRolled, dice, focus, over, busy, actionMode, modalActor, season, t0, winMode, maxRounds } = state; return { players, cur, round, props, tontine, hasRolled, dice, focus, over, busy, actionMode, modalActor, season, t0, winMode, maxRounds }; };
function snap(force) {
  if (ONLINE.role !== 'host' || !ONLINE.peer) return;
  const out = { t: 'snap', playing: document.body.classList.contains('playing'), roots: {}, st: pickState() };
  for (const k of Object.keys(ROOTS)) {
    const el = rootEl(k);
    if (!el) continue;
    const body = k === 'label' ? el.textContent : el.innerHTML;
    if (force || ONLINE.last[k] !== el.className + '|' + body) {
      ONLINE.last[k] = el.className + '|' + body;
      out.roots[k] = { c: el.className, h: k === 'label' ? null : body, x: k === 'label' ? body : null };
    }
  }
  wsSend(out);
}
let snapTimer;
new MutationObserver((list) => {
  if (ONLINE.role !== 'host' || !ONLINE.peer) return;
  const noise = list.every((m) => { const n = m.target.nodeType === 3 ? m.target.parentElement : m.target; return n && n.closest && n.closest('#clock,.topbar-clock,#turnTimer'); });
  if (noise) return;
  clearTimeout(snapTimer); snapTimer = setTimeout(() => snap(), 120);
}).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });

/* ---------- Invité : réception de l'écran ---------- */
function applySnap(m) {
  if (wasPlaying && !m.playing) { goScreen('join-wait'); status('Partie terminée. Attends que l’hôte en relance une…'); }
  wasPlaying = m.playing;
  document.body.classList.toggle('playing', m.playing);
  $('gamePanel').classList.toggle('hidden', !m.playing);
  Object.assign(state, m.st);
  for (const [k, v] of Object.entries(m.roots)) {
    const el = rootEl(k);
    if (!el) continue;
    if (k === 'modal' && ONLINE.localModal && !el.classList.contains('hidden')) continue;
    el.className = v.c;
    if (k === 'label') { el.textContent = v.x; continue; }
    const fields = () => [...el.querySelectorAll('input,select,textarea')];
    const title = () => (el.querySelector('.modal-head h3') || {}).textContent;
    const keep = k === 'modal' ? { t: title(), vals: fields().map((f) => (f.type === 'checkbox' || f.type === 'radio' ? f.checked : f.value)), at: fields().indexOf(document.activeElement) } : null;
    el.innerHTML = v.h;
    if (keep && keep.t === title() && keep.vals.length === fields().length) {
      fields().forEach((f, i) => { if (f.type === 'checkbox' || f.type === 'radio') f.checked = keep.vals[i]; else f.value = keep.vals[i]; });
      if (keep.at >= 0) fields()[keep.at].focus();
    }
  }
}
rootEl('board').addEventListener('mouseover', (e) => {
  if (ONLINE.role !== 'guest') return;
  const t = e.target.closest('.tile'), d = document.getElementById('centerDeed');
  if (!t || !d || state.actionMode) return;
  try { d.innerHTML = propCardHtml(+t.dataset.index); d.classList.remove('hidden'); } catch (err) { /* fiche indisponible */ }
});
rootEl('board').addEventListener('mouseout', (e) => {
  const d = document.getElementById('centerDeed');
  if (ONLINE.role === 'guest' && d && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.tile'))) d.classList.add('hidden');
});

/* ---------- Entrées : l'invité envoie, l'hôte exécute ---------- */
const rootOf = (t) => Object.keys(ROOTS).find((k) => k !== 'label' && rootEl(k) && rootEl(k).contains(t));
document.addEventListener('click', (e) => {
  if (e.target.closest('.pr-head, .fold-head')) return;   // plier/déplier une carte joueur : purement local, pas de tour requis
  const k = rootOf(e.target);
  if (!k) return;
  if (ONLINE.role === 'guest') {
    if (ONLINE.localModal && k === 'modal') return;
    if (e.target.closest('input,select,textarea,label')) return;
    e.preventDefault(); e.stopPropagation();
    if (e.target.closest('[data-bar="menu"]')) { guestMenu(); return; }
    if (controllerId() !== ONLINE.me) { showToast('Ce n’est pas ton tour.'); return; }
    if (k === 'board' && !state.actionMode) return;
    wsSend({ t: 'click', root: k, path: pathOf(rootEl(k), e.target) });
  } else if (ONLINE.role === 'host' && ONLINE.peer && e.isTrusted) {
    if (controllerId() === ONLINE.guestId) { e.preventDefault(); e.stopPropagation(); showToast(`C’est au tour de ${state.players[ONLINE.guestId].name}.`); }
    else ONLINE.strikes = 0;
  }
}, true);
['input', 'change'].forEach((type) => document.addEventListener(type, (e) => {
  if (ONLINE.role !== 'guest' || !e.isTrusted) return;
  const k = rootOf(e.target);
  if (k !== 'modal' || controllerId() !== ONLINE.me) return;
  wsSend({ t: 'field', root: k, path: pathOf(rootEl(k), e.target), v: e.target.value, c: e.target.checked });
}, true));

function onRemoteInput(m) {
  if (ONLINE.role !== 'host' || controllerId() !== ONLINE.guestId) return;
  if (modalOpen() ? m.root !== 'modal' : m.root === 'modal') return;
  const el = byPath(rootEl(m.root), m.path);
  if (!el || el.disabled) return;
  ONLINE.strikes = 0;
  if (m.t === 'click') { fire(el); return; }
  if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!m.c; else el.value = m.v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/* ---------- Chrono : 30 s par coup (partie en ligne, côté hôte) ---------- */
const chipEl = document.createElement('div');
chipEl.id = 'turnTimer'; chipEl.className = 'turn-timer hidden';
document.body.appendChild(chipEl);
function showChip(left, name, clock) {
  if (left == null) { chipEl.classList.add('hidden'); return; }
  chipEl.textContent = `⏱ ${left} s · ${name}`;
  chipEl.classList.remove('hidden');
  chipEl.classList.toggle('hurry', left <= 10);
  if (clock && ONLINE.role === 'guest') { const c = document.getElementById('clock'); if (c) c.textContent = clock; }
}
function onTimeout(open) {
  ONLINE.strikes++;
  if (open) {
    const all = [...rootEl('modal').querySelectorAll('.modal-foot .btn:not(:disabled)')];
    const btns = all.filter((b) => !/gérer|patrimoine/i.test(b.textContent)).length ? all.filter((b) => !/gérer|patrimoine/i.test(b.textContent)) : all;
    const by = (c) => btns.find((b) => b.classList.contains(c));
    const decline = btns.find((b) => /ferm|annul|refus|pass|^non|plus tard|laisser/i.test(b.textContent));
    const pick = (ONLINE.strikes >= 3 && by('danger')) || decline || by('secondary') || btns.find((b) => !b.classList.contains('danger')) || btns[0];
    if (pick) fire(pick);
  } else if (state.actionMode) exitActionMode();
  else if (!state.hasRolled) fire($('rollBtn'));
  else fire($('endTurnBtn'));
  showToast('Temps écoulé : coup joué automatiquement.');
}
setInterval(() => {
  if (ONLINE.role !== 'host' || !ONLINE.peer || !state.players.length || state.over) { showChip(null); return; }
  const open = modalOpen(), p = state.players[controllerId()];
  if (!p || p.isBot || p.eliminated || (state.busy && !open && !state.actionMode)) { ONLINE.deadline = null; ONLINE.sig = ''; showChip(null); wsSend({ t: 'timer', left: null }); return; }
  const sig = [state.cur, p.id, state.hasRolled, open, (rootEl('modal').querySelector('.modal-head h3') || {}).textContent, state.actionMode].join('|');
  if (sig !== ONLINE.sig || !ONLINE.deadline) { ONLINE.sig = sig; ONLINE.deadline = Date.now() + MOVE_SECONDS * 1000; }
  const left = Math.max(0, Math.ceil((ONLINE.deadline - Date.now()) / 1000));
  const clock = (document.getElementById('clock') || {}).textContent;
  showChip(left, p.name, clock); wsSend({ t: 'timer', left, name: p.name, clock });
  if (left === 0) { ONLINE.deadline = Date.now() + MOVE_SECONDS * 1000; onTimeout(open); }
}, 1000);

/* Le parcours avant la partie (accueil, étapes, salon) vit dans flow.js. */

$('rulesTopBtn').addEventListener('click', () => {
  if (ONLINE.role === 'guest') {
    if (modalOpen()) { showToast('Termine d’abord la décision en cours.'); return; }
    ONLINE.localModal = true;
  }
  if (ONLINE.role === 'guest') showRules(); else $('rulesBtn').click();
});
setInterval(() => {
  if (ONLINE.role === 'guest' && ONLINE.localModal && rootEl('modal').classList.contains('hidden')) { ONLINE.localModal = false; wsSend({ t: 'hello' }); }
}, 400);


/* ---------- Perspective : chacun voit clairement si c'est son tour ---------- */
// Le badge vit dans .board-topline (toujours visible en jeu, jamais synchronisé avec l'invité).
const youBadge = document.createElement('span');
youBadge.id = 'youBadge'; youBadge.className = 'you-badge hidden';
$('modeTag').after(youBadge);
youBadge.after(chipEl);   // le chrono se range à côté du badge au lieu de le recouvrir

let lastPersp = '';
function paintPerspective() {
  const b = document.body;
  const live = !!ONLINE.role && (ONLINE.role === 'guest' || ONLINE.peer) && b.classList.contains('playing') && state.players.length > 0;
  const cid = live ? controllerId() : -1;
  const who = state.players[cid], me = state.players[ONLINE.me];
  const sig = live ? [ONLINE.role, cid, state.over, !!ONLINE.localModal, who && who.name, me && me.name].join('|') : 'off';
  if (sig === lastPersp) return;            // rien n'a changé : aucun travail DOM
  lastPersp = sig;
  if (!live) {
    b.classList.remove('net', 'net-host', 'net-guest', 'net-mine', 'net-wait', 'local-modal');
    youBadge.classList.add('hidden');
    return;
  }
  const mine = cid === ONLINE.me && !state.over, wait = `⏳ Tour de ${who ? who.name : '…'}`;
  b.classList.add('net');
  b.classList.toggle('net-host', ONLINE.role === 'host');
  b.classList.toggle('net-guest', ONLINE.role === 'guest');
  b.classList.toggle('net-mine', mine);
  b.classList.toggle('net-wait', !mine && !state.over);
  b.classList.toggle('local-modal', !!ONLINE.localModal);
  b.style.setProperty('--wait-text', JSON.stringify(wait));
  youBadge.textContent = state.over ? '🏁 Partie terminée' : mine ? '🟢 À toi de jouer' : wait;
  youBadge.title = `Tu joues : ${me ? me.name : ''}`;
  youBadge.classList.toggle('on', mine);
  youBadge.classList.remove('hidden');
}
// Déclenché par les événements du jeu (pas de sondage rapide) + filet de sécurité à 1 s.
[['renderAll'], ['closeModal'], ['applySnap'], ['updateStart']].forEach(([n]) => {
  const orig = window[n];
  window[n] = function (...a) { const r = orig.apply(this, a); if (n === 'applySnap') applyFolds(); paintPerspective(); return r; };
});
const _ask = ask;
ask = function (...a) { const r = _ask(...a); paintPerspective(); return r; };
setInterval(paintPerspective, 1000);

/* Menu de l'invité : règles et sortie seulement (nouvelle partie = hôte) */
async function guestMenu() {
  if (modalOpen()) { showToast('Termine d’abord la décision en cours.'); return; }
  ONLINE.localModal = true;
  const c = await ask({
    eyebrow: 'MENU', title: 'BoloPoly',
    body: '<p>Tu joues en ligne. Seul l’hôte peut lancer une nouvelle partie.</p>',
    buttons: [
      { label: 'Règles', value: 'rules', kind: 'secondary' },
      { label: 'Quitter la partie', value: 'leave', kind: 'danger' },
      { label: 'Fermer', value: 'close', kind: 'quiet' }
    ]
  });
  if (c === 'rules') { showRules(); return; }
  if (c === 'leave') {
    ONLINE.localModal = true;
    const ok = await ask({
      eyebrow: 'QUITTER', title: 'Quitter la partie ?',
      body: '<p>L’hôte sera prévenu. Tu pourras revenir avec le même code.</p>',
      buttons: [{ label: 'Quitter', value: true, kind: 'danger' }, { label: 'Rester', value: false, kind: 'quiet' }]
    });
    if (ok) location.href = location.pathname;
  }
}
