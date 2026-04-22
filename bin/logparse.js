#!/usr/bin/env node
// logparse — structured log parser / filter / aggregator. Free forever from vøiddo.
// https://voiddo.com/tools/logparse/

const fs = require('fs');
const parser = require('../src/parser');
const { maybeShowPromo, getHelpFooter } = require('../src/promo');

const pkg = require('../package.json');
const args = process.argv.slice(2);

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const GRAY = '\x1b[90m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function parseArgs(argList) {
  const options = {
    file: null,
    levels: [],
    minLevel: null,
    after: null,
    before: null,
    last: null,
    grep: null,
    invert: null,
    format: 'text',
    forceFormat: null,
    count: false,
    follow: false,
    top: null,
    dedupe: false,
    bucket: null,
    help: false,
    version: false,
  };

  for (let i = 0; i < argList.length; i++) {
    const arg = argList[i];

    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--version') options.version = true;
    else if (arg === '--level' || arg === '-l') options.levels = String(argList[++i] || '').split(',').map((l) => l.trim().toLowerCase()).filter(Boolean);
    else if (arg === '--min-level') options.minLevel = argList[++i];
    else if (arg === '--after') options.after = new Date(argList[++i]);
    else if (arg === '--before') options.before = new Date(argList[++i]);
    else if (arg === '--last') options.last = argList[++i];
    else if (arg === '--grep' || arg === '-g') options.grep = argList[++i];
    else if (arg === '--invert' || arg === '-v') options.invert = argList[++i];
    else if (arg === '--json') options.format = 'json';
    else if (arg === '--ndjson') options.format = 'ndjson';
    else if (arg === '--csv') options.format = 'csv';
    else if (arg === '--format') options.forceFormat = argList[++i];
    else if (arg === '--count' || arg === '-c') options.count = true;
    else if (arg === '--follow' || arg === '-f') options.follow = true;
    else if (arg === '--top') options.top = parseInt(argList[++i], 10) || 10;
    else if (arg === '--dedupe') options.dedupe = true;
    else if (arg === '--bucket') options.bucket = argList[++i];
    else if (!arg.startsWith('-')) options.file = arg;
  }

  return options;
}

function showHelp() {
  console.log(`
${GREEN}logparse${RESET} ${DIM}v${pkg.version}${RESET}
${DIM}structured log parser / filter / aggregator — free forever from vøiddo${RESET}

${CYAN}Usage:${RESET}
  logparse <file> [options]
  cat app.log | logparse [options]

${CYAN}Input:${RESET}
  <file>                  Path to log file, or '-' / omit for stdin
  --format <fmt>          Force-parse as one format: text, json, nginx, apache, syslog

${CYAN}Filters:${RESET}
  -l, --level <levels>    Keep only these levels (comma-sep: debug,info,warn,error,fatal)
  --min-level <level>     Keep entries at or above this severity
  --after <date>          Only entries after date
  --before <date>         Only entries before date
  --last <offset>         Only the last N time (e.g. 1h, 30m, 7d)
  -g, --grep <pattern>    Keep entries matching this regex in message
  -v, --invert <pattern>  Drop entries matching this regex in message

${CYAN}Aggregation:${RESET}
  -c, --count             Count entries by level, print table
  --top <N>               Top N most-frequent message templates (noise → signal)
  --dedupe                Collapse consecutive repeated messages into "msg (×N)"
  --bucket <offset>       Bucket counts per window (e.g. --bucket 1h)

${CYAN}Output:${RESET}
  --json                  JSON array
  --ndjson                One JSON object per line
  --csv                   CSV with timestamp,level,message
  -f, --follow            Stream new lines (like tail -f)
  -h, --help              Show this help
  --version               Show version

${CYAN}Examples:${RESET}
  logparse app.log                            ${DIM}# full parse, colored${RESET}
  logparse app.log -l error,warn              ${DIM}# errors and warnings${RESET}
  logparse app.log --min-level warn           ${DIM}# warn + error + fatal${RESET}
  logparse app.log --last 1h -g "timeout"     ${DIM}# last hour + match${RESET}
  logparse app.log --top 10                   ${DIM}# 10 noisiest templates${RESET}
  logparse app.log --bucket 1h --json         ${DIM}# requests per hour${RESET}
  logparse access.log --format nginx --json   ${DIM}# parse nginx combined${RESET}
  tail -f app.log | logparse --min-level error ${DIM}# live error-only stream${RESET}
  journalctl -u myapp | logparse --format syslog --top 5

${DIM}docs: https://voiddo.com/tools/logparse/${RESET}${getHelpFooter()}
`);
}

