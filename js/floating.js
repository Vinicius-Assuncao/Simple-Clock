/* ==========================================================================
   floating.js — janela externa Picture-in-Picture
   Move a própria tela ativa para a janela flutuante e sempre a restaura
   quando a janela é fechada, seja pelo usuário ou pelo próprio aplicativo.
   ========================================================================== */

const FLOAT_MODE_NAMES = {
  clock: 'Horário',
  stopwatch: 'Cronômetro',
  timer: 'Temporizador',
  study: 'Estudo',
  exam: 'Modo prova',
  reminders: 'Lembretes'
};

const floatingState = {
  enabled: false,
  mode: '',
  view: null,
  marker: null,
  originParent: null,
  originNextSibling: null
};

function canUseDocumentPip() {
  return !!(window.isSecureContext && window.documentPictureInPicture
    && typeof window.documentPictureInPicture.requestWindow === 'function');
}

function resetFloatingReferences() {
  floatingState.view = null;
  floatingState.marker = null;
  floatingState.originParent = null;
  floatingState.originNextSibling = null;
  floatingState.mode = '';
}

function restoreFloatingView() {
  const { view, marker, originParent, originNextSibling } = floatingState;

  if (view) {
    // O marcador preserva a posição exata. Os fallbacks evitam perder a view
    // caso algum navegador remova o comentário durante o fechamento do PiP.
    const main = document.querySelector('main');
    const parent = originParent?.isConnected ? originParent : main;
    if (parent) {
      let reference = null;
      if (marker?.parentNode === parent) reference = marker;
      else if (originNextSibling?.parentNode === parent) reference = originNextSibling;
      try {
        parent.insertBefore(view, reference);
      } catch (error) {
        // Última alternativa: manter a funcionalidade acessível no documento.
        if (main && view.parentNode !== main) main.appendChild(view);
      }
    }
  }

  if (marker?.parentNode) marker.remove();
  resetFloatingReferences();
}

function updateFloatingLabel(mode) {
  if (!pictureInPictureWindow || pictureInPictureWindow.closed) return;
  const label = pictureInPictureWindow.document.getElementById('pipModeLabel');
  if (label) label.textContent = FLOAT_MODE_NAMES[mode] || 'SimpleClock';
}

function moveModeIntoFloating(mode) {
  const view = document.getElementById(MODE_VIEW[mode]);
  const target = pictureInPictureWindow?.document.getElementById('pipContent');
  if (!view || !target || !view.parentNode) {
    throw new Error(`Não foi possível localizar a tela do modo: ${mode}`);
  }

  const parent = view.parentNode;
  const nextSibling = view.nextSibling;
  const marker = document.createComment(`SimpleClock: posição original de ${MODE_VIEW[mode]}`);
  parent.insertBefore(marker, view);

  // Guardar os dados de origem antes de mover o elemento entre documentos.
  floatingState.view = view;
  floatingState.marker = marker;
  floatingState.originParent = parent;
  floatingState.originNextSibling = nextSibling;
  floatingState.mode = mode;

  try {
    target.appendChild(view);
    updateFloatingLabel(mode);
  } catch (error) {
    restoreFloatingView();
    throw error;
  }
}

// Chamado sempre que o usuário troca de modo com a janela externa aberta.
function syncFloatingMode(mode) {
  if (!floatingState.enabled || !pictureInPictureWindow || pictureInPictureWindow.closed) return;
  restoreFloatingView();
  moveModeIntoFloating(mode);
}

function syncFloatingTheme() {
  if (!pictureInPictureWindow || pictureInPictureWindow.closed) return;
  const names = [
    '--bg', '--ui-card', '--ui-border', '--text', '--clock-card', '--clock-fg',
    '--clock-border', '--flip-card', '--flip-edge', '--pointer', '--on-pointer'
  ];
  const computed = getComputedStyle(document.documentElement);
  names.forEach(name => {
    pictureInPictureWindow.document.documentElement.style.setProperty(
      name, computed.getPropertyValue(name).trim()
    );
  });
}

