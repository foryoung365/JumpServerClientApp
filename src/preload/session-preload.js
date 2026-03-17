const { clipboard, ipcRenderer } = require('electron');
const { buildLocalActions, findLocalAction } = require('../main/session-shortcuts');
const sessionScope = process.isMainFrame ? 'session-main' : 'session-subframe';

const DEFAULT_LOCAL_HOTKEYS = {
  togglePanel: 'Ctrl+Alt+K',
  toggleTextMode: 'Ctrl+Alt+Space',
  toggleFullscreen: 'Ctrl+Alt+Enter'
};

const SHORTCUT_CJK_CONTEXT_TIMEOUT_MS = 2500;
const SHORTCUT_ASSIST_DEDUP_MS = 450;
const SHORTCUT_ASSIST_PENDING_MS = 1200;
const REMOTE_FOCUS_THROTTLE_MS = 180;
const REMOTE_FOCUS_LOG_INTERVAL_MS = 5000;

const state = {
  panelOpen: false,
  mode: 'shortcut',
  fullScreen: false,
  clipboardReady: true,
  isComposingText: false,
  preferChinesePunctuation: true,
  autoShortcutPunctuation: true,
  localHotkeys: { ...DEFAULT_LOCAL_HOTKEYS },
  buttonPosition: null,
  lastButtonDrag: false,
  lastCommittedText: '',
  shortcutContextText: '',
  shortcutContextUpdatedAt: 0,
  shortcutImeActive: false,
  lastShortcutAssistText: '',
  lastShortcutAssistAt: 0,
  pendingShortcutAssistText: '',
  pendingShortcutAssistAt: 0,
  lastRemoteFocusAt: 0,
  lastRemoteFocusLogAt: 0,
  lastStatus: '会话窗口已接管快捷键。'
};

let sessionOverlayInitialized = false;
let rendererLocalHotkeysInstalled = false;
let shortcutInputTrackingInstalled = false;

const specialKeyDefinitions = [
  { id: 'escape', label: 'Esc' },
  { id: 'f11', label: 'F11' },
  { id: 'ctrl-alt-delete', label: 'Ctrl+Alt+Del' },
  { id: 'alt-tab', label: 'Alt+Tab' },
  { id: 'win', label: 'Win' },
  { id: 'win-r', label: 'Win+R' },
  { id: 'win-x', label: 'Win+X' },
  { id: 'win-d', label: 'Win+D' },
  { id: 'win-e', label: 'Win+E' },
  { id: 'paste-shift-insert', label: 'Shift+Insert' }
];

const chinesePunctuationButtons = [
  '，',
  '。',
  '、',
  '？',
  '！',
  '：',
  '；',
  '（',
  '）',
  '《',
  '》',
  '“',
  '”',
  '【',
  '】'
];

const punctuationReplacementMap = {
  ',': '，',
  '.': '。',
  '?': '？',
  '!': '！',
  ':': '：',
  ';': '；',
  '(': '（',
  ')': '）',
  '[': '【',
  ']': '】',
  '<': '《',
  '>': '》'
};

const directChinesePunctuationSet = new Set([
  '\uFF0C',
  '\u3002',
  '\u3001',
  '\uFF1F',
  '\uFF01',
  '\uFF1A',
  '\uFF1B',
  '\uFF08',
  '\uFF09',
  '\u3010',
  '\u3011',
  '\u300A',
  '\u300B',
  '\u201C',
  '\u201D',
  '\u2018',
  '\u2019'
]);

function isCjkCharacter(value) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(value);
}

function isAsciiWordCharacter(value) {
  return /[A-Za-z0-9]/.test(value);
}

function shouldConvertPunctuation(source, index) {
  const current = source[index];
  const previous = source[index - 1] || '';
  const next = source[index + 1] || '';

  if (!punctuationReplacementMap[current]) {
    return false;
  }

  if (current === '.' && /\d/.test(previous) && /\d/.test(next)) {
    return false;
  }

  if ((current === ':' || current === '.') && isAsciiWordCharacter(previous) && isAsciiWordCharacter(next)) {
    return false;
  }

  return isCjkCharacter(previous) || isCjkCharacter(next);
}

function normalizeChinesePunctuation(value) {
  let converted = 0;
  const normalized = Array.from(value, (character, index) => {
    if (!shouldConvertPunctuation(value, index)) {
      return character;
    }

    converted += 1;
    return punctuationReplacementMap[character] || character;
  }).join('');

  return { normalized, converted };
}

function containsCjkText(value) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(value || '');
}

function isOverlayTarget(target) {
  return target instanceof Element && Boolean(target.closest('#jump-wrapper-root'));
}

function rememberShortcutContext(text, source) {
  if (!text) {
    return;
  }

  const shouldAppend = containsCjkText(text) || /[\u3000-\u303f\uff00-\uffef]/.test(text);
  state.shortcutContextText = shouldAppend ? `${state.shortcutContextText}${text}`.slice(-16) : text.slice(-16);
  state.shortcutContextUpdatedAt = Date.now();

  if (shouldAppend) {
    log('info', 'Updated shortcut input context', {
      source,
      text,
      context: state.shortcutContextText
    });
  }
}

function hasRecentShortcutCjkContext() {
  if (!state.shortcutContextUpdatedAt) {
    return false;
  }

  if (Date.now() - state.shortcutContextUpdatedAt > SHORTCUT_CJK_CONTEXT_TIMEOUT_MS) {
    return false;
  }

  return containsCjkText(state.shortcutContextText);
}

function isDirectChinesePunctuation(value) {
  return directChinesePunctuationSet.has(value || '');
}

function normalizeShortcutPunctuationCandidate(text, allowAsciiContext = false) {
  if (!text || text.length !== 1) {
    return '';
  }

  if (isDirectChinesePunctuation(text)) {
    return text;
  }

  if (allowAsciiContext && punctuationReplacementMap[text] && hasRecentShortcutCjkContext()) {
    return punctuationReplacementMap[text];
  }

  return '';
}

