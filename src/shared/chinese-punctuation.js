const SINGLE_REPLACEMENTS = {
  ',': '，',
  '.': '。',
  '?': '？',
  '!': '！',
  ':': '：',
  ';': '；',
  '(': '（',
  ')': '）',
  '[': '【',
  ']': '】',
  '<': '《',
  '>': '》'
};

const DIRECT_CHINESE_PUNCTUATION = new Set([
  '，',
  '。',
  '、',
  '？',
  '！',
  '：',
  '；',
  '（',
  '）',
  '【',
  '】',
  '《',
  '》',
  '“',
  '”',
  '‘',
  '’',
  '……',
  '——'
]);

const CHINESE_PUNCTUATION_BUTTONS = [
  '，',
  '。',
  '、',
  '？',
  '！',
  '：',
  '；',
  '（',
  '）',
  '【',
  '】',
  '《',
  '》',
  '“',
  '”',
  '‘',
  '’',
  '……',
  '——'
];

function isWhitespace(value) {
  return /\s/.test(value || '');
}

function isCjkCharacter(value) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(value || '');
}

function containsCjkText(value) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(value || '');
}

function isAsciiWordCharacter(value) {
  return /[A-Za-z0-9]/.test(value || '');
}

function findNeighborCharacter(source, startIndex, step) {
  for (let index = startIndex; index >= 0 && index < source.length; index += step) {
    const character = source[index];

    if (isWhitespace(character)) {
      continue;
    }

    return character;
  }

  return '';
}

function hasNearbyCjkContext(source, startIndex, endIndex = startIndex) {
  const previous = findNeighborCharacter(source, startIndex - 1, -1);
  const next = findNeighborCharacter(source, endIndex + 1, 1);

  return isCjkCharacter(previous) || isCjkCharacter(next);
}

function shouldConvertSingleCharacter(source, index, character) {
  const previous = source[index - 1] || '';
  const next = source[index + 1] || '';

  if (!SINGLE_REPLACEMENTS[character]) {
    return false;
  }

  if (character === '.' && /\d/.test(previous) && /\d/.test(next)) {
    return false;
  }

  if ((character === ':' || character === '.') && isAsciiWordCharacter(previous) && isAsciiWordCharacter(next)) {
    return false;
  }

  return hasNearbyCjkContext(source, index);
}

function countPendingQuotes(source, openQuote, closeQuote, asciiQuote) {
  let pending = 0;

  for (const character of source) {
    if (character === openQuote) {
      pending += 1;
      continue;
    }

    if (character === closeQuote && pending > 0) {
      pending -= 1;
      continue;
    }

    if (character === asciiQuote) {
      pending = pending > 0 ? pending - 1 : pending + 1;
    }
  }

  return pending;
}

function convertQuote(character, contextText) {
  if (character === '"') {
    return countPendingQuotes(contextText, '“', '”', '"') > 0 ? '”' : '“';
  }

  return countPendingQuotes(contextText, '‘', '’', "'") > 0 ? '’' : '‘';
}

function normalizeChinesePunctuation(value) {
  let converted = 0;
  let normalized = '';

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const nextThree = value.slice(index, index + 3);
    const nextTwo = value.slice(index, index + 2);

    if (nextThree === '...' && hasNearbyCjkContext(value, index, index + 2)) {
      normalized += '……';
      converted += 1;
      index += 2;
      continue;
    }

    if (nextTwo === '--' && hasNearbyCjkContext(value, index, index + 1)) {
      normalized += '——';
      converted += 1;
      index += 1;
      continue;
    }

    if ((character === '"' || character === "'") && hasNearbyCjkContext(value, index)) {
      normalized += convertQuote(character, normalized);
      converted += 1;
      continue;
    }

    if (shouldConvertSingleCharacter(value, index, character)) {
      normalized += SINGLE_REPLACEMENTS[character];
      converted += 1;
      continue;
    }

    normalized += character;
  }

  return { normalized, converted };
}

function normalizeShortcutPunctuationCandidate(text, { recentText = '' } = {}) {
  if (!text) {
    return '';
  }

  if (DIRECT_CHINESE_PUNCTUATION.has(text)) {
    return text;
  }

  if (!containsCjkText(recentText)) {
    return '';
  }

  if (text === '...') {
    return '……';
  }

  if (text === '--') {
    return '——';
  }

  if (text === '"' || text === "'") {
    return convertQuote(text, recentText);
  }

  return SINGLE_REPLACEMENTS[text] || '';
}

module.exports = {
  CHINESE_PUNCTUATION_BUTTONS,
  containsCjkText,
  DIRECT_CHINESE_PUNCTUATION,
  normalizeChinesePunctuation,
  normalizeShortcutPunctuationCandidate
};
