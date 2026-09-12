/*! OpenPGP.js v6.3.1 - 2026-09-11 - this is LGPL licensed code, see LICENSE/our website https://openpgpjs.org/ for more information. */
const globalThis = typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};
const hasOwnPonyfill =
  typeof Object.hasOwn === 'function'
    ? Object.hasOwn
    : (obj, key) => Object.prototype.hasOwnProperty.call(Object(obj), key);

import { b as abytes, a as ahash, D as anumber, E as bytesToHex, f as concatBytes, F as randomBytes$1, G as isBytes, s as shake256, H as shake128, I as u32, J as swap32IfBE, h as sha3_512, i as sha3_256 } from './sha3.mjs';
import { v as validateObject, f as abool } from './utils.mjs';

/**
 * Experimental implementation of NTT / FFT (Fast Fourier Transform) over finite fields.
 * API may change at any time. The code has not been audited. Feature requests are welcome.
 * @module
 */
function checkU32(n, title = 'n') {
    // 0xff_ff_ff_ff
    if (typeof n !== 'number')
        throw new TypeError(`wrong u32 integer "${title}": expected number, got type=${typeof n}`);
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff)
        throw new RangeError(`wrong u32 integer "${title}": expected 0..4294967295, got ${n}`);
    return n;
}
/**
 * Checks if integer is in form of `1 << X`.
 * @param x - Integer to inspect.
 * @returns `true` when the value is a power of two.
 * @example
 * Validate that an FFT size is a power of two.
 *
 * ```ts
 * isPowerOfTwo(8);
 * ```
 */
function isPowerOfTwo(x) {
    checkU32(x, 'x');
    return (x & (x - 1)) === 0 && x !== 0;
}
/**
 * @param n - Value to reverse.
 * @param bits - Number of bits to use.
 * @returns Bit-reversed integer.
 * @throws If `n` is not a valid unsigned 32-bit integer. {@link Error}
 * @example
 * Reverse the low `bits` bits of one index.
 *
 * ```ts
 * reverseBits(3, 3);
 * ```
 */
function reverseBits(n, bits) {
    checkU32(n);
    if (typeof bits !== 'number')
        throw new TypeError('"bits" expected number, got type=' + typeof bits);
    if (!Number.isSafeInteger(bits) || bits < 0 || bits > 32)
        throw new Error(`expected integer 0 <= bits <= 32, got ${bits}`);
    let reversed = 0;
    for (let i = 0; i < bits; i++, n >>>= 1)
        reversed = (reversed << 1) | (n & 1);
    // JS bitwise ops are signed i32; cast back so 32-bit reversals stay in the unsigned u32 domain.
    return reversed >>> 0;
}
/**
 * Similar to `bitLen(x)-1` but much faster for small integers, like indices.
 * @param n - Input value.
 * @returns Base-2 logarithm. For `n = 0`, the current implementation returns `-1`.
 * @example
 * Compute the radix-2 stage count for one transform size.
 *
 * ```ts
 * log2(8);
 * ```
 */
function log2(n) {
    checkU32(n);
    return 31 - Math.clz32(n);
}
/**
 * Moves lowest bit to highest position, which at first step splits
 * array on even and odd indices, then it applied again to each part,
 * which is core of fft
 * @param values - Mutable coefficient array.
 * @returns Mutated input array.
 * @throws If the array length is not a positive power of two. {@link Error}
 * @example
 * Reorder coefficients into bit-reversed order in place.
 *
 * ```ts
 * const values = Uint8Array.from([0, 1, 2, 3]);
 * bitReversalInplace(values);
 * ```
 */
function bitReversalInplace(values) {
    if (!values ||
        typeof values !== 'object' ||
        typeof values.length !== 'number')
        throw new TypeError('"values" expected array-like, got type=' + typeof values);
    const n = values.length;
    // Size-1 FFT is the identity, so bit-reversal must stay a no-op there instead of rejecting it.
    if (!isPowerOfTwo(n))
        throw new Error('expected positive power-of-two length, got ' + n);
    const bits = log2(n);
    for (let i = 0; i < n; i++) {
        const j = reverseBits(i, bits);
        if (i < j) {
            const tmp = values[i];
            values[i] = values[j];
            values[j] = tmp;
        }
    }
    return values;
}
/**
 * Constructs different flavors of FFT. radix2 implementation of low level mutating API. Flavors:
 *
 * - DIT (Decimation-in-Time): Bottom-Up (leaves to root), Cooley-Tukey
 * - DIF (Decimation-in-Frequency): Top-Down (root to leaves), Gentleman-Sande
 *
 * DIT takes brp input, returns natural output.
 * DIF takes natural input, returns brp output.
 *
 * The output is actually identical. Time / frequence distinction is not meaningful
 * for Polynomial multiplication in fields.
 * Which means if protocol supports/needs brp output/inputs, then we can skip this step.
 *
 * Cyclic NTT: Rq = Zq[x]/(x^n-1). butterfly_DIT+loop_DIT OR butterfly_DIF+loop_DIT, roots are omega
 * Negacyclic NTT: Rq = Zq[x]/(x^n+1). butterfly_DIT+loop_DIF, at least for mlkem / mldsa
 *
 * `invertButterflies` indexes roots by a per-butterfly-group counter (`grp`): forward
 * (`dit: false`) reads `roots[grp]` with grp = 1..; inverse (`dit: true`) reads `roots[N - grp]`
 * with grp restarting at 1. With `skipStages: 0` one table serves both directions (ωᴺ = 1 makes
 * the reversed walk self-inverse). With `skipStages > 0` the inverse walk starts at `N - 1`
 * instead of continuing where the skipped stages would have left off, so the caller must supply
 * a table shaped for that (ML-KEM: `ζ^BitRev7(i)` over all N=256 indices, whose aliased upper
 * half is exactly the FIPS 203 inverse walk).
 * @param F - Field operations.
 * @param coreOpts - FFT configuration. See {@link FFTCoreOpts}:
 *   - `N`: Transform size. Must be a power of two.
 *   - `roots`: Stage roots for the selected transform size.
 *   - `dit`: Whether to run the DIT variant instead of DIF.
 *   - `invertButterflies` (optional): Whether to invert butterfly placement.
 *   - `skipStages` (optional): Number of initial stages to skip.
 *   - `brp` (optional): Whether to apply bit-reversal permutation at the boundary.
 * @returns Low-level FFT loop.
 * @throws If the FFT options or cached roots are invalid for the requested size. {@link Error}
 * @example
 * Constructs different flavors of FFT.
 *
 * ```ts
 * import { FFTCore, rootsOfUnity } from '@noble/curves/abstract/fft.js';
 * import { Field } from '@noble/curves/abstract/modular.js';
 * const Fp = Field(17n);
 * const roots = rootsOfUnity(Fp).roots(2);
 * const loop = FFTCore(Fp, { N: 4, roots, dit: true });
 * const values = loop([1n, 2n, 3n, 4n]);
 * ```
 */
const FFTCore = (F, coreOpts) => {
    validateObject(coreOpts, { N: 'number', roots: 'object', dit: 'boolean' }, { invertButterflies: 'boolean', skipStages: 'number', brp: 'boolean' }, 'coreOpts');
    const { N, roots, dit, invertButterflies = false, skipStages = 0, brp = true } = coreOpts;
    checkU32(N, 'coreOpts.N');
    const bits = log2(N);
    if (!isPowerOfTwo(N))
        throw new Error('FFT: Polynomial size should be power of two');
    checkU32(skipStages, 'coreOpts.skipStages');
    const maxSkipStages = bits === 0 ? 0 : bits - 1;
    // Skipping every stage leaves only boundary layout changes, not a valid FFT loop shape.
    if (skipStages > maxSkipStages)
        throw new Error(`FFT: wrong skipStages: expected 0 <= skipStages <= ${maxSkipStages}`);
    // Wrong-sized root tables can stay in-bounds for some loop shapes and silently compute nonsense.
    if (roots.length !== N)
        throw new Error(`FFT: wrong roots length: expected ${N}, got ${roots.length}`);
    const isDit = dit !== invertButterflies;
    return (values) => {
        if (values.length !== N)
            throw new Error('FFT: wrong Polynomial length');
        if (dit && brp)
            bitReversalInplace(values);
        for (let i = 0, g = 1; i < bits - skipStages; i++) {
            // For each stage s (sub-FFT length m = 2^s)
            const s = dit ? i + 1 + skipStages : bits - i;
            const m = 1 << s;
            const m2 = m >> 1;
            const stride = N >> s;
            // Loop over each subarray of length m
            for (let k = 0; k < N; k += m) {
                // Loop over each butterfly within the subarray
                for (let j = 0, grp = g++; j < m2; j++) {
                    const rootPos = invertButterflies ? (dit ? N - grp : grp) : j * stride;
                    const i0 = k + j;
                    const i1 = k + j + m2;
                    const omega = roots[rootPos];
                    const b = values[i1];
                    const a = values[i0];
                    // Inlining gives us 10% perf in kyber vs functions
                    if (isDit) {
                        const t = F.mul(b, omega); // Standard DIT butterfly
                        values[i0] = F.add(a, t);
                        values[i1] = F.sub(a, t);
                    }
                    else if (invertButterflies) {
                        values[i0] = F.add(b, a); // DIT loop + inverted butterflies (Kyber decode)
                        values[i1] = F.mul(F.sub(b, a), omega);
                    }
                    else {
                        values[i0] = F.add(a, b); // Standard DIF butterfly
                        values[i1] = F.mul(F.sub(a, b), omega);
                    }
                }
            }
        }
        if (!dit && brp)
            bitReversalInplace(values);
        return values;
    };
};

/**
 * Utilities for hex, bytearray and number handling.
 * @module
 */
/*! noble-post-quantum - MIT License (c) 2024 Paul Miller (paulmillr.com) */
/**
 * Asserts that a value is a byte array and optionally checks its length.
 * Returns the original reference unchanged on success, and currently also accepts Node `Buffer`
 * values through the upstream validator.
 * This helper throws on malformed input, so APIs that must return `false` need to guard lengths
 * before decoding or before calling it.
 * @example
 * Validate that a value is a byte array with the expected length.
 * ```ts
 * abytes(new Uint8Array([1]), 1);
 * ```
 */
const abytesDoc = abytes;
/**
 * Returns cryptographically secure random bytes.
 * Requires `globalThis.crypto.getRandomValues` and throws if that API is unavailable.
 * `bytesLength` is validated by the upstream helper as a non-negative integer before allocation,
 * so negative and fractional values both throw instead of truncating through JS `ToIndex`.
 * @param bytesLength - Number of random bytes to generate.
 * @returns Fresh random bytes.
 * @example
 * Generate a fresh random seed.
 * ```ts
 * const seed = randomBytes(4);
 * ```
 */
const randomBytes = randomBytes$1;
function aarray(item, title, inner = () => { }) {
    if (!Array.isArray(item))
        throw new TypeError(`"${title}" expected array, got type=${typeof item}`);
    for (let i = 0; i < item.length; i++)
        inner(item[i], `${title}[${i}]`);
    return item;
}
function aobject(value, title = 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new TypeError(title === 'object'
            ? 'expected valid options object'
            : `"${title}" expected object, got type=${typeof value}`);
    return value;
}
/**
 * Compares two byte arrays in a length-constant way for equal lengths.
 * Inputs are validated as byte arrays; unequal lengths return `false` immediately.
 * @param a - First byte array.
 * @param b - Second byte array.
 * @returns Whether both arrays contain the same bytes.
 * @example
 * Compare two byte arrays for equality.
 * ```ts
 * equalBytes(new Uint8Array([1]), new Uint8Array([1]));
 * ```
 */
function equalBytes(a, b) {
    a = abytes(a);
    b = abytes(b);
    if (a.length !== b.length)
        return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++)
        diff |= a[i] ^ b[i];
    return diff === 0;
}
/**
 * Copies bytes into a fresh `Uint8Array`.
 * Returns a detached plain `Uint8Array` after validating that the input is real bytes.
 * @param bytes - Source bytes.
 * @returns Copy of the input bytes.
 * @example
 * Copy bytes into a fresh array.
 * ```ts
 * copyBytes(new Uint8Array([1, 2]));
 * ```
 */
