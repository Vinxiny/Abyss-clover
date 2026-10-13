// Main UI flow + input + bootstrap

(function () {
  const $ = id => document.getElementById(id);

  // Screens
  const loading = $('loading-screen');
  const menu = $('main-menu');
  const lobby = $('lobby-screen');
  const hud = $('game-hud');
  const gameOver = $('game-over');
  const settingsModal = $('settings-modal');

  function show(el) {
    [loading, menu, lobby, hud, gameOver].forEach(s => s.classList.add('hidden'));
    el.classList.remove('hidden');
  }

  // Init audio on first interaction
  function unlockAudio() {
    Audio.init();
    Audio.resume();
    document.removeEventListener('click', unlockAudio);
    document.removeEventListener('touchstart', unlockAudio);
  }
  document.addEventListener('click', unlockAudio);
  document.addEventListener('touchstart', unlockAudio);

  // Loading
  setTimeout(() => {
    loading.classList.add('hidden');
    show(menu);
    game.initRenderer();
  }, 1400);

  // Magic grid
  function buildMagicGrid() {
    const grid = $('magic-grid');
    grid.innerHTML = '';
    MAGIC_LIST.forEach(m => {
      const card = document.createElement('div');
      card.className = 'magic-card';
      card.dataset.id = m.id;
      card.innerHTML = `<div class="icon">${m.icon}</div><div>${m.name}</div>`;
      card.title = m.description;
      card.addEventListener('click', () => {
        document.querySelectorAll('.magic-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        Audio.click();
      });
      grid.appendChild(card);
    });
  }

  // Show the right part of the connection panel: 'host' | 'join' | 'none'
  function setConnectMode(mode) {
    $('webrtc-panel').classList.toggle('hidden', mode === 'none');
    $('host-connect').classList.toggle('hidden', mode !== 'host');
    $('join-connect').classList.toggle('hidden', mode !== 'join');
    setStatus('');
  }
  function setStatus(text, kind) {
    const el = $('webrtc-status');
    el.textContent = text || '';
    el.className = kind || '';
  }
  Net.onStatus = setStatus;

  // Clipboard that also works on non-HTTPS / older iOS
  async function copyText(text, label) {
    if (!text) { setStatus('Nothing to copy yet.', 'error'); return; }
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); } catch (__) {}
      document.body.removeChild(ta);
    }
    setStatus(label + ' copied – paste it into a message.', 'ok');
  }
  async function shareText(text) {
    if (!text) { setStatus('Nothing to share yet.', 'error'); return; }
    if (navigator.share) {
      try { await navigator.share({ text }); } catch (_) {}
    } else {
      copyText(text, 'Code');
    }
  }

  // Host actually starts the match for everyone
  function launchGame(playersData) {
    Audio.fanfare();
    show(hud);
    lobby.classList.add('hidden');
    game.start(playersData, 1);
  }
  Net.onStartGame = playersData => launchGame(playersData);

  // Menu buttons
  $('btn-host').addEventListener('click', () => {
    Audio.click();
    const code = Net.host();
    $('room-code').textContent = code;
    $('host-status').textContent = 'You are the Host – share this code';
    $('btn-start').classList.remove('hidden');
    setConnectMode('host');
    if (!$('btn-add-ai')) {
      const b = document.createElement('button');
      b.id = 'btn-add-ai';
      b.className = 'btn secondary';
      b.textContent = 'ADD AI TEAMMATE';
      b.style.marginTop = '0.5rem';
      $('btn-start').parentNode.appendChild(b);
      b.addEventListener('click', () => {
        const free = MAGIC_LIST.find(m => !Net.players.some(p => p.magic === m.id));
        if (!free) { alert('All magics taken'); return; }
        Net.addDummyPlayer('Ally-' + free.name, free.id);
        Audio.click();
        updatePlayerList();
      });
    }
    buildMagicGrid();
    show(lobby);
    updatePlayerList();
  });

  $('btn-join').addEventListener('click', () => {
    Audio.click();
    Net.isHost = false;
    $('room-code').textContent = '-----';
    $('host-status').textContent = 'Paste the host\'s invite code below';
    $('btn-start').classList.add('hidden');
    Net.beginJoinLobby();
    setConnectMode('join');
    buildMagicGrid();
    show(lobby);
  });

  $('btn-solo').addEventListener('click', () => {
    Audio.click();
    Net.host();
    $('room-code').textContent = 'SOLO';
    $('host-status').textContent = 'Solo practice – Ryo will assist';
    $('btn-start').classList.remove('hidden');
    setConnectMode('none');
    if (!$('btn-add-ai')) {
      const b = document.createElement('button');
      b.id = 'btn-add-ai';
      b.className = 'btn secondary';
      b.textContent = 'ADD AI TEAMMATE';
      b.style.marginTop = '0.5rem';
      $('btn-start').parentNode.appendChild(b);
      b.addEventListener('click', () => {
        const free = MAGIC_LIST.find(m => !Net.players.some(p => p.magic === m.id));
        if (!free) { alert('All magics taken'); return; }
        Net.addDummyPlayer('Ally-' + free.name, free.id);
        Audio.click();
        updatePlayerList();
      });
    }
    buildMagicGrid();
    show(lobby);
    updatePlayerList();
  });

  $('btn-settings').addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
  });
  $('btn-close-settings').addEventListener('click', () => {
    settingsModal.classList.add('hidden');
    const master = parseFloat($('vol-master').value);
    const sfx = parseFloat($('vol-sfx').value);
    const voice = parseFloat($('vol-voice').value);
    Audio.setVolumes(master, sfx, voice);
    const pref = $('pref-cam').value;
    game.setCameraMode(pref);
  });

  $('btn-leave').addEventListener('click', () => {
    Net.disconnect();
    show(menu);
  });

  $('btn-ready').addEventListener('click', () => {
    const selected = document.querySelector('.magic-card.selected');
    if (!selected) {
      alert('Choose a magic attribute first');
      return;
    }
    const magicId = selected.dataset.id;
    const name = $('player-name').value.trim() || 'Knight';
    const isHealer = $('is-healer').checked;
    Net.setLocalInfo(name, magicId, isHealer);
    Net.setReady(true);
    Audio.click();
    updatePlayerList();
  });

  $('btn-start').addEventListener('click', () => {
    if (!Net.allReady()) {
      // For prototype allow start if host is ready
      const local = Net.players.find(p => p.id === Net.localId);
      if (!local || !local.magic) {
        alert('Select magic and press READY');
        return;
      }
    }
    const playersData = Net.players.filter(p => p.magic).map(p => ({
      id: p.id,
      name: p.name,
      magic: p.magic,
      isHealer: p.isHealer
    }));
    if (playersData.length === 0) return;

    Net.startGame(playersData); // clients start at the same moment
    launchGame(playersData);
  });

  function updatePlayerList() {
    const list = $('player-list');
    list.innerHTML = '';
    Net.players.forEach(p => {
      const chip = document.createElement('div');
      chip.className = 'player-chip' + (p.id === Net.localId ? ' host' : '') + (p.ready ? ' ready' : '');
      chip.textContent = `${p.name}${p.magic ? ' • ' + getMagic(p.magic).name : ''}${p.isHealer ? ' 💉' : ''}`;
      list.appendChild(chip);
    });
  }

  Net.onPlayerUpdate = updatePlayerList;

  // Camera toggle
  $('btn-cam-iso').addEventListener('click', () => {
    game.setCameraMode('iso');
    Audio.click();
  });
  $('btn-cam-third').addEventListener('click', () => {
    game.setCameraMode('third');
    Audio.click();
  });

  // Game over
  $('btn-retry').addEventListener('click', () => {
    gameOver.classList.add('hidden');
    show(lobby);
  });
  $('btn-menu').addEventListener('click', () => {
    gameOver.classList.add('hidden');
    show(menu);
  });

  // Keyboard input
  const keyMap = {
    KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right'
  };
  window.addEventListener('keydown', e => {
    if (keyMap[e.code]) {
      game.input[keyMap[e.code]] = true;
      e.preventDefault();
    }
    // Abilities 1-4
    if (e.code === 'Digit1' || e.code === 'Numpad1') tryAbility(0);
    if (e.code === 'Digit2' || e.code === 'Numpad2') tryAbility(1);
    if (e.code === 'Digit3' || e.code === 'Numpad3') tryAbility(2);
    if (e.code === 'Digit4' || e.code === 'Numpad4') tryAbility(3);
    if (e.code === 'Space') tryAbility(0);
    if (e.code === 'KeyE') tryAbility(1);
    if (e.code === 'KeyQ') tryAbility(2);
    if (e.code === 'KeyR') tryAbility(3);
  });
  window.addEventListener('keyup', e => {
    if (keyMap[e.code]) game.input[keyMap[e.code]] = false;
  });

  function tryAbility(slot) {
    const local = game.world?.getLocalPlayer();
    if (local && local.alive) local.tryAbility(slot, game.world);
  }

  // Skill buttons mobile
  document.querySelectorAll('.skill-btn').forEach(btn => {
    btn.addEventListener('touchstart', e => {
      e.preventDefault();
      tryAbility(parseInt(btn.dataset.skill));
    });
    btn.addEventListener('click', () => tryAbility(parseInt(btn.dataset.skill)));
  });

  // Simple virtual joysticks
  function setupJoystick(el, isLeft) {
    let active = false;
    let startX = 0, startY = 0;
    const max = 40;

    function onStart(e) {
      active = true;
      const t = e.touches ? e.touches[0] : e;
      startX = t.clientX;
      startY = t.clientY;
    }
    function onMove(e) {
      if (!active) return;
      const t = e.touches ? e.touches[0] : e;
      let dx = t.clientX - startX;
      let dy = t.clientY - startY;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > max) {
        dx = (dx / len) * max;
        dy = (dy / len) * max;
      }
      if (isLeft) {
        game.input.joyX = dx / max;
        game.input.joyY = dy / max;
      }
      // right stick could be used for aiming later
    }
    function onEnd() {
      active = false;
      if (isLeft) {
        game.input.joyX = 0;
        game.input.joyY = 0;
      }
    }
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
  }
  setupJoystick($('joystick-left'), true);
  setupJoystick($('joystick-right'), false);

  // PWA install prompt handling (optional)
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
  });

  // Service worker
  
  // ===== Real multi-device connect (invite / answer codes) =====
  $('btn-create-offer').addEventListener('click', async () => {
    const btn = $('btn-create-offer');
    btn.disabled = true;
    setStatus('Making invite code…');
    try {
      $('offer-output').value = await Net.createInvite();
      $('answer-input').value = '';
      Audio.click();
    } catch (e) {
      setStatus(e.message || 'Could not make a code.', 'error');
    }
    btn.disabled = false;
  });

  $('btn-copy-offer').addEventListener('click', () => copyText($('offer-output').value, 'Invite code'));
  $('btn-share-offer').addEventListener('click', () => shareText($('offer-output').value));

  $('btn-accept-answer').addEventListener('click', async () => {
    try {
      await Net.acceptAnswer($('answer-input').value);
      $('answer-input').value = '';
      $('offer-output').value = '';
      Audio.click();
    } catch (e) {
      setStatus(e.message || 'Could not accept that answer.', 'error');
    }
  });

  $('btn-join-offer').addEventListener('click', async () => {
    const btn = $('btn-join-offer');
    btn.disabled = true;
    setStatus('Making answer code…');
    try {
      $('answer-output').value = await Net.joinWithInvite($('offer-input').value);
      Audio.click();
    } catch (e) {
      setStatus(e.message || 'Could not use that invite code.', 'error');
    }
    btn.disabled = false;
  });

  $('btn-copy-answer').addEventListener('click', () => copyText($('answer-output').value, 'Answer code'));
  $('btn-share-answer').addEventListener('click', () => shareText($('answer-output').value));

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
