// dtf.js — arma el archivo de impresión DTF de un diseño (PNG transparente, medida exacta, 300 dpi, mejorado con IA si hace falta).
// El trabajo pesado corre en un hilo aparte (dtf-worker.js) y de a un diseño por vez, para no trabar el sitio.
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

const jobs = new Map();   // key -> { state:'queued'|'working'|'ready'|'error', pct, info?, error? }
const queue = [];
let running = false;

function next() {
  if (running) return;
  const key = queue.shift();
  if (!key) return;
  const job = jobs.get(key);
  running = true; job.state = 'working'; job.pct = 1;
  const part = job.out + '.part';
  let finished = false;
  const end = (err, info) => {
    if (finished) return; finished = true; clearTimeout(timer); running = false;
    if (err) { job.state = 'error'; job.error = err; try { fs.unlinkSync(part); } catch (e) { /* ya no está */ } }
    else {
      try { require('./fsafe').renameRetry(part, job.out); fs.writeFileSync(job.out.replace(/\.png$/, '.json'), JSON.stringify(info)); job.state = 'ready'; job.pct = 100; job.info = info; }
      catch (e) { job.state = 'error'; job.error = 'No se pudo guardar el archivo.'; }
    }
    setImmediate(next);
  };
  let w;
  try { w = new Worker(path.join(__dirname, 'dtf-worker.js'), { workerData: { ...job.spec, out: part } }); }
  catch (e) { return end('No se pudo iniciar el proceso.'); }
  const timer = setTimeout(() => { try { w.terminate(); } catch (e) { /* nada */ } end('Tardó demasiado: probá de nuevo o descargá el archivo común.'); }, 15 * 60 * 1000);
  w.on('message', (m) => {
    if (m.type === 'progress') job.pct = Math.max(job.pct, m.pct);
    else if (m.type === 'done') end(null, { width: m.width, height: m.height, dpi: m.dpi, method: m.method, srcW: m.srcW, srcH: m.srcH, wCm: job.spec.wCm });
    else if (m.type === 'error') end(m.message || 'Error al procesar la imagen.');
  });
  w.on('error', (e) => end(String(e && e.message || e)));
  w.on('exit', (c) => { if (!finished) end('El proceso se cortó (código ' + c + ').'); });
}

// spec: { src, wCm, hCm, baseW, baseH }; out: ruta final del PNG
function request(key, out, spec) {
  let job = jobs.get(key);
  if (job && (job.state === 'queued' || job.state === 'working')) return job;
  if (fs.existsSync(out)) {
    let info = null; try { info = JSON.parse(fs.readFileSync(out.replace(/\.png$/, '.json'), 'utf8')); } catch (e) { /* sin ficha */ }
    job = { state: 'ready', pct: 100, info, out, spec }; jobs.set(key, job); return job;
  }
  job = { state: 'queued', pct: 0, out, spec }; jobs.set(key, job); queue.push(key); next();
  return job;
}
const status = (key) => jobs.get(key) || null;

module.exports = { request, status };
