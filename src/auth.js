import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { setTokens, getOAuthClientId, getRefreshToken, getOAuthRedirectUri, getBaseUrl, clearCachedAccountId } from './config.js';
import { USER_AGENT } from './package-info.js';

const REDIRECT_PORT = 9876;
const REDIRECT_HOST = '127.0.0.1';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

// OAuth endpoints derive from the configured base URL so they target the same
// environment as API calls. The API host redirects the authorize request to
// its app host automatically.
const authorizeUrl = () => `${getBaseUrl()}/oauth/authorize`;
const tokenUrl = () => `${getBaseUrl()}/oauth/token`;

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generateCodeVerifier() {
  // 32 random bytes → 43-char base64url string, within PKCE 43-128 char range
  return base64url(randomBytes(32));
}

function generateCodeChallenge(verifier) {
  return base64url(createHash('sha256').update(verifier).digest());
}

/** The executable and arguments that open `url` in the default browser. */
export function browserCommand(url, platform = process.platform) {
  if (platform === 'win32') return { file: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
  if (platform === 'darwin') return { file: 'open', args: [url] };
  return { file: 'xdg-open', args: [url] };
}

/** `run` defaults to execFile: an argument array, no shell. Tests pass a fake. */
export function openBrowser(url, { platform = process.platform, run = execFile } = {}) {
  const { file, args } = browserCommand(url, platform);
  run(file, args, (err) => {
    if (err) console.error(`Could not open a browser (${err.message}). Open this URL yourself:\n  ${url}`);
  });
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const resultPage = (heading, body) =>
  `<html><body style="font-family:sans-serif;padding:2rem"><h2>${heading}</h2><p>${body}</p></body></html>`;

/**
 * Serves the one OAuth redirect and resolves with the authorization code.
 *
 * Listens on the loopback interface only, and accepts a code only when the
 * callback's `state` is the one login() sent. A request from another host,
 * or one this process did not start, cannot complete the login.
 */
export function waitForCallback(
  expectedState,
  { port = REDIRECT_PORT, host = REDIRECT_HOST, timeoutMs = LOGIN_TIMEOUT_MS, onListening } = {}
) {
  return new Promise((resolve, reject) => {
    let timer;
    // Clears the timer as well as closing the server. A live timer would keep
    // the process alive for the rest of the timeout after the login finished.
    const settle = (fn, value) => {
      clearTimeout(timer);
      server.close();
      fn(value);
    };

    const server = createServer((req, res) => {
      const parsed = new URL(req.url, `http://${host}:${port}`);
      const code = parsed.searchParams.get('code');
      const state = parsed.searchParams.get('state');
      const error = parsed.searchParams.get('error');

      if (code && state === expectedState) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(resultPage('&#10003; Authorized!', 'You can close this tab and return to the terminal.'));
        settle(resolve, code);
        return;
      }

      const reason = code
        ? 'state mismatch (the callback did not come from this login)'
        : error || 'unknown error';
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(resultPage('Authorization failed', escapeHtml(reason)));
      settle(reject, new Error(`Authorization failed: ${reason}`));
    });

    server.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use. Stop any process using it and try again.`));
      } else {
        reject(err);
      }
    });

    server.listen(port, host, () => onListening?.(server.address()));

    timer = setTimeout(() => {
      server.close();
      const after = timeoutMs % 60_000 === 0 ? `${timeoutMs / 60_000} minutes` : `${timeoutMs} ms`;
      reject(new Error(`Authorization timed out after ${after}.`));
    }, timeoutMs);
  });
}

async function exchangeCode(clientId, code, verifier) {
  const res = await fetch(tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({
      client_id: clientId,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      code,
      redirect_uri: getOAuthRedirectUri(),
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Token exchange failed (${res.status}): ${body.error_description || body.error || res.statusText}`);
  }

  return res.json();
}

export async function refreshAccessToken() {
  const clientId = getOAuthClientId();
  const refreshToken = getRefreshToken();

  if (!clientId || !refreshToken) {
    throw new Error('No refresh token available. Run `kit login` to re-authenticate.');
  }

  const res = await fetch(tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Token refresh failed (${res.status}): ${body.error_description || body.error || res.statusText}`);
  }

  const data = await res.json();
  setTokens(data.access_token, data.refresh_token, data.created_at, data.expires_in);
  return data.access_token;
}

export async function login(clientId) {
  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = base64url(randomBytes(16));

  const authUrl = new URL(authorizeUrl());
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', getOAuthRedirectUri());
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);

  openBrowser(authUrl.toString());

  const code = await waitForCallback(state);
  const data = await exchangeCode(clientId, code, verifier);
  setTokens(data.access_token, data.refresh_token, data.created_at, data.expires_in);
  // A fresh login can be a different account than whichever one telemetry
  // last cached an ID for. setTokens() itself deliberately doesn't clear the
  // cache — it also runs on routine token refresh, where clearing would be
  // wrong — so this is the one call site that has to.
  clearCachedAccountId();
}
