import { BrowserOAuthClient } from '@atproto/oauth-client-browser';
import { Agent } from '@atproto/api';
import { toDataURL } from 'qrcode';
import jsQR from 'jsqr';

export const BADGE_BLUE_KEYS_NSID = 'com.publicdomainrelay.temp.badgeBlueKeys';

/* ── OAuth client id ── */
export function buildClientID() {
  const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  if (isLocal) {
    return `http://localhost?${new URLSearchParams({
      scope: `atproto repo:${BADGE_BLUE_KEYS_NSID}?action=create,update,delete`,
      redirect_uri: Object.assign(new URL(window.location.origin), { hostname: '127.0.0.1' }).href,
    })}`;
  }
  return `https://${window.location.host}/oauth-client-metadata.json`;
}

/* ── Utilities ── */
const ADJS = ['bold','calm','cool','dark','fair','fast','keen','lean','neat','pure','rare','safe','sharp','swift','warm','wise'];
const NOUNS = ['aurora','badge','beacon','blaze','cipher','crest','echo','falcon','glint','haven','latch','nexus','pulse','quill','ridge','sigil','spark','torch','verge','woven'];
export function randomName() {
  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
  return `${rand(ADJS)}-${rand(NOUNS)}`;
}

export function parseRkey(uri) {
  const parts = uri.split('/');
  return parts[parts.length - 1];
}

export function getHashDid() {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  if (hash.startsWith('did:key:') || hash.startsWith('did:plc:')) return hash;
  // key=value format: #plc=did:plc:... or #key=did:key:...
  const kv = hash.match(/^(?:plc|key)=(did:(?:plc|key):\S+)$/);
  if (kv) return kv[1];
  try {
    const u = new URL(hash);
    const inner = u.hash.slice(1);
    if (inner.startsWith('did:key:') || inner.startsWith('did:plc:')) return inner;
    // key=value inside a URL's inner hash
    const innerKv = inner.match(/^(?:plc|key)=(did:(?:plc|key):\S+)$/);
    if (innerKv) return innerKv[1];
  } catch {}
  return null;
}

export function associationUrl(didKey) {
  return `${window.location.origin}${window.location.pathname}#${encodeURIComponent(didKey)}`;
}

/* ── Hash survival through OAuth redirect ── */
const OAUTH_HASH_KEY = 'dka-oauth-hash';

export function saveHashForLogin() {
  const did = getHashDid();
  if (did) sessionStorage.setItem(OAUTH_HASH_KEY, did);
}

export function restoreHashFromLogin() {
  const did = sessionStorage.getItem(OAUTH_HASH_KEY);
  if (did) sessionStorage.removeItem(OAUTH_HASH_KEY);
  return did;
}

export function clearOAuthHash() {
  sessionStorage.removeItem(OAUTH_HASH_KEY);
}

export function isAlreadyAssociated(records, didKey) {
  if (!didKey || !records) return false;
  return records.some(r => r.value?.keyId === didKey);
}

/* ── QR scanning ── */
let qrStream = null;
let qrAnimFrame = null;

export function didFromScanValue(value) {
  if (value.startsWith('did:key:') || value.startsWith('did:plc:')) return value;
  // key=value format
  const kv = value.match(/^(?:plc|key)=(did:(?:plc|key):\S+)$/);
  if (kv) return kv[1];
  try {
    const u = new URL(value);
    const inner = u.hash.slice(1);
    if (inner.startsWith('did:key:') || inner.startsWith('did:plc:')) return inner;
    const innerKv = inner.match(/^(?:plc|key)=(did:(?:plc|key):\S+)$/);
    if (innerKv) return innerKv[1];
  } catch {}
  return null;
}

let _fileOnCapture = null;

