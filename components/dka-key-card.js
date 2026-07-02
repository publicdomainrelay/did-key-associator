import './vault-chip.js';

export class DkaKeyCard extends HTMLElement {
  static get observedAttributes() {
    return ['name', 'key-id', 'service', 'rkey', 'uri', 'created-at'];
  }

  connectedCallback() {
    this._editing = false;
    this._showingQR = false;
    this._qrLoaded = false;
    this._qrImg = null;
    this.render();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  get data() {
    return {
      name: this.getAttribute('name') || 'unnamed',
      keyId: this.getAttribute('key-id') || '',
      service: this.getAttribute('service') || '*',
      rkey: this.getAttribute('rkey') || '',
      uri: this.getAttribute('uri') || '',
      createdAt: this.getAttribute('created-at') || '',
    };
  }

  render() {
    const d = this.data;
    const truncated = d.keyId.length > 28 ? d.keyId.slice(0, 28) + '…' + d.keyId.slice(-5) : d.keyId;
    const dateStr = d.createdAt ? `Created: ${new Date(d.createdAt).toLocaleDateString()}` : '';

    this.innerHTML = `
      <div class="card key-card">
        <div class="name-row">
          ${this._editing
            ? `<input type="text" value="${this._escape(d.name)}" id="edit-input" style="flex:1;">
               <button class="btn btn-primary btn-sm" id="save-btn">Save</button>
               <button class="btn btn-outline btn-sm" id="cancel-btn">Cancel</button>`
            : `<strong id="name-display">${this._escape(d.name)}</strong>
               <vault-chip service="${this._escape(d.service)}"></vault-chip>`
          }
        </div>
        ${dateStr ? `<small class="text-faint">${dateStr}</small>` : ''}
        <div class="key-code" style="margin-top:8px;">
          <span class="mono">${this._escape(truncated)}</span>
          <span class="copy-link" id="copy-btn" title="Copy full did:key">⧉ copy</span>
        </div>
        <div class="actions">
          <span class="act-accent" id="rename-btn">${this._editing ? '' : 'Rename'}</span>
          <span class="act-accent" id="qr-btn">Share QR</span>
          <span style="color:var(--text-faint);margin:0 4px;">${' '}</span>
          <span class="act-accent"><a href="https://pdsls.dev/${this._escape(d.uri)}" target="_blank" style="color:inherit;text-decoration:none;font-size:12px;">pdsls</a></span>
          <span class="act-danger" id="delete-btn">Delete</span>
        </div>
        <div id="qr-inline" style="${this._showingQR ? '' : 'display:none;'}margin-top:12px;"></div>
      </div>
    `;

    this._wire();
  }

  _wire() {
    if (this._editing) {
      this.querySelector('#save-btn').addEventListener('click', () => {
        const input = this.querySelector('#edit-input');
        const newName = input.value.trim() || 'unnamed';
        this.dispatchEvent(new CustomEvent('dka:rename', {
          bubbles: true,
          detail: { rkey: this.data.rkey, name: newName },
        }));
        this._editing = false;
        this.setAttribute('name', newName);
        this.render();
      });
      this.querySelector('#cancel-btn').addEventListener('click', () => {
        this._editing = false;
        this.render();
      });
      const input = this.querySelector('#edit-input');
      input.focus();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.querySelector('#save-btn').click();
        if (e.key === 'Escape') this.querySelector('#cancel-btn').click();
      });
    } else {
      this.querySelector('#rename-btn').addEventListener('click', () => {
        this._editing = true;
        this.render();
      });
    }

    this.querySelector('#copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(this.data.keyId).catch(() => {});
      const btn = this.querySelector('#copy-btn');
      btn.textContent = 'copied!';
      setTimeout(() => { btn.textContent = '⧉ copy'; }, 1500);
    });

    this.querySelector('#qr-btn').addEventListener('click', async () => {
      if (!this._showingQR) {
        this._showingQR = true;
        this.render();
        const container = this.querySelector('#qr-inline');
        if (!this._qrLoaded) {
          const { generateQrImg } = await import('../main.js');
          container.appendChild(await generateQrImg(this.data.keyId));
          this._qrLoaded = true;
        }
      } else {
        this._showingQR = false;
        this.render();
      }
    });

    this.querySelector('#delete-btn').addEventListener('click', () => {
      if (!confirm(`Delete association for key "${this.data.name}"?`)) return;
      this.dispatchEvent(new CustomEvent('dka:delete', {
        bubbles: true,
        detail: { rkey: this.data.rkey },
      }));
    });
  }

  _escape(s) {
    const el = document.createElement('span');
    el.textContent = s;
    return el.innerHTML;
  }
}

if (!customElements.get('dka-key-card')) {
  customElements.define('dka-key-card', DkaKeyCard);
}
