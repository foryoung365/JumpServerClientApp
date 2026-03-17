const path = require('node:path');

const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');

const { ConfigStore } = require('./config-store');
const { createLogger } = require('./logger');
const { isJumpServerCandidate, isSessionUrl, parseUrl } = require('./url-rules');
const {
  SPECIAL_SEQUENCE_MAP,
  buildReplayEvents,
  findForwardedShortcut,
  findLocalAction
} = require('./session-shortcuts');

let configStore;
let logger;
let mainWindow;
let mainWindowSessionContext = null;

const activeSessionContents = new Set();
const sessionFrameRoutes = new Map();
const sessionTargetFrameRoute = new Map();
const sessionWindows = new Map();
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (logger) {
    logger.info('Second instance requested; focusing existing window');
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.focus();
    return;
  }

  createMainWindow();
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAssetPath(...segments) {
  return path.join(__dirname, '..', ...segments);
}

function getConfig() {
  return configStore.get();
}

function isLoggingEnabled() {
  return getConfig().diagnostics?.loggingEnabled !== false;
}

function isSessionPageUrl(rawUrl) {
  return isSessionUrl(rawUrl, getConfig().serverUrl);
}

function markSessionPresence(webContentsId, isActive) {
  if (!webContentsId) {
    return;
  }

  if (isActive) {
    activeSessionContents.add(webContentsId);
    return;
  }

  activeSessionContents.delete(webContentsId);
}

function getFrameRouteKey(processId, frameId) {
  return `${processId}:${frameId}`;
}

function clearSessionFrameRoutes(webContentsId) {
  sessionFrameRoutes.delete(webContentsId);
  sessionTargetFrameRoute.delete(webContentsId);
}

function registerSessionFrameRoute(event, payload = {}) {
  const processId = Number.isInteger(event.processId) ? event.processId : event.senderFrame?.processId;
  const frameId = Number.isInteger(event.frameId) ? event.frameId : event.senderFrame?.routingId;

  if (!Number.isInteger(processId) || !Number.isInteger(frameId)) {
    return null;
  }

  const webContentsId = event.sender.id;
  const routeKey = getFrameRouteKey(processId, frameId);
  const routes = sessionFrameRoutes.get(webContentsId) || new Map();
  const route = {
    processId,
    frameId,
    isMainFrame: Boolean(payload.isMainFrame)
  };

  routes.set(routeKey, route);
  sessionFrameRoutes.set(webContentsId, routes);
  sessionTargetFrameRoute.set(webContentsId, routeKey);
  return route;
}

function unregisterSessionFrameRoute(event) {
  const processId = Number.isInteger(event.processId) ? event.processId : event.senderFrame?.processId;
  const frameId = Number.isInteger(event.frameId) ? event.frameId : event.senderFrame?.routingId;

  if (!Number.isInteger(processId) || !Number.isInteger(frameId)) {
    return null;
  }

  const webContentsId = event.sender.id;
  const routes = sessionFrameRoutes.get(webContentsId);

  if (!routes) {
    return null;
  }

  const routeKey = getFrameRouteKey(processId, frameId);
  routes.delete(routeKey);

  if (!routes.size) {
    clearSessionFrameRoutes(webContentsId);
    return routeKey;
  }

  sessionTargetFrameRoute.set(webContentsId, Array.from(routes.keys()).pop());
  return routeKey;
}

function sendToSessionRenderer(sessionContext, channel, payload) {
  if (!sessionContext || !sessionContext.window || sessionContext.window.isDestroyed()) {
    return;
  }

  const webContents = sessionContext.window.webContents;
  const targetKey = sessionTargetFrameRoute.get(webContents.id);
  const routes = sessionFrameRoutes.get(webContents.id);
  const targetRoute = targetKey && routes ? routes.get(targetKey) : null;

  if (!targetRoute || targetRoute.isMainFrame || typeof webContents.sendToFrame !== 'function') {
    webContents.send(channel, payload);
    return;
  }

  webContents.sendToFrame([targetRoute.processId, targetRoute.frameId], channel, payload);
}

function isWindowShowingSessionPage(windowInstance) {
  if (!windowInstance || windowInstance.isDestroyed()) {
    return false;
  }

  const webContentsId = windowInstance.webContents.id;

  return activeSessionContents.has(webContentsId) || isSessionPageUrl(windowInstance.webContents.getURL());
}

