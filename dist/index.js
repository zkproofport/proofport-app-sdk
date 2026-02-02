'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var QRCode = require('qrcode');
var ethers = require('ethers');

/**
 * ZKProofPort SDK Constants
 */
/**
 * Default deep link scheme
 */
const DEFAULT_SCHEME = 'zkproofport';
/**
 * Deep link hosts
 */
const DEEP_LINK_HOSTS = {
    PROOF_REQUEST: 'proof-request',
    PROOF_RESPONSE: 'proof-response',
};
/**
 * Circuit metadata
 */
const CIRCUIT_METADATA = {
    coinbase_attestation: {
        name: 'Coinbase KYC',
        description: 'Prove Coinbase identity verification',
        publicInputsCount: 2,
        publicInputNames: ['signal_hash', 'signer_list_merkle_root'],
    },
    coinbase_country_attestation: {
        name: 'Coinbase Country',
        description: 'Prove Coinbase country verification',
        publicInputsCount: 14,
        publicInputNames: ['signal_hash', 'signer_list_merkle_root', 'country_list', 'country_list_length', 'is_included'],
    },
};
/**
 * Standard verifier contract ABI (shared across all circuits)
 */
const VERIFIER_ABI = [
    'function verify(bytes calldata _proof, bytes32[] calldata _publicInputs) external view returns (bool)',
];
/**
 * RPC endpoints by chain ID
 */
const RPC_ENDPOINTS = {
    84532: 'https://sepolia.base.org', // Base Sepolia
    8453: 'https://mainnet.base.org', // Base Mainnet
};
/**
 * Request expiry time (default: 10 minutes)
 */
const DEFAULT_REQUEST_EXPIRY_MS = 10 * 60 * 1000;
/**
 * Maximum QR code data size (bytes)
 */
const MAX_QR_DATA_SIZE = 2953; // Version 40 with L error correction
const COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT = {
    SIGNAL_HASH_START: 0,
    SIGNAL_HASH_END: 31,
    MERKLE_ROOT_START: 32,
    MERKLE_ROOT_END: 63,
    SCOPE_START: 64,
    SCOPE_END: 95,
    NULLIFIER_START: 96,
    NULLIFIER_END: 127,
};
const COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT = {
    SIGNAL_HASH_START: 0,
    SIGNAL_HASH_END: 31,
    MERKLE_ROOT_START: 32,
    MERKLE_ROOT_END: 63,
    COUNTRY_LIST_START: 64,
    COUNTRY_LIST_END: 83,
    COUNTRY_LIST_LENGTH: 84,
    IS_INCLUDED: 85,
    SCOPE_START: 86,
    SCOPE_END: 117,
    NULLIFIER_START: 118,
    NULLIFIER_END: 149,
};
const NULLIFIER_REGISTRY_ABI = [
    'function registerCircuit(bytes32 _circuitId, address _verifier, uint256 _scopeIndex, uint256 _nullifierIndex) external',
    'function updateCircuit(bytes32 _circuitId, address _newVerifier, uint256 _scopeIndex, uint256 _nullifierIndex) external',
    'function verifyAndRegister(bytes32 _circuitId, bytes calldata _proof, bytes32[] calldata _publicInputs) external returns (bool)',
    'function isNullifierUsed(bytes32 _nullifier) external view returns (bool)',
    'function getScope(bytes32 _nullifier) external view returns (bytes32)',
    'function getCircuit(bytes32 _nullifier) external view returns (bytes32)',
    'function verifyOnly(bytes32 _circuitId, bytes calldata _proof, bytes32[] calldata _publicInputs) external view returns (bool)',
    'event CircuitRegistered(bytes32 indexed circuitId, address verifier)',
    'event CircuitUpdated(bytes32 indexed circuitId, address newVerifier)',
    'event NullifierRegistered(bytes32 indexed nullifier, bytes32 indexed scope, bytes32 indexed circuitId)',
];

/**
 * Deep Link utilities for ZKProofPort SDK
 */
/**
 * Generate a unique request ID
 */
function generateRequestId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `req-${timestamp}-${random}`;
}
/**
 * Encode data for URL transmission (base64url with UTF-8 support)
 */
