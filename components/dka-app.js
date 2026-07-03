import { initSession, doLogin, getHashDid, saveHashForLogin, restoreHashFromLogin, clearOAuthHash, isAlreadyAssociated, fetchRecords } from '../main.js';
import './dka-attest-confirm.js';
import './dka-key-list.js';
import './dka-share-sheet.js';

export class DkaApp extends HTMLElement {
  connectedCallback() {
    this._oac = null;
    this._agent = null;
    this._sessionHandle = null;
    this.renderLoading();
    this._init();
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
      const { oac, agent, sessionHandle } = await initSession();
      this._oac = oac;
      this._agent = agent;
      this._sessionHandle = sessionHandle;

      if (agent && sessionHandle) {
        this.renderMain();
      } else {
        this.renderLogin();
      }
    } catch (err) {
      this.querySelector('#load-error').classList.remove('hidden');
      this.querySelector('#load-error').textContent = `An error occurred: ${err}`;
    }
  }

  renderLogin() {
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
        saveHashForLogin();
        await doLogin(this._oac, e.target.username.value);
      } catch (err) {
        this.querySelector('#login-error').textContent = `Login error: ${err}`;
      }
      btn.removeAttribute('aria-busy');
      btn.textContent = 'Login';
    });

    this.querySelector('#bsky-btn').addEventListener('click', () => {
      saveHashForLogin();
      doLogin(this._oac, 'https://bsky.social');
    });
  }

  async renderMain() {
    const hashDid = getHashDid() || restoreHashFromLogin();

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
    if (hashDid && isAlreadyAssociated(keyList._records, hashDid)) {
      const attest = this.querySelector('#attest-confirm');
      attest.setAttribute('already-associated', 'true');
    }

    // Attest confirm events
    const attest = this.querySelector('#attest-confirm');
    attest.addEventListener('dka:attest', () => {
      // Pre-fill the associate form with the hash did:key
      const input = this.querySelector('#did-key-input');
      if (input) {
        input.value = hashDid;
        input.form?.querySelector('#name-input')?.focus();
      }
      attest.style.display = 'none';
      clearOAuthHash();
      if (window.location.hash) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    });
    attest.addEventListener('dka:ignore', () => {
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
