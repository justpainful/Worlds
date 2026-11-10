// Local synthetic identity-test mailbox. It never logs message contents.
const http = require('node:http');
const messages = new Map();
const port = Number(process.env.WORLDS_TEST_MAILBOX_PORT || 18793);
if (!Number.isInteger(port) || port < 1024 || port > 65535) process.exit(1);
const emailPattern = /^worlds-fixture-[0-9a-f-]{36}@example\.test$/;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'POST' && url.pathname === '/mail') {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { text += chunk; if (text.length > 32768) req.destroy(); });
    req.on('end', () => {
      try {
        const body = JSON.parse(text);
        const code = typeof body.text === 'string' && /Your Worlds sign-in code is ([0-9]{6})\./.exec(body.text);
        if (!emailPattern.test(body.to) || !code || messages.size >= 100) { res.writeHead(400).end(); return; }
        messages.set(body.to, code[1]); res.writeHead(204).end();
      } catch { res.writeHead(400).end(); }
    });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/code') {
    const email = url.searchParams.get('email');
    if (!email || !emailPattern.test(email)) { res.writeHead(400).end(); return; }
    const code = messages.get(email);
    if (!code) { res.writeHead(404).end(); return; }
    messages.delete(email);
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ code }));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/health') { res.writeHead(204).end(); return; }
  res.writeHead(404).end();
});
server.listen(port, '127.0.0.1');
