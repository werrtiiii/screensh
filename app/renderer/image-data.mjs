export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_DATA_URL_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64;
export function isImageData(value) {
  if (typeof value !== 'string' || value.length > MAX_IMAGE_DATA_URL_LENGTH || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const body = value.slice(value.indexOf(',') + 1);
  if (body.length % 4 !== 0) return false;
  const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
  return body.length / 4 * 3 - padding <= MAX_IMAGE_BYTES;
}
