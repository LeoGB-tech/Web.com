'use strict';
/*
 * Ancre 2 — serveur d'aspiration « ultra-léger ».
 * Il télécharge un site, garde seulement le contenu lisible de chaque page
 * (mode lecture), compresse le tout et l'envoie en un seul paquet au téléphone,
 * qui le stocke pour la lecture hors ligne. Le serveur ne garde rien.
 */
const express = require('express');
const compression = require('compression');
const cheerio = require('cheerio');
const { parseHTML } = require('linkedom');
const { Readability } = require('@mozilla/readability');
const crypto = require('crypto');
const path = require('path');
const { exec } = require('child_process');
let sharp = null;
try { sharp = require('sharp'); } catch { /* sans sharp : mode texte uniquement */ }

const PORT = Number(process.env.PORT) || 47321;
const ACCESS_CODE = (process.env.ACCESS_CODE || '').trim();
const VERSION = '2.0.0';
const MAX_JOBS = Number(process.env.MAX_JOBS) || 3;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const UA_ALT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0';

/* ───────────── Filtres ───────────── */

const AD_HOSTS = ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'google-analytics.com',
  'googletagmanager.com', 'googletagservices.com', 'amazon-adsystem.com', 'adnxs.com', 'criteo.com', 'criteo.net',
  'taboola.com', 'outbrain.com', 'scorecardresearch.com', 'pubmatic.com', 'rubiconproject.com', 'smartadserver.com',
  'teads.tv', 'hotjar.com', 'facebook.net', 'clarity.ms', 'mgid.com', 'onetrust.com', 'didomi.io', 'adform.net',
  'moatads.com', 'quantserve.com', 'popads.net', 'propellerads.com', 'adsterra.com', 'exoclick.com', 'ezoic.net'];
const isAdHost = (h) => { h = h.toLowerCase(); return AD_HOSTS.some((d) => h === d || h.endsWith('.' + d)); };

const AD_SELECTORS = ['ins.adsbygoogle', '[id^="google_ads"]', '[id^="div-gpt-ad"]', '[class*="adsbygoogle"]',
  '[data-ad]', '[data-ad-slot]', '[data-ad-client]', '[id^="taboola"]', '[id^="outbrain"]', '.OUTBRAIN',
  '#onetrust-consent-sdk', '#didomi-host', '.cc-window', '#CybotCookiebotDialog', '.qc-cmp2-container',
  '#cookie-banner', '.cookie-banner', '#cookie-notice', '.cookie-notice', '#tarteaucitronRoot', '#axeptio_overlay'];
const AD_TOKEN = /^(ad|ads|advert|advertisement|advertising|adsbox|adslot|adunit|adbanner|sponsored|sponsor|dfp|taboola|outbrain|ad[-_].+|.+[-_]ads?|gpt[-_]ad.*|banner[-_]ad.*|pub[-_](banner|container|slot|zone))$/i;
const PROTECTED = new Set(['html', 'head', 'body', 'main', 'article']);

const SKIP_LINK = /(\/logout|\/signout|\/deconnexion|wp-login\.php|\/wp-admin|\/wp-json|xmlrpc\.php|add-to-cart|\/cart\b|\/panier|\/checkout|replytocom=|\?share=|\/feed\/?$|\/rss\/?$|\/trackback|\/cdn-cgi\/|\/tag\/|\/author\/|[?&](sort|orderby|filter)=)/i;
const NOT_PAGE = /\.(jpe?g|png|gif|webp|avif|svg|ico|bmp|zip|rar|7z|gz|exe|msi|dmg|apk|iso|mp4|mkv|webm|avi|mov|mp3|m4a|flac|wav|ogg|woff2?|ttf|otf|css|js|json|xml|pdf|docx?|xlsx?|pptx?)$/i;
const TRACKING = /^(utm_\w+|fbclid|gclid|msclkid|mc_cid|mc_eid|_ga|_gl|igshid|ref_src)$/i;

// Balises et attributs gardés dans le contenu stocké
const KEEP_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'a', 'strong', 'b', 'em', 'i', 'u', 's', 'mark', 'sup', 'sub', 'br', 'hr', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'dl', 'dt', 'dd', 'small', 'abbr', 'q', 'cite', 'kbd']);
const KEEP_ATTRS = { a: ['href'], img: ['src', 'alt'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], ol: ['start'] };

