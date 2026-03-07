import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { setTokens, getOAuthClientId, getRefreshToken, getOAuthRedirectUri } from './config.js';

const REDIRECT_PORT = 9876;
const AUTHORIZE_URL = 'https://api.kit.com/v4/oauth/authorize';
const TOKEN_URL = 'https://api.kit.com/v4/oauth/token';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

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

function openBrowser(url) {
  const cmd =
    process.platform === 'win32' ? 'start' :
    process.platform === 'darwin' ? 'open' :
    'xdg-open';
  exec(`${cmd} "${url}"`);
}

function waitForCallback() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const parsed = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
      const code = parsed.searchParams.get('code');
      const error = parsed.searchParams.get('error');

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body style="font-family:sans-serif;padding:2rem"><h2>&#10003; Authorized!</h2><p>You can close this tab and return to the terminal.</p></body></html>');
        server.close();
        resolve(code);
      } else {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<html><body style="font-family:sans-serif;padding:2rem"><h2>Authorization failed</h2><p>${error || 'Unknown error'}</p></body></html>`);
        server.close();
        reject(new Error(`Authorization failed: ${error || 'unknown error'}`));
      }
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${REDIRECT_PORT} is already in use. Stop any process using it and try again.`));
      } else {
        reject(err);
      }
    });

    server.listen(REDIRECT_PORT);

    setTimeout(() => {
      server.close();
      reject(new Error('Authorization timed out after 5 minutes.'));
    }, LOGIN_TIMEOUT_MS);
  });
}

async function exchangeCode(clientId, code, verifier) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
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

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
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

  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', getOAuthRedirectUri());
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);

  openBrowser(authUrl.toString());

  const code = await waitForCallback();
  const data = await exchangeCode(clientId, code, verifier);
  setTokens(data.access_token, data.refresh_token, data.created_at, data.expires_in);
}
