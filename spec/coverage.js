/**
 * Maps every operation in spec/v4.json to the CLI command that reaches it.
 *
 * The API spec check workflow opens an issue whenever the spec moves. Triaging
 * that issue means answering one question per changed endpoint: does the CLI
 * cover this? This map is that answer, written down.
 *
 * scripts/spec-coverage.test.js holds the map to the spec:
 *
 *   - every spec operation appears here
 *   - every entry here is still in the spec
 *   - every command named here exists in the command tree
 *
 * So a spec change that adds or removes an endpoint fails the tests until
 * someone updates this file, and an entry can never name a command that was
 * renamed or deleted.
 *
 * Set `command` to null and give a `reason` for an operation the CLI leaves
 * alone on purpose.
 */
export const COVERAGE = {
  // ── Account ──────────────────────────────────────────────────────────────
  'GET /v4/account': 'account',
  'GET /v4/account/colors': 'account colors',
  'PUT /v4/account/colors': 'account set-colors',
  'GET /v4/account/creator_profile': 'account creator-profile',
  'GET /v4/account/email_stats': 'account email-stats',
  'GET /v4/account/growth_stats': 'account growth-stats',

  // ── Broadcasts ───────────────────────────────────────────────────────────
  'GET /v4/broadcasts': 'broadcasts list',
  'POST /v4/broadcasts': 'broadcasts create',
  'GET /v4/broadcasts/{id}': 'broadcasts get',
  'PUT /v4/broadcasts/{id}': 'broadcasts update',
  'DELETE /v4/broadcasts/{id}': 'broadcasts delete',
  // One subcommand covers both stats endpoints. With an ID it asks for one
  // broadcast, without one it asks for every broadcast.
  'GET /v4/broadcasts/stats': 'broadcasts stats',
  'GET /v4/broadcasts/{broadcast_id}/stats': 'broadcasts stats',
  'GET /v4/broadcasts/{broadcast_id}/clicks': 'broadcasts clicks',

  // ── Bulk ─────────────────────────────────────────────────────────────────
  'POST /v4/bulk/subscribers': 'bulk subscribers create',
  'POST /v4/bulk/tags': 'bulk tags create',
  'DELETE /v4/bulk/tags': 'bulk tags delete',
  'POST /v4/bulk/tags/subscribers': 'bulk tags add',
  'DELETE /v4/bulk/tags/subscribers': 'bulk tags remove',
  'POST /v4/bulk/forms/subscribers': 'bulk forms add',
  'POST /v4/bulk/custom_fields': 'bulk custom-fields create',
  'POST /v4/bulk/custom_fields/subscribers': 'bulk custom-fields update-values',

  // ── Custom fields ────────────────────────────────────────────────────────
  'GET /v4/custom_fields': 'custom-fields list',
  'POST /v4/custom_fields': 'custom-fields create',
  'PUT /v4/custom_fields/{id}': 'custom-fields update',
  'DELETE /v4/custom_fields/{id}': 'custom-fields delete',

  // ── Email templates ──────────────────────────────────────────────────────
  'GET /v4/email_templates': 'email-templates list',

  // ── Forms ────────────────────────────────────────────────────────────────
  'GET /v4/forms': 'forms list',
  'GET /v4/forms/{form_id}/subscribers': 'forms subscribers',
  'POST /v4/forms/{form_id}/subscribers': 'forms add-by-email',
  'POST /v4/forms/{form_id}/subscribers/{id}': 'forms add',

  // ── Posts ────────────────────────────────────────────────────────────────
  'GET /v4/posts': 'posts list',
  'GET /v4/posts/{id}': 'posts get',

  // ── Purchases ────────────────────────────────────────────────────────────
  'GET /v4/purchases': 'purchases list',
  'POST /v4/purchases': 'purchases create',
  'GET /v4/purchases/{id}': 'purchases get',

  // ── Segments ─────────────────────────────────────────────────────────────
  'GET /v4/segments': 'segments list',

  // ── Sequences ────────────────────────────────────────────────────────────
  'GET /v4/sequences': 'sequences list',
  'POST /v4/sequences': 'sequences create',
  'GET /v4/sequences/{id}': 'sequences get',
  'PUT /v4/sequences/{id}': 'sequences update',
  'DELETE /v4/sequences/{id}': 'sequences delete',
  'GET /v4/sequences/{sequence_id}/subscribers': 'sequences subscribers',
  'POST /v4/sequences/{sequence_id}/subscribers': 'sequences add-by-email',
  'POST /v4/sequences/{sequence_id}/subscribers/{id}': 'sequences add',

  // ── Sequence emails ──────────────────────────────────────────────────────
  'GET /v4/sequences/{sequence_id}/emails': 'sequences emails list',
  'POST /v4/sequences/{sequence_id}/emails': 'sequences emails create',
  'GET /v4/sequences/{sequence_id}/emails/{id}': 'sequences emails get',
  'PUT /v4/sequences/{sequence_id}/emails/{id}': 'sequences emails update',
  'DELETE /v4/sequences/{sequence_id}/emails/{id}': 'sequences emails delete',

  // ── Snippets ─────────────────────────────────────────────────────────────
  'GET /v4/snippets': 'snippets list',
  'POST /v4/snippets': 'snippets create',
  'GET /v4/snippets/{id}': 'snippets get',
  'PUT /v4/snippets/{id}': 'snippets update',

  // ── Subscribers ──────────────────────────────────────────────────────────
  'GET /v4/subscribers': 'subscribers list',
  'POST /v4/subscribers': 'subscribers create',
  'POST /v4/subscribers/filter': 'subscribers filter',
  'GET /v4/subscribers/{id}': 'subscribers get',
  'PUT /v4/subscribers/{id}': 'subscribers update',
  'POST /v4/subscribers/{id}/unsubscribe': 'subscribers unsubscribe',
  'GET /v4/subscribers/{subscriber_id}/stats': 'subscribers stats',
  'POST /v4/subscribers/{subscriber_id}/location': 'subscribers location pin',
  'PATCH /v4/subscribers/{subscriber_id}/location': 'subscribers location update',
  'DELETE /v4/subscribers/{subscriber_id}/location': 'subscribers location delete',
  'GET /v4/subscribers/{subscriber_id}/tags': 'subscribers tags',

  // ── Tags ─────────────────────────────────────────────────────────────────
  'GET /v4/tags': 'tags list',
  'POST /v4/tags': 'tags create',
  'PUT /v4/tags/{id}': 'tags update',
  'GET /v4/tags/{tag_id}/subscribers': 'tags subscribers',
  'POST /v4/tags/{tag_id}/subscribers': 'tags add-by-email',
  'DELETE /v4/tags/{tag_id}/subscribers': 'tags remove-by-email',
  'POST /v4/tags/{tag_id}/subscribers/{id}': 'tags add',
  'DELETE /v4/tags/{tag_id}/subscribers/{id}': 'tags remove',

  // ── Webhooks ─────────────────────────────────────────────────────────────
  // `kit webhooks` reaches the current-generation /webhook_endpoints resource.
  // The legacy /webhooks resource below is intentionally not exposed.
  'GET /v4/webhook_endpoints': 'webhooks list',
  'POST /v4/webhook_endpoints': 'webhooks create',
  'GET /v4/webhook_endpoints/{id}': 'webhooks get',
  'PATCH /v4/webhook_endpoints/{id}': 'webhooks update',
  'DELETE /v4/webhook_endpoints/{id}': 'webhooks delete',
  'POST /v4/webhook_endpoints/{id}/rotate_secret': 'webhooks rotate-secret',
  'POST /v4/webhook_endpoints/{id}/revoke_previous_secret': 'webhooks revoke-previous-secret',
};

/** Operations the CLI leaves alone on purpose, with the reason. */
export const NOT_EXPOSED = {
  // Legacy webhooks resource, kept working by the API but superseded by
  // /webhook_endpoints (see `kit webhooks`) for all new integrations.
  'GET /v4/webhooks': 'Legacy resource superseded by /webhook_endpoints; use `kit webhooks` instead.',
  'POST /v4/webhooks': 'Legacy resource superseded by /webhook_endpoints; use `kit webhooks` instead.',
  'DELETE /v4/webhooks/{id}': 'Legacy resource superseded by /webhook_endpoints; use `kit webhooks` instead.',
};

/** Lists every operation key in a spec document, in the same shape as COVERAGE. */
export function specOperations(spec) {
  const keys = [];
  for (const [path, item] of Object.entries(spec.paths || {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      if (item[method]) keys.push(`${method.toUpperCase()} ${path}`);
    }
  }
  return keys.sort();
}
