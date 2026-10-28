/**
 * Canonical ZKProofport circuit identifiers.
 *
 * This module is the single source of truth for circuit IDs. Every other layer
 * — the mobile app, the demo, the relay, server-side provers — reads its list
 * from here instead of keeping a private copy that silently drifts.
 *
 * It has **no imports and no dependencies**, so it can be pulled in on its own:
 *
 * ```typescript
 * import { CIRCUIT_IDS, isCircuitId } from '@zkproofport-app/sdk/circuits';
 * ```
 *
 * The same names are also re-exported from the package root
 * (`@zkproofport-app/sdk`) for callers that already import the SDK.
 *
 * ## Identifiers are canonical and case-sensitive
 *
 * Each ID is the circuit's `name` in its `Nargo.toml`, verbatim. The format is
 * lowercase with underscores. Hyphenated spellings (`coinbase-kyc`,
 * `mdl-kr-age`) are directory or UI route names in other repositories — they
 * are **not** circuit IDs, and passing one produces a nullifier mismatch or a
 * failed on-chain lookup rather than a clear error.
 */

/**
 * Whether a circuit is officially supported today or still on the roadmap.
 *
 * - `supported` — generally available. Safe to build a product on.
 * - `planned` — the identifier is reserved and the circuit exists, but it is
 *   not officially supported yet. Availability, inputs and public-input layout
 *   may change without a major version bump.
 */
export type CircuitSupportStatus = 'supported' | 'experimental' | 'planned';

/**
 * Canonical circuit identifiers, keyed by a stable constant name.
 *
 * Prefer these constants over string literals so a rename is a compile error
 * rather than a runtime surprise.
 *
 * @example
 * ```typescript
 * import { CIRCUIT_IDS } from '@zkproofport-app/sdk/circuits';
 *
 * const relay = await sdk.createRelayRequest(CIRCUIT_IDS.COINBASE_ATTESTATION, {
 *   scope: 'myapp.com',
 * });
 * ```
 */
export const CIRCUIT_IDS = Object.freeze({
  /** Coinbase KYC attestation. Officially supported. */
  COINBASE_ATTESTATION: 'coinbase_attestation',
  /** Coinbase country attestation (inclusion / exclusion). Officially supported. */
  COINBASE_COUNTRY_ATTESTATION: 'coinbase_country_attestation',
  /** OIDC email-domain attestation. Officially supported. */
  OIDC_DOMAIN_ATTESTATION: 'oidc_domain_attestation',
  /** GIWA attestation. Planned — not officially supported yet. */
  GIWA_ATTESTATION: 'giwa_attestation',
  /** Dojang Playground on GIWA Sepolia. Experimental — testnet only. */
  DOJANG_PLAYGROUND: 'dojang_playground',
  /** Korea Mobile ID ownership. Planned — not officially supported yet. */
  MDL_KR_OWNERSHIP: 'mdl_kr_ownership',
  /** Korea Mobile ID age threshold. Planned — not officially supported yet. */
  MDL_KR_AGE: 'mdl_kr_age',
  /** Korea Mobile ID si/do region. Planned — not officially supported yet. */
  MDL_KR_REGION: 'mdl_kr_region',
} as const);

/**
 * Union of every canonical circuit identifier.
 *
 * `CircuitType` (exported from the package root) is an alias of this type — the
 * two names refer to the same union, and this module is where it is defined.
 */
export type CircuitId = (typeof CIRCUIT_IDS)[keyof typeof CIRCUIT_IDS];

/**
 * Support status for every circuit.
 *
 * The record is exhaustive over {@link CircuitId}: adding an identifier without
 * giving it a status is a compile error, so this list cannot drift from
 * {@link CIRCUIT_IDS}.
 *
 * @example
 * ```typescript
 * import { CIRCUIT_SUPPORT_STATUS } from '@zkproofport-app/sdk/circuits';
 *
 * CIRCUIT_SUPPORT_STATUS.coinbase_attestation; // 'supported'
 * CIRCUIT_SUPPORT_STATUS.mdl_kr_age;           // 'planned'
 * ```
 */
