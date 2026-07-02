import { generateQrImg, associationUrl } from '../main.js';

export class DkaShareSheet extends HTMLElement {
  connectedCallback() {
    this.style.display = 'none';
  }

  async show({ name, keyId }) {
    this._name = name;
    this._keyId = keyId;
    const url = associationUrl(keyId);
    const qrImg = await generateQrImg(keyId);

    this.innerHTML = `
      <div class="sheet-backdrop">
        <div class="sheet">
          <div class="sheet-handle"></div>
          <div style="font-weight:700;color:var(--text);font-size:16px;margin-bottom:4px;">
            Share "${this._escape(name)}"
          </div>
          <p class="text-muted mb-4" style="font-size:12.5px;text-align:center;">
            Anyone who scans this associates the same did:key with their own account.
          </p>
          <div class="qr-wrap mb-4">
            ${qrImg.outerHTML}
          </div>
          <div style="display:flex;gap:10px;">
            <button class="btn btn-secondary btn-block" id="sheet-copy-link">Copy Link</button>
            <button class="btn btn-secondary btn-block" id="sheet-save-img">Save Image</button>
          </div>
        </div>
      </div>
    `;

    this._url = url;
    this._qrImg = qrImg;
    this.style.display = 'block';

    this.querySelector('.sheet-backdrop').addEventListener('click', (e) => {
      if (e.target.classList.contains('sheet-backdrop')) this.hide();
    });
    this.querySelector('#sheet-copy-link').addEventListener('click', () => {
      navigator.clipboard.writeText(url).catch(() => {});
    });
    this.querySelector('#sheet-save-img').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = qrImg.src;
      a.download = `${name}-qr.png`;
      a.click();
    });
  }

  hide() {
    this.style.display = 'none';
    this.innerHTML = '';
  }

  _escape(s) {
    const el = document.createElement('span');
    el.textContent = s;
    return el.innerHTML;
  }
}

if (!customElements.get('dka-share-sheet')) {
  customElements.define('dka-share-sheet', DkaShareSheet);
}
