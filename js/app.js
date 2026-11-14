/* ==========================================================================
   app.js — eventos, troca de modos, tela cheia, tela ligada e inicialização
   ========================================================================== */

/* ---------- Troca de modos ---------- */
function setMode(m) {
  if (ui.mode === 'study' && m !== 'study') resetStudy();
  ui.mode = m;
  state.lastMode = m;
  save();
  if (m === 'exam') ensureExamDefaults();
  Object.values(MODE_VIEW).forEach(id => { $(id).hidden = true; });
  $(MODE_VIEW[m]).hidden = false;
  if (typeof syncFloatingMode === 'function') syncFloatingMode(m);
  ui.infoKey = '';
  syncControls();
  tick();
}

/* ---------- Cronômetro ---------- */
function recordStopwatchLap() {
  if (!rt.sw.running) return;
  const total = elapsed(rt.sw);
  const prev = rt.sw.laps.length ? rt.sw.laps[rt.sw.laps.length - 1].totalMs : 0;
  rt.sw.laps.push({ total: fmtHMS(total), totalMs: total, split: fmtHMS(total - prev) });
  saveRuntimeState();
  renderLaps();
}

function bindStopwatch() {
  $('swToggle').addEventListener('click', () => {
    if (rt.sw.running) pauseR(rt.sw); else startR(rt.sw);
    renderStopwatch();
  });
  $('swLap').addEventListener('click', recordStopwatchLap);
  $('swLaps').addEventListener('click', e => {
    const button = e.target.closest('[data-lap-remove]');
    if (!button) return;
    const index = Number(button.dataset.lapRemove);
    if (!Number.isInteger(index) || index < 0 || index >= rt.sw.laps.length) return;

    rt.sw.laps.splice(index, 1);
    let previousTotal = 0;
    rt.sw.laps.forEach(lap => {
      lap.split = fmtHMS(lap.totalMs - previousTotal);
      previousTotal = lap.totalMs;
    });
    saveRuntimeState();
    renderLaps();
  });
  $('swReset').addEventListener('click', () => {
    pauseR(rt.sw);
    rt.sw.acc = 0;
    rt.sw.laps = [];
    saveRuntimeState();
    renderLaps();
    renderStopwatch();
  });
}

/* ---------- Temporizador ---------- */
function bindTimer() {
  $('tmToggle').addEventListener('click', () => {
    const r = rt.tm;
    if (r.running) { pauseR(r); return; }
    if (r.ended || elapsed(r) >= state.timerMs) { r.acc = 0; r.ended = false; }
    if (state.timerMs > 0) startR(r);
    renderTimer();
  });
  $('tmReset').addEventListener('click', () => {
    pauseR(rt.tm);
    rt.tm.acc = 0;
    rt.tm.ended = false;
    saveRuntimeState();
    renderTimer();
  });
  // Campos da tela do temporizador e das configurações mudam a mesma duração
  ['tmH', 'tmM', 'tmS'].forEach(id => $(id).addEventListener('change', () => {
    setTimerMs(readTimerInputs('tm'));
    syncTimerInputs();
    renderTimer();
  }));
  ['dH', 'dM', 'dS'].forEach(id => $(id).addEventListener('change', () => {
    setTimerMs(readTimerInputs('d'));
    syncTimerInputs();
    renderTimer();
  }));
  ['tmShowInit', 'tmShowBar'].forEach(id => $(id).addEventListener('change', onChange));
}

/* ---------- Estudo ---------- */
function bindStudy() {
  $('stToggle').addEventListener('click', toggleStudy);
  $('stSkip').addEventListener('click', () => {
    const S = state.study;
    if (!S.blocks.length || rt.st.done || S.timeBase) return;
    studyNext(false);
    renderStudy(Date.now());
  });
  $('stReset').addEventListener('click', () => {
    resetStudy();
    renderStudy(Date.now());
  });

  // Estilos prontos
  document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
    const P = PRESETS[b.dataset.preset];
    state.study.repeat = P.repeat;
    state.study.blocks = P.blocks();
    resetStudy();
    save();
    syncControls();
    renderBlocks();
  }));

  // Opções de repetição e base de tempo
  ['stMode', 'stRepeat', 'stUntil', 'stTimeBase', 'stAuto'].forEach(id =>
    $(id).addEventListener('change', () => { resetStudy(); onChange(); }));

  // Editor de blocos (delegado)
  $('stBlocks').addEventListener('change', e => {
    const row = e.target.closest('.blk');
    const b = row && state.study.blocks[+row.dataset.i];
    if (!b) return;
    if (e.target.classList.contains('bn')) b.name = e.target.value.trim();
    if (e.target.classList.contains('bm')) b.min = Math.min(600, Math.max(1, +e.target.value || 1));
    if (e.target.classList.contains('bk')) b.kind = e.target.value;
    resetStudy();
    save();
    renderBlocks();
  });
  $('stBlocks').addEventListener('click', e => {
    const del = e.target.closest('.bdel');
    if (!del) return;
    state.study.blocks.splice(+del.closest('.blk').dataset.i, 1);
    resetStudy();
    save();
    renderBlocks();
  });
  $('stAdd').addEventListener('click', () => {
    state.study.blocks.push({ name: 'Estudo', min: 25, kind: 'study' });
    resetStudy();
    save();
    renderBlocks();
  });
}

