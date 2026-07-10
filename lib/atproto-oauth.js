// ATProto OAuth for the browser — PAR + PKCE + DPoP + token exchange.
// Pure Web Crypto + fetch, zero SDK deps. Key insight: DPoP keys are
// generated with extractable:true, so the private JWK is always available.
// Pattern: deno-macos-runner-desktop/lib/atproto-oauth-fetch/mod.ts

// ── Crypto helpers ──

async function sha256(data) {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hash);
}

function toHex(bytes) {
  const parts = [];
  for (let i = 0; i < bytes.length; i++) {
    parts.push(bytes[i].toString(16).padStart(2, '0'));
  }
  return parts.join('');
}

function base64url(bytes) {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function randomHex(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

async function pkceChallenge(verifier) {
  const hash = await sha256(new TextEncoder().encode(verifier));
  return base64url(hash);
}

// ── DPoP ──

async function generateDpopKey() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'],
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  return { keyPair, publicJwk, privateJwk };
}

async function createDpopProof(keyPair, publicJwk, htm, htu, nonce, accessToken) {
  const enc = new TextEncoder();
  const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y } };
  const payload = { jti: randomHex(20), htm, htu, iat: Math.floor(Date.now() / 1000) };
  if (nonce) payload.nonce = nonce;
  if (accessToken) payload.ath = base64url(await sha256(enc.encode(accessToken)));
  const headerB64 = base64url(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64url(enc.encode(JSON.stringify(payload)));
  const signingInput = headerB64 + '.' + payloadB64;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, enc.encode(signingInput),
  );
  return signingInput + '.' + base64url(new Uint8Array(sig));
}

// ── Identity resolution ──