function copyBytes(bytes) {
    // The typed-array constructor copies a typed-array source through its internal byte storage.
    // Unlike `Uint8Array.from`, it does not invoke a subclass-overridden iterator. Keep the explicit
    // validation because the constructor itself would also accept arrays and other typed arrays.
    return new Uint8Array(abytes(bytes));
}
/**
 * Validates that an options bag is a plain object.
 * @param opts - Options object to validate.
 * @throws On wrong argument types. {@link TypeError}
 * @example
 * Validate that an options bag is a plain object.
 * ```ts
 * validateOpts({});
 * ```
 */
function validateOpts(opts) {
    // Arrays silently passed here before, but these call sites expect named option-bag fields.
    if (isBytes(opts))
        throw new TypeError('"opts" expected object, got Uint8Array');
    aobject(opts, 'opts');
    const proto = Object.getPrototypeOf(opts);
    // Options are security parameters, not general class instances. Restricting the bag to own
    // properties prevents values injected through Object.prototype (or a custom shared prototype)
    // from silently changing signing behavior. Null-prototype records remain supported.
    if (proto !== null && proto !== Object.prototype)
        throw new TypeError('"opts" expected a plain object');
}
// Frozen because they are exported: an unfrozen array export lets anything in the
// process push a key onto the accepted set and silently re-open exactly the hole this
// validation closes.
/** Keys accepted by `verify`. */
const VER_OPT_KEYS = /* @__PURE__ */ Object.freeze([
    'context',
]);
/** Keys accepted by `sign`. */
const SIG_OPT_KEYS = /* @__PURE__ */ Object.freeze([
    'context',
    'extraEntropy',
]);
/**
 * Rejects option keys the caller did not mean to set.
 *
 * Validating the types of known keys while ignoring unknown ones makes a typo
 * indistinguishable from an omission, and for these options an omission is a
 * security downgrade rather than a no-op: `{ ctx }` instead of `{ context }` signs
 * with no domain separation, succeeds, and verifies for anyone who also supplies
 * none. Nothing at any layer reports it. TypeScript catches this through excess
 * property checks, so the exposure is JavaScript callers specifically.
 *
 * @param opts - Options object to check.
 * @param allowed - The keys this call site accepts.
 * Returns a frozen null-prototype snapshot so later reads cannot fall through to a polluted
 * prototype. Like `checkOpts()` in noble-hashes, only enumerable own properties are copied.
 * @throws If any other copied key is present or the bag has a custom prototype. {@link TypeError}
 * @returns Sanitized snapshot of the enumerable own options.
 * @example
 * Accept a known option key. A key the list does not name, such as `ctx`, throws instead.
 * ```ts
 * import { checkOptKeys } from '@noble/post-quantum/utils.js';
 * checkOptKeys({ context: new Uint8Array() }, ['context']);
 * ```
 */
function checkOptKeys(opts, allowed) {
    validateOpts(opts);
    // Snapshot once before validation: Object.assign follows the same own-enumerable option-bag
    // semantics as noble-hashes, while the null prototype keeps omitted fields immune to pollution.
    const normalized = Object.assign(Object.create(null), opts);
    for (const [k, v] of Object.entries(normalized)) {
        // `undefined` means unset everywhere else in these validators, and building an options bag by
        // spread is a normal way to reach these calls, so present-but-undefined stays equivalent to
        // omission.
        if (v === undefined)
            continue;
        if (!allowed.includes(k))
            throw new TypeError('unexpected option "' + String(k) + '"; expected one of: ' + allowed.join(', '));
    }
    return Object.freeze(normalized);
}
/**
 * Validates common verification options.
 * `context` itself is validated with `abytes(...)`, and individual algorithms may narrow support
 * further after this shared plain-object gate.
 * @param opts - Verification options. See {@link VerOpts}.
 * @param allowed - Keys this call site accepts. Defaults to {@link VER_OPT_KEYS}; surfaces that
 * take extra keys, or take fewer, pass their own list.
 * @throws On wrong argument types. {@link TypeError}
 * @returns Frozen null-prototype snapshot of the validated options.
 * @example
 * Validate common verification options.
 * ```ts
 * validateVerOpts({ context: new Uint8Array([1]) });
 * ```
 */
function validateVerOpts(opts, allowed = VER_OPT_KEYS) {
    const normalized = checkOptKeys(opts, allowed);
    if (normalized.context !== undefined)
        abytes(normalized.context, undefined, 'opts.context');
    return normalized;
}
/**
 * Validates common signing options.
 * `extraEntropy` is validated with `abytes(...)`; exact lengths and extra algorithm-specific
 * restrictions are enforced later by callers.
 * @param opts - Signing options. See {@link SigOpts}.
 * @param allowed - Keys this call site accepts. Defaults to {@link SIG_OPT_KEYS}; surfaces that
 * take extra keys, or take fewer, pass their own list.
 * @throws On wrong argument types. {@link TypeError}
 * @returns Frozen null-prototype snapshot of the validated options.
 * @example
 * Validate common signing options.
 * ```ts
 * validateSigOpts({ extraEntropy: new Uint8Array([1]) });
 * ```
 */
function validateSigOpts(opts, allowed = SIG_OPT_KEYS) {
    const normalized = checkOptKeys(opts, allowed);
    if (normalized.context !== undefined)
        abytes(normalized.context, undefined, 'opts.context');
    if (normalized.extraEntropy !== false && normalized.extraEntropy !== undefined)
        abytes(normalized.extraEntropy, undefined, 'opts.extraEntropy');
    return normalized;
}
/**
 * Builds a fixed-layout coder from byte lengths and nested coders.
 * Raw-length fields decode as zero-copy `subarray(...)` views, and nested coders may preserve that
 * aliasing too. Nested coder `encode(...)` results are treated as owned scratch: `splitCoder`
 * copies them into the output and then zeroizes them with `fill(0)`. If a nested encoder forwards
 * caller-owned bytes, it must do so only after detaching them into a disposable copy.
 * @param label - Label used in validation errors.
 * @param lengths - Field lengths or nested coders.
 * @returns Composite fixed-length coder.
 * @example
 * Build a fixed-layout coder from byte lengths and nested coders.
 * ```ts
 * splitCoder('demo', 1, 2).encode([new Uint8Array([1]), new Uint8Array([2, 3])]);
 * ```
 */
function splitCoder(label, ...lengths) {
    const getLength = (c) => typeof c === 'number' ? c : c.bytesLen;
    const bytesLen = lengths.reduce((sum, a) => sum + getLength(a), 0);
    return {
        bytesLen,
        encode: (bufs) => {
            const res = new Uint8Array(bytesLen);
            for (let i = 0, pos = 0; i < lengths.length; i++) {
                const c = lengths[i];
                const l = getLength(c);
                const b = typeof c === 'number' ? bufs[i] : c.encode(bufs[i]);
                abytes(b, l, label);
                res.set(b, pos);
                if (typeof c !== 'number')
                    b.fill(0); // clean
                pos += l;
            }
            return res;
        },
        decode: (buf) => {
            abytes(buf, bytesLen, label);
            const res = [];
            for (const c of lengths) {
                const l = getLength(c);
                const b = buf.subarray(0, l);
                res.push(typeof c === 'number' ? b : c.decode(b));
                buf = buf.subarray(l);
            }
            return res;
        },
    };
}
// nano-packed.array (fixed size)
/**
 * Builds a fixed-length vector coder from another fixed-length coder.
 * Element decoding receives `subarray(...)` views, so aliasing depends on the element coder.
 * Element coder `encode(...)` results are treated as owned scratch: `vecCoder` copies them into
 * the output and then zeroizes them with `fill(0)`. If an element encoder forwards caller-owned
 * bytes, it must do so only after detaching them into a disposable copy. `vecCoder` also trusts
 * the `BytesCoderLen` contract: each encoded element must already be exactly `c.bytesLen` bytes.
 * @param c - Element coder.
 * @param vecLen - Number of elements in the vector.
 * @returns Fixed-length vector coder.
 * @example
 * Build a fixed-length vector coder from another fixed-length coder.
 * ```ts
 * vecCoder(
 *   { bytesLen: 1, encode: (n: number) => Uint8Array.of(n), decode: (b: Uint8Array) => b[0] || 0 },
 *   2
 * ).encode([1, 2]);
 * ```
 */
function vecCoder(c, vecLen) {
    const coder = c;
    const bytesLen = vecLen * coder.bytesLen;
    return {
        bytesLen,
        encode: (u) => {
            const uArr = aarray(u, 'u');
            if (uArr.length !== vecLen)
                throw new RangeError(`vecCoder.encode: wrong length=${uArr.length}. Expected: ${vecLen}`);
            const res = new Uint8Array(bytesLen);
            for (let i = 0, pos = 0; i < uArr.length; i++) {
                const b = coder.encode(uArr[i]);
                res.set(b, pos);
                b.fill(0); // clean
                pos += b.length;
            }
            return res;
        },
        decode: (a) => {
            abytes(a, bytesLen);
            const r = [];
            for (let i = 0; i < a.length; i += coder.bytesLen)
                r.push(coder.decode(a.subarray(i, i + coder.bytesLen)));
            return r;
        },
    };
}
/**
 * Overwrites supported typed-array inputs with zeroes in place.
 * Accepts direct typed arrays and one-level arrays of them.
 * @param list - Typed arrays or one-level lists of typed arrays to clear.
 * @example
 * Overwrite typed arrays with zeroes.
 * ```ts
 * const buf = Uint8Array.of(1, 2, 3);
 * cleanBytes(buf);
 * ```
 */
function cleanBytes(...list) {
    for (const t of list) {
        if (Array.isArray(t))
            for (const b of t)
                b.fill(0);
        else
            t.fill(0);
    }
}
/**
 * Creates a 32-bit mask with the lowest `bits` bits set.
 * @param bits - Number of low bits to keep.
 * @returns Bit mask with `bits` ones.
 * @throws On wrong argument types. {@link TypeError}
 * @throws On wrong argument ranges or values. {@link RangeError}
 * @example
 * Create a low-bit mask for packed-field operations.
 * ```ts
 * const mask = getMask(4);
 * ```
 */
function getMask(bits) {
    anumber(bits, 'bits');
    if (bits > 32)
        throw new RangeError('"bits" expected <= 32, got ' + bits);
    // JS shifts are modulo 32, so bit 32 needs an explicit full-width mask.
    return bits === 32 ? 0xffffffff : ~(-1 << bits) >>> 0;
}
/** Shared empty byte array used as the default context. */
const EMPTY = /* @__PURE__ */ Uint8Array.of();
/**
 * Builds the domain-separated message payload for the pure sign/verify paths.
 * Context length `255` is valid; only `ctx.length > 255` is rejected.
 * @param msg - Message bytes.
 * @param ctx - Optional context bytes.
 * @returns Domain-separated message payload.
 * @throws On wrong argument ranges or values. {@link RangeError}
 * @example
 * Build the domain-separated payload before direct signing.
 * ```ts
 * const payload = getMessage(new Uint8Array([1, 2]));
 * ```
 */
function getMessage(msg, ctx = EMPTY) {
    abytes(msg, undefined, 'msg');
    abytes(ctx, undefined, 'ctx');
    if (ctx.length > 255)
        throw new RangeError('context should be 255 bytes or less');
    return concatBytes(new Uint8Array([0, ctx.length]), ctx, msg);
}
// DER tag+length plus the shared NIST hash OID arc 2.16.840.1.101.3.4.2.* used by the
// FIPS 204 / FIPS 205 pre-hash wrappers; the final byte selects SHA-256, SHA-512, SHAKE128,
// SHAKE256, or another approved hash/XOF under that subtree.
// 06 09 60 86 48 01 65 03 04 02
const oidNistP = /* @__PURE__ */ Uint8Array.from([6, 9, 0x60, 0x86, 0x48, 1, 0x65, 3, 4, 2]);
/**
 * Output length, in bytes, that each XOF OID under this arc denotes.
 *
 * Unlike a fixed hash, an XOF's OID is a promise about the digest length: RFC 8702
 * defines id-shake128 as SHAKE128 with 256-bit output and id-shake256 as SHAKE256 with
 * 512-bit output, and FIPS 204 / FIPS 205 use exactly those pairings for pre-hash. Both
 * bare noble-hashes defaults are half these values, so neither can be signed under its
 * own OID.
 */
