import net from 'net';

const RHINO_PORT = 1999;
const RHINO_HOST = 'localhost';
const TIMEOUT_MS = 15000;

export function rhinoCall(type, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port: RHINO_PORT, host: RHINO_HOST });
    let buffer = '';

    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Rhino TCP timeout after ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);

    socket.on('connect', () => {
      socket.write(JSON.stringify({ type, params }) + '\n');
    });

    socket.on('data', chunk => {
      buffer += chunk.toString();
      // Try to parse as soon as we have a complete JSON object
      try {
        const result = JSON.parse(buffer.trim());
        clearTimeout(timeout);
        socket.destroy();
        resolve(result);
      } catch (_) {
        // Incomplete — keep accumulating
      }
    });

    socket.on('end', () => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(buffer.trim()));
      } catch {
        reject(new Error(`Invalid Rhino response: ${buffer.slice(0, 300)}`));
      }
    });

    socket.on('error', err => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