/* ---------- Lembretes ---------- */
function bindReminders() {
  $('remAdd').addEventListener('click', () => {
    const time = $('remTime').value;
    const text = $('remText').value.trim();
    if (!time || !text) return;
    state.reminders.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      time, text, daily: $('remDaily').checked, done: false, lastDate: '',
      nextAt: nextOccurrence(time, effTz()), snoozeUntil: 0, pending: false, triggeredAt: 0
    });
    $('remText').value = '';
    save();
    renderReminders(getParts(new Date(), effTz()));
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(syncControls).catch(() => {});
    }
  });

  $('remList').addEventListener('click', e => {
    const b = e.target.closest('.rem-del');
    if (!b) return;
    state.reminders = state.reminders.filter(r => r.id !== b.dataset.id);
    save();
    renderReminders(getParts(new Date(), effTz()));
    renderPendingReminderToast();
  });

  $('reminderToast').addEventListener('click', e => {
    const snoozeButton = e.target.closest('[data-rem-snooze]');
    const dismissButton = e.target.closest('[data-rem-dismiss]');
    if (!snoozeButton && !dismissButton) return;
    const id = $('reminderToast').dataset.reminderId;
    const reminder = state.reminders.find(r => r.id === id);
    if (!reminder) {
      renderPendingReminderToast();
      return;
    }

    if (snoozeButton) {
      const minutes = Math.max(1, Number(snoozeButton.dataset.remSnooze) || 5);
      reminder.pending = false;
      reminder.snoozeUntil = Date.now() + minutes * MIN;
      reminder.triggeredAt = 0;
      save();
      $('reminderToast').hidden = true;
      showPill(`Lembrete adiado por ${minutes} minutos.`);
    } else {
      reminder.pending = false;
      reminder.snoozeUntil = 0;
      reminder.triggeredAt = 0;
      if (!reminder.daily) reminder.done = true;
      save();
      $('reminderToast').hidden = true;
      renderPendingReminderToast();
    }
    renderReminders(getParts(new Date(), effTz()));
  });

  $('notifBtn').addEventListener('click', () => {
    if (!('Notification' in window)) return;
    Notification.requestPermission().then(syncControls).catch(() => {});
  });
}

function bindWorldClocks() {
  $('worldClockAdd').addEventListener('click', () => {
    if (state.worldClocks.length >= 8) return;
    const tz = $('worldClockSelect').value;
    const preset = WORLD_TZ_PRESETS.find(item => item[0] === tz);
    if (!preset || state.worldClocks.some(item => item.tz === tz)) return;
    state.worldClocks.push({ tz: preset[0], label: preset[1] });
    save();
    renderWorldClockSettings();
    ui.worldClockKey = -1;
    renderWorldClocks(new Date());
  });

  $('worldClockSettingsList').addEventListener('click', e => {
    const button = e.target.closest('[data-world-remove]');
    if (!button) return;
    state.worldClocks.splice(Number(button.dataset.worldRemove), 1);
    save();
    renderWorldClockSettings();
    ui.worldClockKey = -1;
    renderWorldClocks(new Date());
  });
}

/* ---------- Painel ---------- */
function bindPanel() {
  $('cfgBtn').addEventListener('click', () => setPanel($('panel').hidden));
  $('closeBtn').addEventListener('click', () => setPanel(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setPanel(false); });
  document.addEventListener('click', e => {
    const panel = $('panel');
    const cfgBtn = $('cfgBtn');
    const path = e.composedPath();
    if (!panel.hidden && !path.includes(panel) && !path.includes(cfgBtn)) setPanel(false);
  });

  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.dataset.pane === t.dataset.tab));
  }));

  // Botões de cor
  $('panel').addEventListener('click', e => {
    const btn = e.target.closest('button.sw');
    if (!btn) return;
    const key = btn.parentElement.dataset.key;
    const v = btn.dataset.v;
    if (key === 'bg') {
      state.bg = v;
    } else if (key === 'clockTheme') {
      state.clockTheme = v;
    } else if (key === 'pointer') {
      state.pointer = v;
    }
    onChange();
  });
  $('pointerColor').addEventListener('input', e => {
    state.pointer = e.target.value;
    save();
    syncControls();
  });

  // Demais opções
  ['soundOn', 'hideBtns', 'autoHideUi', 'clockType', 'fmt', 'showDate', 'showTz', 'tzAuto', 'tzSelect',
    'showTimes', 'showCountdown', 'examStart', 'examEnd', ...ALERTS.map(m => 'alert' + m)]
    .forEach(id => $(id).addEventListener('change', onChange));
}