/* ───────────── Utilitaires ───────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bare = (h) => h.toLowerCase().replace(/^www\./, '');

function cleanUrl(u) {
  const x = new URL(u);
  x.hash = '';
  for (const k of [...x.searchParams.keys()]) if (TRACKING.test(k)) x.searchParams.delete(k);
  if (![...x.searchParams.keys()].length) x.search = '';
  return x;
}
function pageKey(u) {
  const x = cleanUrl(u);
  x.hostname = bare(x.hostname);
  x.protocol = 'https:';
  x.pathname = x.pathname.replace(/\/index\.(html?|php)$/i, '/');
  if (x.pathname.length > 1 && x.pathname.endsWith('/')) x.pathname = x.pathname.slice(0, -1);
  return x.href;
}
function decodeHtml(buf, ct) {
  let cs = (/charset=["']?([\w-]+)/i.exec(ct || '') || [])[1];
  if (!cs) cs = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 4096).toString('latin1')) || [])[1];
  try { return new TextDecoder((cs || 'utf-8').toLowerCase()).decode(buf); } catch { return buf.toString('utf8'); }
}
class Semaphore {
  constructor(n) { this.n = n; this.q = []; }
  async run(fn) {
    if (this.n <= 0) await new Promise((r) => this.q.push(r));
    this.n--;
    try { return await fn(); } finally { this.n++; const nx = this.q.shift(); if (nx) nx(); }
  }
}

/* ───────────── Aspiration ───────────── */

const IMG_WIDTH = 360;
const IMG_QUALITY = 38;
const MAX_IMG_PER_PAGE = 4;
const MAX_IMG_TOTAL = 2500;

class Job {
  constructor(url, o = {}) {
    this.id = crypto.randomBytes(9).toString('base64url');
    this.mode = o.mode === 'images' && sharp ? 'images' : 'text';
    this.maxPages = Math.max(1, Math.min(3000, Number(o.maxPages) || 500));
    this.maxDepth = Math.max(0, Math.min(15, o.maxDepth === undefined ? 5 : Number(o.maxDepth)));
    this.samePath = !!o.samePath;
    this.robots = o.robots !== false;
    const start = cleanUrl(url);
    this.start = start.href;
    this.root = bare(start.hostname);
    this.prefix = this.samePath ? start.pathname.replace(/[^/]*$/, '') : '';
    this.status = 'running';
    this.queue = [];
    this.seen = new Set();
    this.taken = 0;
    this.active = 0;
    this.pages = new Map(); // clé → {url, title, html, order}
    this.alias = new Map(); // clé de redirection → clé finale
    this.order = 0;
    this.images = []; // {buf, w, h}
    this.imgIdx = new Map(); // url → index | Promise
    this.imgSem = new Semaphore(6);
    this.pending = new Set();
    this.abort = new AbortController();
    this.rules = null;
    this.stats = { pages: 0, errors: 0, textBytes: 0, imgBytes: 0 };
    this.current = '';
    this.log = [];
    this.title = '';
    this.createdAt = Date.now();
    this.finishedAt = null;
    this.pack = null;
    this.imagesBuf = null;
  }

  note(level, msg) { this.log.push({ level, msg }); if (this.log.length > 40) this.log.shift(); }

  inScope(u) {
    let x; try { x = new URL(u); } catch { return false; }
    if (!/^https?:$/.test(x.protocol) || bare(x.hostname) !== this.root) return false;
    return !this.prefix || x.pathname.startsWith(this.prefix);
  }

