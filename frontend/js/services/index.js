import { api } from '../db/api.js';
import { dbGetAll, dbPutAll, dbClear, getCacheTime, setCacheTime } from '../db/indexeddb.js';

const CACHE_TTL = 5 * 60 * 1000; // 5 min

export const auth = {
  getUser() {
    const raw = sessionStorage.getItem('dm_user');
    return raw ? JSON.parse(raw) : null;
  },
  isLoggedIn() {
    return !!sessionStorage.getItem('dm_token');
  },
  async login(username, password) {
    const { user, token } = await api.login(username, password);
    sessionStorage.setItem('dm_user', JSON.stringify(user));
    sessionStorage.setItem('dm_token', token);
    window.dispatchEvent(new Event('authChanged'));
    return user;
  },
  logout() {
    sessionStorage.removeItem('dm_user');
    sessionStorage.removeItem('dm_token');
    window.dispatchEvent(new Event('authChanged'));
  },
};

export async function loadCached(key, fetcher, storeName) {
  const lastSync = await getCacheTime(key);
  const expired = (Date.now() - lastSync) > CACHE_TTL;

  if (!expired) {
    const cached = await dbGetAll(storeName);
    if (cached.length > 0) return cached;
  }

  try {
    const data = await fetcher();
    await dbClear(storeName);
    if (data.length) await dbPutAll(storeName, data);
    await setCacheTime(key);
    return data;
  } catch (err) {
    const cached = await dbGetAll(storeName);
    if (cached.length > 0) return cached;
    throw err;
  }
}

export function invalidateCache(key) {
  return setCacheTime(key, 0);
}
