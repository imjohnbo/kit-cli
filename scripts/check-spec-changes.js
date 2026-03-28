#!/usr/bin/env node
// Compares spec/v4.json (stored) with spec/v4.new.json (freshly downloaded)
// Outputs a GitHub Actions step summary and sets output variables.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OLD_SPEC_PATH = path.join(__dirname, '..', 'spec', 'v4.json');
const NEW_SPEC_PATH = path.join(__dirname, '..', 'spec', 'v4.new.json');
const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT || '';
const GITHUB_STEP_SUMMARY = process.env.GITHUB_STEP_SUMMARY || '';

function setOutput(name, value) {
  if (GITHUB_OUTPUT) {
    fs.appendFileSync(GITHUB_OUTPUT, `${name}=${value}\n`);
  } else {
    console.log(`[output] ${name}=${value}`);
  }
}

function writeSummary(text) {
  if (GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(GITHUB_STEP_SUMMARY, text + '\n');
  }
}

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
  const added = [];
  const removed = [];
  const changed = [];

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

function buildIssueBody(diff) {
  const lines = [
    `## Kit API Spec Changes Detected`,
    ``,
    `| | Count |`,
    `|---|---|`,
    `| ✅ Added endpoints | ${diff.added.length} |`,
    `| ❌ Removed endpoints | ${diff.removed.length} |`,
    `| ✏️ Changed endpoints | ${diff.changed.length} |`,
    ``,
  ];

  if (diff.added.length > 0) {
    lines.push(`### ✅ Added Endpoints`, ``);
    for (const { key, op } of diff.added) {
      const tags = (op.tags || []).join(', ');
      const summary = op.summary || '(no summary)';
      lines.push(`- **\`${key}\`** — ${summary}${tags ? ` *(${tags})*` : ''}`);
      if (op.description) {
        lines.push(`  > ${op.description.slice(0, 300).replace(/\n/g, ' ')}`);
      }
    }
    lines.push(``);
  }

  if (diff.removed.length > 0) {
    lines.push(`### ❌ Removed Endpoints`, ``);
    for (const { key, op } of diff.removed) {
      lines.push(`- **\`${key}\`** — ${op.summary || '(no summary)'}`);
    }
    lines.push(``);
  }

  if (diff.changed.length > 0) {
    lines.push(`### ✏️ Changed Endpoints`, ``);
    for (const { key, diffs } of diff.changed) {
      lines.push(`- **\`${key}\`**`);
      lines.push(...diffs);
    }
    lines.push(``);
  }

  lines.push(
    `---`,
    `*Next step: review changes and add CLI support where needed.*`,
    ``,
    `**Spec:** https://developers.kit.com/api-reference/v4.json`,
  );

  return lines.join('\n');
}

function buildIssueTitle(diff) {
  const parts = [];
  if (diff.added.length) parts.push(`${diff.added.length} added`);
  if (diff.removed.length) parts.push(`${diff.removed.length} removed`);
  if (diff.changed.length) parts.push(`${diff.changed.length} changed`);
  return `Kit API spec update: ${parts.join(', ')}`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const oldSpec = JSON.parse(fs.readFileSync(OLD_SPEC_PATH, 'utf8'));
const newSpec = JSON.parse(fs.readFileSync(NEW_SPEC_PATH, 'utf8'));

const diff = diffOperations(getOperations(oldSpec), getOperations(newSpec));
const hasChanges = diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;

if (!hasChanges) {
  console.log('No changes detected in API spec.');
  setOutput('has_changes', 'false');
  writeSummary('## No API spec changes detected');
  process.exit(0);
}

console.log(`Changes: ${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed`);

const title = buildIssueTitle(diff);
const body = buildIssueBody(diff);

fs.writeFileSync(path.join(__dirname, '..', 'spec', '.issue-title.txt'), title);
fs.writeFileSync(path.join(__dirname, '..', 'spec', '.issue-body.md'), body);

setOutput('has_changes', 'true');
setOutput('issue_title', title.replace(/\n/g, ' '));
writeSummary(`## API Spec Changes Detected\n\n${body}`);

process.exit(0);