async function resolveAuthServer(handle) {
  let did, pds;

  // If handle is already a PDS URL (e.g. https://bsky.social), skip handle→DID resolution
  if (handle.startsWith('https://')) {
    pds = handle.replace(/\/+$/, '');
    // Resolve DID from PDS
    const mr = await fetch(`${pds}/.well-known/oauth-protected-resource`);
    if (!mr.ok) throw new Error(`PDS metadata: ${mr.status}`);
    const authServers = (await mr.json()).authorization_servers;
    if (!authServers?.[0]) throw new Error('No authorization_servers');
    const am = await getAuthServerMeta(authServers[0]);
    if (!am.authorization_endpoint || !am.token_endpoint) throw new Error('Missing auth endpoints');
    // Get DID from PDS
    try {
      const dr = await fetch(`${pds}/.well-known/atproto-did`);
      if (dr.ok) did = (await dr.text()).trim();
    } catch { did = pds; }
    return { did: did || pds, pds, authServer: authServers[0] };
  }

  // Standard handle→DID→PDS→auth server resolution
  try {
    const r = await fetch(`https://${handle}/.well-known/atproto-did`);
    if (r.ok) { did = (await r.text()).trim(); if (!did.startsWith('did:')) did = null; }
  } catch { /* fall through */ }
  if (!did) {
    const r = await fetch(`https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`);
    if (!r.ok) throw new Error(`identity resolve failed: ${r.status}`);
    did = (await r.json()).did;
  }

  // Resolve DID → PDS
  if (did.startsWith('did:web:')) {
    const rest = did.slice('did:web:'.length).split(':').map(decodeURIComponent);
    const host = rest.shift();
    const path = rest.length ? `/${rest.join('/')}/.well-known/did.json` : '/.well-known/did.json';
    const dr = await fetch(`https://${host}${path}`);
    if (!dr.ok) throw new Error(`DID doc fetch failed: ${dr.status}`);
    const didDoc = await dr.json();
    const svc = (didDoc.service || []).find(s => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer');
    if (!svc) throw new Error('No PDS in DID doc');
    pds = svc.serviceEndpoint;
  } else {
    const dr = await fetch(`https://plc.directory/${encodeURIComponent(did)}`);
    if (!dr.ok) throw new Error(`PLC directory fetch failed: ${dr.status}`);
    const didDoc = await dr.json();
    const svc = (didDoc.service || []).find(s => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer');
    if (!svc) throw new Error('No PDS in DID doc');
    pds = svc.serviceEndpoint;
  }

  // Resolve PDS → auth server
  const mr = await fetch(`${pds}/.well-known/oauth-protected-resource`);
  if (!mr.ok) throw new Error(`PDS metadata: ${mr.status}`);
  const authServers = (await mr.json()).authorization_servers;
  if (!authServers?.[0]) throw new Error('No authorization_servers');

  const am = await getAuthServerMeta(authServers[0]);
  if (!am.authorization_endpoint || !am.token_endpoint) throw new Error('Missing auth endpoints');

  return { did, pds, authServer: authServers[0] };
}

async function getAuthServerMeta(authServer) {
  const r = await fetch(`${authServer}/.well-known/oauth-authorization-server`);
  if (!r.ok) throw new Error(`Auth metadata: ${r.status}`);
  return r.json();
}

// ── PAR (Pushed Authorization Request) ──

const PAR_STORAGE_KEY = 'dka-par-state';

export async function startOAuth(handle, clientId, redirectUri, scope, stateSuffix) {
  const { did, authServer } = await resolveAuthServer(handle);
  const meta = await getAuthServerMeta(authServer);
  const parEndpoint = meta.pushed_authorization_request_endpoint;
  const authEndpoint = meta.authorization_endpoint;
  const tokenEndpoint = meta.token_endpoint;

  const codeVerifier = randomHex(48);
  const codeChallenge = await pkceChallenge(codeVerifier);
  const dpop = await generateDpopKey();
  const randomPart = randomHex(16);
  const state = stateSuffix ? `${randomPart}|${stateSuffix}` : randomPart;

  const parBody = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri,
    scope,
    state,
  });

  let oauthServerNonce = null;
  const doPar = async (nonce) => {
    const proof = await createDpopProof(dpop.keyPair, dpop.publicJwk, 'POST', parEndpoint, nonce);
    return fetch(parEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'DPoP': proof },
      body: parBody.toString(),
    });
  };

  let parRes = await doPar(null);
  if (parRes.status === 400) {
    const errBody = await parRes.text();
    if (errBody.includes('use_dpop_nonce')) {
      const serverNonce = parRes.headers.get('DPoP-Nonce');
      if (!serverNonce) throw new Error('PAR: server requested nonce but none provided');
      parRes = await doPar(serverNonce);
    }
  }
  if (!parRes.ok) throw new Error(`PAR failed: ${parRes.status} ${await parRes.text()}`);

  const parNonce = parRes.headers.get('DPoP-Nonce');
  if (parNonce) oauthServerNonce = parNonce;
  const { request_uri: requestUri } = await parRes.json();
  if (!requestUri) throw new Error('No request_uri');

  // Save state for callback
  const parState = {
    codeVerifier,
    dpopPublicJwk: dpop.publicJwk,
    dpopPrivateJwk: dpop.privateJwk,
    state,
    authServer: authEndpoint,
    tokenEndpoint,
    did,
    pds: (await resolvePdsForDid(did)),
    oauthServerNonce,
  };
  sessionStorage.setItem(PAR_STORAGE_KEY, JSON.stringify(parState));

  const authUrl = `${authEndpoint}?client_id=${encodeURIComponent(clientId)}&request_uri=${encodeURIComponent(requestUri)}`;
  return { authUrl, did };
}