function isManagedRemotePageUrl(rawUrl) {
  if (!rawUrl || rawUrl.startsWith('file://')) {
    return false;
  }

  return isJumpServerCandidate(rawUrl, getConfig().serverUrl);
}

function isWindowShowingManagedRemotePage(windowInstance) {
  if (!windowInstance || windowInstance.isDestroyed()) {
    return false;
  }

  return isManagedRemotePageUrl(windowInstance.webContents.getURL());
}

function loadUrlInExistingWindow(windowInstance, url, reason) {
  if (!windowInstance || windowInstance.isDestroyed()) {
    return;
  }

  logger.info('Loading JumpServer URL in existing window', {
    reason,
    windowId: windowInstance.id,
    url
  });

  windowInstance.show();
  windowInstance.focus();
  windowInstance.loadURL(url);
}

function buildMenu() {
  const template = [
    {
      label: 'JumpServer Wrapper',
      submenu: [
        {
          label: 'Home',
          click: () => openHomePage()
        },
        {
          label: 'Open Config Folder',
          click: () => shell.openPath(app.getPath('userData'))
        },
        {
          label: 'Open Logs',
          click: () => {
            logger.ensureLogDir();
            shell.openPath(logger.logDir);
          }
        },
        { type: 'separator' },
        {
          label: 'Quit',
          role: 'quit'
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function buildMainWindowOptions() {
  return {
    width: 1320,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    autoHideMenuBar: true,
    backgroundColor: '#0f1720',
    title: 'JumpServer Wrapper',
    webPreferences: {
      preload: getAssetPath('preload', 'home-preload.js'),
      nodeIntegration: false,
      nodeIntegrationInSubFrames: true,
      contextIsolation: false,
      sandbox: false,
      spellcheck: false
    }
  };
}

function buildSessionWindowOptions(url) {
  const parsed = parseUrl(url);
  const titleSuffix = parsed ? parsed.pathname : 'Session';

  return {
    width: 1440,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    autoHideMenuBar: true,
    backgroundColor: '#0a0f14',
    title: `JumpServer Session - ${titleSuffix}`,
    webPreferences: {
      preload: getAssetPath('preload', 'session-preload.js'),
      nodeIntegration: false,
      nodeIntegrationInSubFrames: true,
      contextIsolation: false,
      sandbox: false,
      spellcheck: false
    }
  };
}

function attachMainWindowHandlers(windowInstance) {
  const windowLogger = logger.child(`main-window:${windowInstance.webContents.id}`);
  const sessionContext = {
    window: windowInstance,
    replayingDepth: 0,
    forceClosing: false
  };

  mainWindowSessionContext = sessionContext;

  if (typeof windowInstance.webContents.setIgnoreMenuShortcuts === 'function') {
    windowInstance.webContents.setIgnoreMenuShortcuts(true);
  }

  windowInstance.webContents.setWindowOpenHandler(({ url }) => {
    const config = getConfig();
    windowLogger.info('Window open requested', { url });

    if (isSessionUrl(url, config.serverUrl)) {
      loadUrlInExistingWindow(windowInstance, url, 'main-window-open-session');
      return { action: 'deny' };
    }

    if (isJumpServerCandidate(url, config.serverUrl)) {
      loadUrlInExistingWindow(windowInstance, url, 'main-window-open-internal');
      return { action: 'deny' };
    }

    shell.openExternal(url);
    return { action: 'deny' };
  });

  windowInstance.webContents.on('will-navigate', (event, url) => {
    const config = getConfig();
    windowLogger.info('Main window navigating', { url });

    if (url.startsWith('file://')) {
      return;
    }

    if (isJumpServerCandidate(url, config.serverUrl)) {
      return;
    }

    event.preventDefault();
    shell.openExternal(url);
  });

  windowInstance.webContents.on('did-navigate', (_event, url) => {
    if (!isSessionPageUrl(url)) {
      return;
    }

    windowLogger.info('Main window navigated into session page', { url });
  });

  windowInstance.webContents.on('did-navigate-in-page', (_event, url) => {
    if (!isSessionPageUrl(url)) {
      return;
    }

    windowLogger.info('Main window navigated inside session page', { url });
  });

  windowInstance.webContents.on('will-prevent-unload', (event) => {
    if (!isWindowShowingSessionPage(windowInstance) && !isWindowShowingManagedRemotePage(windowInstance)) {
      return;
    }

    windowLogger.warn('Main window session page attempted to prevent unload; allowing close', {
      url: windowInstance.webContents.getURL()
    });
    event.preventDefault();
  });

  windowInstance.on('close', (event) => {
    if (
      (!isWindowShowingSessionPage(windowInstance) && !isWindowShowingManagedRemotePage(windowInstance)) ||
      sessionContext.forceClosing ||
      windowInstance.isDestroyed()
    ) {
      return;
    }

    sessionContext.forceClosing = true;
    event.preventDefault();
    windowLogger.warn('Force-destroying main window because it is showing a JumpServer remote page', {
      url: windowInstance.webContents.getURL()
    });
    windowInstance.destroy();
  });

  windowInstance.webContents.on('before-input-event', (event, input) => {
    if (!isWindowShowingSessionPage(windowInstance) || sessionContext.replayingDepth > 0) {
      return;
    }

    if (input.type !== 'keyDown') {
      return;
    }

    const localAction = findLocalAction(input, getConfig().localHotkeys);

    if (localAction) {
      event.preventDefault();
      windowLogger.info('Local session action intercepted in main window', {
        actionId: localAction.id,
        trigger: localAction.triggerDisplay,
        key: input.key,
        code: input.code
      });
      sendToSessionRenderer(sessionContext, 'session:local-action', {
        actionId: localAction.id
      });
      return;
    }

    const forwardedShortcut = findForwardedShortcut(input, getConfig().shortcutMappings);

    if (forwardedShortcut) {
      event.preventDefault();
      windowLogger.info('Forwarding shortcut to remote session from main window', {
        shortcutId: forwardedShortcut.id,
        trigger: forwardedShortcut.triggerDisplay,
        remote: forwardedShortcut.remoteDisplay,
        source: forwardedShortcut.source,
        keys: forwardedShortcut.keys
      });
      replaySequence(sessionContext, forwardedShortcut.id, forwardedShortcut.keys);
    }
  });

  windowInstance.on('focus', () => {
    if (!isWindowShowingSessionPage(windowInstance)) {
      return;
    }

    sendToSessionRenderer(sessionContext, 'session:window-focus');
  });
}

function attachWebContentsDiagnostics(windowInstance, scope) {
  const windowLogger = logger.child(`${scope}:${windowInstance.webContents.id}`);
  const webContentsId = windowInstance.webContents.id;

  windowInstance.webContents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
    windowLogger.info('Navigation started', { url, isInPlace, isMainFrame });
  });

  windowInstance.webContents.on('did-navigate', (_event, url) => {
    windowLogger.info('Navigation completed', { url });
  });

  windowInstance.webContents.on('did-frame-navigate', (_event, url, httpResponseCode, httpStatusText, isMainFrame) => {
    windowLogger.info('Frame navigation completed', {
      url,
      httpResponseCode,
      httpStatusText,
      isMainFrame
    });

    if (isSessionPageUrl(url)) {
      markSessionPresence(webContentsId, true);
      windowLogger.info('Marked webContents as active session because a frame navigated into Lion page', {
        url,
        isMainFrame
      });
      return;
    }

    if (isMainFrame && !isManagedRemotePageUrl(url)) {
      markSessionPresence(webContentsId, false);
    }
  });

  windowInstance.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    windowLogger.error('Load failed', {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame
    });
  });

  windowInstance.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level < 2) {
      return;
    }

    const method = level >= 3 ? 'error' : 'warn';
    windowLogger[method]('Renderer console message', {
      level,
      message,
      line,
      sourceId
    });
  });

  windowInstance.webContents.on('render-process-gone', (_event, details) => {
    windowLogger.error('Render process gone', details);
  });

  windowInstance.on('unresponsive', () => {
    windowLogger.warn('Window became unresponsive');
  });

  windowInstance.on('responsive', () => {
    windowLogger.info('Window responsive again');
  });

  windowInstance.on('close', () => {
    windowLogger.info('Window close requested', {
      windowId: windowInstance.id,
      url: windowInstance.webContents.getURL()
    });
  });

  windowInstance.webContents.on('destroyed', () => {
    markSessionPresence(webContentsId, false);
  });

  windowInstance.on('closed', () => {
    markSessionPresence(webContentsId, false);
    clearSessionFrameRoutes(webContentsId);
  });
}

