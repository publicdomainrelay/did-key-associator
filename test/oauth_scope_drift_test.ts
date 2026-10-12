import { assertEquals, assertNotEquals } from "@std/assert";
import { BIDDER_OAUTH_SCOPE, DID_KEY_ASSOCIATOR_OAUTH_SCOPE } from "@publicdomainrelay/oauth-scope";
import {
  GENERATED_OAUTH_SCOPE_PATH,
  oauthScopeDrift,
  renderOauthScopeModule,
} from "../scripts/oauth-scope-module.ts";

const VM_TERMINATED_SCOPE = "repo:com.publicdomainrelay.temp.compute.events.vm.terminated?action=create";
const GENERATED = new URL(`../${GENERATED_OAUTH_SCOPE_PATH}`, import.meta.url);

Deno.test("the committed generated/oauth-scope.js is what the generator produces from typescript-helpers", async () => {
  const committed = await Deno.readTextFile(GENERATED);
  assertEquals(oauthScopeDrift(committed), { missing: [], extra: [] });
  assertEquals(committed, renderOauthScopeModule());
});

Deno.test("a generated file that predates the bidder's vm.terminated grant is reported as drift", () => {
  const stale = renderOauthScopeModule(
    DID_KEY_ASSOCIATOR_OAUTH_SCOPE.filter((t) => t !== VM_TERMINATED_SCOPE),
  );
  assertNotEquals(stale, renderOauthScopeModule());
  assertEquals(oauthScopeDrift(stale), { missing: [VM_TERMINATED_SCOPE], extra: [] });
});

Deno.test("the QR client scope covers every bidder scope token", () => {
  const full = new Set(DID_KEY_ASSOCIATOR_OAUTH_SCOPE);
  assertEquals(BIDDER_OAUTH_SCOPE.filter((t) => !full.has(t)), []);
});
