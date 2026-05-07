const http = require('http');
const https = require('https');

const TARGET = new URL('http://154.219.117.74:3000');
const PORT = 3000;

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    });
    return res.end();
  }

  const upstreamPath = req.url || '/';
  const options = {
    protocol: TARGET.protocol,
    hostname: TARGET.hostname,
    port: TARGET.port || (TARGET.protocol === 'https:' ? 443 : 80),
    method: req.method,
    path: upstreamPath,
    headers: { ...req.headers, host: TARGET.host },
  };

  delete options.headers.origin;
  delete options.headers.referer;

  const client = TARGET.protocol === 'https:' ? https : http;
  const pReq = client.request(options, (pRes) => {
    const headers = { ...pRes.headers };
    headers['access-control-allow-origin'] = '*';
    headers['access-control-allow-headers'] = 'Content-Type, Authorization, x-api-key, anthropic-version';
    headers['access-control-allow-methods'] = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';

    res.writeHead(pRes.statusCode || 502, headers);
    pRes.pipe(res);
  });

  pReq.on('error', (e) => {
    res.writeHead(502, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ error: 'proxy_error', message: String(e) }));
  });

  req.pipe(pReq);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[proxy] http://127.0.0.1:${PORT} -> ${TARGET.origin}`);
});