function loadConfiguredTarget(windowInstance, initialUrl) {
  if (initialUrl) {
    windowInstance.loadURL(initialUrl);
    return;
  }

  const { serverUrl } = getConfig();

  if (serverUrl) {
    windowInstance.loadURL(serverUrl);
    return;
  }

  openHomePage(windowInstance);
}

function createMainWindow(initialUrl) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (initialUrl) {
      mainWindow.loadURL(initialUrl);
    }
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow(buildMainWindowOptions());
  attachMainWindowHandlers(mainWindow);
  attachWebContentsDiagnostics(mainWindow, 'main-window');

  mainWindow.on('closed', () => {
    if (mainWindowSessionContext?.window === mainWindow) {
      mainWindowSessionContext = null;
    }
    mainWindow = null;
  });

  mainWindow.webContents.on('did-finish-load', () => {
    logger.info('Main window loaded', { url: mainWindow.webContents.getURL() });
  });

  loadConfiguredTarget(mainWindow, initialUrl);

  return mainWindow;
}

function openHomePage(targetWindow = mainWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) {
    createMainWindow();
    return;
  }

  targetWindow.loadFile(getAssetPath('renderer', 'home.html'));
}

function getSessionContextByWebContents(webContentsId) {
  if (sessionWindows.has(webContentsId)) {
    return sessionWindows.get(webContentsId) || null;
  }

  if (
    mainWindowSessionContext &&
    mainWindowSessionContext.window &&
    !mainWindowSessionContext.window.isDestroyed() &&
    mainWindowSessionContext.window.webContents.id === webContentsId &&
    isWindowShowingSessionPage(mainWindowSessionContext.window)
  ) {
    return mainWindowSessionContext;
  }

  return null;
}