  async fetch(url, accept) {
    const go = (alt) => fetch(url, {
      headers: {
        'user-agent': alt ? UA_ALT : UA,
        accept: accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'fr-FR,fr;q=0.9,en;q=0.7',
        'upgrade-insecure-requests': '1',
        'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'none', 'sec-fetch-user': '?1',
      },
      redirect: 'follow',
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(25000)]),
    });
    let res = await go(false);
    if ([403, 405, 406, 429, 503].includes(res.status)) {
      try { await res.body?.cancel(); } catch {}
      await sleep(1200);
      res = await go(true);
    }
    return res;
  }

  async loadRobots() {
    if (!this.robots) return;
    try {
      const res = await this.fetch(new URL('/robots.txt', this.start).href, 'text/plain');
      if (!res.ok) return;
      const rules = []; let applies = false, inUa = false;
      for (const raw of (await res.text()).split(/\r?\n/)) {
        const m = /^([\w-]+)\s*:\s*(.*)$/.exec(raw.replace(/#.*/, '').trim());
        if (!m) continue;
        const k = m[1].toLowerCase(), v = m[2].trim();
        if (k === 'user-agent') { if (!inUa) applies = false; inUa = true; if (v === '*') applies = true; continue; }
        inUa = false;
        if (!applies || (k !== 'allow' && k !== 'disallow') || !v) continue;
        rules.push({ allow: k === 'allow', len: v.length, re: new RegExp('^' + v.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')) });
      }
      this.rules = rules;
    } catch {}
  }
  robotsOk(u) {
    if (!this.rules?.length) return true;
    const x = new URL(u), p = x.pathname + x.search;
    let best = null;
    for (const r of this.rules) if (r.re.test(p) && (!best || r.len > best.len || (r.len === best.len && r.allow))) best = r;
    return !best || best.allow;
  }

  enqueue(u, depth) {
    let k; try { k = pageKey(u); } catch { return; }
    if (this.seen.has(k) || !this.inScope(u) || SKIP_LINK.test(u) || NOT_PAGE.test(new URL(u).pathname)) return;
    this.seen.add(k);
    if (!this.robotsOk(u)) return;
    this.queue.push({ url: cleanUrl(u).href, depth });
  }

  track(p) {
    const t = p.catch(() => {}).finally(() => this.pending.delete(t));
    this.pending.add(t);
  }

  /* Image → miniature WebP (mode images) ; renvoie l'index ou -1 */
  image(abs) {
    if (this.imgIdx.has(abs)) return this.imgIdx.get(abs);
    if (this.imgIdx.size >= MAX_IMG_TOTAL) return -1;
    const slot = this.imgIdx.size;
    this.imgIdx.set(abs, slot);
    this.track(this.imgSem.run(async () => {
      if (this.abort.signal.aborted) return;
      const res = await this.fetch(abs, 'image/avif,image/webp,image/*,*/*;q=0.8');
      if (!res.ok) throw new Error('img');
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 15 * 1024 * 1024) return;
      const img = sharp(buf, { animated: false, limitInputPixels: 80e6 });
      const meta = await img.metadata();
      if (!meta.width || meta.width < 48 || meta.height < 48) return; // icônes, pixels
      const out = await img.rotate().resize({ width: IMG_WIDTH, withoutEnlargement: true })
        .webp({ quality: IMG_QUALITY, effort: 4 }).toBuffer({ resolveWithObject: true });
      this.images[slot] = { buf: out.data, w: out.info.width, h: out.info.height };
      this.stats.imgBytes += out.data.length;
    }));
    return slot;
  }

  extract(html, url) {
    const $ = cheerio.load(html);
    let base = url;
    const b = $('base[href]').attr('href');
    if (b) { try { base = new URL(b, url).href; } catch {} }

    // nettoyage des pubs avant tout
    $(AD_SELECTORS.join(',')).each((_, el) => { if (!PROTECTED.has(el.name)) $(el).remove(); });
    $('[class],[id]').each((_, el) => {
      if (PROTECTED.has(el.name)) return;
      const tokens = [...(el.attribs.class || '').split(/\s+/), el.attribs.id || ''];
      if (tokens.some((t) => t && AD_TOKEN.test(t))) $(el).remove();
    });
    $('script, style, noscript, iframe, embed, object, svg, canvas, form, input, button, select, template').remove();

    // images paresseuses
    $('img').each((_, el) => {
      const a = el.attribs;
      const lazy = a['data-src'] || a['data-lazy-src'] || a['data-original'] || a['data-lazy'];
      if (lazy && (!a.src || /^data:|placeholder|blank|lazy|spacer/i.test(a.src))) $(el).attr('src', lazy);
    });

    // liens à suivre (sur toute la page, menus compris)
    const links = [];
    $('a[href]').each((_, el) => {
      try {
        const abs = new URL(el.attribs.href, base);
        if (/^https?:$/.test(abs.protocol)) { abs.hash = ''; links.push(abs.href); }
      } catch {}
    });

    const title = ($('title').first().text() || $('h1').first().text() || '').replace(/\s+/g, ' ').trim();

    // contenu principal
    let content = '';
    let rTitle = '';
    try {
      const { document } = parseHTML($.html());
      const art = new Readability(document, { charThreshold: 250, keepClasses: false }).parse();
      if (art && art.textContent && art.textContent.trim().length > 200) { content = art.content; rTitle = art.title; }
    } catch {}
    if (!content) {
      // pages « sommaire » : on garde le corps sans les menus
      const $b = cheerio.load($('main').html() || $('[role=main]').html() || $('#content').html() || $('body').html() || '');
      $b('nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo]').remove();
      content = $b('body').html() || '';
    }
    return { title: rTitle || title, content: this.sanitize(content, base), links };
  }

  sanitize(html, base) {
    const $ = cheerio.load(html, null, false);
    const walk = (nodes) => {
      for (const el of [...nodes]) {
        if (el.type === 'comment') { $(el).remove(); continue; }
        if (el.type !== 'tag') continue;
        const tag = el.name.toLowerCase();
        if (!KEEP_TAGS.has(tag)) {
          walk(el.children || []);
          const block = /^(div|section|article|main|header|footer|aside|nav|center|details|summary)$/.test(tag);
          $(el).replaceWith((block ? ' ' : '') + ($(el).html() || '') + (block ? ' ' : ''));
          continue;
        }
        const keep = KEEP_ATTRS[tag] || [];
        for (const a of Object.keys(el.attribs)) if (!keep.includes(a)) $(el).removeAttr(a);
        if (tag === 'a') {
          const h = el.attribs.href;
          if (!h || /^(javascript:|data:|#)/i.test(h)) $(el).removeAttr('href');
          else { try { const u = new URL(h, base); if (/^(https?|mailto|tel):$/.test(u.protocol)) $(el).attr('href', u.href); else $(el).removeAttr('href'); } catch { $(el).removeAttr('href'); } }
        }
        if (tag === 'img') {
          const s = el.attribs.src;
          let abs = null;
          try { if (s && !/^data:/i.test(s)) abs = new URL(s, base).href; } catch {}
          if (!abs || isAdHost(new URL(abs).hostname)) { $(el).remove(); continue; }
          $(el).attr('src', abs);
        }
        walk(el.children || []);
      }
    };
    walk($.root().children().toArray());
    $('p, li, h1, h2, h3, h4, h5, h6, figcaption, td, th, blockquote').each((_, el) => {
      const $e = $(el);
      if (!$e.text().trim() && !$e.find('img').length) $e.remove();
    });
    return $.html().replace(/\s+/g, ' ').trim();
  }

  async processUrl({ url, depth }) {
    this.current = url;
    let res;
    try { res = await this.fetch(url); }
    catch (e) {
      if (this.abort.signal.aborted) return;
      this.stats.errors++; this.note('error', `Échec : ${url} (${e.cause?.code || e.message})`); return;
    }
    if (!res.ok) {
      try { await res.body?.cancel(); } catch {}
      this.stats.errors++;
      const why = { 403: 'accès refusé', 404: 'introuvable', 405: 'robots bloqués', 429: 'trop de requêtes', 503: 'protection anti-robot' }[res.status];
      this.note('error', `HTTP ${res.status}${why ? ' (' + why + ')' : ''} : ${url}`);
      return;
    }
    const final = res.url || url;
    if (!this.inScope(final)) { try { await res.body?.cancel(); } catch {} return; }
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct && !ct.includes('html')) { try { await res.body?.cancel(); } catch {} return; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) return;

    const out = this.extract(decodeHtml(buf, ct), final);
    const key = pageKey(final);
    if (pageKey(url) !== key) this.alias.set(pageKey(url), key);
    if (this.pages.has(key)) return;
    this.pages.set(key, { url: final, title: out.title || new URL(final).pathname, html: out.content, order: this.order++ });
    if (!this.title && (key === pageKey(this.start) || this.alias.get(pageKey(this.start)) === key)) this.title = out.title;
    this.stats.pages++;
    this.stats.textBytes += out.content.length;
    if (depth < this.maxDepth) for (const l of out.links) this.enqueue(l, depth + 1);
  }

  async worker() {
    while (!this.abort.signal.aborted && this.taken < this.maxPages) {
      const item = this.queue.shift();
      if (!item) { if (!this.active) break; await sleep(100); continue; }
      this.taken++; this.active++;
      try { await this.processUrl(item); } catch (e) { this.stats.errors++; this.note('error', e.message); }
      finally { this.active--; }
      await sleep(80);
    }
  }

  /* Liens internes → identifiants de page, images → index du paquet */
  finalize() {
    const ids = new Map();
    const list = [...this.pages.entries()].sort((a, b) => a[1].order - b[1].order);
    list.forEach(([k], i) => ids.set(k, i));
    const resolve = (u) => { try { let k = pageKey(u); k = this.alias.get(k) || k; return ids.get(k); } catch { return undefined; } };

    const pages = list.map(([, p], i) => {
      const $ = cheerio.load(p.html, null, false);
      $('a[href]').each((_, el) => {
        const href = el.attribs.href;
        let u; try { u = new URL(href); } catch { return; }
        if (!/^https?:$/.test(u.protocol)) return;
        const frag = u.hash; u.hash = '';
        const id = this.inScope(u.href) ? resolve(u.href) : undefined;
        if (id !== undefined) { $(el).removeAttr('href').attr('data-p', id + (frag ? frag : '')); }
        else if (this.inScope(u.href)) { $(el).removeAttr('href').attr('data-x', u.href); }
      });
      $('img').each((_, el) => {
        const src = el.attribs.src;
        if (this.mode !== 'images') { $(el).replaceWith(el.attribs.alt ? `<i>[image : ${$('<i>').text(el.attribs.alt).html()}]</i>` : ''); return; }
        const n = this.imgIdx.get(src);
        if (n === undefined || n < 0 || !this.images[n]) { $(el).remove(); return; }
        $(el).removeAttr('src').attr('data-i', n).attr('width', this.images[n].w).attr('height', this.images[n].h);
      });
      return { u: p.url, t: p.title, h: $.html() };
    });

    // binaire des images : [offset, longueur] dans un seul fichier
    const parts = [], index = [];
    let off = 0;
    for (const im of this.images) {
      if (!im) { index.push(null); continue; }
      index.push([off, im.buf.length]);
      parts.push(im.buf); off += im.buf.length;
    }
    this.imagesBuf = Buffer.concat(parts);
    this.pack = {
      v: 2,
      site: { url: this.start, root: this.root, title: this.title || this.root, mode: this.mode, count: pages.length, at: Date.now() },
      pages,
      imgs: index,
    };
    this.pages.clear();
    this.images = [];
  }

  async run() {
    this.note('info', `Départ : ${this.start}`);
    try {
      await this.loadRobots();
      this.seen.add(pageKey(this.start));
      this.queue.push({ url: this.start, depth: 0 });
      await Promise.all(Array.from({ length: 5 }, () => this.worker()));

      // en mode images : on télécharge celles du contenu, plafonnées par page
      if (this.mode === 'images' && !this.abort.signal.aborted) {
        this.current = 'Compression des images…';
        for (const p of this.pages.values()) {
          const $ = cheerio.load(p.html, null, false);
          $('img').slice(0, MAX_IMG_PER_PAGE).each((_, el) => { this.image(el.attribs.src); });
          $('img').slice(MAX_IMG_PER_PAGE).remove();
          p.html = $.html();
        }
        while (this.pending.size) await Promise.allSettled([...this.pending]);
      }
      this.current = 'Préparation du paquet…';
      this.finalize();
      this.status = this.pack.pages.length ? (this.abort.signal.aborted ? 'cancelled' : 'done') : 'failed';
      if (this.status === 'failed') this.note('error', 'Aucune page récupérée : le site bloque probablement les robots, ou l’adresse est inaccessible.');
      else this.note('info', `Prêt : ${this.pack.pages.length} pages.`);
    } catch (e) {
      this.status = 'failed'; this.note('error', e.message);
    }
    this.current = '';
    this.finishedAt = Date.now();
  }

  cancel() { if (this.status === 'running') { this.abort.abort(); this.note('warn', 'Arrêté : les pages déjà récupérées sont gardées.'); } }

  snapshot() {
    return {
      id: this.id, url: this.start, status: this.status, mode: this.mode, title: this.title || this.root,
      current: this.current, pages: this.stats.pages, errors: this.stats.errors, queued: this.queue.length,
      maxPages: this.maxPages, estimate: Math.round(this.stats.textBytes * 0.3 + this.stats.imgBytes),
      log: this.log.slice(-8), finishedAt: this.finishedAt,
    };
  }
}

/* ───────────── Serveur ───────────── */

const app = express();
app.disable('x-powered-by');
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: '64kb' }));

const jobs = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, j] of jobs) if ((j.finishedAt && now - j.finishedAt > 2 * 3600e3) || now - j.createdAt > 6 * 3600e3) { j.cancel(); jobs.delete(k); }
}, 60e3).unref();