function isRecentShortcutAssist(text) {
  return (
    text &&
    state.lastShortcutAssistText === text &&
    Date.now() - state.lastShortcutAssistAt < SHORTCUT_ASSIST_DEDUP_MS
  );
}

function isPendingShortcutAssist(text) {
  return (
    text &&
    state.pendingShortcutAssistText === text &&
    Date.now() - state.pendingShortcutAssistAt < SHORTCUT_ASSIST_PENDING_MS
  );
}

function beginShortcutAssist(text) {
  state.pendingShortcutAssistText = text;
  state.pendingShortcutAssistAt = Date.now();
}

function finishShortcutAssist(text, { committed = false } = {}) {
  if (state.pendingShortcutAssistText === text) {
    state.pendingShortcutAssistText = '';
    state.pendingShortcutAssistAt = 0;
  }

  if (committed) {
    state.lastShortcutAssistText = text;
    state.lastShortcutAssistAt = Date.now();
  }
}

async function handleShortcutCommittedPunctuation(text, reason, event = null, allowAsciiContext = false) {
  if (state.mode !== 'shortcut' || !state.autoShortcutPunctuation) {
    return false;
  }

  const converted = normalizeShortcutPunctuationCandidate(text, allowAsciiContext);

  if (!converted) {
    return false;
  }

  if (isRecentShortcutAssist(converted) || isPendingShortcutAssist(converted)) {
    return true;
  }

  if (event?.cancelable) {
    event.preventDefault();
  }

  if (typeof event?.stopPropagation === 'function') {
    event.stopPropagation();
  }

  log('info', 'Intercepted committed shortcut punctuation for automatic text assist', {
    reason,
    text,
    converted,
    context: state.shortcutContextText
  });

  beginShortcutAssist(converted);

  const submission = await bridgeTextToRemote(converted, {
    reason: `shortcut-${reason}`,
    preferDirectInsert: true,
    restoreClipboard: true
  });

  if (!submission.ok) {
    finishShortcutAssist(converted, { committed: false });
    setStatus('自动中文标点辅助失败，可手动切到 Text Mode 输入。', true);
    return true;
  }

  finishShortcutAssist(converted, { committed: true });
  rememberShortcutContext(converted, reason);
  setStatus(`已自动补发中文标点 ${converted}`);
  setTimeout(() => {
    focusRemoteSink();
  }, 20);
  return true;
}

function insertTextAtCursor(element, text) {
  if (!element) {
    return;
  }

  const start = element.selectionStart ?? element.value.length;
  const end = element.selectionEnd ?? start;
  const nextValue = `${element.value.slice(0, start)}${text}${element.value.slice(end)}`;

  element.value = nextValue;
  element.selectionStart = start + text.length;
  element.selectionEnd = start + text.length;
  element.focus();
}