/* ---------- Barra de modos ---------- */
function bindModeBar() {
  $('modeBar').addEventListener('click', e => {
    if (e.target.closest('#modeHide')) {
      state.modeBarHidden = true;
      save();
      applyBarVisibility();
      return;
    }
    const b = e.target.closest('.mb[data-mode]');
    if (b) setMode(b.dataset.mode);
  });
  $('modeShow').addEventListener('click', () => {
    state.modeBarHidden = false;
    save();
    applyBarVisibility();
  });
}

/* ---------- Botões ocultos: aparecem ao tocar ou mover o mouse ---------- */
const CTRL_IDLE_MS = 6000;   // botões de controle (cronômetro, estudo...)
const UI_IDLE_MS = 6000;    // barra de modos, tela cheia e configurações
// Inatividade de menus só em computador (mouse fino). No celular os menus ficam visíveis.
let showTimer = null;
let uiTimer = null;

// Qualquer atividade do usuário reativa os botões e reinicia as contagens de inatividade
function wakeButtons() {
  if (state.hideBtns) {
    document.body.classList.add('btn-show');
    clearTimeout(showTimer);
    showTimer = setTimeout(() => document.body.classList.remove('btn-show'), CTRL_IDLE_MS);
  }
  document.body.classList.remove('ui-idle');
  clearTimeout(uiTimer);
  if (state.autoHideUi && DESKTOP_POINTER) {
    uiTimer = setTimeout(() => {
      if ($('panel').hidden) document.body.classList.add('ui-idle');
    }, UI_IDLE_MS);
  }
}

/* ---------- Tela cheia ---------- */
const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

