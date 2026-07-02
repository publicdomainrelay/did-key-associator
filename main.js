import { BrowserOAuthClient } from '@atproto/oauth-client-browser'
import { Agent } from '@atproto/api'
import { toDataURL } from 'qrcode';

const BADGE_BLUE_KEYS_NSID = 'com.publicdomainrelay.temp.badgeBlueKeys';

function buildClientID() {
	const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
	if (isLocal) {
		return `http://localhost?${new URLSearchParams({
			scope: `atproto repo:${BADGE_BLUE_KEYS_NSID}?action=create,update,delete`,
			redirect_uri: Object.assign(new URL(window.location.origin), { hostname: '127.0.0.1' }).href,
		})}`
	}
	return `https://${window.location.host}/oauth-client-metadata.json`
}
const clientId = buildClientID();

let oac;
let agent;
let sessionHandle;
let qrStream = null;

// --- Utilities ---

function randomName() {
	const adj = ['bold','calm','cool','dark','fair','fast','keen','lean','neat','pure','rare','safe','sharp','swift','warm','wise'];
	const noun = ['aurora','badge','beacon','blaze','cipher','crest','echo','falcon','glint','haven','latch','nexus','pulse','quill','ridge','sigil','spark','torch','verge','woven'];
	const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
	return `${rand(adj)}-${rand(noun)}`;
}

function parseRkey(uri) {
	const parts = uri.split('/');
	return parts[parts.length - 1];
}

function getHashDid() {
	const hash = window.location.hash.slice(1);
	if (!hash) return null;
	// May be a full URL (from QR deep link) or bare did:key/did:plc
	if (hash.startsWith('did:key:') || hash.startsWith('did:plc:')) return hash;
	// Try to parse as URL, extract hash from it
	try {
		const u = new URL(hash);
		const inner = u.hash.slice(1);
		if (inner.startsWith('did:key:') || inner.startsWith('did:plc:')) return inner;
	} catch {}
	return null;
}

function associationUrl(didKey) {
	return `${window.location.origin}${window.location.pathname}#${encodeURIComponent(didKey)}`;
}

// --- QR code scanning ---

function isBarcodeDetectorSupported() {
	return 'BarcodeDetector' in window;
}

async function startQRScanner() {
	const container = document.getElementById("qr-scanner-container");
	const video = document.getElementById("qr-video");
	const status = document.getElementById("qr-scan-status");

	if (!isBarcodeDetectorSupported()) {
		status.textContent = "BarcodeDetector not available. Try Chrome, Edge, or Safari 17+.";
		status.style.color = "#E37474";
		container.style.display = "block";
		return;
	}

	try {
		qrStream = await navigator.mediaDevices.getUserMedia({
			video: { facingMode: "environment" }
		});
		video.srcObject = qrStream;
		container.style.display = "block";
		status.textContent = "Scanning... point camera at a QR code.";
		status.style.color = "inherit";

		const detector = new BarcodeDetector({ formats: ['qr_code'] });

		const scan = async () => {
			if (!qrStream) return;
			try {
				const barcodes = await detector.detect(video);
				if (barcodes.length > 0) {
					const value = barcodes[0].rawValue;
					// Could be bare did:key or our association URL
					let did = value;
					if (did.startsWith('did:key:') || did.startsWith('did:plc:')) {
						// bare did
					} else {
						// Try parsing as URL, extract fragment
						try {
							const u = new URL(value);
							const inner = u.hash.slice(1);
							if (inner.startsWith('did:key:') || inner.startsWith('did:plc:')) did = inner;
						} catch {}
					}
					if (did.startsWith('did:key:') || did.startsWith('did:plc:')) {
						document.getElementById("did-key").value = did;
						status.textContent = `Captured: ${did.slice(0, 50)}...`;
						status.style.color = "#4CAF50";
						stopQRScanner();
					} else {
						status.textContent = `Scanned but not a did:key/did:plc. Keep scanning.`;
						status.style.color = "#E37474";
					}
				}
			} catch (e) { /* BarcodeDetector may throw on some frames */ }
			if (qrStream) requestAnimationFrame(scan);
		};
		requestAnimationFrame(scan);
	} catch (err) {
		status.textContent = `Camera error: ${err.message}`;
		status.style.color = "#E37474";
		container.style.display = "block";
	}
}

function stopQRScanner() {
	if (qrStream) {
		qrStream.getTracks().forEach(t => t.stop());
		qrStream = null;
	}
	document.getElementById("qr-scanner-container").style.display = "none";
	document.getElementById("qr-video").srcObject = null;
}

// --- QR code generation ---