function normalizeTextareaPunctuation(textarea) {
  if (!textarea || !state.preferChinesePunctuation) {
    return;
  }

  const selectionStart = textarea.selectionStart ?? textarea.value.length;
  const selectionEnd = textarea.selectionEnd ?? selectionStart;
  const { normalized } = normalizeChinesePunctuation(textarea.value);

  if (normalized === textarea.value) {
    return;
  }

  textarea.value = normalized;
  textarea.selectionStart = selectionStart;
  textarea.selectionEnd = selectionEnd;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getLocalHotkeyLabels() {
  const labels = new Map(buildLocalActions(state.localHotkeys).map((action) => [action.id, action.triggerDisplay]));

  return {
    togglePanel: labels.get('toggle-panel') || DEFAULT_LOCAL_HOTKEYS.togglePanel,
    toggleTextMode: labels.get('toggle-text-mode') || DEFAULT_LOCAL_HOTKEYS.toggleTextMode,
    toggleFullscreen: labels.get('toggle-fullscreen') || DEFAULT_LOCAL_HOTKEYS.toggleFullscreen
  };
}

function log(level, message, meta = {}) {
  ipcRenderer.send('log:renderer', {
    scope: sessionScope,
    level,
    message,
    meta: {
      pathname: window.location.pathname,
      isMainFrame: process.isMainFrame,
      ...meta
    }
  });
}

log('info', 'Session preload script evaluated', {
  url: window.location.href,
  readyState: document.readyState
});

async function loadLocalHotkeys() {
  try {
    const config = await ipcRenderer.invoke('config:get');
    state.localHotkeys = {
      ...DEFAULT_LOCAL_HOTKEYS,
      ...(config.localHotkeys || {})
    };
    log('info', 'Loaded renderer local hotkeys', {
      localHotkeys: state.localHotkeys
    });
    syncUiState();
  } catch (error) {
    log('warn', 'Failed to load renderer local hotkeys', {
      message: error.message
    });
  }
}

function toShortcutInput(event) {
  return {
    key: event.key,
    code: event.code,
    control: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey
  };
}

function installShortcutInputTracking() {
  if (shortcutInputTrackingInstalled) {
    return;
  }

  shortcutInputTrackingInstalled = true;

  document.addEventListener(
    'compositionstart',
    (event) => {
      if (state.mode !== 'shortcut' || isOverlayTarget(event.target)) {
        return;
      }

      state.shortcutImeActive = true;
      log('info', 'Shortcut mode IME composition started');
    },
    true
  );

  document.addEventListener(
    'compositionend',
    (event) => {
      if (state.mode !== 'shortcut' || isOverlayTarget(event.target)) {
        return;
      }

      state.shortcutImeActive = false;
      const text = typeof event.data === 'string' ? event.data : '';

      if (containsCjkText(text)) {
        rememberShortcutContext(text, 'compositionend');
      }
    },
    true
  );

  document.addEventListener(
    'beforeinput',
    async (event) => {
      if (state.mode !== 'shortcut' || isOverlayTarget(event.target)) {
        return;
      }

      if (!String(event.inputType || '').startsWith('insert')) {
        return;
      }

      const text = typeof event.data === 'string' ? event.data : '';

      await handleShortcutCommittedPunctuation(text, 'beforeinput', event, true);
    },
    true
  );

  document.addEventListener(
    'input',
    (event) => {
      if (state.mode !== 'shortcut' || isOverlayTarget(event.target)) {
        return;
      }

      const text = typeof event.data === 'string' ? event.data : '';

      if (!text) {
        return;
      }

      rememberShortcutContext(text, 'input');
    },
    true
  );
}

async function tryHandleAutoShortcutPunctuation(event) {
  if (state.mode !== 'shortcut' || !state.autoShortcutPunctuation) {
    return false;
  }

  if (isOverlayTarget(event.target) || event.defaultPrevented || event.repeat) {
    return false;
  }

  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing || state.shortcutImeActive) {
    return false;
  }

  const converted = normalizeShortcutPunctuationCandidate(event.key, true);

  if (!converted) {
    return false;
  }

  if (isRecentShortcutAssist(converted) || isPendingShortcutAssist(converted)) {
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  event.preventDefault();
  event.stopPropagation();

  log('info', 'Intercepted shortcut punctuation for automatic text assist', {
    key: event.key,
    converted,
    context: state.shortcutContextText
  });

  beginShortcutAssist(converted);

  const submission = await bridgeTextToRemote(converted, {
    reason: 'shortcut-auto-punctuation',
    preferDirectInsert: true,
    restoreClipboard: true
  });

  if (!submission.ok) {
    setStatus('自动中文标点辅助失败，可手动切到 Text Mode 输入。', true);
    return true;
  }

  finishShortcutAssist(converted, { committed: true });
  rememberShortcutContext(converted, 'auto-punctuation');
  setStatus(`已自动补发中文标点 ${converted}`);
  setTimeout(() => {
    focusRemoteSink();
  }, 20);
  return true;
}

function installRendererLocalHotkeys() {
  if (rendererLocalHotkeysInstalled) {
    return;
  }

  rendererLocalHotkeysInstalled = true;

  document.addEventListener(
    'keydown',
    async (event) => {
      const localAction = findLocalAction(toShortcutInput(event), state.localHotkeys);

      if (!localAction) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (event.repeat) {
        return;
      }

      log('info', 'Intercepted local action in renderer', {
        actionId: localAction.id,
        trigger: localAction.triggerDisplay,
        key: event.key,
        code: event.code
      });
      handleLocalAction(localAction.id);
    },
    true
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureStyleTag() {
  if (document.getElementById('jump-wrapper-style')) {
    return;
  }

  const style = document.createElement('style');
  style.id = 'jump-wrapper-style';
  style.textContent = `
    #jump-wrapper-root {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147483646;
      font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
    }

    #jump-wrapper-toggle {
      position: absolute;
      top: 18px;
      right: 18px;
      width: 38px;
      height: 38px;
      padding: 0;
      border: none;
      border-radius: 12px;
      background: linear-gradient(135deg, #f97316, #dc2626);
      color: #f8fafc;
      box-shadow: 0 18px 40px rgba(220, 38, 38, 0.32);
      cursor: pointer;
      pointer-events: auto;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    #jump-wrapper-toggle svg {
      width: 18px;
      height: 18px;
      stroke: currentColor;
      pointer-events: none;
    }

    #jump-wrapper-panel {
      position: absolute;
      top: 18px;
      right: 74px;
      width: min(420px, calc(100vw - 110px));
      max-height: calc(100vh - 36px);
      overflow: auto;
      border-radius: 24px;
      background: rgba(9, 14, 21, 0.96);
      color: #e2e8f0;
      box-shadow: 0 28px 80px rgba(2, 6, 23, 0.6);
      pointer-events: auto;
      backdrop-filter: blur(18px);
      border: 1px solid rgba(148, 163, 184, 0.2);
      padding: 18px 18px 20px;
      display: none;
    }

    #jump-wrapper-panel.is-open {
      display: block;
    }

    .jump-wrapper-panel-dismiss {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 34px;
      height: 34px;
      padding: 0;
      border: none;
      border-radius: 999px;
      background: rgba(30, 41, 59, 0.92);
      color: #e2e8f0;
      cursor: pointer;
      pointer-events: auto;
      font-size: 18px;
      line-height: 1;
    }

    #jump-wrapper-panel h1,
    #jump-wrapper-panel h2,
    #jump-wrapper-panel p {
      margin: 0;
    }

    .jump-wrapper-row {
      display: flex;
      gap: 10px;
      align-items: center;
    }

    .jump-wrapper-stack {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .jump-wrapper-mode-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .jump-wrapper-button,
    .jump-wrapper-chip,
    .jump-wrapper-secondary {
      border: none;
      border-radius: 14px;
      cursor: pointer;
      transition: transform 120ms ease, background 120ms ease, opacity 120ms ease;
    }

    .jump-wrapper-button:hover,
    .jump-wrapper-chip:hover,
    .jump-wrapper-secondary:hover {
      transform: translateY(-1px);
    }

    .jump-wrapper-button {
      padding: 11px 14px;
      background: linear-gradient(135deg, #0f766e, #14b8a6);
      color: white;
      font-weight: 700;
    }

    .jump-wrapper-secondary {
      padding: 11px 14px;
      background: rgba(30, 41, 59, 0.88);
      color: #e2e8f0;
      font-weight: 600;
    }

    .jump-wrapper-chip {
      padding: 10px 12px;
      background: rgba(30, 41, 59, 0.94);
      color: #cbd5e1;
      font-weight: 600;
    }

    .jump-wrapper-chip.is-active {
      background: linear-gradient(135deg, #1d4ed8, #0f766e);
      color: white;
    }

    .jump-wrapper-card {
      border-radius: 18px;
      background: rgba(15, 23, 42, 0.9);
      border: 1px solid rgba(51, 65, 85, 0.8);
      padding: 14px;
    }

    .jump-wrapper-title {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 4px;
    }

    .jump-wrapper-subtitle {
      color: #94a3b8;
      font-size: 12px;
      line-height: 1.5;
    }

    .jump-wrapper-status {
      padding: 12px 14px;
      border-radius: 16px;
      background: rgba(15, 118, 110, 0.15);
      border: 1px solid rgba(20, 184, 166, 0.28);
      color: #ccfbf1;
      font-size: 12px;
      line-height: 1.6;
    }

    .jump-wrapper-status.warning {
      background: rgba(217, 119, 6, 0.12);
      border-color: rgba(245, 158, 11, 0.28);
      color: #fde68a;
    }

    .jump-wrapper-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .jump-wrapper-compose {
      display: none;
      gap: 10px;
    }

    .jump-wrapper-compose.is-visible {
      display: grid;
      grid-template-columns: 1fr;
    }

    .jump-wrapper-textarea {
      width: 100%;
      min-height: 120px;
      resize: vertical;
      border: 1px solid rgba(71, 85, 105, 0.8);
      border-radius: 16px;
      background: rgba(2, 6, 23, 0.66);
      color: #f8fafc;
      padding: 12px 14px;
      font: inherit;
      box-sizing: border-box;
      line-height: 1.6;
    }

    .jump-wrapper-textarea:focus {
      outline: 2px solid rgba(45, 212, 191, 0.55);
      border-color: rgba(45, 212, 191, 0.55);
    }

    .jump-wrapper-label {
      font-size: 12px;
      color: #94a3b8;
      margin-bottom: 8px;
      display: block;
    }

    .jump-wrapper-micro {
      font-size: 11px;
      color: #64748b;
      line-height: 1.5;
    }

    .jump-wrapper-inline-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
    }

    .jump-wrapper-helper-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 8px;
    }

    .jump-wrapper-helper-grid .jump-wrapper-secondary {
      padding: 9px 0;
      min-width: 0;
    }
  `;
  document.head.appendChild(style);
}

function getSessionSummary() {
  return [
    `路径: ${window.location.pathname}`,
    `模式: ${state.mode === 'shortcut' ? 'Shortcut Mode' : 'Text Mode'}`,
    `剪贴板同步: ${state.clipboardReady ? '本地可用，远端权限未知' : '本地剪贴板不可用'}`,
    `中文标点优先: ${state.preferChinesePunctuation ? '开启' : '关闭'}`,
    `Shortcut 自动中文标点: ${state.autoShortcutPunctuation ? '开启' : '关闭'}`,
    `热键: Ctrl+Alt+K 打开面板 / Ctrl+Alt+Space 切换文本模式 / Ctrl+Alt+Enter 切换本地全屏`
  ].join('\n');
}

function createButton(label, className = 'jump-wrapper-secondary') {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.className = className;
  return button;
}

function setStatus(message, warning = false) {
  state.lastStatus = message;
  const statusBox = document.getElementById('jump-wrapper-status');

  if (!statusBox) {
    return;
  }

  statusBox.textContent = message;
  statusBox.className = `jump-wrapper-status${warning ? ' warning' : ''}`;
}

function getDisplayElement() {
  return document.querySelector('#display > *') || document.querySelector('#display');
}

function findRemoteSink() {
  const display = getDisplayElement();

  if (!display) {
    return null;
  }

  const selectors = ['textarea', 'input', '[contenteditable="true"]', '[tabindex]'];

  for (const selector of selectors) {
    const candidate = display.querySelector(selector);

    if (candidate && !candidate.closest('#jump-wrapper-root')) {
      return candidate;
    }
  }

  return display;
}

function focusRemoteSink({ reason = 'unspecified', force = false } = {}) {
  const now = Date.now();

  if (!force && now - state.lastRemoteFocusAt < REMOTE_FOCUS_THROTTLE_MS) {
    return false;
  }

  state.lastRemoteFocusAt = now;
  const display = getDisplayElement();
  const sink = findRemoteSink();

  if (display) {
    display.dispatchEvent(
      new MouseEvent('mouseenter', {
        bubbles: true,
        cancelable: true,
        view: window
      })
    );
  }

  if (sink && typeof sink.focus === 'function') {
    sink.focus({ preventScroll: true });
  }

  if (display && typeof display.click === 'function') {
    display.click();
  }

  const shouldLog =
    !display ||
    !sink ||
    now - state.lastRemoteFocusLogAt >= REMOTE_FOCUS_LOG_INTERVAL_MS;

  if (shouldLog) {
    state.lastRemoteFocusLogAt = now;
    log(display && sink ? 'info' : 'warn', 'Requested remote focus', {
      reason,
      hasDisplay: Boolean(display),
      hasSink: Boolean(sink)
    });
  }

  return Boolean(display || sink);
}

function togglePanel() {
  state.panelOpen = !state.panelOpen;
  log('info', 'Toggled session panel', { open: state.panelOpen });
  syncUiState();
}

function ensureFloatingButtonPosition(button) {
  if (state.buttonPosition || !button) {
    return;
  }

  const buttonWidth = button.offsetWidth || 44;
  state.buttonPosition = {
    left: window.innerWidth - buttonWidth - 18,
    top: 18
  };
}

function applyFloatingLayout() {
  const button = document.getElementById('jump-wrapper-toggle');
  const panel = document.getElementById('jump-wrapper-panel');

  if (!button || !panel) {
    return;
  }

  ensureFloatingButtonPosition(button);

  const buttonWidth = button.offsetWidth || 44;
  const buttonHeight = button.offsetHeight || 44;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const panelWidth = Math.min(420, Math.max(280, viewportWidth - 110));
  const panelHeight = Math.min(state.panelOpen ? Math.max(panel.scrollHeight, 280) : 520, viewportHeight - 24);
  const openRight = state.buttonPosition.left < viewportWidth / 2;
  const openBelow = state.buttonPosition.top < viewportHeight / 2;

  state.buttonPosition.left = clamp(state.buttonPosition.left, 12, Math.max(12, viewportWidth - buttonWidth - 12));
  state.buttonPosition.top = clamp(state.buttonPosition.top, 12, Math.max(12, viewportHeight - buttonHeight - 12));

  button.style.left = `${state.buttonPosition.left}px`;
  button.style.top = `${state.buttonPosition.top}px`;
  button.style.right = 'auto';

  panel.style.width = `${panelWidth}px`;
  panel.style.maxHeight = `${Math.max(240, viewportHeight - 24)}px`;
  panel.style.right = 'auto';
  panel.style.left = `${clamp(
    openRight ? state.buttonPosition.left : state.buttonPosition.left + buttonWidth - panelWidth,
    12,
    Math.max(12, viewportWidth - panelWidth - 12)
  )}px`;
  panel.style.top = `${clamp(
    openBelow ? state.buttonPosition.top : state.buttonPosition.top + buttonHeight - panelHeight,
    12,
    Math.max(12, viewportHeight - panelHeight - 12)
  )}px`;
}

function installFloatingButtonDrag(button) {
  if (!button || button.dataset.dragReady === 'true') {
    return;
  }

  button.dataset.dragReady = 'true';
  let dragState = null;

  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }

    ensureFloatingButtonPosition(button);
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: state.buttonPosition.left,
      originTop: state.buttonPosition.top,
      moved: false
    };
    button.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  button.addEventListener('pointermove', (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;

    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      dragState.moved = true;
    }

    state.buttonPosition = {
      left: dragState.originLeft + deltaX,
      top: dragState.originTop + deltaY
    };
    applyFloatingLayout();
    event.preventDefault();
  });

  const finishDrag = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    state.lastButtonDrag = dragState.moved;
    button.releasePointerCapture?.(event.pointerId);
    dragState = null;
    event.preventDefault();
  };

  button.addEventListener('pointerup', finishDrag);
  button.addEventListener('pointercancel', finishDrag);
}

