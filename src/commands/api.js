import { Command } from 'commander';
import { get, post, put, patch, del, safeJsonParse, validateEnum } from '../client.js';
import { withErrorHandler } from '../output.js';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Parses "per_page=10&include=stats,subscriber_count" into
 * { per_page: '10', include: 'stats,subscriber_count' }.
 *
 * Pairs split on `&`, not `,` — several Kit endpoints take a comma-separated
 * `include` list (GET /tags, /subscribers, /forms, /sequences, and the
 * sequence-emails routes), and splitting on comma would silently truncate
 * exactly that value at the first item, with no error and a 200 response.
 *
 * Delegates to URLSearchParams rather than hand-splitting on `=`: it keeps
 * that same `&`-only splitting behavior, but also percent-decodes each
 * value. client.js's request() re-encodes every value when it builds the
 * final URL (url.searchParams.set()) — without decoding here first, a value
 * a caller had correctly percent-encoded (the only way to pass a literal
 * `&` or `=` through this parser) would be encoded a second time and
 * corrupted on the wire.
 */
function parseQuery(value) {
  return Object.fromEntries(new URLSearchParams(String(value)));
}

function callMethod(verb, path, body, query) {
  switch (verb) {
    case 'GET':    return get(path, query);
    case 'POST':   return post(path, body, query);
    case 'PUT':    return put(path, body, query);
    case 'PATCH':  return patch(path, body, query);
    case 'DELETE': return del(path, body, query);
  }
}

export function apiCommand() {
  const cmd = new Command('api')
    .description('Send a raw request to the Kit API — an escape hatch for endpoints without a dedicated command')
    .argument('<method>', 'HTTP method: GET, POST, PUT, PATCH, or DELETE')
    .argument('<path>', 'API path, e.g. /subscribers or /tags/123')
    .option('--data <json>', 'JSON request body (ignored for GET)')
    .option('--query <pairs>', "'&'-separated key=value query parameters, e.g. per_page=10&include=stats,subscriber_count");

  cmd.action(
    withErrorHandler(async (method, path, opts) => {
      const verb = validateEnum(String(method).toUpperCase(), METHODS, 'method');
      const fullPath = path.startsWith('/') ? path : `/${path}`;
      const query = opts.query ? parseQuery(opts.query) : undefined;

      if (opts.data && verb === 'GET') {
        // request() in client.js only attaches a body to POST/PUT/PATCH/
        // DELETE — a GET with --data would otherwise silently send without
        // it, with no indication the flag did nothing.
        throw new Error('--data has no effect on a GET request — GET requests never send a body.');
      }
      const body = opts.data ? safeJsonParse(opts.data, 'request body') : undefined;

      const result = await callMethod(verb, fullPath, body, query);
      console.log(JSON.stringify(result, null, 2));
    })
  );

  return cmd;
}
