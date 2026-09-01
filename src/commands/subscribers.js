import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import {
  get,
  post,
  put,
  patch,
  del,
  validatePathSegment,
  validateEnum,
  validateFloatInRange,
  validateTimeZone,
  validateCountryCode,
  safeJsonParse,
  parseCsvList,
} from '../client.js';
import {
  formatOutput,
  printDetail,
  printSuccess,
  printPagination,
  printWarnings,
  addFormatOption,
  addPaginationOptions,
  addSlimOption,
  withErrorHandler,
} from '../output.js';

// Statuses accepted by the list filter, which allows `all` on top of the
// lifecycle states.
const LIST_STATUSES = ['active', 'inactive', 'bounced', 'complained', 'cancelled', 'all'];

// States a subscriber can be created in. `all` is not one of them.
const CREATE_STATES = ['active', 'inactive', 'bounced', 'complained', 'cancelled'];

const COUNTING_MODES = ['raw', 'unique_email'];

const INCLUDE_TYPES = ['attribution', 'tags', 'location', 'canceled_at', 'stats', 'custom_fields'];

const COLUMNS = [
  { header: 'ID', accessor: (d) => d.id },
  { header: 'Email', accessor: (d) => d.email_address },
  { header: 'First Name', accessor: (d) => d.first_name },
  { header: 'State', accessor: (d) => d.state },
  { header: 'Created', accessor: (d) => d.created_at?.slice(0, 10) },
];

const FILTER_COLUMNS = [
  { header: 'ID', accessor: (d) => d.id },
  { header: 'Email', accessor: (d) => d.email_address },
  { header: 'First Name', accessor: (d) => d.first_name },
  { header: 'Tags', accessor: (d) => d.tag_names?.join(', ') },
  { header: 'Created', accessor: (d) => d.created_at?.slice(0, 10) },
];

const DETAIL_FIELDS = [
  { label: 'ID', accessor: (d) => d.id },
  { label: 'Email', accessor: (d) => d.email_address },
  { label: 'First Name', accessor: (d) => d.first_name },
  { label: 'State', accessor: (d) => d.state },
  { label: 'Created At', accessor: (d) => d.created_at },
  { label: 'Fields', accessor: (d) => d.fields ? JSON.stringify(d.fields) : null },
];

/**
 * Reads the filter body from a file or an inline string.
 *
 * Accepts either the full request body (`{ "all": [...] }`) or just the
 * conditions array (`[...]`), which is what most filters amount to.
 */
function readFilterBody({ file, json }) {
  if (file && json) {
    console.error('Pass either --file or --json, not both.');
    process.exit(1);
  }
  if (!file && !json) {
    console.error('A filter needs conditions. Pass --file <path> or --json <json>.');
    process.exit(1);
  }

  let raw = json;
  if (file) {
    try {
      raw = readFileSync(file, 'utf8');
    } catch (err) {
      console.error(`Failed to read ${file}: ${err.message}`);
      process.exit(1);
    }
  }

  const parsed = safeJsonParse(raw, 'filter JSON');
  const body = Array.isArray(parsed) ? { all: parsed } : parsed;

  if (!body || !Array.isArray(body.all)) {
    console.error('Filter JSON must be an array of conditions, or an object with an "all" array.');
    process.exit(1);
  }
  return body;
}

/** Builds the `include` array from --include plus the optional stats range. */
function buildInclude(opts) {
  if (!opts.include) return undefined;
  const types = parseCsvList(opts.include);
  return types.map((type) => {
    validateEnum(type, INCLUDE_TYPES, 'include type');
    if (type !== 'stats') return { type };
    const range = {};
    if (opts.statsStart) range.start = opts.statsStart;
    if (opts.statsEnd) range.end = opts.statsEnd;
    return Object.keys(range).length > 0 ? { type, range } : { type };
  });
}

const LOCATION_FIELDS = [
  { label: 'Subscriber ID', accessor: (d) => d.id },
  { label: 'City', accessor: (d) => d.location?.city },
  { label: 'State / Province', accessor: (d) => d.location?.state_province },
  { label: 'Country', accessor: (d) => d.location?.country_code },
  { label: 'Latitude', accessor: (d) => d.location?.latitude },
  { label: 'Longitude', accessor: (d) => d.location?.longitude },
  { label: 'Time Zone', accessor: (d) => d.location?.timezone },
];

/**
 * Flags for pinning a location. The API requires all six on both the create and
 * the update, because the update is a full replacement rather than a patch.
 */
function addLocationOptions(cmd) {
  return cmd
    .requiredOption('--city <city>', 'city name')
    .requiredOption('--state-province <state>', 'state or province name')
    .requiredOption('--country-code <code>', 'ISO 3166-1 alpha-2 country code, e.g. US')
    .requiredOption('--latitude <lat>', 'latitude in decimal degrees')
    .requiredOption('--longitude <lon>', 'longitude in decimal degrees')
    .requiredOption('--time-zone <tz>', 'IANA time zone, e.g. America/Denver');
}

