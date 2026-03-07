import { getApiKey, getAccessToken, isTokenExpired } from './config.js';
import { refreshAccessToken } from './auth.js';

const BASE_URL = 'https://api.kit.com/v4';
const MAX_PAGINATE_PAGES = 100;

class KitApiError extends Error {
  constructor(status, errors) {
    super(errors.join('; '));
    this.name = 'KitApiError';
    this.status = status;
    this.errors = errors;
  }
}

/**
 * Validates that a path segment is safe for URL interpolation.
 * Prevents path traversal (e.g., "../webhooks") and injection.
 */
export function validatePathSegment(value, label = 'ID') {
  const str = String(value);
  if (!str || /[\/\\\.#\?&]/.test(str)) {
    console.error(`Invalid ${label}: "${str}". Must not contain /, \\, ., #, ?, or &.`);
    process.exit(1);
  }
  return encodeURIComponent(str);
}

/**
 * Validates that a value is a positive integer and returns the number.
 */
export function validateNumericId(value, label = 'ID') {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    console.error(`Invalid ${label}: "${value}". Must be a positive integer.`);
    process.exit(1);
  }
  return num;
}

/**
 * Safely parses a JSON string with a user-friendly error message.
 */
export function safeJsonParse(str, label = 'JSON') {
  try {
    return JSON.parse(str);
  } catch (err) {
    console.error(`Invalid ${label}: ${err.message}`);
    process.exit(1);
  }
}

async function getAuthHeader() {
  const accessToken = getAccessToken();

  if (accessToken) {
    if (isTokenExpired()) {
      try {
        const newToken = await refreshAccessToken();
        return { 'Authorization': `Bearer ${newToken}` };
      } catch (err) {
        console.error(`Token refresh failed: ${err.message}`);
        console.error('Run `kit login` to re-authenticate.');
        process.exit(1);
      }
    }
    return { 'Authorization': `Bearer ${accessToken}` };
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    console.error('Not authenticated. Run `kit login` or set KIT_API_KEY env var.');
    process.exit(1);
  }
  return { 'X-Kit-Api-Key': apiKey };
}

async function request(method, path, { body, query } = {}) {
  const url = new URL(`${BASE_URL}${path}`);

  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const authHeader = await getAuthHeader();
  const headers = {
    ...authHeader,
    'Accept': 'application/json',
  };

  const opts = { method, headers };

  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), opts);

  if (res.status === 204) return null;

  if (!res.ok) {
    let errors;
    try {
      const json = await res.json();
      errors = json.errors || [json.message || res.statusText];
    } catch {
      errors = [res.statusText];
    }
    throw new KitApiError(res.status, errors);
  }

  return res.json();
}

export async function get(path, query) {
  return request('GET', path, { query });
}

export async function post(path, body, query) {
  return request('POST', path, { body, query });
}

export async function put(path, body) {
  return request('PUT', path, { body });
}

export async function del(path) {
  return request('DELETE', path);
}

export async function paginate(path, query = {}, dataKey) {
  const allItems = [];
  let cursor = query.after || undefined;
  let pages = 0;

  while (pages < MAX_PAGINATE_PAGES) {
    const q = { ...query };
    if (cursor) q.after = cursor;

    const res = await get(path, q);
    const items = dataKey ? res[dataKey] : Object.values(res).find(Array.isArray);

    if (items) allItems.push(...items);
    pages++;

    if (res.pagination?.has_next_page && res.pagination?.end_cursor) {
      cursor = res.pagination.end_cursor;
    } else {
      break;
    }
  }

  if (pages >= MAX_PAGINATE_PAGES) {
    console.error(`Warning: stopped after ${MAX_PAGINATE_PAGES} pages. Use filters to narrow results.`);
  }

  return allItems;
}

export { KitApiError };
