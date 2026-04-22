# logparse

**Structured log parser / filter / aggregator.** Auto-detects JSON, plain-text, nginx, Apache, syslog, and Python-logging. Filter by level, grep, time range; aggregate into top templates and time buckets. Works on files or stdin.

Free forever gift from [vøiddo](https://voiddo.com).

```
$ logparse app.log --top 5

  TOP MESSAGE TEMPLATES
  ─────────────────────
     847  ██████████████████  [ERROR] Failed to connect to db id=<num>
     312  ██████░░░░░░░░░░░░  [WARN]  Slow query id=<num> took <dur>
      94  ██░░░░░░░░░░░░░░░░  [INFO]  User login email=<email>
      41  █░░░░░░░░░░░░░░░░░  [ERROR] Redis timeout after <dur>
      12  ░░░░░░░░░░░░░░░░░░  [FATAL] Out of memory
```

## Why logparse

`grep` doesn't know what a log "entry" is. `jq` only works on JSON. `lnav` is a full TUI you install for this one task. `awk` works but you're gonna write 3 lines every time.

logparse is one binary that:
- **auto-detects** every log format in common use (JSON, text, nginx/apache combined, syslog RFC 3164, Python logging),
- **filters** by level (`-l error,warn`), grep (`-g timeout`), time (`--last 1h`), severity threshold (`--min-level warn`),
- **aggregates** into top-N message templates (normalized) or per-bucket counts,
- **streams** with `tail -f` semantics or from stdin,
- emits JSON / NDJSON / CSV envelopes for piping into `jq` or loading into a spreadsheet.

## Install

```bash
npm install -g @v0idd0/logparse
```

Or one-shot with `npx`:

```bash
tail -f app.log | npx -y @v0idd0/logparse --min-level error
```

## Quickstart

```bash
# Parse a mixed-format log, print colored
logparse app.log

# Just errors + warnings
logparse app.log -l error,warn

# Severity threshold (warn + error + fatal)
logparse app.log --min-level warn

# Last hour, only entries matching "timeout"
logparse app.log --last 1h -g timeout

# Top 10 noisiest templates (normalizes IDs/IPs/UUIDs)
logparse app.log --top 10

# Events per hour
logparse app.log --bucket 1h

# Dedupe consecutive repeats → "heartbeat (×327)"
logparse app.log --dedupe

# Read from stdin
tail -f app.log | logparse --min-level error

# nginx access log → JSON
logparse access.log --format nginx --json

# systemd journal → top 5 offenders
journalctl -u myapp | logparse --format syslog --top 5

# Live stream errors only
logparse -f app.log --min-level error
```

## Supported formats (auto-detected)

| Format | Example |
|--------|---------|
| **JSON lines** | `{"timestamp":"2026-04-22T12:00Z","level":"error","message":"boom"}` |
| **text** | `2026-04-22 12:00:00 ERROR something failed` |
| **bracketed** | `[2026-04-22T12:00Z] [ERROR] something failed` |
| **python-logging** | `2026-04-22 12:00:00,123 - myapp.views - ERROR - something broke` |
| **nginx combined** | `1.2.3.4 - - [22/Apr/2026:12:00:00 +0000] "GET / HTTP/1.1" 200 532 "-" "curl"` |
| **apache common** | Same as nginx but without referer/user-agent |
| **syslog RFC 3164** | `Apr 22 12:00:00 host sshd[1234]: Accepted publickey for user` |

For HTTP access logs, status codes auto-map to levels: `5xx → error`, `4xx → warn`, `<400 → info`.

Force a specific parser with `--format text|json|nginx|apache|syslog`.

## Options

### Filters
| Flag | Description |
|------|-------------|
| `-l, --level <levels>` | Keep these levels (comma-sep) |
| `--min-level <level>` | Keep entries at or above this severity |
| `--after <date>` | Entries after date |
| `--before <date>` | Entries before date |
| `--last <offset>` | Last N time (`1h`, `30m`, `7d`, `500s`) |
| `-g, --grep <pattern>` | Keep entries matching regex |
| `-v, --invert <pattern>` | Drop entries matching regex |

### Aggregation
| Flag | Description |
|------|-------------|
| `-c, --count` | Table of counts by level |
| `--top <N>` | Top N message templates (IDs/IPs/UUIDs normalized) |
| `--dedupe` | Collapse consecutive repeats into `message (×N)` |
| `--bucket <offset>` | Per-bucket counts (`1h`, `15m`, `1d`) |

### Output
| Flag | Description |
|------|-------------|
| `--json` | JSON array |
| `--ndjson` | One JSON object per line |
| `--csv` | CSV with `timestamp,level,message` |
| `-f, --follow` | Stream new lines (tail -f semantics) |
| `--format <fmt>` | Force-parse as `text`, `json`, `nginx`, `apache`, or `syslog` |
| `-h, --help` | Show help |
| `--version` | Show version |

## Features worth calling out

### Template extraction (`--top`)
Normalizes IDs, IPs, UUIDs, durations, timestamps, and big numbers out of messages, then aggregates. Turns a 50,000-line log into a 10-line signal:

```
  847  ██████████████████  [ERROR] Failed to connect to db id=<num>
  312  ██████░░░░░░░░░░░░  [WARN]  Slow query id=<num> took <dur>
```

### Time bucketing
`--bucket 1h` groups events into hourly windows and prints level breakdowns as mini bars. Great for "is the error rate climbing?" without opening Grafana.

### HTTP access log awareness
nginx/apache lines auto-parse into structured records with `status`, `method`, `path`, `ip`, `userAgent`. The `--json` envelope carries them through as `extra` fields.

### Stream from anything
`tail -f /var/log/app.log | logparse --min-level error` is a poor man's alert pipeline. `journalctl -fu myapp | logparse --top 5` gives you a live-updating "noisiest" view.

## Exit codes

| Code | Meaning |
|------|---------|
| `0`  | Ran cleanly |
| `1`  | File not found, input error, or unknown command |

## Programmatic use

```js
const {
  parseLine, parseFile, parseString,
  filterByLevel, filterAtLeast, filterByTime, filterByPattern, invertFilter,
  countByLevel, topMessages, dedupe, bucketEvents, normalizeMessage,
  formatOutput, parseTimeOffset,
} = require('@v0idd0/logparse/src/parser');

const entries = parseFile('/var/log/app.log');
const errors  = filterAtLeast(entries, 'error');
const top     = topMessages(errors, 10);

// Or parse a single line
const entry = parseLine('127.0.0.1 - - [22/Apr/2026:12:00:00 +0000] "GET / HTTP/1.1" 200 532 "-" "curl"');
// => { format: 'nginx', level: 'info', extra: { status: 200, method: 'GET', path: '/' }, ... }
```

## From the same studio

vøiddo builds sharp, free-forever CLIs for devs who are tired of paywalls:

- [`@v0idd0/jsonyo`](https://voiddo.com/tools/jsonyo/) — JSON that yells at you
- [`@v0idd0/tokcount`](https://voiddo.com/tools/tokcount/) — token counter for 60+ LLMs
- [`@v0idd0/ctxstuff`](https://voiddo.com/tools/ctxstuff/) — stuff a repo into an LLM context
- [`@v0idd0/promptdiff`](https://voiddo.com/tools/promptdiff/) — diff two prompts
- [`@v0idd0/httpwut`](https://voiddo.com/tools/httpwut/) — HTTP debugger
- [`@v0idd0/gitstats`](https://voiddo.com/tools/gitstats/) — local git analytics
- [`@v0idd0/licenseme`](https://voiddo.com/tools/licenseme/) — LICENSE generator + detector
- [`@v0idd0/envguard`](https://voiddo.com/tools/envguard/) — .env validator + secret scanner
- [`@v0idd0/depcheck`](https://voiddo.com/tools/depcheck/) — offline CVE scanner + unused-deps

Full catalog: [voiddo.com/tools](https://voiddo.com/tools/).

## License

MIT © [vøiddo](https://voiddo.com) — free forever, no asterisks.

## Links

- Docs: https://voiddo.com/tools/logparse/
- Source: https://github.com/voidd0/logparse
- npm: https://npmjs.com/package/@v0idd0/logparse
- Studio: https://voiddo.com
- Issues: https://github.com/voidd0/logparse/issues
- Support: support@voiddo.com
