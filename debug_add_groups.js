import puppeteer from 'puppeteer-core';

const TEST_GROUP = 'https://www.facebook.com/groups/1218690973466093/';

async function clickComposerButton(page) {
  return page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
    const CLAVES = [
      'escribe algo', 'escribir algo', 'write something', 'publicá algo', 'publica algo',
      'publicar algo', 'vender algo', 'crear publicación', 'crear publicacion',
      'crea una publicación', 'crea una publicacion', 'añadir algo', 'añade algo',
      'agregar algo', 'algo en mente', "what's on your mind", 'create post', 'comparte algo',
    ];
    let best = null;
    for (const el of document.querySelectorAll('div[role="button"], span[role="button"], button')) {
      if (!vis(el)) continue;
      if (el.closest('[role="article"]') || el.closest('[role="feeditem"]')) continue;
      const t = norm(el.getAttribute('aria-label')) || norm(el.innerText) || '';
      if (!t) continue;
      if (!CLAVES.some((k) => t.includes(k))) continue;
      const len = (el.innerText || '').length;
      if (!best || len < best.len) best = { el, len };
    }
    if (!best) return false;
    best.el.click();
    return true;
  });
}

async function findComposer(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const cands = Array.from(document.querySelectorAll('[contenteditable="true"], div[role="textbox"][contenteditable]'))
      .filter(el => vis(el));

    const isComment = (el) => {
      const label = norm(el.getAttribute('aria-label')) + ' ' + norm(el.getAttribute('aria-placeholder')) + ' ' + norm(el.getAttribute('data-placeholder'));
      if (/comentas como|comentar como|comentario|escrib[eí] un coment|respond[eí]|reply|comenta como/.test(label)) return true;
      if (el.closest('[role="article"]') || el.closest('[role="feeditem"]')) return true;
      return false;
    };

    const postCands = cands.filter(el => !isComment(el));
    const byPh = postCands.filter(el => {
      const label = norm(el.getAttribute('aria-placeholder')) + ' ' + norm(el.getAttribute('data-placeholder')) + ' ' + norm(el.getAttribute('aria-label'));
      return /escrib[eí]|public[aá]|comparte|write something|compartir|algo/.test(label);
    });

    const enDialogo = (el) => !!el.closest('[role="dialog"]');
    const pick = byPh.find(enDialogo) || byPh[0] || postCands.find(enDialogo) || postCands[0] || null;
    if (!pick) return null;
    pick.dataset.pgpComposer = '1';
    pick.scrollIntoView({ block: 'center' });
    const r = pick.getBoundingClientRect();
    return {
      x: r.left + r.width / 2,
      y: r.top + Math.min(r.height / 2, 24),
      label: (pick.getAttribute('aria-label') || pick.getAttribute('aria-placeholder') || pick.tagName).slice(0, 50),
      ariaLabel: pick.getAttribute('aria-label'),
      placeholder: pick.getAttribute('aria-placeholder'),
      inDialog: !!pick.closest('[role="dialog"]'),
    };
  });
}

async function debugAddGroupsButton(port, label) {
  console.log('\n========== ' + label + ' (puerto ' + port + ') ==========');
  const browser = await puppeteer.connect({ browserURL: 'http://localhost:' + port, defaultViewport: null, protocolTimeout: 30000 });
  const pages = await browser.pages();
  const page = pages[0];

  await page.goto(TEST_GROUP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 8000));

  // Check if we're on the group page
  const url = page.url();
  console.log('URL actual:', url);
  
  // Check if login is required
  const loginRequired = await page.evaluate(() => {
    const t = (document.body ? document.body.innerText : '').toLowerCase();
    const campos = document.querySelectorAll('input[type="password"], input[name="pass"], input[name="email"]').length;
    return campos > 0 && /inicia sesi[oó]n|iniciar sesi[oó]n|log in|log into|contrase[nñ]a|password/.test(t);
  });
  console.log('Login required:', loginRequired);

  // 1. Click botón "Escribe algo..."
  console.log('Clicando botón compositor...');
  const clicked = await clickComposerButton(page);
  console.log('Clickeado:', clicked);
  await new Promise(r => setTimeout(r, 5000));

  // 2. Find composer
  const composer = await findComposer(page);
  console.log('Compositor:', composer);
  if (!composer) { 
    // Debug: dump all contenteditables
    const debug = await page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none'; };
      const cands = Array.from(document.querySelectorAll('[contenteditable="true"], div[role="textbox"][contenteditable]')).filter(el => vis(el));
      return cands.map(el => ({
        tag: el.tagName,
        ariaLabel: el.getAttribute('aria-label'),
        placeholder: el.getAttribute('aria-placeholder'),
        dataPlaceholder: el.getAttribute('data-placeholder'),
        inArticle: !!el.closest('[role="article"]'),
        inFeedItem: !!el.closest('[role="feeditem"]'),
        inDialog: !!el.closest('[role="dialog"]'),
        text: (el.innerText || '').slice(0, 50)
      }));
    });
    console.log('Debug contenteditables:', JSON.stringify(debug, null, 2));
    await browser.disconnect(); 
    return; 
  }

  // 3. Click en compositor y escribir texto
  await page.mouse.click(composer.x, composer.y);
  await new Promise(r => setTimeout(r, 1000));
  await page.keyboard.type('Texto de prueba para debug');
  await new Promise(r => setTimeout(r, 1000));

  // 4. Buscar TODOS los botones visibles con role="button"
  console.log('\n--- TODOS los botones role="button" visibles ---');
  const allButtons = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    const btns = [];
    for (const el of document.querySelectorAll('div[role="button"], span[role="button"], button')) {
      if (!vis(el)) continue;
      const text = (el.textContent || el.innerText || '').trim();
      const aria = el.getAttribute('aria-label') || '';
      const dis = el.getAttribute('aria-disabled');
      const r = el.getBoundingClientRect();
      if (text || aria) {
        btns.push({ 
          text: text.slice(0, 60), 
          aria: aria.slice(0, 60), 
          dis, 
          w: Math.round(r.width), 
          h: Math.round(r.height),
          area: Math.round(r.width * r.height)
        });
      }
    }
    return btns;
  });
  console.log(JSON.stringify(allButtons, null, 2));

  // 5. Buscar específicamente botones que contengan "grupo" o "añadir" o "agregar"
  console.log('\n--- Botones con "grupo", "añadir", "agregar", "add" ---');
  const groupButtons = allButtons.filter(b => 
    b.text.toLowerCase().includes('grupo') || 
    b.text.toLowerCase().includes('añadir') || 
    b.text.toLowerCase().includes('agregar') ||
    b.text.toLowerCase().includes('add') ||
    b.aria.toLowerCase().includes('grupo') || 
    b.aria.toLowerCase().includes('añadir') || 
    b.aria.toLowerCase().includes('agregar') ||
    b.aria.toLowerCase().includes('add')
  );
  console.log(JSON.stringify(groupButtons, null, 2));

  await browser.disconnect();
}

await debugAddGroupsButton(9223, 'CUENTA B');