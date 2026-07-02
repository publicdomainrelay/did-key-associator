import { BrowserOAuthClient } from '@atproto/oauth-client-browser';
import { Agent } from '@atproto/api';
import { toDataURL } from 'qrcode';
import { Html5Qrcode } from 'html5-qrcode';

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
  try {
    const u = new URL(hash);
    const inner = u.hash.slice(1);
    if (inner.startsWith('did:key:') || inner.startsWith('did:plc:')) return inner;
  } catch {}
  return null;
}

export function associationUrl(didKey) {
  return `${window.location.origin}${window.location.pathname}#${encodeURIComponent(didKey)}`;
}

/* ── QR scanning ── */
let qrStream = null;
let html5QrScanner = null;

export function didFromScanValue(value) {
  if (value.startsWith('did:key:') || value.startsWith('did:plc:')) return value;
  try {
    const u = new URL(value);
    const inner = u.hash.slice(1);
    if (inner.startsWith('did:key:') || inner.startsWith('did:plc:')) return inner;
  } catch {}
  return null;
}

export function startQRScanner({ onScan, onStatus, containerEl, videoEl }) {
  containerEl.style.display = "block";

  const onCapture = (did) => {
    onScan(did);
    stopQRScanner();
  };

  if ('BarcodeDetector' in window) {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
      .then(stream => {
        qrStream = stream;
        videoEl.srcObject = stream;
        videoEl.style.display = '';
        onStatus?.('Scanning... point camera at a QR code.', '');
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
          if (qrStream) requestAnimationFrame(scan);
        };
        requestAnimationFrame(scan);
      })
      .catch(() => {
        if (qrStream) { qrStream.getTracks().forEach(t => t.stop()); qrStream = null; }
        fallbackQRScanner(onCapture, onStatus);
      });
    return;
  }
  fallbackQRScanner(onCapture, onStatus, containerEl, videoEl);
}

function fallbackQRScanner(onCapture, onStatus) {
  try {
    html5QrScanner = new Html5Qrcode("qr-video");
    onStatus?.('Scanning... point camera at a QR code.', '');
    html5QrScanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 250 },
      (decodedText) => {
        const did = didFromScanValue(decodedText);
        if (did) onCapture(did);
      },
      () => { /* ignore scan errors */ }
    );
  } catch (err) {
    onStatus?.(`Camera error: ${err.message}`, 'danger');
  }
}

export function stopQRScanner() {
  if (html5QrScanner) {
    html5QrScanner.stop().catch(() => {});
    html5QrScanner = null;
  }
  if (qrStream) {
    qrStream.getTracks().forEach(t => t.stop());
    qrStream = null;
  }
  const container = document.getElementById("qr-scanner-container");
  const video = document.getElementById("qr-video");
  if (container) container.style.display = "none";
  if (video) video.srcObject = null;
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
