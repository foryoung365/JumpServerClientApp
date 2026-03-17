const MODIFIER_KEYS = new Map([
  ['Control', 'control'],
  ['Shift', 'shift'],
  ['Alt', 'alt'],
  ['Meta', 'meta']
]);

const MODIFIER_ORDER = ['Control', 'Alt', 'Shift', 'Meta'];

const MODIFIER_ALIASES = new Map([
  ['ctrl', 'Control'],
  ['control', 'Control'],
  ['alt', 'Alt'],
  ['shift', 'Shift'],
  ['win', 'Meta'],
  ['windows', 'Meta'],
  ['meta', 'Meta'],
  ['cmd', 'Meta'],
  ['command', 'Meta'],
  ['super', 'Meta']
]);

const SPECIAL_KEY_ALIASES = new Map([
  ['space', 'Space'],
  ['spacebar', 'Space'],
  ['tab', 'Tab'],
  ['enter', 'Enter'],
  ['return', 'Enter'],
  ['esc', 'Escape'],
  ['escape', 'Escape'],
  ['left', 'Left'],
  ['arrowleft', 'Left'],
  ['right', 'Right'],
  ['arrowright', 'Right'],
  ['up', 'Up'],
  ['arrowup', 'Up'],
  ['down', 'Down'],
  ['arrowdown', 'Down'],
  ['backspace', 'Backspace'],
  ['delete', 'Delete'],
  ['del', 'Delete'],
  ['insert', 'Insert'],
  ['ins', 'Insert'],
  ['slash', '/'],
  ['/', '/']
]);

const LOCAL_ACTION_DEFAULTS = [
  { id: 'toggle-panel', configKey: 'togglePanel', defaultTrigger: 'Ctrl+Alt+K' },
  { id: 'toggle-text-mode', configKey: 'toggleTextMode', defaultTrigger: 'Ctrl+Alt+Space' },
  { id: 'toggle-fullscreen', configKey: 'toggleFullscreen', defaultTrigger: 'Ctrl+Alt+Enter' }
];

const FORWARDED_SHORTCUT_DEFAULTS = [
  { id: 'ctrl-p', trigger: 'Ctrl+P' },
  { id: 'ctrl-shift-p', trigger: 'Ctrl+Shift+P' },
  { id: 'ctrl-f', trigger: 'Ctrl+F' },
  { id: 'ctrl-h', trigger: 'Ctrl+H' },
  { id: 'ctrl-shift-f', trigger: 'Ctrl+Shift+F' },
  { id: 'ctrl-slash', trigger: 'Ctrl+/' },
  { id: 'ctrl-s', trigger: 'Ctrl+S' },
  { id: 'ctrl-tab', trigger: 'Ctrl+Tab' },
  { id: 'alt-left', trigger: 'Alt+Left' },
  { id: 'alt-right', trigger: 'Alt+Right' },
  { id: 'f11', trigger: 'F11' }
];

const SPECIAL_SEQUENCE_MAP = {
  escape: ['Escape'],
  f11: ['F11'],
  'paste-ctrl-v': ['Control', 'V'],
  'paste-shift-insert': ['Shift', 'Insert'],
  'ctrl-alt-delete': ['Control', 'Alt', 'Delete'],
  'ctrl-alt-backspace': ['Control', 'Alt', 'Backspace'],
  'alt-tab': ['Alt', 'Tab'],
  win: ['Meta'],
  'win-r': ['Meta', 'R'],
  'win-x': ['Meta', 'X'],
  'win-d': ['Meta', 'D'],
  'win-e': ['Meta', 'E']
};

function toReplayKeyCode(key) {
  if (key === '/') {
    return 'Slash';
  }

  return key;
}

function normalizeKey(input) {
  const rawKey = input.key || input.code || '';
  const lowered = rawKey.toLowerCase();

  if (lowered === ' ') {
    return 'Space';
  }

  if (lowered === 'space') {
    return 'Space';
  }

  if (lowered === 'arrowleft') {
    return 'Left';
  }

  if (lowered === 'arrowright') {
    return 'Right';
  }

  if (lowered === 'arrowup') {
    return 'Up';
  }

  if (lowered === 'arrowdown') {
    return 'Down';
  }

  if (lowered === 'escape') {
    return 'Escape';
  }

  if (lowered === 'tab') {
    return 'Tab';
  }

  if (lowered === 'enter') {
    return 'Enter';
  }

  if (lowered === 'backspace') {
    return 'Backspace';
  }

  if (lowered === 'delete') {
    return 'Delete';
  }

  if (lowered === 'insert') {
    return 'Insert';
  }

  if (lowered === 'meta') {
    return 'Meta';
  }

  if (rawKey === '/') {
    return '/';
  }

  if (/^f\d{1,2}$/i.test(rawKey)) {
    return rawKey.toUpperCase();
  }

  if (rawKey.length === 1) {
    return rawKey.toUpperCase();
  }

  return rawKey;
}

