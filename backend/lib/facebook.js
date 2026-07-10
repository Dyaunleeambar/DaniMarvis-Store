const GRAPH_API = 'https://graph.facebook.com/v22.0';

export async function publishToFacebook(pageId, accessToken, { message, imageUrl }) {
  if (!pageId || !accessToken) {
    throw new Error('Facebook no configurado. Configurá Page ID y Access Token en Ajustes.');
  }
  if (!message) {
    throw new Error('El mensaje es obligatorio para publicar.');
  }

  if (imageUrl) {
    const url = `${GRAPH_API}/${pageId}/photos`;
    const body = new URLSearchParams({
      url: imageUrl,
      message,
      access_token: accessToken,
      published: 'true'
    });

    const res = await fetch(url, { method: 'POST', body });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Error al publicar en Facebook');
    return { id: data.id, platform: 'facebook', post_url: `https://facebook.com/${pageId}/posts/${data.id}` };
  }

  const url = `${GRAPH_API}/${pageId}/feed`;
  const body = new URLSearchParams({
    message,
    access_token: accessToken,
    published: 'true'
  });

  const res = await fetch(url, { method: 'POST', body });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Error al publicar en Facebook');
  return { id: data.id, platform: 'facebook', post_url: `https://facebook.com/${pageId}/posts/${data.id}` };
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