export function startQRScanner({ onScan, onStatus, containerEl, videoEl }) {
  containerEl.style.display = "block";
  hideFileBtn(containerEl);
  onStatus?.('', '');

  const onCapture = (did) => {
    onScan(did);
    stopQRScanner();
  };

  // iOS-required video attributes — set before stream touches element
  for (const [attr, val] of [['muted', ''], ['playsinline', ''], ['webkit-playsinline', ''], ['autoplay', '']]) {
    videoEl.setAttribute(attr, val);
  }
  videoEl.style.display = '';

  // Wait for layout (container just un-hidden, iOS needs computed dimensions)
  requestAnimationFrame(() => {
    onStatus?.('Requesting camera...', '');

    // Create canvas for frame capture
    let canvas = containerEl.querySelector('#qr-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'qr-canvas';
      canvas.style.cssText = 'display:none;';
      containerEl.appendChild(canvas);
    }

    const constraints = { video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } } };
    navigator.mediaDevices.getUserMedia(constraints)
      .then(stream => {
        qrStream = stream;

        // Detach/re-attach — fixes iOS WebKit rendering blackout (#310349)
        videoEl.srcObject = null;
        setTimeout(() => {
          if (!qrStream) return;
          videoEl.onloadedmetadata = () => videoEl.play().catch(() => {});
          videoEl.srcObject = qrStream;
        }, 80);

        onStatus?.('Scanning... point camera at a QR code.', '');

        // BarcodeDetector path (Chrome/Edge) — fast native API
        if ('BarcodeDetector' in window) {
          const detector = new BarcodeDetector({ formats: ['qr_code'] });
          const scan = async () => {
            if (!qrStream) return;
            try {
              const barcodes = await detector.detect(videoEl);
              if (barcodes.length > 0) {
                const did = didFromScanValue(barcodes[0].rawValue);
                if (did) { onCapture(did); return; }
                onStatus?.('Scanned but not a did:key. Keep scanning.', 'danger');
              }
            } catch (e) { /* may throw on some frames */ }
            if (qrStream) qrAnimFrame = requestAnimationFrame(scan);
          };
          qrAnimFrame = requestAnimationFrame(scan);
        } else {
          // Safari/iOS: canvas + jsQR scan loop
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          let lastScan = 0;
          const SCAN_INTERVAL = 250; // ms between decode attempts

          const scan = () => {
            if (!qrStream) return;
            qrAnimFrame = requestAnimationFrame(scan);

            const now = performance.now();
            if (now - lastScan < SCAN_INTERVAL) return;
            lastScan = now;

            if (videoEl.readyState < 2) return; // no frame data yet

            try {
              canvas.width = videoEl.videoWidth;
              canvas.height = videoEl.videoHeight;
              if (canvas.width === 0 || canvas.height === 0) return;
              ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(imageData.data, imageData.width, imageData.height);
              if (code) {
                const did = didFromScanValue(code.data);
                if (did) onCapture(did);
              }
            } catch (e) { /* skip bad frames */ }
          };
          qrAnimFrame = requestAnimationFrame(scan);
        }
      })
      .catch((err) => {
        if (qrStream) { qrStream.getTracks().forEach(t => t.stop()); qrStream = null; }
        const reason = err.name === 'NotAllowedError' ? 'Camera permission denied. ' :
          err.name === 'NotFoundError' ? 'No camera found. ' : `Camera error: ${err.message}. `;
        onStatus?.(`${reason}Tap "Take Photo" below.`, 'danger');
        showFileBtn(containerEl, onCapture, onStatus);
      });
  });
}

function getFileBtn(containerEl) {
  let wrapper = containerEl.querySelector('#qr-file-wrapper');
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.id = 'qr-file-wrapper';
    wrapper.style.cssText = 'display:none;margin-top:12px;';
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'qr-file-input';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.style.cssText = 'display:none;';
    const label = document.createElement('label');
    label.setAttribute('for', 'qr-file-input');
    label.className = 'btn btn-secondary btn-block';
    label.style.cssText = 'cursor:pointer;';
    label.textContent = 'Take Photo';
    wrapper.appendChild(input);
    wrapper.appendChild(label);
    containerEl.appendChild(wrapper);

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const statusEl = containerEl.querySelector('#qr-scan-status');
      if (statusEl) statusEl.textContent = 'Decoding QR from photo...';
      try {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        URL.revokeObjectURL(img.src);
        if (code) {
          const did = didFromScanValue(code.data);
          if (did && _fileOnCapture) {
            if (statusEl) { statusEl.textContent = ''; statusEl.style.color = ''; }
            _fileOnCapture(did);
            return;
          }
        }
        if (statusEl) { statusEl.textContent = 'No did:key found in image. Try again.'; statusEl.style.color = 'var(--danger)'; }
      } catch (e) {
        if (statusEl) { statusEl.textContent = `Scan failed: ${e.message || e}. Try again.`; statusEl.style.color = 'var(--danger)'; }
      }
    });
  }
  return wrapper;
}

