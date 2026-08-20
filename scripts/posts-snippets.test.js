/**
 * Tests for src/commands/posts.js and src/commands/snippets.js
 *
 * Posts cover the endpoints added in issue #5. Snippets cover the endpoints
 * named in issue #7, which the CLI had no support for at all.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { postsCommand } from '../src/commands/posts.js';
import { snippetsCommand } from '../src/commands/snippets.js';
import { runCommand, onlyCall, findSubcommand } from './helpers.js';

const POST = {
  id: 5,
  publication_id: 99,
  created_at: '2026-01-02T10:00:00Z',
  title: 'Hello world',
  slug: 'hello-world',
  description: 'A first post',
  meta_description: null,
  status: 'published',
  published_at: '2026-01-03T10:00:00Z',
  sent_at: null,
  thumbnail_alt: null,
  thumbnail_url: null,
  is_paid: false,
  public_url: 'https://example.kit.com/posts/hello-world',
  content: '<p>body</p>',
};

const SNIPPET = {
  id: 3,
  name: 'Signature',
  snippet_type: 'inline',
  archived: false,
  key: 'signature',
  created_at: '2026-01-02T10:00:00Z',
  updated_at: '2026-01-04T10:00:00Z',
  content: 'Thanks, {{ subscriber.first_name }}',
  document: { id: 1, value: null, value_html: '<p>x</p>', value_plain: null, version: 1 },
};

const posts = (argv, responses) => runCommand(postsCommand, argv, { responses });
const snippets = (argv, responses) => runCommand(snippetsCommand, argv, { responses });

// ── posts ──────────────────────────────────────────────────────────────────

describe('posts list', () => {
  test('requests GET /posts', async () => {
    const res = await posts(['list'], { posts: [POST], pagination: {} });
    const call = onlyCall(res);
    assert.equal(call.method, 'GET');
    assert.equal(call.path, '/v4/posts');
  });

  test('forwards pagination options', async () => {
    const res = await posts(['list', '--per-page', '10', '--after', 'cur'], { posts: [], pagination: {} });
    const call = onlyCall(res);
    assert.equal(call.query.per_page, '10');
    assert.equal(call.query.after, 'cur');
  });

  test('--include-content sets include_content=true', async () => {
    const res = await posts(['list', '--include-content'], { posts: [], pagination: {} });
    assert.equal(onlyCall(res).query.include_content, 'true');
  });

  test('omits include_content by default', async () => {
    const res = await posts(['list'], { posts: [], pagination: {} });
    assert.ok(!('include_content' in onlyCall(res).query));
  });

  test('renders the title and status columns', async () => {
    const res = await posts(['list'], { posts: [POST], pagination: {} });
    assert.match(res.out, /Hello world/);
    assert.match(res.out, /published/);
  });

  test('reports an empty list without erroring', async () => {
    const res = await posts(['list'], { posts: [], pagination: {} });
    assert.match(res.out, /No results found/);
    assert.equal(res.exitCode, undefined);
  });

  test('--format json prints the raw array', async () => {
    const res = await posts(['list', '--format', 'json'], { posts: [POST], pagination: {} });
    assert.deepEqual(JSON.parse(res.out), [POST]);
  });
});

describe('posts get', () => {
  test('requests GET /posts/{id}', async () => {
    const res = await posts(['get', '5'], { post: POST });
    const call = onlyCall(res);
    assert.equal(call.method, 'GET');
    assert.equal(call.path, '/v4/posts/5');
  });

  test('prints the publication ID so a post can be matched to its broadcast', async () => {
    const res = await posts(['get', '5'], { post: POST });
    assert.match(res.out, /Publication ID/);
    assert.match(res.out, /99/);
  });

  test('rejects a path-traversing ID', async () => {
    const res = await posts(['get', '../account'], { post: POST });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });
});

// ── snippets ───────────────────────────────────────────────────────────────

describe('snippets list', () => {
  test('requests GET /snippets', async () => {
    const res = await snippets(['list'], { snippets: [SNIPPET], pagination: {} });
    const call = onlyCall(res);
    assert.equal(call.method, 'GET');
    assert.equal(call.path, '/v4/snippets');
  });

  test('--snippet-type filters by type', async () => {
    const res = await snippets(['list', '--snippet-type', 'block'], { snippets: [], pagination: {} });
    assert.equal(onlyCall(res).query.snippet_type, 'block');
  });

  test('rejects an unknown snippet type', async () => {
    const res = await snippets(['list', '--snippet-type', 'sidebar'], { snippets: [], pagination: {} });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /sidebar/);
  });

  test('--archived sets archived=true', async () => {
    const res = await snippets(['list', '--archived'], { snippets: [], pagination: {} });
    assert.equal(onlyCall(res).query.archived, 'true');
  });

  test('omits archived by default', async () => {
    const res = await snippets(['list'], { snippets: [], pagination: {} });
    assert.ok(!('archived' in onlyCall(res).query));
  });

  test('renders the snippet key column', async () => {
    const res = await snippets(['list'], { snippets: [SNIPPET], pagination: {} });
    assert.match(res.out, /signature/);
  });
});

describe('snippets get', () => {
  test('requests GET /snippets/{id}', async () => {
    const res = await snippets(['get', '3'], { snippet: SNIPPET });
    assert.equal(onlyCall(res).path, '/v4/snippets/3');
  });

  test('prints the snippet content', async () => {
    const res = await snippets(['get', '3'], { snippet: SNIPPET });
    assert.match(res.out, /subscriber.first_name/);
  });
});

describe('snippets create', () => {
  test('POSTs an inline snippet with content', async () => {
    const res = await snippets(
      ['create', 'Signature', '--type', 'inline', '--content', 'Thanks!'],
      { snippet: SNIPPET }
    );
    const call = onlyCall(res);
    assert.equal(call.method, 'POST');
    assert.equal(call.path, '/v4/snippets');
    assert.deepEqual(call.body, { name: 'Signature', snippet_type: 'inline', content: 'Thanks!' });
  });

  test('POSTs a block snippet with document_attributes', async () => {
    const res = await snippets(
      ['create', 'Banner', '--type', 'block', '--html', '<h1>Hi</h1>'],
      { snippet: { ...SNIPPET, snippet_type: 'block' } }
    );
    assert.deepEqual(onlyCall(res).body, {
      name: 'Banner',
      snippet_type: 'block',
      document_attributes: { value_html: '<h1>Hi</h1>' },
    });
  });

  test('requires --content for an inline snippet', async () => {
    const res = await snippets(['create', 'Signature', '--type', 'inline'], { snippet: SNIPPET });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /--content/);
  });

  test('requires --html for a block snippet', async () => {
    const res = await snippets(['create', 'Banner', '--type', 'block'], { snippet: SNIPPET });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /--html/);
  });

  test('rejects an unknown snippet type', async () => {
    const res = await snippets(['create', 'X', '--type', 'sidebar', '--content', 'a'], { snippet: SNIPPET });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('rejects passing both --content and --html', async () => {
    const res = await snippets(
      ['create', 'X', '--type', 'inline', '--content', 'a', '--html', '<p>b</p>'],
      { snippet: SNIPPET }
    );
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /not both/);
  });

  test('reports the new snippet key', async () => {
    const res = await snippets(
      ['create', 'Signature', '--type', 'inline', '--content', 'Thanks!'],
      { snippet: SNIPPET }
    );
    assert.match(res.out, /key: signature/);
  });
});

describe('snippets update', () => {
  test('PUTs to /snippets/{id}', async () => {
    const res = await snippets(['update', '3', '--name', 'Sig'], { snippet: SNIPPET });
    const call = onlyCall(res);
    assert.equal(call.method, 'PUT');
    assert.equal(call.path, '/v4/snippets/3');
    assert.deepEqual(call.body, { name: 'Sig' });
  });

  test('--archive sends archived true', async () => {
    const res = await snippets(['update', '3', '--archive'], { snippet: SNIPPET });
    assert.equal(onlyCall(res).body.archived, true);
  });

  test('--restore sends archived false', async () => {
    const res = await snippets(['update', '3', '--restore'], { snippet: SNIPPET });
    assert.equal(onlyCall(res).body.archived, false);
  });

  test('rejects --archive together with --restore', async () => {
    const res = await snippets(['update', '3', '--archive', '--restore'], { snippet: SNIPPET });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('refuses an update with no fields', async () => {
    const res = await snippets(['update', '3'], { snippet: SNIPPET });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /Nothing to update/);
  });

  test('does not send snippet_type, which cannot change', async () => {
    const res = await snippets(['update', '3', '--content', 'new'], { snippet: SNIPPET });
    assert.ok(!('snippet_type' in onlyCall(res).body));
  });
});

// ── wiring ─────────────────────────────────────────────────────────────────

describe('command wiring', () => {
  test('posts exposes list and get', () => {
    const cmd = postsCommand();
    assert.ok(findSubcommand(cmd, 'list'));
    assert.ok(findSubcommand(cmd, 'get'));
  });

  test('snippets exposes list, get, create, and update', () => {
    const cmd = snippetsCommand();
    for (const name of ['list', 'get', 'create', 'update']) {
      assert.ok(findSubcommand(cmd, name), `missing subcommand: ${name}`);
    }
  });

  test('snippets has no delete, matching the API', () => {
    assert.equal(findSubcommand(snippetsCommand(), 'delete'), undefined);
  });
});
