const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_STATE = {
  credentials: {}
};

function normalizeServerOrigin(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return '';
  }

  const value = rawUrl.trim();

  if (!value) {
    return '';
  }

  const prefixedValue = /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;
  const parsed = new URL(prefixedValue);

  return parsed.origin;
}

class CredentialStore {
  constructor(app, { safeStorage, filePath } = {}) {
    this.safeStorage = safeStorage || null;
    this.filePath = filePath || path.join(app.getPath('userData'), 'credentials.json');
    this.state = this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return { ...DEFAULT_STATE, credentials: {} };
      }

      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return {
        ...DEFAULT_STATE,
        ...parsed,
        credentials: {
          ...(parsed.credentials || {})
        }
      };
    } catch (_error) {
      return { ...DEFAULT_STATE, credentials: {} };
    }
  }

  isEncryptionAvailable() {
    return (
      typeof this.safeStorage?.isEncryptionAvailable === 'function' &&
      typeof this.safeStorage?.encryptString === 'function' &&
      typeof this.safeStorage?.decryptString === 'function' &&
      this.safeStorage.isEncryptionAvailable()
    );
  }

  getStatus(serverUrl) {
    const serverOrigin = normalizeServerOrigin(serverUrl);

    return {
      canPersist: this.isEncryptionAvailable(),
      hasSavedCredentials: Boolean(serverOrigin && this.getLogin(serverOrigin)),
      serverOrigin
    };
  }

  getLogin(serverUrl) {
    const serverOrigin = normalizeServerOrigin(serverUrl);

    if (!serverOrigin) {
      return null;
    }

    const record = this.state.credentials?.[serverOrigin];

    if (!record || typeof record.username !== 'string' || typeof record.password !== 'string') {
      return null;
    }

    try {
      const password = this.safeStorage.decryptString(Buffer.from(record.password, 'base64'));
      return {
        username: record.username,
        password
      };
    } catch (_error) {
      return null;
    }
  }

  saveLogin(serverUrl, credentials) {
    const serverOrigin = normalizeServerOrigin(serverUrl);
    const username = String(credentials?.username || '').trim();
    const password = String(credentials?.password || '');

    if (!serverOrigin) {
      throw new Error('A valid JumpServer server URL is required.');
    }

    if (!username || !password) {
      throw new Error('Username and password are required.');
    }

    if (!this.isEncryptionAvailable()) {
      throw new Error('Credential encryption is unavailable on this machine.');
    }

    this.state.credentials[serverOrigin] = {
      username,
      password: this.safeStorage.encryptString(password).toString('base64'),
      updatedAt: new Date().toISOString()
    };

    this.persist();
    return this.getStatus(serverOrigin);
  }

  clearLogin(serverUrl) {
    const serverOrigin = normalizeServerOrigin(serverUrl);

    if (!serverOrigin) {
      return this.getStatus(serverOrigin);
    }

    delete this.state.credentials[serverOrigin];
    this.persist();
    return this.getStatus(serverOrigin);
  }

  persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
  }
}

module.exports = {
  CredentialStore,
  normalizeServerOrigin
};