function setMode(nextMode) {
  if (nextMode === 'text') {
    state.panelOpen = true;
  }

  state.mode = nextMode;
  log('info', 'Changed input mode', { mode: nextMode });
  syncUiState();

  if (nextMode === 'text') {
    const textarea = document.getElementById('jump-wrapper-textarea');
    textarea?.focus();
    textarea?.select();
    setStatus('文本模式已启用。使用本机 IME 输入，Ctrl+Enter 提交，Esc 取消；可开启中文标点优先。');
    return;
  }

  setStatus('快捷键模式已启用。VS Code 常见快捷键会优先送往远端。');
  setTimeout(() => {
    focusRemoteSink();
  }, 40);
}

function toggleTextMode() {
  setMode(state.mode === 'shortcut' ? 'text' : 'shortcut');
}

function toggleChinesePunctuationPreference() {
  state.preferChinesePunctuation = !state.preferChinesePunctuation;
  log('info', 'Toggled Chinese punctuation preference', {
    enabled: state.preferChinesePunctuation
  });
  syncUiState();
  setStatus(
    state.preferChinesePunctuation
      ? '中文标点优先已开启。输入完成后会自动校正常见中文标点，提交时也会再做一次校正。'
      : '中文标点优先已关闭。提交时将保留原始标点。'
  );
}

