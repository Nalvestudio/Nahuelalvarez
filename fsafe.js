// fsafe.js — operaciones de archivo a prueba de Windows (antivirus / OneDrive que bloquean un instante el archivo).
const fs = require('fs');

// En Windows el antivirus / OneDrive pueden tener el archivo abierto un instante y renameSync falla (EPERM/EBUSY): reintentamos.
const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) { const t = Date.now(); while (Date.now() - t < ms); } };
function renameRetry(a, b) {
  let lastErr;
  for (let i = 0; i < 12; i++) {
    try { fs.renameSync(a, b); return; } catch (e) {
      lastErr = e;
      if (!['EPERM', 'EBUSY', 'EACCES', 'ENOENT'].includes(e.code)) throw e;
      sleepSync(25 * (i + 1));
    }
  }
  // último recurso: escribir directo sobre el archivo
  try { fs.copyFileSync(a, b); try { fs.unlinkSync(a); } catch (e) { /* nada */ } } catch (e) { throw lastErr; }
}

module.exports = { renameRetry, sleepSync };
