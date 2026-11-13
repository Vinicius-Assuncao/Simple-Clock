/* ==========================================================================
   modes.js — lógica de cada modo e loop principal (não salva nada aqui)
   ========================================================================== */

// Estado de execução
const rt = {
  sw: { running: false, acc: 0, start: 0, laps: [] },
  tm: { running: false, acc: 0, start: 0, ended: false },
  st: { idx: 0, cycle: 1, running: false, acc: 0, start: 0, done: false, target: 0, lastSeg: -1 }
};

// Sessões em andamento são guardadas separadamente das preferências. Como os
// tempos de início são timestamps absolutos, o progresso continua ao reabrir.
function saveRuntimeState() {
  try {
    localStorage.setItem(RUNTIME_STORE_KEY, JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      timerMs: state.timerMs,
      studyConfig: JSON.stringify(state.study),
      sw: { ...rt.sw, laps: rt.sw.laps.map(lap => ({ ...lap })) },
      tm: { ...rt.tm },
      st: { ...rt.st }
    }));
  } catch (e) {}
}

function restoreRuntimeState() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(RUNTIME_STORE_KEY) || 'null'); }
  catch (e) { saved = null; }
  if (!saved || saved.version !== 1) return;

  const numberOr = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  if (saved.sw && Array.isArray(saved.sw.laps)) {
    rt.sw.running = !!saved.sw.running;
    rt.sw.acc = Math.max(0, numberOr(saved.sw.acc));
    rt.sw.start = Math.max(0, numberOr(saved.sw.start));
    rt.sw.laps = saved.sw.laps.slice(-500).map(lap => ({
      total: String(lap.total || '00:00:00'),
      totalMs: Math.max(0, numberOr(lap.totalMs)),
      split: String(lap.split || '00:00:00')
    }));
  }

  // Uma mudança na duração depois da sessão salva invalida apenas o temporizador.
  if (saved.tm && numberOr(saved.timerMs, -1) === state.timerMs) {
    rt.tm.running = !!saved.tm.running;
    rt.tm.acc = Math.max(0, numberOr(saved.tm.acc));
    rt.tm.start = Math.max(0, numberOr(saved.tm.start));
    rt.tm.ended = !!saved.tm.ended;
    if (rt.tm.running && elapsed(rt.tm) >= state.timerMs) {
      rt.tm.running = false;
      rt.tm.acc = state.timerMs;
      rt.tm.ended = true;
      showPill('O temporizador terminou enquanto a página estava fechada.');
    }
  }

  // Se os blocos ou as opções do estudo mudaram, não restaura um progresso
  // que já não corresponde à rotina configurada.
  if (saved.st && saved.studyConfig === JSON.stringify(state.study)) {
    rt.st.idx = Math.max(0, Math.min(state.study.blocks.length - 1, Math.floor(numberOr(saved.st.idx))));
    rt.st.cycle = Math.max(1, Math.floor(numberOr(saved.st.cycle, 1)));
    rt.st.running = !!saved.st.running;
    rt.st.acc = Math.max(0, numberOr(saved.st.acc));
    rt.st.start = Math.max(0, numberOr(saved.st.start));
    rt.st.done = !!saved.st.done;
    rt.st.target = Math.max(0, numberOr(saved.st.target));
    rt.st.lastSeg = numberOr(saved.st.lastSeg, -1);
  }

  saveRuntimeState();
}

const elapsed = r => r.acc + (r.running ? Date.now() - r.start : 0);
function startR(r) {
  if (!r.running) {
    r.running = true;
    r.start = Date.now();
    saveRuntimeState();
  }
}
function pauseR(r) {
  if (r.running) {
    r.acc += Date.now() - r.start;
    r.running = false;
    saveRuntimeState();
  }
}
const useFlip = () => state.clock === 'flip';

/* ---------- Relógio ---------- */
function renderClock(c, now, p) {
  if (state.clock === 'analog') {
    c.disp.el.hidden = true;
    c.ana.hidden = false;
    renderAnalog(c.ana, now, p);
    return;
  }
  c.ana.hidden = true;
  c.disp.el.hidden = false;
  const t = clockParts(p);
  showDisp(c.disp, t.text, '', useFlip(), t.ampm);
}

