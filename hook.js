#!/usr/bin/env node
// Claude Code hook: forwards a slimmed-down copy of the hook payload to the
// blob app. Always exits 0 quickly and prints nothing, so it can never slow
// down or alter a Claude Code session, even when the app isn't running.
const http = require('http');

const PORT = Number(process.env.BLOB_PORT) || 7777;
setTimeout(() => process.exit(0), 1500).unref();

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let e;
  try { e = JSON.parse(raw); } catch { process.exit(0); }

  const body = JSON.stringify({
    event: e.hook_event_name,
    session: e.session_id,
    cwd: e.cwd,
    tool: e.tool_name,
    message: e.message,
    type: e.notification_type,
  });

  const req = http.request({
    host: '127.0.0.1',
    port: PORT,
    path: '/event',
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    timeout: 500,
  }, (res) => { res.resume(); res.on('end', () => process.exit(0)); });
  req.on('error', () => process.exit(0));
  req.on('timeout', () => { req.destroy(); process.exit(0); });
  req.end(body);
});