function buildLocationBody(opts) {
  return {
    location: {
      city: opts.city,
      state_province: opts.stateProvince,
      country_code: validateCountryCode(opts.countryCode),
      latitude: validateFloatInRange(opts.latitude, -90, 90, 'latitude'),
      longitude: validateFloatInRange(opts.longitude, -180, 180, 'longitude'),
      timezone: validateTimeZone(opts.timeZone),
    },
  };
}

/**
 * `kit subscribers location ...`
 *
 * Kit infers a location from open events. These commands pin an explicit one,
 * which overrides what Kit inferred.
 */
function locationCommand() {
  const cmd = new Command('location').description("Manage a subscriber's pinned location");

  const pin = cmd
    .command('pin <id>')
    .description("Pin a location, overriding what Kit inferred from open events");
  addFormatOption(pin);
  addLocationOptions(pin).action(
    withErrorHandler(async (id, opts) => {
      const safeId = validatePathSegment(id, 'subscriber ID');
      const res = await post(`/subscribers/${safeId}/location`, buildLocationBody(opts));
      const sub = res.subscriber || res;
      printSuccess(`Location pinned for subscriber ${id}.`, opts);
      printDetail(sub, LOCATION_FIELDS, opts);
    })
  );

  // PATCH, but a full replacement. The API requires every field, so the flags
  // match `pin` exactly rather than allowing a partial update.
  const update = cmd
    .command('update <id>')
    .description('Replace a pinned location. Every field is required');
  addFormatOption(update);
  addLocationOptions(update).action(
    withErrorHandler(async (id, opts) => {
      const safeId = validatePathSegment(id, 'subscriber ID');
      const res = await patch(`/subscribers/${safeId}/location`, buildLocationBody(opts));
      const sub = res.subscriber || res;
      printSuccess(`Location updated for subscriber ${id}.`, opts);
      printDetail(sub, LOCATION_FIELDS, opts);
    })
  );

  cmd
    .command('delete <id>')
    .description('Remove a pinned location, letting Kit infer one again')
    .action(
      withErrorHandler(async (id) => {
        const safeId = validatePathSegment(id, 'subscriber ID');
        await del(`/subscribers/${safeId}/location`);
        printSuccess(`Location removed for subscriber ${id}.`);
      })
    );

  return cmd;
}

