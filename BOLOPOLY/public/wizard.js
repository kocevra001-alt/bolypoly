/* BOLOPOLY — pages avant le jeu, étape par étape (créer une partie / rejoindre une partie). */
(() => {
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const isOnline = () => $('modeOnline').classList.contains('on');
  let step = 'mode', seat = 0, configured = false, jstep = 'code';

  /* ---------- Créer une partie ---------- */
  const steps = () => {
    const s = ['mode'];
    if (isOnline()) s.push('room');
    s.push('rules');
    for (let i = 0; i < setup.count; i += 1) if (!(isOnline() && i === 1)) s.push('seat' + i);
    s.push('recap');
    return s;
  };

  function recap() {
    const rows = [];
    for (let i = 0; i < setup.count; i += 1) {
      const c = CHARACTERS.find((x) => x.id === setup.chars[i]);
      const friend = isOnline() && i === 1, bot = setup.kinds[i] === 'bot';
      const name = friend ? (ONLINE.peer ? setup.names[1] : 'En attente de ton ami…') : (setup.names[i] || (bot ? `Bot · ${c.short}` : `Joueur ${i + 1}`));
      rows.push(`<li style="--pc:${PLAYER_COLORS[setup.colors[i]]}"><span class="rc-pawn">${c.emoji}</span><div><strong>${esc(name)}</strong><small>${c.name}</small></div><em>${friend ? '🌐 En ligne' : bot ? '🤖 Bot' : '👤 Humain'}</em></li>`);
    }
    $('recap').innerHTML = `<p class="rc-line">${isOnline() ? '🌐 En ligne' : '🖥️ Sur cet écran'} · ${setup.winMode === 'timed' ? `⏳ ${setup.maxRounds} tours` : '🏁 Dernier debout'}</p><ul class="rc-list">${rows.join('')}</ul>`;
    $('recapNote').textContent = isOnline() && !ONLINE.peer ? 'Ton ami n’est pas encore connecté : le bouton s’activera dès son arrivée.' : '';
    updateStart();
  }

  function paint() {
    const list = steps();
    if (!list.includes(step)) step = list[0];
    const idx = list.indexOf(step), kind = step.startsWith('seat') ? 'seat' : step;
    if (kind === 'seat') seat = Number(step.slice(4));
    $$('#setupSection .wz-step').forEach((el) => el.classList.toggle('on', el.dataset.wz === kind));
    $('wzNo').textContent = `Étape ${idx + 1} sur ${list.length}`;
    $('wzFill').style.width = `${((idx + 1) / list.length) * 100}%`;
    $('wzPrev').classList.toggle('hidden', idx === 0);
    $('wzNext').classList.toggle('hidden', step === 'recap');
    $('wzNext').textContent = step === 'room' && !ONLINE.peer ? 'Continuer sans attendre →' : 'Continuer →';
    $$('#countPick button').forEach((b) => b.classList.toggle('on', Number(b.dataset.n) === setup.count));
    $$('[data-wm]').forEach((b) => b.classList.toggle('on', b.dataset.wm === $('gameMode').value));
    $$('#playerNames > *').forEach((b, i) => b.classList.toggle('wz-hide', i !== seat));
    $('playerNames').classList.toggle('lock-kind', isOnline() && seat === 0);
    $('seatEyebrow').textContent = `JOUEUR ${seat + 1} SUR ${setup.count}`;
    $('seatTitle').textContent = isOnline() && seat === 0 ? 'Ton joueur' : 'Qui joue ?';
    if (step === 'recap') recap();
  }
  const go = (d) => { const l = steps(), i = l.indexOf(step) + d; if (i >= 0 && i < l.length) { step = l[i]; paint(); $('setupSection').scrollIntoView({ block: 'start' }); } };

  const _rs = renderSetup;
  renderSetup = function () { _rs(); paint(); };
  $('wzNext').addEventListener('click', () => go(1));
  $('wzPrev').addEventListener('click', () => go(-1));
  ['modeLocal', 'modeOnline'].forEach((id) => $(id).addEventListener('click', paint));
  $('countPick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-n]');
    if (!b) return;
    $('playerCount').value = b.dataset.n;
    $('playerCount').dispatchEvent(new Event('change', { bubbles: true }));
  });
  $$('[data-wm]').forEach((b) => b.addEventListener('click', () => {
    $('gameMode').value = b.dataset.wm;
    $('gameMode').dispatchEvent(new Event('change', { bubbles: true }));
    paint();
  }));
  $('startGameBtn').addEventListener('click', () => { configured = true; });
  document.addEventListener('click', (e) => { if (e.target.closest('#createBtn,#backHome')) configured = false; }, true);

  /* ---------- Rejoindre une partie ---------- */
  const codeOk = () => /^[A-Z]{4}$/.test($('joinCode').value.trim().toUpperCase());
  function paintJoin() {
    const connected = $('joinForm').classList.contains('hidden');   // « joined » reçu : l'hôte n'a plus qu'à lancer
    if (connected) jstep = 'wait';
    const idx = ['code', 'me', 'wait'].indexOf(jstep);
    $$('#joinSection [data-wzj]').forEach((el) => el.classList.toggle('on', el.dataset.wzj === jstep));
    $('joinForm').style.display = jstep === 'wait' ? 'none' : '';
    $('wzjNo').textContent = `Étape ${idx + 1} sur 3`;
    $('wzjFill').style.width = `${((idx + 1) / 3) * 100}%`;
    $('wzjPrev').classList.toggle('hidden', jstep !== 'me');
    $('wzjNext').classList.toggle('hidden', jstep === 'wait');
    $('wzjNext').textContent = jstep === 'me' ? 'Rejoindre la partie' : 'Continuer →';
    $('waitTitle').textContent = connected ? 'Connecté ! L’hôte va lancer la partie…' : 'On te connecte…';
  }
  $('wzjNext').addEventListener('click', () => {
    if (jstep === 'code') {
      if (!codeOk()) { $('joinStatus').textContent = 'Entre le code à 4 lettres de la partie.'; $('joinStatus').classList.add('err'); return; }
      $('joinStatus').textContent = ''; jstep = 'me';
    } else if (jstep === 'me') { jstep = 'wait'; $('joinBtn').click(); }
    paintJoin();
  });
  $('wzjPrev').addEventListener('click', () => { jstep = 'code'; paintJoin(); });
  $('joinCode').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  $('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('wzjNext').click(); });
  setInterval(() => {   // erreur de connexion ou départ de l'hôte : retour au code, message visible
    if (document.body.dataset.screen !== 'join') return;
    if (jstep === 'wait' && !$('joinForm').classList.contains('hidden') && !ONLINE.role) jstep = 'code';
    paintJoin();
  }, 300);

  /* ---------- Changement de page ---------- */
  let lastScr = document.body.dataset.screen;
  new MutationObserver(() => {
    const s = document.body.dataset.screen;
    if (s === lastScr) return;
    lastScr = s;
    if (s === 'setup') { step = configured ? 'recap' : 'mode'; seat = 0; paint(); }
    if (s === 'join') { jstep = codeOk() ? 'me' : 'code'; paintJoin(); }
  }).observe(document.body, { attributes: true, attributeFilter: ['data-screen'] });

  /* ---------- Banque repliable ---------- */
  $('bankToggle').addEventListener('click', () => {
    const closed = $('bankPanel').classList.toggle('closed');
    $('bankToggle').setAttribute('aria-expanded', String(!closed));
  });

  paint(); paintJoin();
  if (document.body.dataset.screen === 'join') { jstep = codeOk() ? 'me' : 'code'; paintJoin(); }
})();
