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
  empty.textContent = '当前还没有自定义映射。你可以新增一条，例如 Ctrl+Alt+X -> Win+X。';
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

function renderSummary(config) {
  const enabledMappings = (config.shortcutMappings || []).filter((mapping) => mapping.enabled !== false);
  const mappingLines =
    enabledMappings.length > 0
      ? enabledMappings
          .slice(0, 8)
          .map((mapping) => `  - ${mapping.name}: ${mapping.trigger} -> ${mapping.remoteSequence}`)
      : ['  - (无)'];

  summary.textContent = [
    `已保存地址: ${config.serverUrl || '(未配置)'}`,
    `日志开关: ${config.diagnostics.loggingEnabled ? '开启' : '关闭'}`,
    `日志目录: ${config.logDir}`,
    `日志路径: ${config.logPath}`,
    `本地热键:`,
    `  - ${config.localHotkeys.togglePanel}: 打开 Session 面板`,
    `  - ${config.localHotkeys.toggleTextMode}: 切换 Text Mode`,
    `  - ${config.localHotkeys.toggleFullscreen}: 切换本地全屏`,
    '',
    `自定义映射: ${enabledMappings.length} 条`,
    ...mappingLines,
    '',
    'Session 窗口能力:',
    '  - 拦截并重放高频快捷键到 Lion 远端',
    '  - 提供特殊按键面板',
    '  - Text Mode 通过本地 IME 组合短句后提交'
  ].join('\n');
}

async function loadConfig() {
  const config = await window.jumpWrapperHome.getConfig();
  serverInput.value = config.serverUrl || '';
  loggingEnabledInput.checked = config.diagnostics.loggingEnabled;
  renderShortcutMappings(config.shortcutMappings || []);
  renderSummary(config);
  window.jumpWrapperHome.log('info', 'Home config loaded', {
    serverUrl: config.serverUrl,
    loggingEnabled: config.diagnostics.loggingEnabled,
    shortcutMappingCount: config.shortcutMappings?.length || 0
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    setFeedback('正在保存配置并启动 JumpServer 主窗口…');
    const config = await window.jumpWrapperHome.saveConfig({
      serverUrl: serverInput.value,
      diagnostics: {
        loggingEnabled: loggingEnabledInput.checked
      },
      shortcutMappings: collectShortcutMappings()
    });
    renderShortcutMappings(config.shortcutMappings || []);
    renderSummary(config);
    await window.jumpWrapperHome.launchServer();
    setFeedback('已保存，主窗口正在打开 JumpServer。');
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
    const config = await window.jumpWrapperHome.resetServer();
    serverInput.value = '';
    loggingEnabledInput.checked = config.diagnostics.loggingEnabled;
    renderShortcutMappings(config.shortcutMappings || []);
    renderSummary(config);
    setFeedback('已清空已保存地址。');
  } catch (error) {
    setFeedback(error.message || '清空失败。', true);
  }
});

openLogsButton.addEventListener('click', async () => {
  try {
    window.jumpWrapperHome.log('info', 'Opening log directory');
    await window.jumpWrapperHome.openLogs();
    setFeedback('已打开日志文件。');
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
