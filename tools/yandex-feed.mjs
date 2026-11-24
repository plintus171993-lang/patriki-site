// Прайс для Яндекс Бизнеса (YML-фид) из меню приложения + фото блюд в JPG.
//
// Что делает:
//  1. Берёт категории и блюда из Supabase (то же меню, что в приложении и на сайте).
//  2. Скачивает фото блюд и сохраняет их в img/menu/<id>.jpg (AVIF/WebP → JPG, до 1200 px).
//     Повторно скачивает только изменившиеся фото (img/menu/manifest.json).
//  3. Добавляет позиции из tools/yandex-extra.json (пиво, соусы, гарниры, бизнес-ланч, банкеты).
//  4. Пишет yandex.yml в корень сайта.
//
// В Яндекс Бизнесе: Товары и услуги → Источник → YML-фид →
//   https://raw.githubusercontent.com/plintus171993-lang/patriki-site/main/yandex.yml
// Скрытое блюдо (available=false или стоп-лист) уходит из Яндекса с атрибутом available="unknown".
//
// Запуск: node tools/yandex-feed.mjs  (нужен пакет sharp: npm i --no-save sharp)

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../js/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = 'https://raw.githubusercontent.com/plintus171993-lang/patriki-site/main';
const IMG_DIR = join(ROOT, 'img/menu');
const MANIFEST = join(IMG_DIR, 'manifest.json');
const EXTRA = JSON.parse(readFileSync(join(ROOT, 'tools/yandex-extra.json'), 'utf8'));

async function rest(path) {
  const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: CONFIG.SUPABASE_ANON_KEY, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

const xml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

const [categories, items] = await Promise.all([
  rest('categories?select=*&order=sort'),
  rest('items?select=*&order=sort'),
]);
if (!items.length) throw new Error('Пустое меню — фид не пишем');

/* ---------- фото ---------- */
let sharp = null;
try { sharp = (await import('sharp')).default; } catch { console.warn('sharp не установлен — фото не обновляю'); }
mkdirSync(IMG_DIR, { recursive: true });
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
const photo = {};
for (const it of items) {
  if (!it.image_url) continue;
  const file = `${it.id}.jpg`;
  const path = join(IMG_DIR, file);
  if (manifest[it.id] !== it.image_url || !existsSync(path)) {
    if (!sharp) continue;
    try {
      const res = await fetch(it.image_url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const jpg = await sharp(buf).rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
      writeFileSync(path, jpg);
      manifest[it.id] = it.image_url;
      console.log(`фото: ${it.name}`);
    } catch (e) { console.warn(`фото не скачалось (${it.name}): ${e.message}`); continue; }
  }
  photo[it.id] = `${RAW}/img/menu/${file}`;
}
// удалить фото блюд, которых больше нет в меню
const ids = new Set(items.map((x) => String(x.id)));
for (const f of readdirSync(IMG_DIR)) {
  const id = f.replace(/\.jpg$/, '');
  if (f.endsWith('.jpg') && !ids.has(id)) { rmSync(join(IMG_DIR, f)); delete manifest[id]; }
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + '\n');

/* ---------- категории ---------- */
const catName = new Map(categories.map((c) => [c.id, c.name]));
const catIds = new Map();
const catId = (name) => { if (!catIds.has(name)) catIds.set(name, catIds.size + 1); return catIds.get(name); };

/* ---------- позиции ---------- */
const offers = [];
for (const it of items) {
  const cat = catName.get(it.category_id) || 'Меню';
  let name = EXTRA.rename?.[it.name] || it.name;
  const pre = EXTRA.prefix?.[cat];
  if (pre && !name.toLowerCase().startsWith(pre.toLowerCase().split(' ')[0])) name = `${pre} ${lowerFirst(name)}`;
  const desc = [it.description, it.composition && `Состав: ${it.composition}`, it.weight && `Выход: ${it.weight}`].filter(Boolean).join('. ');
  const hidden = it.available === false || (Array.isArray(it.stop_in) && it.stop_in.includes('petrogradka'));
  offers.push({ id: `m-${it.id}`, name, price: it.price, cat, desc, picture: photo[it.id], hidden });
}
for (const x of EXTRA.items || []) {
  offers.push({ id: x.id, name: x.name, price: x.price, cat: x.category, desc: x.description || '', picture: x.picture, hidden: !!x.hidden });
}
for (const o of offers) catId(o.cat);

const out = `<?xml version="1.0" encoding="UTF-8"?>
<yml_catalog date="${new Date().toISOString().slice(0, 16).replace('T', ' ')}">
  <shop>
    <name>Патрики Паб</name>
    <company>ООО «ПАТРИККИ ПАБ»</company>
    <currencies><currency id="RUB" rate="1"/></currencies>
    <categories>
${[...catIds].map(([n, i]) => `      <category id="${i}">${xml(n)}</category>`).join('\n')}
    </categories>
    <offers>
${offers.map((o) => `      <offer id="${xml(o.id)}"${o.hidden ? ' available="unknown"' : ''}>
        <name>${xml(o.name)}</name>
        <vendor>Патрики Паб</vendor>
        <price>${Math.round(Number(o.price) || 0)}</price>
        <currencyId>RUB</currencyId>
        <categoryId>${catId(o.cat)}</categoryId>${o.picture ? `
        <picture>${xml(o.picture)}</picture>` : ''}${o.desc ? `
        <description>${xml(o.desc.slice(0, 3000))}</description>` : ''}
      </offer>`).join('\n')}
    </offers>
  </shop>
</yml_catalog>
`;
// дату не меняем, если состав фида тот же — чтобы не было лишних коммитов каждые 30 минут
const target = join(ROOT, 'yandex.yml');
const strip = (s) => s.replace(/<yml_catalog date="[^"]*">/, '');
if (!existsSync(target) || strip(readFileSync(target, 'utf8')) !== strip(out)) writeFileSync(target, out);
console.log(`yandex.yml: ${offers.length} позиций (${offers.filter((o) => o.picture).length} с фото, ${offers.filter((o) => o.hidden).length} скрыто), категорий ${catIds.size}`);