function toggleAutoShortcutPunctuation() {
  state.autoShortcutPunctuation = !state.autoShortcutPunctuation;
  log('info', 'Toggled shortcut auto punctuation assist', {
    enabled: state.autoShortcutPunctuation
  });
  syncUiState();
  setStatus(
    state.autoShortcutPunctuation
      ? 'Shortcut Mode 自动中文标点辅助已开启。检测到最近中文输入时，会后台自动补发中文标点。'
      : 'Shortcut Mode 自动中文标点辅助已关闭。中文标点请改用 Text Mode。'
  );
}

async function syncClipboardAvailability() {
  try {
    clipboard.readText();
    state.clipboardReady = true;
  } catch (error) {
    state.clipboardReady = false;
  }

  log('info', 'Checked local clipboard availability', {
    clipboardReady: state.clipboardReady
  });
  syncUiState();
}

function dispatchPageFocus() {
  window.dispatchEvent(new Event('focus'));
}

async function requestDirectRemoteText(text, reason) {
  try {
    const result = await ipcRenderer.invoke('session:insert-text', {
      text,
      reason
    });

    log('info', 'Requested direct remote text insert', {
      reason,
      length: text.length,
      ok: Boolean(result?.ok)
    });
    return Boolean(result?.ok);
  } catch (error) {
    log('warn', 'Direct remote text insert threw an error', {
      reason,
      message: error.message
    });
    return false;
  }
}

async function bridgeTextToRemote(
  text,
  {
    reason = 'text-bridge',
    pasteActionId = 'paste-ctrl-v',
    preferDirectInsert = false,
    restoreClipboard = false
  } = {}
) {
  if (!text) {
    return { ok: false, method: 'empty' };
  }

  if (preferDirectInsert) {
    const inserted = await requestDirectRemoteText(text, reason);

    if (inserted) {
      state.lastCommittedText = text;
      return { ok: true, method: 'insert-text' };
    }
  }

  if (!state.clipboardReady) {
    return { ok: false, method: 'clipboard-unavailable' };
  }

  let clipboardSnapshot = null;
  let shouldRestoreClipboard = false;

  if (restoreClipboard) {
    try {
      clipboardSnapshot = clipboard.readText();
      shouldRestoreClipboard = true;
    } catch (error) {
      log('warn', 'Failed to snapshot local clipboard before bridge send', {
        reason,
        message: error.message
      });
    }
  }

  clipboard.writeText(text);
  state.lastCommittedText = text;
  log('info', 'Submitting remote text through clipboard bridge', {
    reason,
    length: text.length,
    pasteActionId,
    restoreClipboard: shouldRestoreClipboard
  });

  dispatchPageFocus();
  await delay(140);
  focusRemoteSink();
  ipcRenderer.send('session:request-sequence', { actionId: pasteActionId });

  if (shouldRestoreClipboard) {
    setTimeout(() => {
      try {
        clipboard.writeText(clipboardSnapshot || '');
        log('info', 'Restored local clipboard after transient bridge send', {
          reason,
          restoredLength: (clipboardSnapshot || '').length
        });
      } catch (error) {
        log('warn', 'Failed to restore local clipboard after transient bridge send', {
          reason,
          message: error.message
        });
      }
    }, 520);
  }

  return { ok: true, method: 'clipboard-bridge' };
}