app.get('/api/health', (req, res) => res.json({ app: 'ancre', version: VERSION, images: !!sharp, code: !!ACCESS_CODE }));

app.use('/api', (req, res, next) => {
  if (ACCESS_CODE && req.get('x-ancre-code') !== ACCESS_CODE) return res.status(401).json({ error: 'Code d’accès incorrect.' });
  next();
});

app.post('/api/jobs', (req, res) => {
  let url = String(req.body?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'Indique une adresse.' });
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let u; try { u = new URL(url); } catch { return res.status(400).json({ error: 'Adresse invalide.' }); }
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[)/.test(u.hostname);
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.') || (local && !process.env.ANCRE_ALLOW_LOCAL)) {
    return res.status(400).json({ error: 'Adresse invalide.' });
  }
  const running = [...jobs.values()].filter((j) => j.status === 'running').length;
  if (running >= MAX_JOBS) return res.status(429).json({ error: 'Le serveur est occupé, réessaie dans quelques minutes.' });
  const job = new Job(u.href, req.body);
  jobs.set(job.id, job);
  job.run();
  res.json(job.snapshot());
});

const getJob = (req, res) => { const j = jobs.get(req.params.id); if (!j) res.status(404).json({ error: 'Téléchargement introuvable (expiré ?).' }); return j; };

