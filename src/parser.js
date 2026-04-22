// logparse — log parser core. Free forever from vøiddo.
// https://voiddo.com/tools/logparse/

const fs = require('fs');

const LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'];
const LEVEL_WEIGHT = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 };

const PATTERNS = [
  // 2024-01-01 12:00:00 ERROR Something failed
  /^(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:[+\-]\d{2}:?\d{2}|Z)?)\s+(DEBUG|INFO|WARN|WARNING|ERROR|FATAL|TRACE)\s*[:\-]?\s*(.*)$/i,
  // [2024-01-01T12:00:00Z] [ERROR] Something failed
  /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\]]*)\]\s*\[(DEBUG|INFO|WARN|WARNING|ERROR|FATAL|TRACE)\]\s*(.*)$/i,
  // ERROR 2024-01-01 12:00:00 Something failed
  /^(DEBUG|INFO|WARN|WARNING|ERROR|FATAL|TRACE)\s+(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})\s+(.*)$/i,
  // Python logging default: 2024-01-01 12:00:00,123 - name - LEVEL - message
  /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:,\d+)?)\s*-\s*\S+\s*-\s*(DEBUG|INFO|WARN|WARNING|ERROR|FATAL|TRACE|CRITICAL)\s*-\s*(.*)$/i,
];

// nginx combined: 127.0.0.1 - - [timestamp] "GET /path HTTP/1.1" 200 1234 "ref" "ua"
const NGINX_RE = /^(\S+)\s+\S+\s+(\S+)\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)\s+(\S+)"\s+(\d{3})\s+(\S+)(?:\s+"([^"]*)"\s+"([^"]*)")?/;

// apache common: 127.0.0.1 - - [timestamp] "GET /path HTTP/1.1" 200 1234
const APACHE_RE = /^(\S+)\s+\S+\s+(\S+)\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)\s+(\S+)"\s+(\d{3})\s+(\S+)$/;

// syslog RFC 3164: <pri>Jan  1 12:00:00 host proc[pid]: message
const SYSLOG_RE = /^(?:<\d+>)?(\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+([\w.\-]+)(?:\[(\d+)\])?:\s*(.*)$/;

function normalizeLevel(level) {
  const l = String(level || '').toLowerCase();
  if (l === 'warning') return 'warn';
  if (l === 'critical') return 'fatal';
  if (l === 'trace') return 'debug';
  return l;
}

function httpStatusLevel(status) {
  const s = parseInt(status, 10);
  if (s >= 500) return 'error';
  if (s >= 400) return 'warn';
  return 'info';
}

function parseLine(line, forceFormat) {
  if (!line || !line.trim()) return null;
  const trimmed = line.trim();

  if ((!forceFormat || forceFormat === 'json') && trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed);
      return {
        timestamp: obj.timestamp || obj.time || obj.ts || obj['@timestamp'] || null,
        level: normalizeLevel(obj.level || obj.lvl || obj.severity || 'info'),
        message: obj.message || obj.msg || obj.text || obj.event || JSON.stringify(obj),
        format: 'json',
        raw: false,
        extra: obj,
      };
    } catch {}
  }

  if (!forceFormat || forceFormat === 'nginx') {
    const m = trimmed.match(NGINX_RE);
    if (m) {
      const [, ip, user, ts, method, path, proto, status, size, referer, ua] = m;
      return {
        timestamp: ts,
        level: httpStatusLevel(status),
        message: `${method} ${path} ${status}`,
        format: 'nginx',
        raw: false,
        extra: { ip, user, method, path, protocol: proto, status: parseInt(status, 10), size, referer, userAgent: ua },
      };
    }
  }

  if (!forceFormat || forceFormat === 'apache') {
    const m = trimmed.match(APACHE_RE);
    if (m) {
      const [, ip, user, ts, method, path, proto, status, size] = m;
      return {
        timestamp: ts,
        level: httpStatusLevel(status),
        message: `${method} ${path} ${status}`,
        format: 'apache',
        raw: false,
        extra: { ip, user, method, path, protocol: proto, status: parseInt(status, 10), size },
      };
    }
  }

  if (!forceFormat || forceFormat === 'syslog') {
    const m = trimmed.match(SYSLOG_RE);
    if (m) {
      const [, ts, host, proc, pid, msg] = m;
      return {
        timestamp: ts,
        level: 'info',
        message: msg,
        format: 'syslog',
        raw: false,
        extra: { host, proc, pid: pid ? parseInt(pid, 10) : null },
      };
    }
  }

  for (const pattern of PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      if (LEVELS.includes(String(match[1] || '').toLowerCase()) || String(match[1] || '').toLowerCase() === 'warning') {
        return {
          timestamp: match[2],
          level: normalizeLevel(match[1]),
          message: match[3],
          format: 'text',
          raw: false,
        };
      }
      return {
        timestamp: match[1],
        level: normalizeLevel(match[2]),
        message: match[3],
        format: 'text',
        raw: false,
      };
    }
  }

  return {
    timestamp: null,
    level: 'info',
    message: trimmed,
    format: 'unknown',
    raw: true,
  };
}

function parseFile(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    return { error: 'File not found: ' + filePath };
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return parseString(content, options);
}

function parseString(content, options = {}) {
  const entries = [];
  for (const line of content.split('\n')) {
    const entry = parseLine(line, options.format);
    if (entry) entries.push(entry);
  }
  return entries;
}

