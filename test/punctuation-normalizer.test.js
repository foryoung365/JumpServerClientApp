const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeChinesePunctuation,
  normalizeShortcutPunctuationCandidate
} = require('../src/shared/chinese-punctuation');

test('normalizeChinesePunctuation converts common Chinese punctuation in text mode', () => {
  assert.deepEqual(normalizeChinesePunctuation('你好,世界!今天(下雨)吗?'), {
    normalized: '你好，世界！今天（下雨）吗？',
    converted: 5
  });
});

test('normalizeChinesePunctuation converts paired quotes, ellipsis, and em dash', () => {
  assert.deepEqual(normalizeChinesePunctuation('他说"你好"...然后--走了'), {
    normalized: '他说“你好”……然后——走了',
    converted: 4
  });
});

test('normalizeChinesePunctuation preserves urls, versions, times, and decimals', () => {
  assert.deepEqual(
    normalizeChinesePunctuation('访问 https://example.com/a-b?v=1.2.3 ，版本 v1.2.3 于 12:30 发布。'),
    {
      normalized: '访问 https://example.com/a-b?v=1.2.3 ，版本 v1.2.3 于 12:30 发布。',
      converted: 0
    }
  );
});

test('normalizeShortcutPunctuationCandidate converts direct Chinese punctuation in shortcut mode', () => {
  assert.equal(
    normalizeShortcutPunctuationCandidate('“', {
      recentText: '测试'
    }),
    '“'
  );
});

test('normalizeShortcutPunctuationCandidate uses recent CJK context for ASCII punctuation', () => {
  assert.equal(
    normalizeShortcutPunctuationCandidate('...', {
      recentText: '你好'
    }),
    '……'
  );
  assert.equal(
    normalizeShortcutPunctuationCandidate('--', {
      recentText: '你好'
    }),
    '——'
  );
});

test('normalizeShortcutPunctuationCandidate chooses open and close quotes from context', () => {
  assert.equal(
    normalizeShortcutPunctuationCandidate('"', {
      recentText: '他说'
    }),
    '“'
  );
  assert.equal(
    normalizeShortcutPunctuationCandidate('"', {
      recentText: '他说“你好'
    }),
    '”'
  );
});

test('normalizeShortcutPunctuationCandidate does not convert ASCII-only contexts', () => {
  assert.equal(
    normalizeShortcutPunctuationCandidate('"', {
      recentText: 'path/to/file'
    }),
    ''
  );
  assert.equal(
    normalizeShortcutPunctuationCandidate('...', {
      recentText: 'version 1.2.3'
    }),
    ''
  );
});
