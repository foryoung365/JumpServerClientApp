const test = require('node:test');
const assert = require('node:assert/strict');

const {
  chooseLoginFieldPair,
  isSessionSurface,
  shouldPromptToSaveCredentials
} = require('../src/preload/login-form-helpers');

test('chooseLoginFieldPair prefers a visible username field with autocomplete hints', () => {
  const pair = chooseLoginFieldPair([
    {
      type: 'hidden',
      name: 'csrfmiddlewaretoken',
      autocomplete: '',
      placeholder: '',
      visible: false
    },
    {
      type: 'text',
      name: 'email',
      autocomplete: 'username',
      placeholder: '用户名',
      visible: true
    },
    {
      type: 'password',
      name: 'password',
      autocomplete: 'current-password',
      placeholder: '密码',
      visible: true
    }
  ]);

  assert.equal(pair.usernameField?.name, 'email');
  assert.equal(pair.passwordField?.name, 'password');
});

test('chooseLoginFieldPair ignores invisible or disabled password fields', () => {
  const pair = chooseLoginFieldPair([
    {
      type: 'text',
      name: 'username',
      autocomplete: '',
      placeholder: '用户名',
      visible: true
    },
    {
      type: 'password',
      name: 'password',
      autocomplete: '',
      placeholder: '密码',
      visible: false
    },
    {
      type: 'password',
      name: 'otp',
      autocomplete: '',
      placeholder: '一次性口令',
      visible: true,
      disabled: true
    }
  ]);

  assert.equal(pair, null);
});

test('shouldPromptToSaveCredentials returns true after leaving the login surface', () => {
  assert.equal(
    shouldPromptToSaveCredentials({
      initialUrl: 'https://jumpserver.example.com/core/auth/login/',
      currentUrl: 'https://jumpserver.example.com/',
      hasVisiblePasswordField: false
    }),
    true
  );
});

test('shouldPromptToSaveCredentials returns false while still on the login page', () => {
  assert.equal(
    shouldPromptToSaveCredentials({
      initialUrl: 'https://jumpserver.example.com/core/auth/login/',
      currentUrl: 'https://jumpserver.example.com/core/auth/login/?next=%2F',
      hasVisiblePasswordField: true
    }),
    false
  );
});

test('isSessionSurface returns true for a session-like url', () => {
  assert.equal(
    isSessionSurface({
      url: 'https://jumpserver.example.com/lion/connect/',
      hasDisplayElement: false
    }),
    true
  );
});

test('isSessionSurface returns true when display dom already exists', () => {
  assert.equal(
    isSessionSurface({
      url: 'https://jumpserver.example.com/assets/1/',
      hasDisplayElement: true
    }),
    true
  );
});

test('isSessionSurface returns false for a normal login page', () => {
  assert.equal(
    isSessionSurface({
      url: 'https://jumpserver.example.com/core/auth/login/',
      hasDisplayElement: false
    }),
    false
  );
});
