import { BrowserOAuthClient } from '@atproto/oauth-client-browser'
import { Agent } from '@atproto/api'

const BADGE_BLUE_KEYS_NSID = 'com.publicdomainrelay.temp.badgeBlueKeys';

function buildClientID() {
	const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
	if (isLocal) {
		return `http://localhost?${new URLSearchParams({
			scope: `atproto repo:${BADGE_BLUE_KEYS_NSID}?action=create`,
			redirect_uri: Object.assign(new URL(window.location.origin), { hostname: '127.0.0.1' }).href,
		})}`
	}
	return `https://${window.location.host}/oauth-client-metadata.json`
}
const clientId = buildClientID();

let oac;
let agent;
let sessionHandle;
let qrStream = null; // active MediaStream for QR scanner

// --- QR code scanning (BarcodeDetector API, Chrome/Edge/Safari 17+) ---

function isBarcodeDetectorSupported() {
	return 'BarcodeDetector' in window;
}

async function startQRScanner() {
	const container = document.getElementById("qr-scanner-container");
	const video = document.getElementById("qr-video");
	const status = document.getElementById("qr-scan-status");

	if (!isBarcodeDetectorSupported()) {
		status.textContent = "BarcodeDetector not available in this browser. Try Chrome, Edge, or Safari 17+.";
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
		status.textContent = "Scanning... point camera at a QR code containing a did:key string.";
		status.style.color = "inherit";

		const detector = new BarcodeDetector({ formats: ['qr_code'] });

		const scan = async () => {
			if (!qrStream) return;
			try {
				const barcodes = await detector.detect(video);
				if (barcodes.length > 0) {
					const value = barcodes[0].rawValue;
					if (value.startsWith('did:key:')) {
						document.getElementById("did-key").value = value;
						status.textContent = `Captured: ${value.slice(0, 40)}...`;
						status.style.color = "#4CAF50";
						stopQRScanner();
					} else {
						status.textContent = `Scanned "${value.slice(0, 60)}" — not a did:key. Keep scanning.`;
						status.style.color = "#E37474";
					}
				}
			} catch (e) {
				// BarcodeDetector may throw on some frames; ignore
			}
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

// --- Fetch and render badgeBlueKeys records ---

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

			recs.forEach(rec => {
				const v = rec.value;
				const li = document.createElement('li');
				li.className = 'key-list-item';

				const keyIdStrong = document.createElement('strong');
				keyIdStrong.textContent = 'did:key';

				const dateSmall = document.createElement('small');
				if (v.createdAt) {
					dateSmall.textContent = ` (Created: ${new Date(v.createdAt).toLocaleDateString()})`;
					dateSmall.style.color = "var(--pico-muted-color)";
				}

				const br = document.createElement('br');

				const keyIdCode = document.createElement('code');
				keyIdCode.textContent = v.keyId;
				keyIdCode.style.fontSize = "0.85em";
				keyIdCode.style.display = "block";
				keyIdCode.style.marginTop = "0.5rem";
				keyIdCode.style.padding = "0.5rem";
				keyIdCode.style.backgroundColor = "var(--pico-code-background-color)";

				const pdslsLink = document.createElement('a');
				pdslsLink.href = `https://pdsls.dev/${rec.uri}`;
				pdslsLink.target = "_blank";
				pdslsLink.textContent = "View on pdsls.dev";
				pdslsLink.style.fontSize = "0.8em";
				pdslsLink.style.display = "inline-block";
				pdslsLink.style.marginTop = "0.25rem";

				li.appendChild(keyIdStrong);
				li.appendChild(dateSmall);
				li.appendChild(br);
				li.appendChild(keyIdCode);
				li.appendChild(pdslsLink);
				ul.appendChild(li);
			});

			article.appendChild(ul);
			listContainer.appendChild(article);
		}

	} catch (err) {
		listContainer.removeAttribute("aria-busy");
		listContainer.innerHTML = `<p style="color: #E37474;">Error loading keys: ${err.message}</p>`;
	}
}

// --- Init ---

async function init() {
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
		const service = document.getElementById("service").value.trim() || "*";
		doAssociate(didKey, service);
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

async function doAssociate(didKey, service) {
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

	await fetchAndRenderKeys();

	document.getElementById("associate-form").reset();
	document.getElementById("associate-form-error").innerText = "";
}

document.addEventListener('DOMContentLoaded', init);