const XOF_OID_OUTPUT_LEN = /* @__PURE__ */ (() => ({
    '060960864801650304020b': 32, // id-shake128, SHAKE128(M, 256)
    '060960864801650304020c': 64, // id-shake256, SHAKE256(M, 512)
}))();
/**
 * Validates that a hash exposes a NIST hash OID and enough collision resistance.
 * Current accepted surface is broader than the FIPS algorithm tables: any hash/XOF under the NIST
 * `2.16.840.1.101.3.4.2.*` subtree is accepted if its effective `outputLen` is strong enough.
 * XOF callers must pass a callable whose `outputLen` matches the digest length they actually intend
 * to sign; bare `shake128` / `shake256` defaults are too short for the stronger prehash modes.
 * @param hash - Hash function to validate.
 * @param requiredStrength - Minimum required collision-resistance strength in bits.
 * @throws If the hash metadata or collision resistance is insufficient. {@link Error}
 * @example
 * Validate that a hash exposes a NIST hash OID and enough collision resistance.
 * ```ts
 * import { sha256 } from '@noble/hashes/sha2.js';
 * import { checkHash } from '@noble/post-quantum/utils.js';
 * checkHash(sha256, 128);
 * ```
 */
function checkHash(hash, requiredStrength = 0) {
    if (typeof hash !== 'function' || typeof hash.create !== 'function')
        throw new TypeError('"hash" expected hash function, got type=' + typeof hash);
    ahash(hash);
    anumber(requiredStrength, 'requiredStrength');
    const oid = hash.oid;
    abytes(oid, undefined, 'hash.oid');
    if (!equalBytes(oid.subarray(0, 10), oidNistP))
        throw new Error('"hash.oid" is invalid: expected NIST hash');
    // FIPS 204 / FIPS 205 require both collision and second-preimage strength; for approved NIST
    // hashes/XOFs under this OID subtree, the collision bound from the configured digest length is
    // the tighter runtime check, so enforce that lower bound here.
    // XOFs under this arc are identified by an OID that fixes their output length:
    // FIPS 204 §5.4.1 (SHAKE128) and FIPS 205 §10.2.2 (both SHAKEs), matching RFC 8702, pair
    // id-shake128 with SHAKE128(M, 256) and id-shake256 with SHAKE256(M, 512). getMessagePrehash embeds
    // hash.oid beside hash(msg), so a shorter digest signs an M' that claims a length
    // it does not have: noble-hashes' bare shake256 defaults to 32 bytes and cleared
    // the collision bound at the 128-bit level, producing signatures a conformant
    // verifier rejects because it recomputes 512 bits. Check the length the OID
    // denotes rather than the generic bound.
    const xofLen = XOF_OID_OUTPUT_LEN[bytesToHex(oid)];
    if (xofLen !== undefined && hash.outputLen !== xofLen) {
        throw new Error('Pre-hash XOF output length must be ' + xofLen + ' bytes for this OID, got: ' + hash.outputLen);
    }
    const collisionResistance = (hash.outputLen * 8) / 2;
    if (requiredStrength > collisionResistance) {
        throw new Error('Pre-hash security strength too low: ' +
            collisionResistance +
            ', required: ' +
            requiredStrength);
    }
}
/**
 * Builds the domain-separated prehash payload for the prehash sign/verify paths.
 * Callers are expected to vet `hash.oid` first, e.g. via `checkHash(...)`; calling this helper
 * directly with a hash object that lacks `oid` currently throws later inside `concatBytes(...)`.
 * Context length `255` is valid; only `ctx.length > 255` is rejected.
 * @param hash - Prehash function.
 * @param msg - Message bytes.
 * @param ctx - Optional context bytes.
 * @returns Domain-separated prehash payload.
 * @throws On wrong argument ranges or values. {@link RangeError}
 * @example
 * Build the domain-separated prehash payload for external hashing.
 * ```ts
 * import { sha256 } from '@noble/hashes/sha2.js';
 * import { getMessagePrehash } from '@noble/post-quantum/utils.js';
 * getMessagePrehash(sha256, new Uint8Array([1, 2]));
 * ```
 */
function getMessagePrehash(hash, msg, ctx = EMPTY) {
    checkHash(hash);
    abytes(msg, undefined, 'msg');
    abytes(ctx, undefined, 'ctx');
    if (ctx.length > 255)
        throw new RangeError('context should be 255 bytes or less');
    const hashed = hash(msg);
    return concatBytes(new Uint8Array([1, ctx.length]), ctx, hash.oid, hashed);
}

/**
 * Internal methods for lattice-based ML-KEM and ML-DSA.
 * @module
 */
/*! noble-post-quantum - MIT License (c) 2024 Paul Miller (paulmillr.com) */
/**
 * Creates shared modular arithmetic, NTT, and packing helpers for CRYSTALS schemes.
 * @param opts - Polynomial and transform parameters. See {@link CrystalOpts}.
 * @returns CRYSTALS arithmetic and encoding helpers.
 * @example
 * Create shared modular arithmetic and NTT helpers for a CRYSTALS parameter set.
 * ```ts
 * const crystals = genCrystals({
 *   newPoly: (n) => new Uint16Array(n),
 *   N: 256,
 *   Q: 3329,
 *   F: 3303,
 *   ROOT_OF_UNITY: 17,
 *   brvBits: 7,
 *   isKyber: true,
 * });
 * const reduced = crystals.mod(-1);
 * ```
 */
const genCrystals = (opts) => {
    // isKyber: true means Kyber, false means Dilithium
    const { newPoly, N, Q, F, ROOT_OF_UNITY, brvBits, isKyber } = opts;
    // Normalize JS `%` into the canonical Z_m representative `[0, modulo-1]` expected by
    // FIPS 203 §2.3 / FIPS 204 §2.3 before downstream mod-q arithmetic.
    const mod = (a, modulo = Q) => {
        const result = (a % modulo) | 0;
        return (result >= 0 ? result | 0 : (modulo + result) | 0) | 0;
    };
    // FIPS 204 §7.4 uses the centered `mod ±` representative for low bits, keeping the
    // positive midpoint when `modulo` is even.
    // Center to `[-floor((modulo-1)/2), floor(modulo/2)]`.
    const smod = (a, modulo = Q) => {
        const r = mod(a, modulo) | 0;
        return (r > modulo >> 1 ? (r - modulo) | 0 : r) | 0;
    };
    // Kyber uses the FIPS 203 Appendix A `BitRev_7` table here via the first 128 entries, while
    // Dilithium uses the FIPS 204 §7.5 / Appendix B `BitRev_8` zetas table over all 256 entries.
    function getZettas() {
        const out = newPoly(N);
        for (let i = 0; i < N; i++) {
            const b = reverseBits(i, brvBits);
            const p = BigInt(ROOT_OF_UNITY) ** BigInt(b) % BigInt(Q);
            out[i] = Number(p) | 0;
        }
        return out;
    }
    const nttZetas = getZettas();
    // Number-Theoretic Transform
    // Explained: https://electricdusk.com/ntt.html
    // Kyber has slightly different params, since there is no 512th primitive root of unity mod q,
    // only 256th primitive root of unity mod. Which also complicates MultiplyNTT.
    const inv = (_a) => {
        throw new Error('not implemented');
    };
    // ML-KEM (Kyber) polynomials always enter the transform reduced to [0, Q), so add/sub only
    // need one conditional correction instead of `%`; measured ~20% faster NTT there.
    // ML-DSA keeps the generic mod() path on purpose: its first forward stage sees centered
    // (negative) coefficients, and `sub(a, t)` can drop below -Q (t is a mul output in [0, Q)),
    // so a single correction is not enough. A guarded fast path with mod() fallback was measured
    // slower than plain `%` for the 23-bit Q (V8 int32 modulo is one div; the branches lose).
    const field = isKyber
        ? {
            add: (a, b) => {
                const r = (a + b) | 0;
                return r >= Q ? (r - Q) | 0 : r;
            },
            sub: (a, b) => {
                const r = (a - b) | 0;
                return r < 0 ? (r + Q) | 0 : r;
            },
            mul: (a, b) => mod((a | 0) * (b | 0)) | 0,
            inv,
        }
        : {
            add: (a, b) => mod((a | 0) + (b | 0)) | 0,
            sub: (a, b) => mod((a | 0) - (b | 0)) | 0,
            mul: (a, b) => mod((a | 0) * (b | 0)) | 0,
            inv,
        };
    const nttOpts = {
        N,
        roots: nttZetas,
        invertButterflies: true,
        skipStages: isKyber ? 1 : 0,
        brp: false,
    };
    const dif = FFTCore(field, { dit: false, ...nttOpts });
    const dit = FFTCore(field, { dit: true, ...nttOpts });
    const NTT = {
        encode: (r) => {
            return dif(r);
        },
        decode: (r) => {
            dit(r);
            // The inverse-NTT normalization factor is family-specific: FIPS 203 Algorithm 10 line 14
            // uses `128^-1 mod q` for Kyber, while FIPS 204 Algorithm 42 lines 21-23 use `256^-1 mod q`.
            // kyber uses 128 here, because brv && stuff
            for (let i = 0; i < r.length; i++)
                r[i] = mod(F * r[i]);
            return r;
        },
    };
    // Pack one little-endian `d`-bit word per coefficient, matching FIPS 203 ByteEncode /
    // ByteDecode and the FIPS 204 BitsToBytes-based polynomial packing helpers.
    const bitsCoder = (d, c) => {
        // Validate the carry shape once: JS bitwise operations silently truncate wider accumulators.
        for (let i = 0, bufLen = 0; i < N; i++) {
            bufLen += d;
            if (bufLen > 32)
                getMask(bufLen);
            bufLen %= 8;
        }
        const mask = getMask(d);
        const bytesLen = d * (N / 8);
        return {
            bytesLen,
            encode: (poly_) => {
                const poly = poly_;
                const r = new Uint8Array(bytesLen);
                for (let i = 0, buf = 0, bufLen = 0, pos = 0; i < poly.length; i++) {
                    buf |= (c.encode(poly[i]) & mask) << bufLen;
                    bufLen += d;
                    // Take the low byte directly: `& 0xff` matches the previous getMask(bufLen) result
                    // after Uint8Array truncation, without a validated function call per output byte.
                    for (; bufLen >= 8; bufLen -= 8, buf >>= 8)
                        r[pos++] = buf & 0xff;
                }
                return r;
            },
            decode: (bytes) => {
                const r = newPoly(N);
                for (let i = 0, buf = 0, bufLen = 0, pos = 0; i < bytes.length; i++) {
                    buf |= bytes[i] << bufLen;
                    bufLen += 8;
                    for (; bufLen >= d; bufLen -= d, buf >>= d)
                        r[pos++] = c.decode(buf & mask);
                }
                return r;
            },
        };
    };
    return {
        mod,
        smod,
        nttZetas: nttZetas,
        NTT: {
            encode: (r) => NTT.encode(r),
            decode: (r) => NTT.decode(r),
        },
        bitsCoder: bitsCoder,
    };
};
const createXofShake = (shake) => (seed, blockLen) => {
    if (!blockLen)
        blockLen = shake.blockLen;
    // Optimizations that won't mater:
    // - cached seed update (two .update(), on start and on the end)
    // - another cache which cloned into working copy
    // Faster than multiple updates, since seed less than blockLen
    const _seed = new Uint8Array(seed.length + 2);
    _seed.set(seed);
    const seedLen = seed.length;
    const buf = new Uint8Array(blockLen); // == shake128.blockLen
    let h = shake.create({});
    let calls = 0;
    let xofs = 0;
    return {
        stats: () => ({ calls, xofs }),
        get: (x, y) => {
            // Rebind to `seed || x || y` so callers can implement the spec's per-coordinate
            // SHAKE inputs like `rho || j || i` and `rho || IntegerToBytes(counter, 2)`.
            _seed[seedLen + 0] = x;
            _seed[seedLen + 1] = y;
            h.destroy();
            h = shake.create({}).update(_seed);
            calls++;
            return () => {
                xofs++;
                return h.xofInto(buf);
            };
        },
        clean: () => {
            h.destroy();
            cleanBytes(buf, _seed);
        },
    };
};
/**
 * SHAKE128-based extendable-output reader factory used by ML-KEM.
 * `get(x, y)` selects one coordinate pair at a time; calling it again invalidates previously
 * returned readers, and each squeeze reuses one mutable internal output buffer.
 * @param seed - Seed bytes for the reader.
 * @param blockLen - Optional output block length.
 * @returns Stateful XOF reader.
 * @example
 * Build the ML-KEM SHAKE128 matrix expander and read one block.
 * ```ts
 * import { randomBytes } from '@noble/post-quantum/utils.js';
 * import { XOF128 } from '@noble/post-quantum/_crystals.js';
 * const reader = XOF128(randomBytes(32));
 * const block = reader.get(0, 0)();
 * ```
 */