function createPipDocument(pip) {
  const doc = pip.document;
  doc.title = 'SimpleClock — Janela flutuante';
  doc.documentElement.lang = 'pt-BR';
  doc.head.innerHTML = '<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">';

  // Reaproveita as folhas de estilo e as fontes do projeto na janela separada.
  document.querySelectorAll('link[rel="stylesheet"]').forEach(source => {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = source.href;
    doc.head.appendChild(link);
  });

  doc.body.innerHTML = `
    <div id="pipShell">
      <main id="pipContent"></main>
    </div>`;

  const style = doc.createElement('style');
  style.textContent = `
    html, body { width:100%; height:100%; min-height:0; margin:0!important; overflow:hidden; }
    body { display:block!important; padding:0!important; background:var(--bg); color:var(--text); }
    #pipShell { height:100%; display:flex; flex-direction:column; overflow:hidden; background:var(--bg); }
    #pipHeader { flex:0 0 38px; min-height:38px; display:flex; align-items:center; justify-content:space-between; gap:10px; padding:4px 9px 4px 12px; background:var(--ui-card); border-bottom:1px solid var(--ui-border); }
    #pipHeader div { min-width:0; display:flex; flex-direction:column; gap:0; }
    #pipHeader strong { font:700 10px system-ui,sans-serif; letter-spacing:.04em; opacity:.65; }
    #pipModeLabel { font:650 12px system-ui,sans-serif; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #pipCloseBtn { width:27px; height:27px; padding:0; border:1px solid var(--ui-border); border-radius:8px; color:var(--text); background:transparent; font:20px system-ui,sans-serif; cursor:pointer; }
    #pipContent { flex:1; min-height:0; display:flex; align-items:center; justify-content:center; overflow:auto; padding:8px 12px; }
    #pipContent .view { width:100%; gap:7px; }
    #pipContent .view-title { font-size:12px; }
    #pipContent .hint, #pipContent .init-txt { font-size:10px; }
    #pipContent .clockwrap { gap:3px; }
    #pipContent .date { font-size:9px; margin-bottom:1px; }
    #pipContent .tz { font-size:9px; }
    #pipContent .digital { font-size:clamp(32px, 13vw, 58px); }
    #pipContent .flip-row { --h:48px; gap:2px; }
    #pipContent .flip-card { width:calc(var(--h) * .7); }
    #pipContent .flip-row .sep { font-size:calc(var(--h) * .58); }
    #pipContent .ampm { margin-top:3px; font-size:9px; }
    #pipContent .analog svg { width:min(34vw, 130px); }
    #pipContent .ctrls { gap:5px; margin-top:2px; }
    #pipContent .btn { padding:6px 10px; font-size:10px; }
    #pipContent .bar { width:min(100%, 260px); height:5px; }
    #pipContent .laps, #pipContent .study-list { max-height:66px; font-size:9px; }
    #pipContent .study-list { width:100%; }
    #pipContent .study-list li, #pipContent .laps li { padding:2px 5px; }
    #pipContent .tm-inputs { gap:5px; }
    #pipContent .tm-inputs label { font-size:9px; }
    #pipContent .tm-inputs input { width:45px; padding:4px; font-size:10px; }
    #pipContent .ex-msg { font-size:11px; }
    #pipContent .ex-count { font-size:22px; }
    #pipContent .ex-times { gap:8px; }
    #pipContent .rem-list { width:100%; max-height:80px; gap:3px; }
    #pipContent .rem-list li { gap:5px; padding:5px 6px; font-size:9px; }
    #pipContent .rem-time { font-size:10px; }
    #pipContent .rem-tag { font-size:8px; }
    #pipContent .rem-form { width:100%; gap:4px; }
    #pipContent .rem-form input { padding:5px; font-size:9px; }
    #pipContent .rem-form .btn { padding:5px 7px; }
  `;
  doc.head.appendChild(style);
  syncFloatingTheme();
}

function setFloatingButtonOpen(isOpen) {
  const button = $('floatBtn');
  if (!button) return;
  button.setAttribute('aria-expanded', String(isOpen));
  button.setAttribute('aria-label', isOpen
    ? 'Fechar janela Picture-in-Picture'
    : 'Abrir janela Picture-in-Picture');
  button.title = isOpen
    ? 'Fechar janela Picture-in-Picture'
    : 'Abrir janela Picture-in-Picture';
}

function finishExternalFloating(pip) {
  // O pagehide e o fechamento pelo botão podem disparar a restauração; ela é
  // idempotente para que o elemento nunca fique preso no documento encerrado.
  if (pictureInPictureWindow !== pip) return;

  pictureInPictureWindow = null;
  floatingState.enabled = false;
  restoreFloatingView();

  // Garante que apenas o modo atual esteja visível ao voltar à página.
  Object.entries(MODE_VIEW).forEach(([mode, id]) => {
    const view = document.getElementById(id);
    if (view) view.hidden = mode !== ui.mode;
  });

  setFloatingButtonOpen(false);
}

async function openExternalFloating() {
  if (!canUseDocumentPip()) {
    showPill('Este navegador não oferece suporte à janela Picture-in-Picture.');
    return;
  }

  const button = $('floatBtn');
  if (button) button.disabled = true;

  let pip;
  // Isolar o erro da API de abertura: erros de montagem posteriores não devem
  // ser confundidos com falha ao abrir uma janela que já apareceu normalmente.
  try {
    pip = await window.documentPictureInPicture.requestWindow({ width: 360, height: 270 });
  } catch (error) {
    console.warn('Falha ao solicitar a janela Picture-in-Picture:', error);
    if (button) button.disabled = false;
    showPill('Não foi possível abrir a janela Picture-in-Picture.');
    return;
  }

  pictureInPictureWindow = pip;
  floatingState.enabled = true;

  try {
    // Registrar o fechamento IMEDIATAMENTE, antes de montar o conteúdo ou
    // mover a tela; assim uma falha de montagem nunca a deixa presa.
    pip.addEventListener('pagehide', () => finishExternalFloating(pip), { once: true });
    createPipDocument(pip);
    moveModeIntoFloating(ui.mode);

    const closeButton = pip.document.getElementById('pipCloseBtn');
    if (closeButton) {
      closeButton.addEventListener('click', () => {
        try { pip.close(); }
        finally { finishExternalFloating(pip); }
      });
    }

    pip.document.addEventListener('pointerdown', () => {
      if (typeof wakeButtons === 'function') wakeButtons();
      if (typeof keepAwake === 'function') keepAwake();
    }, { passive: true });

    setFloatingButtonOpen(true);
  } catch (error) {
    console.error('A janela PiP abriu, mas não foi possível preparar seu conteúdo:', error);
    // Fecha e restaura sem apresentar a mensagem de falha de abertura.
    try { pip.close(); } catch (closeError) {}
    finishExternalFloating(pip);
    showPill('A janela flutuante não conseguiu carregar o conteúdo. Tente novamente.');
  } finally {
    if (button) button.disabled = false;
  }
}

function toggleFloating() {
  if (floatingState.enabled && pictureInPictureWindow && !pictureInPictureWindow.closed) {
    const pip = pictureInPictureWindow;
    try { pip.close(); }
    finally { finishExternalFloating(pip); }
    return;
  }
  openExternalFloating();
}

function bindFloating() {
  const button = $('floatBtn');
  button.addEventListener('click', toggleFloating);
  button.setAttribute('aria-expanded', 'false');
}
