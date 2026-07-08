import { initSession, doLogin, getHashDid, getHashKind, saveHashForLogin, restoreHashFromLogin, clearOAuthHash, isAlreadyAssociated, fetchRecords, log, doAssociate, doRequesterAssociate, doBidderAssociate, randomName } from '../main.js';
import './dka-attest-confirm.js';
import './dka-key-list.js';
import './dka-share-sheet.js';

export class DkaApp extends HTMLElement {
  connectedCallback() {
    this._oac = null;
    this._agent = null;
    this._sessionHandle = null;
    this._state = 'loading'; // 'loading' | 'login' | 'main'
    this._boundHashChange = this._onHashChange.bind(this);
    window.addEventListener('hashchange', this._boundHashChange);
    window.addEventListener('popstate', this._boundHashChange);
    this.renderLoading();
    this._init();
  }

  disconnectedCallback() {
    window.removeEventListener('hashchange', this._boundHashChange);
    window.removeEventListener('popstate', this._boundHashChange);
  }

  _onHashChange() {
    log('info', 'app', 'hashChange', { hash: window.location.hash, state: this._state });
    if (this._state === 'main') {
      this._updateAttestFromHash();
    }
    // Login page: no re-render needed — login handlers call getHashDid() fresh each submit
  }

  _updateAttestFromHash() {
    const hashDid = getHashDid();
    log('info', 'app', 'hashChange:updateAttest', { hashDid: hashDid || null });
    const attest = this.querySelector('#attest-confirm');
    if (!attest) return;
    if (hashDid) {
      const kind = getHashKind();
      attest.setAttribute('did-key', hashDid);
      attest.removeAttribute('requester-did');
      attest.removeAttribute('bidder-did');
      if (kind === 'requester') attest.setAttribute('requester-did', hashDid);
      if (kind === 'bidder') attest.setAttribute('bidder-did', hashDid);
      attest.removeAttribute('already-associated');
      attest.style.display = '';
      const keyList = this.querySelector('#key-list');
      if (keyList && keyList._records && kind === 'key' && isAlreadyAssociated(keyList._records, hashDid)) {
        attest.setAttribute('already-associated', 'true');
      }
    } else {
      attest.style.display = 'none';
    }
  }

  renderLoading() {
    this.innerHTML = `
      <main class="app-shell">
        <div class="card text-center" style="padding:40px;">
          <h2 aria-busy="true">Loading session…</h2>
          <p id="load-error" class="text-danger hidden mt-3"></p>
        </div>
      </main>
    `;
  }

  async _init() {
    try {
      log('debug', 'app', '_init:start');
      const { oac, agent, sessionHandle } = await initSession();
      this._oac = oac;
      this._agent = agent;
      this._sessionHandle = sessionHandle;

      if (agent && sessionHandle) {
        log('info', 'app', '_init:loggedIn', { handle: sessionHandle });
        this.renderMain();
      } else {
        log('info', 'app', '_init:loggedOut');
        this.renderLogin();
      }
    } catch (err) {
      log('error', 'app', '_init:error', { error: String(err) });
      this.querySelector('#load-error').classList.remove('hidden');
      this.querySelector('#load-error').textContent = `An error occurred: ${err}`;
    }
  }

  renderLogin() {
    this._state = 'login';
    const hashDid = getHashDid();
    if (hashDid) log('info', 'app', 'renderLogin:hashDetected', { did: hashDid });
    this.innerHTML = `
      <main class="app-shell">
        <header style="margin-bottom:24px;">
          <h1 style="font-size:18px;white-space:nowrap;">DID Key Associator</h1>
        </header>
        <div class="card">
          <h2>Login with the Atmosphere</h2>
          <form id="login-form" style="margin-top:12px;">
            <p class="text-muted" style="font-size:14px;margin-bottom:12px;">Enter your handle to continue</p>
            <input type="text" name="username" id="login-handle"
              placeholder="alice.example.com"
              style="margin-bottom:12px;" required>
            <button type="submit" class="btn btn-primary btn-block" id="login-submit">Login</button>
          </form>
          <p class="text-muted mt-3" style="font-size:13px;">If you're a Bluesky user, you already have an Atmosphere account.</p>
          <button id="bsky-btn" class="btn btn-secondary btn-block mt-3">Create Account with Bluesky Social</button>
          <a href="https://atproto.com/guides/self-hosting" class="btn btn-outline btn-block mt-3">Other options</a>
          <p id="login-error" class="text-danger mt-3" style="font-size:13px;"></p>
        </div>
        <nav style="margin-top:20px;text-align:center;font-size:13px;">
          <a href="https://github.com/publicdomainrelay/did-key-associator" target="_blank" class="text-muted">Source Code</a>
        </nav>
      </main>
    `;

    this.querySelector('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = this.querySelector('#login-submit');
      btn.setAttribute('aria-busy', 'true');
      btn.textContent = 'Logging in…';
      this.querySelector('#login-error').textContent = '';
      try {
        const hashDid = getHashDid();
        saveHashForLogin();
        await doLogin(this._oac, e.target.username.value, hashDid ? `dka:${hashDid}` : undefined);
      } catch (err) {
        this.querySelector('#login-error').textContent = `Login error: ${err}`;
      }
      btn.removeAttribute('aria-busy');
      btn.textContent = 'Login';
    });