async function replaySequence(sessionContext, actionId, keys) {
  if (!sessionContext || !sessionContext.window || sessionContext.window.isDestroyed()) {
    return;
  }

  const sequenceKeys = keys || SPECIAL_SEQUENCE_MAP[actionId];

  if (!sequenceKeys) {
    logger.warn('Unknown session key sequence requested', { actionId });
    return;
  }

  const replayEvents = buildReplayEvents(sequenceKeys);
  sessionContext.replayingDepth += 1;

  try {
    sendToSessionRenderer(sessionContext, 'session:focus-remote');
    await delay(30);

    for (const replayEvent of replayEvents) {
      sessionContext.window.webContents.sendInputEvent(replayEvent);
      await delay(8);
    }
  } catch (error) {
    logger.error('Failed to replay remote sequence', {
      actionId,
      error: error.message
    });
  } finally {
    setTimeout(() => {
      sessionContext.replayingDepth = Math.max(0, sessionContext.replayingDepth - 1);
    }, 80);
  }
}

function attachSessionHandlers(windowInstance) {
  const windowLogger = logger.child(`session-window:${windowInstance.webContents.id}`);
  const sessionContext = {
    window: windowInstance,
    replayingDepth: 0,
    forceClosing: false
  };

  sessionWindows.set(windowInstance.webContents.id, sessionContext);
  windowInstance.setMenu(null);
  windowInstance.removeMenu();
  attachWebContentsDiagnostics(windowInstance, 'session-window');

  if (typeof windowInstance.webContents.setIgnoreMenuShortcuts === 'function') {
    windowInstance.webContents.setIgnoreMenuShortcuts(true);
  }

  windowInstance.webContents.on('will-prevent-unload', (event) => {
    windowLogger.warn('Session page attempted to prevent unload; allowing window close', {
      windowId: windowInstance.id,
      url: windowInstance.webContents.getURL()
    });
    event.preventDefault();
  });

  windowInstance.on('close', (event) => {
    if (sessionContext.forceClosing || windowInstance.isDestroyed()) {
      return;
    }

    sessionContext.forceClosing = true;
    event.preventDefault();
    windowLogger.warn('Force-destroying session window to bypass remote unload hang', {
      windowId: windowInstance.id,
      url: windowInstance.webContents.getURL()
    });
    windowInstance.destroy();
  });

  windowInstance.webContents.on('before-input-event', (event, input) => {
    if (sessionContext.replayingDepth > 0) {
      return;
    }

    if (input.type !== 'keyDown') {
      return;
    }

    const localAction = findLocalAction(input, getConfig().localHotkeys);

    if (localAction) {
      event.preventDefault();
      windowLogger.info('Local session action intercepted', {
        actionId: localAction.id,
        trigger: localAction.triggerDisplay,
        key: input.key,
        code: input.code
      });
      sendToSessionRenderer(sessionContext, 'session:local-action', {
        actionId: localAction.id
      });
      return;
    }

    const forwardedShortcut = findForwardedShortcut(input, getConfig().shortcutMappings);

    if (forwardedShortcut) {
      event.preventDefault();
      windowLogger.info('Forwarding shortcut to remote session', {
        shortcutId: forwardedShortcut.id,
        trigger: forwardedShortcut.triggerDisplay,
        remote: forwardedShortcut.remoteDisplay,
        source: forwardedShortcut.source,
        keys: forwardedShortcut.keys
      });
      replaySequence(sessionContext, forwardedShortcut.id, forwardedShortcut.keys);
    }
  });

  windowInstance.on('focus', () => {
    sendToSessionRenderer(sessionContext, 'session:window-focus');
  });

  windowInstance.on('closed', () => {
    windowLogger.info('Session window closed');
    sessionWindows.delete(windowInstance.webContents.id);
  });

  windowInstance.webContents.setWindowOpenHandler(({ url }) => {
    const config = getConfig();
    windowLogger.info('Session window open requested', { url });

    if (isSessionUrl(url, config.serverUrl)) {
      loadUrlInExistingWindow(windowInstance, url, 'session-window-open-session');
      return { action: 'deny' };
    }

    if (isJumpServerCandidate(url, config.serverUrl)) {
      loadUrlInExistingWindow(mainWindow || windowInstance, url, 'session-window-open-internal');
      return { action: 'deny' };
    }

    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createSessionWindow(url) {
  const sessionWindow = new BrowserWindow(buildSessionWindowOptions(url));
  attachSessionHandlers(sessionWindow);

  sessionWindow.loadURL(url);

  sessionWindow.webContents.on('did-finish-load', () => {
    logger.info('Session window loaded', { url });
  });

  return sessionWindow;
}

function validateServerUrl(url) {
  const parsed = parseUrl(url);

  if (!parsed) {
    return { ok: false, error: '请输入有效的 JumpServer 地址。' };
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    return { ok: false, error: '仅支持 http 或 https 地址。' };
  }

  return { ok: true };
}

function registerIpcHandlers() {
  ipcMain.handle('config:get', async () => {
    logger.ensureLogDir();
    return {
      ...getConfig(),
      logDir: logger.logDir,
      logPath: logger.logPath
    };
  });

  ipcMain.handle('config:save', async (_event, payload) => {
    const validation = validateServerUrl(payload.serverUrl);

    if (!validation.ok) {
      throw new Error(validation.error);
    }

    const saved = configStore.save(payload);
    logger.info('Saved configuration', {
      serverUrl: saved.serverUrl,
      loggingEnabled: saved.diagnostics?.loggingEnabled,
      shortcutMappingCount: saved.shortcutMappings?.length || 0
    });
    return {
      ...saved,
      logDir: logger.logDir,
      logPath: logger.logPath
    };
  });

  ipcMain.handle('config:reset-server', async () => {
    const saved = configStore.resetServerUrl();
    openHomePage();
    return {
      ...saved,
      logDir: logger.logDir,
      logPath: logger.logPath
    };
  });

  ipcMain.handle('app:launch-server', async () => {
    const { serverUrl } = getConfig();

    if (!serverUrl) {
      throw new Error('请先配置 JumpServer 地址。');
    }

    createMainWindow(serverUrl);
    return {
      ok: true
    };
  });

  ipcMain.handle('shell:open-logs', async () => {
    logger.ensureLogDir();
    await shell.openPath(logger.logDir);
    return { ok: true };
  });

  ipcMain.handle('window:close', async (event) => {
    const windowInstance = BrowserWindow.fromWebContents(event.sender);
    const sessionContext = getSessionContextByWebContents(event.sender.id);

    if (!windowInstance) {
      logger.warn('Renderer requested window close but no owning window was found', {
        senderId: event.sender.id
      });
      return { ok: false };
    }

    logger.info('Renderer requested window close', {
      senderId: event.sender.id,
      windowId: windowInstance.id,
      url: windowInstance.webContents.getURL(),
      isSessionWindow: Boolean(sessionContext)
    });

    if (sessionContext) {
      sessionContext.forceClosing = true;
      windowInstance.destroy();
      return { ok: true };
    }

    windowInstance.close();
    return { ok: true };
  });

  ipcMain.handle('app:quit', async (event) => {
    logger.info('Renderer requested application quit', {
      senderId: event.sender.id
    });
    app.quit();
    return { ok: true };
  });

  ipcMain.on('session:overlay-ready', (event, payload = {}) => {
    const frameRoute = registerSessionFrameRoute(event, payload);
    markSessionPresence(event.sender.id, true);
    logger.info('Renderer reported active session overlay', {
      senderId: event.sender.id,
      url: payload.url,
      pathname: payload.pathname,
      reason: payload.reason,
      processId: frameRoute?.processId,
      frameId: frameRoute?.frameId,
      isMainFrame: frameRoute?.isMainFrame
    });
  });

  ipcMain.on('session:overlay-destroyed', (event, payload = {}) => {
    const routeKey = unregisterSessionFrameRoute(event);
    markSessionPresence(event.sender.id, false);
    logger.info('Renderer reported inactive session overlay', {
      senderId: event.sender.id,
      url: payload.url,
      pathname: payload.pathname,
      reason: payload.reason,
      routeKey
    });
  });

  ipcMain.on('session:request-sequence', async (event, payload) => {
    const sessionContext = getSessionContextByWebContents(event.sender.id);

    if (!sessionContext) {
      return;
    }

    logger.info('Renderer requested key sequence', {
      senderId: event.sender.id,
      actionId: payload.actionId,
      keys: payload.keys
    });
    await replaySequence(sessionContext, payload.actionId, payload.keys);
  });

  ipcMain.handle('session:insert-text', async (event, payload = {}) => {
    const sessionContext = getSessionContextByWebContents(event.sender.id);
    const text = typeof payload.text === 'string' ? payload.text : '';

    if (!sessionContext || !text) {
      return { ok: false };
    }

    logger.info('Renderer requested direct text insert', {
      senderId: event.sender.id,
      reason: payload.reason,
      length: text.length,
      textSample: text.slice(0, 16)
    });

    try {
      sendToSessionRenderer(sessionContext, 'session:focus-remote');
      await delay(30);
      sessionContext.window.focus();
      await delay(10);
      await Promise.resolve(sessionContext.window.webContents.insertText(text));
      return { ok: true };
    } catch (error) {
      logger.warn('Direct text insert failed', {
        senderId: event.sender.id,
        reason: payload.reason,
        message: error.message
      });
      return {
        ok: false,
        error: error.message
      };
    }
  });

  ipcMain.on('session:toggle-fullscreen', (event) => {
    const sessionContext = getSessionContextByWebContents(event.sender.id);

    if (!sessionContext) {
      return;
    }

    const nextFullscreen = !sessionContext.window.isFullScreen();
    logger.info('Toggling local fullscreen', {
      senderId: event.sender.id,
      fullScreen: nextFullscreen
    });
    sessionContext.window.setFullScreen(nextFullscreen);
    sendToSessionRenderer(sessionContext, 'session:fullscreen-changed', {
      fullScreen: nextFullscreen
    });
  });

  ipcMain.on('session:open-home', (event) => {
    logger.info('Renderer requested opening home page', {
      senderId: event.sender.id
    });
    openHomePage(mainWindow || BrowserWindow.fromWebContents(event.sender));
  });

  ipcMain.on('log:renderer', (event, payload) => {
    const senderScope = payload.scope || 'renderer';
    const rendererLogger = logger.child(`${senderScope}:${event.sender.id}`);
    const level = payload.level || 'info';
    const supportedLevel = ['info', 'warn', 'error'].includes(level) ? level : 'info';

    rendererLogger[supportedLevel](payload.message || 'Renderer log', payload.meta || {});
  });
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) {
    return;
  }

  configStore = new ConfigStore(app);
  logger = createLogger(app, { getEnabled: isLoggingEnabled });
  logger.ensureLogDir();
  logger.info('Application starting', {
    packaged: app.isPackaged,
    execPath: process.execPath,
    logDir: logger.logDir,
    loggingEnabled: isLoggingEnabled()
  });

  buildMenu();
  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('before-quit', () => {
  if (logger) {
    logger.info('Application quit requested');
  }
});

process.on('uncaughtException', (error) => {
  if (logger) {
    logger.error('Uncaught exception', { message: error.message, stack: error.stack });
    return;
  }

  console.error(error);
});

process.on('unhandledRejection', (reason) => {
  if (logger) {
    logger.error('Unhandled rejection', {
      reason: typeof reason === 'object' ? JSON.stringify(reason) : String(reason)
    });
    return;
  }

  console.error(reason);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