async function generateQrImg(didKey) {
	const url = associationUrl(didKey);
	const dataUrl = await toDataURL(url, { width: 180, margin: 2, color: { dark: '#000', light: '#fff' } });
	const img = document.createElement('img');
	img.src = dataUrl;
	img.className = 'qr-code-img';
	img.alt = `QR code for ${didKey}`;
	img.title = url;
	return img;
}

// --- Fetch and render keys ---

async function fetchAndRenderKeys() {
	const listContainer = document.getElementById("keys-list");
	listContainer.setAttribute("aria-busy", "true");
	listContainer.innerHTML = "";

	let records = [];
	let cursor = undefined;

	try {
		while (cursor === undefined || cursor != null) {
			const res = await agent.com.atproto.repo.listRecords({
				repo: agent.did,
				collection: BADGE_BLUE_KEYS_NSID,
				cursor: cursor,
			});

			if (!res.success) throw new Error(JSON.stringify(res));

			records.push(...res.data.records);

			if (typeof res.data.cursor === "string") {
				cursor = res.data.cursor;
			} else {
				cursor = null;
			}
		}

		listContainer.removeAttribute("aria-busy");

		if (records.length === 0) {
			listContainer.innerHTML = "<p><em>No associated keys found. Add one above!</em></p>";
			return;
		}

		// Group by service
		const byService = {};
		for (const rec of records) {
			const svc = rec.value.service || '*';
			if (!(svc in byService)) byService[svc] = [];
			byService[svc].push(rec);
		}

		for (const [service, recs] of Object.entries(byService)) {
			const article = document.createElement('article');

			const serviceHeader = document.createElement('h3');
			if (service === "*") {
				serviceHeader.textContent = "* (valid for all services)";
			} else {
				serviceHeader.textContent = `Service: ${service}`;
			}
			article.appendChild(serviceHeader);

			const ul = document.createElement('ul');
			ul.style.listStyleType = 'none';
			ul.style.paddingLeft = '0';

			for (const rec of recs) {
				const v = rec.value;
				const rkey = parseRkey(rec.uri);
				const li = document.createElement('li');
				li.className = 'key-list-item';
				li.id = `key-${rkey}`;

				// --- Name row (editable) ---
				const nameRow = document.createElement('div');
				nameRow.className = 'inline-edit';
				nameRow.style.marginBottom = '0.25rem';

				const nameDisplay = document.createElement('strong');
				nameDisplay.textContent = v.name || 'unnamed';
				nameDisplay.id = `name-display-${rkey}`;

				const nameInput = document.createElement('input');
				nameInput.type = 'text';
				nameInput.value = v.name || '';
				nameInput.id = `name-input-${rkey}`;
				nameInput.style.display = 'none';
				nameInput.style.fontSize = '0.9em';

				const nameSaveBtn = document.createElement('button');
				nameSaveBtn.textContent = 'Save';
				nameSaveBtn.className = 'secondary';
				nameSaveBtn.style.display = 'none';
				nameSaveBtn.style.fontSize = '0.75em';
				nameSaveBtn.style.padding = '0.1rem 0.4rem';

				const nameCancelBtn = document.createElement('button');
				nameCancelBtn.textContent = 'Cancel';
				nameCancelBtn.className = 'outline';
				nameCancelBtn.style.display = 'none';
				nameCancelBtn.style.fontSize = '0.75em';
				nameCancelBtn.style.padding = '0.1rem 0.4rem';

				nameRow.appendChild(nameDisplay);
				nameRow.appendChild(nameInput);
				nameRow.appendChild(nameSaveBtn);
				nameRow.appendChild(nameCancelBtn);

				// --- Date ---
				const dateSmall = document.createElement('small');
				if (v.createdAt) {
					dateSmall.textContent = `Created: ${new Date(v.createdAt).toLocaleDateString()}`;
					dateSmall.style.color = "var(--pico-muted-color)";
				}

				// --- keyId code ---
				const keyIdCode = document.createElement('code');
				keyIdCode.textContent = v.keyId;
				keyIdCode.style.fontSize = "0.8em";
				keyIdCode.style.display = "block";
				keyIdCode.style.marginTop = "0.35rem";
				keyIdCode.style.padding = "0.4rem";
				keyIdCode.style.backgroundColor = "var(--pico-code-background-color)";

				// --- QR code container ---
				const qrContainer = document.createElement('div');
				qrContainer.id = `qr-${rkey}`;
				qrContainer.style.display = 'none';

				// --- Actions ---
				const actions = document.createElement('div');
				actions.className = 'key-actions';

				const renameBtn = document.createElement('button');
				renameBtn.textContent = 'Rename';
				renameBtn.className = 'secondary outline';
				renameBtn.title = 'Rename this key';

				const qrBtn = document.createElement('button');
				qrBtn.textContent = 'Show QR';
				qrBtn.className = 'secondary outline';
				qrBtn.title = 'Show QR code for sharing';

				const pdslsLink = document.createElement('a');
				pdslsLink.href = `https://pdsls.dev/${rec.uri}`;
				pdslsLink.target = "_blank";
				pdslsLink.textContent = "pdsls";
				pdslsLink.style.fontSize = "0.75em";
				pdslsLink.style.padding = "0.2rem 0.5rem";
				pdslsLink.style.textDecoration = "none";

				const deleteBtn = document.createElement('button');
				deleteBtn.textContent = 'Delete';
				deleteBtn.className = 'outline';
				deleteBtn.style.color = 'var(--pico-del-color)';
				deleteBtn.style.borderColor = 'var(--pico-del-color)';
				deleteBtn.title = 'Delete this key association';

				actions.appendChild(renameBtn);
				actions.appendChild(qrBtn);
				actions.appendChild(pdslsLink);
				actions.appendChild(document.createTextNode(' '));
				actions.appendChild(deleteBtn);

				// --- Wire rename ---
				renameBtn.onclick = () => {
					const editing = nameInput.style.display !== 'none';
					if (editing) {
						// Cancel editing
						nameDisplay.style.display = '';
						nameInput.style.display = 'none';
						nameSaveBtn.style.display = 'none';
						nameCancelBtn.style.display = 'none';
					} else {
						nameDisplay.style.display = 'none';
						nameInput.style.display = '';
						nameInput.value = nameDisplay.textContent === 'unnamed' ? '' : nameDisplay.textContent;
						nameSaveBtn.style.display = '';
						nameCancelBtn.style.display = '';
						nameInput.focus();
					}
				};

				nameCancelBtn.onclick = () => {
					nameDisplay.style.display = '';
					nameInput.style.display = 'none';
					nameSaveBtn.style.display = 'none';
					nameCancelBtn.style.display = 'none';
				};

				nameSaveBtn.onclick = async () => {
					const newName = nameInput.value.trim() || 'unnamed';
					await doRename(rec, rkey, newName);
					nameDisplay.textContent = newName;
					nameDisplay.style.display = '';
					nameInput.style.display = 'none';
					nameSaveBtn.style.display = 'none';
					nameCancelBtn.style.display = 'none';
				};

				nameInput.onkeydown = (e) => {
					if (e.key === 'Enter') nameSaveBtn.click();
					if (e.key === 'Escape') nameCancelBtn.click();
				};

				// --- Wire QR toggle ---
				let qrLoaded = false;
				qrBtn.onclick = async () => {
					if (qrContainer.style.display === 'none') {
						qrContainer.style.display = 'block';
						qrBtn.textContent = 'Hide QR';
						if (!qrLoaded) {
							qrContainer.innerHTML = '';
							qrContainer.appendChild(await generateQrImg(v.keyId));
							qrLoaded = true;
						}
					} else {
						qrContainer.style.display = 'none';
						qrBtn.textContent = 'Show QR';
					}
				};

				// --- Wire delete ---
				deleteBtn.onclick = async () => {
					if (!confirm(`Delete association for key "${v.name || v.keyId.slice(0, 30)}..."?`)) return;
					deleteBtn.setAttribute("aria-busy", "true");
					await doDelete(rkey);
					// Re-render the list
					await fetchAndRenderKeys();
				};

				// --- Assemble ---
				li.appendChild(nameRow);
				li.appendChild(dateSmall);
				li.appendChild(keyIdCode);
				li.appendChild(actions);
				li.appendChild(qrContainer);
				ul.appendChild(li);
			}

			article.appendChild(ul);
			listContainer.appendChild(article);
		}

	} catch (err) {
		listContainer.removeAttribute("aria-busy");
		listContainer.innerHTML = `<p style="color: #E37474;">Error loading keys: ${err.message}</p>`;
	}
}

