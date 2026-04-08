const { ipcRenderer } = require('electron');

const { chooseLoginFieldPair, shouldPromptToSaveCredentials } = require('./login-form-helpers');

const LOGIN_PROMPT_ID = 'jump-wrapper-login-save-prompt';
const LOGIN_PROMPT_STYLE_ID = 'jump-wrapper-login-save-style';

const state = {
  status: null,
  savedLogin: null,
  pendingAttempt: null,
  promptVisible: false,
  autofillFingerprint: '',
  submitBoundForms: new WeakSet()
};

function log(level, message, meta = {}) {
  ipcRenderer.send('log:renderer', {
    scope: 'login-main',
    level,
    message,
    meta: {
      url: window.location.href,
      ...meta
    }
  });
}

function isSessionLikeUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return (
      /(?:^|\/)(?:lion\/)?connect\/?$/i.test(parsed.pathname) ||
      /(?:^|\/)(?:lion\/)?monitor\/?$/i.test(parsed.pathname) ||
      /(?:^|\/)(?:lion\/)?share\/[^/]+\/?$/i.test(parsed.pathname)
    );
  } catch (_error) {
    return false;
  }
}

function isVisibleElement(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const style = window.getComputedStyle(element);

  if (element.hidden || style.display === 'none' || style.visibility === 'hidden') {
    return false;
  }

  return element.getClientRects().length > 0;
}

function toFieldDescriptor(element) {
  return {
    element,
    type: element.type,
    name: element.name,
    autocomplete: element.autocomplete,
    placeholder: element.placeholder,
    visible: isVisibleElement(element),
    disabled: element.disabled,
    readOnly: element.readOnly
  };
}

function getLoginFieldCandidate() {
  const containers = [...document.querySelectorAll('form')];

  if (!containers.length) {
    containers.push(document);
  }

  let fallbackCandidate = null;

  for (const container of containers) {
    const descriptors = [...container.querySelectorAll('input')].map((element) => toFieldDescriptor(element));
    const pair = chooseLoginFieldPair(descriptors);

    if (!pair?.passwordField || !pair?.usernameField?.element) {
      continue;
    }

    const candidate = {
      container,
      form: container instanceof HTMLFormElement ? container : pair.passwordField.element.form,
      usernameField: pair.usernameField.element,
      passwordField: pair.passwordField.element
    };

    if (candidate.form) {
      return candidate;
    }

    fallbackCandidate = candidate;
  }

  return fallbackCandidate;
}

