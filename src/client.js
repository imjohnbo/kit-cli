import { getApiKey, getAccessToken, isTokenExpired, getBaseUrl } from './config.js';
import { refreshAccessToken } from './auth.js';
import { USER_AGENT } from './package-info.js';

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
 * Validates that a value is an integer within an inclusive range.
 * Unlike validateNumericId, zero is allowed when it is inside the range.
 */
export function validateIntInRange(value, min, max, label = 'value') {
  const num = Number(value);
  if (!Number.isInteger(num) || num < min || num > max) {
    console.error(`Invalid ${label}: "${value}". Must be an integer between ${min} and ${max}.`);
    process.exit(1);
  }
  return num;
}

/**
 * Validates that a value is a finite number within an inclusive range.
 * Used for coordinates, where zero and negatives are both legitimate.
 */
export function validateFloatInRange(value, min, max, label = 'value') {
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) {
    console.error(`Invalid ${label}: "${value}". Must be a number between ${min} and ${max}.`);
    process.exit(1);
  }
  return num;
}

/**
 * Validates an IANA time zone name, such as America/Denver.
 *
 * Intl on its own is too permissive here. It accepts a UTC offset like `-07:00`
 * and an abbreviation like `PST`, and neither is an IANA name. An offset also
 * ignores daylight saving, which is the whole reason to send a zone. So this
 * checks the value against the real zone list that Intl carries, and returns the
 * canonical spelling.
 */
const IANA_BY_LOWERCASE = (() => {
  const map = new Map();
  if (typeof Intl.supportedValuesOf === 'function') {
    for (const zone of Intl.supportedValuesOf('timeZone')) map.set(zone.toLowerCase(), zone);
  }
  // Real IANA zones that supportedValuesOf leaves out.
  for (const zone of ['UTC', 'GMT']) map.set(zone.toLowerCase(), zone);
  return map;
})();

export function validateTimeZone(value, label = 'time zone') {
  const input = String(value).trim();
  const canonical = IANA_BY_LOWERCASE.get(input.toLowerCase());

  if (canonical) return canonical;

  // The Etc/* family is legitimate but not enumerated. Let Intl arbitrate.
  if (/^Etc\//i.test(input)) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: input });
      return input;
    } catch {
      // fall through to the error below
    }
  }

  console.error(`Invalid ${label}: "${value}". Must be an IANA name, such as America/Denver.`);
  process.exit(1);
}

/**
 * Validates an ISO 3166-1 alpha-2 country code, returning it upper-cased.
 */
export function validateCountryCode(value, label = 'country code') {
  const code = String(value).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) {
    console.error(`Invalid ${label}: "${value}". Must be two letters, such as US.`);
    process.exit(1);
  }
  return code;
}

/**
 * Validates that a value is one of an allowed set, case-sensitively.
 */
export function validateEnum(value, allowed, label = 'value') {
  if (!allowed.includes(value)) {
    console.error(`Invalid ${label}: "${value}". Must be one of: ${allowed.join(', ')}.`);
    process.exit(1);
  }
  return value;
}

/**
 * Parses a comma-separated list of numeric IDs into an array of numbers.
 * Exits with a message if any entry is not a positive integer.
 */
export function parseIdList(value, label = 'ID') {
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => validateNumericId(s, label));
}

/**
 * Parses a comma-separated list into an array of trimmed, non-empty strings.
 */
export function parseCsvList(value) {
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
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
  const url = new URL(`${getBaseUrl()}${path}`);

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
    'User-Agent': USER_AGENT,
  };

  const opts = { method, headers };

  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE')) {
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

export async function put(path, body, query) {
  return request('PUT', path, { body, query });
}

export async function patch(path, body, query) {
  return request('PATCH', path, { body, query });
}

export async function del(path, body, query) {
  return request('DELETE', path, { body, query });
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