function filterByLevel(entries, levels) {
  if (!levels || levels.length === 0) return entries;
  const levelSet = new Set(levels.map((l) => l.toLowerCase()));
  return entries.filter((e) => levelSet.has(e.level));
}

function filterAtLeast(entries, threshold) {
  if (!threshold) return entries;
  const t = LEVEL_WEIGHT[threshold.toLowerCase()];
  if (t === undefined) return entries;
  return entries.filter((e) => (LEVEL_WEIGHT[e.level] ?? 1) >= t);
}

function parseTs(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (!Number.isNaN(d.getTime())) return d;
  return null;
}

function filterByTime(entries, after, before) {
  if (!after && !before) return entries;
  return entries.filter((e) => {
    const ts = parseTs(e.timestamp);
    if (!ts) return true;
    if (after && ts < after) return false;
    if (before && ts > before) return false;
    return true;
  });
}

function filterByPattern(entries, pattern, options = {}) {
  if (!pattern) return entries;
  const regex = new RegExp(pattern, options.flags || 'i');
  return entries.filter((e) => regex.test(e.message || ''));
}

function invertFilter(entries, pattern, options = {}) {
  if (!pattern) return entries;
  const regex = new RegExp(pattern, options.flags || 'i');
  return entries.filter((e) => !regex.test(e.message || ''));
}

function countByLevel(entries) {
  const counts = { debug: 0, info: 0, warn: 0, error: 0, fatal: 0 };
  for (const e of entries) {
    if (counts[e.level] !== undefined) counts[e.level]++;
  }
  counts.total = entries.length;
  return counts;
}

function parseTimeOffset(offset) {
  const match = String(offset || '').match(/^(\d+(?:\.\d+)?)([smhdw])$/i);
  if (!match) return null;
  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  return new Date(Date.now() - value * mult[unit]);
}

function normalizeMessage(message) {
  if (!message) return '';
  return String(message)
    .replace(/\b\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:[+\-]\d{2}:?\d{2}|Z)?\b/g, '<ts>')
    .replace(/\b\d+\.\d+\.\d+\.\d+(?::\d+)?\b/g, '<ip>')
    .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, '<uuid>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\b\d+ms\b/g, '<dur>')
    .replace(/\b\d{2,}\b/g, '<num>')
    .trim();
}

function topMessages(entries, limit = 10) {
  const counts = new Map();
  for (const e of entries) {
    const key = normalizeMessage(e.message);
    if (!key) continue;
    const rec = counts.get(key) || { count: 0, level: e.level, sample: e.message };
    rec.count++;
    if (LEVEL_WEIGHT[e.level] > LEVEL_WEIGHT[rec.level]) rec.level = e.level;
    counts.set(key, rec);
  }
  return [...counts.entries()]
    .map(([template, rec]) => ({ template, ...rec }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function dedupe(entries) {
  if (!entries.length) return entries;
  const out = [];
  let lastKey = null;
  let lastEntry = null;
  let streak = 0;
  for (const e of entries) {
    const key = normalizeMessage(e.message);
    if (key === lastKey) {
      streak++;
      continue;
    }
    if (lastEntry) {
      if (streak > 1) {
        out.push({ ...lastEntry, message: lastEntry.message + ` (×${streak})` });
      } else {
        out.push(lastEntry);
      }
    }
    lastEntry = e;
    lastKey = key;
    streak = 1;
  }
  if (lastEntry) {
    if (streak > 1) out.push({ ...lastEntry, message: lastEntry.message + ` (×${streak})` });
    else out.push(lastEntry);
  }
  return out;
}

function bucketEvents(entries, bucketMs) {
  const buckets = new Map();
  for (const e of entries) {
    const ts = parseTs(e.timestamp);
    if (!ts) continue;
    const key = Math.floor(ts.getTime() / bucketMs) * bucketMs;
    const rec = buckets.get(key) || { start: new Date(key), debug: 0, info: 0, warn: 0, error: 0, fatal: 0, total: 0 };
    if (rec[e.level] !== undefined) rec[e.level]++;
    rec.total++;
    buckets.set(key, rec);
  }
  return [...buckets.values()].sort((a, b) => a.start - b.start);
}

function formatOutput(entries, format) {
  if (format === 'json') {
    return JSON.stringify(entries, null, 2);
  }
  if (format === 'ndjson') {
    return entries.map((e) => JSON.stringify(e)).join('\n');
  }
  if (format === 'csv') {
    const header = 'timestamp,level,message';
    const rows = entries.map((e) => {
      const msg = String(e.message || '').replace(/"/g, '""');
      return '"' + (e.timestamp || '') + '","' + e.level + '","' + msg + '"';
    });
    return header + '\n' + rows.join('\n');
  }
  return entries.map((e) => {
    const ts = e.timestamp || '';
    return ts + ' [' + (e.level || '').toUpperCase() + '] ' + e.message;
  }).join('\n');
}

module.exports = {
  parseLine,
  parseFile,
  parseString,
  filterByLevel,
  filterAtLeast,
  filterByTime,
  filterByPattern,
  invertFilter,
  countByLevel,
  parseTimeOffset,
  topMessages,
  dedupe,
  bucketEvents,
  normalizeMessage,
  formatOutput,
  LEVELS,
  LEVEL_WEIGHT,
};