export const CIRCUIT_SUPPORT_STATUS: Readonly<Record<CircuitId, CircuitSupportStatus>> =
  Object.freeze({
    coinbase_attestation: 'supported',
    coinbase_country_attestation: 'supported',
    oidc_domain_attestation: 'supported',
    // Experimental, not planned: the circuit is built, its verifier is
    // deployed on GIWA Sepolia and the demo requests it. What keeps it out of
    // 'supported' is that it is testnet-only, so the app offers it behind
    // Developer Mode and reads its files from main rather than a release tag.
    giwa_attestation: 'experimental',
    // Same footing as GIWA: built, verifier deployed on GIWA Sepolia, a real
    // proof verifies there. Testnet only.
    dojang_playground: 'experimental',
    mdl_kr_ownership: 'planned',
    mdl_kr_age: 'planned',
    mdl_kr_region: 'planned',
  } as const);

/**
 * Which circuit PACKAGE produced a proof, for a circuit id served by more than
 * one.
 *
 * A circuit id names a statement (its public inputs, their order and meaning,
 * its nullifier). A package is one Noir program that proves it, with its own
 * verification key and verifier contract. Most circuit ids have one package,
 * `standard`. `oidc_domain_attestation` and `coinbase_attestation` also have an
 * `android` package: the same public inputs, but the statement is signed by a
 * key Android key attestation vouches for instead of an iPhone App Attest key
 * or the proving server's key. That signer alone is about 1.17M gates, so it is
 * a separate 2^21 circuit rather than a branch that would push every iPhone and
 * server proof from 2^20 to 2^21.
 *
 * The variant only selects among keys and verifiers this package pins; it never
 * names one. A wrong claim selects a verifier the proof does not verify against.
 */
export type SignerVariant = 'standard' | 'android';

/** Every signer variant, `standard` first. */
export const SIGNER_VARIANTS: readonly SignerVariant[] = Object.freeze(['standard', 'android'] as const);

/** One circuit package inside the `zkproofport/circuits` repository. */
export interface CircuitPackage {
  /** Package directory, relative to the circuits repository root. */
  readonly packageDir: string;
  /** Verification key file, relative to the circuits repository root. */
  readonly vkPath: string;
  /** `Deploy<Name>.s.sol` that deploys its verifier: `<Name>`. */
  readonly deployScriptName: string;
  /**
   * log2 of the circuit size, only where a circuit id has more than one
   * package: the EVM proof's byte length follows from it (see
   * {@link evmProofByteLength}), and that length is how a proof whose result
   * does not say which package made it is told apart. Read from the first word
   * of each package's `target/vk/vk` and the `LOG_N` of its Solidity verifier.
   */
  readonly logCircuitSize?: number;
}

/**
 * The packages behind each circuit id, by signer variant. Exhaustive over
 * {@link CircuitId}: every circuit id has a `standard` package.
 *
 * `coinbase_attestation`'s `standard` package is still v1
 * (`coinbase-attestation`, 128 public inputs); its `android` package is the
 * Coinbase KYC v2 layout. This core judges coinbase_attestation by the v1
 * layout, so an android Coinbase proof is refused by its public input count
 * and has no pinned verifier until the release that adopts the v2 layout.
 */