function canonicalizeToken(token) {
  const value = String(token || '').trim();

  if (!value) {
    throw new Error('快捷键不能为空。');
  }

  const lowered = value.toLowerCase();

  if (MODIFIER_ALIASES.has(lowered)) {
    return MODIFIER_ALIASES.get(lowered);
  }

  if (SPECIAL_KEY_ALIASES.has(lowered)) {
    return SPECIAL_KEY_ALIASES.get(lowered);
  }

  if (/^f\d{1,2}$/i.test(value)) {
    return value.toUpperCase();
  }

  if (value.length === 1) {
    return value.toUpperCase();
  }

  throw new Error(`不支持的按键: ${value}`);
}

function formatToken(token) {
  if (token === 'Control') {
    return 'Ctrl';
  }

  if (token === 'Meta') {
    return 'Win';
  }

  if (token === 'Escape') {
    return 'Esc';
  }

  return token;
}

function formatKeySequence(keys) {
  return keys.map((key) => formatToken(key)).join('+');
}

function parseKeyChord(value, { allowModifierOnly = false } = {}) {
  const tokens = String(value || '')
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean);

  if (!tokens.length) {
    throw new Error('快捷键不能为空。');
  }

  const modifiers = new Set();
  let primaryKey = '';

  for (const token of tokens) {
    const canonical = canonicalizeToken(token);

    if (MODIFIER_KEYS.has(canonical)) {
      if (modifiers.has(canonical)) {
        throw new Error(`重复的修饰键: ${formatToken(canonical)}`);
      }

      modifiers.add(canonical);
      continue;
    }

    if (primaryKey) {
      throw new Error('当前仅支持一个主键加若干修饰键。');
    }

    primaryKey = canonical;
  }

  if (!primaryKey && !allowModifierOnly) {
    throw new Error('至少需要一个非修饰键。');
  }

  if (!primaryKey && modifiers.size === 0) {
    throw new Error('至少需要一个按键。');
  }

  const orderedKeys = [
    ...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)),
    ...(primaryKey ? [primaryKey] : [])
  ];

  return {
    key: primaryKey || null,
    keys: orderedKeys,
    display: formatKeySequence(orderedKeys),
    matcher: primaryKey
      ? {
          key: primaryKey,
          control: modifiers.has('Control'),
          alt: modifiers.has('Alt'),
          shift: modifiers.has('Shift'),
          meta: modifiers.has('Meta')
        }
      : null
  };
}

