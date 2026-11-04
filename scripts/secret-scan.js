#!/usr/bin/env node
/**
 * Secret scan (FCCV-87, ported to fello-dcr in FCCV-92) — fails when a key, token, password or private key is committed.
 *
 * Scans every tracked file (git ls-files) and prints `path:line  RULE` for each finding.
 * It NEVER prints the matched value. Exit 0 = clean, 1 = findings, 2 = scan error.
 *
 *   node scripts/secret-scan.js
 *
 * A reviewed identifier that trips a rule can be allowed on its own line with a trailing
 * `// secret-scan: allow (<reason>)` comment. Don't use it for secrets — put those in env.
 *
 * No dependencies on purpose (the team avoids new tools); GitHub secret scanning complements it.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Values that are clearly not real secrets.
const PLACEHOLDER = /^(?:\$|<|\{)|example|placeholder|your[-_ ]|changeme|xxxx|dummy|cypress|not-a-real|redacted|canary|sample|test|stub|mock|todo|\*\*\*/i;
// URLs and paths are not secrets (a secret embedded in a URL is still caught by the strong rules).
const isPlaceholder = v => PLACEHOLDER.test(v) || v.includes('${') || /^(https?:\/\/|wss?:\/\/|\/|\.\/)/.test(v);

const SECRET_NAME = '[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|PRIVATE|CREDENTIAL|AUTH)[A-Za-z0-9_]*'; // secret-scan: allow (regex source)