// Data e fuso: escritos nos blocos de relógio (modo relógio e modo prova)
function renderInfo(now, tz) {
  const key = Math.floor(now.getTime() / 1000) + '|' + tz + '|' + state.showDate + '|' + state.showTz;
  if (key === ui.infoKey) return;
  ui.infoKey = key;

  const dateText = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }).format(now);
  const label = tzLabel(tz, now);

  Object.values(CLK).forEach(c => {
    c.date.hidden = !state.showDate;
    c.date.textContent = dateText;
    c.tz.hidden = !state.showTz;
    c.tz.textContent = label;
  });
}

function renderWorldClocks(now) {
  const list = $('worldClocks');
  if (!list) return;
  const secondKey = Math.floor(now.getTime() / 1000);
  if (ui.worldClockKey === secondKey) return;
  ui.worldClockKey = secondKey;
  list.hidden = !state.worldClocks.length;
  if (!state.worldClocks.length) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = state.worldClocks.map(item => {
    try {
      const time = new Intl.DateTimeFormat('pt-BR', {
        timeZone: item.tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: state.hour12
      }).format(now);
      const date = new Intl.DateTimeFormat('pt-BR', {
        timeZone: item.tz, weekday: 'short', day: '2-digit', month: 'short'
      }).format(now);
      return `<div class="world-clock-card">
        <span class="world-clock-city">${escapeHtml(item.label)}</span>
        <strong class="world-clock-time">${time}</strong>
        <span class="world-clock-date">${date}</span>
      </div>`;
    } catch (error) {
      return '';
    }
  }).join('');
}

/* ---------- Cronômetro ---------- */
function renderStopwatch() {
  const r = rt.sw;
  const ms = elapsed(r);
  showDisp(DISP.sw, fmtHMS(ms), '.' + pad(Math.floor((ms % 1000) / 10)), useFlip(), '');

  // Destaque conforme o estado: zerado ou rodando → Iniciar/Pausar; pausado → Zerar
  const toggle = $('swToggle');
  const reset = $('swReset');
  toggle.classList.toggle('primary', r.running || ms === 0);
  reset.classList.toggle('primary', !r.running && ms > 0);
  toggle.textContent = r.running ? 'Pausar' : (ms > 0 ? 'Continuar' : 'Iniciar');
}

function renderLaps() {
  $('swLaps').innerHTML = rt.sw.laps
    .map((l, i) => `<li><span>Volta ${rt.sw.laps.length - i}: ${l.split} <span style="opacity:.6">(total ${l.total})</span></span><button type="button" class="lap-del" data-lap-remove="${i}" aria-label="Remover volta ${rt.sw.laps.length - i}" title="Remover volta">×</button></li>`)
    .join('');
}

/* ---------- Temporizador ---------- */
function tickTimer() {
  const r = rt.tm;
  if (r.running && elapsed(r) >= state.timerMs) {
    r.running = false;
    r.acc = state.timerMs;
    r.ended = true;
    showPill('Tempo esgotado!');
  }
}

function renderTimer() {
  const r = rt.tm;
  const total = state.timerMs;
  const e = r.ended ? total : elapsed(r);
  const rem = r.ended ? 0 : Math.max(0, total - e);
  showDisp(DISP.tm, fmtHMS(Math.ceil(rem / 1000) * 1000), '', useFlip(), '');

  $('tmMsg').hidden = !r.ended;
  $('tmInputs').hidden = r.running;
  $('tmToggle').textContent = r.running ? 'Pausar' : 'Iniciar';

  $('tmInit').hidden = !state.tmOpts.showInit;
  $('tmInit').textContent = `Tempo inicial: ${fmtHMS(total)}`;
  $('tmBarWrap').hidden = !state.tmOpts.showBar;
  $('tmBar').style.width = (total > 0 ? Math.min(100, e / total * 100) : 0).toFixed(2) + '%';
}

function setTimerMs(ms) {
  state.timerMs = Math.max(0, Math.min(ms, (99 * 3600 + 59 * 60 + 59) * 1000));
  rt.tm.acc = 0;
  rt.tm.ended = false;
  save();
  saveRuntimeState();
}