function colorLevel(level) {
  switch (level) {
    case 'error':
    case 'fatal': return RED + String(level).toUpperCase() + RESET;
    case 'warn':  return YELLOW + level.toUpperCase() + RESET;
    case 'info':  return GREEN + level.toUpperCase() + RESET;
    case 'debug': return GRAY + level.toUpperCase() + RESET;
    default:      return String(level || '').toUpperCase();
  }
}

function printEntry(entry) {
  const ts = entry.timestamp || '';
  const lvl = colorLevel(entry.level);
  console.log('  ' + DIM + ts + RESET + ' [' + lvl + '] ' + entry.message);
}

function printCount(counts) {
  console.log();
  console.log('  ' + GRAY + 'debug: ' + RESET + String(counts.debug).padStart(6));
  console.log('  ' + GREEN + 'info:  ' + RESET + String(counts.info).padStart(6));
  console.log('  ' + YELLOW + 'warn:  ' + RESET + String(counts.warn).padStart(6));
  console.log('  ' + RED + 'error: ' + RESET + String(counts.error).padStart(6));
  console.log('  ' + RED + 'fatal: ' + RESET + String(counts.fatal).padStart(6));
  console.log('  ' + DIM + '─────────────' + RESET);
  console.log('  total: ' + String(counts.total).padStart(6));
  console.log();
}

function printTop(rows) {
  console.log();
  console.log(`  ${CYAN}TOP MESSAGE TEMPLATES${RESET}`);
  console.log(`  ${DIM}${'─'.repeat(21)}${RESET}`);
  const max = rows[0] ? rows[0].count : 1;
  for (const r of rows) {
    const bar = '█'.repeat(Math.round((r.count / max) * 18));
    const pad = '░'.repeat(18 - bar.length);
    const c = colorLevel(r.level);
    console.log(`  ${String(r.count).padStart(6)}  ${CYAN}${bar}${DIM}${pad}${RESET}  [${c}] ${r.sample.length > 80 ? r.sample.slice(0, 77) + '...' : r.sample}`);
  }
  console.log();
}

