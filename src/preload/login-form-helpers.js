function normalizeFieldDescriptor(field) {
  return {
    type: String(field?.type || '').toLowerCase(),
    name: String(field?.name || '').toLowerCase(),
    autocomplete: String(field?.autocomplete || '').toLowerCase(),
    placeholder: String(field?.placeholder || '').toLowerCase(),
    visible: field?.visible !== false,
    disabled: Boolean(field?.disabled),
    readOnly: Boolean(field?.readOnly)
  };
}

function isEligibleField(field) {
  return field.visible && !field.disabled && !field.readOnly;
}

function isPasswordField(field) {
  return isEligibleField(field) && field.type === 'password';
}

function getUsernameFieldScore(field) {
  if (!isEligibleField(field)) {
    return -1;
  }

  if (!['text', 'email', 'tel', 'search', ''].includes(field.type)) {
    return -1;
  }

  let score = 1;
  const signature = `${field.name} ${field.autocomplete} ${field.placeholder}`;

  if (field.autocomplete.includes('username')) {
    score += 5;
  }

  if (field.autocomplete.includes('email')) {
    score += 4;
  }

  if (/\b(user(name)?|login|account|email|mail|phone|mobile)\b/.test(signature)) {
    score += 3;
  }

  return score;
}

function chooseLoginFieldPair(fieldDescriptors) {
  const normalizedFields = (fieldDescriptors || []).map((field) => ({
    ...field,
    ...normalizeFieldDescriptor(field)
  }));
  const passwordField = normalizedFields.find((field) => isPasswordField(field));

  if (!passwordField) {
    return null;
  }

  const usernameCandidates = normalizedFields
    .map((field) => ({
      field,
      score: getUsernameFieldScore(field)
    }))
    .filter((candidate) => candidate.score >= 0 && candidate.field !== passwordField)
    .sort((left, right) => right.score - left.score);

  return {
    usernameField: usernameCandidates[0]?.field || null,
    passwordField
  };
}

function isSessionSurface({ url, hasDisplayElement }) {
  if (hasDisplayElement) {
    return true;
  }

  try {
    const parsed = new URL(url);

    return (
      /(?:^|\/)(?:lion\/)?connect\/?$/i.test(parsed.pathname) ||
      /(?:^|\/)(?:lion\/)?monitor\/?$/i.test(parsed.pathname) ||
      /(?:^|\/)(?:lion\/)?share\/[^/]+\/?$/i.test(parsed.pathname)
    );
  } catch (_error) {
    return false;
  }
}

function shouldPromptToSaveCredentials({ initialUrl, currentUrl, hasVisiblePasswordField }) {
  if (hasVisiblePasswordField) {
    return false;
  }

  try {
    const initial = new URL(initialUrl);
    const current = new URL(currentUrl);

    if (initial.origin !== current.origin) {
      return false;
    }

    return initial.pathname !== current.pathname || initial.search !== current.search;
  } catch (_error) {
    return false;
  }
}

module.exports = {
  chooseLoginFieldPair,
  isSessionSurface,
  shouldPromptToSaveCredentials
};