    this.querySelector('#bsky-btn').addEventListener('click', () => {
      const hashDid = getHashDid();
      saveHashForLogin();
      doLogin(this._oac, 'https://bsky.social', hashDid ? `dka:${hashDid}` : undefined);
    });
  }

  async renderMain() {
    this._state = 'main';
    const hashDid = getHashDid() || restoreHashFromLogin();
    const hashSource = getHashDid() ? 'url' : (hashDid ? 'sessionStorage' : 'none');
    log('info', 'app', 'renderMain:hashDid', { hashDid: hashDid || null, source: hashSource });

    this.innerHTML = `
      <main class="app-shell">
        <header style="margin-bottom:20px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <h1 style="font-size:18px;white-space:nowrap;">DID Key Associator</h1>
            <button class="btn btn-outline btn-sm" id="logout-btn" style="padding:4px 10px;font-size:11px;">Logout</button>
          </div>
          <div class="text-muted" style="font-size:12px;margin-top:4px;">@${this._sessionHandle}</div>
        </header>

        <dka-attest-confirm id="attest-confirm"
          did-key="${hashDid || ''}"
          already-associated="false"
          style="${hashDid ? '' : 'display:none;'}">
        </dka-attest-confirm>

        <dka-key-list id="key-list"></dka-key-list>
        <dka-share-sheet id="share-sheet"></dka-share-sheet>
      </main>
    `;

    const keyList = this.querySelector('#key-list');
    keyList._agent = this._agent;
    keyList._sessionHandle = this._sessionHandle;
    await keyList.refreshKeys();

    // Check if hash DID is already associated
    const isPlc = hashDid && (hashDid.startsWith('did:plc:') || hashDid.startsWith('did:web:'));
    if (hashDid && !isPlc && isAlreadyAssociated(keyList._records, hashDid)) {
      log('info', 'app', 'renderMain:alreadyAssociated', { didKey: hashDid });
      const attest = this.querySelector('#attest-confirm');
      attest.setAttribute('already-associated', 'true');
    }

    // Attest confirm events
    const attest = this.querySelector('#attest-confirm');
    const kind = getHashKind();
    if (kind === 'requester') {
      attest.setAttribute('requester-did', hashDid);
    } else if (kind === 'bidder') {
      attest.setAttribute('bidder-did', hashDid);
    }
    attest.addEventListener('dka:attest', async () => {
      // Re-read hash fresh — hashDid/kind captured at renderMain time may be stale
      const currentDid = getHashDid() || restoreHashFromLogin();
      const currentKind = getHashKind();
      log('info', 'app', 'renderMain:attest', { didKey: currentDid, kind: currentKind });
      attest.setAttribute('aria-busy', 'true');
      const confirmBtn = attest.querySelector('#attest-confirm-btn');
      if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Confirming…'; }
      try {
        if (currentKind === 'requester') {
          log('info', 'app', 'attest:requesterAssociate', { requesterDid: currentDid });
          await doRequesterAssociate(this._agent, currentDid);
          log('info', 'app', 'attest:requesterAssociated', { requesterDid: currentDid });
          await keyList.refreshKeys();
          keyList._showSuccess();
        } else if (currentKind === 'bidder') {
          log('info', 'app', 'attest:bidderAssociate', { bidderDid: currentDid });
          await doBidderAssociate(this._agent, currentDid);
          log('info', 'app', 'attest:bidderAssociated', { bidderDid: currentDid });
          await keyList.refreshKeys();
          keyList._showSuccess();
        } else {
          const name = randomName();
          log('info', 'app', 'attest:associating', { didKey: currentDid, name });
          await doAssociate(this._agent, { didKey: currentDid, name });
          log('info', 'app', 'attest:associated', { didKey: currentDid });
          await keyList.refreshKeys();
          keyList._showSuccess();
        }
      } catch (err) {
        log('error', 'app', 'attest:assocError', { error: String(err) });
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = currentKind === 'requester' ? 'Yes, this is my requester' : currentKind === 'bidder' ? 'Yes, this is my bidder' : 'Yes, this is mine — attest publicly'; }
        return;
      }
      attest.removeAttribute('aria-busy');
      attest.style.display = 'none';
      clearOAuthHash();
      if (window.location.hash) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    });
    attest.addEventListener('dka:ignore', () => {
      log('info', 'app', 'renderMain:ignore', { didKey: hashDid });
      attest.style.display = 'none';
      clearOAuthHash();
      if (window.location.hash) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    });

    // Logout
    this.querySelector('#logout-btn').addEventListener('click', () => {
      this._oac.revoke(this._agent.did);
      window.location.reload();
    });
  }
}

if (!customElements.get('dka-app')) {
  customElements.define('dka-app', DkaApp);
}