app.get('/api/jobs/:id', (req, res) => { const j = getJob(req, res); if (j) res.json(j.snapshot()); });
app.post('/api/jobs/:id/cancel', (req, res) => { const j = getJob(req, res); if (j) { j.cancel(); res.json({ ok: true }); } });
app.get('/api/jobs/:id/pack', (req, res) => {
  const j = getJob(req, res); if (!j) return;
  if (!j.pack) return res.status(409).json({ error: 'Pas encore prêt.' });
  res.json(j.pack);
});
app.get('/api/jobs/:id/images', (req, res) => {
  const j = getJob(req, res); if (!j) return;
  if (!j.pack) return res.status(409).json({ error: 'Pas encore prêt.' });
  res.type('application/octet-stream').send(j.imagesBuf || Buffer.alloc(0));
});
app.delete('/api/jobs/:id', (req, res) => { const j = jobs.get(req.params.id); if (j) { j.cancel(); jobs.delete(req.params.id); } res.json({ ok: true }); });

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) { if (/(sw\.js|index\.html|manifest\.webmanifest)$/.test(file)) res.setHeader('cache-control', 'no-cache'); },
}));

function start(port, tries = 0) {
  const srv = app.listen(port, process.env.HOST || '0.0.0.0', () => {
    const url = `http://localhost:${port}`;
    console.log(`\n  ⚓ Ancre ${VERSION} prêt : ${url}${ACCESS_CODE ? ' (code d’accès actif)' : ''}\n`);
    if (process.argv.includes('--open')) exec(process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`);
  });
  srv.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries < 20 && !process.env.PORT) start(port + 1, tries + 1);
    else { console.error('Impossible de démarrer :', e.message); process.exit(1); }
  });
}
start(PORT);
