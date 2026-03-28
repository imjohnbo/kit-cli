import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── helpers copied from the script under test ─────────────────────────────

function getOperations(spec) {
  const ops = {};
  for (const [pathKey, pathItem] of Object.entries(spec.paths || {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      if (pathItem[method]) {
        ops[`${method.toUpperCase()} ${pathKey}`] = pathItem[method];
      }
    }
  }
  return ops;
}

function summarizeOperation(op) {
  return {
    summary: op.summary || '',
    description: (op.description || '').slice(0, 200),
    parameters: (op.parameters || []).map(p => `${p.in}:${p.name}`).sort(),
    requestBodySchema: op.requestBody
      ? JSON.stringify(op.requestBody?.content?.['application/json']?.schema || {})
      : null,
  };
}

function diffOperations(oldOps, newOps) {
  const added = [], removed = [], changed = [];
  for (const key of [...new Set([...Object.keys(oldOps), ...Object.keys(newOps)])].sort()) {
    if (!oldOps[key]) {
      added.push({ key, op: newOps[key] });
    } else if (!newOps[key]) {
      removed.push({ key, op: oldOps[key] });
    } else {
      const o = summarizeOperation(oldOps[key]);
      const n = summarizeOperation(newOps[key]);
      const diffs = [];
      if (o.summary !== n.summary)
        diffs.push(`  - **Summary:** \`${o.summary}\` → \`${n.summary}\``);
      if (o.description !== n.description)
        diffs.push(`  - **Description changed**`);
      const addedParams = n.parameters.filter(p => !o.parameters.includes(p));
      const removedParams = o.parameters.filter(p => !n.parameters.includes(p));
      if (addedParams.length) diffs.push(`  - **Added params:** ${addedParams.join(', ')}`);
      if (removedParams.length) diffs.push(`  - **Removed params:** ${removedParams.join(', ')}`);
      if (o.requestBodySchema !== n.requestBodySchema)
        diffs.push(`  - **Request body schema changed**`);
      if (diffs.length > 0) changed.push({ key, diffs });
    }
  }
  return { added, removed, changed };
}

// ── fixtures ─────────────────────────────────────────────────────────────

const BASE_SPEC = {
  paths: {
    '/v4/subscribers': {
      get:  { summary: 'List subscribers', tags: ['Subscribers'], parameters: [{ in: 'query', name: 'page' }] },
      post: { summary: 'Create subscriber', tags: ['Subscribers'], parameters: [] },
    },
    '/v4/tags': {
      get: { summary: 'List tags', tags: ['Tags'], parameters: [] },
    },
  },
};

// ── tests ─────────────────────────────────────────────────────────────────

test('identical specs produce no diff', () => {
  const diff = diffOperations(getOperations(BASE_SPEC), getOperations(BASE_SPEC));
  assert.equal(diff.added.length, 0);
  assert.equal(diff.removed.length, 0);
  assert.equal(diff.changed.length, 0);
});

test('new path shows up as added', () => {
  const newSpec = {
    paths: {
      ...BASE_SPEC.paths,
      '/v4/apps': { get: { summary: 'List installed apps', tags: ['Apps'], parameters: [] } },
    },
  };
  const diff = diffOperations(getOperations(BASE_SPEC), getOperations(newSpec));
  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0].key, 'GET /v4/apps');
  assert.equal(diff.removed.length, 0);
  assert.equal(diff.changed.length, 0);
});

test('deleted path shows up as removed', () => {
  const newSpec = { paths: { '/v4/subscribers': BASE_SPEC.paths['/v4/subscribers'] } };
  const diff = diffOperations(getOperations(BASE_SPEC), getOperations(newSpec));
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.removed[0].key, 'GET /v4/tags');
  assert.equal(diff.added.length, 0);
});

test('new HTTP method on existing path is added', () => {
  const newSpec = {
    paths: {
      ...BASE_SPEC.paths,
      '/v4/tags': {
        ...BASE_SPEC.paths['/v4/tags'],
        post: { summary: 'Create tag', tags: ['Tags'], parameters: [] },
      },
    },
  };
  const diff = diffOperations(getOperations(BASE_SPEC), getOperations(newSpec));
  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0].key, 'POST /v4/tags');
});

test('changed summary detected', () => {
  const newSpec = {
    paths: {
      ...BASE_SPEC.paths,
      '/v4/tags': { get: { summary: 'List all tags (updated)', tags: ['Tags'], parameters: [] } },
    },
  };
  const diff = diffOperations(getOperations(BASE_SPEC), getOperations(newSpec));
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.changed[0].key, 'GET /v4/tags');
  assert.ok(diff.changed[0].diffs[0].includes('List all tags (updated)'));
});

test('added query parameter detected', () => {
  const newSpec = {
    paths: {
      ...BASE_SPEC.paths,
      '/v4/subscribers': {
        get: {
          summary: 'List subscribers',
          tags: ['Subscribers'],
          parameters: [
            { in: 'query', name: 'page' },
            { in: 'query', name: 'per_page' },
          ],
        },
        post: BASE_SPEC.paths['/v4/subscribers'].post,
      },
    },
  };
  const diff = diffOperations(getOperations(BASE_SPEC), getOperations(newSpec));
  assert.equal(diff.changed.length, 1);
  assert.ok(diff.changed[0].diffs.some(d => d.includes('per_page')));
});

test('empty spec produces no diff', () => {
  const diff = diffOperations(getOperations({ paths: {} }), getOperations({ paths: {} }));
  assert.equal(diff.added.length, 0);
  assert.equal(diff.removed.length, 0);
  assert.equal(diff.changed.length, 0);
});
