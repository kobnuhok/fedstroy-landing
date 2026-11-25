// Cloudflare Worker: минимальный безопасный ретранслятор запросов к Telegram Bot API.
// Разверните в Cloudflare Workers (бесплатно до 100 000 запросов/день).

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (env.RELAY_SECRET && request.headers.get('X-Relay-Secret') !== env.RELAY_SECRET) {
      return new Response('Forbidden', { status: 403 });
    }

    const url = new URL(request.url);
    if (!/^\/bot[^/]+\/(sendMessage|sendDocument)$/.test(url.pathname)) {
      return new Response('Not Found', { status: 404 });
    }

    const targetUrl = `https://api.telegram.org${url.pathname}${url.search}`;
    const headers = new Headers();
    const ct = request.headers.get('content-type');
    if (ct) headers.set('content-type', ct);

    return fetch(targetUrl, {
      method: 'POST',
      headers,
      body: request.body
    });
  }
};