function printBuckets(buckets) {
  console.log();
  console.log(`  ${CYAN}EVENTS PER BUCKET${RESET}`);
  console.log(`  ${DIM}${'─'.repeat(17)}${RESET}`);
  const max = Math.max(1, ...buckets.map((b) => b.total));
  for (const b of buckets) {
    const bar = '█'.repeat(Math.round((b.total / max) * 30));
    const iso = b.start.toISOString().slice(0, 16).replace('T', ' ');
    const d = String(b.debug).padStart(4);
    const i = String(b.info).padStart(4);
    const w = String(b.warn).padStart(4);
    const e = String(b.error).padStart(4);
    console.log(`  ${DIM}${iso}${RESET}  ${CYAN}${bar.padEnd(30)}${RESET}  ${String(b.total).padStart(5)}  ${DIM}d:${d} i:${i} w:${w} e:${e}${RESET}`);
  }
  console.log();
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

async function loadInput(options) {
  if (options.file && options.file !== '-') {
    if (!fs.existsSync(options.file)) {
      console.error(RED + '  Error: File not found: ' + options.file + RESET);
      process.exit(1);
    }
    return parser.parseFile(options.file, { format: options.forceFormat });
  }

  if (process.stdin.isTTY) {
    console.error(RED + '  Error: no file and nothing on stdin' + RESET);
    console.error(DIM + '  run with --help for usage' + RESET);
    process.exit(1);
  }

  const data = await readStdin();
  return parser.parseString(data, { format: options.forceFormat });
}

function applyFilters(entries, options) {
  let out = entries;
  if (options.levels.length > 0) out = parser.filterByLevel(out, options.levels);
  if (options.minLevel) out = parser.filterAtLeast(out, options.minLevel);
  if (options.last) {
    const after = parser.parseTimeOffset(options.last);
    if (after) out = parser.filterByTime(out, after, null);
  }
  if (options.after || options.before) out = parser.filterByTime(out, options.after, options.before);
  if (options.grep) out = parser.filterByPattern(out, options.grep);
  if (options.invert) out = parser.invertFilter(out, options.invert);
  return out;
}

async function runFollow(options) {
  if (!options.file || options.file === '-') {
    console.error(RED + '  --follow requires a file path' + RESET);
    process.exit(1);
  }
  if (!fs.existsSync(options.file)) {
    console.error(RED + '  Error: File not found: ' + options.file + RESET);
    process.exit(1);
  }

  let offset = fs.statSync(options.file).size;
  let carry = '';

  const handle = () => {
    try {
      const size = fs.statSync(options.file).size;
      if (size < offset) offset = 0;
      if (size > offset) {
        const fd = fs.openSync(options.file, 'r');
        const buf = Buffer.alloc(size - offset);
        fs.readSync(fd, buf, 0, buf.length, offset);
        fs.closeSync(fd);
        offset = size;
        carry += buf.toString('utf-8');
        const lines = carry.split('\n');
        carry = lines.pop();
        for (const line of lines) {
          const entry = parser.parseLine(line, options.forceFormat);
          if (!entry) continue;
          const filtered = applyFilters([entry], options);
          if (filtered.length) {
            if (options.format === 'json' || options.format === 'ndjson') {
              console.log(JSON.stringify(entry));
            } else {
              printEntry(entry);
            }
          }
        }
      }
    } catch (err) {
      // file gone / rotated: reset offset, keep polling
      offset = 0;
    }
  };

  console.error(DIM + `  logparse --follow ${options.file}  (Ctrl-C to exit)` + RESET);
  fs.watchFile(options.file, { interval: 250 }, handle);
  await new Promise(() => {});
}

async function main() {
  const options = parseArgs(args);

  if (options.help) { showHelp(); return 0; }
  if (options.version) { console.log(pkg.version); return 0; }

  if (options.follow) {
    await runFollow(options);
    return 0;
  }

  let entries = await loadInput(options);
  if (entries && entries.error) {
    console.error(RED + '  Error: ' + entries.error + RESET);
    return 1;
  }

  entries = applyFilters(entries, options);

  if (options.count) {
    printCount(parser.countByLevel(entries));
    return 0;
  }

  if (options.top) {
    const rows = parser.topMessages(entries, options.top);
    if (options.format === 'json' || options.format === 'ndjson') {
      console.log(JSON.stringify(rows, null, 2));
    } else {
      printTop(rows);
    }
    return 0;
  }

  if (options.bucket) {
    const m = String(options.bucket).match(/^(\d+(?:\.\d+)?)([smhdw])$/i);
    const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
    const offsetMs = m ? parseFloat(m[1]) * mult[m[2].toLowerCase()] : 3600000;
    const buckets = parser.bucketEvents(entries, offsetMs);
    if (options.format === 'json' || options.format === 'ndjson') {
      console.log(JSON.stringify(buckets, null, 2));
    } else {
      printBuckets(buckets);
    }
    return 0;
  }

  if (options.dedupe) entries = parser.dedupe(entries);

  if (options.format === 'json' || options.format === 'csv' || options.format === 'ndjson') {
    console.log(parser.formatOutput(entries, options.format));
    return 0;
  }

  if (options.file && options.file !== '-') {
    console.log();
    console.log(`  ${GREEN}logparse${RESET} ${DIM}— voiddo.com/tools/logparse${RESET}`);
    console.log(`  ${DIM}${'─'.repeat(28)}${RESET}`);
    console.log(`  File: ${options.file}`);

    const filters = [];
    if (options.levels.length) filters.push('level=' + options.levels.join(','));
    if (options.minLevel) filters.push('min-level=' + options.minLevel);
    if (options.last) filters.push('last=' + options.last);
    if (options.grep) filters.push('grep=' + options.grep);
    if (options.invert) filters.push('invert=' + options.invert);
    if (filters.length) console.log('  Filter: ' + filters.join(', '));
    console.log();
  }

  for (const entry of entries) printEntry(entry);

  if (options.file && options.file !== '-') {
    console.log();
    console.log('  Found: ' + entries.length + ' entries');
    console.log();
  }

  maybeShowPromo();
  return 0;
}

main().then((code) => process.exit(code || 0)).catch((err) => {
  console.error(RED + '  unexpected error: ' + err.message + RESET);
  process.exit(1);
});
