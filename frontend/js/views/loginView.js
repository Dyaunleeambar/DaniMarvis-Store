import { auth } from '../services/index.js';

export function render(container) {
  container.innerHTML = `
    <div class="login-view">
      <div class="login-card">
        <div class="login-logo">
          <svg width="40" height="46" viewBox="0 0 38 42" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 10 C13 5.5 16 3 19 3 C22 3 25 5.5 25 10" stroke="var(--rose)" stroke-width="1.8" stroke-linecap="round" fill="none"/>
            <rect x="4" y="10" width="30" height="28" rx="3" stroke="var(--rose)" stroke-width="1.8" fill="none"/>
            <text x="8" y="30" font-family="Georgia,serif" font-size="16" font-weight="600" fill="var(--rose)">D</text>
            <text x="18" y="30" font-family="Georgia,serif" font-size="16" font-weight="600" fill="var(--rose-light)">M</text>
          </svg>
          <h1>DaniMarvis Store</h1>
          <p class="login-subtitle">Panel de gestión</p>
        </div>
        <form id="login-form">
          <div class="form-group">
            <label for="login-username">Usuario</label>
            <input id="login-username" type="text" class="input" placeholder="Ingresa tu usuario" required autofocus />
          </div>
          <div class="form-group">
            <label for="login-password">Contraseña</label>
            <input id="login-password" type="password" class="input" placeholder="Ingresa tu contraseña" required />
          </div>
          <p id="login-error" class="login-error hidden"></p>
          <button type="submit" class="btn btn--primary btn--block">Iniciar sesión</button>
        </form>
      </div>
    </div>
  `;

  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    if (!username || !password) {
      errorEl.textContent = 'Completa todos los campos';
      errorEl.classList.remove('hidden');
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Ingresando...';

    try {
      await auth.login(username, password);
      window.navigate('#/dashboard');
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Iniciar sesión';
    }
  });
}
