export class VaultChip extends HTMLElement {
  static get observedAttributes() { return ['service']; }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }

  render() {
    const svc = this.getAttribute('service') || '*';
    const isAll = svc === '*';
    const kind = isAll ? 'all' : this._chipKind(svc);
    this.className = `chip chip-${kind}`;
    this.textContent = isAll ? 'all services' : svc.replace(/_/g, ' ');
    if (kind === 'service') this.style.setProperty('--chip-hue', this._hashHue(svc));
  }

  _chipKind(svc) {
    if (svc === 'bidder_service') return 'bidder-service';
    if (svc === 'requester_associate') return 'requester-associate';
    return 'service';
  }

  _hashHue(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h % 360);
  }
}

if (!customElements.get('vault-chip')) {
  customElements.define('vault-chip', VaultChip);
}