const XOF128 = /* @__PURE__ */ createXofShake(shake128);
/**
 * SHAKE256-based extendable-output reader factory used by ML-DSA.
 * `get(x, y)` appends raw one-byte coordinates to the seed, invalidates previously returned
 * readers, and reuses one mutable internal output buffer for each squeeze.
 * @param seed - Seed bytes for the reader.
 * @param blockLen - Optional output block length.
 * @returns Stateful XOF reader.
 * @example
 * Build the ML-DSA SHAKE256 coefficient expander and read one block.
 * ```ts
 * import { randomBytes } from '@noble/post-quantum/utils.js';
 * import { XOF256 } from '@noble/post-quantum/_crystals.js';
 * const reader = XOF256(randomBytes(32));
 * const block = reader.get(0, 0)();
 * ```
 */
const XOF256 = /* @__PURE__ */ createXofShake(shake256);

/**
 * ML-KEM: Module Lattice-based Key Encapsulation Mechanism from
 * [FIPS-203](https://csrc.nist.gov/pubs/fips/203/ipd). A.k.a. CRYSTALS-Kyber.
 *
 * Key encapsulation is similar to DH / ECDH (think X25519), with important differences:
 * * Unlike in ECDH, we can't verify if it was "Bob" who've sent the shared secret
 * * Unlike ECDH, it is probabalistic and relies on quality of randomness (CSPRNG).
 * * Decapsulation never throws an error, even when shared secret was
 *   encrypted by a different public key. It will just return a different shared secret.
 *
 * There are some concerns with regards to security: see
 * [djb blog](https://blog.cr.yp.to/20231003-countcorrectly.html) and
 * [mailing list](https://groups.google.com/a/list.nist.gov/g/pqc-forum/c/W2VOzy0wz_E).
 *
 * Has similar internals to ML-DSA, but their keys and params are different.
 *
 * Check out [official site](https://www.pq-crystals.org/kyber/resources.shtml),
 * [repo](https://github.com/pq-crystals/kyber),
 * [spec](https://datatracker.ietf.org/doc/draft-cfrg-schwabe-kyber/).
 * @module
 */
/*! noble-post-quantum - MIT License (c) 2024 Paul Miller (paulmillr.com) */
/** Key encapsulation mechanism interface */
const N$1 = 256; // Kyber (not FIPS-203) supports different lengths, but all std modes were using 256
const Q$1 = 3329; // 13*(2**8)+1, modulo prime
const F$1 = 3303; // 3303 ≡ 128**(−1) mod q (FIPS-203)
const ROOT_OF_UNITY$1 = 17; // ζ = 17 ∈ Zq is a primitive 256-th root of unity modulo Q. ζ**128 ≡−1
// treeshake: keep genCrystals behind the object so PARAMS-only bundles can drop it entirely.
// Shared CRYSTALS helper in the ML-KEM branch: Kyber mode, 7-bit bit-reversal,
// and Uint16Array polys because current coefficients stay reduced modulo q.
const crystals$1 = /* @__PURE__ */ genCrystals({
    N: N$1,
    Q: Q$1,
    F: F$1,
    ROOT_OF_UNITY: ROOT_OF_UNITY$1,
    newPoly: (n) => new Uint16Array(n),
    brvBits: 7,
    isKyber: true,
});
/** Internal params of ML-KEM versions */
// prettier-ignore
/** Built-in ML-KEM parameter presets keyed by the public export names
 * `ml_kem512` / `ml_kem768` / `ml_kem1024`.
 * `RBGstrength` is Table 2's required randomness-source strength in bits,
 * not a generic security label.
 */
const PARAMS$1 = /* @__PURE__ */ (() => Object.freeze({
    512: Object.freeze({ N: N$1, Q: Q$1, K: 2, ETA1: 3, ETA2: 2, du: 10, dv: 4, RBGstrength: 128 }),
    768: Object.freeze({ N: N$1, Q: Q$1, K: 3, ETA1: 2, ETA2: 2, du: 10, dv: 4, RBGstrength: 192 }),
    1024: Object.freeze({ N: N$1, Q: Q$1, K: 4, ETA1: 2, ETA2: 2, du: 11, dv: 5, RBGstrength: 256 }),
}))();
// FIPS-203: compress/decompress
const compress = (d) => {
    // d=12 is the ByteEncode12/ByteDecode12 path, not lossy compression.
    // ByteDecode12 interprets each 12-bit word modulo q; without that reduction the public-key
    // modulus check in encapsulate() becomes a no-op for malformed coefficients like 4095.
    if (d >= 12)
        return { encode: (i) => i, decode: (i) => (i >= Q$1 ? i - Q$1 : i) };
    // Comments map to python implementation in RFC (draft-cfrg-schwabe-kyber)
    // const round = (i: number) => Math.floor(i + 0.5) | 0;
    const a = 2 ** (d - 1);
    return {
        // This only matches standalone Compress_d after bitsCoder masks the result into Z_(2^d).
        encode: (i) => ((i << d) + Q$1 / 2) / Q$1,
        // const decompress = (i: number) => round((Q / 2 ** d) * i);
        decode: (i) => (i * Q$1 + a) >>> d,
    };
};
// Raw ByteEncode_d / ByteDecode_d from FIPS 203 operate on d-bit words directly.
// That differs from `polyCoder(d)` for d<12, where noble folds packing together with the lossy
// ciphertext compression step used by u/v. Tests that exercise the spec's raw packing surface need
// this exact non-lossy variant instead.
const byteCoder = (d) => crystals$1.bitsCoder(d, { encode: (i) => i, decode: (i) => (i >= Q$1 ? i - Q$1 : i) }
    );
// NOTE: we merge encoding and compress because it is faster, also both require same d param
// d=12 is the ByteEncode12/ByteDecode12 path rather than compression, and caller-side
// public-key modulus checks route through this helper's decode/encode roundtrip.
// Converts between bytes and d-bits compressed representation.
// Kinda like convertRadix2 from @scure/base.
// decode(encode(t)) == t, but there is loss of information on encode(decode(t))
const polyCoder$1 = (d) => (d === 12 ? byteCoder(12) : crystals$1.bitsCoder(d, compress(d)));
// Coefficients always stay reduced in [0, Q) here (samplers, NTT and coders all reduce),
// so one conditional correction replaces the generic mod().
function polyAdd$1(a_, b_) {
    const a = a_;
    const b = b_;
    // Mutates `a` in place; callers must pass two N=256 polynomials.
    for (let i = 0; i < N$1; i++) {
        const r = a[i] + b[i]; // a += b
        a[i] = r >= Q$1 ? r - Q$1 : r;
    }
}
function polySub$1(a_, b_) {
    const a = a_;
    const b = b_;
    // Mutates `a` in place; callers must pass two N=256 polynomials.
    for (let i = 0; i < N$1; i++) {
        const r = a[i] - b[i]; // a -= b
        a[i] = r < 0 ? r + Q$1 : r;
    }
}
// FIPS-203: Computes the product of two degree-one polynomials with respect to a quadratic modulus
function BaseCaseMultiply(a0, a1, b0, b1, zeta) {
    // `zeta` here is Algorithm 11's γ = ζ^(2BitRev_7(i)+1).
    // Reduce a1*b1 before multiplying by zeta: a1*b1*zeta would reach ~2^35, forcing JS engines
    // into slow float fmod; with the extra reduction every intermediate fits int32.
    const c0 = crystals$1.mod(crystals$1.mod(a1 * b1) * zeta + a0 * b0);
    const c1 = crystals$1.mod(a0 * b1 + a1 * b0);
    return { c0, c1 };
}
// FIPS-203: Computes the product (in the ring Tq) of two NTT representations.
// Works in place on `f`; `g` is read-only and both inputs must already be in NTT form.
function MultiplyNTTs$1(f_, g_) {
    const f = f_;
    const g = g_;
    for (let i = 0; i < N$1 / 2; i++) {
        let z = crystals$1.nttZetas[64 + (i >> 1)];
        if (i & 1)
            z = -z;
        const { c0, c1 } = BaseCaseMultiply(f[2 * i + 0], f[2 * i + 1], g[2 * i + 0], g[2 * i + 1], z);
        f[2 * i + 0] = c0;
        f[2 * i + 1] = c1;
    }
    return f;
}
// Return poly in NTT representation
function SampleNTT(xof_) {
    const xof = xof_;
    // The reader must already bind the Algorithm 7 seed||j||i bytes
    // and return block lengths divisible by 3.
    const r = new Uint16Array(N$1);
    for (let j = 0; j < N$1;) {
        const b = xof();
        if (b.length % 3)
            throw new Error('SampleNTT: unaligned block');
        for (let i = 0; j < N$1 && i + 3 <= b.length; i += 3) {
            const d1 = ((b[i + 0] >> 0) | (b[i + 1] << 8)) & 0xfff;
            const d2 = ((b[i + 1] >> 4) | (b[i + 2] << 4)) & 0xfff;
            if (d1 < Q$1)
                r[j++] = d1;
            if (j < N$1 && d2 < Q$1)
                r[j++] = d2;
        }
    }
    return r;
}
// Sampling from the centered binomial distribution
// Returns poly with small coefficients (noise/errors) stored modulo q in ordinary coefficient form.
// Current callers only use Table 2 eta values {2,3} and PRF outputs of exactly 64*eta bytes.
const sampleCBDBytes = (buf, eta) => {
    const r = new Uint16Array(N$1);
    // CBD consumes the PRF bitstream in little-endian byte order; normalize the word view on BE,
    // then swap it back so callers still observe `buf` as read-only.
    const b32 = u32(buf);
    swap32IfBE(b32);
    let len = 0;
    for (let i = 0, p = 0, bb = 0, t0 = 0; i < b32.length; i++) {
        let b = b32[i];
        for (let j = 0; j < 32; j++) {
            bb += b & 1;
            b >>= 1;
            len += 1;
            if (len === eta) {
                t0 = bb;
                bb = 0;
            }
            else if (len === 2 * eta) {
                r[p++] = crystals$1.mod(t0 - bb);
                bb = 0;
                len = 0;
            }
        }
    }
    swap32IfBE(b32);
    if (len)
        throw new Error(`sampleCBD: leftover bits: ${len}`);
    return r;
};
function sampleCBD(PRF_, seed, nonce, eta) {
    const PRF = PRF_;
    return sampleCBDBytes(PRF((eta * N$1) / 4, seed, nonce), eta);
}
// K-PKE
// Internal ML-KEM subroutine only: exact 32-byte `seed` / `msg` inputs
// come from Algorithms 13-15, and the helper mutates decoded temporary
// polynomials in place while leaving caller byte arrays unchanged.
const genKPKE = (opts_) => {
    const opts = opts_;
    const { K, PRF, XOF, HASH512, ETA1, ETA2, du, dv } = opts;
    const poly1 = polyCoder$1(1);
    const polyV = polyCoder$1(dv);
    const polyU = polyCoder$1(du);
    const publicCoder = splitCoder('publicKey', vecCoder(polyCoder$1(12), K), 32);
    const secretCoder = vecCoder(polyCoder$1(12), K);
    const cipherCoder = splitCoder('ciphertext', vecCoder(polyU, K), polyV);
    const seedCoder = splitCoder('seed', 32, 32);
    // Algorithm 14 (K-PKE.Encrypt) core, after ek parsing. `tHat` and every poly returned by
    // `getA(i, j)` are treated as disposable scratch: they are mutated in place and wiped/dropped,
    // so callers holding cached copies must pass fresh copies.
    const encryptCore = (tHat, getA, msg, seed) => {
        const rHat = [];
        for (let i = 0; i < K; i++)
            rHat.push(crystals$1.NTT.encode(sampleCBD(PRF, seed, i, ETA1)));
        const tmp2 = new Uint16Array(N$1);
        const u = [];
        for (let i = 0; i < K; i++) {
            const e1 = sampleCBD(PRF, seed, K + i, ETA2);
            const tmp = new Uint16Array(N$1);
            for (let j = 0; j < K; j++) {
                const aij = getA(i, j); // A[j][i], inplace transpose access
                polyAdd$1(tmp, MultiplyNTTs$1(aij, rHat[j])); // t += aij * rHat[j]
            }
            polyAdd$1(e1, crystals$1.NTT.decode(tmp)); // e1 += tmp
            u.push(e1);
            polyAdd$1(tmp2, MultiplyNTTs$1(tHat[i], rHat[i])); // t2 += tHat[i] * rHat[i]
            cleanBytes(tmp);
        }
        const e2 = sampleCBD(PRF, seed, 2 * K, ETA2);
        polyAdd$1(e2, crystals$1.NTT.decode(tmp2)); // e2 += tmp2
        const v = poly1.decode(msg); // encode plaintext m into polynomial v
        polyAdd$1(v, e2); // v += e2
        cleanBytes(tHat, rHat, tmp2, e2);
        return cipherCoder.encode([u, v]);
    };
    return {
        secretCoder,
        lengths: {
            secretKey: secretCoder.bytesLen,
            publicKey: publicCoder.bytesLen,
            cipherText: cipherCoder.bytesLen,
        },
        keygen: (seed) => {
            abytesDoc(seed, 32, 'seed');
            const seedDst = new Uint8Array(33);
            seedDst.set(seed);
            // FIPS 203 Algorithm 13 appends the parameter-set byte `k`
            // before `G(d || k)`, so expanding the same 32-byte seed
            // under a different ML-KEM parameter set yields unrelated keys.
            seedDst[32] = K;
            const seedHash = HASH512(seedDst);
            const [rho, sigma] = seedCoder.decode(seedHash);
            const sHat = [];
            const tHat = [];
            for (let i = 0; i < K; i++)
                sHat.push(crystals$1.NTT.encode(sampleCBD(PRF, sigma, i, ETA1)));
            const x = XOF(rho);
            for (let i = 0; i < K; i++) {
                const e = crystals$1.NTT.encode(sampleCBD(PRF, sigma, K + i, ETA1));
                for (let j = 0; j < K; j++) {
                    const aji = SampleNTT(x.get(j, i)); // A[i][j], inplace
                    polyAdd$1(e, MultiplyNTTs$1(aji, sHat[j]));
                }
                tHat.push(e); // t ← A ◦ s + e
            }
            x.clean();
            const res = {
                publicKey: publicCoder.encode([tHat, rho]),
                secretKey: secretCoder.encode(sHat),
            };
            cleanBytes(rho, sigma, sHat, tHat, seedDst, seedHash);
            return res;
        },
        encrypt: (publicKey, msg, seed) => {
            const [tHat, rho] = publicCoder.decode(publicKey);
            const x = XOF(rho);
            const res = encryptCore(tHat, (i, j) => SampleNTT(x.get(i, j)), msg, seed);
            x.clean();
            return res;
        },
        // Expands the full Â matrix (public data derived from rho) once, so repeated encryptions
        // against the same ek skip the K² SampleNTT XOF expansions. Cached polys are copied per
        // call because encryptCore mutates its inputs in place.
        prepare: (publicKey) => {
            const [tHat, rho] = publicCoder.decode(publicKey);
            const x = XOF(rho);
            const A = [];
            for (let i = 0; i < K; i++)
                for (let j = 0; j < K; j++)
                    A.push(SampleNTT(x.get(i, j)));
            x.clean();
            return {
                encrypt: (msg, seed) => encryptCore(tHat.map((p) => p.slice()), (i, j) => A[i * K + j].slice(), msg, seed),
                clean: () => cleanBytes(tHat, A),
            };
        },
        decrypt: (cipherText, privateKey) => {
            const [u, v] = cipherCoder.decode(cipherText);
            const sk = secretCoder.decode(privateKey); // s  ← ByteDecode_12(dkPKE)
            const tmp = new Uint16Array(N$1);
            // tmp += sk[i] * u[i]
            for (let i = 0; i < K; i++)
                polyAdd$1(tmp, MultiplyNTTs$1(sk[i], crystals$1.NTT.encode(u[i])));
            polySub$1(v, crystals$1.NTT.decode(tmp)); // w = v' - tmp
            // `v` now holds w, from which the plaintext is just a 1-bit threshold away, so wipe it too.
            // encode() allocates its own buffer, so the returned bytes do not alias `v`.
            const res = poly1.encode(v);
            cleanBytes(tmp, sk, u, v);
            return res;
        },
    };
};
/**
 * Public ML-KEM wrapper over the internal K-PKE subroutine.
 * `keygen(seed)` and `encapsulate(publicKey, msg)` are deterministic/test-oriented hooks that map
 * more directly to Algorithms 16-17 than to the pure no-input / random-internal Algorithms 19-20.
 * `encapsulate`'s optional `msg` is the 32-byte message randomness `m` of Algorithm 17, the
 * pre-image the shared secret is derived from, NOT a plaintext to encrypt: ML-KEM is a key
 * encapsulation mechanism, not a cipher. Omit it to draw fresh randomness; pass it only to
 * reproduce a known-answer vector, and only as 32 uniformly random bytes, since a low-entropy or
 * reused value makes the shared secret predictable. The same holds for `keygen`'s optional `seed`.
 * decapsulate() tries to follow the Algorithms 18/21 implicit-reject structure as closely as
 * practical here by re-encrypting, comparing ciphertexts, returning `Khat` on match or `Kbar` on
 * mismatch, and zeroizing the non-returned shared-secret candidate; JS/JIT still provides no
 * constant-time guarantees for that path.
 */
