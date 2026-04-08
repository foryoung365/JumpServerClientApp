const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { CredentialStore, normalizeServerOrigin } = require('../src/main/credential-store');

function createSafeStorage() {
  return {
    isEncryptionAvailable() {
      return true;
    },
    encryptString(plainText) {
      return Buffer.from(`enc:${plainText}`, 'utf8');
    },
    decryptString(encrypted) {
      const value = Buffer.from(encrypted).toString('utf8');

      if (!value.startsWith('enc:')) {
        throw new Error('invalid-encrypted-data');
      }

      return value.slice(4);
    }
  };
}

function createApp(userDataPath) {
  return {
    getPath(name) {
      assert.equal(name, 'userData');
      return userDataPath;
    }
  };
}

test('normalizeServerOrigin keeps only the server origin', () => {
  assert.equal(
    normalizeServerOrigin(' https://jumpserver.example.com:8443/core/auth/login/?next=%2F#/fragment '),
    'https://jumpserver.example.com:8443'
  );
});

test('CredentialStore saves and reads one login per server origin', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jump-credential-store-'));
  const store = new CredentialStore(createApp(tempDir), {
    safeStorage: createSafeStorage()
  });

  store.saveLogin('https://jumpserver.example.com/core/auth/login/', {
    username: 'alice',
    password: 'secret-1'
  });

  assert.deepEqual(store.getStatus('https://jumpserver.example.com'), {
    canPersist: true,
    hasSavedCredentials: true,
    serverOrigin: 'https://jumpserver.example.com'
  });
  assert.deepEqual(store.getLogin('https://jumpserver.example.com/whatever'), {
    username: 'alice',
    password: 'secret-1'
  });
});

test('CredentialStore overwrites saved login for the same server origin', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jump-credential-store-'));
  const store = new CredentialStore(createApp(tempDir), {
    safeStorage: createSafeStorage()
  });

  store.saveLogin('https://jumpserver.example.com', {
    username: 'alice',
    password: 'secret-1'
  });
  store.saveLogin('https://jumpserver.example.com/core/auth/login/', {
    username: 'bob',
    password: 'secret-2'
  });

  assert.deepEqual(store.getLogin('https://jumpserver.example.com/#/dashboard'), {
    username: 'bob',
    password: 'secret-2'
  });
});

test('CredentialStore clears a saved login for one server origin', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jump-credential-store-'));
  const store = new CredentialStore(createApp(tempDir), {
    safeStorage: createSafeStorage()
  });

  store.saveLogin('https://jumpserver.example.com', {
    username: 'alice',
    password: 'secret-1'
  });
  store.clearLogin('https://jumpserver.example.com');

  assert.equal(store.getLogin('https://jumpserver.example.com'), null);
  assert.deepEqual(store.getStatus('https://jumpserver.example.com'), {
    canPersist: true,
    hasSavedCredentials: false,
    serverOrigin: 'https://jumpserver.example.com'
  });
});

test('CredentialStore tolerates corrupted on-disk data', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jump-credential-store-'));
  const store = new CredentialStore(createApp(tempDir), {
    safeStorage: createSafeStorage()
  });

  fs.writeFileSync(
    path.join(tempDir, 'credentials.json'),
    JSON.stringify({
      credentials: {
        'https://jumpserver.example.com': {
          username: 'alice',
          password: 'not-valid-base64'
        }
      }
    }),
    'utf8'
  );

  const reloadedStore = new CredentialStore(createApp(tempDir), {
    safeStorage: createSafeStorage()
  });

  assert.equal(reloadedStore.getLogin('https://jumpserver.example.com'), null);
  assert.deepEqual(reloadedStore.getStatus('https://jumpserver.example.com'), {
    canPersist: true,
    hasSavedCredentials: false,
    serverOrigin: 'https://jumpserver.example.com'
  });
});

test('CredentialStore refuses to save when encryption is unavailable', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jump-credential-store-'));
  const store = new CredentialStore(createApp(tempDir), {
    safeStorage: {
      isEncryptionAvailable() {
        return false;
      }
    }
  });

  assert.throws(
    () =>
      store.saveLogin('https://jumpserver.example.com', {
        username: 'alice',
        password: 'secret-1'
      }),
    /encryption/i
  );

  assert.deepEqual(store.getStatus('https://jumpserver.example.com'), {
    canPersist: false,
    hasSavedCredentials: false,
    serverOrigin: 'https://jumpserver.example.com'
  });
});
