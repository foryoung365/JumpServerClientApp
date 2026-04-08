const form = document.getElementById('config-form');
const serverInput = document.getElementById('server-url');
const feedback = document.getElementById('feedback');
const summary = document.getElementById('summary');
const loggingEnabledInput = document.getElementById('logging-enabled');
const openSavedButton = document.getElementById('open-saved');
const resetButton = document.getElementById('reset-server');
const openLogsButton = document.getElementById('open-logs');
const closeWindowButton = document.getElementById('close-window');
const quitAppButton = document.getElementById('quit-app');
const shortcutMappingsContainer = document.getElementById('shortcut-mappings');
const addShortcutMappingButton = document.getElementById('add-shortcut-mapping');
const credentialStatusText = document.getElementById('credential-status-text');
const credentialStatusHint = document.getElementById('credential-status-hint');
const clearSavedLoginButton = document.getElementById('clear-saved-login');

let currentConfig = null;
let currentCredentialStatus = {
  canPersist: false,
  hasSavedCredentials: false,
  serverOrigin: ''
};

function setFeedback(message, isError = false) {
  feedback.textContent = message || '';
  feedback.classList.toggle('is-error', isError);
}

function escapeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function createShortcutMappingRow(mapping = {}) {
  const row = document.createElement('div');
  row.className = 'mapping-row';
  row.dataset.mappingId = mapping.id || '';
  row.innerHTML = `
    <label>
      <span>名称</span>
      <input type="text" data-field="name" placeholder="例如 Win+X 菜单" value="${escapeHtmlAttribute(mapping.name)}" />
    </label>
    <label>
      <span>本地触发键</span>
      <input type="text" data-field="trigger" placeholder="例如 Ctrl+Alt+X" value="${escapeHtmlAttribute(mapping.trigger)}" />
    </label>
    <label>
      <span>远端组合键</span>
      <input type="text" data-field="remoteSequence" placeholder="例如 Win+X" value="${escapeHtmlAttribute(mapping.remoteSequence)}" />
    </label>
    <label class="mapping-enabled">
      <input type="checkbox" data-field="enabled" ${mapping.enabled === false ? '' : 'checked'} />
      <span>启用</span>
    </label>
    <button type="button" class="ghost mapping-remove">删除</button>
  `;

  row.querySelector('.mapping-remove').addEventListener('click', () => {
    row.remove();
    renderShortcutMappingEmptyState();
  });

  return row;
}

function renderShortcutMappingEmptyState() {
  if (shortcutMappingsContainer.children.length > 0) {
    return;
  }

  const empty = document.createElement('div');
  empty.className = 'mapping-empty';
  empty.textContent = '当前尚无自定义映射。可新增一条，例如 Ctrl+Alt+X -> Win+X。';
  shortcutMappingsContainer.appendChild(empty);
}

function renderShortcutMappings(mappings = []) {
  shortcutMappingsContainer.innerHTML = '';

  for (const mapping of mappings) {
    shortcutMappingsContainer.appendChild(createShortcutMappingRow(mapping));
  }

  renderShortcutMappingEmptyState();
}

function collectShortcutMappings() {
  return Array.from(shortcutMappingsContainer.querySelectorAll('.mapping-row')).map((row, index) => ({
    id: row.dataset.mappingId || `mapping-${index + 1}`,
    name: row.querySelector('[data-field="name"]').value.trim(),
    trigger: row.querySelector('[data-field="trigger"]').value.trim(),
    remoteSequence: row.querySelector('[data-field="remoteSequence"]').value.trim(),
    enabled: row.querySelector('[data-field="enabled"]').checked
  }));
}