const CIRCUIT_PACKAGE_ROWS = {
  coinbase_attestation: {
    standard: { packageDir: 'coinbase-attestation', vkPath: 'coinbase-attestation/target/vk/vk', deployScriptName: 'CoinbaseAttestation', logCircuitSize: 19 },
    android: { packageDir: 'coinbase-attestation-v2-android', vkPath: 'coinbase-attestation-v2-android/target/vk/vk', deployScriptName: 'CoinbaseAttestationV2Android', logCircuitSize: 21 },
  },
  coinbase_country_attestation: {
    standard: { packageDir: 'coinbase-country-attestation', vkPath: 'coinbase-country-attestation/target/vk/vk', deployScriptName: 'CoinbaseCountryAttestation' },
  },
  oidc_domain_attestation: {
    standard: { packageDir: 'oidc-domain-attestation', vkPath: 'oidc-domain-attestation/target/vk/vk', deployScriptName: 'OidcDomainAttestation', logCircuitSize: 20 },
    android: { packageDir: 'oidc-domain-attestation-android', vkPath: 'oidc-domain-attestation-android/target/vk/vk', deployScriptName: 'OidcDomainAttestationAndroid', logCircuitSize: 21 },
  },
  giwa_attestation: {
    standard: { packageDir: 'giwa-attestation', vkPath: 'giwa-attestation/target/vk/vk', deployScriptName: 'GiwaAttestation' },
  },
  dojang_playground: {
    standard: { packageDir: 'dojang-playground', vkPath: 'dojang-playground/target/vk/vk', deployScriptName: 'DojangPlayground' },
  },
  mdl_kr_ownership: {
    standard: { packageDir: 'mdl/kr-ownership', vkPath: 'mdl/kr-ownership/target/vk/vk', deployScriptName: 'MdlKrOwnership' },
  },
  mdl_kr_age: {
    standard: { packageDir: 'mdl/kr-age', vkPath: 'mdl/kr-age/target/vk/vk', deployScriptName: 'MdlKrAge' },
  },
  mdl_kr_region: {
    standard: { packageDir: 'mdl/kr-region', vkPath: 'mdl/kr-region/target/vk/vk', deployScriptName: 'MdlKrRegion' },
  },
} satisfies Record<CircuitId, { readonly standard: CircuitPackage } & Partial<Record<SignerVariant, CircuitPackage>>>;

// Frozen after the check, not inside it: `satisfies` on Object.freeze's result
// is a generic call's type, which skips excess-property checking, so a key that
// names no circuit id or no variant (`andriod`) would compile.
for (const row of Object.values(CIRCUIT_PACKAGE_ROWS)) {
  for (const pkg of Object.values(row)) Object.freeze(pkg);
  Object.freeze(row);
}
/** The packages behind each circuit id, by signer variant; see the table above. */
export const CIRCUIT_PACKAGES = Object.freeze(CIRCUIT_PACKAGE_ROWS);

/**
 * Where each circuit's verification key FILE lives inside the
 * `zkproofport/circuits` repository, relative to its root.
 *
 * Off-chain verification needs the verification key and nothing else — no
 * circuit bytecode, no witness. The key is public by nature: it is what anyone
 * checking a proof must already have, and the Solidity verifiers deployed
 * on-chain embed the same key.
 *
 * NOTE THE TRAILING `/vk` TWICE. In that repository `target/vk` is a DIRECTORY
 * holding `vk`, `vk_hash` and `SHA256SUMS`; the key itself is `target/vk/vk`.
 * These paths were first copied here from the mobile app, which keeps the
 * directory and the filename as two fields and joins them — so taking only the
 * directory produced a URL that answers 404, and the first browser to try
 * off-chain verification said "Could not fetch the verification key (HTTP 404)".
 *
 * The `standard` package's key ({@link CIRCUIT_PACKAGES}); a proof from another
 * package needs {@link getCircuitPackage}.
 *
 * Exhaustive over {@link CircuitId} because {@link CIRCUIT_PACKAGES} is: a new
 * circuit whose package is not listed there fails to compile rather than
 * failing at verification time, where the only symptom would be a proof that
 * cannot be checked.
 */
export const CIRCUIT_VK_PATHS: Readonly<Record<CircuitId, string>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(CIRCUIT_PACKAGES) as CircuitId[]).map(id => [id, CIRCUIT_PACKAGES[id].standard.vkPath]),
  ) as Record<CircuitId, string>,
);

/**
 * Every canonical circuit identifier, in declaration order.
 *
 * Includes circuits that are still `planned`. Use {@link SUPPORTED_CIRCUIT_IDS}
 * when you only want the ones that are officially supported today.
 */
export const ALL_CIRCUIT_IDS: readonly CircuitId[] = Object.freeze(
  Object.values(CIRCUIT_IDS) as CircuitId[]
);

/**
 * Circuits that are officially supported today: the two Coinbase circuits and
 * OIDC domain attestation.
 *
 * Derived from {@link CIRCUIT_SUPPORT_STATUS}, so it cannot fall out of sync.
 */
export const SUPPORTED_CIRCUIT_IDS: readonly CircuitId[] = Object.freeze(
  ALL_CIRCUIT_IDS.filter((id) => CIRCUIT_SUPPORT_STATUS[id] === 'supported')
);

