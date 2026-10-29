/* BoloPoly — assistant d'avant-partie, étape par étape.
   Local  : Mode → Joueurs → Profils (un par un) → Règles → Lancer
   En ligne : Mode → Salon → Profil → Règles → Lancer
   Rejoindre : Code → Profil. Tous les identifiants utilisés par script.js et online.js sont conservés. */
(function () {
  const W = { flow: 'local', seat: 0 };
  const body = document.body;
  const screen = () => body.dataset.screen;
  const seatCount = () => (W.flow === 'online' ? 1 : setup.count);
  const STEPS = {
    local: [['mode', 'Mode'], ['count', 'Joueurs'], ['seats', 'Profils'], ['rules', 'Règles'], ['recap', 'Lancer']],
    online: [['mode', 'Mode'], ['lobby', 'Salon'], ['seats', 'Profil'], ['rules', 'Règles'], ['recap', 'Lancer']],
    join: [['join', 'Code'], ['joinme', 'Profil']]
  };
  const flowOf = (s) => (s === 'join' || s === 'joinme' ? 'join' : W.flow);

  /* ----- affichage d'un écran ----- */
  function show(name) {
    if (name === 'setup') name = 'recap';            // ancien nom utilisé par script.js (fin de partie)
    body.dataset.screen = name;
    document.querySelectorAll('[data-scr]').forEach((el) => el.classList.toggle('scr-off', !el.dataset.scr.split(' ').includes(name)));
    paint();
    window.scrollTo(0, 0);
  }
  goScreen = show;

  function paint() {
    const s = screen();
    const steps = STEPS[flowOf(s)] || [];
    const idx = steps.findIndex(([k]) => k === s);
    $('wizSteps').innerHTML = steps.map(([k, label], i) =>
      `<li class="${i < idx ? 'done' : i === idx ? 'cur' : ''}"><span class="wiz-dot">${i < idx ? '✓' : i + 1}</span><span class="wiz-lab">${label}</span></li>`).join('');
    const next = $('wizNext');
    next.textContent = s === 'seats' && W.seat < seatCount() - 1 ? 'Joueur suivant →' : s === 'rules' ? 'Voir le récapitulatif' : 'Continuer';
    if (s === 'seats') paintSeat();
    if (s === 'recap') paintRecap();
    if (s === 'lobby' && typeof renderLobbyList === 'function') renderLobbyList();
    if (s === 'count') document.querySelectorAll('#countChoices [data-count]').forEach((b) => b.classList.toggle('on', Number(b.dataset.count) === setup.count));
    if (s === 'rules') paintRules();
  }

  /* ----- étape Profils : un joueur à la fois ----- */
  function tagSeats() {
    [...$('playerNames').children].forEach((b, i) => { b.dataset.seat = i; b.classList.toggle('is-active', i === W.seat); });
  }
  function paintSeat() {
    const n = seatCount();
    if (W.seat > n - 1) W.seat = n - 1;
    tagSeats();
    const online = W.flow === 'online';
    $('seatKicker').textContent = online ? 'TON PROFIL' : `JOUEUR ${W.seat + 1} SUR ${n}`;
    $('seatTitle').textContent = online ? 'Qui es-tu ?' : `Qui est le joueur ${W.seat + 1} ?`;
    $('seatDots').innerHTML = online ? '' : Array.from({ length: n }, (_, i) =>
      `<span class="${i === W.seat ? 'on' : i < W.seat ? 'done' : ''}" style="--c:${PLAYER_COLORS[setup.colors[i]]}"></span>`).join('');
  }
  const _renderSetup = renderSetup;
  renderSetup = function () { _renderSetup(); tagSeats(); if (screen() === 'recap') paintRecap(); };

  /* ----- étape Règles ----- */
  function paintRules() {
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === setup.winMode));
    document.querySelectorAll('[data-rounds]').forEach((b) => b.classList.toggle('on', Number(b.dataset.rounds) === Number(setup.maxRounds)));
  }

  /* ----- récapitulatif ----- */
  function paintRecap() {
    const n = setup.count;
    $('recapList').innerHTML = Array.from({ length: n }, (_, i) => {
      const ch = CHARACTERS.find((c) => c.id === setup.chars[i]);
      const bot = setup.kinds[i] === 'bot';
      const waiting = W.flow === 'online' && i >= 1 && !ONLINE.peer;
      const name = waiting ? 'En attente d’un ami…' : (setup.names[i] || '').trim() || (bot ? `Bot · ${ch.short}` : `Joueur ${i + 1}`);
      const sub = waiting ? 'Il peut rejoindre avec le code' : `${ch.name}${bot ? ` · Bot ${(BOT_DIFF[setup.diffs[i]] || BOT_DIFF.normal).label}` : W.flow === 'online' && i >= 1 ? ' · en ligne' : ''}`;
      const edit = !(W.flow === 'online' && i >= 1) ? `<button type="button" class="recap-edit" data-edit="${i}">Modifier</button>` : '';
      return `<div class="recap-row${waiting ? ' waiting' : ''}" style="--c:${PLAYER_COLORS[setup.colors[i]]}"><span class="recap-ava">${waiting ? '⏳' : ch.emoji}</span><div><strong>${esc(name)}</strong><small>${esc(sub)}</small></div>${edit}</div>`;
    }).join('');
    $('recapRules').textContent = setup.winMode === 'timed' ? `⏱️ Durée limitée : ${setup.maxRounds} tours, le plus riche gagne.` : '🏆 Dernier debout : la partie continue jusqu’à ce qu’il ne reste qu’un joueur.';
    const waitingPeer = W.flow === 'online' && !ONLINE.peer;
    $('recapNote').textContent = waitingPeer ? 'Le bouton s’active dès qu’un ami est connecté.' : '';
  }
  const _updateStart = updateStart;
  updateStart = function () { _updateStart(); if (screen() === 'recap') paintRecap(); };

  /* ----- navigation ----- */
  function next() {
    const s = screen();
    if (s === 'count' || s === 'lobby') { W.seat = 0; show('seats'); }
    else if (s === 'seats') { if (W.seat < seatCount() - 1) { W.seat += 1; paint(); window.scrollTo(0, 0); } else show('rules'); }
    else if (s === 'rules') show('recap');
    else if (s === 'join') {
      const ok = $('joinCode').value.trim().length === 4;
      $('joinCodeErr').classList.toggle('hidden', ok);
      if (ok) show('joinme'); else $('joinCode').focus();
    }
  }
  function back() {
    const s = screen();
    if (s === 'mode' || s === 'join') { resetOnline(); setPlayMode(false); show('home'); }
    else if (s === 'count') show('mode');
    else if (s === 'lobby') { resetOnline(); setPlayMode(false); show('mode'); }
    else if (s === 'seats') { if (W.seat > 0) { W.seat -= 1; paint(); } else show(W.flow === 'online' ? 'lobby' : 'count'); }
    else if (s === 'rules') { W.seat = seatCount() - 1; show('seats'); }
    else if (s === 'recap') show('rules');
    else if (s === 'joinme') { resetOnline(); $('joinForm').classList.remove('hidden'); $('joinStatus').textContent = ''; show('join'); }
  }
  $('wizNext').addEventListener('click', next);
  $('wizBack').addEventListener('click', back);

  $('createBtn').addEventListener('click', () => show('mode'));
  $('joinGoBtn').addEventListener('click', () => { show('join'); $('joinCode').focus(); });
  $('modeLocal').addEventListener('click', () => { W.flow = 'local'; W.seat = 0; setPlayMode(false); show('count'); });
  $('modeOnline').addEventListener('click', () => { W.flow = 'online'; W.seat = 0; setPlayMode(true); show('lobby'); });

  $('countChoices').addEventListener('click', (e) => {
    const b = e.target.closest('[data-count]'); if (!b) return;
    $('playerCount').value = b.dataset.count;
    $('playerCount').dispatchEvent(new Event('change'));
    paint();
  });
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    $('gameMode').value = b.dataset.mode;
    $('gameMode').dispatchEvent(new Event('change'));
    paintRules();
  }));
  document.querySelectorAll('[data-rounds]').forEach((b) => b.addEventListener('click', () => {
    $('maxRounds').value = b.dataset.rounds;
    ['input', 'change'].forEach((t) => $('maxRounds').dispatchEvent(new Event(t)));
    paintRules();
  }));
  $('maxRounds').addEventListener('input', paintRules);
  $('recapList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-edit]'); if (!b) return;
    W.seat = Number(b.dataset.edit); show('seats');
  });
  $('joinCode').addEventListener('input', () => { $('joinCode').value = $('joinCode').value.toUpperCase().replace(/[^A-Z]/g, ''); $('joinCodeErr').classList.add('hidden'); });
  $('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') next(); });

  /* ----- démarrage : accueil, ou direct « Qui es-tu ? » si on arrive par un lien ----- */
  show(/^[A-Z]{4}$/.test(urlCode) ? 'joinme' : 'home');
  renderSetup();
})();
