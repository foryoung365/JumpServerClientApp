const fs = require('node:fs');
const path = require('node:path');

const { buildLocalActions, sanitizeShortcutMappings } = require('./session-shortcuts');

const DEFAULT_CONFIG = {
  serverUrl: '',
  diagnostics: {
    loggingEnabled: true
  },
  localHotkeys: {
    togglePanel: 'Ctrl+Alt+K',
    toggleTextMode: 'Ctrl+Alt+Space',
    toggleFullscreen: 'Ctrl+Alt+Enter'
  },
  shortcutMappings: []
};

function normalizeServerUrl(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') {
    return '';
  }

  const value = rawValue.trim();

  if (!value) {
    return '';
  }

  const prefixedValue = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const parsed = new URL(prefixedValue);

  parsed.hash = '';

  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }

  return parsed.toString().replace(/\/$/, '');
}

class ConfigStore {
  constructor(app) {
    this.filePath = path.join(app.getPath('userData'), 'config.json');
    this.config = this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return { ...DEFAULT_CONFIG };
      }

      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        diagnostics: {
          ...DEFAULT_CONFIG.diagnostics,
          ...(parsed.diagnostics || {})
        },
        localHotkeys: {
          ...DEFAULT_CONFIG.localHotkeys,
          ...(parsed.localHotkeys || {})
        },
        shortcutMappings: sanitizeShortcutMappings(parsed.shortcutMappings, { strict: false })
      };
    } catch (error) {
      return { ...DEFAULT_CONFIG };
    }
  }

  get() {
    return {
      ...this.config,
      localHotkeys: {
        ...this.config.localHotkeys
      },
      shortcutMappings: [...(this.config.shortcutMappings || [])]
    };
  }

  save(nextConfig) {
    const normalized = {
      ...this.config,
      ...nextConfig,
      serverUrl: normalizeServerUrl(nextConfig.serverUrl ?? this.config.serverUrl),
      diagnostics: {
        ...this.config.diagnostics,
        ...(nextConfig.diagnostics || {})
      },
      localHotkeys: {
        ...this.config.localHotkeys,
        ...(nextConfig.localHotkeys || {})
      }
    };

    normalized.shortcutMappings = sanitizeShortcutMappings(
      nextConfig.shortcutMappings ?? this.config.shortcutMappings,
      { strict: true }
    );

    const localTriggerSet = new Set(
      buildLocalActions(normalized.localHotkeys).map((action) => action.triggerDisplay)
    );
    const seenMappingTriggers = new Set();

    for (const mapping of normalized.shortcutMappings) {
      if (localTriggerSet.has(mapping.trigger)) {
        throw new Error(`映射“${mapping.name}”与本地控制热键 ${mapping.trigger} 冲突，请更换触发键。`);
      }

      if (seenMappingTriggers.has(mapping.trigger)) {
        throw new Error(`检测到重复的本地触发键 ${mapping.trigger}，请保留一条映射。`);
      }

      seenMappingTriggers.add(mapping.trigger);
    }

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(normalized, null, 2), 'utf8');
    this.config = normalized;

    return this.get();
  }

  resetServerUrl() {
    return this.save({ serverUrl: '' });
  }
}

module.exports = {
  ConfigStore,
  DEFAULT_CONFIG,
  normalizeServerUrl
};
