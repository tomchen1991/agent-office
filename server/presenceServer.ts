import { createServer } from 'node:http';
import { createPresenceHandler } from './presenceProxy.ts';

// Nginx terminates TLS and authenticates viewers; this process binds loopback only.
const handler = createPresenceHandler({ hosts: ['office.falsita.cn', '127.0.0.1:5188'], origins: ['https://office.falsita.cn'] });
const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('ok'); return; }
  if (req.url !== '/api/office/presence') { res.writeHead(404); res.end(); return; }
  req.url = '/';
  void handler(req, res);
});
server.requestTimeout = 12000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.maxConnections = 32;
server.listen(5188, '127.0.0.1', () => console.log('Agent office backend listening on loopback:5188'));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); });