export function subscribersCommand() {
  const cmd = new Command('subscribers').description('Manage subscribers');

  // List subscribers
  const list = cmd
    .command('list')
    .description('List subscribers');
  addFormatOption(list);
  addPaginationOptions(list);
  addSlimOption(list, 'custom field values');
  list
    .option('-e, --email <email>', 'filter by email address')
    .option('-s, --state <state>', `filter by state (${LIST_STATUSES.join(', ')})`)
    .option('--created-after <date>', 'filter by created after (yyyy-mm-dd)')
    .option('--created-before <date>', 'filter by created before (yyyy-mm-dd)')
    .option('--updated-after <date>', 'filter by updated after (yyyy-mm-dd)')
    .option('--updated-before <date>', 'filter by updated before (yyyy-mm-dd)')
    .option('--sort-field <field>', 'sort field (id, updated_at, cancelled_at)')
    .option('--sort-order <order>', 'sort order (asc, desc)')
    .action(
      withErrorHandler(async (opts) => {
        if (opts.state) validateEnum(opts.state, LIST_STATUSES, 'state');
        const query = {
          per_page: opts.perPage,
          after: opts.after,
          before: opts.before,
          email_address: opts.email,
          status: opts.state,
          created_after: opts.createdAfter,
          created_before: opts.createdBefore,
          updated_after: opts.updatedAfter,
          updated_before: opts.updatedBefore,
          sort_field: opts.sortField,
          sort_order: opts.sortOrder,
          slim: opts.slim ? 'true' : undefined,
        };
        const res = await get('/subscribers', query);
        formatOutput(res.subscribers, COLUMNS, opts);
        printPagination(res.pagination);
      })
    );

  // Get subscriber
  const show = cmd
    .command('get <id>')
    .description('Get a subscriber by ID');
  addFormatOption(show);
  show.action(
    withErrorHandler(async (id, opts) => {
      const safeId = validatePathSegment(id, 'subscriber ID');
      const res = await get(`/subscribers/${safeId}`);
      printDetail(res.subscriber || res, DETAIL_FIELDS, opts);
    })
  );

  // Filter subscribers
  const filter = cmd
    .command('filter')
    .description('Filter subscribers by engagement, sign-up date, state, and tags');
  addFormatOption(filter);
  addPaginationOptions(filter);
  filter
    .option('--file <path>', 'JSON file holding the filter conditions')
    .option('--json <json>', 'filter conditions as an inline JSON string')
    .option('--counting-mode <mode>', `how engagement counts are tallied (${COUNTING_MODES.join(', ')})`)
    .option('--include <types>', `extra fields to embed (${INCLUDE_TYPES.join(', ')})`)
    .option('--stats-start <date>', 'start of the stats include range (yyyy-mm-dd)')
    .option('--stats-end <date>', 'end of the stats include range (yyyy-mm-dd)')
    .action(
      withErrorHandler(async (opts) => {
        const body = readFilterBody(opts);
        if (opts.countingMode) {
          body.counting_mode = validateEnum(opts.countingMode, COUNTING_MODES, 'counting mode');
        }
        const include = buildInclude(opts);
        if (include) body.include = include;

        const query = { per_page: opts.perPage, after: opts.after, before: opts.before };
        const res = await post('/subscribers/filter', body, query);
        formatOutput(res.subscribers, FILTER_COLUMNS, opts);
        printPagination(res.pagination);
      })
    );

  // Create subscriber
  const create = cmd
    .command('create <email>')
    .description('Create or update a subscriber')
    .option('-n, --first-name <name>', 'subscriber first name')
    .option('-s, --state <state>', `subscriber state (${CREATE_STATES.join(', ')})`)
    .option('--fields <json>', 'custom fields as a JSON object, keyed by field key (e.g. last_name)');
  addFormatOption(create);
  create
    .action(
      withErrorHandler(async (email, opts) => {
        const body = { email_address: email };
        if (opts.firstName) body.first_name = opts.firstName;
        if (opts.state) body.state = validateEnum(opts.state, CREATE_STATES, 'state');
        if (opts.fields) body.fields = safeJsonParse(opts.fields, 'custom fields JSON');
        const res = await post('/subscribers', body);
        printSuccess(`Subscriber created/updated: ${(res.subscriber || res).id}`, opts);
        printWarnings(res);
        printDetail(res.subscriber || res, DETAIL_FIELDS, opts);
      })
    );

  // Update subscriber
  const update = cmd
    .command('update <id>')
    .description('Update a subscriber')
    .option('-e, --email <email>', 'new email address')
    .option('-n, --first-name <name>', 'new first name')
    .option('--fields <json>', 'custom fields as a JSON object, keyed by field key (e.g. last_name)');
  addFormatOption(update);
  update
    .action(
      withErrorHandler(async (id, opts) => {
        const safeId = validatePathSegment(id, 'subscriber ID');
        const body = {};
        if (opts.email) body.email_address = opts.email;
        if (opts.firstName) body.first_name = opts.firstName;
        if (opts.fields) body.fields = safeJsonParse(opts.fields, 'custom fields JSON');
        const res = await put(`/subscribers/${safeId}`, body);
        printSuccess(`Subscriber ${id} updated.`, opts);
        printWarnings(res);
        printDetail(res.subscriber || res, DETAIL_FIELDS, opts);
      })
    );

  // Unsubscribe
  cmd
    .command('unsubscribe <id>')
    .description('Unsubscribe a subscriber by ID')
    .action(
      withErrorHandler(async (id) => {
        const safeId = validatePathSegment(id, 'subscriber ID');
        await post(`/subscribers/${safeId}/unsubscribe`);
        printSuccess(`Subscriber ${id} unsubscribed.`);
      })
    );

  // List tags for subscriber
  const tags = cmd
    .command('tags <id>')
    .description('List tags for a subscriber');
  addFormatOption(tags);
  addPaginationOptions(tags);
  tags.action(
    withErrorHandler(async (id, opts) => {
      const safeId = validatePathSegment(id, 'subscriber ID');
      const query = { per_page: opts.perPage, after: opts.after, before: opts.before };
      const res = await get(`/subscribers/${safeId}/tags`, query);
      formatOutput(res.tags, [
        { header: 'ID', accessor: (d) => d.id },
        { header: 'Name', accessor: (d) => d.name },
        { header: 'Tagged At', accessor: (d) => d.tagged_at?.slice(0, 10) },
      ], opts);
      printPagination(res.pagination);
    })
  );

  // Subscriber stats
  const stats = cmd
    .command('stats <id>')
    .description('Get engagement stats for a subscriber');
  addFormatOption(stats);
  stats
    .option('--sent-after <date>', 'filter stats by emails sent after (yyyy-mm-dd)')
    .option('--sent-before <date>', 'filter stats by emails sent before (yyyy-mm-dd)')
    .action(
      withErrorHandler(async (id, opts) => {
        const safeId = validatePathSegment(id, 'subscriber ID');
        const query = {
          email_sent_after: opts.sentAfter,
          email_sent_before: opts.sentBefore,
        };
        const res = await get(`/subscribers/${safeId}/stats`, query);
        const data = res.subscriber || res;
        printDetail(data, [
          { label: 'ID', accessor: (d) => d.id },
          { label: 'Emails Sent', accessor: (d) => d.stats?.sent },
          { label: 'Emails Opened', accessor: (d) => d.stats?.opened },
          { label: 'Emails Clicked', accessor: (d) => d.stats?.clicked },
          { label: 'Open Rate', accessor: (d) => d.stats?.open_rate },
          { label: 'Click Rate', accessor: (d) => d.stats?.click_rate },
          { label: 'Bounces', accessor: (d) => d.stats?.bounced },
        ], opts);
      })
    );

  cmd.addCommand(locationCommand());

  return cmd;
}