function bindFullscreen() {
  const root = document.documentElement;
  const btn = $('fsBtn');
  if (!(root.requestFullscreen || root.webkitRequestFullscreen)) btn.hidden = true;

  btn.addEventListener('click', () => {
    try {
      if (isFullscreen()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
    } catch (e) {}
  });

  const onChangeFs = () => {
    const fs = isFullscreen();
    root.classList.toggle('is-fs', fs);
    btn.textContent = fs ? '✕' : '⛶';
    btn.title = fs ? 'Sair da tela cheia' : 'Tela cheia';
    btn.setAttribute('aria-label', btn.title);
    const icon = btn.querySelector('.material-symbols-rounded');
    if (icon) icon.textContent = fs ? 'fullscreen_exit' : 'fullscreen';
    if (fs) setPanel(false);
  };
  document.addEventListener('fullscreenchange', onChangeFs);
  document.addEventListener('webkitfullscreenchange', onChangeFs);
}

/* ---------- Atalhos de teclado ---------- */
function bindKeyboardShortcuts() {
  let waitingForShortcut = null;
  const shortcutLabels = { toggle: 'Iniciar ou pausar', reset: 'Reiniciar', lap: 'Registrar volta', pip: 'Picture-in-Picture' };
  const renderShortcutKeys = () => {
    document.querySelectorAll('[data-shortcut]').forEach(btn => {
      const value = state.shortcuts[btn.dataset.shortcut];
      btn.innerHTML = `<kbd>${value === ' ' ? 'Espaço' : value.toUpperCase()}</kbd>`;
      btn.classList.remove('is-recording');
      btn.title = `Alterar atalho: ${shortcutLabels[btn.dataset.shortcut]}`;
    });
  };
  document.querySelectorAll('[data-shortcut]').forEach(btn => btn.addEventListener('click', () => {
    waitingForShortcut = btn.dataset.shortcut;
    btn.classList.add('is-recording');
    btn.innerHTML = '<kbd>Pressione...</kbd>';
  }));
  document.addEventListener('keydown', e => {
    if (!waitingForShortcut) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'Escape') { waitingForShortcut = null; renderShortcutKeys(); e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (e.ctrlKey || e.altKey || e.metaKey || e.repeat || !(e.code === 'Space' || /^[a-z0-9]$/i.test(e.key))) return;
    const value = e.code === 'Space' ? ' ' : e.key.toLowerCase();
    if (Object.entries(state.shortcuts).some(([name, key]) => name !== waitingForShortcut && key === value)) {
      const btn = document.querySelector(`[data-shortcut="${waitingForShortcut}"]`);
      btn.title = 'Essa tecla já está sendo usada';
      return;
    }
    state.shortcuts[waitingForShortcut] = value;
    waitingForShortcut = null;
    save(); renderShortcutKeys(); e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  document.querySelectorAll('[data-shortcut]').forEach(btn => btn.addEventListener('blur', () => {
    if (waitingForShortcut === btn.dataset.shortcut) { waitingForShortcut = null; renderShortcutKeys(); }
  }));
  $('resetShortcuts')?.addEventListener('click', () => {
    state.shortcuts = { toggle: ' ', reset: 'r', lap: 'l', pip: 'p' };
    save(); renderShortcutKeys();
  });
  renderShortcutKeys();
  document.addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
    const target = e.target;
    const interactive = target && typeof target.closest === 'function'
      ? target.closest('input, textarea, select, button, a, [contenteditable="true"]') : null;
    if (interactive && /^(INPUT|TEXTAREA|SELECT)$/.test(interactive.tagName)) return;

    const key = e.key.toLowerCase();
    if (key === state.shortcuts.toggle && interactive && /^(BUTTON|A)$/.test(interactive.tagName)) return;
    if (key === state.shortcuts.toggle && ['stopwatch', 'timer', 'study'].includes(ui.mode)) {
      e.preventDefault();
      if (ui.mode === 'stopwatch') {
        if (rt.sw.running) pauseR(rt.sw); else startR(rt.sw);
        renderStopwatch();
      } else if (ui.mode === 'timer') {
        if (rt.tm.running) pauseR(rt.tm);
        else {
          if (rt.tm.ended || elapsed(rt.tm) >= state.timerMs) { rt.tm.acc = 0; rt.tm.ended = false; }
          if (state.timerMs > 0) startR(rt.tm);
        }
        renderTimer();
      } else {
        toggleStudy();
      }
      return;
    }

    if (key === state.shortcuts.reset) {
      if (ui.mode === 'stopwatch') {
        pauseR(rt.sw); rt.sw.acc = 0; rt.sw.laps = [];
        saveRuntimeState(); renderLaps(); renderStopwatch();
      } else if (ui.mode === 'timer') {
        pauseR(rt.tm); rt.tm.acc = 0; rt.tm.ended = false;
        saveRuntimeState(); renderTimer();
      } else if (ui.mode === 'study') {
        resetStudy(); renderStudy(Date.now());
      } else return;
      e.preventDefault();
      return;
    }

    if (key === state.shortcuts.lap && ui.mode === 'stopwatch') {
      e.preventDefault();
      recordStopwatchLap();
      return;
    }

    if (key === state.shortcuts.pip) {
      e.preventDefault();
      toggleFloating();
    }
  });
}

/* ---------- Tela sempre ligada (Screen Wake Lock) ---------- */
let wakeLock = null;
async function keepAwake() {
  if (!('wakeLock' in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) {
    wakeLock = null;
  }
}

function bindWakeLock() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') keepAwake();
  });
  // Alguns navegadores só liberam a tela com um gesto do usuário
  document.addEventListener('pointerdown', keepAwake, { passive: true });
  keepAwake();
}

/* ---------- Inicialização ---------- */
function init() {
  restoreRuntimeState();
  initDisplays();
  buildSwatches();
  fillTz();
  fillWorldClockOptions();
  renderBlocks();
  renderLaps();

  bindStopwatch();
  bindTimer();
  bindStudy();
  bindReminders();
  bindWorldClocks();
  bindPanel();
  bindModeBar();
  bindFloating();
  bindFullscreen();
  bindWakeLock();
  bindKeyboardShortcuts();

  window.addEventListener('pagehide', saveRuntimeState);
  document.addEventListener('visibilitychange', () => {
    saveRuntimeState();
    if (document.visibilityState === 'visible') {
      const now = new Date();
      checkReminders(getParts(now, effTz()));
      renderPendingReminderToast();
    }
  });
  window.addEventListener('focus', () => {
    const now = new Date();
    checkReminders(getParts(now, effTz()));
    renderPendingReminderToast();
  });

  ['pointermove', 'pointerdown', 'keydown', 'touchstart'].forEach(ev =>
    document.addEventListener(ev, wakeButtons, { passive: true }));

  setMode(ui.mode);
  renderPendingReminderToast();
  wakeButtons();
  setInterval(tick, 100);
}

init();