/**
 * Circuits whose identifiers are reserved but which are not officially
 * supported yet: GIWA attestation and the three Korea Mobile ID circuits.
 *
 * Derived from {@link CIRCUIT_SUPPORT_STATUS}, so it cannot fall out of sync.
 */
/**
 * Circuits you can prove today, on a testnet, with everything subject to change.
 *
 * `giwa_attestation` is in this state. Calling it `planned` would be wrong —
 * the circuit compiles, the verifier is deployed and a proof verifies against
 * it — and calling it `supported` would be worse, because the only deployment
 * is a testnet (GIWA Sepolia). Neither existing word was true, so the honest
 * move was a third word rather than picking the closer lie.
 */
export const EXPERIMENTAL_CIRCUIT_IDS: readonly CircuitId[] = Object.freeze(
  ALL_CIRCUIT_IDS.filter(id => CIRCUIT_SUPPORT_STATUS[id] === 'experimental'),
);

export const PLANNED_CIRCUIT_IDS: readonly CircuitId[] = Object.freeze(
  ALL_CIRCUIT_IDS.filter((id) => CIRCUIT_SUPPORT_STATUS[id] === 'planned')
);

/**
 * Narrows an unknown value to a canonical circuit identifier.
 *
 * Returns `false` for hyphenated route names such as `'coinbase-kyc'`, which
 * are not circuit IDs.
 *
 * @example
 * ```typescript
 * isCircuitId('coinbase_attestation'); // true
 * isCircuitId('coinbase-kyc');         // false
 * ```
 */
export function isCircuitId(value: unknown): value is CircuitId {
  return typeof value === 'string' && (ALL_CIRCUIT_IDS as readonly string[]).includes(value);
}

/** Narrows an unknown value to a {@link SignerVariant}. */
export function isSignerVariant(value: unknown): value is SignerVariant {
  return typeof value === 'string' && (SIGNER_VARIANTS as readonly string[]).includes(value);
}

/**
 * The signer variants a circuit id has packages for, `standard` first.
 *
 * @throws Error naming the circuit when it is not a circuit id.
 */
export function signerVariantsOf(circuit: string): readonly SignerVariant[] {
  if (!isCircuitId(circuit)) {
    throw new Error(`Unknown circuit '${circuit}'. Known: ${ALL_CIRCUIT_IDS.join(', ')}.`);
  }
  const row: Partial<Record<SignerVariant, CircuitPackage>> = CIRCUIT_PACKAGES[circuit];
  return SIGNER_VARIANTS.filter(v => Object.prototype.hasOwnProperty.call(row, v));
}

/**
 * The package that proves `circuit` with `variant`'s signer.
 *
 * @throws Error naming the circuit when it is not a circuit id, and naming the
 *   circuit and its variants when it has no package for `variant`.
 */
export function getCircuitPackage(circuit: string, variant: string): CircuitPackage {
  const known = signerVariantsOf(circuit);
  if (!(known as readonly string[]).includes(variant)) {
    throw new Error(
      `Circuit '${circuit}' has no '${variant}' signer variant. Known for ${circuit}: ${known.join(', ')}.`,
    );
  }
  return (CIRCUIT_PACKAGES[circuit as CircuitId] as Partial<Record<SignerVariant, CircuitPackage>>)[variant as SignerVariant]!;
}

/**
 * Byte length of an EVM UltraHonk proof (keccak transcript, ZK) of a circuit of
 * size 2^logCircuitSize, as the relay carries it: without public inputs, with
 * the 8 pairing-point fields.
 *
 * `calculateProofSize` of the HonkVerifier bb 4.2.0-aztecnr-rc.2 writes
 * (`circuits/toolchain.env`): 82 fields that do not depend on the size, and 12
 * per log2 step (9 sumcheck univariate coefficients, 1 Gemini evaluation, 1
 * Gemini fold commitment of 2 fields). Measured: 9920 bytes at 2^19
 * (coinbase-attestation/target/proof/proof) and 10304 at 2^20
 * (coinbase-attestation-v2/target/proof/proof).
 */