function createKyber(opts) {
    const rawOpts = opts;
    const KPKE = genKPKE(rawOpts);
    const { HASH256, HASH512, KDF } = rawOpts;
    const { secretCoder: KPKESecretCoder, lengths } = KPKE;
    const secretCoder = splitCoder('secretKey', lengths.secretKey, lengths.publicKey, 32, 32);
    const msgLen = 32;
    const seedLen = 64;
    // FIPS-203 includes additional verification check for modulus
    const validateModulus = (publicKey, fn) => {
        const eke = publicKey.subarray(0, 384 * rawOpts.K);
        // Copy because of inplace encoding
        const ek = KPKESecretCoder.encode(KPKESecretCoder.decode(copyBytes(eke)));
        // (Modulus check.) Perform the computation ek ← ByteEncode12(ByteDecode12(eke)).
        // If ek = ̸ eke, the input is invalid. (See Section 4.2.1.)
        const ok = equalBytes(ek, eke);
        cleanBytes(ek);
        if (!ok)
            throw new Error(`ML-KEM.${fn}: wrong publicKey modulus`);
    };
    const kemLengths = Object.freeze({
        ...lengths,
        seed: 64,
        msg: msgLen,
        msgRand: msgLen,
        secretKey: secretCoder.bytesLen,
    });
    return Object.freeze({
        info: Object.freeze({ type: 'ml-kem' }),
        lengths: kemLengths,
        keygen: (seed) => {
            // A generated seed carries z (the implicit-rejection secret) and must be wiped once the
            // secret key holds a copy, matching ml-dsa / slh-dsa / falcon keygen. A caller-supplied
            // seed is the caller's to manage (and the immutability test requires it stay untouched).
            const ownSeed = seed === undefined;
            const s = ownSeed ? randomBytes(seedLen) : seed;
            let sk;
            let publicKeyHash;
            try {
                abytesDoc(s, seedLen, 'seed');
                const keys = KPKE.keygen(s.subarray(0, 32));
                const publicKey = keys.publicKey;
                sk = keys.secretKey;
                publicKeyHash = HASH256(publicKey);
                // (dkPKE||ek||H(ek)||z)
                const secretKey = secretCoder.encode([sk, publicKey, publicKeyHash, s.subarray(32)]);
                return {
                    publicKey: publicKey,
                    secretKey: secretKey,
                };
            }
            finally {
                if (sk !== undefined)
                    cleanBytes(sk);
                if (publicKeyHash !== undefined)
                    cleanBytes(publicKeyHash);
                if (ownSeed)
                    cleanBytes(s);
            }
        },
        getPublicKey: (secretKey) => {
            const [_sk, publicKey, _publicKeyHash, _z] = secretCoder.decode(secretKey);
            return Uint8Array.from(publicKey);
        },
        encapsulate: (publicKey, msg) => {
            // A generated message is the preimage of the shared secret (K = G(m || H(ek))[0:32]) and
            // must be wiped. A caller-supplied message is the deterministic-randomness hook and the
            // caller's to manage (the immutability test requires it stay untouched).
            const ownMsg = msg === undefined;
            const m = ownMsg ? randomBytes(msgLen) : msg;
            let kr;
            try {
                abytesDoc(publicKey, lengths.publicKey, 'publicKey');
                abytesDoc(m, msgLen, 'message');
                validateModulus(publicKey, 'encapsulate');
                // derive randomness
                kr = HASH512.create().update(m).update(HASH256(publicKey)).digest();
                const cipherText = KPKE.encrypt(publicKey, m, kr.subarray(32, 64));
                return {
                    cipherText: cipherText,
                    sharedSecret: kr.subarray(0, 32),
                };
            }
            finally {
                if (kr !== undefined)
                    cleanBytes(kr.subarray(32));
                if (ownMsg)
                    cleanBytes(m);
            }
        },
        decapsulate: (cipherText, secretKey) => {
            abytesDoc(secretKey, secretCoder.bytesLen, 'secretKey'); // 768*k + 96
            abytesDoc(cipherText, lengths.cipherText, 'cipherText'); // 32(du*k + dv)
            // test ← H(dk[384𝑘 ∶ 768𝑘 + 32])) .
            const k768 = secretCoder.bytesLen - 96;
            const start = k768 + 32;
            const test = HASH256(secretKey.subarray(k768 / 2, start));
            // If test ≠ dk[768𝑘 + 32 ∶ 768𝑘 + 64], then input checking has failed.
            if (!equalBytes(test, secretKey.subarray(start, start + 32)))
                throw new Error('invalid secretKey: hash check failed');
            const [sk, publicKey, publicKeyHash, z] = secretCoder.decode(secretKey);
            const msg = KPKE.decrypt(cipherText, sk);
            // derive randomness, Khat, rHat = G(mHat || h)
            const kr = HASH512.create().update(msg).update(publicKeyHash).digest();
            const Khat = kr.subarray(0, 32);
            // re-encrypt using the derived randomness
            const cipherText2 = KPKE.encrypt(publicKey, msg, kr.subarray(32, 64));
            // if ciphertexts do not match, “implicitly reject”
            const isValid = equalBytes(cipherText, cipherText2);
            const Kbar = KDF.create({ dkLen: 32 }).update(z).update(cipherText).digest();
            // kr[32:64] is the derived K-PKE encryption randomness: wipe it like encapsulate() does.
            cleanBytes(msg, cipherText2, kr.subarray(32), !isValid ? Khat : Kbar);
            return (isValid ? Khat : Kbar);
        },
        /**
         * Experimental prototype: pre-expand a public key so repeated encapsulate/decapsulate
         * against the same key skip re-validation, H(ek), t̂ decoding and the K² SampleNTT
         * XOF expansions of Â. Only public data is cached; see {@link KEMPrepared}.
         */
        prepare: (publicKey) => {
            abytesDoc(publicKey, lengths.publicKey, 'publicKey');
            validateModulus(publicKey, 'prepare');
            const ek = copyBytes(publicKey); // detach from the caller before caching
            const publicKeyHash = HASH256(ek);
            const cached = KPKE.prepare(ek);
            return Object.freeze({
                publicKey: ek,
                encapsulate: (msg) => {
                    // As in the non-prepared encapsulate: a generated message is the shared-secret
                    // preimage and is wiped; a caller-supplied one is left untouched.
                    const ownMsg = msg === undefined;
                    const m = ownMsg ? randomBytes(msgLen) : msg;
                    let kr;
                    try {
                        abytesDoc(m, msgLen, 'message');
                        kr = HASH512.create().update(m).update(publicKeyHash).digest();
                        const cipherText = cached.encrypt(m, kr.subarray(32, 64));
                        return {
                            cipherText: cipherText,
                            sharedSecret: kr.subarray(0, 32),
                        };
                    }
                    finally {
                        if (kr !== undefined)
                            cleanBytes(kr.subarray(32));
                        if (ownMsg)
                            cleanBytes(m);
                    }
                },
                decapsulate: (cipherText, secretKey) => {
                    abytesDoc(secretKey, secretCoder.bytesLen, 'secretKey');
                    abytesDoc(cipherText, lengths.cipherText, 'cipherText');
                    const [sk, ekEmbedded, storedHash, z] = secretCoder.decode(secretKey);
                    // Under KEMPrepared's read-only publicKey contract, bind dk to the prepared key.
                    // Together with publicKeyHash = H(ek) computed in prepare(), this is equivalent to (and
                    // stronger than) FIPS 203 §7.3's `H(dk[384k : 768k+32]) == dk[768k+32 : 768k+64]`.
                    if (!equalBytes(ekEmbedded, ek) || !equalBytes(storedHash, publicKeyHash))
                        throw new Error('ML-KEM.decapsulate: secretKey does not match prepared publicKey');
                    const msg = KPKE.decrypt(cipherText, sk);
                    // derive randomness, Khat, rHat = G(mHat || h)
                    const kr = HASH512.create().update(msg).update(publicKeyHash).digest();
                    const Khat = kr.subarray(0, 32);
                    // re-encrypt using the derived randomness and cached Â/t̂
                    const cipherText2 = cached.encrypt(msg, kr.subarray(32, 64));
                    // if ciphertexts do not match, “implicitly reject”
                    const isValid = equalBytes(cipherText, cipherText2);
                    const Kbar = KDF.create({ dkLen: 32 }).update(z).update(cipherText).digest();
                    cleanBytes(msg, cipherText2, kr.subarray(32), !isValid ? Khat : Kbar);
                    return (isValid ? Khat : Kbar);
                },
                clean: cached.clean,
            });
        },
    });
}
// FIPS 203's PRF_eta binding: current callers use only 32-byte keys, one-byte nonces,
// and dkLen values {128, 192}; out-of-range nonce numbers still wrap modulo 256 here.
function shakePRF(dkLen, key, nonce) {
    return shake256
        .create({ dkLen })
        .update(key)
        .update(new Uint8Array([nonce]))
        .digest();
}
// Fixed ML-KEM hash/XOF bindings. `KDF` here is the spec's fixed 32-byte `J` call,
// and swapping any field changes the scheme rather than tuning an internal dependency.
const opts = /* @__PURE__ */ (() => ({
    HASH256: sha3_256,
    HASH512: sha3_512,
    KDF: shake256,
    XOF: XOF128,
    PRF: shakePRF,
}))();
// Parameter-set instantiation step for the spec's "ML-KEM-x" names; current correctness relies
// on the internal PARAMS rows rather than local validation of arbitrary KEMParam objects.
const mk = (params) => createKyber({
    ...opts,
    ...params,
});
/**
 * ML-KEM-768: Table 2 row `k=3, η1=2, η2=2, du=10, dv=4`; Table 3 sizes `1184/2400/1088/32`.
 * The ASD lifecycle note here is external policy guidance, not a FIPS 203 requirement.
 */
