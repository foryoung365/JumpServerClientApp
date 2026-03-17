function parseUrl(rawUrl) {
  try {
    return new URL(rawUrl);
  } catch (error) {
    return null;
  }
}

function isSameOrigin(urlA, urlB) {
  const first = parseUrl(urlA);
  const second = parseUrl(urlB);

  if (!first || !second) {
    return false;
  }

  return first.origin === second.origin;
}

function isSessionPath(pathname) {
  return (
    /(?:^|\/)connect\/?$/i.test(pathname) ||
    /(?:^|\/)monitor\/?$/i.test(pathname) ||
    /(?:^|\/)share\/[^/]+\/?$/i.test(pathname)
  );
}

function isSessionUrl(rawUrl, baseServerUrl) {
  const parsed = parseUrl(rawUrl);

  if (!parsed) {
    return false;
  }

  if (baseServerUrl && !isSameOrigin(rawUrl, baseServerUrl)) {
    return false;
  }

  return isSessionPath(parsed.pathname);
}

function isJumpServerCandidate(rawUrl, baseServerUrl) {
  if (!baseServerUrl) {
    return false;
  }

  return isSameOrigin(rawUrl, baseServerUrl);
}

module.exports = {
  isJumpServerCandidate,
  isSessionUrl,
  parseUrl
};
