import { Command } from 'commander';
import { get, post, put, patch, del, safeJsonParse, validateEnum } from '../client.js';
import { withErrorHandler } from '../output.js';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Parses "per_page=10,status=active" into { per_page: '10', status: 'active' }. */
function parseQuery(value) {
  const query = {};
  for (const pair of String(value).split(',')) {
    const [key, ...rest] = pair.split('=');
    if (!key) continue;
    query[key.trim()] = rest.join('=').trim();
  }
  return query;
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
    .option('--data <json>', 'JSON request body')
    .option('--query <pairs>', 'comma-separated key=value query parameters, e.g. per_page=10,status=active');

  cmd.action(
    withErrorHandler(async (method, path, opts) => {
      const verb = validateEnum(String(method).toUpperCase(), METHODS, 'method');
      const fullPath = path.startsWith('/') ? path : `/${path}`;
      const query = opts.query ? parseQuery(opts.query) : undefined;
      const body = opts.data ? safeJsonParse(opts.data, 'request body') : undefined;

      const result = await callMethod(verb, fullPath, body, query);
      console.log(JSON.stringify(result, null, 2));
    })
  );

  return cmd;
}
