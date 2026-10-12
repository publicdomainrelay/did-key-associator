import { DID_KEY_ASSOCIATOR_OAUTH_SCOPE } from "@publicdomainrelay/oauth-scope";
import { GENERATED_OAUTH_SCOPE_PATH, renderOauthScopeModule } from "./scripts/oauth-scope-module.ts";

const ROOT = import.meta.dirname;
const DIST = ROOT + "/dist";

try { await Deno.mkdir(DIST, { recursive: true }); } catch { /* exists */ }

const generatedPath = `${ROOT}/${GENERATED_OAUTH_SCOPE_PATH}`;
const generated = renderOauthScopeModule();
let existing: string | null = null;
try {
  existing = await Deno.readTextFile(generatedPath);
} catch {
  existing = null;
}
if (existing === null) {
  await Deno.writeTextFile(generatedPath, generated);
} else if (existing !== generated) {
  console.error(
    `${GENERATED_OAUTH_SCOPE_PATH} out of sync with @publicdomainrelay/oauth-scope; regenerated, commit the change`,
  );
  await Deno.writeTextFile(generatedPath, generated);
  Deno.exit(1);
}

const bundleCmd = new Deno.Command("deno", {
  args: [
    "bundle", "--platform", "browser", "--minify",
    "--sourcemap=external", "--outdir", DIST,
    "components/dka-app.js",
  ],
  stdout: "inherit", stderr: "inherit",
});
const bundleStatus = await bundleCmd.output();
if (!bundleStatus.success) Deno.exit(bundleStatus.code);

// 2. Static assets. oauth-client-metadata.json scope is injected from the
//    oauth-scope package — the source file carries no scope field.
await Deno.copyFile(`${ROOT}/styles.css`, `${DIST}/styles.css`);
const metadata = JSON.parse(
  await Deno.readTextFile(`${ROOT}/oauth-client-metadata.json`),
) as Record<string, unknown>;
metadata.scope = DID_KEY_ASSOCIATOR_OAUTH_SCOPE.join(" ");
await Deno.writeTextFile(
  `${DIST}/oauth-client-metadata.json`,
  JSON.stringify(metadata, null, 2) + "\n",
);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="referrer" content="origin-when-cross-origin">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Associate did:key cryptographic identifiers with your AT Protocol account. Public attestation, not access grant.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="./styles.css">
  <title>DID Key Associator</title>
</head>
<body>
  <dka-app></dka-app>
  <script type="module" src="./dka-app.js?v=${Date.now()}"></script>
</body>
</html>
`;
await Deno.writeTextFile(`${DIST}/index.html`, html);

console.log("Build complete → dist/");
