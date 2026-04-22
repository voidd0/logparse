// logparse — tests. free forever from vøiddo. https://voiddo.com/tools/logparse/

const parser = require('./src/parser');
const fs = require('fs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('\x1b[32m✓ ' + name + '\x1b[0m');
    passed++;
  } catch (e) {
    console.log('\x1b[31m✗ ' + name + '\x1b[0m');
    console.log('  ' + e.message);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

// Test parseLine - timestamp extraction
test('parseLine extracts timestamp correctly', () => {
  const line = '2024-01-01 12:00:00 ERROR Something failed';
  const result = parser.parseLine(line);
  assert(result.timestamp === '2024-01-01 12:00:00', 'Timestamp should match');
});

// Test parseLine - level extraction
test('parseLine extracts level correctly', () => {
  const line = '2024-01-01 12:00:00 ERROR Something failed';
  const result = parser.parseLine(line);
  assert(result.level === 'error', 'Level should be error');
});

test('parseLine extracts level from bracketed format', () => {
  const line = '[2024-01-01T12:00:00Z] [WARN] Warning message';
  const result = parser.parseLine(line);
  assert(result.level === 'warn', 'Level should be warn');
});

// Test parseLine - JSON format
test('parseLine handles JSON format', () => {
  const line = '{"timestamp":"2024-01-01T12:00:00Z","level":"error","message":"JSON error"}';
  const result = parser.parseLine(line);
  assert(result.level === 'error', 'Level should be error');
  assert(result.message === 'JSON error', 'Message should match');
});

// Test filterByLevel
test('filterByLevel filters correctly', () => {
  const entries = [
    { level: 'info', message: 'Info msg' },
    { level: 'error', message: 'Error msg' },
    { level: 'warn', message: 'Warn msg' }
  ];
  const result = parser.filterByLevel(entries, ['error']);
  assert(result.length === 1, 'Should have 1 entry');
  assert(result[0].level === 'error', 'Should be error level');
});

test('filterByLevel handles multiple levels', () => {
  const entries = [
    { level: 'info', message: 'Info' },
    { level: 'error', message: 'Error' },
    { level: 'warn', message: 'Warn' }
  ];
  const result = parser.filterByLevel(entries, ['error', 'warn']);
  assert(result.length === 2, 'Should have 2 entries');
});

// Test filterByTime
test('filterByTime filters by after', () => {
  const entries = [
    { timestamp: '2024-01-01T10:00:00Z', level: 'info', message: 'Early' },
    { timestamp: '2024-01-01T14:00:00Z', level: 'info', message: 'Late' }
  ];
  const after = new Date('2024-01-01T12:00:00Z');
  const result = parser.filterByTime(entries, after, null);
  assert(result.length === 1, 'Should have 1 entry');
  assert(result[0].message === 'Late', 'Should be late entry');
});

test('filterByTime filters by before', () => {
  const entries = [
    { timestamp: '2024-01-01T10:00:00Z', level: 'info', message: 'Early' },
    { timestamp: '2024-01-01T14:00:00Z', level: 'info', message: 'Late' }
  ];
  const before = new Date('2024-01-01T12:00:00Z');
  const result = parser.filterByTime(entries, null, before);
  assert(result.length === 1, 'Should have 1 entry');
  assert(result[0].message === 'Early', 'Should be early entry');
});

// Test filterByPattern
test('filterByPattern finds matches', () => {
  const entries = [
    { level: 'error', message: 'Connection failed' },
    { level: 'info', message: 'Connection established' },
    { level: 'error', message: 'Timeout occurred' }
  ];
  const result = parser.filterByPattern(entries, 'Connection');
  assert(result.length === 2, 'Should find 2 matches');
});

// Test formatOutput JSON
test('formatOutput returns valid JSON', () => {
  const entries = [{ timestamp: '2024-01-01', level: 'error', message: 'Test' }];
  const output = parser.formatOutput(entries, 'json');
  const parsed = JSON.parse(output);
  assert(Array.isArray(parsed), 'Should be valid JSON array');
  assert(parsed[0].level === 'error', 'Should contain entry');
});

// Test formatOutput CSV
test('formatOutput returns valid CSV', () => {
  const entries = [{ timestamp: '2024-01-01', level: 'error', message: 'Test msg' }];
  const output = parser.formatOutput(entries, 'csv');
  assert(output.includes('timestamp,level,message'), 'Should have CSV header');
  assert(output.includes('error'), 'Should contain level');
});

// Test parseFile empty
test('parseFile handles empty file', () => {
  const testFile = '.test-empty-' + Date.now() + '.log';
  fs.writeFileSync(testFile, '');
  const result = parser.parseFile(testFile);
  fs.unlinkSync(testFile);
  assert(Array.isArray(result), 'Should return array');
  assert(result.length === 0, 'Should be empty');
});

// nginx combined format
test('parseLine parses nginx combined', () => {
  const line = '127.0.0.1 - - [22/Apr/2026:12:00:00 +0000] "GET /api/users HTTP/1.1" 200 5432 "-" "Mozilla/5.0"';
  const result = parser.parseLine(line);
  assert(result.format === 'nginx', 'should be nginx');
  assert(result.extra.status === 200, 'status 200');
  assert(result.extra.method === 'GET', 'method GET');
  assert(result.level === 'info', '2xx → info');
});

test('parseLine maps 5xx to error', () => {
  const line = '127.0.0.1 - - [22/Apr/2026:12:00:00 +0000] "POST /api/error HTTP/1.1" 502 0 "-" "-"';
  const result = parser.parseLine(line);
  assert(result.level === 'error', '5xx → error');
});

// syslog
test('parseLine parses syslog RFC 3164', () => {
  const line = 'Apr 22 12:00:00 myhost sshd[12345]: Accepted publickey for user from 1.2.3.4';
  const result = parser.parseLine(line);
  assert(result.format === 'syslog', 'should be syslog');
  assert(result.extra.proc === 'sshd', 'proc sshd');
  assert(result.extra.pid === 12345, 'pid');
});

// Python logging format
test('parseLine parses python logging', () => {
  const line = '2026-04-22 12:00:00,123 - myapp.views - ERROR - something broke';
  const result = parser.parseLine(line);
  assert(result.level === 'error', 'python ERROR');
  assert(result.message === 'something broke', 'message');
});

// filterAtLeast
test('filterAtLeast filters by severity threshold', () => {
  const entries = [
    { level: 'debug', message: 'd' },
    { level: 'info', message: 'i' },
    { level: 'warn', message: 'w' },
    { level: 'error', message: 'e' },
    { level: 'fatal', message: 'f' },
  ];
  const result = parser.filterAtLeast(entries, 'warn');
  assert(result.length === 3, 'warn+ keeps warn/error/fatal');
});

// invertFilter
test('invertFilter drops matching entries', () => {
  const entries = [
    { level: 'info', message: 'healthcheck ok' },
    { level: 'info', message: 'user signup' },
    { level: 'error', message: 'healthcheck failed' },
  ];
  const result = parser.invertFilter(entries, 'healthcheck');
  assert(result.length === 1, '1 remains');
  assert(result[0].message === 'user signup', 'signup kept');
});

// topMessages
test('topMessages aggregates normalized templates', () => {
  const entries = [
    { level: 'error', message: 'db query failed id=123' },
    { level: 'error', message: 'db query failed id=456' },
    { level: 'error', message: 'db query failed id=789' },
    { level: 'info', message: 'server started on port 3000' },
  ];
  const top = parser.topMessages(entries, 5);
  assert(top[0].count === 3, 'most frequent has 3 hits');
  assert(top[0].level === 'error', 'level propagates');
});

// dedupe
test('dedupe collapses consecutive repeats', () => {
  const entries = [
    { level: 'info', message: 'heartbeat' },
    { level: 'info', message: 'heartbeat' },
    { level: 'info', message: 'heartbeat' },
    { level: 'error', message: 'boom' },
  ];
  const result = parser.dedupe(entries);
  assert(result.length === 2, 'collapsed to 2');
  assert(result[0].message.includes('×3'), 'shows run length');
});

// bucketEvents
test('bucketEvents buckets by window', () => {
  const entries = [
    { timestamp: '2026-04-22T12:00:00Z', level: 'info', message: 'a' },
    { timestamp: '2026-04-22T12:05:00Z', level: 'error', message: 'b' },
    { timestamp: '2026-04-22T13:10:00Z', level: 'info', message: 'c' },
  ];
  const buckets = parser.bucketEvents(entries, 3600000);
  assert(buckets.length === 2, '2 hourly buckets');
  assert(buckets[0].total === 2, 'first hour has 2');
  assert(buckets[1].total === 1, 'second hour has 1');
});

// parseTimeOffset
test('parseTimeOffset accepts common units', () => {
  const a = parser.parseTimeOffset('1h');
  const b = parser.parseTimeOffset('30m');
  const c = parser.parseTimeOffset('7d');
  assert(a && b && c, 'all parse');
  assert(parser.parseTimeOffset('forever') === null, 'garbage returns null');
});

// ndjson format
test('formatOutput ndjson is one-line-per-entry', () => {
  const entries = [
    { timestamp: '2026-04-22', level: 'info', message: 'a' },
    { timestamp: '2026-04-22', level: 'error', message: 'b' },
  ];
  const out = parser.formatOutput(entries, 'ndjson');
  const lines = out.split('\n');
  assert(lines.length === 2, '2 lines');
  assert(JSON.parse(lines[0]).message === 'a', 'first entry parses');
});

console.log('\n' + passed + '/' + (passed + failed) + ' tests passed\n');

if (failed > 0) process.exit(1);