function encodeData(data) {
    const json = JSON.stringify(data);
    // Use base64url encoding (URL-safe) with UTF-8 support
    if (typeof btoa === 'function') {
        // Browser: UTF-8 encode first, then base64
        const utf8Encoded = encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16)));
        return btoa(utf8Encoded)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }
    // Node.js environment
    return Buffer.from(json, 'utf-8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}
/**
 * Decode URL-transmitted data (base64url with UTF-8 support)
 */
function decodeData(encoded) {
    // Restore base64 padding
    let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
        base64 += '=';
    }
    let json;
    if (typeof atob === 'function') {
        // Browser: decode base64, then UTF-8 decode
        const decoded = atob(base64);
        json = decodeURIComponent(decoded.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    }
    else {
        json = Buffer.from(base64, 'base64').toString('utf-8');
    }
    return JSON.parse(json);
}
/**
 * Build a proof request deep link URL
 */
function buildProofRequestUrl(request, scheme = DEFAULT_SCHEME) {
    const encodedRequest = encodeData(request);
    return `${scheme}://${DEEP_LINK_HOSTS.PROOF_REQUEST}?data=${encodedRequest}`;
}
/**
 * Build a callback URL with proof response
 */
function buildCallbackUrl(callbackUrl, response) {
    const url = new URL(callbackUrl);
    url.searchParams.set('requestId', response.requestId);
    url.searchParams.set('status', response.status);
    if (response.status === 'completed' && response.proof) {
        url.searchParams.set('proof', response.proof);
        if (response.publicInputs) {
            url.searchParams.set('publicInputs', response.publicInputs.join(','));
        }
        if (response.numPublicInputs !== undefined) {
            url.searchParams.set('numPublicInputs', response.numPublicInputs.toString());
        }
        if (response.timestamp) {
            url.searchParams.set('timestamp', response.timestamp.toString());
        }
        if (response.nullifier) {
            url.searchParams.set('nullifier', response.nullifier);
        }
    }
    else if (response.status === 'error' && response.error) {
        url.searchParams.set('error', response.error);
    }
    return url.toString();
}
/**
 * Parse a proof request from deep link URL
 */
function parseProofRequestUrl(url) {
    try {
        const urlObj = new URL(url);
        const data = urlObj.searchParams.get('data');
        if (!data) {
            return null;
        }
        return decodeData(data);
    }
    catch (error) {
        console.error('Failed to parse proof request URL:', error);
        return null;
    }
}
/**
 * Parse a proof response from callback URL
 */
function parseProofResponseUrl(url) {
    try {
        const urlObj = new URL(url);
        const requestId = urlObj.searchParams.get('requestId');
        const status = urlObj.searchParams.get('status');
        if (!requestId || !status) {
            return null;
        }
        const response = {
            requestId,
            circuit: urlObj.searchParams.get('circuit') || 'coinbase_attestation',
            status,
        };
        if (status === 'completed') {
            response.proof = urlObj.searchParams.get('proof') || undefined;
            const publicInputsStr = urlObj.searchParams.get('publicInputs');
            if (publicInputsStr) {
                response.publicInputs = publicInputsStr.split(',');
            }
            const numPublicInputs = urlObj.searchParams.get('numPublicInputs');
            if (numPublicInputs) {
                response.numPublicInputs = parseInt(numPublicInputs, 10);
            }
            const timestamp = urlObj.searchParams.get('timestamp');
            if (timestamp) {
                response.timestamp = parseInt(timestamp, 10);
            }
            response.nullifier = urlObj.searchParams.get('nullifier') || undefined;
        }
        else if (status === 'error') {
            response.error = urlObj.searchParams.get('error') || undefined;
        }
        return response;
    }
    catch (error) {
        console.error('Failed to parse proof response URL:', error);
        return null;
    }
}
/**
 * Parse deep link URL into components
 */
function parseDeepLink(url) {
    try {
        // Handle custom scheme URLs
        const schemeMatch = url.match(/^([a-z][a-z0-9+.-]*):\/\/(.+)$/i);
        if (!schemeMatch) {
            return null;
        }
        const scheme = schemeMatch[1];
        const rest = schemeMatch[2];
        // Parse host and path
        const [hostPath, queryString] = rest.split('?');
        const [host, ...pathParts] = hostPath.split('/');
        const path = '/' + pathParts.join('/');
        // Parse query parameters
        const params = {};
        if (queryString) {
            const searchParams = new URLSearchParams(queryString);
            searchParams.forEach((value, key) => {
                params[key] = value;
            });
        }
        return { scheme, host, path, params };
    }
    catch (error) {
        console.error('Failed to parse deep link:', error);
        return null;
    }
}
/**
 * Check if URL is a ZKProofPort deep link
 */
function isProofPortDeepLink(url, scheme = DEFAULT_SCHEME) {
    return url.toLowerCase().startsWith(`${scheme.toLowerCase()}://`);
}
/**
 * Validate proof request
 */
function validateProofRequest(request) {
    if (!request.requestId) {
        return { valid: false, error: 'Missing requestId' };
    }
    if (!request.circuit) {
        return { valid: false, error: 'Missing circuit type' };
    }
    if (!['coinbase_attestation', 'coinbase_country_attestation'].includes(request.circuit)) {
        return { valid: false, error: `Invalid circuit type: ${request.circuit}` };
    }
    if (!request.callbackUrl) {
        return { valid: false, error: 'Missing callbackUrl' };
    }
    // Validate circuit-specific inputs
    if (request.circuit === 'coinbase_attestation') {
        // Coinbase KYC: userAddress is optional - app will connect wallet if not provided
        const inputs = request.inputs;
        if (inputs.userAddress && !/^0x[a-fA-F0-9]{40}$/.test(inputs.userAddress)) {
            return { valid: false, error: 'Invalid userAddress format' };
        }
        // If userAddress is not provided, app will prompt wallet connection - this is valid
    }
    else if (request.circuit === 'coinbase_country_attestation') {
        const inputs = request.inputs;
        if (inputs.userAddress && !/^0x[a-fA-F0-9]{40}$/.test(inputs.userAddress)) {
            return { valid: false, error: 'Invalid userAddress format' };
        }
        if (inputs.countryList && !Array.isArray(inputs.countryList)) {
            return { valid: false, error: 'countryList must be an array of strings' };
        }
        if (inputs.countryList && !inputs.countryList.every(c => typeof c === 'string')) {
            return { valid: false, error: 'countryList must contain only strings' };
        }
    }
    // Check expiry
    if (request.expiresAt && Date.now() > request.expiresAt) {
        return { valid: false, error: 'Request has expired' };
    }
    return { valid: true };
}

/**
 * QR Code utilities for ZKProofPort SDK
 */
/**
 * Default QR code options
 */
const DEFAULT_QR_OPTIONS = {
    width: 300,
    errorCorrectionLevel: 'M',
    margin: 2,
    darkColor: '#000000',
    lightColor: '#ffffff',
};
/**
 * Generate QR code as data URL (base64 PNG)
 */
async function generateQRCodeDataUrl(request, options = {}, scheme = DEFAULT_SCHEME) {
    const url = buildProofRequestUrl(request, scheme);
    // Check data size
    if (url.length > MAX_QR_DATA_SIZE) {
        throw new Error(`QR code data too large (${url.length} bytes). Maximum is ${MAX_QR_DATA_SIZE} bytes.`);
    }
    const mergedOptions = { ...DEFAULT_QR_OPTIONS, ...options };
    return QRCode.toDataURL(url, {
        width: mergedOptions.width,
        errorCorrectionLevel: mergedOptions.errorCorrectionLevel,
        margin: mergedOptions.margin,
        color: {
            dark: mergedOptions.darkColor,
            light: mergedOptions.lightColor,
        },
    });
}
/**
 * Generate QR code as SVG string
 */
async function generateQRCodeSVG(request, options = {}, scheme = DEFAULT_SCHEME) {
    const url = buildProofRequestUrl(request, scheme);
    if (url.length > MAX_QR_DATA_SIZE) {
        throw new Error(`QR code data too large (${url.length} bytes). Maximum is ${MAX_QR_DATA_SIZE} bytes.`);
    }
    const mergedOptions = { ...DEFAULT_QR_OPTIONS, ...options };
    return QRCode.toString(url, {
        type: 'svg',
        width: mergedOptions.width,
        errorCorrectionLevel: mergedOptions.errorCorrectionLevel,
        margin: mergedOptions.margin,
        color: {
            dark: mergedOptions.darkColor,
            light: mergedOptions.lightColor,
        },
    });
}
/**
 * Generate QR code to canvas element (browser only)
 */
async function generateQRCodeToCanvas(canvas, request, options = {}, scheme = DEFAULT_SCHEME) {
    const url = buildProofRequestUrl(request, scheme);
    if (url.length > MAX_QR_DATA_SIZE) {
        throw new Error(`QR code data too large (${url.length} bytes). Maximum is ${MAX_QR_DATA_SIZE} bytes.`);
    }
    const mergedOptions = { ...DEFAULT_QR_OPTIONS, ...options };
    await QRCode.toCanvas(canvas, url, {
        width: mergedOptions.width,
        errorCorrectionLevel: mergedOptions.errorCorrectionLevel,
        margin: mergedOptions.margin,
        color: {
            dark: mergedOptions.darkColor,
            light: mergedOptions.lightColor,
        },
    });
}
/**
 * Estimate QR code data size for a request
 */
function estimateQRDataSize(request, scheme = DEFAULT_SCHEME) {
    const url = buildProofRequestUrl(request, scheme);
    return {
        size: url.length,
        withinLimit: url.length <= MAX_QR_DATA_SIZE,
    };
}

/**
 * On-chain verification utilities for ZKProofPort SDK
 *
 * Compatible with both ethers v5 and v6.
 */
// ethers v5/v6 compatibility shims
const _ethers = ethers.ethers;
function hexZeroPad(value, length) {
    // v6: ethers.zeroPadValue, v5: ethers.utils.hexZeroPad
    if (typeof _ethers.zeroPadValue === 'function')
        return _ethers.zeroPadValue(value, length);
    if (_ethers.utils?.hexZeroPad)
        return _ethers.utils.hexZeroPad(value, length);
    // manual fallback
    const hex = value.startsWith('0x') ? value.slice(2) : value;
    return '0x' + hex.padStart(length * 2, '0');
}
function createJsonRpcProvider(url) {
    // v6: ethers.JsonRpcProvider, v5: ethers.providers.JsonRpcProvider
    if (typeof _ethers.JsonRpcProvider === 'function')
        return new _ethers.JsonRpcProvider(url);
    if (_ethers.providers?.JsonRpcProvider)
        return new _ethers.providers.JsonRpcProvider(url);
    throw new Error('No JsonRpcProvider found in ethers');
}
/**
 * Resolve verifier from SDK config or proof response.
 * SDK config (customVerifier) takes priority over response-provided verifier.
 */
function resolveVerifier(customVerifier, responseVerifier) {
    if (customVerifier)
        return customVerifier;
    if (responseVerifier?.verifierAddress) {
        return {
            address: responseVerifier.verifierAddress,
            chainId: responseVerifier.chainId ?? 0,
            abi: VERIFIER_ABI,
        };
    }
    return null;
}
/**
 * Get verifier contract instance
 */
function getVerifierContract(providerOrSigner, verifier) {
    return new ethers.ethers.Contract(verifier.address, verifier.abi, providerOrSigner);
}
/**
 * Get default provider for a chain
 */
function getDefaultProvider(chainId) {
    const rpcUrl = RPC_ENDPOINTS[chainId];
    if (!rpcUrl) {
        throw new Error(`No RPC endpoint configured for chain ${chainId}`);
    }
    return createJsonRpcProvider(rpcUrl);
}
/**
 * Verify proof on-chain
 */
async function verifyProofOnChain(circuit, parsedProof, providerOrSigner, customVerifier, responseVerifier) {
    const verifier = resolveVerifier(customVerifier, responseVerifier);
    if (!verifier) {
        return {
            valid: false,
            error: 'No verifier address provided. Configure via SDK or ensure proof response includes verifierAddress.',
        };
    }
    const provider = providerOrSigner || (verifier.chainId > 0 ? getDefaultProvider(verifier.chainId) : null);
    if (!provider) {
        return {
            valid: false,
            error: 'No provider available. Provide a provider or ensure chainId is set for RPC lookup.',
        };
    }
    const contract = getVerifierContract(provider, verifier);
    try {
        const isValid = await contract.verify(parsedProof.proofHex, parsedProof.publicInputsHex);
        return { valid: isValid };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { valid: false, error: errorMessage };
    }
}
/**
 * Ensure a hex string has the 0x prefix
 */
function ensureHexPrefix(hex) {
    return hex.startsWith('0x') ? hex : `0x${hex}`;
}
/**
 * Parse proof response into format suitable for on-chain verification.
 * Public inputs are zero-padded to 32 bytes (bytes32).
 */
function parseProofForOnChain(proof, publicInputs, numPublicInputs) {
    const proofHex = ensureHexPrefix(proof);
    const publicInputsHex = publicInputs.map((input) => {
        return hexZeroPad(ensureHexPrefix(input), 32);
    });
    return {
        proofHex,
        publicInputsHex,
        numPublicInputs,
    };
}
/**
 * Require a verifier or throw with a helpful message
 */
function requireVerifier(circuit, verifier) {
    if (!verifier) {
        throw new Error(`No verifier configured for circuit '${circuit}'. Configure via SDK verifiers option.`);
    }
    return verifier;
}
/**
 * Get verifier contract address for a circuit
 */
function getVerifierAddress(circuit, customVerifier) {
    return requireVerifier(circuit, customVerifier).address;
}
/**
 * Get chain ID for a circuit's verifier
 */
function getVerifierChainId(circuit, customVerifier) {
    return requireVerifier(circuit, customVerifier).chainId;
}
function extractScopeFromPublicInputs(publicInputsHex, circuit) {
    let start, end;
    if (circuit === 'coinbase_country_attestation') {
        start = 86;
        end = 117;
    }
    else {
        start = 64;
        end = 95;
    }
    if (publicInputsHex.length <= end)
        return null;
    const scopeFields = publicInputsHex.slice(start, end + 1);
    return reconstructBytes32FromFields(scopeFields);
}
function extractNullifierFromPublicInputs(publicInputsHex, circuit) {
    let start, end;
    if (circuit === 'coinbase_country_attestation') {
        start = 118;
        end = 149;
    }
    else {
        start = 96;
        end = 127;
    }
    if (publicInputsHex.length <= end)
        return null;
    const nullifierFields = publicInputsHex.slice(start, end + 1);
    return reconstructBytes32FromFields(nullifierFields);
}
function reconstructBytes32FromFields(fields) {
    if (fields.length !== 32) {
        throw new Error(`Expected 32 fields, got ${fields.length}`);
    }
    const bytes = fields.map(f => {
        const byte = BigInt(f) & 0xffn;
        return byte.toString(16).padStart(2, '0');
    }).join('');
    return '0x' + bytes;
}

/**
 * ProofPort SDK - Main class
 */
/**
 * ZKProofPort SDK for requesting and verifying ZK proofs
 */
class ProofPortSDK {
    constructor(config = {}) {
        this.pendingRequests = new Map();
        this.config = {
            scheme: config.scheme || DEFAULT_SCHEME,
            defaultCallbackUrl: config.defaultCallbackUrl || '',
            verifiers: config.verifiers || {},
        };
    }
    // ============ Request Creation ============
    /**
     * Create a Coinbase KYC verification request
     */
    createCoinbaseKycRequest(inputs, options = {}) {
        if (!inputs.scope) {
            throw new Error('scope is required for coinbase_attestation circuit');
        }
        const request = {
            requestId: generateRequestId(),
            circuit: 'coinbase_attestation',
            inputs,
            callbackUrl: options.callbackUrl || this.config.defaultCallbackUrl,
            message: options.message,
            dappName: options.dappName,
            dappIcon: options.dappIcon,
            createdAt: Date.now(),
            expiresAt: Date.now() + (options.expiresInMs || DEFAULT_REQUEST_EXPIRY_MS),
        };
        this.pendingRequests.set(request.requestId, request);
        return request;
    }
    /**
     * Create a Coinbase Country attestation request
     */
    createCoinbaseCountryRequest(inputs, options = {}) {
        if (!inputs.scope) {
            throw new Error('scope is required for coinbase_country_attestation circuit');
        }
        const request = {
            requestId: generateRequestId(),
            circuit: 'coinbase_country_attestation',
            inputs,
            callbackUrl: options.callbackUrl || this.config.defaultCallbackUrl,
            message: options.message,
            dappName: options.dappName,
            dappIcon: options.dappIcon,
            createdAt: Date.now(),
            expiresAt: Date.now() + (options.expiresInMs || DEFAULT_REQUEST_EXPIRY_MS),
        };
        this.pendingRequests.set(request.requestId, request);
        return request;
    }
    /**
     * Create a generic proof request
     */
    createProofRequest(circuit, inputs, options = {}) {
        if (circuit === 'coinbase_country_attestation') {
            return this.createCoinbaseCountryRequest(inputs, options);
        }
        else {
            return this.createCoinbaseKycRequest(inputs, options);
        }
    }
    // ============ Deep Link Generation ============
    /**
     * Generate deep link URL for a proof request
     */
    getDeepLinkUrl(request) {
        return buildProofRequestUrl(request, this.config.scheme);
    }
    /**
     * Open ZKProofPort app with a proof request (browser)
     */
    openProofRequest(request) {
        const url = this.getDeepLinkUrl(request);
        window.location.href = url;
    }
    /**
     * Request a proof — auto-detects platform.
     * Mobile: opens deep link directly.
     * Desktop: returns QR code data URL and deep link URL for display.
     */
    async requestProof(request, qrOptions) {
        const deepLink = this.getDeepLinkUrl(request);
        const mobile = ProofPortSDK.isMobile();
        if (mobile) {
            window.location.href = deepLink;
            return { deepLink, mobile: true };
        }
        const qrDataUrl = await this.generateQRCode(request, qrOptions);
        return { deepLink, qrDataUrl, mobile: false };
    }
    // ============ QR Code Generation ============
    /**
     * Generate QR code as data URL
     */
    async generateQRCode(request, options) {
        return generateQRCodeDataUrl(request, options, this.config.scheme);
    }
    /**
     * Generate QR code as SVG string
     */
    async generateQRCodeSVG(request, options) {
        return generateQRCodeSVG(request, options, this.config.scheme);
    }
    /**
     * Render QR code to canvas element
     */
    async renderQRCodeToCanvas(canvas, request, options) {
        return generateQRCodeToCanvas(canvas, request, options, this.config.scheme);
    }
    /**
     * Check if request data fits in QR code
     */
    checkQRCodeSize(request) {
        return estimateQRDataSize(request, this.config.scheme);
    }
    // ============ Response Handling ============
    /**
     * Parse proof response from callback URL
     */
    parseResponse(url) {
        return parseProofResponseUrl(url);
    }
    /**
     * Check if a URL is a ZKProofPort response
     */
    isProofPortResponse(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.searchParams.has('requestId') && urlObj.searchParams.has('status');
        }
        catch {
            return false;
        }
    }
    /**
     * Get pending request by ID
     */
    getPendingRequest(requestId) {
        return this.pendingRequests.get(requestId);
    }
    /**
     * Clear pending request
     */
    clearPendingRequest(requestId) {
        this.pendingRequests.delete(requestId);
    }
    // ============ Verification ============
    /**
     * Verify proof on-chain
     */
    async verifyOnChain(circuit, proof, publicInputs, providerOrSigner) {
        const parsedProof = parseProofForOnChain(proof, publicInputs, publicInputs.length);
        const customVerifier = this.config.verifiers[circuit];
        return verifyProofOnChain(circuit, parsedProof, providerOrSigner, customVerifier);
    }
    /**
     * Verify proof from response on-chain
     */
    async verifyResponseOnChain(response, providerOrSigner) {
        if (response.status !== 'completed' || !response.proof || !response.publicInputs) {
            return { valid: false, error: 'Invalid or incomplete response' };
        }
        const parsedProof = parseProofForOnChain(response.proof, response.publicInputs, response.publicInputs.length);
        const customVerifier = this.config.verifiers[response.circuit];
        const responseVerifier = {
            verifierAddress: response.verifierAddress,
            chainId: response.chainId,
        };
        return verifyProofOnChain(response.circuit, parsedProof, providerOrSigner, customVerifier, responseVerifier);
    }
    // ============ Utility Methods ============
    /**
     * Get verifier contract address
     */
    getVerifierAddress(circuit) {
        const customVerifier = this.config.verifiers[circuit];
        return getVerifierAddress(circuit, customVerifier);
    }
    /**
     * Get verifier chain ID
     */
    getVerifierChainId(circuit) {
        const customVerifier = this.config.verifiers[circuit];
        return getVerifierChainId(circuit, customVerifier);
    }
    /**
     * Get circuit metadata
     */
    getCircuitMetadata(circuit) {
        return CIRCUIT_METADATA[circuit];
    }
    /**
     * Get all supported circuits
     */
    getSupportedCircuits() {
        return Object.keys(CIRCUIT_METADATA);
    }
    /**
     * Validate a proof request
     */
    validateRequest(request) {
        return validateProofRequest(request);
    }
    /**
     * Check if URL is a ZKProofPort deep link
     */
    isProofPortDeepLink(url) {
        return isProofPortDeepLink(url, this.config.scheme);
    }
    /**
     * Parse proof request from deep link URL
     */
    parseDeepLink(url) {
        return parseProofRequestUrl(url);
    }
    // ============ Static Factory ============
    /**
     * Create SDK with default configuration
     */
    static create(config) {
        return new ProofPortSDK(config);
    }
    /**
     * Detect if running on a mobile device
     */
    static isMobile() {
        if (typeof navigator === 'undefined')
            return false;
        return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }
}