// --- CRUD operations ---

async function doRename(rec, rkey, newName) {
	try {
		const updated = { ...rec.value, name: newName };
		const res = await agent.com.atproto.repo.putRecord({
			repo: agent.did,
			collection: BADGE_BLUE_KEYS_NSID,
			rkey,
			record: updated,
		});
		if (!res.success) throw new Error(JSON.stringify(res));
	} catch (err) {
		alert(`Rename failed: ${err.message}`);
	}
}

async function doDelete(rkey) {
	try {
		const res = await agent.com.atproto.repo.deleteRecord({
			repo: agent.did,
			collection: BADGE_BLUE_KEYS_NSID,
			rkey,
		});
		if (!res.success) throw new Error(JSON.stringify(res));
	} catch (err) {
		alert(`Delete failed: ${err.message}`);
		throw err;
	}
}

// --- Init ---

async function init() {
	// Form handlers
	document.getElementById("login-form").onsubmit = function(e) {
		e.preventDefault();
		doLogin(e.target.username.value);
	}

	document.getElementById("bsky-button").onclick = function() {
		doLogin("https://bsky.social");
	}

	document.getElementById("associate-form").onsubmit = function(e) {
		e.preventDefault();
		const didKey = document.getElementById("did-key").value.trim();
		const name = document.getElementById("name").value.trim() || randomName();
		const service = document.getElementById("service").value.trim() || "*";
		doAssociate(didKey, name, service);
	}

	document.getElementById("hash-confirm-button").onclick = function() {
		const didKey = document.getElementById("did-key").value.trim();
		const name = document.getElementById("name").value.trim() || randomName();
		const service = document.getElementById("service").value.trim() || "*";
		doAssociate(didKey, name, service);
	}

	document.getElementById("scan-qr-button").onclick = function() {
		startQRScanner();
	}

	document.getElementById("qr-stop-button").onclick = function() {
		stopQRScanner();
	}

	document.getElementById("logout-nav").onclick = function() {
		oac.revoke(agent.did);
		window.location.reload();
	}

	// OAuth init
	try {
		oac = await BrowserOAuthClient.load({
			clientId,
			handleResolver: 'https://bsky.social',
		});
		const result = await oac.init();

		if (result) {
			const { session, state } = result
			if (state != null) {
				console.log(`${session.sub} was successfully authenticated (state: ${state})`)
			} else {
				console.log(`${session.sub} was restored (last active session)`)
			}

			agent = new Agent(session);

			const res = await agent.com.atproto.server.getSession();
			if (!res.success) {
				console.log("getSession failed", res);
				throw new Error(JSON.stringify(res));
			}

			sessionHandle = res.data.handle;
			document.getElementById("welcome-message").innerText = `@${res.data.handle}`;
			document.getElementById("associate-container").style.display = "inherit";
			document.getElementById("keys-list-container").style.display = "inherit";
			document.getElementById("logout-nav").style.display = "inherit";

			// Check URL hash for pre-filled did
			const hashDid = getHashDid();
			if (hashDid) {
				document.getElementById("did-key").value = hashDid;
				document.getElementById("hash-did-display").textContent = hashDid;
				document.getElementById("hash-confirm-banner").style.display = "inherit";
				document.getElementById("name").focus();
			}

			await fetchAndRenderKeys();

		} else {
			document.getElementById("login-container").style.display = "inherit";
		}
	} catch (error) {
		const msg = `An error occured: ${error}`;
		document.getElementById("loading-error").innerText = msg;
		document.getElementById("loading-error").style.display = "inherit";
		return;
	}

	document.getElementById("loading-spinner").style.display = "none";
	console.log("init done");
}

