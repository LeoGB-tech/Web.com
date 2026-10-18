// ⚓ Ancre — relais Cloudflare Worker
// Rôle : récupérer une page ou une image à la place de l'appli (les navigateurs
// interdisent à une page web de lire directement le contenu d'un autre site).
// Il ne stocke rien. Le bouton « Copier le code du relais » de l'appli remplit CODE pour toi.
const CODE = '__CODE__';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-expose-headers': 'x-final-url, x-status',
  'access-control-max-age': '86400',
};
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[)/i;

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const p = new URL(request.url).searchParams;

    if (p.has('ping')) {
      return new Response(JSON.stringify({ app: 'ancre-relais', v: 1, ok: p.get('k') === CODE }), {
        headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }
    if (p.get('k') !== CODE) return new Response('Code incorrect', { status: 401, headers: CORS });

    let target;
    try { target = new URL(p.get('u') || ''); } catch { return new Response('Adresse invalide', { status: 400, headers: CORS }); }
    if (!/^https?:$/.test(target.protocol) || PRIVATE.test(target.hostname)) {
      return new Response('Adresse interdite', { status: 403, headers: CORS });
    }

    const img = p.get('t') === 'img';
    const headers = {
      'user-agent': UA,
      accept: img ? 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'fr-FR,fr;q=0.9,en;q=0.7',
    };
    if (p.get('r')) headers.referer = p.get('r');

    let res;
    try { res = await fetch(target.href, { headers, redirect: 'follow' }); }
    catch (e) { return new Response('Site injoignable : ' + e.message, { status: 502, headers: CORS }); }

    const out = new Headers(CORS);
    out.set('content-type', res.headers.get('content-type') || 'application/octet-stream');
    out.set('x-final-url', res.url || target.href);
    out.set('x-status', String(res.status));
    out.set('cache-control', 'no-store');
    const noBody = [101, 204, 205, 304].includes(res.status);
    return new Response(noBody ? null : res.body, { status: res.status, headers: out });
  },
};
