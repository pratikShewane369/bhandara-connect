import { Readable } from 'node:stream';

const apiOrigin = 'http://127.0.0.1:4000';
const retryableCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'UND_ERR_SOCKET']);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export function resilientApiProxy() {
  return {
    name: 'resilient-dev-api-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();

        void (async () => {
          const chunks = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const body = Buffer.concat(chunks);
          const headers = { ...req.headers };
          delete headers.host;
          delete headers.connection;
          delete headers['content-length'];
          delete headers['transfer-encoding'];

          let upstream;
          for (let attempt = 0; attempt < 40; attempt += 1) {
            try {
              const options = { method: req.method, headers, signal: AbortSignal.timeout(30_000) };
              if (req.method !== 'GET' && req.method !== 'HEAD' && body.length) options.body = body;
              upstream = await fetch(new URL(req.url, apiOrigin), options);
              break;
            } catch (error) {
              const code = error.cause?.code;
              if (!retryableCodes.has(code) || attempt === 39 || res.destroyed) throw error;
              await wait(250);
            }
          }

          if (!upstream) throw new Error('API did not recover from its restart');
          res.statusCode = upstream.status;
          upstream.headers.forEach((value, key) => {
            if (!['connection', 'transfer-encoding', 'set-cookie'].includes(key.toLowerCase())) res.setHeader(key, value);
          });
          if (typeof upstream.headers.getSetCookie === 'function') {
            const cookies = upstream.headers.getSetCookie();
            if (cookies.length) res.setHeader('set-cookie', cookies);
          } else if (upstream.headers.has('set-cookie')) {
            res.setHeader('set-cookie', upstream.headers.get('set-cookie'));
          }
          if (!upstream.body) return res.end();
          Readable.fromWeb(upstream.body).pipe(res);
        })().catch(() => {
          if (res.destroyed || res.headersSent) return res.destroy();
          res.statusCode = 503;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ success: false, message: 'The API is restarting. Please retry in a moment.' }));
        });
      });
    }
  };
}
