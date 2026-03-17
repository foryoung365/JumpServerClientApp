const fs = require('node:fs');
const path = require('node:path');

function safeSerializeMeta(meta) {
  if (!meta) {
    return '';
  }

  try {
    return ` ${JSON.stringify(meta)}`;
  } catch (error) {
    return ` ${JSON.stringify({ serializationError: error.message })}`;
  }
}

function padNumber(value, length = 2) {
  return String(value).padStart(length, '0');
}

function formatLocalTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = padNumber(date.getMonth() + 1);
  const day = padNumber(date.getDate());
  const hours = padNumber(date.getHours());
  const minutes = padNumber(date.getMinutes());
  const seconds = padNumber(date.getSeconds());
  const milliseconds = padNumber(date.getMilliseconds(), 3);
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffsetMinutes = Math.abs(offsetMinutes);
  const offsetHours = padNumber(Math.floor(absoluteOffsetMinutes / 60));
  const offsetRemainderMinutes = padNumber(absoluteOffsetMinutes % 60);

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${sign}${offsetHours}:${offsetRemainderMinutes}`;
}

function formatMessage(level, scope, message, meta) {
  const timestamp = formatLocalTimestamp();
  const serializedMeta = safeSerializeMeta(meta);
  return `[${timestamp}] [${level.toUpperCase()}] [${scope}] ${message}${serializedMeta}\n`;
}

function resolveRuntimeRoot(app) {
  if (app.isPackaged) {
    return process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
  }

  return app.getAppPath();
}

function buildSharedContext(app, getEnabled) {
  const runtimeRoot = resolveRuntimeRoot(app);
  const logDir = path.join(runtimeRoot, 'logs');
  const logPath = path.join(logDir, 'wrapper.log');

  return {
    runtimeRoot,
    logDir,
    logPath,
    getEnabled
  };
}

function createLogger(app, options = {}) {
  const scope = options.scope || 'main';
  const shared = options.shared || buildSharedContext(app, options.getEnabled || (() => true));

  function ensureLogDir() {
    fs.mkdirSync(shared.logDir, { recursive: true });
  }

  function write(level, message, meta) {
    if (!shared.getEnabled()) {
      return;
    }

    const line = formatMessage(level, scope, message, meta);

    try {
      ensureLogDir();
      fs.appendFileSync(shared.logPath, line, 'utf8');
    } catch (error) {
      console.error(`Failed to write log file: ${error.message}`);
    }

    if (level === 'error') {
      console.error(line.trim());
      return;
    }

    if (level === 'warn') {
      console.warn(line.trim());
      return;
    }

    console.log(line.trim());
  }

  return {
    scope,
    logDir: shared.logDir,
    logPath: shared.logPath,
    ensureLogDir,
    child(nextScope) {
      return createLogger(app, { scope: nextScope, shared });
    },
    isEnabled() {
      return shared.getEnabled();
    },
    info(message, meta) {
      write('info', message, meta);
    },
    warn(message, meta) {
      write('warn', message, meta);
    },
    error(message, meta) {
      write('error', message, meta);
    }
  };
}

module.exports = {
  createLogger,
  formatLocalTimestamp
};
