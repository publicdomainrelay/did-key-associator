import { startOAuth, getParState, clearParState, handleOAuthCallback } from '../lib/atproto-oauth.js';
import { saveHashForLogin, log } from '../main.js';

const OAUTH_QR_NSID = 'com.fedfork.atprotoOauthQR';

export class DkaOauthTransfer extends HTMLElement {
  connectedCallback() {
    this._state = 'init';
    this._cliDid = this.getAttribute('cli-did') || '';
    this._nonce = this.getAttribute('nonce') || '';

    // Check if returning from OAuth redirect (code + state in URL query params)
    const qp = new URLSearchParams(window.location.search);
    const code = qp.get('code');
    const iss = qp.get('iss');
    const stateParam = qp.get('state');

    if (code && stateParam && iss) {
      // State format: randomHex|cliDid|nonce — recover if sessionStorage lost
      const parts = stateParam.split('|');
      if (parts.length === 3) {
        this._cliDid = parts[1];
        this._nonce = parts[2];
      }
      this._handleCallback(code, stateParam);
      return;
    }

    this.renderInit();
    this._start();
  }

  renderInit() {
    this.innerHTML = `
      <main class="app-shell">
        <div class="card text-center" style="padding:40px;">
          <h2>Session Transfer</h2>
          <p class="text-muted mb-3" style="font-size:14px;">
            Log in with your AT Protocol account to transfer your session
            back to the CLI that showed you the QR code.
          </p>
          <p class="text-muted" style="font-size:12px;word-break:break-all;">
            CLI: <code>${this._escape(this._cliDid)}</code>
          </p>
          <p id="oauth-transfer-error" class="text-danger hidden mt-3"></p>
        </div>
      </main>
    `;
  }

  renderLogin() {
    this.innerHTML = `
      <main class="app-shell">
        <header style="margin-bottom:24px;">
          <h1 style="font-size:18px;">Session Transfer</h1>
        </header>
        <div class="card">
          <h2>Login with the Atmosphere</h2>
          <form id="oauth-transfer-login-form" style="margin-top:12px;">
            <p class="text-muted" style="font-size:14px;margin-bottom:12px;">
              Enter your handle to authenticate and transfer your session.
            </p>
            <input type="text" name="username" id="oauth-transfer-handle"
              placeholder="alice.example.com"
              style="margin-bottom:12px;" required>
            <button type="submit" class="btn btn-primary btn-block" id="oauth-transfer-submit">Login & Transfer</button>
          </form>
          <p class="text-muted mt-3" style="font-size:13px;">If you're a Bluesky user, you already have an Atmosphere account.</p>
          <button id="oauth-transfer-bsky-btn" class="btn btn-secondary btn-block mt-3">Login with Bluesky Social</button>
          <p id="oauth-transfer-error" class="text-danger mt-3" style="font-size:13px;"></p>
        </div>
        <nav style="margin-top:20px;text-align:center;font-size:13px;">
          <a href="https://github.com/publicdomainrelay/did-key-associator" target="_blank" class="text-muted">Source Code</a>
        </nav>
      </main>
    `;

    const doRedirect = async (handle) => {
      const btn = this.querySelector('#oauth-transfer-submit');
      if (btn) { btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Redirecting to PDS…'; }
      const errEl = this.querySelector('#oauth-transfer-error');
      if (errEl) errEl.textContent = '';
      try {
        // Save hash for restoration after OAuth redirect
        saveHashForLogin();
        const clientId = `https://${window.location.host}/oauth-client-metadata.json`;
        const redirectUri = (window.location.origin + window.location.pathname).replace(/\/+$/, '');
        const scope = 'atproto repo:com.publicdomainrelay.temp.market.offering?action=create&action=update repo:com.publicdomainrelay.temp.market.bid?action=create repo:com.publicdomainrelay.temp.market.bids.free?action=create repo:com.publicdomainrelay.temp.market.receipt?action=create repo:com.publicdomainrelay.temp.market.event?action=create repo:com.publicdomainrelay.temp.badgeBlueKeys?action=create repo:com.publicdomainrelay.temp.market.bidderAssociation?action=create repo:com.publicdomainrelay.temp.compute.config.wif.simple?action=create repo:com.publicdomainrelay.temp.compute.vm?action=create repo:com.publicdomainrelay.temp.market.rfp?action=create repo:com.publicdomainrelay.temp.market.accept?action=create repo:com.publicdomainrelay.temp.compute.events.vm.delete?action=create repo:com.fedproxy.rbac?action=create rpc:com.publicdomainrelay.temp.market.submitRfp?aud=* rpc:com.publicdomainrelay.temp.market.submitAccept?aud=* rpc:com.publicdomainrelay.temp.market.submitBid?aud=* rpc:com.publicdomainrelay.temp.market.submitEvent?aud=* rpc:com.publicdomainrelay.temp.requester.associateConfirm?aud=*';
        const { authUrl } = await startOAuth(handle, clientId, redirectUri, scope, `${this._cliDid}|${this._nonce}`);
        log('info', 'oauth-transfer', 'redirecting', { handle, authUrl: authUrl.slice(0, 80) });
        window.location.href = authUrl;
      } catch (err) {
        log('error', 'oauth-transfer', 'startOAuthError', { error: String(err) });
        if (btn) { btn.removeAttribute('aria-busy'); btn.textContent = 'Login & Transfer'; }
        if (errEl) errEl.textContent = `Login error: ${err}`;
      }
    };

    this.querySelector('#oauth-transfer-login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      doRedirect(e.target.username.value);
    });

    this.querySelector('#oauth-transfer-bsky-btn').addEventListener('click', () => {
      doRedirect('https://bsky.social');
    });
  }