function renderCredentialStatus(status, serverUrl) {
  currentCredentialStatus = status || {
    canPersist: false,
    hasSavedCredentials: false,
    serverOrigin: ''
  };

  const hasServer = Boolean(String(serverUrl || '').trim());

  if (!hasServer) {
    credentialStatusText.textContent = '尚未配置 JumpServer 地址，暂无法判断登录凭据状态。';
    credentialStatusHint.textContent = '保存地址后，此处会显示该 JumpServer 登录页是否已有可自动回填的账号密码。';
    clearSavedLoginButton.disabled = true;
    return;
  }

  if (!currentCredentialStatus.canPersist) {
    credentialStatusText.textContent = '当前系统环境不可用安全加密保存，登录凭据功能将保持关闭。';
    credentialStatusHint.textContent = '此状态下不会以明文方式落盘保存账号密码。';
    clearSavedLoginButton.disabled = true;
    return;
  }

  if (currentCredentialStatus.hasSavedCredentials) {
    credentialStatusText.textContent = `当前地址已保存登录：${currentCredentialStatus.serverOrigin}`;
    credentialStatusHint.textContent = '打开该 JumpServer 登录页时，会尝试自动回填最近一次确认保存的账号密码。';
    clearSavedLoginButton.disabled = false;
    return;
  }

  credentialStatusText.textContent = `当前地址尚未保存登录：${currentCredentialStatus.serverOrigin}`;
  credentialStatusHint.textContent = '首次登录成功后，应用会询问是否保存当前账号密码。';
  clearSavedLoginButton.disabled = true;
}

function renderSummary(config, credentialStatus) {
  const enabledMappings = (config.shortcutMappings || []).filter((mapping) => mapping.enabled !== false);
  const mappingLines =
    enabledMappings.length > 0
      ? enabledMappings
          .slice(0, 8)
          .map((mapping) => `  - ${mapping.name}: ${mapping.trigger} -> ${mapping.remoteSequence}`)
      : ['  - （无）'];

  const credentialLine = !config.serverUrl
    ? '未配置地址'
    : !credentialStatus.canPersist
      ? '当前系统不支持安全保存'
      : credentialStatus.hasSavedCredentials
        ? `已保存（${credentialStatus.serverOrigin}）`
        : '未保存';

  summary.textContent = [
    `已保存地址: ${config.serverUrl || '（未配置）'}`,
    `诊断日志: ${config.diagnostics.loggingEnabled ? '开启' : '关闭'}`,
    `登录凭据: ${credentialLine}`,
    `日志目录: ${config.logDir}`,
    `日志路径: ${config.logPath}`,
    '本地热键:',
    `  - ${config.localHotkeys.togglePanel}: 打开 Session 面板`,
    `  - ${config.localHotkeys.toggleTextMode}: 切换 Text Mode`,
    `  - ${config.localHotkeys.toggleFullscreen}: 切换本地全屏`,
    '',
    `自定义映射: ${enabledMappings.length} 条`,
    ...mappingLines,
    '',
    '会话增强:',
    '  - 接管常用远端快捷键',
    '  - 提供特殊按键面板与中文标点辅助',
    '  - 支持 JumpServer 登录页账号密码保存与自动回填'
  ].join('\n');
}

async function refreshCredentialStatus(serverUrl = serverInput.value) {
  const trimmedServerUrl = String(serverUrl || '').trim();

  if (!trimmedServerUrl) {
    renderCredentialStatus(
      {
        canPersist: false,
        hasSavedCredentials: false,
        serverOrigin: ''
      },
      ''
    );

    if (currentConfig) {
      renderSummary(currentConfig, currentCredentialStatus);
    }

    return currentCredentialStatus;
  }

  const status = await window.jumpWrapperHome.getCredentialStatus(trimmedServerUrl);
  renderCredentialStatus(status, trimmedServerUrl);

  if (currentConfig) {
    renderSummary(currentConfig, status);
  }

  return status;
}