function showFileBtn(containerEl, onCapture, onStatus) {
  _fileOnCapture = onCapture;
  const wrapper = getFileBtn(containerEl);
  wrapper.style.display = '';
  const input = wrapper.querySelector('#qr-file-input');
  input.value = '';
}

function hideFileBtn(containerEl) {
  const wrapper = containerEl.querySelector('#qr-file-wrapper');
  if (wrapper) wrapper.style.display = 'none';
  _fileOnCapture = null;
}

export function stopQRScanner() {
  if (qrAnimFrame) {
    cancelAnimationFrame(qrAnimFrame);
    qrAnimFrame = null;
  }
  if (qrStream) {
    qrStream.getTracks().forEach(t => t.stop());
    qrStream = null;
  }
  const container = document.getElementById("qr-scanner-container");
  if (container) {
    container.style.display = "none";
    hideFileBtn(container);
  }
  const video = document.getElementById("qr-video");
  if (video) {
    video.pause();
    video.srcObject = null;
    video.removeAttribute('src');
    video.load(); // Release iOS AVPlayer resources
  }
}

/* ── QR generation ── */
export async function generateQrImg(didKey) {
  const url = associationUrl(didKey);
  const dataUrl = await toDataURL(url, { width: 180, margin: 2, color: { dark: '#000', light: '#fff' } });
  const img = document.createElement('img');
  img.src = dataUrl;
  img.className = 'qr-code-img';
  img.alt = `QR code for ${didKey}`;
  img.title = url;
  return img;
}

/* ── ATProto CRUD ── */
export async function fetchRecords(agent) {
  let records = [];
  let cursor = undefined;
  while (cursor === undefined || cursor != null) {
    const res = await agent.com.atproto.repo.listRecords({
      repo: agent.did,
      collection: BADGE_BLUE_KEYS_NSID,
      cursor,
    });
    if (!res.success) throw new Error(JSON.stringify(res));
    records.push(...res.data.records);
    cursor = typeof res.data.cursor === "string" ? res.data.cursor : null;
  }
  return records;
}

export async function doAssociate(agent, { didKey, name, service }) {
  const res = await agent.com.atproto.repo.createRecord({
    repo: agent.did,
    collection: BADGE_BLUE_KEYS_NSID,
    record: {
      $type: BADGE_BLUE_KEYS_NSID,
      keyId: didKey,
      name: name || randomName(),
      challenge: agent.did,
      service: service || '*',
      createdAt: new Date().toISOString(),
    },
  });
  if (!res.success) throw new Error(JSON.stringify(res));
  return res;
}

export async function doRename(agent, rec, rkey, newName) {
  const updated = { ...rec.value, name: newName };
  const res = await agent.com.atproto.repo.putRecord({
    repo: agent.did,
    collection: BADGE_BLUE_KEYS_NSID,
    rkey,
    record: updated,
  });
  if (!res.success) throw new Error(JSON.stringify(res));
}

export async function doDelete(agent, rkey) {
  const res = await agent.com.atproto.repo.deleteRecord({
    repo: agent.did,
    collection: BADGE_BLUE_KEYS_NSID,
    rkey,
  });
  if (!res.success) throw new Error(JSON.stringify(res));
}

/* ── OAuth session init ── */
export async function initSession() {
  const clientId = buildClientID();
  const oac = await BrowserOAuthClient.load({
    clientId,
    handleResolver: 'https://bsky.social',
  });
  const result = await oac.init();

  if (result) {
    const { session, state } = result;
    if (state != null) console.log(`${session.sub} was successfully authenticated (state: ${state})`);
    else console.log(`${session.sub} was restored (last active session)`);

    const agent = new Agent(session);
    const res = await agent.com.atproto.server.getSession();
    if (!res.success) throw new Error(JSON.stringify(res));

    return { oac, agent, sessionHandle: res.data.handle };
  }
  return { oac, agent: null, sessionHandle: null };
}

export async function doLogin(oac, identifier) {
  await oac.signIn(identifier, {
    state: 'some value needed later',
    signal: new AbortController().signal,
  });
}