function readTimerInputs(prefix) {
  const h = Math.max(0, +$(prefix + 'H').value || 0);
  const m = Math.max(0, Math.min(59, +$(prefix + 'M').value || 0));
  const s = Math.max(0, Math.min(59, +$(prefix + 'S').value || 0));
  return (h * 3600 + m * 60 + s) * 1000;
}

/* ---------- Estudo ---------- */
function resetStudy() {
  Object.assign(rt.st, { idx: 0, cycle: 1, running: false, acc: 0, start: 0, done: false, target: 0, lastSeg: -1 });
  saveRuntimeState();
}

function finishStudy() {
  rt.st.done = true;
  rt.st.running = false;
  rt.st.acc = 0;
  saveRuntimeState();
  showPill('Sequência de estudo concluída');
}

// Modo duração: avança para o próximo bloco
function studyNext(auto) {
  const r = rt.st;
  const S = state.study;
  const currentBlock = S.blocks[r.idx];
  const currentDuration = currentBlock ? Math.max(1, currentBlock.min) * MIN : 0;
  // Preserve o excesso de tempo quando a página ficou suspensa ou o navegador
  // atrasou o loop. Assim a sequência não perde minutos ao atravessar blocos.
  const overshoot = auto && r.running ? Math.max(0, elapsed(r) - currentDuration) : 0;
  r.acc = 0;
  r.start = Date.now() - overshoot;
  r.idx++;
  if (r.idx >= S.blocks.length) {
    r.idx = 0;
    r.cycle++;
    if (S.mode === 'count' && r.cycle > S.repeat) {
      r.cycle = S.repeat;
      r.idx = S.blocks.length - 1;
      finishStudy();
      return;
    }
  }
  if (auto && !S.autoNext) {
    r.running = false;
    r.acc = 0;
    r.start = Date.now();
  }
  saveRuntimeState();
}

// Modo horário como base: bloco atual pelo relógio, a partir do início
function timeBaseSegment(now) {
  const r = rt.st;
  const S = state.study;
  if (!S.blocks.length) return { done: true };
  if (S.mode === 'until' && r.target && now >= r.target) return { done: true };

  let t = r.start;
  let idx = 0, cycle = 1;
  for (let guard = 0; guard < 20000; guard++) {
    const b = S.blocks[idx];
    const end = t + Math.max(1, b.min) * MIN;
    if (S.mode === 'until' && r.target && t >= r.target) return { done: true };
    if (now < end) {
      let cycleStart = t;
      for (let j = idx - 1; j >= 0; j--) cycleStart -= S.blocks[j].min * MIN;
      return { idx, cycle, start: t, end, cycleStart };
    }
    t = end;
    idx++;
    if (idx >= S.blocks.length) {
      idx = 0;
      cycle++;
      if (S.mode === 'count' && cycle > S.repeat) return { done: true };
    }
  }
  return { done: true };
}

function tickStudy(now) {
  const r = rt.st;
  const S = state.study;
  if (!r.running || r.done || !S.blocks.length) return;

  if (S.timeBase) {
    const seg = timeBaseSegment(now);
    if (seg.done) { finishStudy(); alarm(); return; }
    if (seg.start !== r.lastSeg) {
      if (r.lastSeg !== -1) alarm();
      r.lastSeg = seg.start;
      saveRuntimeState();
    }
    return;
  }

  if (S.mode === 'until' && r.target && now >= r.target) { finishStudy(); return; }

  for (let guard = 0; r.running && !r.done && guard < 200; guard++) {
    const ph = S.blocks[r.idx];
    if (!ph || elapsed(r) < Math.max(1, ph.min) * MIN) break;
    alarm();
    studyNext(true);
  }
}

// Legenda do bloco: "Ciclo 1 de 3 · Bloco 1 de 2" (o tipo já aparece no título e na lista)
function studySub(cycle, idx, len, endTxt) {
  const S = state.study;
  const parts = [S.mode === 'count' ? `Ciclo ${cycle} de ${S.repeat}` : `Ciclo ${cycle}`, `Bloco ${idx + 1} de ${len}`];
  if (endTxt) parts.push(`termina às ${endTxt}`);
  else if (S.mode === 'until' && S.until) parts.push(`até ${S.until}`);
  return parts.join(' · ');
}