// [rule, regex, index of the value group (or null), strong?]
// Strong rules also run on test files; weak rules skip them (tests are full of fake assignments).
const RULES = [
  ['PRIVATE_KEY', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/, null, true],
  // Sanctum tokens: 40 random chars, plus an 8-char CRC32 suffix on Laravel 11+ (48 total) — FCCV-92
  ['LARAVEL_TOKEN', /\b\d{1,6}\|[A-Za-z0-9]{40,}\b/, null, true],
  // Quoted bearer tokens — the space after `Bearer` defeats SECRET_ASSIGN (FCCV-92)
  ['BEARER_LITERAL', /(['"`])Bearer\s+([A-Za-z0-9._~+\/|-]{20,}=*)\1/i, 2, true],
  ['HEX32_LITERAL', /(['"`])([0-9a-fA-F]{32})\1/, 2, true],
  ['HIGH_ENTROPY_LITERAL', /(['"`])([A-Za-z0-9]{32,})\1/, 2, true],
  // Well-known token formats: GitHub, Slack, Anthropic/OpenAI-style sk-, AWS access key IDs
  ['VENDOR_TOKEN', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}|AKIA[0-9A-Z]{16})\b/, null, true],
  // Credentials embedded in a URL (scheme, user, password, host) — weak: test fixtures use fake ones
  ['URL_CREDENTIAL', /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@'"`]+:([^@\s'"`/]{3,})@/i, 1, false],
  ['ENV_FALLBACK', new RegExp(`process\\.env\\.${SECRET_NAME}\\s*\\|\\|\\s*(['"\`])([^'"\`]+)\\1`, 'i'), 2, false],
  ['SECRET_ASSIGN', /["']?\b[A-Za-z_]*(?:api[_-]?key|secret|token|password|passwd|private[_-]?key|license[_-]?key|client[_-]?secret)[A-Za-z_]*["']?\s*[:=]\s*(['"`])([^'"`\s]{6,})\1/i, 2, false],
  ['SHELL_EXPORT', new RegExp(`\\bexport\\s+${SECRET_NAME}=(["']?)([^\\s"'$<]{4,})`, 'i'), 2, false],
  ['MD_CREDENTIAL', /\b(?:login|password|passwd|credentials?)\b\**\s*:\**\s*`([^`\s]{3,})`/i, 1, false],
];
const DOTENV_RULE = ['DOTENV_VALUE', new RegExp(`^\\s*(?:export\\s+)?${SECRET_NAME}\\s*=\\s*["']?([^\\s"'#]{4,})`, 'i'), 1];
// Unquoted YAML values (quoted ones are caught by SECRET_ASSIGN)
const YAML_RULE = ['YAML_VALUE', /^\s*[A-Za-z0-9_-]*(?:api[_-]?key|secret|token|password|passwd|private[_-]?key)[A-Za-z0-9_-]*\s*:\s*([^\s'"#|>{[$][^\s#]{5,})\s*$/i, 1];

const SKIP_EXT = /\.(png|jpe?g|gif|ico|webp|svg|pdf|woff2?|ttf|eot|otf|zip|gz|mp4|webm|mov|mp3|wav|heic)$/i;
const SKIP_PATH = /(^|\/)(node_modules|package-lock\.json)(\/|$)/;
const TEST_PATH = /(^(lib\/__tests__|cypress|test)\/)|\.(test|spec|cy)\.[cm]?js$/;

function hasMixedClasses(v) {
  return /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v);
}

/** Findings for one file's text: [{ line, rule }]. Never includes the value. */
function scanText(text, file = '') {
  const findings = [];
  const isTest = TEST_PATH.test(file);
  const isDotenv = (/(^|\/)\.env(\.|$)/.test(file) || /\.env$/.test(file)) && !/\.example$/.test(file);
  const isYaml = /\.ya?ml$/i.test(file) && !isTest;
  const lines = text.split('\n');
  lines.forEach((ln, i) => {
    if (ln.includes('secret-scan: allow')) return;
    for (const [rule, re, group, strong] of RULES) {
      if (isTest && !strong) continue;
      const m = ln.match(re);
      if (!m) continue;
      if (group !== null) {
        const v = m[group];
        if (isPlaceholder(v)) continue;
        if (rule === 'HIGH_ENTROPY_LITERAL' && !hasMixedClasses(v)) continue;
      }
      findings.push({ line: i + 1, rule });
    }
    if (isDotenv) {
      const m = ln.match(DOTENV_RULE[1]);
      if (m && !isPlaceholder(m[1])) findings.push({ line: i + 1, rule: DOTENV_RULE[0] });
    }
    if (isYaml) {
      const m = ln.match(YAML_RULE[1]);
      if (m && !isPlaceholder(m[1])) findings.push({ line: i + 1, rule: YAML_RULE[0] });
    }
  });
  return findings;
}

function trackedFiles(cwd) {
  return execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean);
}

function scanRepo(cwd = process.cwd()) {
  const results = [];
  let scanned = 0;
  for (const f of trackedFiles(cwd)) {
    if (SKIP_EXT.test(f) || SKIP_PATH.test(f)) continue;
    const p = path.join(cwd, f);
    let st;
    try { st = fs.statSync(p); } catch { continue; } // deleted in the working tree
    if (!st.isFile() || st.size > 2 * 1024 * 1024) continue;
    const buf = fs.readFileSync(p);
    if (buf.includes(0)) continue; // binary
    scanned++;
    for (const r of scanText(buf.toString('utf8'), f)) results.push({ file: f, ...r });
  }
  return { results, scanned };
}

if (require.main === module) {
  try {
    const { results, scanned } = scanRepo(process.cwd());
    if (!results.length) {
      console.log(`secret-scan: clean (${scanned} files)`);
      process.exit(0);
    }
    for (const r of results) console.log(`${r.file}:${r.line}  ${r.rule}`);
    const files = new Set(results.map(r => r.file)).size;
    console.log(`\nsecret-scan: ${results.length} finding(s) in ${files} file(s). Values are never printed.`);
    console.log('Move secrets out of the repo: Apps Script credentials go in Script Properties (see google-apps-script.js header).');
    process.exit(1);
  } catch (err) {
    console.error(`secret-scan: error — ${err.message}`);
    process.exit(2);
  }
}

module.exports = { scanText, scanRepo, RULES };
