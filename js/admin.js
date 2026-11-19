// Админка меню на сайте (/admin/): цены, фото, наличие, новые блюда.
// Те же права и та же база, что у админки приложения: правит владелец (таблица admins, venue_id пустой).
// Модуль грузится только на /admin/ — гостям его код не нужен.
let ctx, root, A;

export function mount(el, c) {
  ctx = c; root = el;
  A = A || { state: 'check', menu: null, me: null, cat: 'all', q: '', busy: {} };
  draw();
  if (A.state === 'check' && !A.checking) { A.checking = true; check(); }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rub = (n) => `${Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/,/g, ' ')} ₽`;
const thumb = (url, alt = '') => url
  ? `<div class="photo ph adm-thumb"><img src="${esc(url)}" alt="${esc(alt)}" loading="lazy" onerror="this.remove()"></div>`
  : '<div class="photo ph adm-thumb adm-nophoto" aria-hidden="true"><span>нет фото</span></div>';

async function check() {
  try {
    if (await ctx.store.isAdmin()) {
      A.me = await ctx.store.myAdmin();
      if (!A.me?.owner) { A.state = 'not-owner'; return draw(); }
      await loadMenu(); A.state = 'ready';
    } else A.state = 'login';
  } catch (e) { console.error(e); A.state = 'login'; }
  draw();
}
async function loadMenu() {
  A.menu = await ctx.store.getMenu();
  ctx.onMenu(A.menu);
}

function draw() {
  if (!root?.isConnected) return;
  root.innerHTML = A.state === 'check' ? ctx.loader('Проверяем доступ…')
    : A.state === 'login' ? Login()
    : A.state === 'not-owner' ? NotOwner()
    : Editor();
}

function Login() {
  return `<div class="login-box">
    <div class="stack" style="gap:8px;align-items:center;text-align:center"><img src="/img/emblem.svg" width="86" height="86" alt=""><h1 class="h2">Админка меню</h1>
      <p class="muted" style="margin:0">Вход для владельца — те же почта и пароль, что в админке приложения.</p></div>
    <form id="adm-login" class="stack" style="gap:14px">
      <label class="field">Почта<input class="input" name="email" type="email" autocomplete="username" required></label>
      <label class="field">Пароль<input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <p class="error" role="alert"></p>
      <button class="btn btn-accent btn-block" type="submit">Войти</button>
    </form></div>`;
}
function NotOwner() {
  return `<div class="login-box"><h1 class="h2">Нет доступа к меню</h1>
    <p class="muted">Цены, фото и новые блюда меняет владелец. Управляющий может ставить блюда на стоп в админке приложения.</p>
    <button type="button" class="btn btn-ghost" data-adm="logout">Выйти</button></div>`;
}

function Editor() {
  const m = A.menu, q = A.q.trim().toLowerCase();
  const cats = m.categories.filter((c) => A.cat === 'all' || c.id === A.cat);
  const match = (x) => !q || x.name.toLowerCase().includes(q);
  const total = m.items.length, noPhoto = m.items.filter((x) => !x.image_url).length;
  return `<div class="stack" style="gap:20px">
    <div class="between">
      <div class="stack" style="gap:6px"><span class="eyebrow accent">Админка</span><h1 class="h1" style="font-size:clamp(30px,4vw,44px)">Меню</h1>
        <span class="muted small">${total} блюд${noPhoto ? ` · без фото: ${noPhoto}` : ''} · изменения сразу видны на сайте и в приложении</span></div>
      <div class="row"><button type="button" class="btn btn-accent" data-adm="new">+ Новое блюдо</button><button type="button" class="btn btn-ghost btn-sm" data-adm="logout">Выйти</button></div>
    </div>
    <div class="row" style="gap:10px">
      <input class="input" id="adm-q" type="search" placeholder="Найти блюдо" value="${esc(A.q)}" style="max-width:320px">
      <div class="row" style="gap:6px">${[['all', 'Все'], ...m.categories.map((c) => [c.id, c.name])].map(([id, l]) => `<button type="button" class="chip" data-adm="cat" data-v="${esc(id)}" aria-pressed="${A.cat === id}">${esc(l)}</button>`).join('')}</div>
    </div>
    ${cats.map((c) => {
      const list = m.items.filter((x) => x.category_id === c.id && match(x));
      if (!list.length && q) return '';
      return `<section class="card stack" style="gap:0;padding:8px 18px">
        <div class="between" style="padding:10px 0"><span class="h3">${esc(c.name)}</span><button type="button" class="btn btn-ghost btn-sm" data-adm="new" data-cat="${esc(c.id)}">+ Блюдо в раздел</button></div>
        ${list.map(Row).join('') || '<div class="muted small" style="padding:12px 0">В разделе пока нет блюд</div>'}
      </section>`;
    }).join('')}
  </div>`;
}
function Row(x) {
  const b = A.busy[x.id];
  return `<div class="adm-row${x.available === false ? ' off' : ''}" data-id="${esc(x.id)}">
    <label class="adm-photo" title="Заменить фото">${thumb(x.image_url, x.name)}<input type="file" accept="image/*" class="sr-only" data-adm-file="${esc(x.id)}"><span class="adm-photo-hint">${b === 'photo' ? 'Загружаем…' : 'Сменить фото'}</span></label>
    <div class="stack" style="gap:2px;min-width:0;flex:1">
      <button type="button" class="adm-name" data-adm="edit" data-id="${esc(x.id)}">${esc(x.name)}</button>
      <span class="muted small">${[x.weight, x.popular ? '★ хит' : '', x.available === false ? 'не в наличии' : ''].filter(Boolean).join(' · ') || '&nbsp;'}</span>
    </div>
    <label class="adm-price"><input class="input" inputmode="numeric" data-adm-price="${esc(x.id)}" value="${esc(x.price)}" aria-label="Цена ${esc(x.name)}"><span>₽</span></label>
    <span class="adm-saved" aria-live="polite">${b === 'saved' ? '✓' : b === 'saving' ? '…' : ''}</span>
    <button type="button" class="btn btn-ghost btn-sm" data-adm="edit" data-id="${esc(x.id)}">Изменить</button>
  </div>`;
}

/* ---------- сохранение ---------- */
async function patchItem(id, patch, okMsg) {
  const x = A.menu.items.find((i) => i.id === id); if (!x) return;
  A.busy[id] = 'saving'; draw();
  try {
    const saved = await ctx.store.saveItem({ id, ...patch });
    Object.assign(x, saved || patch);
    A.busy[id] = 'saved'; ctx.onMenu(A.menu); draw();
    if (okMsg) ctx.toast(okMsg);
    setTimeout(() => { if (A.busy[id] === 'saved') { delete A.busy[id]; draw(); } }, 1800);
  } catch (e) {
    console.error(e); delete A.busy[id]; draw();
    ctx.toast(/permission|policy|rls/i.test(e.message || '') ? 'Нет прав: войдите как владелец' : 'Не сохранилось — проверьте интернет', 4000);
  }
}
async function upload(file) {
  if (file.size > 15 * 1024 * 1024) throw new Error('Фото больше 15 МБ');
  return ctx.store.uploadImage(await shrink(file));
}
// Уменьшаем фото до 1200 px перед загрузкой, чтобы меню грузилось быстро
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 600 * 1024) return file;
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
  } catch { return file; }
}