function renderStudy(now) {
  const r = rt.st;
  const S = state.study;
  const list = S.blocks;
  const toggle = $('stToggle');
  $('stSkip').hidden = S.timeBase;

  if (!list.length) {
    $('stPhase').textContent = 'Sem blocos';
    $('stSub').textContent = 'Adicione blocos em Configurações → Estudo.';
    showDisp(DISP.st, '00:00:00', '', useFlip(), '');
    $('stBar').style.width = '0%';
    $('stList').innerHTML = '';
    toggle.textContent = 'Iniciar';
    return;
  }

  if (S.timeBase) {
    renderStudyTimeBase(now, list);
    toggle.textContent = r.running ? 'Parar' : 'Iniciar';
  } else {
    renderStudyDuration(list);
    toggle.textContent = r.running ? 'Pausar' : 'Iniciar';
  }
}

// Horário final da sequência (modo "até horário")
function untilTarget() {
  if (rt.st.target) return rt.st.target;
  return nextOccurrence(state.study.until, effTz());
}

// Blocos projetados a partir de um instante. No modo "até horário",
// só entram os blocos que terminam antes desse horário.
function projectList(startMs) {
  const S = state.study;
  const target = S.mode === 'until' ? untilTarget() : 0;
  const out = [];
  let t = startMs;
  S.blocks.forEach((b, idx) => {
    const end = t + Math.max(1, b.min) * MIN;
    if (!target || end <= target) {
      out.push({ idx, start: t, name: b.name || kindLabel(b.kind), min: b.min, kind: b.kind });
    }
    t = end;
  });
  return out;
}

function listHtml(entries, curIdx, tz) {
  if (!entries.length) return `<li class="hint">Nenhum bloco termina até ${escapeHtml(state.study.until)}.</li>`;
  return entries.map(e =>
    `<li class="${e.idx === curIdx ? 'cur' : ''}">${fmtTime(e.start, tz)} ${escapeHtml(e.name)} · ${e.min} min (${kindLabel(e.kind)})</li>`
  ).join('');
}

function renderStudyTimeBase(now, list) {
  const r = rt.st;
  const seg = r.running ? timeBaseSegment(now) : null;
  const tz = effTz();
  const clk = clockParts(getParts(new Date(now), tz));
  showDisp(DISP.st, clk.text, '', useFlip(), clk.ampm);

  if (seg && !seg.done) {
    const b = list[seg.idx];
    $('stPhase').textContent = b.name || kindLabel(b.kind);
    $('stSub').textContent = studySub(seg.cycle, seg.idx, list.length, fmtTime(seg.end, tz));
    $('stBar').style.width = Math.min(100, (now - seg.start) / (seg.end - seg.start) * 100).toFixed(2) + '%';
    $('stList').innerHTML = listHtml(projectList(seg.cycleStart), seg.idx, tz);
  } else {
    $('stPhase').textContent = r.done ? 'Sequência concluída!' : 'Pronto para começar';
    $('stSub').textContent = r.done ? '' : 'Os blocos seguem o horário do relógio a partir de quando você iniciar.';
    $('stBar').style.width = r.done ? '100%' : '0%';
    $('stList').innerHTML = listHtml(projectList(now), -1, tz);
  }
}

function renderStudyDuration(list) {
  const r = rt.st;
  let cur = -1;
  if (r.done) {
    $('stPhase').textContent = 'Sequência concluída!';
    $('stSub').textContent = '';
    showDisp(DISP.st, '00:00:00', '', useFlip(), '');
    $('stBar').style.width = '100%';
  } else {
    const ph = list[r.idx];
    const ms = Math.max(1, ph.min) * MIN;
    const e = elapsed(r);
    const rem = Math.max(0, ms - e);
    cur = r.idx;
    $('stPhase').textContent = ph.name || kindLabel(ph.kind);
    $('stSub').textContent = studySub(r.cycle, r.idx, list.length);
    showDisp(DISP.st, fmtHMS(Math.ceil(rem / 1000) * 1000), '', useFlip(), '');
    $('stBar').style.width = Math.min(100, e / ms * 100).toFixed(2) + '%';
  }
  $('stList').innerHTML = listHtml(projectList(Date.now()), cur, effTz());
}