async function submitComposer({ fallback = false } = {}) {
  const textarea = document.getElementById('jump-wrapper-textarea');

  if (!textarea) {
    return;
  }

  const rawValue = textarea.value;

  if (!rawValue.trim()) {
    setStatus('请输入要提交到远端的文本。', true);
    return;
  }

  const { normalized, converted } = state.preferChinesePunctuation
    ? normalizeChinesePunctuation(rawValue)
    : { normalized: rawValue, converted: 0 };
  const value = normalized;

  log('info', 'Submitting text mode content', {
    fallback,
    length: value.length,
    convertedPunctuation: converted,
    preferChinesePunctuation: state.preferChinesePunctuation
  });
  setStatus(
    fallback
      ? `文本已写入本地剪贴板，正在使用 Shift+Insert 重试粘贴${converted ? `，并已转换 ${converted} 处中文标点` : ''}。`
      : `文本已写入本地剪贴板，正在同步远端并发送 Ctrl+V${converted ? `，并已转换 ${converted} 处中文标点` : ''}。`
  );

  const submission = await bridgeTextToRemote(value, {
    reason: 'text-mode',
    pasteActionId: fallback ? 'paste-shift-insert' : 'paste-ctrl-v'
  });

  if (!submission.ok) {
    setStatus('本地剪贴板不可用，当前无法使用文本模式。', true);
    return;
  }

  textarea.value = '';
  setMode('shortcut');
}

function requestSpecialSequence(actionId) {
  ipcRenderer.send('session:request-sequence', { actionId });
  log('info', 'Requested special key sequence', { actionId });
  setStatus(`已发送远端组合键: ${actionId}`);

  setTimeout(() => {
    focusRemoteSink();
  }, 20);
}

function syncUiState() {
  const panel = document.getElementById('jump-wrapper-panel');
  const shortcutChip = document.getElementById('jump-wrapper-shortcut-chip');
  const textChip = document.getElementById('jump-wrapper-text-chip');
  const composer = document.getElementById('jump-wrapper-compose');
  const summary = document.getElementById('jump-wrapper-summary');
  const fullscreenButton = document.getElementById('jump-wrapper-fullscreen');
  const punctuationToggle = document.getElementById('jump-wrapper-punctuation-toggle');
  const autoPunctuationToggle = document.getElementById('jump-wrapper-auto-punctuation-toggle');

  if (
    !panel ||
    !shortcutChip ||
    !textChip ||
    !composer ||
    !summary ||
    !fullscreenButton ||
    !punctuationToggle ||
    !autoPunctuationToggle
  ) {
    return;
  }

  panel.classList.toggle('is-open', state.panelOpen);
  shortcutChip.classList.toggle('is-active', state.mode === 'shortcut');
  textChip.classList.toggle('is-active', state.mode === 'text');
  composer.classList.toggle('is-visible', state.mode === 'text');
  summary.textContent = getSessionSummary();
  fullscreenButton.textContent = state.fullScreen ? '退出本地全屏' : '进入本地全屏';
  punctuationToggle.classList.toggle('is-active', state.preferChinesePunctuation);
  punctuationToggle.textContent = `中文标点优先: ${state.preferChinesePunctuation ? '开' : '关'}`;
  autoPunctuationToggle.classList.toggle('is-active', state.autoShortcutPunctuation);
  autoPunctuationToggle.textContent = `Auto CN punct: ${state.autoShortcutPunctuation ? 'ON' : 'OFF'}`;
  applyFloatingLayout();
}

function handleLocalAction(actionId) {
  log('info', 'Received local session action', { actionId });
  if (actionId === 'toggle-panel') {
    togglePanel();
    return;
  }

  if (actionId === 'toggle-text-mode') {
    toggleTextMode();
    return;
  }

  if (actionId === 'toggle-fullscreen') {
    ipcRenderer.send('session:toggle-fullscreen');
  }
}

