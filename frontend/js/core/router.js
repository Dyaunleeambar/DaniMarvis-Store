const routes = [];
let currentCleanup = null;

export function route(pattern, handler) {
  const paramNames = [];
  const regexStr = '^' + pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:([a-zA-Z]+)/g, (_, name) => { paramNames.push(name); return '([^/]+)'; })
    + '$';
  routes.push({ pattern, regex: new RegExp(regexStr), paramNames, handler });
}

export function navigate(hash) {
  window.location.hash = hash;
}

export function initRouter(container) {
  const resolve = async () => {
    if (typeof currentCleanup === 'function') {
      currentCleanup();
      currentCleanup = null;
    }

    const fullHash = window.location.hash || '#/dashboard';
    window.scrollTo(0, 0);

    const qIndex = fullHash.indexOf('?');
    const hashPath = qIndex >= 0 ? fullHash.slice(0, qIndex) : fullHash;

    window.dispatchEvent(new CustomEvent('routeChanged', { detail: { hash: fullHash, path: hashPath } }));

    let matched = false;
    for (const { regex, paramNames, handler } of routes) {
      const match = hashPath.match(regex);
      if (match) {
        matched = true;
        const params = {};
        paramNames.forEach((n, i) => params[n] = decodeURIComponent(match[i + 1]));
        try {
          const cleanup = await handler(params, container);
          currentCleanup = cleanup || null;
        } catch (err) {
          console.error('[Router] Error:', err);
          container.innerHTML = `<div class="error-view"><h2>Error</h2><p>${err.message}</p></div>`;
        }
        break;
      }
    }

    if (!matched) {
      container.innerHTML = `
        <div class="empty-state">
          <h3>404 — Página no encontrada</h3>
          <p>La ruta <code>${fullHash}</code> no existe.</p>
          <br>
          <a href="#/dashboard" class="btn btn--primary">Ir al Dashboard</a>
        </div>`;
    }
  };

  window.addEventListener('hashchange', resolve);
  resolve();
}