// Botão Iniciar/Pausar do estudo
function toggleStudy() {
  const r = rt.st;
  const S = state.study;
  if (!S.blocks.length) return;

  if (S.timeBase) {
    if (r.running) {
      resetStudy();
    } else {
      resetStudy();
      r.start = Date.now();
      r.running = true;
      if (S.mode === 'until') r.target = nextOccurrence(S.until, effTz());
      saveRuntimeState();
    }
  } else {
    if (r.done) resetStudy();
    if (S.mode === 'until' && !r.target) r.target = nextOccurrence(S.until, effTz());
    if (r.running) pauseR(r); else startR(r);
  }
  saveRuntimeState();
  renderStudy(Date.now());
}

/* ---------- Modo prova ---------- */
function checkExamAlerts(t, S, E) {
  if (S == null || E == null || E <= S || t >= E) return;
  const key = S + '|' + E;
  if (key !== ui.examKey) {
    // Avisos já passados ao definir o intervalo não disparam
    ui.examKey = key;
    ui.fired = new Set(ALERTS.filter(m => E - t <= m * MIN));
  }
  const fresh = ALERTS.filter(m => E - t <= m * MIN && !ui.fired.has(m));
  if (!fresh.length) return;
  fresh.forEach(m => ui.fired.add(m));
  const urgent = Math.min(...fresh);
  if (state.exam.alerts[urgent]) showPill(ALERT_TEXT[urgent]);
}

function renderExam(now, tz) {
  const S = parseLocal(state.exam.start, tz);
  const E = parseLocal(state.exam.end, tz);
  const t = now.getTime();
  checkExamAlerts(t, S, E);

  let h = '';
  if (state.exam.showTimes) {
    h += `<div class="ex-times">
      <div><span>Início</span><strong>${S != null ? fmtTime(S, tz) : '—'}</strong></div>
      <div><span>Fim</span><strong>${E != null ? fmtTime(E, tz) : '—'}</strong></div>
    </div>`;
  }
  if (state.exam.showCountdown) {
    if (S == null || E == null || E <= S) {
      h += '<div class="ex-msg">Defina um início e um fim válidos em Configurações → Modo prova.</div>';
    } else if (t < S) {
      h += `<div class="hint">Começa em</div><div class="ex-count">${fmtHMS(S - t)}</div>`;
      h += '<div class="bar"><i style="width:0%"></i></div>';
    } else if (t < E) {
      const pct = Math.min(100, Math.max(0, (t - S) / (E - S) * 100));
      h += `<div class="hint">Termina em</div><div class="ex-count">${fmtHMS(E - t)}</div>`;
      h += `<div class="bar"><i style="width:${pct.toFixed(2)}%"></i></div>`;
    } else {
      h += '<div class="ex-msg">Prova encerrada</div><div class="bar"><i style="width:100%"></i></div>';
    }
  }
  if (!h) h = '<div class="hint">Nada para mostrar. Ative as opções em Configurações → Modo prova.</div>';
  $('examBox').innerHTML = h;
}

// Ao entrar no modo prova sem horários, sugere agora → +1 hora
function ensureExamDefaults() {
  if (state.exam.start && state.exam.end) return;
  const tz = effTz();
  const now = Date.now();
  state.exam.start = toLocalInput(now, tz);
  state.exam.end = toLocalInput(now + 60 * MIN, tz);
  save();
}

/* ---------- Lembretes ---------- */
const byTime = (a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0);

