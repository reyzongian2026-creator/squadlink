// Each origin keeps its own cartridges across visits and application updates.
export async function accessCartridge(factory, game, bytes) {
  const database = await new Promise((resolve, reject) => {
    const request = factory.open('squadlink-arcade', 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore('cartridges');
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Almacenamiento local ocupado.'));
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('cartridges', bytes ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('cartridges');
      const request = bytes ? store.put(bytes, game) : store.get(game);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || new Error('Almacenamiento local no disponible.'));
    });
  } finally {
    database.close();
  }
}