async function loadConfig() {
  currentConfig = await window.jumpWrapperHome.getConfig();
  serverInput.value = currentConfig.serverUrl || '';
  loggingEnabledInput.checked = currentConfig.diagnostics.loggingEnabled;
  renderShortcutMappings(currentConfig.shortcutMappings || []);
  await refreshCredentialStatus(currentConfig.serverUrl || '');
  renderSummary(currentConfig, currentCredentialStatus);
  window.jumpWrapperHome.log('info', 'Home config loaded', {
    serverUrl: currentConfig.serverUrl,
    loggingEnabled: currentConfig.diagnostics.loggingEnabled,
    shortcutMappingCount: currentConfig.shortcutMappings?.length || 0
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    setFeedback('正在保存配置并启动 JumpServer 主窗口……');
    currentConfig = await window.jumpWrapperHome.saveConfig({
      serverUrl: serverInput.value,
      diagnostics: {
        loggingEnabled: loggingEnabledInput.checked
      },
      shortcutMappings: collectShortcutMappings()
    });
    renderShortcutMappings(currentConfig.shortcutMappings || []);
    await refreshCredentialStatus(currentConfig.serverUrl || '');
    renderSummary(currentConfig, currentCredentialStatus);
    await window.jumpWrapperHome.launchServer();
    setFeedback('配置已保存，主窗口正在打开 JumpServer。');
  } catch (error) {
    setFeedback(error.message || '保存失败。', true);
  }
});

openSavedButton.addEventListener('click', async () => {
  try {
    window.jumpWrapperHome.log('info', 'Opening saved JumpServer URL');
    await window.jumpWrapperHome.launchServer();
    setFeedback('已打开已保存的 JumpServer 地址。');
  } catch (error) {
    setFeedback(error.message || '打开失败。', true);
  }
});

resetButton.addEventListener('click', async () => {
  try {
    currentConfig = await window.jumpWrapperHome.resetServer();
    serverInput.value = '';
    loggingEnabledInput.checked = currentConfig.diagnostics.loggingEnabled;
    renderShortcutMappings(currentConfig.shortcutMappings || []);
    await refreshCredentialStatus('');
    renderSummary(currentConfig, currentCredentialStatus);
    setFeedback('已清空保存地址。');
  } catch (error) {
    setFeedback(error.message || '清空失败。', true);
  }
});

clearSavedLoginButton.addEventListener('click', async () => {
  try {
    const trimmedServerUrl = String(serverInput.value || '').trim();

    if (!trimmedServerUrl) {
      setFeedback('请先填写或保存 JumpServer 地址。', true);
      return;
    }

    const status = await window.jumpWrapperHome.clearSavedLogin(trimmedServerUrl);
    renderCredentialStatus(status, trimmedServerUrl);

    if (currentConfig) {
      renderSummary(currentConfig, status);
    }

    setFeedback('已清除当前地址对应的已保存登录。');
  } catch (error) {
    setFeedback(error.message || '清除已保存登录失败。', true);
  }
});

serverInput.addEventListener('change', () => {
  void refreshCredentialStatus(serverInput.value).catch((error) => {
    setFeedback(error.message || '读取登录凭据状态失败。', true);
  });
});

openLogsButton.addEventListener('click', async () => {
  try {
    window.jumpWrapperHome.log('info', 'Opening log directory');
    await window.jumpWrapperHome.openLogs();
    setFeedback('已打开日志目录。');
  } catch (error) {
    setFeedback(error.message || '打开日志失败。', true);
  }
});

closeWindowButton.addEventListener('click', async () => {
  try {
    window.jumpWrapperHome.log('info', 'Closing current window from home page');
    await window.jumpWrapperHome.closeWindow();
  } catch (error) {
    setFeedback(error.message || '关闭窗口失败。', true);
  }
});

quitAppButton.addEventListener('click', async () => {
  try {
    window.jumpWrapperHome.log('info', 'Quitting application from home page');
    await window.jumpWrapperHome.quitApp();
  } catch (error) {
    setFeedback(error.message || '退出程序失败。', true);
  }
});

addShortcutMappingButton.addEventListener('click', () => {
  const emptyState = shortcutMappingsContainer.querySelector('.mapping-empty');
  emptyState?.remove();
  shortcutMappingsContainer.appendChild(createShortcutMappingRow());
});

loadConfig().catch((error) => {
  setFeedback(error.message || '加载配置失败。', true);
});

window.addEventListener('error', (event) => {
  window.jumpWrapperHome.log('error', 'Home renderer error', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno
  });
});

window.addEventListener('unhandledrejection', (event) => {
  window.jumpWrapperHome.log('error', 'Home renderer unhandled rejection', {
    reason: String(event.reason)
  });
});