function createOverlay() {
  if (document.getElementById('jump-wrapper-root')) {
    return;
  }

  ensureStyleTag();

  const root = document.createElement('div');
  root.id = 'jump-wrapper-root';
  log('info', 'Creating session overlay');

  const toggleButton = document.createElement('button');
  toggleButton.id = 'jump-wrapper-toggle';
  toggleButton.type = 'button';
  toggleButton.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" stroke-width="1.8"></rect>
      <path d="M6.5 9.5H8.5M10 9.5H12M13.5 9.5H15.5M17 9.5H17.5" stroke-width="1.8" stroke-linecap="round"></path>
      <path d="M5.5 13H7M8.5 13H10M11.5 13H13M14.5 13H16M17.5 13H18.5" stroke-width="1.8" stroke-linecap="round"></path>
      <path d="M7.5 16.5H16.5" stroke-width="1.8" stroke-linecap="round"></path>
    </svg>
  `;
  toggleButton.title = 'JumpServer Wrapper 面板';
  toggleButton.setAttribute('aria-label', 'Open JumpServer wrapper panel');
  toggleButton.addEventListener('click', () => {
    togglePanel();
  });

  const panel = document.createElement('aside');
  panel.id = 'jump-wrapper-panel';
  panel.innerHTML = `
    <div class="jump-wrapper-stack">
      <div class="jump-wrapper-card jump-wrapper-stack">
        <div>
          <h1 class="jump-wrapper-title">JumpServer Wrapper MVP</h1>
          <p class="jump-wrapper-subtitle">会话窗口已接管高频快捷键，并提供本地 IME 文本提交与特殊按键面板。</p>
        </div>
        <div id="jump-wrapper-status" class="jump-wrapper-status">会话窗口已接管快捷键。</div>
      </div>

      <div class="jump-wrapper-card jump-wrapper-stack">
        <span class="jump-wrapper-label">输入模式</span>
        <div class="jump-wrapper-mode-grid">
          <button id="jump-wrapper-shortcut-chip" type="button" class="jump-wrapper-chip">Shortcut Mode</button>
          <button id="jump-wrapper-text-chip" type="button" class="jump-wrapper-chip">Text Mode</button>
        </div>
        <p class="jump-wrapper-micro">推荐约定远端 IME 保持英文。中文正文通过本地 IME 在 Text Mode 里完成后短句提交。</p>
        <div class="jump-wrapper-inline-controls">
          <button id="jump-wrapper-auto-punctuation-toggle" type="button" class="jump-wrapper-chip">Auto CN punct: ON</button>
          <span class="jump-wrapper-micro">Shortcut Mode 下检测到最近中文输入时，会后台自动补发中文标点，然后立刻把焦点送回远端。</span>
        </div>
      </div>

      <div id="jump-wrapper-compose" class="jump-wrapper-card jump-wrapper-compose">
        <label class="jump-wrapper-label" for="jump-wrapper-textarea">本地中文输入区</label>
        <div class="jump-wrapper-inline-controls">
          <button id="jump-wrapper-punctuation-toggle" type="button" class="jump-wrapper-chip">中文标点优先: 开</button>
          <span class="jump-wrapper-micro">输入完成后会自动把 , . ? ! : ; () [] &lt;&gt; 这些常见半角标点校正为中文标点；提交时也会再补一次。</span>
        </div>
        <textarea id="jump-wrapper-textarea" class="jump-wrapper-textarea" placeholder="在这里用本机输入法完成中文，再用 Ctrl+Enter 提交到远端。"></textarea>
        <div id="jump-wrapper-punctuation-grid" class="jump-wrapper-helper-grid"></div>
        <div class="jump-wrapper-row">
          <button id="jump-wrapper-submit" type="button" class="jump-wrapper-button">提交并发送 Ctrl+V</button>
          <button id="jump-wrapper-submit-fallback" type="button" class="jump-wrapper-secondary">改用 Shift+Insert</button>
        </div>
        <p class="jump-wrapper-micro">Text Mode 依赖本地剪贴板和 JumpServer 会话的远端粘贴权限。当前实现不会真正同步本机/远端 IME 状态。</p>
      </div>

      <div class="jump-wrapper-card jump-wrapper-stack">
        <div class="jump-wrapper-row" style="justify-content: space-between;">
          <span class="jump-wrapper-label" style="margin-bottom: 0;">特殊按键</span>
          <button id="jump-wrapper-fullscreen" type="button" class="jump-wrapper-secondary">进入本地全屏</button>
        </div>
        <div id="jump-wrapper-grid" class="jump-wrapper-grid"></div>
      </div>

      <div class="jump-wrapper-card jump-wrapper-stack">
        <span class="jump-wrapper-label">诊断</span>
        <pre id="jump-wrapper-summary" class="jump-wrapper-micro"></pre>
        <div class="jump-wrapper-row">
          <button id="jump-wrapper-focus" type="button" class="jump-wrapper-secondary">重新聚焦远端</button>
          <button id="jump-wrapper-home" type="button" class="jump-wrapper-secondary">打开主窗口</button>
          <button id="jump-wrapper-close" type="button" class="jump-wrapper-secondary">关闭会话</button>
          <button id="jump-wrapper-quit" type="button" class="jump-wrapper-secondary">退出程序</button>
        </div>
      </div>
    </div>
  `;

  root.appendChild(toggleButton);
  root.appendChild(panel);
  document.body.appendChild(root);
  toggleButton.title = 'JumpServer Wrapper panel (drag to move)';
  toggleButton.addEventListener(
    'click',
    (event) => {
      if (!state.lastButtonDrag) {
        return;
      }

      state.lastButtonDrag = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true
  );
  installFloatingButtonDrag(toggleButton);
  window.addEventListener('resize', applyFloatingLayout);

  const panelDismissButton = document.createElement('button');
  panelDismissButton.id = 'jump-wrapper-panel-dismiss';
  panelDismissButton.type = 'button';
  panelDismissButton.className = 'jump-wrapper-panel-dismiss';
  panelDismissButton.textContent = '×';
  panelDismissButton.title = 'Close panel';
  panel.prepend(panelDismissButton);

  const shortcutChip = document.getElementById('jump-wrapper-shortcut-chip');
  const textChip = document.getElementById('jump-wrapper-text-chip');
  const submitButton = document.getElementById('jump-wrapper-submit');
  const submitFallbackButton = document.getElementById('jump-wrapper-submit-fallback');
  const fullscreenButton = document.getElementById('jump-wrapper-fullscreen');
  const focusButton = document.getElementById('jump-wrapper-focus');
  const homeButton = document.getElementById('jump-wrapper-home');
  const closeButton = document.getElementById('jump-wrapper-close');
  const quitButton = document.getElementById('jump-wrapper-quit');
  const grid = document.getElementById('jump-wrapper-grid');
  const punctuationGrid = document.getElementById('jump-wrapper-punctuation-grid');
  const punctuationToggle = document.getElementById('jump-wrapper-punctuation-toggle');
  const autoPunctuationToggle = document.getElementById('jump-wrapper-auto-punctuation-toggle');
  const textarea = document.getElementById('jump-wrapper-textarea');
  homeButton.textContent = '快捷键映射';
  homeButton.title = '打开首页配置里的快捷键映射';

  shortcutChip.addEventListener('click', () => setMode('shortcut'));
  textChip.addEventListener('click', () => setMode('text'));
  punctuationToggle.addEventListener('click', () => toggleChinesePunctuationPreference());
  autoPunctuationToggle.addEventListener('click', () => toggleAutoShortcutPunctuation());
  panelDismissButton.addEventListener('click', () => {
    state.panelOpen = false;
    syncUiState();
  });
  submitButton.addEventListener('click', () => submitComposer());
  submitFallbackButton.addEventListener('click', () => submitComposer({ fallback: true }));
  fullscreenButton.addEventListener('click', () => ipcRenderer.send('session:toggle-fullscreen'));
  focusButton.addEventListener('click', () => {
    focusRemoteSink();
    setStatus('已尝试重新聚焦远端输入。');
  });
  homeButton.addEventListener('click', () => ipcRenderer.send('session:open-home'));
  closeButton.addEventListener('click', async () => {
    log('info', 'Closing session window from overlay');
    await ipcRenderer.invoke('window:close');
  });
  quitButton.addEventListener('click', async () => {
    log('info', 'Quitting application from session overlay');
    await ipcRenderer.invoke('app:quit');
  });

  textarea.addEventListener('keydown', (event) => {
    if (state.isComposingText || event.isComposing) {
      event.stopPropagation();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      textarea.value = '';
      setMode('shortcut');
      return;
    }

    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault();
      submitComposer();
      return;
    }

    event.stopPropagation();
  });

  textarea.addEventListener('compositionstart', () => {
    state.isComposingText = true;
    log('info', 'Text mode IME composition started');
  });

  textarea.addEventListener('compositionend', () => {
    state.isComposingText = false;
    log('info', 'Text mode IME composition ended');
    setTimeout(() => {
      normalizeTextareaPunctuation(textarea);
    }, 0);
  });

  textarea.addEventListener('input', () => {
    if (state.isComposingText) {
      return;
    }

    normalizeTextareaPunctuation(textarea);
  });

  for (const definition of specialKeyDefinitions) {
    const button = createButton(definition.label, 'jump-wrapper-secondary');
    button.addEventListener('click', () => requestSpecialSequence(definition.id));
    grid.appendChild(button);
  }

  for (const punctuation of chinesePunctuationButtons) {
    const button = createButton(punctuation, 'jump-wrapper-secondary');
    button.addEventListener('click', () => {
      insertTextAtCursor(textarea, punctuation);
      log('info', 'Inserted Chinese punctuation helper', { punctuation });
    });
    punctuationGrid.appendChild(button);
  }

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      if (target.closest('#jump-wrapper-root')) {
        return;
      }

      if (state.mode === 'shortcut') {
        setTimeout(() => {
          focusRemoteSink();
        }, 10);
      }
    },
    true
  );

  syncUiState();
}

function waitForDisplay(retries = 120) {
  if (getDisplayElement()) {
    log('info', 'Detected remote display element');
    setTimeout(() => {
      focusRemoteSink();
    }, 200);
    return;
  }

  if (retries <= 0) {
    log('warn', 'Remote display element not detected before timeout');
    setStatus('未检测到远端显示区域，快捷键与文本模式可能暂时不可用。', true);
    return;
  }

  setTimeout(() => {
    waitForDisplay(retries - 1);
  }, 250);
}

function notifySessionPresence(reason) {
  ipcRenderer.send('session:overlay-ready', {
    reason,
    url: window.location.href,
    pathname: window.location.pathname,
    isMainFrame: process.isMainFrame
  });
}

function notifySessionInactive(reason) {
  ipcRenderer.send('session:overlay-destroyed', {
    reason,
    url: window.location.href,
    pathname: window.location.pathname,
    isMainFrame: process.isMainFrame
  });
}

function initializeSessionOverlay(reason) {
  if (sessionOverlayInitialized) {
    return;
  }

  sessionOverlayInitialized = true;
  log('info', 'Initializing session overlay', { reason, readyState: document.readyState });
  createOverlay();
  installShortcutInputTracking();
  installRendererLocalHotkeys();
  loadLocalHotkeys();
  syncClipboardAvailability();
  waitForDisplay();
  notifySessionPresence(reason);
}

if (document.readyState === 'loading') {
  window.addEventListener(
    'DOMContentLoaded',
    () => {
      initializeSessionOverlay('dom-content-loaded');
    },
    { once: true }
  );
} else {
  initializeSessionOverlay('document-ready');
}

window.addEventListener('beforeunload', () => {
  notifySessionInactive('beforeunload');
});

window.addEventListener('pagehide', () => {
  notifySessionInactive('pagehide');
});

window.addEventListener('focus', () => {
  if (state.mode === 'shortcut') {
    setTimeout(() => {
      focusRemoteSink({ reason: 'renderer-window-focus' });
    }, 80);
  }
});

ipcRenderer.on('session:local-action', (_event, payload) => {
  handleLocalAction(payload.actionId);
});

ipcRenderer.on('session:focus-remote', () => {
  focusRemoteSink({ reason: 'main-process-focus-remote', force: true });
});

ipcRenderer.on('session:window-focus', () => {
  dispatchPageFocus();

  if (state.mode === 'shortcut') {
    setTimeout(() => {
      focusRemoteSink({ reason: 'main-process-window-focus' });
    }, 70);
  }
});

ipcRenderer.on('session:fullscreen-changed', (_event, payload) => {
  state.fullScreen = Boolean(payload.fullScreen);
  log('info', 'Local fullscreen state changed', payload);
  syncUiState();
});

window.addEventListener('error', (event) => {
  log('error', 'Session renderer error', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno
  });
});

window.addEventListener('unhandledrejection', (event) => {
  log('error', 'Session renderer unhandled rejection', {
    reason: String(event.reason)
  });
});