export function evmProofByteLength(logCircuitSize: number): number {
  if (!Number.isInteger(logCircuitSize) || logCircuitSize < 1 || logCircuitSize > 28) {
    throw new Error(`logCircuitSize must be an integer from 1 to 28; got ${logCircuitSize}.`);
  }
  return 32 * (82 + 12 * logCircuitSize);
}

/**
 * Which package's verifier judges a proof: the variant its result claims, or
 * `standard` when the result claims none, cross-checked against the proof's
 * byte length where the circuit has more than one package.
 *
 * A result without the field is what every app before the Android signer sent,
 * so it means `standard`. It is refused when the proof has another variant's
 * length: a newer app's proof whose field was dropped on the way (a relay or a
 * dApp that copies only the fields it knows) would otherwise reach the
 * standard verifier and fail with nothing saying why. A claimed variant whose
 * proof has another variant's length is refused for the same reason.
 *
 * Nothing the sender controls makes it throw: a variant arrives from the
 * proof's sender, so a bad one is an `{ error }`. It throws only if this
 * table is inconsistent (a multi-package circuit without `logCircuitSize`),
 * which a test rules out.
 */
export function resolveSignerVariant(
  circuit: string,
  claimed: unknown,
  proofHex: string,
): { variant: SignerVariant } | { error: string } {
  if (!isCircuitId(circuit)) {
    return { error: `Unknown circuit '${circuit}'. Known: ${ALL_CIRCUIT_IDS.join(', ')}.` };
  }
  const known = signerVariantsOf(circuit);
  let variant: SignerVariant;
  if (claimed === undefined || claimed === null) {
    variant = 'standard';
  } else if (typeof claimed === 'string' && (known as readonly string[]).includes(claimed)) {
    variant = claimed as SignerVariant;
  } else {
    return {
      error: `Circuit '${circuit}' has no ${JSON.stringify(claimed)} signer variant. Known for ${circuit}: ${known.join(', ')}.`,
    };
  }
  if (known.length === 1) return { variant };

  const hex = typeof proofHex === 'string' && /^0x/i.test(proofHex) ? proofHex.slice(2) : proofHex;
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    return { error: `The ${circuit} proof is not hex bytes, so its length cannot say which package made it.` };
  }
  const bytes = hex.length / 2;
  const lengthOf = (v: SignerVariant): number => {
    const pkg = getCircuitPackage(circuit, v);
    if (pkg.logCircuitSize === undefined) {
      throw new Error(`Circuit '${circuit}' has several packages but its '${v}' package names no logCircuitSize.`);
    }
    return evmProofByteLength(pkg.logCircuitSize);
  };
  const own = lengthOf(variant);
  for (const other of known) {
    if (other === variant) continue;
    const otherLength = lengthOf(other);
    if (bytes === otherLength && otherLength !== own) {
      const said = claimed === undefined || claimed === null ? 'does not say which signer made it' : `says signerVariant '${variant}'`;
      return {
        error:
          `This ${circuit} proof is ${bytes} bytes, the length of a '${other}' proof, but its result ${said}. ` +
          `Refusing rather than checking it against the '${variant}' verifier. Pass the result's signerVariant through unchanged.`,
      };
    }
  }
  return { variant };
}

/**
 * Narrows an unknown value to a circuit identifier that is officially supported
 * today. Planned circuits return `false`.
 *
 * @example
 * ```typescript
 * isSupportedCircuitId('oidc_domain_attestation'); // true
 * isSupportedCircuitId('mdl_kr_age');              // false — planned
 * ```
 */
export function isSupportedCircuitId(value: unknown): value is CircuitId {
  return isCircuitId(value) && CIRCUIT_SUPPORT_STATUS[value] === 'supported';
}

/**
 * Returns the support status of a circuit.
 *
 * @param circuit - A canonical circuit identifier.
 * @throws Error when the value is not a canonical circuit identifier.
 *
 * @example
 * ```typescript
 * getCircuitSupportStatus('giwa_attestation'); // 'planned'
 * ```
 */
export function getCircuitSupportStatus(circuit: CircuitId): CircuitSupportStatus {
  if (!isCircuitId(circuit)) {
    throw new Error(
      `Unknown circuit '${String(circuit)}'. Expected one of: ${ALL_CIRCUIT_IDS.join(', ')}`
    );
  }
  return CIRCUIT_SUPPORT_STATUS[circuit];
}

