import { log } from '../main.js';

export class DkaAttestConfirm extends HTMLElement {
  static get observedAttributes() { return ['did-key', 'already-associated', 'requester-did', 'bidder-did']; }

  connectedCallback() {
    log('debug', 'attest', 'connected');
    this.render();
  }

  set didKey(value) {
    this.setAttribute('did-key', value);
  }
  get didKey() { return this.getAttribute('did-key') || ''; }

  attributeChangedCallback(name, oldVal, newVal) {
    if (oldVal !== newVal && this.isConnected) {
      log('debug', 'attest', 'attrChanged', { name, newVal });
      this.render();
    }
  }

  render() {
    const did = this.getAttribute('did-key') || '';
    const requesterDid = this.getAttribute('requester-did') || '';
    const bidderDid = this.getAttribute('bidder-did') || '';
    const already = this.getAttribute('already-associated') === 'true';
    const isRequester = !!requesterDid;
    const isBidder = !!bidderDid;
    const displayDid = isRequester ? requesterDid : isBidder ? bidderDid : did;
    log('info', 'attest', 'render', { did: displayDid || null, already, isRequester, isBidder, willRender: !!displayDid });

    if (!displayDid) { this.innerHTML = ''; return; }

    if (already) {
      this.innerHTML = `
        <div class="modal-backdrop">
          <div class="modal-card attest-card">
            <h2>Already associated</h2>
            <p class="text-muted mb-3" style="font-size:13.5px;line-height:1.55;">
              This key is already associated with your account.
            </p>
            <div class="key-code modal-key-code">
              <span>${this._escape(displayDid)}</span>
            </div>
            <button class="btn btn-outline btn-block" id="attest-dismiss-btn">
              OK — dismiss
            </button>
          </div>
        </div>
      `;
      this.querySelector('#attest-dismiss-btn').addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('dka:ignore', { bubbles: true }));
      });
      return;
    }

    if (isBidder) {
      this.innerHTML = `
        <div class="modal-backdrop">
          <div class="modal-card attest-card">
            <h2>Is this your bidder?</h2>
            <p class="text-muted mb-3" style="font-size:13.5px;line-height:1.55;">
              Confirm you want to associate with this bidder. This tells the network you trust this compute provider.
            </p>
            <div class="key-code modal-key-code">
              <span>${this._escape(bidderDid)}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;">
              <button class="btn btn-primary btn-block" id="attest-confirm-btn">
                Yes, this is my bidder
              </button>
              <button class="btn btn-outline btn-block" id="attest-ignore-btn">
                Not mine — ignore
              </button>
            </div>
          </div>
        </div>
      `;
    } else if (isRequester) {
      this.innerHTML = `
        <div class="modal-backdrop">
          <div class="modal-card attest-card">
            <h2>Is this your requester?</h2>
            <p class="text-muted mb-3" style="font-size:13.5px;line-height:1.55;">
              Confirm you want to associate with this requester. This will notify the requester to proceed with your compute contract.
            </p>
            <div class="key-code modal-key-code">
              <span>${this._escape(requesterDid)}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;">
              <button class="btn btn-primary btn-block" id="attest-confirm-btn">
                Yes, this is my requester
              </button>
              <button class="btn btn-outline btn-block" id="attest-ignore-btn">
                Not mine — ignore
              </button>
            </div>
          </div>
        </div>
      `;
    } else {
      this.innerHTML = `
        <div class="modal-backdrop">
          <div class="modal-card attest-card">
            <h2>Is this your key?</h2>
            <p class="text-muted mb-3" style="font-size:13.5px;line-height:1.55;">
              Publicly attesting this <code>did:key</code> belongs to your account.
              This doesn't grant it access to anything — it just tells the network you operate it.
            </p>
            <div class="key-code modal-key-code">
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
        </div>
      `;
    }

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
