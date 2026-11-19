// Сборка статических страниц сайта для поисковиков (Яндекс, Google).
//
// Каждый раздел получает свой адрес (/menu/, /events/birthday/, /news/<id>/…) и готовый HTML
// с заголовком, описанием, текстом и разметкой schema.org — поисковику не нужно выполнять JavaScript.
// После загрузки страницы js/site.js рисует ту же страницу «вживую» (корзина, бронь, кабинет).
//
// Запуск:  node tools/build.mjs            — данные из Supabase (меню, заведения, новости)
//          node tools/build.mjs --offline  — стартовое меню из js/seed.js, без сети (для проверки)
// Запускается в GitHub Actions (.github/workflows/build.yml) при каждом изменении и по расписанию.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../js/config.js';
import { SEED_CATEGORIES, SEED_ITEMS, SEED_VENUES, HERO_IMG } from '../js/seed.js';
import { SITE_URL, BRAND, KINDS, PAGES } from '../js/pages.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OFFLINE = process.argv.includes('--offline');
const TEMPLATE = readFileSync(join(ROOT, 'src/template.html'), 'utf8');

/* ---------- данные ---------- */
async function rest(path) {
  const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: CONFIG.SUPABASE_ANON_KEY, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}
async function loadData() {
  if (OFFLINE) {
    // заведения и новости — снимок из базы (tools/fixture.json), меню — стартовое из js/seed.js
    const fx = join(ROOT, 'tools/fixture.json');
    const f = existsSync(fx) ? JSON.parse(readFileSync(fx, 'utf8')) : {};
    return { categories: SEED_CATEGORIES, items: SEED_ITEMS, venues: f.venues || SEED_VENUES, news: f.news || [] };
  }
  const [categories, items, venues, news] = await Promise.all([
    rest('categories?select=*&order=sort'),
    rest('items?select=*&order=sort'),
    rest('venues?select=*&order=sort'),
    rest('news?select=*&published=eq.true&order=pinned.desc,created_at.desc&limit=60'),
  ]);
  if (!items.length || !venues.length) throw new Error('Пустое меню или список заведений — сборку не публикуем');
  return { categories, items, venues, news };
}

