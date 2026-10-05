/**
 * Subida reanudable directa a Google Drive, para archivos grandes (hasta
 * 10 GB): el backend abre la sesión (valida acceso y espacio) y el navegador
 * manda el archivo a esa dirección en partes, sin pasar por el servidor de
 * la intranet. Si una parte falla (corte de red, error de Google) se pregunta
 * hasta dónde llegó y se sigue desde ahí.
 */

/** Tamaño de cada parte: Google exige múltiplos de 256 KB. */
const CHUNK_BYTES = 64 * 256 * 1024; // 16 MB
const MAX_RETRIES = 6;

interface ChunkResponse {
  status: number;
  body: string;
  range: string | null;
}

class RetryableError extends Error {}

/** Devuelve el recurso del archivo creado en Drive (con su id). */
export async function uploadToDrive(
  uploadUrl: string,
  file: File,
  onProgress: (sentBytes: number) => void,
): Promise<{ id: string }> {
  let offset = 0;
  let failures = 0;
  for (;;) {
    const end = Math.min(offset + CHUNK_BYTES, file.size);
    try {
      const res = await putChunk(uploadUrl, file, offset, end, (loaded) => onProgress(offset + loaded));
      if (res.status === 200 || res.status === 201) {
        onProgress(file.size);
        return JSON.parse(res.body) as { id: string };
      }
      if (res.status === 308) {
        // "Seguí": Range dice hasta qué byte llegó (si el navegador deja leerlo).
        offset = nextOffset(res.range, end);
        failures = 0;
        onProgress(offset);
        continue;
      }
      if (res.status === 404 || res.status === 410) {
        throw new Error('La subida a Google venció. Volvé a intentarlo.');
      }
      if (res.status === 0 || res.status === 429 || res.status >= 500) throw new RetryableError(`Google respondió ${res.status}`);
      throw new Error(`Google rechazó el archivo (${res.status}).`);
    } catch (err) {
      if (!(err instanceof RetryableError) || ++failures > MAX_RETRIES) {
        if (err instanceof RetryableError) throw new Error('Se cortó la conexión con Google varias veces. Volvé a intentarlo.');
        throw err;
      }
      // Espera creciente (1, 2, 4… s) y se pregunta hasta dónde llegó.
      await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** (failures - 1))));
      const status = await queryStatus(uploadUrl, file.size);
      if (status && (status.status === 200 || status.status === 201)) {
        onProgress(file.size);
        return JSON.parse(status.body) as { id: string };
      }
      if (status?.status === 308 && status.range) offset = nextOffset(status.range, offset);
    }
  }
}

/** Byte siguiente al último recibido según "Range: bytes=0-N"; si no se puede leer, lo enviado. */
function nextOffset(range: string | null, fallback: number): number {
  const m = range?.match(/bytes=0-(\d+)/);
  return m ? Number(m[1]) + 1 : fallback;
}

/** Pregunta a Google cuánto recibió (un PUT vacío con el total); null si no responde. */
async function queryStatus(uploadUrl: string, size: number): Promise<ChunkResponse | null> {
  try {
    return await send(uploadUrl, null, `bytes */${size}`);
  } catch {
    return null;
  }
}

function putChunk(uploadUrl: string, file: File, start: number, end: number, onLoaded: (loaded: number) => void): Promise<ChunkResponse> {
  return send(uploadUrl, file.slice(start, end), `bytes ${start}-${end - 1}/${file.size}`, onLoaded);
}

/** XHR y no fetch: fetch no informa el progreso de lo que se envía. */
function send(uploadUrl: string, body: Blob | null, contentRange: string, onLoaded?: (loaded: number) => void): Promise<ChunkResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Range', contentRange);
    if (onLoaded) xhr.upload.onprogress = (e) => onLoaded(e.loaded);
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText, range: xhr.getResponseHeader('Range') });
    // Sin respuesta (red caída, CORS): se reintenta.
    xhr.onerror = () => reject(new RetryableError('Sin conexión con Google'));
    xhr.ontimeout = () => reject(new RetryableError('Google no respondió'));
    xhr.send(body);
  });
}
