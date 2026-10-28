// Barcode-Scanner (Live-Kamera + Foto). Bibliothek wird erst beim ersten Scan geladen.
import { isbn13Valid } from './util.js';

const LIB = 'https://cdn.jsdelivr.net/npm/barcode-detector@3.1.3/dist/es/ponyfill.min.js';
let detector = null, stream = null, running = false, timer = null;
const work = document.createElement('canvas');

async function getDetector() {
  if (!detector) {
    const { BarcodeDetector } = await import(LIB);
    detector = new BarcodeDetector({ formats: ['ean_13'] });
  }
  return detector;
}

export async function startScanner(video, onCode, onInfo) {
  await stopScanner();
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
  });
  video.srcObject = stream;
  await video.play();
  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  if (caps.focusMode && caps.focusMode.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
  onInfo && onInfo('Scan-Modul wird geladen …');
  const det = await getDetector();
  running = true;
  onInfo && onInfo('Bereit. Barcode in den Rahmen halten.');
  let last = '', lastAt = 0;
  const tick = async () => {
    if (!running) return;
    try {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (vw && vh) {
        const cw = Math.round(vw * 0.9), ch = Math.round(vh * 0.5);
        work.width = cw; work.height = ch;
        work.getContext('2d', { willReadFrequently: true }).drawImage(video, Math.round((vw - cw) / 2), Math.round((vh - ch) / 2), cw, ch, 0, 0, cw, ch);
        const codes = await det.detect(work);
        if (codes.length) {
          const text = codes[0].rawValue, now = Date.now();
          if (isbn13Valid(text) && !(text === last && now - lastAt < 4000)) { last = text; lastAt = now; onCode(text); }
          else if (!isbn13Valid(text)) onInfo && onInfo('Code ' + text + ' ist keine ISBN.');
        }
      }
    } catch (e) { onInfo && onInfo('Fehler beim Auswerten: ' + (e.message || e)); }
    if (running) timer = setTimeout(tick, 120);
  };
  tick();
}

export async function stopScanner() {
  running = false;
  clearTimeout(timer);
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
}

export async function decodePhoto(file) {
  const det = await getDetector();
  const bmp = await createImageBitmap(file);
  let codes = await det.detect(bmp);
  if (!codes.length) {
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    codes = await det.detect(c);
  }
  const hit = codes.map((c) => c.rawValue).find(isbn13Valid);
  return hit || null;
}

export function beep() {
  try {
    const c = new (window.AudioContext || window.webkitAudioContext)();
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(c.destination);
    o.start(); setTimeout(() => { o.stop(); c.close(); }, 90);
  } catch { /* kein Ton */ }
  if (navigator.vibrate) navigator.vibrate(60);
}