function sanitizeMappingId(rawValue, fallbackIndex) {
  const value = String(rawValue || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (value) {
    return value;
  }

  return `mapping-${fallbackIndex + 1}`;
}

function sanitizeShortcutMappings(rawMappings, { strict = false } = {}) {
  if (!Array.isArray(rawMappings)) {
    return [];
  }

  const sanitized = [];
  const errors = [];

  for (const [index, rawMapping] of rawMappings.entries()) {
    const mapping = rawMapping && typeof rawMapping === 'object' ? rawMapping : {};
    const name = String(mapping.name || '').trim();
    const trigger = String(mapping.trigger || '').trim();
    const remoteSequence = String(mapping.remoteSequence || '').trim();
    const enabled = mapping.enabled !== false;

    if (!name && !trigger && !remoteSequence) {
      continue;
    }

    if (!trigger || !remoteSequence) {
      errors.push(`映射 #${index + 1} 需要同时填写“本地触发键”和“远端组合键”。`);
      continue;
    }

    try {
      const parsedTrigger = parseKeyChord(trigger);
      const parsedRemote = parseKeyChord(remoteSequence, { allowModifierOnly: true });

      sanitized.push({
        id: sanitizeMappingId(mapping.id, index),
        name: name || `${parsedTrigger.display} -> ${parsedRemote.display}`,
        trigger: parsedTrigger.display,
        remoteSequence: parsedRemote.display,
        enabled
      });
    } catch (error) {
      errors.push(`映射 #${index + 1}: ${error.message}`);
    }
  }

  if (strict && errors.length) {
    throw new Error(errors.join('；'));
  }

  return sanitized;
}

function matchesShortcut(input, shortcut) {
  const key = normalizeKey(input);

  return (
    key === shortcut.key &&
    Boolean(input.control) === Boolean(shortcut.control) &&
    Boolean(input.alt) === Boolean(shortcut.alt) &&
    Boolean(input.shift) === Boolean(shortcut.shift) &&
    Boolean(input.meta) === Boolean(shortcut.meta)
  );
}

function buildLocalActions(localHotkeys = {}) {
  return LOCAL_ACTION_DEFAULTS.map((definition) => {
    const configuredValue = localHotkeys[definition.configKey] || definition.defaultTrigger;

    try {
      const parsed = parseKeyChord(configuredValue);
      return {
        id: definition.id,
        configKey: definition.configKey,
        triggerDisplay: parsed.display,
        ...parsed.matcher
      };
    } catch (_error) {
      const fallback = parseKeyChord(definition.defaultTrigger);
      return {
        id: definition.id,
        configKey: definition.configKey,
        triggerDisplay: fallback.display,
        ...fallback.matcher
      };
    }
  });
}

function buildForwardedShortcuts(shortcutMappings = []) {
  const customShortcuts = sanitizeShortcutMappings(shortcutMappings, { strict: false })
    .filter((mapping) => mapping.enabled)
    .map((mapping) => {
      const parsedTrigger = parseKeyChord(mapping.trigger);
      const parsedRemote = parseKeyChord(mapping.remoteSequence, {
        allowModifierOnly: true
      });

      return {
        id: mapping.id,
        name: mapping.name,
        keys: parsedRemote.keys,
        triggerDisplay: parsedTrigger.display,
        remoteDisplay: parsedRemote.display,
        source: 'custom',
        ...parsedTrigger.matcher
      };
    });

  const defaultShortcuts = FORWARDED_SHORTCUT_DEFAULTS.map((definition) => {
    const parsed = parseKeyChord(definition.trigger);

    return {
      id: definition.id,
      name: definition.trigger,
      keys: parsed.keys,
      triggerDisplay: parsed.display,
      remoteDisplay: parsed.display,
      source: 'default',
      ...parsed.matcher
    };
  });

  return [...customShortcuts, ...defaultShortcuts];
}

function findLocalAction(input, localHotkeys) {
  return buildLocalActions(localHotkeys).find((shortcut) => matchesShortcut(input, shortcut)) || null;
}

function findForwardedShortcut(input, shortcutMappings) {
  return (
    buildForwardedShortcuts(shortcutMappings).find((shortcut) => matchesShortcut(input, shortcut)) || null
  );
}

function buildReplayEvents(keys) {
  const activeModifiers = [];
  const replayEvents = [];
  const pressedModifiers = [];

  for (const key of keys) {
    const modifier = MODIFIER_KEYS.get(key);

    if (modifier) {
      replayEvents.push({
        type: 'keyDown',
        keyCode: toReplayKeyCode(key),
        modifiers: [...activeModifiers]
      });
      activeModifiers.push(modifier);
      pressedModifiers.push({ key, modifier });
      continue;
    }

    replayEvents.push({
      type: 'keyDown',
      keyCode: toReplayKeyCode(key),
      modifiers: [...activeModifiers]
    });

    replayEvents.push({
      type: 'keyUp',
      keyCode: toReplayKeyCode(key),
      modifiers: [...activeModifiers]
    });
  }

  for (const { key, modifier } of pressedModifiers.reverse()) {
    const nextModifiers = activeModifiers.filter((item) => item !== modifier);
    replayEvents.push({
      type: 'keyUp',
      keyCode: toReplayKeyCode(key),
      modifiers: nextModifiers
    });
    activeModifiers.splice(activeModifiers.indexOf(modifier), 1);
  }

  return replayEvents;
}

module.exports = {
  SPECIAL_SEQUENCE_MAP,
  buildForwardedShortcuts,
  buildLocalActions,
  buildReplayEvents,
  findForwardedShortcut,
  findLocalAction,
  formatKeySequence,
  normalizeKey,
  parseKeyChord,
  sanitizeShortcutMappings
};