/* ---------- утилиты ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rub = (n) => `${Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/\s/g, ' ')} ₽`;
const url = (p) => SITE_URL + (p === '/' ? '/' : p + '/');
const href = (p) => (p === '/' ? '/' : p + '/');
const fmtDate = (iso, opt = { day: 'numeric', month: 'long', year: 'numeric' }) => new Date(iso).toLocaleDateString('ru-RU', { ...opt, timeZone: 'Europe/Moscow' });
const cut = (s, n = 160) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const PHONE = '+7 963 302-75-95';

/* ---------- разметка schema.org ---------- */
function venueLd(v) {
  const ld = {
    '@type': ['Restaurant', 'BarOrPub'], '@id': `${SITE_URL}/#${v.id}`,
    name: `${BRAND} — ${v.name}`, url: SITE_URL + '/', telephone: v.phone || PHONE, image: HERO_IMG,
    servesCuisine: ['Ирландская', 'Барбекю', 'Европейская'], priceRange: '₽₽',
    address: { '@type': 'PostalAddress', streetAddress: v.address, addressLocality: v.id === 'murino' ? 'Мурино' : 'Санкт-Петербург',
      ...(v.id === 'murino' ? { addressRegion: 'Ленинградская область' } : {}), addressCountry: 'RU' },
    acceptsReservations: v.booking_enabled !== false && v.accepting !== false,
    hasMenu: url('/menu'),
  };
  if (v.accepting !== false) ld.openingHours = 'Mo-Su ' + String(v.hours || '12:00–01:00').replace('–', '-');
  return ld;
}
function crumbs(list) {
  return { '@type': 'BreadcrumbList', itemListElement: [['/', 'Главная'], ...list].map(([p, name], i) => ({ '@type': 'ListItem', position: i + 1, name, item: url(p) })) };
}
const ldScript = (graph) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>`;

/* ---------- куски страниц ---------- */
const vis = (D) => D.items.filter((x) => x.available !== false);
function dishList(items) {
  return `<div class="dishes">${items.map((x) => `<article class="dish"><div style="position:relative">${x.image_url ? `<div class="photo ph"><img src="${esc(x.image_url)}" alt="${esc(x.name)}" loading="lazy"></div>` : '<div class="photo ph" aria-hidden="true"></div>'}${x.popular ? '<span class="hit">Хит</span>' : ''}</div>
    <div class="dish-body"><span class="dish-name">${esc(x.name)}</span>${x.description ? `<span class="dish-desc">${esc(x.description)}</span>` : ''}${x.weight ? `<span class="dish-desc">${esc(x.weight)}</span>` : ''}
    <div class="dish-foot"><span class="price">${rub(x.price)}</span></div></div></article>`).join('')}</div>`;
}
function venueBlock(v) {
  return `<article class="card venue-card"><div class="between"><h3 class="h3">${esc(BRAND)} — ${esc(v.name)}</h3>${v.accepting === false ? '<span class="pill gold">скоро открытие</span>' : '<span class="pill ok">открыто</span>'}</div>
    <span style="color:var(--text-2)">${esc(v.address)}${v.id === 'murino' ? ', Мурино' : ', Санкт-Петербург'}</span>
    <span class="muted small">Ежедневно ${esc(v.hours || '12:00–01:00')}${v.zone && v.accepting !== false ? ` · доставка: ${esc(v.zone)}` : ''}</span>
    <div class="row"><a class="btn btn-ghost btn-sm" href="tel:${esc(String(v.phone || PHONE).replace(/[^+\d]/g, ''))}">${esc(v.phone || PHONE)}</a><a class="btn btn-accent btn-sm" href="/booking/">Забронировать</a></div></article>`;
}
const head = (eyebrow, h1, lead) => `<div class="stack" style="gap:8px"><span class="eyebrow accent">${esc(eyebrow)}</span><h1 class="h1">${esc(h1)}</h1>${lead ? `<p class="lead">${esc(lead)}</p>` : ''}</div>`;
const NEWS_KIND = { news: 'Новость', promo: 'Акция', event: 'Афиша' };
function newsCards(list) {
  return `<div class="grid g3">${list.map((n) => `<a class="card card-link news-card" href="/news/${esc(n.id)}/">
    ${n.image_url ? `<div class="photo ph"><img src="${esc(n.image_url)}" alt="${esc(n.title)}" loading="lazy"></div>` : '<div class="news-banner"><img src="/img/emblem.svg" alt=""></div>'}
    <div class="nb"><span class="pill ${n.kind === 'promo' ? 'gold' : ''}">${NEWS_KIND[n.kind] || 'Новость'}</span><h3 class="h3" style="font-size:19px">${esc(n.title)}</h3><p>${esc(cut(n.body, 200))}</p></div></a>`).join('')}</div>`;
}
function eventsBody(kind) {
  return `<section class="stack" style="gap:18px"><h2 class="h2">${kind ? 'Другие поводы' : 'Под какой повод'}</h2>
    <div class="grid g3">${KINDS.filter((k) => k !== kind).map((k) => `<article class="card format"><span class="em" aria-hidden="true">${k.em}</span><a class="h3" href="/events/${k.id}/" style="text-decoration:none;color:inherit">${esc(k.title)}</a><p>${esc(k.text)}</p></article>`).join('')}</div></section>
  <section class="card stack" style="gap:16px"><h2 class="h3">Что берём на себя</h2><ul class="checklist">
    <li>Банкетное меню под бюджет: сеты из смокера, микс BBQ, закуски к пиву, горячее и салаты</li>
    <li>Рассадка под ваш формат — от длинного стола до фуршета</li>
    <li>Отдельный официант и бар для вашей компании</li>
    <li>Можно принести свой торт — договоримся заранее</li>
    <li>Музыка, трансляция матча или ваш плейлист — обсудим</li>
    <li>Для компаний — счёт и закрывающие документы на юрлицо</li></ul></section>
  <section class="card stack" style="gap:10px"><h2 class="h3">Как всё устроено</h2>
    <p>Оставьте заявку на сайте или позвоните по номеру <a href="tel:+79633027595">${PHONE}</a> — это бесплатно и ни к чему не обязывает. Менеджер уточнит дату, число гостей и формат, предложит меню и посчитает смету под ваш бюджет.</p></section>`;
}

/* ---------- страницы ---------- */
function buildPages(D) {
  const venues = D.venues, items = vis(D);
  const cats = D.categories.filter((c) => items.some((x) => x.category_id === c.id));
  const open = venues.filter((v) => v.accepting !== false);
  const pv = open[0] || venues[0];
  const hits = items.filter((x) => x.popular).slice(0, 8);
  const venueLds = venues.map(venueLd);
  const pages = [];
  const add = (path, main, ld = [], extra = {}) => pages.push({ path, main, ld, ...PAGES[path], ...extra });

  add('/', `<section class="hero"><div class="hero-bg" style="background-image:url('${esc(HERO_IMG)}')"></div><div class="wrap">
      <div class="hero-tags"><span class="tag gold">Ирландский паб</span><span class="tag">Петроградка</span><span class="tag">Мурино</span><span class="tag">12:00–01:00</span></div>
      <h1 class="h1">Мясо из <em>смокера</em>, пиво и праздники, которые помнят</h1>
      <p class="lead">Ирландский паб «Патрики» в Санкт-Петербурге: брискет, копчёные крылья, бургеры и пельмени ручной лепки. Забронируйте стол, закажите доставку или соберите своих на день рождения и корпоратив.</p>
      <div class="row" style="margin-top:6px"><a class="btn btn-accent" href="/booking/">Забронировать стол</a><a class="btn btn-outline" href="/delivery/">Заказать доставку</a><a class="btn btn-ghost" href="/events/">Праздник у нас</a></div></div></section>
    <div class="wrap page">
      <section class="stack" style="gap:18px"><h2 class="h2">Хиты паба — из смокера и не только</h2>${dishList(hits.length >= 4 ? hits : items.slice(0, 8))}<a href="/menu/">Всё меню →</a></section>
      <section class="stack" style="gap:12px"><h2 class="h2">Праздники и аренда зала</h2><p class="lead">Отдаём под ваш праздник стол, часть зала или весь паб: ${KINDS.slice(0, 5).map((k) => `<a href="/events/${k.id}/">${esc(k.title.toLowerCase())}</a>`).join(', ')}.</p></section>
      ${D.news.length ? `<section class="stack" style="gap:18px"><h2 class="h2">Новости и акции</h2>${newsCards(D.news.slice(0, 3))}</section>` : ''}
      <section class="stack" style="gap:18px"><h2 class="h2">Два паба</h2><div class="grid g2">${venues.map(venueBlock).join('')}</div></section>
    </div>`, [{ '@type': 'WebSite', '@id': SITE_URL + '/#site', url: SITE_URL + '/', name: BRAND, inLanguage: 'ru' }, ...venueLds]);

  const menuMain = (delivery) => `<div class="wrap page">
    ${head(delivery ? 'Доставка' : 'Меню паба', delivery ? 'Доставка из паба' : 'Меню',
      delivery ? `Привезём горячим примерно за ${pv.eta_minutes || 45} минут по зоне «${pv.zone || 'Петроградская сторона'}». ${pv.delivery_fee ? `Доставка ${rub(pv.delivery_fee)}` : 'Доставка бесплатная'}${pv.min_order ? `, заказ от ${rub(pv.min_order)}` : ''}. Еда и безалкогольные напитки — алкоголь по закону продаём только в зале.`
        : 'Блюда из смокера, бургеры, закуски к пиву и горячее. Все позиции можно заказать с доставкой или попробовать в пабе.')}
    <nav class="chips" aria-label="Разделы меню">${cats.map((c) => `<a class="chip" href="#cat-${esc(c.id)}">${esc(c.name)}</a>`).join('')}</nav>
    ${cats.map((c) => `<section class="cat-block" id="cat-${esc(c.id)}"><h2 class="h3">${esc(c.name)}</h2>${dishList(items.filter((x) => x.category_id === c.id))}</section>`).join('')}
  </div>`;
  const menuLd = {
    '@type': 'Menu', '@id': url('/menu') + '#menu', name: 'Меню паба «Патрики»', inLanguage: 'ru',
    hasMenuSection: cats.map((c) => ({ '@type': 'MenuSection', name: c.name, hasMenuItem: items.filter((x) => x.category_id === c.id).map((x) => ({
      '@type': 'MenuItem', name: x.name, ...(x.description ? { description: x.description } : {}), ...(x.image_url ? { image: x.image_url } : {}),
      offers: { '@type': 'Offer', price: Number(x.price), priceCurrency: 'RUB' } })) })),
  };
  add('/menu', menuMain(false), [menuLd, crumbs([['/menu', 'Меню']])]);
  add('/delivery', menuMain(true), [crumbs([['/delivery', 'Доставка']])]);

  add('/booking', `<div class="wrap page" style="max-width:860px">${head('Бронь стола', 'Забронировать стол', 'Бронь бесплатная. Выберите паб, дату, время и число гостей — паб подтвердит бронь звонком или сообщением; держим стол 15 минут после назначенного времени. Компания больше 12 человек или праздник — оставьте заявку на банкет.')}
    <div class="grid g2">${venues.map(venueBlock).join('')}</div><a class="btn btn-ghost" href="/events/banquet/" style="align-self:flex-start">Заявка на банкет</a></div>`, [crumbs([['/booking', 'Бронь стола']])]);

  const evHero = (kind) => `<section class="ev-hero" style="min-height:420px"><div class="hero-bg" style="background-image:url('${esc(HERO_IMG)}')"></div><div class="in">
      ${kind ? `<a class="eyebrow accent" href="/events/" style="text-decoration:none">← Банкеты и аренда зала</a><h1 class="h1">${esc(kind.h1)}</h1><p class="lead">${esc(kind.lead)}</p>`
        : '<span class="eyebrow accent">Банкеты и аренда зала</span><h1 class="h1">Ваш праздник — в «Патрики»</h1><p class="lead">Дни рождения, корпоративы, свадьбы, выпускные и закрытые вечеринки на Петроградке и в Мурино. Отдадим под вас стол, часть зала или весь паб.</p>'}
      <div class="row"><a class="btn btn-accent" href="#ev-form">Оставить заявку</a><a class="btn btn-outline" href="tel:+79633027595">${PHONE}</a></div></div></section>`;
  add('/events', `<div class="wrap page">${evHero(null)}${eventsBody(null)}</div>`, [crumbs([['/events', 'Банкеты и аренда зала']])]);
  for (const k of KINDS) {
    add('/events/' + k.id, `<div class="wrap page">${evHero(k)}${eventsBody(k)}</div>`, [crumbs([['/events', 'Банкеты и аренда зала'], ['/events/' + k.id, k.title]]),
      { '@type': 'Service', name: k.h1, description: k.seoDesc, areaServed: 'Санкт-Петербург', provider: venueLds.map((v) => ({ '@id': v['@id'] })) }]);
  }

  add('/news', `<div class="wrap page">${head('Новости и акции', 'Что нового в пабе', 'Акции, события, трансляции и новости обоих пабов.')}
    ${D.news.length ? newsCards(D.news) : '<div class="empty">Здесь пока пусто — загляните позже.</div>'}</div>`, [crumbs([['/news', 'Новости и акции']])]);
  for (const n of D.news) {
    const p = '/news/' + n.id;
    const ld = [crumbs([['/news', 'Новости и акции'], [p, n.title]])];
    if (n.kind === 'event' && n.event_at) {
      const v = venues.find((x) => x.id === n.venue_id) || pv;
      ld.push({ '@type': 'Event', name: n.title, description: cut(n.body, 300), startDate: n.event_at, eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode', ...(n.image_url ? { image: n.image_url } : {}),
        location: { '@type': 'Place', name: `${BRAND} — ${v.name}`, address: venueLd(v).address }, organizer: { '@type': 'Organization', name: BRAND, url: SITE_URL + '/' } });
    } else {
      ld.push({ '@type': 'NewsArticle', headline: n.title, datePublished: n.created_at, dateModified: n.updated_at || n.created_at, ...(n.image_url ? { image: n.image_url } : {}),
        publisher: { '@type': 'Organization', name: BRAND, logo: { '@type': 'ImageObject', url: SITE_URL + '/img/icon-512.png' } } });
    }
    add(p, `<div class="wrap page"><article class="article"><a href="/news/" class="small" style="text-decoration:none">← Все новости и акции</a>
      <span class="pill ${n.kind === 'promo' ? 'gold' : ''}">${NEWS_KIND[n.kind] || 'Новость'}</span>
      <h1 class="h1" style="font-size:clamp(30px,4vw,48px)">${esc(n.title)}</h1>
      <span class="muted small">${n.kind === 'event' && n.event_at ? fmtDate(n.event_at, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : fmtDate(n.created_at)}</span>
      ${n.image_url ? `<div class="photo ph"><img src="${esc(n.image_url)}" alt="${esc(n.title)}"></div>` : ''}
      <div class="body">${esc(n.body)}</div>${n.ends_on ? `<span class="muted small">Действует до ${fmtDate(n.ends_on)}</span>` : ''}</article></div>`,
    ld, { title: `${n.title} — ${BRAND}`, desc: cut(n.body), lastmod: (n.updated_at || n.created_at || '').slice(0, 10), image: n.image_url });
  }

  const L = CONFIG.LEGAL;
  add('/contacts', `<div class="wrap page">${head('Контакты', 'Как нас найти', 'Два паба, одна кухня. Работаем ежедневно с 12:00 до 01:00.')}
    <div class="grid g2">${venues.map(venueBlock).join('')}</div>
    <div class="grid g3"><div class="card stack"><span class="eyebrow">Бронь и банкеты</span><a href="tel:+79633027595">${PHONE}</a></div>
      <div class="card stack"><span class="eyebrow">Почта</span><a href="mailto:${esc(L.EMAIL)}">${esc(L.EMAIL)}</a></div>
      <div class="card stack"><span class="eyebrow">Telegram</span><a href="https://t.me/PatrikiPubBot" rel="noopener">@PatrikiPubBot</a></div></div>
    <section class="card stack"><span class="eyebrow">Продавец</span><span>${esc(L.SELLER)}, ИНН ${esc(L.INN)}</span><span>${esc(L.ADDRESS)}</span></section></div>`,
  [...venueLds, crumbs([['/contacts', 'Контакты']])]);

  // служебные страницы: отдаём с кодом 200, но закрываем от индексации
  for (const p of ['/login', '/account', '/cart', '/checkout']) add(p, '', []);
  return pages;
}

/* ---------- запись ---------- */
function renderPage(pg) {
  const title = pg.title || PAGES['/'].title;
  const desc = pg.desc || PAGES['/'].desc;
  const headHtml = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    pg.noindex ? '<meta name="robots" content="noindex, follow">' : `<link rel="canonical" href="${url(pg.path)}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Патрики Паб">',
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    pg.noindex ? '' : `<meta property="og:url" content="${url(pg.path)}">`,
    `<meta property="og:image" content="${esc(pg.image || HERO_IMG)}">`,
    '<meta property="og:locale" content="ru_RU">',
  ].filter(Boolean).join('\n');
  return TEMPLATE
    .replace('{{HEAD}}', headHtml)
    .replace('{{JSONLD}}', pg.ld?.length ? ldScript(pg.ld) : '')
    .replace('{{MAIN_ATTR}}', pg.main ? ' data-prerendered="1"' : '')
    .replace('{{MAIN}}', pg.main || '<div class="pk-loader" role="status"><img src="/img/emblem.svg" alt=""><span>Разжигаем смокер…</span></div>');
}
function write(rel, content) {
  const f = join(ROOT, rel);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, content);
}

