/**
 * The scope (and OPRF domain) a wallet credential request may carry, checked
 * where a request is CREATED, so a request the OPRF node would refuse never
 * reaches a person's wallet and phone.
 *
 * A wallet credential circuit's scope is an OPRF name: the wallet signs it in
 * the OPRF request, and the node accepts only 1-256 UTF-8 bytes with no
 * control (Cc) or format (Cf) character (core's `oprfNameError`, the rules of
 * proofport-oprf `auth::check_name`). Without this check the request is
 * accepted here, the person signs, and the node refuses -- after the person
 * has waited. The SDK's own rule that a scope is not blank stays on top (the
 * node would accept " ").
 *
 * OIDC is not a wallet credential and has no OPRF name; its scope keeps the
 * rules it had (non-blank; 4096 bytes in the nonce binding, ./oidcPolicy).
 */
import { OPRF_PUBLIC_INPUT_LAYOUTS, isCircuitId, oprfNameError } from '@zkproofport-app/core';

/** Why this request's scope / oprfDomain cannot be used for `circuit`, or null. */
export function requestScopeError(circuit: string, inputs: unknown): string | null {
  if (!isCircuitId(circuit)) return null; // the callers refuse unknown circuits themselves, by name
  // OIDC: not a wallet credential; its scope rules live where they were.
  if (OPRF_PUBLIC_INPUT_LAYOUTS[circuit] === null) return null;
  const i = (inputs ?? {}) as { scope?: unknown; oprfDomain?: unknown };
  if (typeof i.scope !== 'string' || i.scope.trim() === '') {
    return `scope is required for ${circuit} circuit and must be a non-empty string`;
  }
  const why = oprfNameError(i.scope);
  if (why !== null) {
    return `scope cannot be used for ${circuit}: ${why} (at most 256 UTF-8 bytes, no control or invisible formatting characters)`;
  }
  if (i.oprfDomain !== undefined) {
    const domainWhy = oprfNameError(i.oprfDomain);
    if (domainWhy !== null) return `oprfDomain cannot be used for ${circuit}: ${domainWhy}`;
  }
  return null;
}

/** An IPv4 literal, or an IPv6 one as URL.hostname writes it ("[::1]"). */
const IP_HOST = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/i;

/**
 * The OPRF domain of a wallet credential request: the one the dApp passed
 * (`inputs.oprfDomain`), else -- only in a browser -- the page's own
 * hostname, lowercased (no scheme, port or path). The same rule as other
 * nullifier SDKs: inferred in the browser, explicit on a server.
 *
 * Never a fallback: outside a browser, or on a page with no usable hostname
 * (file:, about:blank, data:, an IP address), it throws naming `oprfDomain`.
 * Returns the inputs unchanged when the dApp passed one, a copy with
 * `oprfDomain` filled when the page supplied it, and the inputs unchanged for
 * a circuit with no OPRF nullifier.
 */
export function withOprfDomain<T>(circuit: string, inputs: T): T {
  if (!isCircuitId(circuit) || OPRF_PUBLIC_INPUT_LAYOUTS[circuit] === null) return inputs;
  const given = (inputs as { oprfDomain?: unknown } | null | undefined)?.oprfDomain;
  if (given !== undefined) return inputs;
  const host = browserHostname();
  if (typeof host !== 'string') {
    throw new Error(
      `oprfDomain is required for ${circuit}: ${host.why} Pass your dApp's domain, e.g. { oprfDomain: 'myapp.com' }.`,
    );
  }
  const why = oprfNameError(host);
  if (why !== null) throw new Error(`oprfDomain for ${circuit}: this page's hostname cannot be an OPRF name (${why}). Pass oprfDomain.`);
  return { ...(inputs as object), oprfDomain: host } as T;
}

function browserHostname(): string | { why: string } {
  const g = globalThis as { window?: unknown; location?: { protocol?: unknown; hostname?: unknown } };
  if (typeof g.window === 'undefined' || !g.location || typeof g.location !== 'object') {
    return { why: 'it is inferred from the page only in a browser, and this is not one.' };
  }
  const { protocol, hostname } = g.location;
  if (protocol !== 'https:' && protocol !== 'http:') {
    return { why: `this page (${String(protocol)}) has no web hostname to infer it from.` };
  }
  if (typeof hostname !== 'string' || hostname === '') {
    return { why: 'this page has no hostname to infer it from.' };
  }
  if (IP_HOST.test(hostname)) {
    return { why: `this page is served from an IP address (${hostname}), which is not a domain.` };
  }
  return hostname.toLowerCase();
}