/* ---------- карточка блюда: изменить / добавить ---------- */
function itemModal(item, catId) {
  const m = A.menu;
  const x = item || { name: '', price: '', weight: '', description: '', composition: '', nutrition: '', allergens: '', image_url: '', category_id: catId || (A.cat !== 'all' ? A.cat : m.categories[0]?.id), available: true, popular: false };
  let imageUrl = x.image_url || '';
  const wrap = document.createElement('div'); wrap.className = 'modal-wrap';
  wrap.innerHTML = `<form class="modal" id="adm-item" role="dialog" aria-modal="true" aria-label="${item ? 'Изменить блюдо' : 'Новое блюдо'}" style="position:relative">
    <button type="button" class="icon-btn x" data-x="close" aria-label="Закрыть">✕</button>
    <div id="adm-prev">${imageUrl ? `<div class="photo"><img src="${esc(imageUrl)}" alt=""></div>` : '<div class="photo ph adm-nophoto" style="aspect-ratio:4/3"><span>нет фото</span></div>'}</div>
    <div class="mb">
      <h2 class="h3">${item ? 'Изменить блюдо' : 'Новое блюдо'}</h2>
      <div class="row"><label class="btn btn-ghost btn-sm" style="cursor:pointer">${imageUrl ? 'Заменить фото' : 'Загрузить фото'}<input type="file" accept="image/*" name="file" class="sr-only"></label>
        ${imageUrl ? '<button type="button" class="btn btn-ghost btn-sm" data-x="img-clear">Убрать фото</button>' : ''}</div>
      <label class="field">Название<input class="input" name="name" required maxlength="120" value="${esc(x.name)}"></label>
      <div class="form-grid">
        <label class="field">Цена, ₽<input class="input" name="price" inputmode="numeric" required value="${esc(x.price)}"></label>
        <label class="field">Вес / объём<input class="input" name="weight" placeholder="300 г" value="${esc(x.weight)}"></label>
      </div>
      <label class="field">Раздел меню<select class="select" name="category_id">${m.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === x.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label class="field">Описание для гостя<textarea class="textarea" name="description" placeholder="Коротко и вкусно">${esc(x.description)}</textarea></label>
      <label class="field">Состав<textarea class="textarea" name="composition" style="min-height:70px" placeholder="Говядина, булочка, сыр чеддер, соус…">${esc(x.composition || '')}</textarea></label>
      <div class="form-grid">
        <label class="field">КБЖУ на 100 г<input class="input" name="nutrition" placeholder="Ккал 250 · Б 15 · Ж 12 · У 20" value="${esc(x.nutrition || '')}"></label>
        <label class="field">Аллергены<input class="input" name="allergens" placeholder="Глютен, молоко" value="${esc(x.allergens || '')}"></label>
      </div>
      <label class="check"><input type="checkbox" name="available" ${x.available !== false ? 'checked' : ''}><span>В наличии — можно заказать</span></label>
      <label class="check"><input type="checkbox" name="popular" ${x.popular ? 'checked' : ''}><span>Показывать в «Хитах паба» на главной</span></label>
      <p class="error" role="alert"></p>
      <div class="row"><button type="submit" class="btn btn-accent">${item ? 'Сохранить' : 'Добавить в меню'}</button><button type="button" class="btn btn-ghost" data-x="close">Отмена</button>
        ${item ? '<button type="button" class="btn btn-danger btn-sm" data-x="delete" style="margin-left:auto">Удалить блюдо</button>' : ''}</div>
    </div></form>`;
  const form = wrap.querySelector('form'), err = wrap.querySelector('.error');
  const setPrev = () => { wrap.querySelector('#adm-prev').innerHTML = imageUrl ? `<div class="photo"><img src="${esc(imageUrl)}" alt=""></div>` : '<div class="photo ph adm-nophoto" style="aspect-ratio:4/3"><span>нет фото</span></div>'; };
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', async (e) => {
    if (e.target === wrap) return close();
    const b = e.target.closest('[data-x]'); if (!b) return;
    if (b.dataset.x === 'close') close();
    if (b.dataset.x === 'img-clear') { imageUrl = ''; setPrev(); }
    if (b.dataset.x === 'delete') {
      if (!confirm(`Удалить «${x.name}» из меню насовсем?\nЕсли блюдо закончилось временно — лучше снимите галочку «В наличии».`)) return;
      try { await ctx.store.deleteItem(x.id); A.menu.items = A.menu.items.filter((i) => i.id !== x.id); ctx.onMenu(A.menu); close(); draw(); ctx.toast('Блюдо удалено'); }
      catch (ex) { console.error(ex); err.textContent = 'Не удалось удалить'; }
    }
  });
  form.file.addEventListener('change', async () => {
    const f = form.file.files[0]; if (!f) return;
    err.style.color = 'var(--muted)'; err.textContent = 'Загружаем фото…';
    try { imageUrl = await upload(f); setPrev(); err.textContent = ''; }
    catch (ex) { console.error(ex); err.style.color = ''; err.textContent = ex.message?.includes('15 МБ') ? ex.message : 'Не удалось загрузить фото'; }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.style.color = '';
    const d = Object.fromEntries(new FormData(form));
    const price = parseInt(String(d.price).replace(/\D/g, ''), 10);
    if (!d.name.trim()) return (err.textContent = 'Укажите название');
    if (!price || price <= 0) return (err.textContent = 'Укажите цену');
    const row = {
      ...(item ? { id: item.id } : {}),
      name: d.name.trim(), price, weight: d.weight.trim(), description: d.description.trim(),
      composition: d.composition.trim(), nutrition: d.nutrition.trim(), allergens: d.allergens.trim(),
      category_id: d.category_id, image_url: imageUrl, available: !!d.available, popular: !!d.popular,
    };
    if (!item) row.sort = Math.max(0, ...A.menu.items.map((i) => i.sort || 0)) + 1;
    const btn = form.querySelector('[type=submit]'); btn.disabled = true;
    try {
      await ctx.store.saveItem(row);
      await loadMenu(); close();
      if (!item) { A.cat = row.category_id; A.q = ''; }
      draw(); ctx.toast(item ? 'Сохранено' : 'Блюдо добавлено в меню');
    } catch (ex) { console.error(ex); btn.disabled = false; err.textContent = 'Не удалось сохранить — проверьте интернет'; }
  });
  document.body.appendChild(wrap);
  if (!item) form.name.focus();
}