exports.CIRCUIT_METADATA = CIRCUIT_METADATA;
exports.COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT = COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT;
exports.COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT = COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT;
exports.DEEP_LINK_HOSTS = DEEP_LINK_HOSTS;
exports.DEFAULT_REQUEST_EXPIRY_MS = DEFAULT_REQUEST_EXPIRY_MS;
exports.DEFAULT_SCHEME = DEFAULT_SCHEME;
exports.MAX_QR_DATA_SIZE = MAX_QR_DATA_SIZE;
exports.NULLIFIER_REGISTRY_ABI = NULLIFIER_REGISTRY_ABI;
exports.ProofPortSDK = ProofPortSDK;
exports.RPC_ENDPOINTS = RPC_ENDPOINTS;
exports.VERIFIER_ABI = VERIFIER_ABI;
exports.buildCallbackUrl = buildCallbackUrl;
exports.buildProofRequestUrl = buildProofRequestUrl;
exports.decodeData = decodeData;
exports.default = ProofPortSDK;
exports.encodeData = encodeData;
exports.estimateQRDataSize = estimateQRDataSize;
exports.extractNullifierFromPublicInputs = extractNullifierFromPublicInputs;
exports.extractScopeFromPublicInputs = extractScopeFromPublicInputs;
exports.generateQRCodeDataUrl = generateQRCodeDataUrl;
exports.generateQRCodeSVG = generateQRCodeSVG;
exports.generateQRCodeToCanvas = generateQRCodeToCanvas;
exports.generateRequestId = generateRequestId;
exports.getDefaultProvider = getDefaultProvider;
exports.getVerifierAddress = getVerifierAddress;
exports.getVerifierChainId = getVerifierChainId;
exports.getVerifierContract = getVerifierContract;
exports.isProofPortDeepLink = isProofPortDeepLink;
exports.parseDeepLink = parseDeepLink;
exports.parseProofForOnChain = parseProofForOnChain;
exports.parseProofRequestUrl = parseProofRequestUrl;
exports.parseProofResponseUrl = parseProofResponseUrl;
exports.validateProofRequest = validateProofRequest;
exports.verifyProofOnChain = verifyProofOnChain;
//# sourceMappingURL=index.js.map
