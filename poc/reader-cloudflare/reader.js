const http = require('node:http');

const ALLOWED = new Set(['www.nate.com', 'nate.com', 'www.example.com', 'example.com']);

function decodeBase64Url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}
function esc(s) {
  return String(s).replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
}
function htmlToText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/health') {
      res.writeHead(200, {'content-type':'text/plain; charset=utf-8'});
      return res.end('ok');
    }
    const m = u.pathname.match(/^\/u\/([A-Za-z0-9_-]+)$/);
    if (!m) {
      res.writeHead(404, {'content-type':'text/plain; charset=utf-8'});
      return res.end('not found');
    }
    const target = decodeBase64Url(m[1]);
    const t = new URL(target);
    if (t.protocol !== 'https:' || !ALLOWED.has(t.hostname)) {
      res.writeHead(403, {'content-type':'text/plain; charset=utf-8'});
      return res.end('target not allowed');
    }
    const upstream = await fetch(t, {
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/146 Safari/537.36',
        'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8'
      }
    });
    const raw = await upstream.text();
    const title = (raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [,''])[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    const text = htmlToText(raw).slice(0, 120000);
    const body = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title || t.hostname)}</title><meta name="robots" content="index,follow"></head><body><h1>Cloudflare Base64 Reader Test</h1><p>READER_MARKER: CF_READER_POC_20260901</p><p>TARGET: ${esc(target)}</p><p>UPSTREAM_STATUS: ${upstream.status}</p><h2>${esc(title)}</h2><main>${esc(text)}</main></body></html>`;
    res.writeHead(200, {
      'content-type':'text/html; charset=utf-8',
      'cache-control':'no-store',
      'x-reader-marker':'CF_READER_POC_20260901'
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500, {'content-type':'text/plain; charset=utf-8'});
    res.end('reader error: ' + (e && e.message ? e.message : String(e)));
  }
});

server.listen(3000, '127.0.0.1', () => console.log('reader listening on 127.0.0.1:3000'));
