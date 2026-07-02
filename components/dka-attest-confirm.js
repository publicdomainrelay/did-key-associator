export class DkaAttestConfirm extends HTMLElement {
  connectedCallback() {
    this.render();
  }

  set didKey(value) {
    this._didKey = value;
    this.render();
  }
  get didKey() { return this._didKey; }

  render() {
    const did = this._didKey || this.getAttribute('did-key') || '';
    if (!did) { this.innerHTML = ''; return; }

    this.innerHTML = `
      <div class="card attest-card">
        <h2>Is this your key?</h2>
        <p class="text-muted mb-3" style="font-size:13.5px;line-height:1.55;">
          Publicly attesting this <code>did:key</code> belongs to your account.
          This doesn't grant it access to anything — it just tells the network you operate it.
        </p>
        <div class="key-code">
          <span>${this._escape(did)}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <button class="btn btn-primary btn-block" id="attest-confirm-btn">
            Yes, this is mine — attest publicly
          </button>
          <button class="btn btn-outline btn-block" id="attest-ignore-btn">
            Not mine — ignore
          </button>
        </div>
      </div>
    `;

    this.querySelector('#attest-confirm-btn').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('dka:attest', { bubbles: true }));
    });
    this.querySelector('#attest-ignore-btn').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('dka:ignore', { bubbles: true }));
    });
  }

  _escape(s) {
    const el = document.createElement('span');
    el.textContent = s;
    return el.innerHTML;
  }
}

if (!customElements.get('dka-attest-confirm')) {
  customElements.define('dka-attest-confirm', DkaAttestConfirm);
}
