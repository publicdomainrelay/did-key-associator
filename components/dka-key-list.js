import {
  fetchRecords, doAssociate, doRename, doDelete,
  randomName, parseRkey, stopQRScanner, startQRScanner,
  clearOAuthHash,
} from '../main.js';
import './dka-key-card.js';

export class DkaKeyList extends HTMLElement {
  connectedCallback() {
    this._records = [];
    this._error = '';
    this._successUri = '';
    this._scanning = false;
    this.renderShell();
  }

  set agent(a) { this._agent = a; }
  set sessionHandle(h) { this._sessionHandle = h; }

  renderShell() {
    this.innerHTML = `
      <div class="card">
        <h2 style="margin-bottom:12px;">Associate a <code>did:key</code></h2>
        <form id="assoc-form">
          <input type="text" name="did-key" id="did-key-input"
            placeholder="did:key:z6Mk..." required
            style="margin-bottom:8px;">
          <input type="text" name="name" id="name-input"
            placeholder="name (auto-generated if empty)"
            style="margin-bottom:12px;">
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn btn-secondary" id="scan-qr-btn">Scan QR</button>
            <button type="submit" class="btn btn-primary flex-1" id="assoc-submit">Associate Key</button>
          </div>
        </form>
        <div id="qr-scanner-container" style="display:none;margin-top:12px;">
          <video id="qr-video" autoplay muted playsinline webkit-playsinline style="width:100%;height:auto;min-height:240px;border-radius:8px;background:#000;"></video>
          <button type="button" class="btn btn-outline btn-block mt-3" id="qr-stop-btn">Stop Scanner</button>
          <p id="qr-scan-status" style="margin-top:8px;font-size:13px;"></p>
        </div>
        <p id="assoc-error" style="color:var(--danger);margin-top:8px;font-size:13px;"></p>
      </div>

      <div id="success-banner" class="success-card hidden">
        <div class="check">✓</div>
        <h2>Publicly attested</h2>
        <p class="text-muted mb-3" style="font-size:13px;">
          The network now knows this key belongs to @${this._sessionHandle || 'you'}.
        </p>
        <a id="success-pdsls" href="#" target="_blank" class="btn btn-secondary btn-sm">View on pdsls.dev</a>
      </div>

      <div class="header-row" style="margin-top:16px;">
        <h2>Your Keys</h2>
      </div>
      <div class="subheader" id="keys-sub">@${this._sessionHandle || ''} · 0 keys</div>
      <div class="search-bar">
        <span>🔍</span>
        <input type="search" id="key-search" placeholder="Search keys or services">
      </div>
      <div id="keys-container"></div>
      <p id="keys-error" style="color:var(--danger);font-size:13px;"></p>
      <p id="keys-empty" class="text-muted text-center" style="display:none;">No associated keys found. Add one above!</p>
    `;

    this._wireShell();
  }

  _wireShell() {
    this.querySelector('#assoc-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = this.querySelector('#assoc-submit');
      btn.setAttribute('aria-busy', 'true');
      btn.textContent = 'Associating…';
      this.querySelector('#assoc-error').textContent = '';

      try {
        const didKey = this.querySelector('#did-key-input').value.trim();
        const name = this.querySelector('#name-input').value.trim() || randomName();
        const res = await doAssociate(this._agent, { didKey, name });
        this._successUri = res.data.uri;
        this.querySelector('#assoc-form').reset();
        await this.refreshKeys();
        this._showSuccess();
      } catch (err) {
        this.querySelector('#assoc-error').textContent = `${err}`;
      }
      btn.removeAttribute('aria-busy');
      btn.textContent = 'Associate Key';
    });

    this.querySelector('#scan-qr-btn').addEventListener('click', () => {
      if (this._scanning) {
        stopQRScanner();
        this._scanning = false;
        return;
      }
      this._scanning = true;
      startQRScanner({
        onScan: (did) => {
          this.querySelector('#did-key-input').value = did;
          this._scanning = false;
        },
        onStatus: (msg, cls) => {
          const s = this.querySelector('#qr-scan-status');
          s.textContent = msg;
          s.style.color = cls === 'danger' ? 'var(--danger)' : 'var(--text-muted)';
        },
        containerEl: this.querySelector('#qr-scanner-container'),
        videoEl: this.querySelector('#qr-video'),
      });
    });

    this.querySelector('#qr-stop-btn').addEventListener('click', () => {
      stopQRScanner();
      this._scanning = false;
    });

    // Search filter
    this.querySelector('#key-search').addEventListener('input', (e) => {
      this._filterCards(e.target.value.toLowerCase());
    });

    // Listen for card events
    this.addEventListener('dka:rename', async (e) => {
      const { rkey, name } = e.detail;
      const rec = this._records.find(r => parseRkey(r.uri) === rkey);
      if (!rec) return;
      try { await doRename(this._agent, rec, rkey, name); }
      catch (err) { alert(`Rename failed: ${err.message}`); }
    });

    this.addEventListener('dka:delete', async (e) => {
      const { rkey } = e.detail;
      try {
        await doDelete(this._agent, rkey);
        await this.refreshKeys();
      } catch (err) { alert(`Delete failed: ${err.message}`); }
    });
  }

  _showSuccess() {
    const banner = this.querySelector('#success-banner');
    const link = this.querySelector('#success-pdsls');
    link.href = `https://pdsls.dev/${this._successUri}`;
    banner.classList.remove('hidden');
    // Clear hash from URL and sessionStorage
    clearOAuthHash();
    if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  async refreshKeys() {
    const container = this.querySelector('#keys-container');
    const empty = this.querySelector('#keys-empty');
    const error = this.querySelector('#keys-error');
    const sub = this.querySelector('#keys-sub');
    container.setAttribute('aria-busy', 'true');
    error.textContent = '';

    try {
      this._records = await fetchRecords(this._agent);
      container.removeAttribute('aria-busy');

      if (this._records.length === 0) {
        empty.style.display = 'block';
        container.innerHTML = '';
      } else {
        empty.style.display = 'none';
        this._renderCards();
      }
      sub.textContent = `@${this._sessionHandle || ''} · ${this._records.length} keys`;
    } catch (err) {
      container.removeAttribute('aria-busy');
      error.textContent = `Error loading keys: ${err.message}`;
    }
  }

  _renderCards() {
    const container = this.querySelector('#keys-container');
    container.innerHTML = '';
    for (const rec of this._records) {
      const v = rec.value;
      const card = document.createElement('dka-key-card');
      card.setAttribute('name', v.name || 'unnamed');
      card.setAttribute('key-id', v.keyId || '');
      card.setAttribute('service', v.service || '*');
      card.setAttribute('rkey', parseRkey(rec.uri));
      card.setAttribute('uri', rec.uri);
      card.setAttribute('created-at', v.createdAt || '');
      card.setAttribute('data-search', `${v.name||''} ${v.keyId||''} ${v.service||''}`.toLowerCase());
      container.appendChild(card);
    }
  }

  _filterCards(query) {
    const cards = this.querySelectorAll('dka-key-card');
    for (const card of cards) {
      const text = card.getAttribute('data-search') || '';
      card.style.display = text.includes(query) ? '' : 'none';
    }
  }
}

if (!customElements.get('dka-key-list')) {
  customElements.define('dka-key-list', DkaKeyList);
}