const ml_kem768 = /* @__PURE__ */ (() => mk(PARAMS$1[768]))();

/**
 * ML-DSA: Module Lattice-based Digital Signature Algorithm from
 * [FIPS-204](https://csrc.nist.gov/pubs/fips/204/ipd). A.k.a. CRYSTALS-Dilithium.
 *
 * Has similar internals to ML-KEM, but their keys and params are different.
 * Check out [official site](https://www.pq-crystals.org/dilithium/index.shtml),
 * [repo](https://github.com/pq-crystals/dilithium).
 * @module
 */
/*! noble-post-quantum - MIT License (c) 2024 Paul Miller (paulmillr.com) */
/**
 * Keys each internal surface accepts.
 *
 * `context` is deliberately absent from both. The internal functions never read it: the
 * public wrappers consume it when they format `M'` and must not pass it down, because a
 * key that is accepted and then not acted on is the same silent downgrade this validation
 * exists to prevent. `externalMu` is the mirror case, existing here and rejected above.
 * `extraEntropy` is signing-only, so verification does not take it either.
 */
const INTERNAL_SIG_OPT_KEYS = /* @__PURE__ */ Object.freeze([
    'extraEntropy',
    'externalMu',
]);
const INTERNAL_VER_OPT_KEYS = /* @__PURE__ */ Object.freeze(['externalMu']);
function validateInternalOpts(opts, allowed) {
    const normalized = checkOptKeys(opts, allowed);
    if (normalized.externalMu !== undefined)
        abool(normalized.externalMu, 'opts.externalMu');
    return normalized;
}
// Constants
// FIPS 204 fixes ML-DSA over R = Z[X]/(X^256 + 1), so every polynomial has 256 coefficients.
const N = 256;
// 2**23 − 2**13 + 1, 23 bits: multiply will be 46. We have enough precision in JS to avoid bigints
const Q = 8380417;
// FIPS 204 §2.5 / Table 1 fixes zeta = 1753 as the 512th root of unity used by ML-DSA's NTT.
const ROOT_OF_UNITY = 1753;
// f = 256**−1 mod q, pow(256, -1, q) = 8347681 (python3)
const F = 8347681;
// FIPS 204 Table 1 / §7.4 fixes d = 13 dropped low bits for Power2Round on t.
const D = 13;
// FIPS 204 Table 1 fixes gamma2 to (q-1)/88 for ML-DSA-44 and (q-1)/32 for ML-DSA-65/87;
// §7.4 then uses alpha = 2*gamma2 for Decompose / MakeHint / UseHint.
// Dilithium is kinda parametrized over GAMMA2, but everything will break with any other value.
const GAMMA2_1 = Math.floor((Q - 1) / 88) | 0;
const GAMMA2_2 = Math.floor((Q - 1) / 32) | 0;
/** Internal params for different versions of ML-DSA  */
// prettier-ignore
/** Built-in ML-DSA parameter presets keyed by security categories `2/3/5`
 * for `ml_dsa44` / `ml_dsa65` / `ml_dsa87`.
 * This is only the Table 1 subset used directly here: `BETA = TAU * ETA` is derived later,
 * while `C_TILDE_BYTES`, `TR_BYTES`, `CRH_BYTES`, and `securityLevel` live in the preset wrappers.
 */
