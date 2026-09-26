import fs from 'fs';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { resolveLocalUpload } from './imageUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GRAPH_API = 'https://graph.facebook.com/v22.0';

export class FacebookError extends Error {
  constructor(message, { code = null, isTokenExpired = false } = {}) {
    super(message);
    this.name = 'FacebookError';
    this.metaCode = code;
    this.isTokenExpired = isTokenExpired;
  }
}

function parseGraphError(text, fallback) {
  try {
    const data = JSON.parse(text);
    const err = data?.error || {};
    const message = err.message || fallback;
    const isTokenExpired = err.code === 190 || /session (has )?expired|unauthorized/i.test(message);
    return new FacebookError(message, { code: err.code || null, isTokenExpired });
  } catch {
    return new FacebookError(text?.slice(0, 200) || fallback);
  }
}

export function scheduledParams(scheduledAt) {
  if (!scheduledAt) return { published: 'true' };
  return {
    published: 'false',
    scheduled_publish_time: Math.floor(new Date(scheduledAt).getTime() / 1000)
  };
}

export async function validateFacebookToken(accessToken) {
  if (!accessToken) return { valid: false, error: 'Falta el Access Token.' };
  try {
    const url = `${GRAPH_API}/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) throw parseGraphError(text, 'Token inválido');
    const data = JSON.parse(text);
    return { valid: true, user_id: data.id, name: data.name };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

function resolveLocalImage(relPath) {
  return resolveLocalUpload(relPath);
}

function buildImageFields(productImages) {
  const urls = [];
  const files = [];
  for (const img of productImages || []) {
    if (!img) continue;
    if (/^https?:\/\//i.test(img)) {
      urls.push(img);
    } else {
      const local = resolveLocalImage(img);
      if (local) files.push(local);
    }
  }
  return { urls, files };
}

function mediaParams({ message, images = [], scheduledAt }) {
  const params = [];
  if (message) params.push(['message', message]);

  const { urls, files } = buildImageFields(images);
  for (const url of urls) params.push(['url', url]);
  for (const file of files) params.push(['source', file]);

  const sched = scheduledParams(scheduledAt);
  for (const [k, v] of Object.entries(sched)) params.push([k, v]);
  return { params, files };
}

async function graphMultipart(url, fields, files) {
  const body = new FormData();
  for (const [k, v] of fields) {
    if (k === 'source') continue;
    body.append(k, v);
  }
  // For repeated "source" fields we append each file with its own filename.
  for (const file of files) {
    const buf = fs.readFileSync(file);
    body.append('source', new Blob([buf]), basename(file));
  }
  const res = await fetch(url, { method: 'POST', body });
  const text = await res.text();
  return { res, text };
}

export async function publishToPage(pageId, accessToken, { message, images = [], scheduledAt }) {
  if (!pageId || !accessToken) {
    throw new Error('Facebook no configurado. Configurá Page ID y Access Token en Ajustes.');
  }
  if (!message) {
    throw new Error('El mensaje es obligatorio para publicar.');
  }

  let fields, files;
  try {
    const built = mediaParams({ message, images, scheduledAt });
    fields = built.params;
    files = built.files;
  } catch (err) {
    throw new FacebookError(err.message);
  }

  const endpoint = (files.length > 0 || fields.some(([k]) => k === 'url'))
    ? `${GRAPH_API}/${pageId}/photos`
    : `${GRAPH_API}/${pageId}/feed`;
  const url = `${endpoint}?access_token=${encodeURIComponent(accessToken)}`;

  let { res, text } = files.length
    ? await graphMultipart(url, fields, files)
    : await (async () => {
        const body = new URLSearchParams(fields.filter(([k]) => k !== 'source'));
        const r = await fetch(url, { method: 'POST', body });
        return { res: r, text: await r.text() };
      })();

  if (!res.ok) throw parseGraphError(text, 'Error al publicar en Facebook');

  let data;
  try { data = JSON.parse(text); } catch { data = { id: null }; }
  return {
    id: data.id,
    scheduled: !!(scheduledAt),
    post_url: data.id ? `https://facebook.com/${pageId}/posts/${data.id}` : null,
    scheduled_for: scheduledAt || null
  };
}

export async function cancelScheduledPost(pageId, accessToken, postId) {
  if (!postId) return null;
  const url = `${GRAPH_API}/${postId}?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, { method: 'DELETE' });
  const text = await res.text();
  if (!res.ok) throw parseGraphError(text, 'Error al cancelar la publicación');
  return { success: true, postId };
}

export async function publishToFacebook(pageId, accessToken, { message, imageUrl, scheduledAt }) {
  return publishToPage(pageId, accessToken, {
    message,
    images: imageUrl ? [imageUrl] : [],
    scheduledAt
  });
}

export async function publishToInstagram(instagramId, accessToken, { message, imageUrl }) {
  if (!instagramId || !accessToken) {
    throw new Error('Instagram no configurado.');
  }
  if (!imageUrl) {
    throw new Error('Instagram requiere al menos una imagen.');
  }

  const mediaUrl = `${GRAPH_API}/${instagramId}/media`;
  const mediaBody = new URLSearchParams({
    image_url: imageUrl,
    caption: message || '',
    access_token: accessToken
  });

  const mediaRes = await fetch(mediaUrl, { method: 'POST', body: mediaBody });
  const mediaData = await mediaRes.json();
  if (!mediaRes.ok) throw new Error(mediaData.error?.message || 'Error al crear media container');

  const publishUrl = `${GRAPH_API}/${instagramId}/media_publish`;
  const publishBody = new URLSearchParams({
    creation_id: mediaData.id,
    access_token: accessToken
  });

  const pubRes = await fetch(publishUrl, { method: 'POST', body: publishBody });
  const pubData = await pubRes.json();
  if (!pubRes.ok) throw new Error(pubData.error?.message || 'Error al publicar en Instagram');

  return { id: pubData.id, platform: 'instagram', post_url: `https://instagram.com/p/${pubData.id}/` };
}