async function doLogin(identifier) {
	const loginButton = document.getElementById("login-button");
	loginButton.setAttribute("aria-busy", "true");
	try {
		await oac.signIn(identifier, {
			state: 'some value needed later',
			signal: new AbortController().signal,
		})
		console.log('Never executed');
	} catch (err) {
		document.getElementById("login-form-error").innerText = `Login error: ${err}`;
	}
	loginButton.removeAttribute("aria-busy");
}

async function doAssociate(didKey, name, service) {
	const button = document.getElementById("associate-button");
	button.setAttribute("aria-busy", "true");

	let res;
	try {
		res = await agent.com.atproto.repo.createRecord({
			repo: agent.did,
			collection: BADGE_BLUE_KEYS_NSID,
			record: {
				$type: BADGE_BLUE_KEYS_NSID,
				keyId: didKey,
				name: name,
				challenge: agent.did,
				service: service,
				createdAt: new Date().toISOString(),
			},
		});

		if (!res.success) throw new Error(JSON.stringify(res));
	} catch (err) {
		document.getElementById("associate-form-error").innerText = `${err}`;
		button.removeAttribute("aria-busy");
		return;
	}

	const atUri = res.data.uri;
	button.removeAttribute("aria-busy");
	document.getElementById("success-pdsls").href = `https://pdsls.dev/${atUri}`;
	document.getElementById("success-container").style.display = "inherit";

	// Hide hash banner after association
	document.getElementById("hash-confirm-banner").style.display = "none";

	// Clear hash from URL without reload
	if (window.location.hash) {
		history.replaceState(null, '', window.location.pathname + window.location.search);
	}

	await fetchAndRenderKeys();

	document.getElementById("associate-form").reset();
	document.getElementById("associate-form-error").innerText = "";
}

document.addEventListener('DOMContentLoaded', init);