const PARAMS = /* @__PURE__ */ (() => Object.freeze({
    2: Object.freeze({
        K: 4, L: 4, D, GAMMA1: 2 ** 17, GAMMA2: GAMMA2_1, TAU: 39, ETA: 2, OMEGA: 80
    }),
    3: Object.freeze({
        K: 6, L: 5, D, GAMMA1: 2 ** 19, GAMMA2: GAMMA2_2, TAU: 49, ETA: 4, OMEGA: 55
    }),
    5: Object.freeze({
        K: 8, L: 7, D, GAMMA1: 2 ** 19, GAMMA2: GAMMA2_2, TAU: 60, ETA: 2, OMEGA: 75
    }),
}))();
const newPoly = (n) => new Int32Array(n);
// Shared CRYSTALS helper in the ML-DSA branch: non-Kyber mode, 8-bit bit-reversal,
// and Int32Array polys because ordinary-form coefficients can be negative / centered.
const crystals = /* @__PURE__ */ genCrystals({
    N,
    Q,
    F,
    ROOT_OF_UNITY,
    newPoly,
    isKyber: false,
    brvBits: 8,
});
const id = (n) => n;
// compress()/verify() must be compatible in both directions:
// wrap the shared d-bit packer with the FIPS 204 SimpleBitPack / BitPack coefficient maps.
// malformed-input rejection only happens through the optional verify hook.
const polyCoder = (d, compress = id, verify = id) => crystals.bitsCoder(d, {
    encode: (i) => compress(verify(i)),
    decode: (i) => verify(compress(i)),
});
// Mutates `a` in place; callers must pass same-length polynomials.
// NOTE: conditional-reduction variants (as in ml-kem) were measured performance-neutral here —
// int32 `%` with 23-bit Q is already cheap — so the simpler mod() form is kept for audit.
const polyAdd = (a_, b_) => {
    const a = a_;
    const b = b_;
    for (let i = 0; i < a.length; i++)
        a[i] = crystals.mod(a[i] + b[i]);
    return a;
};
// Mutates `a` in place; callers must pass same-length polynomials.
const polySub = (a_, b_) => {
    const a = a_;
    const b = b_;
    for (let i = 0; i < a.length; i++)
        a[i] = crystals.mod(a[i] - b[i]);
    return a;
};
// Mutates `p` in place and assumes it is a decoded `t1`-range polynomial.
const polyShiftl = (p_) => {
    const p = p_;
    for (let i = 0; i < N; i++)
        p[i] <<= D;
    return p;
};
const polyChknorm = (p_, B) => {
    const p = p_;
    // FIPS 204 Algorithms 7 and 8 express the same centered-norm check with explicit inequalities.
    for (let i = 0; i < N; i++)
        if (Math.abs(crystals.smod(p[i])) >= B)
            return true;
    return false;
};
// Both inputs must already be in NTT / `T_q` form.
const MultiplyNTTs = (a_, b_) => {
    const a = a_;
    const b = b_;
    // NOTE: we don't use montgomery reduction in code, since it requires 64 bit ints,
    // which is not available in JS. mod(a[i] * b[i]) is ok, since Q is 23 bit,
    // which means a[i] * b[i] is 46 bit, which is safe to use in JS. (number is 53 bits).
    // Barrett reduction is slower than mod :(
    const c = newPoly(N);
    for (let i = 0; i < a.length; i++)
        c[i] = crystals.mod(a[i] * b[i]);
    return c;
};
// Return poly in NTT representation
function RejNTTPoly(xof_) {
    const xof = xof_;
    // Samples a polynomial ∈ Tq. xof() must return byte lengths divisible by 3.
    const r = newPoly(N);
    // NOTE: we can represent 3xu24 as 4xu32, but it doesn't improve perf :(
    for (let j = 0; j < N;) {
        const b = xof();
        if (b.length % 3)
            throw new Error('RejNTTPoly: unaligned block');
        for (let i = 0; j < N && i <= b.length - 3; i += 3) {
            // FIPS 204 Algorithm 14 clears the top bit of b2 before forming the 23-bit candidate.
            const t = (b[i + 0] | (b[i + 1] << 8) | (b[i + 2] << 16)) & 0x7fffff; // 3 bytes
            if (t < Q)
                r[j++] = t;
        }
    }
    return r;
}
// Instantiate one ML-DSA parameter set from the Table 1 lattice constants plus the
// Table 2 byte lengths / hash-width choices used by the public wrappers below.
function getDilithium(opts_) {
    const opts = opts_;
    const { K, L, GAMMA1, GAMMA2, TAU, ETA, OMEGA } = opts;
    const { CRH_BYTES, TR_BYTES, C_TILDE_BYTES, XOF128, XOF256, securityLevel } = opts;
    if (![2, 4].includes(ETA))
        throw new Error('Wrong ETA');
    if (![1 << 17, 1 << 19].includes(GAMMA1))
        throw new Error('Wrong GAMMA1');
    if (![GAMMA2_1, GAMMA2_2].includes(GAMMA2))
        throw new Error('Wrong GAMMA2');
    const BETA = TAU * ETA;
    const decompose = (r) => {
        // Decomposes r into (r1, r0) such that r ≡ r1(2γ2) + r0 mod q.
        const rPlus = crystals.mod(r);
        const r0 = crystals.smod(rPlus, 2 * GAMMA2) | 0;
        // FIPS 204 Algorithm 36 folds the top bucket `q-1` back to `(r1, r0) = (0, r0-1)`.
        if (rPlus - r0 === Q - 1)
            return { r1: 0 | 0, r0: (r0 - 1) | 0 };
        const r1 = Math.floor((rPlus - r0) / (2 * GAMMA2)) | 0;
        return { r1, r0 }; // r1 = HighBits, r0 = LowBits
    };
    const HighBits = (r) => decompose(r).r1;
    const LowBits = (r) => decompose(r).r0;
    const MakeHint = (z, r) => {
        // Compute hint bit indicating whether adding z to r alters the high bits of r.
        // FIPS 204 §6.2 also permits the Section 5.1 alternative from [6], which uses the
        // transformed low-bits/high-bits state at this call site instead of Algorithm 39 literally.
        // This optimized predicate only applies to those transformed Section 5.1 inputs; it is
        // not a drop-in replacement for Algorithm 39 on arbitrary `(z, r)` pairs.
        // From dilithium code
        const res0 = z <= GAMMA2 || z > Q - GAMMA2 || (z === Q - GAMMA2 && r === 0) ? 0 : 1;
        // from FIPS204:
        // // const r1 = HighBits(r);
        // // const v1 = HighBits(r + z);
        // // const res1 = +(r1 !== v1);
        // But they return different results! However, decompose is same.
        // So, either there is a bug in Dilithium ref implementation or in FIPS204.
        // For now, lets use dilithium one, so test vectors can be passed.
        // The round-3 Dilithium / ML-DSA code uses the same low-bits / high-bits convention after
        // `r0 += ct0`.
        // See dilithium-py README section "Optimising decomposition and making hints".
        return res0;
    };
    // m = (q-1)/(2γ2): 44 for ML-DSA-44, 16 for 65/87. Hoisted out of UseHint, which runs
    // per coefficient during verification.
    const HINT_M = Math.floor((Q - 1) / (2 * GAMMA2));
    const UseHint = (h, r) => {
        // Returns the high bits of r adjusted according to hint h
        const { r1, r0 } = decompose(r);
        // 3: if h = 1 and r0 > 0 return (r1 + 1) mod m
        // 4: if h = 1 and r0 ≤ 0 return (r1 − 1) mod m
        if (h === 1)
            return r0 > 0 ? crystals.mod(r1 + 1, HINT_M) | 0 : crystals.mod(r1 - 1, HINT_M) | 0;
        return r1 | 0;
    };
    const Power2Round = (r) => {
        // Decomposes r into (r1, r0) such that r ≡ r1*(2**d) + r0 mod q.
        const rPlus = crystals.mod(r);
        const r0 = crystals.smod(rPlus, 2 ** D) | 0;
        return { r1: Math.floor((rPlus - r0) / 2 ** D) | 0, r0 };
    };
    const hintCoder = {
        bytesLen: OMEGA + K,
        encode: (h_) => {
            const h = h_;
            if (h === false)
                throw new Error('hint.encode: hint is false'); // should never happen
            const res = new Uint8Array(OMEGA + K);
            for (let i = 0, k = 0; i < K; i++) {
                for (let j = 0; j < N; j++)
                    if (h[i][j] !== 0)
                        res[k++] = j;
                res[OMEGA + i] = k;
            }
            return res;
        },
        decode: (buf) => {
            const h = [];
            let k = 0;
            for (let i = 0; i < K; i++) {
                const hi = newPoly(N);
                if (buf[OMEGA + i] < k || buf[OMEGA + i] > OMEGA)
                    return false;
                for (let j = k; j < buf[OMEGA + i]; j++) {
                    if (j > k && buf[j] <= buf[j - 1])
                        return false;
                    hi[buf[j]] = 1;
                }
                k = buf[OMEGA + i];
                h.push(hi);
            }
            for (let j = k; j < OMEGA; j++)
                if (buf[j] !== 0)
                    return false;
            return h;
        },
    };
    const ETACoder = polyCoder(ETA === 2 ? 3 : 4, (i) => ETA - i, (i) => {
        if (!(-ETA <= i && i <= ETA))
            throw new Error(`malformed key s1/s3 ${i} outside of ETA range [${-ETA}, ${ETA}]`);
        return i;
    });
    const T0Coder = polyCoder(13, (i) => (1 << (D - 1)) - i);
    const T1Coder = polyCoder(10);
    // Requires smod. Need to fix!
    const ZCoder = polyCoder(GAMMA1 === 1 << 17 ? 18 : 20, (i) => crystals.smod(GAMMA1 - i));
    const W1Coder = polyCoder(GAMMA2 === GAMMA2_1 ? 6 : 4);
    const W1Vec = vecCoder(W1Coder, K);
    // Main structures
    const publicCoder = splitCoder('publicKey', 32, vecCoder(T1Coder, K));
    const secretCoder = splitCoder('secretKey', 32, 32, TR_BYTES, vecCoder(ETACoder, L), vecCoder(ETACoder, K), vecCoder(T0Coder, K));
    const sigCoder = splitCoder('signature', C_TILDE_BYTES, vecCoder(ZCoder, L), hintCoder);
    const CoefFromHalfByte = ETA === 2
        ? (n) => (n < 15 ? 2 - (n % 5) : false)
        : (n) => (n < 9 ? 4 - n : false);
    // Return poly in ordinary representation.
    // This helper returns ordinary-form `[-ETA, ETA]` coefficients for ExpandS; callers apply
    // `NTT.encode()` later when needed.
    function RejBoundedPoly(xof_) {
        const xof = xof_;
        // Samples an element a ∈ Rq with coeffcients in [−η, η] computed via rejection sampling from ρ.
        const r = newPoly(N);
        for (let j = 0; j < N;) {
            const b = xof();
            for (let i = 0; j < N && i < b.length; i += 1) {
                // half byte. Should be superfast with vector instructions. But very slow with js :(
                const d1 = CoefFromHalfByte(b[i] & 0x0f);
                const d2 = CoefFromHalfByte((b[i] >> 4) & 0x0f);
                if (d1 !== false)
                    r[j++] = d1;
                if (j < N && d2 !== false)
                    r[j++] = d2;
            }
        }
        return r;
    }
    const SampleInBall = (seed) => {
        // Samples a polynomial c ∈ Rq with coeffcients from {−1, 0, 1} and Hamming weight τ
        const pre = newPoly(N);
        const s = shake256.create({}).update(seed);
        const buf = new Uint8Array(shake256.blockLen);
        s.xofInto(buf);
        // FIPS 204 Algorithm 29 uses the first 8 squeezed bytes as the 64 sign bits `h`,
        // then rejection-samples coefficient positions from the remaining XOF stream.
        const masks = buf.slice(0, 8);
        for (let i = N - TAU, pos = 8, maskPos = 0, maskBit = 0; i < N; i++) {
            let b = i + 1;
            for (; b > i;) {
                b = buf[pos++];
                if (pos < shake256.blockLen)
                    continue;
                s.xofInto(buf);
                pos = 0;
            }
            pre[i] = pre[b];
            pre[b] = 1 - (((masks[maskPos] >> maskBit++) & 1) << 1);
            if (maskBit >= 8) {
                maskPos++;
                maskBit = 0;
            }
        }
        return pre;
    };
    const polyPowerRound = (p_) => {
        const p = p_;
        const res0 = newPoly(N);
        const res1 = newPoly(N);
        for (let i = 0; i < p.length; i++) {
            const { r0, r1 } = Power2Round(p[i]);
            res0[i] = r0;
            res1[i] = r1;
        }
        return { r0: res0, r1: res1 };
    };
    const polyUseHint = (u_, h_) => {
        const u = u_;
        const h = h_;
        // In-place on `u`: verification only needs the recovered high bits, so reuse the
        // temporary `wApprox` buffer instead of allocating another polynomial.
        for (let i = 0; i < N; i++)
            u[i] = UseHint(h[i], u[i]);
        return u;
    };
    const polyMakeHint = (a_, b_) => {
        const a = a_;
        const b = b_;
        const v = newPoly(N);
        let cnt = 0;
        for (let i = 0; i < N; i++) {
            const h = MakeHint(a[i], b[i]);
            v[i] = h;
            cnt += h;
        }
        return { v, cnt };
    };
    const signRandBytes = 32;
    const seedCoder = splitCoder('seed', 32, 64, 32);
    // API & argument positions are exactly as in FIPS204.
    const internal = Object.freeze({
        info: Object.freeze({ type: 'internal-ml-dsa' }),
        lengths: Object.freeze({
            secretKey: secretCoder.bytesLen,
            publicKey: publicCoder.bytesLen,
            seed: 32,
            signature: sigCoder.bytesLen,
            signRand: signRandBytes,
        }),
        keygen: (seed) => {
            // H(𝜉||IntegerToBytes(𝑘, 1)||IntegerToBytes(ℓ, 1), 128) 2: ▷ expand seed
            const seedDst = new Uint8Array(32 + 2);
            const randSeed = seed === undefined;
            if (randSeed)
                seed = randomBytes(32);
            abytesDoc(seed, 32, 'seed');
            seedDst.set(seed);
            if (randSeed)
                cleanBytes(seed);
            seedDst[32] = K;
            seedDst[33] = L;
            const [rho, rhoPrime, K_] = seedCoder.decode(shake256(seedDst, { dkLen: seedCoder.bytesLen }));
            const xofPrime = XOF256(rhoPrime);
            const s1 = [];
            for (let i = 0; i < L; i++)
                s1.push(RejBoundedPoly(xofPrime.get(i & 0xff, (i >> 8) & 0xff)));
            const s2 = [];
            for (let i = L; i < L + K; i++)
                s2.push(RejBoundedPoly(xofPrime.get(i & 0xff, (i >> 8) & 0xff)));
            const s1Hat = s1.map((i) => crystals.NTT.encode(i.slice()));
            const t0 = [];
            const t1 = [];
            const xof = XOF128(rho);
            const t = newPoly(N);
            for (let i = 0; i < K; i++) {
                // t ← NTT−1(A*NTT(s1)) + s2
                cleanBytes(t); // don't-reallocate
                for (let j = 0; j < L; j++) {
                    const aij = RejNTTPoly(xof.get(j, i)); // super slow!
                    polyAdd(t, MultiplyNTTs(aij, s1Hat[j]));
                }
                crystals.NTT.decode(t);
                const { r0, r1 } = polyPowerRound(polyAdd(t, s2[i])); // (t1, t0) ← Power2Round(t, d)
                t0.push(r0);
                t1.push(r1);
            }
            const publicKey = publicCoder.encode([rho, t1]); // pk ← pkEncode(ρ, t1)
            const tr = shake256(publicKey, { dkLen: TR_BYTES }); // tr ← H(BytesToBits(pk), 512)
            // sk ← skEncode(ρ, K,tr, s1, s2, t0)
            const secretKey = secretCoder.encode([rho, K_, tr, s1, s2, t0]);
            xof.clean();
            xofPrime.clean();
            // STATS
            // Kyber512: { calls: 4, xofs: 12 }, Kyber768: { calls: 9, xofs: 27 },
            // Kyber1024: { calls: 16, xofs: 48 }
            // DSA44: { calls: 24, xofs: 24 }, DSA65: { calls: 41, xofs: 41 },
            // DSA87: { calls: 71, xofs: 71 }
            cleanBytes(rho, rhoPrime, K_, s1, s2, s1Hat, t, t0, t1, tr, seedDst);
            return {
                publicKey: publicKey,
                secretKey: secretKey,
            };
        },
        getPublicKey: (secretKey) => {
            // (ρ, K,tr, s1, s2, t0) ← skDecode(sk)
            const [rho, _K, _tr, s1, s2, _t0] = secretCoder.decode(secretKey);
            const xof = XOF128(rho);
            const s1Hat = s1.map((p) => crystals.NTT.encode(p.slice()));
            const t1 = [];
            const tmp = newPoly(N);
            for (let i = 0; i < K; i++) {
                tmp.fill(0);
                for (let j = 0; j < L; j++) {
                    const aij = RejNTTPoly(xof.get(j, i)); // A_ij in NTT
                    polyAdd(tmp, MultiplyNTTs(aij, s1Hat[j])); // += A_ij * s1_j
                }
                crystals.NTT.decode(tmp); // NTT⁻¹
                polyAdd(tmp, s2[i]); // t_i = A·s1 + s2
                const { r1 } = polyPowerRound(tmp); // r1 = t1, r0 ≈ t0
                t1.push(r1);
            }
            xof.clean();
            cleanBytes(tmp, s1Hat, _t0, s1, s2);
            return publicCoder.encode([rho, t1]);
        },
        // NOTE: random is optional.
        sign: (msg, secretKey, opts = {}) => {
            opts = validateSigOpts(opts, INTERNAL_SIG_OPT_KEYS);
            opts = validateInternalOpts(opts, INTERNAL_SIG_OPT_KEYS);
            const { extraEntropy: random, externalMu = false } = opts;
            // FIPS 204 external-mu mode expects the 64-byte message representative µ = H(tr || M).
            if (externalMu)
                abytesDoc(msg, CRH_BYTES, 'mu');
            // Prepare entropy before touching decoded secrets: randomBytes() may throw, and an RNG
            // failure must not leave expanded secret-polynomial copies behind.
            const ownRnd = random === false || random === undefined;
            const rnd = random === false
                ? new Uint8Array(32)
                : random === undefined
                    ? randomBytes(signRandBytes)
                    : random;
            abytesDoc(rnd, 32, 'extraEntropy');
            // This part can be pre-cached per secretKey, but there is only minor performance improvement,
            // since we re-use a lot of variables to computation.
            // (ρ, K,tr, s1, s2, t0) ← skDecode(sk)
            const decoded = (() => {
                try {
                    return secretCoder.decode(secretKey);
                }
                catch (error) {
                    // A malformed key must not strand entropy owned by the library.
                    if (ownRnd)
                        cleanBytes(rnd);
                    throw error;
                }
            })();
            const [rho, _K, tr, s1, s2, t0] = decoded;
            // Cache matrix to avoid re-compute later
            const A = []; // A ← ExpandA(ρ)
            const xof = XOF128(rho);
            for (let i = 0; i < K; i++) {
                const pv = [];
                for (let j = 0; j < L; j++)
                    pv.push(RejNTTPoly(xof.get(j, i)));
                A.push(pv);
            }
            xof.clean();
            for (let i = 0; i < L; i++)
                crystals.NTT.encode(s1[i]); // sˆ1 ← NTT(s1)
            for (let i = 0; i < K; i++) {
                crystals.NTT.encode(s2[i]); // sˆ2 ← NTT(s2)
                crystals.NTT.encode(t0[i]); // tˆ0 ← NTT(t0)
            }
            // This part is per msg
            const mu = externalMu
                ? msg
                : // 6: µ ← H(tr||M, 512)
                    //    ▷ Compute message representative µ
                    shake256.create({ dkLen: CRH_BYTES }).update(tr).update(msg).digest();
            const rhoprime = shake256
                .create({ dkLen: CRH_BYTES })
                .update(_K)
                .update(rnd)
                .update(mu)
                .digest(); // ρ′← H(K||rnd||µ, 512)
            // Only wipe entropy we generated; caller-provided extraEntropy stays caller-owned.
            if (ownRnd)
                cleanBytes(rnd);
            abytesDoc(rhoprime, CRH_BYTES);
            const x256 = XOF256(rhoprime, ZCoder.bytesLen);
            //  Rejection sampling loop
            main_loop: for (let kappa = 0;;) {
                const y = [];
                // y ← ExpandMask(ρ , κ)
                for (let i = 0; i < L; i++, kappa++)
                    y.push(ZCoder.decode(x256.get(kappa & 0xff, kappa >> 8)()));
                const z = y.map((i) => crystals.NTT.encode(i.slice()));
                const w = [];
                for (let i = 0; i < K; i++) {
                    // w ← NTT−1(A ◦ NTT(y))
                    const wi = newPoly(N);
                    for (let j = 0; j < L; j++)
                        polyAdd(wi, MultiplyNTTs(A[i][j], z[j]));
                    crystals.NTT.decode(wi);
                    w.push(wi);
                }
                const w1 = w.map((j) => j.map(HighBits)); // w1 ← HighBits(w)
                // Commitment hash: c˜ ∈{0, 1 2λ } ← H(µ||w1Encode(w1), 2λ)
                const cTilde = shake256
                    .create({ dkLen: C_TILDE_BYTES })
                    .update(mu)
                    .update(W1Vec.encode(w1))
                    .digest();
                // Verifer’s challenge
                // c ← SampleInBall(c˜1); cˆ ← NTT(c)
                const cHat = crystals.NTT.encode(SampleInBall(cTilde));
                // ⟨⟨cs1⟩⟩ ← NTT−1(cˆ◦ sˆ1)
                const cs1 = s1.map((i) => MultiplyNTTs(i, cHat));
                for (let i = 0; i < L; i++) {
                    polyAdd(crystals.NTT.decode(cs1[i]), y[i]); // z ← y + ⟨⟨cs1⟩⟩
                    if (polyChknorm(cs1[i], GAMMA1 - BETA)) {
                        // Rejected. Wipe this iteration's secret-derived buffers before retrying; the
                        // accepted path wipes the same set, and only the persistent key material (s1, s2,
                        // t0, A, rhoprime) is kept for the next iteration and cleaned at the very end.
                        cleanBytes(cTilde, cs1, cHat, w1, w, z, y);
                        continue main_loop; // ||z||∞ ≥ γ1 − β
                    }
                }
                // cs1 is now z (▷ Signer’s response)
                let cnt = 0;
                const h = [];
                for (let i = 0; i < K; i++) {
                    const cs2 = crystals.NTT.decode(MultiplyNTTs(s2[i], cHat)); // ⟨⟨cs2⟩⟩ ← NTT−1(cˆ◦ sˆ2)
                    const r0 = polySub(w[i], cs2).map(LowBits); // r0 ← LowBits(w − ⟨⟨cs2⟩⟩)
                    if (polyChknorm(r0, GAMMA2 - BETA)) {
                        cleanBytes(cTilde, cs1, cHat, w1, w, z, y, h, cs2, r0);
                        continue main_loop; // ||r0||∞ ≥ γ2 − β
                    }
                    const ct0 = crystals.NTT.decode(MultiplyNTTs(t0[i], cHat)); // ⟨⟨ct0⟩⟩ ← NTT−1(cˆ◦ tˆ0)
                    if (polyChknorm(ct0, GAMMA2)) {
                        cleanBytes(cTilde, cs1, cHat, w1, w, z, y, h, cs2, r0, ct0);
                        continue main_loop;
                    }
                    polyAdd(r0, ct0);
                    // ▷ Signer’s hint
                    const hint = polyMakeHint(r0, w1[i]); // h ← MakeHint(−⟨⟨ct0⟩⟩, w− ⟨⟨cs2⟩⟩ + ⟨⟨ct0⟩⟩)
                    h.push(hint.v);
                    cnt += hint.cnt;
                }
                if (cnt > OMEGA) {
                    cleanBytes(cTilde, cs1, cHat, w1, w, z, y, h);
                    continue; // the number of 1’s in h is greater than ω
                }
                x256.clean();
                const res = sigCoder.encode([cTilde, cs1, h]); // σ ← sigEncode(c˜, z mod±q, h)
                // rho, _K, tr is subarray of secretKey, cannot clean.
                cleanBytes(cTilde, cs1, h, cHat, w1, w, z, y, rhoprime, s1, s2, t0, ...A);
                // `externalMu` hands ownership of `mu` to the caller,
                // so only wipe the internally derived digest form here;
                // zeroizing caller memory would break the caller's own reuse / verify path.
                if (!externalMu)
                    cleanBytes(mu);
                return res;
            }
            // @ts-ignore
            throw new Error('Unreachable code path reached, report this error');
        },
        verify: (sig, msg, publicKey, opts = {}) => {
            opts = validateInternalOpts(opts, INTERNAL_VER_OPT_KEYS);
            const { externalMu = false } = opts;
            // FIPS 204 external-mu mode expects the 64-byte message representative µ = H(tr || M).
            if (externalMu)
                abytesDoc(msg, CRH_BYTES, 'mu');
            // ML-DSA.Verify(pk, M, σ): Verifes a signature σ for a message M.
            const [rho, t1] = publicCoder.decode(publicKey); // (ρ, t1) ← pkDecode(pk)
            const tr = shake256(publicKey, { dkLen: TR_BYTES }); // 6: tr ← H(BytesToBits(pk), 512)
            if (sig.length !== sigCoder.bytesLen)
                return false; // return false instead of exception
            // (c˜, z, h) ← sigDecode(σ)
            // ▷ Signer’s commitment hash c ˜, response z and hint
            const [cTilde, z, h] = sigCoder.decode(sig);
            if (h === false)
                return false; // if h = ⊥ then return false
            for (let i = 0; i < L; i++)
                if (polyChknorm(z[i], GAMMA1 - BETA))
                    return false;
            const mu = externalMu
                ? msg
                : // 7: µ ← H(tr||M, 512)
                    shake256.create({ dkLen: CRH_BYTES }).update(tr).update(msg).digest();
            // Compute verifer’s challenge from c˜
            const c = crystals.NTT.encode(SampleInBall(cTilde)); // c ← SampleInBall(c˜1)
            const zNtt = z.map((i) => i.slice()); // zNtt = NTT(z)
            for (let i = 0; i < L; i++)
                crystals.NTT.encode(zNtt[i]);
            const wTick1 = [];
            const xof = XOF128(rho);
            for (let i = 0; i < K; i++) {
                const ct12d = MultiplyNTTs(crystals.NTT.encode(polyShiftl(t1[i])), c); //c * t1 * (2**d)
                const Az = newPoly(N); // // A * z
                for (let j = 0; j < L; j++) {
                    const aij = RejNTTPoly(xof.get(j, i)); // A[i][j] inplace
                    polyAdd(Az, MultiplyNTTs(aij, zNtt[j]));
                }
                // wApprox = A*z - c*t1 * (2**d)
                const wApprox = crystals.NTT.decode(polySub(Az, ct12d));
                // Reconstruction of signer’s commitment
                wTick1.push(polyUseHint(wApprox, h[i])); // w ′ ← UseHint(h, w'approx )
            }
            xof.clean();
            // c˜′← H (µ||w1Encode(w′1), 2λ),  Hash it; this should match c˜
            const c2 = shake256
                .create({ dkLen: C_TILDE_BYTES })
                .update(mu)
                .update(W1Vec.encode(wTick1))
                .digest();
            // Additional checks in FIPS-204:
            // [[ ||z||∞ < γ1 − β ]] and [[c ˜ = c˜′]] and [[number of 1’s in h is ≤ ω]]
            for (const t of h) {
                const sum = t.reduce((acc, i) => acc + i, 0);
                if (!(sum <= OMEGA))
                    return false;
            }
            for (const t of z)
                if (polyChknorm(t, GAMMA1 - BETA))
                    return false;
            return equalBytes(cTilde, c2);
        },
    });
    return Object.freeze({
        info: Object.freeze({ type: 'ml-dsa' }),
        internal,
        securityLevel: securityLevel,
        keygen: internal.keygen,
        lengths: internal.lengths,
        getPublicKey: internal.getPublicKey,
        sign: (msg, secretKey, opts = {}) => {
            opts = validateSigOpts(opts);
            const M = getMessage(msg, opts.context);
            // `context` is consumed by getMessage() above; forwarding it would make the internal
            // surface accept a key it never reads.
            const res = internal.sign(M, secretKey, {
                extraEntropy: opts.extraEntropy,
                externalMu: false,
            });
            cleanBytes(M);
            return res;
        },
        verify: (sig, msg, publicKey, opts = {}) => {
            opts = validateVerOpts(opts);
            abytesDoc(sig, undefined, 'signature');
            return internal.verify(sig, getMessage(msg, opts.context), publicKey, { externalMu: false });
        },
        prehash: (hash) => {
            checkHash(hash, securityLevel);
            const rawHash = hash;
            return Object.freeze({
                info: Object.freeze({ type: 'hashml-dsa' }),
                securityLevel: securityLevel,
                lengths: internal.lengths,
                keygen: internal.keygen,
                getPublicKey: internal.getPublicKey,
                sign: (msg, secretKey, opts = {}) => {
                    opts = validateSigOpts(opts);
                    const M = getMessagePrehash(rawHash, msg, opts.context);
                    // As above: getMessagePrehash() consumes `context`, so it must not travel further.
                    const res = internal.sign(M, secretKey, {
                        extraEntropy: opts.extraEntropy,
                        externalMu: false,
                    });
                    cleanBytes(M);
                    return res;
                },
                verify: (sig, msg, publicKey, opts = {}) => {
                    opts = validateVerOpts(opts);
                    abytesDoc(sig, undefined, 'signature');
                    return internal.verify(sig, getMessagePrehash(rawHash, msg, opts.context), publicKey, {
                        externalMu: false,
                    });
                },
            });
        },
    });
}
/** ML-DSA-65 for 192-bit security level. Not recommended after 2030, as per ASD. */
const ml_dsa65 = /* @__PURE__ */ (() => getDilithium({
    ...PARAMS[3],
    CRH_BYTES: 64,
    TR_BYTES: 64,
    C_TILDE_BYTES: 48,
    XOF128,
    XOF256,
    securityLevel: 192,
}))();

export { ml_dsa65, ml_kem768 };
