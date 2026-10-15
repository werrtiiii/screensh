let database;
function open() {
  return database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('screensh-images', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(request.error); };
  });
}
export async function readCachedImage(key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('images').objectStore('images').get(key);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function saveCachedImage(key, data) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('images', 'readwrite');
    transaction.objectStore('images').put(data, key);
    transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}