/**
 * Whether a circuit's relay request must carry a wallet signature.
 *
 * The SDK checks this to fail fast — "Signer not set" locally beats a 401 from
 * the relay two round trips later, with nothing saying which circuit needed
 * what. The relay declares its OWN copy on purpose and does not import this
 * one: it is a security boundary, and an auth policy that a published package
 * can change is not a policy. A test in the relay asserts the two agree.
 *
 * `satisfies` and not an annotation, so a circuit added above is a compile
 * error here until somebody decides which it is.
 */
/**
 * Whether a circuit's proof can bind an EIP-712 action, and whether it must.
 *
 * ONE TABLE, because the answer was becoming a chain of `circuit === '...'`
 * tests. It was asked in the deep-link validator and again in
 * `createRelayRequest`, both spelling out one circuit id, and a second
 * action-capable circuit would have made each of them a two-branch chain that
 * ends on whatever the last test happens to be.
 *
 *   'required'  the circuit proves nothing without an action -- the wallet
 *               signs the typed data and there is no other message.
 *   'optional'  the circuit signs the action when one is supplied and
 *               personal_signs its signal hash when one is not. The circuit
 *               itself branches; see giwa-attestation/src/main.nr.
 *   'none'      the circuit has no action inputs. An action sent anyway is a
 *               caller misunderstanding, and is refused rather than dropped:
 *               silently ignoring it would let a dapp believe a proof
 *               authorized something it never mentioned.
 */
export type CircuitActionBinding = 'none' | 'required' | 'optional';

export const CIRCUIT_ACTION_BINDING = {
  coinbase_attestation: 'none',
  coinbase_country_attestation: 'none',
  // The signature lives inside the identity token; no wallet, no action.
  oidc_domain_attestation: 'none',
  // Branches in-circuit: with an action the wallet signs the typed data,
  // without one it personal_signs the request's signal hash.
  giwa_attestation: 'optional',
  // Same branch as GIWA; see dojang-playground/src/main.nr.
  dojang_playground: 'optional',
  mdl_kr_ownership: 'none',
  mdl_kr_age: 'none',
  mdl_kr_region: 'none',
} satisfies Record<CircuitId, CircuitActionBinding>;

/*
 * The union is declared above rather than derived from the table's values.
 *
 * Deriving it narrowed the type to whatever the table happens to hold today --
 * 'none' | 'optional' -- and TypeScript then called every `=== 'required'`
 * check impossible. The publish typecheck caught it; `rollup` and `vitest` did
 * not. 'required' is a state a circuit can legitimately be in (an EIP-712 path
 * and nothing else), so the union says so and the table is checked against it.
 */

/**
 * How this circuit treats an action, or an error naming the id that is not one.
 *
 * No default: a circuit nobody has classified must not inherit 'none', which
 * would silently drop an action a dapp meant to bind.
 */
export function circuitActionBinding(circuit: string): CircuitActionBinding {
  const binding = (CIRCUIT_ACTION_BINDING as Record<string, CircuitActionBinding | undefined>)[circuit];
  if (!binding) {
    throw new Error(
      `Unknown circuit '${circuit}'. Expected: ${ALL_CIRCUIT_IDS.join(', ')}`,
    );
  }
  return binding;
}

export const CIRCUIT_NEEDS_WALLET_SIGNATURE = {
  coinbase_attestation: true,
  coinbase_country_attestation: true,
  // The signature is inside the OIDC identity token, checked by the prover.
  oidc_domain_attestation: false,
  // Web2 (OmniOne CX) flows with no wallet binding at all.
  mdl_kr_ownership: false,
  mdl_kr_age: false,
  mdl_kr_region: false,
  // A GIWA-attested wallet signing an EIP-712 action (or its signal hash).
  // This read `false` while the circuit had always verified a wallet signature
  // -- it sat under the Web2 comment above and was never revisited. A request
  // for it would have reached the relay with no signer.
  giwa_attestation: true,
  // The wallet signs the request, and the same key must have signed its
  // Playground faucet transaction.
  dojang_playground: true,
} satisfies Record<CircuitId, boolean>;
