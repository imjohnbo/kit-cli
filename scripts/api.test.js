/**
 * Tests for src/commands/api.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { apiCommand } from '../src/commands/api.js';
import { runCommand, onlyCall } from './helpers.js';

const api = (argv, responses) => runCommand(apiCommand, argv, { responses });

describe('kit api', () => {
  test('GET sends a GET request to the given path', async () => {
    const res = await api(['GET', '/subscribers'], { subscribers: [] });
    const call = onlyCall(res);
    assert.equal(call.method, 'GET');
    assert.equal(call.path, '/v4/subscribers');
  });

  test('adds a leading slash when the path omits one', async () => {
    const res = await api(['GET', 'subscribers'], { subscribers: [] });
    assert.equal(onlyCall(res).path, '/v4/subscribers');
  });

  test('is case-insensitive on the method', async () => {
    const res = await api(['get', '/subscribers'], { subscribers: [] });
    assert.equal(onlyCall(res).method, 'GET');
  });

  test('POST sends the --data body as JSON', async () => {
    const res = await api(['POST', '/tags', '--data', '{"name":"vip"}'], { tag: { id: 1, name: 'vip' } });
    const call = onlyCall(res);
    assert.equal(call.method, 'POST');
    assert.deepEqual(call.body, { name: 'vip' });
  });

  test('PUT sends the --data body as JSON', async () => {
    const res = await api(['PUT', '/tags/5', '--data', '{"name":"vip2"}'], { tag: { id: 5, name: 'vip2' } });
    assert.equal(onlyCall(res).method, 'PUT');
  });

  test('PATCH sends the --data body as JSON', async () => {
    const res = await api(['PATCH', '/subscribers/1/location', '--data', '{"location":{}}'], { subscriber: {} });
    assert.equal(onlyCall(res).method, 'PATCH');
  });

  test('--query is parsed into query parameters', async () => {
    const res = await api(['GET', '/subscribers', '--query', 'per_page=10&status=active'], { subscribers: [] });
    const call = onlyCall(res);
    assert.equal(call.query.per_page, '10');
    assert.equal(call.query.status, 'active');
  });

  test('a comma inside a query value survives intact (e.g. Kit\'s comma-separated include lists)', async () => {
    const res = await api(['GET', '/tags', '--query', 'include=stats,subscriber_count'], { tags: [] });
    assert.equal(onlyCall(res).query.include, 'stats,subscriber_count');
  });

  test('DELETE sends no body when --data is omitted', async () => {
    const res = await api(['DELETE', '/tags/5'], { __status: 204 });
    const call = onlyCall(res);
    assert.equal(call.method, 'DELETE');
    assert.equal(call.body, undefined);
  });

  test('pretty-prints the raw JSON response', async () => {
    const res = await api(['GET', '/subscribers'], { subscribers: [{ id: 1 }] });
    assert.deepEqual(JSON.parse(res.out), { subscribers: [{ id: 1 }] });
  });

  test('rejects an unsupported method', async () => {
    const res = await api(['FETCH', '/subscribers'], {});
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('rejects invalid JSON in --data', async () => {
    const res = await api(['POST', '/tags', '--data', '{bad json}'], {});
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('rejects --data on a GET request instead of silently dropping it', async () => {
    const res = await api(['GET', '/subscribers', '--data', '{"a":1}'], {});
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /--data has no effect on a GET request/);
  });

  for (const [label, raw, parsed] of [
    ['0', '0', 0],
    ['null', 'null', null],
    ['false', 'false', false],
  ]) {
    test(`sends a falsy JSON --data value (${label}) rather than silently dropping it`, async () => {
      const res = await api(['POST', '/tags', '--data', raw], { tag: {} });
      const call = onlyCall(res);
      assert.equal(call.body, parsed);
    });
  }
});