function renderReminders(p) {
  const items = [...state.reminders].sort(byTime);
  $('remList').innerHTML = items.length ? items.map(r => `
    <li class="${r.done ? 'done' : ''}">
      <span class="rem-time">${escapeHtml(r.time)}</span>
      <span class="rem-text">${escapeHtml(r.text)}</span>
      <span class="rem-tag">${r.pending ? 'Aviso ativo' : (r.snoozeUntil ? 'Adiado' : (r.daily ? 'Todo dia' : (r.done ? 'Feito' : 'Uma vez')))}</span>
      <button class="rem-del" data-id="${escapeHtml(r.id)}" aria-label="Remover lembrete" title="Remover">×</button>
    </li>`).join('')
    : '<li class="hint" style="justify-content:center">Nenhum lembrete ainda.</li>';

  const active = items.some(r => r.pending && !r.done);
  if (active) {
    $('remNext').textContent = 'Há lembretes aguardando sua ação.';
  } else {
    const next = items.filter(r => !r.done).sort((a, b) =>
      (Number(a.snoozeUntil || a.nextAt) || Infinity) - (Number(b.snoozeUntil || b.nextAt) || Infinity)
    )[0];
    const dueAt = next && Number(next.snoozeUntil || next.nextAt);
    $('remNext').textContent = next
      ? `Próximo: ${dueAt ? fmtTime(dueAt, effTz()) : next.time} · ${next.text}`
      : '';
  }
}

function renderPendingReminderToast() {
  const toast = $('reminderToast');
  if (!toast) return;
  const pending = state.reminders
    .filter(r => r.pending && !r.done)
    .sort((a, b) => (Number(a.triggeredAt) || 0) - (Number(b.triggeredAt) || 0));
  if (!pending.length || document.visibilityState === 'hidden') {
    toast.hidden = true;
    return;
  }
  const reminder = pending[0];
  toast.dataset.reminderId = reminder.id;
  $('reminderToastText').textContent = reminder.text;
  toast.hidden = false;
}

function notifyReminderInBackground(reminder) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const notification = new Notification('SimpleClock — Lembrete', {
      body: reminder.text,
      tag: `simpleclock-reminder-${reminder.id}`,
      renotify: false
    });
    notification.onclick = () => {
      try { window.focus(); } catch (e) {}
      try { notification.close(); } catch (e) {}
      setTimeout(renderPendingReminderToast, 250);
    };
  } catch (error) {
    // O lembrete permanece pendente e será mostrado no site ao voltar à aba.
  }
}

// Agenda lembretes por timestamp. Assim, uma aba em segundo plano que tenha
// sido limitada pelo navegador ainda recupera o aviso quando voltar a executar.
function checkReminders(p) {
  const now = Date.now();
  const tz = effTz();
  let changed = false;
  const triggered = [];

  for (const r of state.reminders) {
    if (!r || r.done) continue;
    if (!Number.isFinite(Number(r.nextAt)) || Number(r.nextAt) <= 0) {
      r.nextAt = nextOccurrence(r.time, tz);
      changed = true;
    }
    if (r.snoozeUntil == null) r.snoozeUntil = 0;
    if (r.pending == null) r.pending = false;
    if (r.pending) continue;

    const dueAt = Number(r.snoozeUntil) > 0 ? Number(r.snoozeUntil) : Number(r.nextAt);
    if (dueAt && now >= dueAt) {
      const wasSnoozed = Number(r.snoozeUntil) > 0;
      r.pending = true;
      r.triggeredAt = now;
      r.snoozeUntil = 0;
      if (!wasSnoozed) {
        if (r.daily) r.nextAt = nextOccurrence(r.time, tz);
        else r.nextAt = 0;
      }
      triggered.push(r);
      changed = true;
    }
  }

  if (changed) save();
  triggered.forEach(r => {
    if (document.visibilityState === 'hidden') notifyReminderInBackground(r);
    else alarm();
  });
  if (document.visibilityState !== 'hidden') renderPendingReminderToast();
  if (changed && ui.mode === 'reminders') renderReminders(p);
}

/* ---------- Loop principal (a cada 100 ms) ---------- */
function tick() {
  const now = new Date();
  const tz = effTz();
  const p = getParts(now, tz);

  renderInfo(now, tz);
  if (ui.mode === 'clock') renderWorldClocks(now);

  switch (ui.mode) {
    case 'clock':
      renderClock(CLK.clock, now, p);
      break;
    case 'exam':
      renderClock(CLK.exam, now, p);
      renderExam(now, tz);
      break;
    case 'stopwatch':
      renderStopwatch();
      break;
    case 'timer':
      tickTimer();
      renderTimer();
      break;
    case 'study':
      tickStudy(now);
      renderStudy(now);
      break;
    case 'reminders':
      renderReminders(p);
      break;
  }

  checkReminders(p);
}
