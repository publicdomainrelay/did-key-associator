export class VaultChip extends HTMLElement {
  static get observedAttributes() { return ['service']; }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }

  render() {
    const svc = this.getAttribute('service') || '*';
    const isAll = svc === '*';
    this.className = `chip ${isAll ? 'chip-all' : 'chip-service'}`;
    this.textContent = isAll ? 'all services' : svc;
  }
}

if (!customElements.get('vault-chip')) {
  customElements.define('vault-chip', VaultChip);
}