const D = await loadData();
const pages = buildPages(D);
for (const dir of ['menu', 'delivery', 'booking', 'events', 'news', 'contacts', 'login', 'account', 'cart', 'checkout']) rmSync(join(ROOT, dir), { recursive: true, force: true });
for (const pg of pages) write(pg.path === '/' ? 'index.html' : pg.path.slice(1) + '/index.html', renderPage(pg));
// 404.html: GitHub Pages отдаёт его на любой неизвестный адрес — /order/<id>/, /pay-test/<id>/ и опечатки
write('404.html', renderPage({ path: '/404', title: 'Патрики Паб', desc: PAGES['/'].desc, noindex: true, main: '' }));

const indexable = pages.filter((p) => !p.noindex);
const newsLast = D.news.map((n) => (n.updated_at || n.created_at || '').slice(0, 10)).sort().pop();
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexable.map((p) => `  <url><loc>${url(p.path)}</loc>${(p.lastmod || (p.path === '/news' && newsLast)) ? `<lastmod>${p.lastmod || newsLast}</lastmod>` : ''}<changefreq>${p.path.startsWith('/news') ? 'weekly' : p.path === '/' || p.path === '/menu' || p.path === '/delivery' ? 'daily' : 'monthly'}</changefreq><priority>${p.path === '/' ? '1.0' : p.path.split('/').length > 2 ? '0.6' : '0.8'}</priority></url>`).join('\n')}
</urlset>
`);
write('robots.txt', `User-agent: *
Allow: /
Disallow: /cart/
Disallow: /checkout/
Disallow: /account/
Disallow: /login/
Disallow: /order/
Disallow: /pay-test/
Disallow: /*?demo
Clean-param: pay&demo

Sitemap: ${SITE_URL}/sitemap.xml
`);
console.log(`Готово: ${pages.length} страниц (${indexable.length} в sitemap), новостей ${D.news.length}, блюд ${vis(D).length}${OFFLINE ? ' [offline]' : ''}`);