function dispatchValueEvents(element) {
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function applyFieldValue(element, value) {
  if (!element || element.value === value) {
    return false;
  }

  element.focus();
  element.value = value;
  dispatchValueEvents(element);
  return true;
}

async function refreshCredentialState() {
  state.status = await ipcRenderer.invoke('credentials:get-status', {
    serverUrl: window.location.href
  });
  state.savedLogin = state.status?.hasSavedCredentials
    ? await ipcRenderer.invoke('credentials:get-login', {
        serverUrl: window.location.href
      })
    : null;
}

function getAutofillFingerprint(candidate, savedLogin) {
  return [
    window.location.origin,
    candidate.usernameField.name || candidate.usernameField.id || 'username',
    candidate.passwordField.name || candidate.passwordField.id || 'password',
    savedLogin.username
  ].join('|');
}

function maybeAutofillLogin(candidate, reason) {
  if (!candidate || !state.savedLogin) {
    return;
  }

  const fingerprint = getAutofillFingerprint(candidate, state.savedLogin);

  if (state.autofillFingerprint === fingerprint) {
    return;
  }

  const usernameChanged = applyFieldValue(candidate.usernameField, state.savedLogin.username);
  const passwordChanged = applyFieldValue(candidate.passwordField, state.savedLogin.password);

  if (!usernameChanged && !passwordChanged) {
    state.autofillFingerprint = fingerprint;
    return;
  }

  state.autofillFingerprint = fingerprint;
  log('info', 'Autofilled JumpServer login form', {
    reason,
    usernameField: candidate.usernameField.name || candidate.usernameField.id || null
  });
}

function dismissPrompt() {
  const prompt = document.getElementById(LOGIN_PROMPT_ID);
  prompt?.remove();
  state.promptVisible = false;
}

function buildPromptMessage() {
  if (!state.pendingAttempt) {
    return '是否保存当前 JumpServer 登录信息？';
  }

  if (
    state.savedLogin &&
    state.savedLogin.username === state.pendingAttempt.username &&
    state.savedLogin.password !== state.pendingAttempt.password
  ) {
    return '检测到当前账号密码已变更，是否更新已保存登录？';
  }

  if (state.savedLogin) {
    return '检测到登录成功，是否用当前账号密码覆盖已保存登录？';
  }

  return '检测到登录成功，是否保存当前账号密码？';
}

function ensurePromptStyle() {
  if (document.getElementById(LOGIN_PROMPT_STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = LOGIN_PROMPT_STYLE_ID;
  style.textContent = `
    #${LOGIN_PROMPT_ID} {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      max-width: min(420px, calc(100vw - 40px));
      padding: 16px 18px;
      border-radius: 16px;
      border: 1px solid rgba(20, 184, 166, 0.28);
      background: rgba(8, 15, 23, 0.96);
      color: #e2e8f0;
      box-shadow: 0 24px 64px rgba(2, 6, 23, 0.42);
      font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
    }

    #${LOGIN_PROMPT_ID} .jump-wrapper-login-title {
      font-size: 15px;
      font-weight: 700;
      margin-bottom: 6px;
    }

    #${LOGIN_PROMPT_ID} .jump-wrapper-login-copy {
      font-size: 13px;
      line-height: 1.6;
      color: #cbd5e1;
    }

    #${LOGIN_PROMPT_ID} .jump-wrapper-login-actions {
      display: flex;
      gap: 10px;
      margin-top: 14px;
    }

    #${LOGIN_PROMPT_ID} button {
      border: none;
      border-radius: 12px;
      padding: 10px 14px;
      cursor: pointer;
      font: inherit;
    }

    #${LOGIN_PROMPT_ID} .jump-wrapper-login-primary {
      background: linear-gradient(135deg, #0f766e, #14b8a6);
      color: white;
      font-weight: 700;
    }

    #${LOGIN_PROMPT_ID} .jump-wrapper-login-secondary {
      background: rgba(30, 41, 59, 0.92);
      color: #e2e8f0;
    }
  `;

  document.head.appendChild(style);
}

async function savePendingAttempt() {
  if (!state.pendingAttempt) {
    return;
  }

  await ipcRenderer.invoke('credentials:save-login', {
    serverUrl: window.location.href,
    username: state.pendingAttempt.username,
    password: state.pendingAttempt.password
  });

  await refreshCredentialState();
  state.pendingAttempt = null;
  dismissPrompt();
}

function showSavePrompt() {
  if (state.promptVisible || !state.pendingAttempt) {
    return;
  }

  ensurePromptStyle();
  dismissPrompt();

  const prompt = document.createElement('section');
  prompt.id = LOGIN_PROMPT_ID;
  prompt.innerHTML = `
    <div class="jump-wrapper-login-title">JumpServer Wrapper</div>
    <div class="jump-wrapper-login-copy">${buildPromptMessage()}</div>
    <div class="jump-wrapper-login-actions">
      <button type="button" class="jump-wrapper-login-primary">保存</button>
      <button type="button" class="jump-wrapper-login-secondary">暂不保存</button>
    </div>
  `;

  const [saveButton, skipButton] = prompt.querySelectorAll('button');

  saveButton.addEventListener('click', async () => {
    try {
      await savePendingAttempt();
      log('info', 'Saved login credentials after successful login');
    } catch (error) {
      log('warn', 'Failed to save login credentials', {
        message: error.message
      });
      dismissPrompt();
    }
  });

  skipButton.addEventListener('click', () => {
    state.pendingAttempt = null;
    dismissPrompt();
  });

  document.body.appendChild(prompt);
  state.promptVisible = true;
}

function captureAttempt(candidate, reason) {
  if (!candidate?.usernameField || !candidate?.passwordField) {
    return;
  }

  const username = candidate.usernameField.value.trim();
  const password = candidate.passwordField.value;

  if (!username || !password) {
    return;
  }

  state.pendingAttempt = {
    initialUrl: window.location.href,
    username,
    password,
    reason
  };
  dismissPrompt();

  log('info', 'Captured login attempt for possible save prompt', {
    reason,
    username
  });
}

function shouldSkipPromptBecauseAlreadySaved() {
  return (
    state.pendingAttempt &&
    state.savedLogin &&
    state.savedLogin.username === state.pendingAttempt.username &&
    state.savedLogin.password === state.pendingAttempt.password
  );
}

function evaluatePendingAttempt(reason) {
  if (!state.pendingAttempt || !state.status?.canPersist) {
    return;
  }

  if (shouldSkipPromptBecauseAlreadySaved()) {
    state.pendingAttempt = null;
    return;
  }

  const candidate = getLoginFieldCandidate();
  const shouldPrompt = shouldPromptToSaveCredentials({
    initialUrl: state.pendingAttempt.initialUrl,
    currentUrl: window.location.href,
    hasVisiblePasswordField: Boolean(candidate?.passwordField)
  });

  if (!shouldPrompt) {
    return;
  }

  log('info', 'Detected successful login, showing credential save prompt', {
    reason,
    username: state.pendingAttempt.username
  });
  showSavePrompt();
}

function bindFormSubmit(candidate) {
  if (!candidate?.form || state.submitBoundForms.has(candidate.form)) {
    return;
  }

  candidate.form.addEventListener(
    'submit',
    () => {
      captureAttempt(candidate, 'form-submit');
    },
    true
  );
  state.submitBoundForms.add(candidate.form);
}

async function syncLoginSurface(reason) {
  if (isSessionLikeUrl(window.location.href)) {
    dismissPrompt();
    return;
  }

  await refreshCredentialState();

  const candidate = getLoginFieldCandidate();

  if (candidate) {
    bindFormSubmit(candidate);
    maybeAutofillLogin(candidate, reason);
  }

  evaluatePendingAttempt(reason);
}

function scheduleSync(reason) {
  setTimeout(() => {
    void syncLoginSurface(reason);
  }, 0);
}

function patchHistoryMethod(methodName) {
  const original = window.history[methodName];

  if (typeof original !== 'function') {
    return;
  }

  window.history[methodName] = function patchedHistoryMethod(...args) {
    const result = original.apply(this, args);
    scheduleSync(`history-${methodName}`);
    return result;
  };
}

function install() {
  if (window.location.protocol === 'file:' || !process.isMainFrame) {
    return;
  }

  document.addEventListener(
    'submit',
    () => {
      captureAttempt(getLoginFieldCandidate(), 'document-submit');
    },
    true
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Enter') {
        return;
      }

      const target = event.target;

      if (!(target instanceof HTMLInputElement) || target.type !== 'password') {
        return;
      }

      captureAttempt(getLoginFieldCandidate(), 'password-enter');
    },
    true
  );

  patchHistoryMethod('pushState');
  patchHistoryMethod('replaceState');
  window.addEventListener('popstate', () => scheduleSync('popstate'));
  window.addEventListener('hashchange', () => scheduleSync('hashchange'));

  if (typeof MutationObserver === 'function' && document.documentElement) {
    const observer = new MutationObserver(() => {
      scheduleSync('dom-mutation');
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === 'loading') {
    window.addEventListener(
      'DOMContentLoaded',
      () => {
        scheduleSync('dom-content-loaded');
      },
      { once: true }
    );
  } else {
    scheduleSync('document-ready');
  }

  log('info', 'Installed JumpServer login preload');
}

install();
