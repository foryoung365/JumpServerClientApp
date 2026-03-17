const { ipcRenderer } = require('electron');
const preloadScope = process.isMainFrame ? 'home-main' : 'home-subframe';

function isLocalWrapperPage() {
  return window.location.protocol === 'file:';
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

function isSessionLikeDom() {
  return Boolean(document.getElementById('display'));
}

function log(level, message, meta = {}) {
  ipcRenderer.send('log:renderer', {
    scope: preloadScope,
    level,
    message,
    meta
  });
}

function installSessionDetector() {
  let activated = false;
  let observer = null;

  const tryActivate = (reason) => {
    if (activated) {
      return true;
    }

    const sessionByUrl = isSessionLikeUrl(window.location.href);
    const sessionByDom = isSessionLikeDom();

    if (!sessionByUrl && !sessionByDom) {
      return false;
    }

    activated = true;

    if (observer) {
      observer.disconnect();
      observer = null;
    }

    log('info', 'Activating session preload from main window', {
      reason,
      url: window.location.href,
      isMainFrame: process.isMainFrame,
      sessionByUrl,
      sessionByDom
    });

    require('./session-preload');
    return true;
  };

  const scheduleActivation = (reason) => {
    setTimeout(() => {
      tryActivate(reason);
    }, 0);
  };

  const patchHistoryMethod = (methodName) => {
    const original = window.history[methodName];

    if (typeof original !== 'function') {
      return;
    }

    window.history[methodName] = function patchedHistoryMethod(...args) {
      const result = original.apply(this, args);
      scheduleActivation(`history-${methodName}`);
      return result;
    };
  };

  if (document.readyState === 'loading') {
    window.addEventListener(
      'DOMContentLoaded',
      () => {
        tryActivate('dom-content-loaded');
      },
      { once: true }
    );
  } else {
    tryActivate('document-ready');
  }

  patchHistoryMethod('pushState');
  patchHistoryMethod('replaceState');
  window.addEventListener('popstate', () => scheduleActivation('popstate'));
  window.addEventListener('hashchange', () => scheduleActivation('hashchange'));

  if (typeof MutationObserver === 'function' && document.documentElement) {
    observer = new MutationObserver(() => {
      tryActivate('dom-mutation');
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  tryActivate('initial-check');
}

if (isLocalWrapperPage()) {
  window.jumpWrapperHome = {
    getConfig() {
      return ipcRenderer.invoke('config:get');
    },
    saveConfig(payload) {
      return ipcRenderer.invoke('config:save', payload);
    },
    resetServer() {
      return ipcRenderer.invoke('config:reset-server');
    },
    launchServer() {
      return ipcRenderer.invoke('app:launch-server');
    },
    closeWindow() {
      return ipcRenderer.invoke('window:close');
    },
    quitApp() {
      return ipcRenderer.invoke('app:quit');
    },
    openLogs() {
      return ipcRenderer.invoke('shell:open-logs');
    },
    log
  };
} else {
  log('info', 'Remote preload bootstrap', {
    url: window.location.href,
    isMainFrame: process.isMainFrame,
    readyState: document.readyState
  });
  installSessionDetector();
}