  renderTransferring() {
    this.innerHTML = `
      <main class="app-shell">
        <div class="card text-center" style="padding:40px;">
          <h2 aria-busy="true">Transferring session…</h2>
          <p class="text-muted mt-3" style="font-size:14px;">
            Sending your session back to the CLI.
          </p>
          <p id="oauth-transfer-error" class="text-danger hidden mt-3"></p>
        </div>
      </main>
    `;
  }

  renderDone(handle) {
    // Mark parent <dka-app> so _onHashChange won't overwrite this success state.
    const app = this.closest('dka-app');
    if (app) app._transferDone = true;
    this.innerHTML = `
      <main class="app-shell">
        <div class="success-card">
          <div class="check">&#10003;</div>
          <h2>Session transferred</h2>
          <p class="text-muted mb-3" style="font-size:13px;">
            Your session (@${this._escape(handle)}) has been sent to
            <code style="word-break:break-all;">${this._escape(this._cliDid)}</code>.
            You can close this page and return to your terminal.
          </p>
        </div>
      </main>
    `;
  }

  renderError(msg) {
    const app = this.closest('dka-app');
    if (app) app._transferDone = true;
    this.innerHTML = `
      <main class="app-shell">
        <div class="card text-center" style="padding:40px;">
          <h2>Transfer failed</h2>
          <p class="text-danger mt-3" style="font-size:14px;">${this._escape(msg)}</p>
        </div>
      </main>
    `;
  }

  async _start() {
    this._state = 'login';
    this.renderLogin();
  }

  async _handleCallback(code, stateParam) {
    this._state = 'transferring';
    this.renderTransferring();

    try {
      const session = await handleOAuthCallback(code, stateParam);

      // Recover cliDid+nonce from stateSuffix if sessionStorage lost them
      if (session.stateSuffix) {
        const parts = session.stateSuffix.split('|');
        if (parts.length === 2) {
          this._cliDid = this._cliDid || parts[0];
          this._nonce = this._nonce || parts[1];
        }
      }

      log('info', 'oauth-transfer', 'callbackComplete', { handle: session.handle, did: session.userDid });

      // POST session to backend
      const res = await fetch(`/xrpc/${OAUTH_QR_NSID}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cliDid: this._cliDid,
          nonce: this._nonce,
          accessJwt: session.accessJwt,
          refreshJwt: session.refreshJwt,
          userDid: session.userDid,
          handle: session.handle,
          pds: session.pds,
          dpopPublicJwk: session.dpopPublicJwk,
          dpopPrivateJwk: session.dpopPrivateJwk,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message || `backend error: ${res.status}`);
      }

      log('info', 'oauth-transfer', 'sessionTransferred', { cliDid: this._cliDid, handle: session.handle });
      this.renderDone(session.handle);
    } catch (err) {
      log('error', 'oauth-transfer', 'callbackError', { error: String(err) });
      this._handleError(String(err));
    }
  }

  _handleError(msg) {
    log('error', 'oauth-transfer', 'error', { msg });
    clearParState();
    // Show login form so user can start fresh.
    this._state = 'login';
    this.renderLogin();
  }

  _escape(s) {
    const el = document.createElement('span');
    el.textContent = String(s);
    return el.innerHTML;
  }
}

if (!customElements.get('dka-oauth-transfer')) {
  customElements.define('dka-oauth-transfer', DkaOauthTransfer);
}