async function resolvePdsForDid(did) {
  if (did.startsWith('did:web:')) {
    const rest = did.slice('did:web:'.length).split(':').map(decodeURIComponent);
    const host = rest.shift();
    const path = rest.length ? `/${rest.join('/')}/.well-known/did.json` : '/.well-known/did.json';
    const dr = await fetch(`https://${host}${path}`);
    if (!dr.ok) throw new Error(`DID doc: ${dr.status}`);
    const doc = await dr.json();
    const svc = (doc.service || []).find(s => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer');
    return svc?.serviceEndpoint || did;
  }
  try {
    const dr = await fetch(`https://plc.directory/${encodeURIComponent(did)}`);
    if (dr.ok) {
      const doc = await dr.json();
      const svc = (doc.service || []).find(s => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer');
      if (svc) return svc.serviceEndpoint;
    }
  } catch { /* fall through */ }
  return `https://bsky.social`; // fallback
}

// ── Callback: exchange code for tokens ──

export function getParState() {
  const raw = sessionStorage.getItem(PAR_STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function clearParState() {
  sessionStorage.removeItem(PAR_STORAGE_KEY);
}

export async function handleOAuthCallback(code, state) {
  const parState = getParState();
  if (!parState) throw new Error('No OAuth state found — restart login');

  // State format: randomHex or randomHex|suffix
  // The parState.state was stored before redirect — it's the full state string
  if (state !== parState.state) {
    // Also accept: server may have stripped the suffix or reordered
    // Just check the random prefix matches
    if (!parState.state.startsWith(state.split('|')[0])) {
      throw new Error('OAuth state mismatch');
    }
  }
  clearParState();

  // Extract suffix from state if present (format: randomHex|cliDid|nonce)
  const stateParts = state.split('|');
  const stateSuffix = stateParts.length === 3 ? `${stateParts[1]}|${stateParts[2]}` : null;

  const { tokenEndpoint, codeVerifier, dpopPublicJwk, dpopPrivateJwk, oauthServerNonce } = parState;

  // Clean JWK of browser-specific fields before importKey
  function cleanJwk(jwk) {
    const { key_ops, ext, use, alg, ...clean } = jwk;
    return clean;
  }

  // Reconstruct keypair from JWK for DPoP signing
  const privateKey = await crypto.subtle.importKey(
    'jwk', cleanJwk(dpopPrivateJwk),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  );
  const publicKey = await crypto.subtle.importKey(
    'jwk', cleanJwk(dpopPublicJwk),
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify'],
  );
  const dpopKeyPair = { privateKey, publicKey };

  // Exchange code for tokens
  const clientId = buildClientId();
  const redirectUri = buildRedirectUri();

  const doExchange = async (nonce) => {
    const proof = await createDpopProof(dpopKeyPair, dpopPublicJwk, 'POST', tokenEndpoint, nonce);
    return fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'DPoP': proof },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri: redirectUri,
        client_id: clientId, code_verifier: codeVerifier,
      }).toString(),
    });
  };

  let res = await doExchange(oauthServerNonce);
  if (res.status === 400) {
    const errBody = await res.text();
    if (errBody.includes('use_dpop_nonce')) {
      const newNonce = res.headers.get('DPoP-Nonce');
      if (!newNonce) throw new Error('Token exchange: server requested nonce but none provided');
      res = await doExchange(newNonce);
    }
  }
  if (!res.ok) throw new Error(`Token exchange: ${res.status} ${await res.text()}`);

  const serverNonce = res.headers.get('DPoP-Nonce') || oauthServerNonce;
  const tokens = await res.json();

  // Get session info
  const pds = parState.pds || tokens.iss || 'https://bsky.social';
  const info = await fetchSessionInfo(pds, tokens.access_token, dpopKeyPair, dpopPublicJwk, serverNonce);

  return {
    accessJwt: tokens.access_token,
    refreshJwt: tokens.refresh_token,
    userDid: info.did,
    handle: info.handle,
    pds,
    dpopPublicJwk,
    dpopPrivateJwk,
    stateSuffix,
  };
}

async function fetchSessionInfo(pds, accessToken, dpopKeyPair, dpopPublicJwk, serverNonce) {
  const endpoint = `${pds}/xrpc/com.atproto.server.getSession`;

  const doGetSession = async (nonce) => {
    const proof = await createDpopProof(dpopKeyPair, dpopPublicJwk, 'GET', endpoint, nonce, accessToken);
    return fetch(endpoint, {
      headers: { 'Authorization': `DPoP ${accessToken}`, 'DPoP': proof },
    });
  };

  let res = await doGetSession(serverNonce);
  if (res.status === 400 || res.status === 401) {
    const errBody = await res.text();
    if (errBody.includes('use_dpop_nonce')) {
      const newNonce = res.headers.get('DPoP-Nonce');
      if (newNonce) res = await doGetSession(newNonce);
    }
  }
  if (!res.ok) throw new Error(`getSession: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Client metadata ──

function buildClientId() {
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (isLocal) {
    return `http://localhost?${new URLSearchParams({
      scope: `atproto repo:com.publicdomainrelay.temp.badgeBlueKeys?action=create,update,delete rpc:com.publicdomainrelay.temp.requester.associateConfirm?aud=*`,
      redirect_uri: Object.assign(new URL(window.location.origin), { hostname: '127.0.0.1' }).href,
    })}`;
  }
  return `https://${window.location.host}/oauth-client-metadata.json`;
}

function buildRedirectUri() {
  return (window.location.origin + window.location.pathname).replace(/\/+$/, '');
}

export const OAUTH_SCOPE = 'atproto transition:generic';
