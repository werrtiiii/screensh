const cache = new Map();
export function avatarThumbnail(source) {
  if (!source) return Promise.resolve(null);
  if (cache.has(source)) return cache.get(source);
  const pending = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const ratio = Math.min(1, 96 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
        const context = canvas.getContext('2d');
        context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/webp', 0.85));
      } catch (error) { reject(error); }
    };
    image.onerror = () => reject(new Error('头像读取失败'));
    image.src = source;
  });
  cache.set(source, pending);
  if (cache.size > 128) cache.delete(cache.keys().next().value);
  return pending;
}
export function applyAvatarThumbnails(container) {
  for (const image of container.querySelectorAll('img[data-avatar-source]')) {
    const source = image.getAttribute('data-avatar-source');
    image.removeAttribute('data-avatar-source');
    avatarThumbnail(source).then(thumbnail => { if (image.isConnected) image.src = thumbnail; }).catch(() => image.remove());
  }
}