/* ---------- события (только внутри админки) ---------- */
document.addEventListener('click', async (e) => {
  if (!root?.isConnected) return;
  const b = e.target.closest('[data-adm]'); if (!b || !root.contains(b)) return;
  const a = b.dataset.adm;
  if (a === 'new') itemModal(null, b.dataset.cat);
  if (a === 'edit') itemModal(A.menu.items.find((x) => x.id === b.dataset.id));
  if (a === 'cat') { A.cat = b.dataset.v; draw(); }
  if (a === 'logout') { await ctx.store.adminSignOut(); A = { state: 'login', menu: null, me: null, cat: 'all', q: '', busy: {} }; draw(); ctx.toast('Вы вышли из админки'); }
});
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'adm-login') return;
  e.preventDefault(); e.stopImmediatePropagation();
  const f = e.target, err = f.querySelector('.error'), btn = f.querySelector('[type=submit]');
  btn.disabled = true; err.textContent = '';
  try {
    await ctx.store.adminSignIn(f.email.value.trim(), f.password.value);
    A.me = await ctx.store.myAdmin();
    if (!A.me?.owner) { A.state = 'not-owner'; return draw(); }
    await loadMenu(); A.state = 'ready'; draw();
  } catch (ex) { err.textContent = ex.message || 'Не получилось войти'; btn.disabled = false; }
}, true);
document.addEventListener('change', async (e) => {
  if (!root?.isConnected) return;
  const el = e.target;
  if (el.dataset?.admPrice) {
    const id = el.dataset.admPrice, x = A.menu.items.find((i) => i.id === id);
    const price = parseInt(String(el.value).replace(/\D/g, ''), 10);
    if (!price || price <= 0) { el.value = x.price; return ctx.toast('Цена должна быть больше нуля'); }
    if (price !== x.price) patchItem(id, { price }, `${x.name}: ${rub(price)}`);
  }
  if (el.dataset?.admFile) {
    const id = el.dataset.admFile, f = el.files[0]; if (!f) return;
    A.busy[id] = 'photo'; draw();
    try { const url = await upload(f); delete A.busy[id]; await patchItem(id, { image_url: url }, 'Фото обновлено'); }
    catch (ex) { console.error(ex); delete A.busy[id]; draw(); ctx.toast(ex.message?.includes('15 МБ') ? ex.message : 'Не удалось загрузить фото', 4000); }
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset?.admPrice) e.target.blur();
});
document.addEventListener('input', (e) => {
  if (e.target.id !== 'adm-q') return;
  A.q = e.target.value;
  const pos = e.target.selectionStart; draw();
  const q = document.getElementById('adm-q'); if (q) { q.focus(); q.setSelectionRange(pos, pos); }
});
