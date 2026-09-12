/*! OpenPGP.js v6.3.1 - 2026-09-11 - this is LGPL licensed code, see LICENSE/our website https://openpgpjs.org/ for more information. */
const globalThis = typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};
const hasOwnPonyfill =
  typeof Object.hasOwn === 'function'
    ? Object.hasOwn
    : (obj, key) => Object.prototype.hasOwnProperty.call(Object(obj), key);

import { s as sha256, a as sha384, b as sha512 } from './sha2.mjs';
import { a as ahash, b as abytes$1, c as clean, d as aexists, e as aoutput, f as concatBytes$1, g as createHasher, s as shake256 } from './sha3.mjs';
import { a as aobject, b as asafenumber, c as afunction, d as bitLen, e as aarray, f as abool, g as abytes, h as bytesToNumberLE, i as bytesToNumberBE, n as numberToBytesLE, j as numberToBytesBE, k as anumber, l as isBytes, v as validateObject, m as isPosBig, o as inRange, p as bitMask, q as abignumber, r as numberToHexUnpadded, s as astring, t as randomBytes, u as hexToBytes, w as bytesToHex, x as concatBytes, y as createHmacDrbg, z as aInRange, A as copyBytes, B as asciiToBytes } from './utils.mjs';

/**
 * Utils for modular division and fields.
 * Field over 11 is a finite (Galois) field is integer number operations `mod 11`.
 * There is no division: it is replaced by modular multiplicative inverse.
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
// Numbers aren't used in x25519 / x448 builds
// prettier-ignore
const _0n$6 = /* @__PURE__ */ BigInt(0), _1n$5 = /* @__PURE__ */ BigInt(1), _2n$5 = /* @__PURE__ */ BigInt(2);
// prettier-ignore
const _3n$2 = /* @__PURE__ */ BigInt(3), _4n$3 = /* @__PURE__ */ BigInt(4), _5n = /* @__PURE__ */ BigInt(5);
// prettier-ignore
const _7n = /* @__PURE__ */ BigInt(7), _8n$1 = /* @__PURE__ */ BigInt(8), _9n = /* @__PURE__ */ BigInt(9);
const _15n = /* @__PURE__ */ BigInt(15), _16n = /* @__PURE__ */ BigInt(16);
// 2^64: exponents below this use plain square-and-multiply in pow()/FpPow(); the windowed path's
// table build (14 multiplications) only pays off for longer exponents (break-even ~50 bits).
const POW_WINDOWED_MIN = /* @__PURE__ */ BigInt('0x10000000000000000');
/**
 * @param a - Dividend value.
 * @param b - Positive modulus.
 * @returns Reduced value in `[0, b)` only when `b` is positive.
 * @throws If the modulus is not positive. {@link Error}
 * @example
 * Normalize a bigint into one field residue.
 *
 * ```ts
 * mod(-1n, 5n);
 * ```
 */
function mod(a, b) {
    if (b <= _0n$6)
        throw new Error('mod: expected positive modulus, got ' + b);
    const result = a % b;
    return result >= _0n$6 ? result : b + result;
}
/**
 * Efficiently raise num to a power with modular reduction.
 * Unsafe in some contexts: uses ladder, so can expose bigint bits.
 * Low-level helper: callers that need canonical residues must pass a valid `num` for the chosen
 * modulus instead of relying on the `power===0/1` fast paths to normalize it.
 * @param num - Base value.
 * @param power - Exponent value.
 * @param modulo - Reduction modulus.
 * @returns Modular exponentiation result.
 * @throws If the modulus or exponent is invalid. {@link Error}
 * @example
 * Raise one bigint to a modular power.
 *
 * ```ts
 * pow(2n, 6n, 11n) // 64n % 11n == 9n
 * ```
 */
function pow(num, power, modulo) {
    if (modulo <= _1n$5)
        throw new Error('pow: expected modulus > 1, got ' + modulo);
    // Non-bigint exponents coerce every comparison below to false and would silently return 1.
    if (typeof power !== 'bigint')
        throw new TypeError('invalid exponent: expected bigint, got ' + typeof power);
    if (power < _0n$6)
        throw new Error('invalid exponent, negatives unsupported');
    if (power === _0n$6)
        return _1n$5;
    if (power === _1n$5)
        return num;
    let d = num % modulo;
    if (d < _0n$6)
        d += modulo;
    // Control flow in both branches below depends only on the exponent, never on `num` — invertCt()
    // relies on that for its (public-exponent) secret-independence guarantee.
    if (power < POW_WINDOWED_MIN) {
        // Square-and-multiply: cheaper than the windowed path for short exponents.
        let p = _1n$5;
        while (power > _0n$6) {
            if (power & _1n$5)
                p = (p * d) % modulo;
            d = (d * d) % modulo;
            power >>= _1n$5;
        }
        return p;
    }
    // Fixed 4-bit windows, MSB-first: a 14-multiplication table drops per-window cost to <1
    // multiplication (vs ~2 per window for square-and-multiply), ~25-30% faster for the dense
    // 256-bit exponents of sqrt / Legendre / invertCt.
    const digits = [];
    while (power > _0n$6) {
        digits.push(Number(power & _15n));
        power >>= _4n$3;
    }
    const table = new Array(16);
    table[0] = _1n$5;
    table[1] = d;
    for (let i = 2; i < 16; i++)
        table[i] = (table[i - 1] * d) % modulo;
    let p = table[digits[digits.length - 1]]; // top digit is nonzero: the loop above stops on 0
    for (let w = digits.length - 2; w >= 0; w--) {
        p = (p * p) % modulo;
        p = (p * p) % modulo;
        p = (p * p) % modulo;
        p = (p * p) % modulo;
        const digit = digits[w];
        if (digit !== 0)
            p = (p * table[digit]) % modulo;
    }
    return p;
}
/**
 * Does `x^(2^power)` mod p. `pow2(30, 4)` == `30^(2^4)`.
 * Low-level helper: callers that need canonical residues must pass a valid `x` for the chosen
 * modulus; the `power===0` fast path intentionally returns the input unchanged.
 * @param x - Base value.
 * @param power - Number of squarings.
 * @param modulo - Reduction modulus.
 * @returns Repeated-squaring result.
 * @throws If the exponent is negative. {@link Error}
 * @example
 * Apply repeated squaring inside one field.
 *
 * ```ts
 * pow2(3n, 2n, 11n);
 * ```
 */
function pow2(x, power, modulo) {
    if (modulo <= _1n$5)
        throw new Error('pow2: expected modulus > 1, got ' + modulo);
    if (power < _0n$6)
        throw new Error('pow2: expected non-negative exponent, got ' + power);
    let res = x;
    while (power-- > _0n$6) {
        res *= res;
        res %= modulo;
    }
    return res;
}
/**
 * Inverses number over modulo.
 * Implemented using the {@link https://brilliant.org/wiki/extended-euclidean-algorithm/ | extended Euclidean algorithm}.
 * @param number - Value to invert.
 * @param modulo - Modulus greater than 1.
 * @returns Multiplicative inverse.
 * @throws If the modulus is invalid or the inverse does not exist. {@link Error}
 * @example
 * Compute one modular inverse with the extended Euclidean algorithm.
 *
 * ```ts
 * invert(3n, 11n);
 * ```
 */
function invert(number, modulo) {
    if (number === _0n$6)
        throw new Error('invert: expected non-zero number');
    // modulo = 1 is the zero ring: gcd(x, 1) = 1 makes the loop below "succeed" and return the
    // useless inverse 0. Reject it like pow() and invertCt() do.
    if (modulo <= _1n$5)
        throw new Error('invert: expected modulus > 1, got ' + modulo);
    // This is variable-time: the loop count depends on `number`. For a secret-independent
    // (Fermat) alternative over a prime modulus, see {@link invertCt} (~4x slower).
    let a = mod(number, modulo);
    let b = modulo;
    // Only the Bézout coefficient of `number` (x/u chain) is tracked; the coefficient of `modulo`
    // never affects the output, so it is not computed.
    // prettier-ignore
    let x = _0n$6, u = _1n$5;
    while (a !== _0n$6) {
        const q = b / a;
        const r = b - a * q;
        const m = x - u * q;
        // prettier-ignore
        b = a, a = r, x = u, u = m;
    }
    const gcd = b;
    if (gcd !== _1n$5)
        throw new Error('invert: does not exist');
    return mod(x, modulo);
}
/**
 * Inverses number over modulo using Fermat's little theorem: `a^(p-2) ≡ a⁻¹ (mod p)`.
 *
 * Unlike {@link invert} (extended Euclidean), the exponent `p-2` is a public constant, so the
 * underlying square-and-multiply has the same control flow for every secret `a`: there is no
 * data-dependent branching or loop count that could leak `a` through timing (e.g. Minerva-style
 * ECDSA nonce-inversion attacks). This is only "algorithmically" constant-time — JS bigint
 * multiplication/reduction is still value-dependent — and it is roughly 4x slower than
 * {@link invert}.
 *
 * REQUIRES a prime modulus; Fermat's theorem does not hold otherwise. The result is verified to be
 * a real inverse, so a non-prime modulus (or a non-invertible input) fails closed with an error
 * instead of returning a wrong value.
 * @param a - Value to invert.
 * @param prime - Prime modulus.
 * @returns Multiplicative inverse in `[1, prime)`.
 * @throws If the modulus is below 2, the input reduces to zero, or the inverse does not exist.
 *   {@link Error}
 * @example
 * Compute one modular inverse without secret-dependent branching.
 *
 * ```ts
 * invertCt(3n, 11n); // 4n, since 3 * 4 = 12 ≡ 1 (mod 11)
 * ```
 */
function invertCt(a, prime) {
    if (prime <= _1n$5)
        throw new Error('invertCt: expected prime modulus > 1, got ' + prime);
    const an = mod(a, prime);
    if (an === _0n$6)
        throw new Error('invertCt: expected non-zero number');
    // Exponent (prime - 2) is public, so FpPow's square-and-multiply is secret-independent.
    const inverse = pow(an, prime - _2n$5, prime);
    // O(1) safety net: verifies the inverse and rejects composite moduli where a^(p-2) is not one.
    if (mod(an * inverse, prime) !== _1n$5)
        throw new Error('invertCt: does not exist');
    return inverse;
}
function assertIsSquare(Fp, root, n) {
    const F = Fp;
    if (!F.eql(F.sqr(root), n))
        throw new Error('Cannot find square root');
}
// The Legendre symbol and every sqrt variant here are only defined over an odd (prime) modulus.
// An even ORDER makes their integer divisions — (p-1)/2, (p+1)/4, (p-5)/8, (p+7)/16 — truncate and
// silently return a wrong result, so reject it explicitly at the entry points instead. This is a
// cheap necessary-condition check, not a primality test (composite odd moduli are caught later by
// the Legendre-result / assertIsSquare checks).
function aoddModulus(order, fnName) {
    if ((order & _1n$5) === _0n$6)
        throw new Error(fnName + ': expected odd modulus, got ' + order);
}
// Not all roots are possible! Example which will throw:
// const NUM =
// n = 72057594037927816n;
// Fp = Field(BigInt('0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab'));
function sqrt3mod4(Fp, n) {
    const F = Fp;
    const p1div4 = (F.ORDER + _1n$5) / _4n$3;
    const root = F.pow(n, p1div4);
    assertIsSquare(F, root, n);
    return root;
}
// Equivalent `q = 5 (mod 8)` square-root formula (Atkin-style), not the RFC Appendix I.2 CMOV
// pseudocode verbatim.
function sqrt5mod8(Fp, n) {
    const F = Fp;
    const p5div8 = (F.ORDER - _5n) / _8n$1;
    const n2 = F.mul(n, _2n$5);
    const v = F.pow(n2, p5div8);
    const nv = F.mul(n, v);
    const i = F.mul(F.mul(nv, _2n$5), v);
    const root = F.mul(nv, F.sub(i, F.ONE));
    assertIsSquare(F, root, n);
    return root;
}
// Based on RFC9380, Kong algorithm
// prettier-ignore
function sqrt9mod16(P) {
    const Fp_ = Field(P);
    const tn = tonelliShanks(P);
    const c1 = tn(Fp_, Fp_.neg(Fp_.ONE)); //  1. c1 = sqrt(-1) in F, i.e., (c1^2) == -1 in F
    const c2 = tn(Fp_, c1); //  2. c2 = sqrt(c1) in F, i.e., (c2^2) == c1 in F
    const c3 = tn(Fp_, Fp_.neg(c1)); //  3. c3 = sqrt(-c1) in F, i.e., (c3^2) == -c1 in F
    const c4 = (P + _7n) / _16n; //  4. c4 = (q + 7) / 16        # Integer arithmetic
    return ((Fp, n) => {
        const F = Fp;
        let tv1 = F.pow(n, c4); //  1. tv1 = x^c4
        let tv2 = F.mul(tv1, c1); //  2. tv2 = c1 * tv1
        const tv3 = F.mul(tv1, c2); //  3. tv3 = c2 * tv1
        const tv4 = F.mul(tv1, c3); //  4. tv4 = c3 * tv1
        const e1 = F.eql(F.sqr(tv2), n); //  5.  e1 = (tv2^2) == x
        const e2 = F.eql(F.sqr(tv3), n); //  6.  e2 = (tv3^2) == x
        tv1 = F.cmov(tv1, tv2, e1); //  7. tv1 = CMOV(tv1, tv2, e1)  # Select tv2 if (tv2^2) == x
        tv2 = F.cmov(tv4, tv3, e2); //  8. tv2 = CMOV(tv4, tv3, e2)  # Select tv3 if (tv3^2) == x
        const e3 = F.eql(F.sqr(tv2), n); //  9.  e3 = (tv2^2) == x
        const root = F.cmov(tv1, tv2, e3); // 10.  z = CMOV(tv1, tv2, e3)   # Select sqrt from tv1 & tv2
        assertIsSquare(F, root, n);
        return root;
    });
}
/**
 * Tonelli-Shanks square root search algorithm.
 * This implementation is variable-time: it searches data-dependently for the first non-residue `Z`
 * and for the smallest `i` in the main loop, unlike RFC 9380 Appendix I.4's constant-time shape.
 * 1. {@link https://eprint.iacr.org/2012/685.pdf | eprint 2012/685}, page 12
 * 2. Square Roots from 1; 24, 51, 10 to Dan Shanks
 * @param P - field order
 * @returns function that takes field Fp (created from P) and number n
 * @throws If the field is too small, non-prime, or the square root does not exist. {@link Error}
 * @example
 * Construct a square-root helper for primes that need Tonelli-Shanks.
 *
 * ```ts
 * import { Field, tonelliShanks } from '@noble/curves/abstract/modular.js';
 * const Fp = Field(17n);
 * const sqrt = tonelliShanks(17n)(Fp, 4n);
 * ```
 */
function tonelliShanks(P) {
    // Initialization (precomputation).
    // Caching initialization could boost perf by 7%.
    if (P < _3n$2)
        throw new Error('sqrt is not defined for small field');
    aoddModulus(P, 'tonelliShanks');
    // Factor P - 1 = Q * 2^S, where Q is odd
    let Q = P - _1n$5;
    let S = 0;
    while (Q % _2n$5 === _0n$6) {
        Q /= _2n$5;
        S++;
    }
    // Find the first quadratic non-residue Z >= 2
    let Z = _2n$5;
    const _Fp = Field(P);
    while (FpLegendre(_Fp, Z) === 1) {
        // Basic primality test for P. After x iterations, chance of
        // not finding quadratic non-residue is 2^x, so 2^1000.
        if (Z++ > 1000)
            throw new Error('Cannot find square root: probably non-prime P');
    }
    // Fast-path; usually done before Z, but we do "primality test".
    if (S === 1)
        return sqrt3mod4;
    // Slow-path
    // TODO: test on Fp2 and others
    let cc = _Fp.pow(Z, Q); // c = z^Q
    const Q1div2 = (Q + _1n$5) / _2n$5;
    return function tonelliSlow(Fp, n) {
        const F = Fp;
        if (F.is0(n))
            return n;
        // Check if n is a quadratic residue using Legendre symbol
        if (FpLegendre(F, n) !== 1)
            throw new Error('Cannot find square root');
        // Initialize variables for the main loop
        let M = S;
        let c = F.mul(F.ONE, cc); // c = z^Q, move cc from field _Fp into field Fp
        let t = F.pow(n, Q); // t = n^Q, first guess at the fudge factor
        let R = F.pow(n, Q1div2); // R = n^((Q+1)/2), first guess at the square root
        // Main loop
        // while t != 1
        while (!F.eql(t, F.ONE)) {
            // Unreachable over a genuine field (no zero divisors; n=0 already returned above). A zero t
            // means composite ORDER, where a fabricated root would be wrong: fail closed instead.
            if (F.is0(t))
                throw new Error('Cannot find square root: probably non-prime P');
            let i = 1;
            // Find the smallest i >= 1 such that t^(2^i) ≡ 1 (mod P)
            let t_tmp = F.sqr(t); // t^(2^1)
            while (!F.eql(t_tmp, F.ONE)) {
                i++;
                t_tmp = F.sqr(t_tmp); // t^(2^2)...
                if (i === M)
                    throw new Error('Cannot find square root');
            }
            // Calculate the exponent for b: 2^(M - i - 1)
            const exponent = _1n$5 << BigInt(M - i - 1); // bigint is important
            const b = F.pow(c, exponent); // b = 2^(M - i - 1)
            // Update variables
            M = i;
            c = F.sqr(b); // c = b^2
            t = F.mul(t, c); // t = (t * b^2)
            R = F.mul(R, b); // R = R*b
        }
        return R;
    };
}
/**
 * Square root for a finite field. Will try optimized versions first:
 *
 * 1. P ≡ 3 (mod 4)
 * 2. P ≡ 5 (mod 8)
 * 3. P ≡ 9 (mod 16)
 * 4. Tonelli-Shanks algorithm
 *
 * Different algorithms can give different roots, it is up to user to decide which one they want.
 * For example there is FpSqrtOdd/FpSqrtEven to choose a root by oddness
 * (used for hash-to-curve).
 * @param P - Field order.
 * @returns Square-root helper. The generic fallback inherits Tonelli-Shanks' variable-time
 *   behavior and this selector assumes prime-field-style integer moduli.
 * @throws If the field is unsupported or the square root does not exist. {@link Error}
 * @example
 * Choose the square-root helper appropriate for one field modulus.
 *
 * ```ts
 * import { Field, FpSqrt } from '@noble/curves/abstract/modular.js';
 * const Fp = Field(17n);
 * const sqrt = FpSqrt(17n)(Fp, 4n);
 * ```
 */
function FpSqrt(P) {
    aoddModulus(P, 'Fp.sqrt');
    // P ≡ 3 (mod 4) => √n = n^((P+1)/4)
    if (P % _4n$3 === _3n$2)
        return sqrt3mod4;
    // P ≡ 5 (mod 8) => Atkin algorithm, page 10 of https://eprint.iacr.org/2012/685.pdf
    if (P % _8n$1 === _5n)
        return sqrt5mod8;
    // P ≡ 9 (mod 16) => Kong algorithm, page 11 of https://eprint.iacr.org/2012/685.pdf (algorithm 4)
    if (P % _16n === _9n)
        return sqrt9mod16(P);
    // Tonelli-Shanks algorithm
    return tonelliShanks(P);
}
// prettier-ignore
// Arithmetic-only subset checked by validateField(). This is intentionally not the full runtime
// IField contract: helpers like `isValidNot0`, `invertBatch`, `toBytes`, `fromBytes`, `cmov`, and
// field-specific extras like `isOdd` are left to the callers that actually need them.
const FIELD_FIELDS = [
    'create', 'isValid', 'is0', 'neg', 'inv', 'sqrt', 'sqr',
    'eql', 'add', 'sub', 'mul', 'pow', 'div',
    'addN', 'subN', 'mulN', 'sqrN'
];
/**
 * @param field - Field implementation.
 * @returns Validated field. This only checks the arithmetic subset needed by generic helpers; it
 *   does not guarantee full runtime-method coverage for serialization, batching, `cmov`, or
 *   field-specific extras beyond positive `BYTES` / `BITS`.
 * @throws If the field shape or numeric metadata are invalid. {@link Error}
 * @example
 * Check that a field implementation exposes the operations curve code expects.
 *
 * ```ts
 * import { Field, validateField } from '@noble/curves/abstract/modular.js';
 * const Fp = validateField(Field(17n));
 * ```
 */
function validateField(field) {
    aobject(field, 'field');
    if (typeof field.ORDER !== 'bigint')
        throw new TypeError('param "ORDER" is invalid: expected bigint, got ' + typeof field.ORDER);
    // Runtime field implementations must expose real integer byte/bit sizes; fractional / NaN /
    // infinite metadata breaks encoders and caches.
    asafenumber(field.BYTES, 'BYTES');
    asafenumber(field.BITS, 'BITS');
    for (const name of FIELD_FIELDS)
        afunction(field[name], 'field.' + name);
    // Runtime field implementations must expose positive byte/bit sizes; zero leaks through the
    // numeric shape checks above but still breaks encoding helpers and cached-length assumptions.
    if (field.BYTES < 1 || field.BITS < 1)
        throw new Error('invalid field: expected BYTES/BITS > 0');
    if (field.ORDER <= _1n$5)
        throw new Error('invalid field: expected ORDER > 1, got ' + field.ORDER);
    return field;
}
function FpInvertBatch(Fp, nums, passZero = false) {
    validateField(Fp);
    aarray(nums, 'nums');
    abool(passZero, 'passZero');
    const F = Fp;
    const inverted = new Array(nums.length).fill(passZero ? F.ZERO : undefined);
    // Walk from first to last, multiply them by each other MOD p
    const multipliedAcc = nums.reduce((acc, num, i) => {
        if (F.is0(num))
            return acc;
        inverted[i] = acc;
        return F.mul(acc, num);
    }, F.ONE);
    // Invert last element
    const invertedAcc = F.inv(multipliedAcc);
    // Walk from last to first, multiply them by inverted each other MOD p
    nums.reduceRight((acc, num, i) => {
        if (F.is0(num))
            return acc;
        // Non-zero `num` means the forward pass already stored a defined prefix product at index i.
        inverted[i] = F.mul(acc, inverted[i]);
        return F.mul(acc, num);
    }, invertedAcc);
    return inverted;
}
/**
 * Legendre symbol.
 * Legendre constant is used to calculate Legendre symbol (a | p)
 * which denotes the value of a^((p-1)/2) (mod p).
 *
 * * (a | p) ≡ 1    if a is a square (mod p), quadratic residue
 * * (a | p) ≡ -1   if a is not a square (mod p), quadratic non residue
 * * (a | p) ≡ 0    if a ≡ 0 (mod p)
 * @param Fp - Field implementation.
 * @param n - Value to inspect.
 * @returns Legendre symbol.
 * @throws If the powered value does not match a valid Legendre symbol. {@link Error}
 * @example
 * Compute the Legendre symbol of one field element.
 *
 * ```ts
 * import { Field, FpLegendre } from '@noble/curves/abstract/modular.js';
 * const Fp = Field(17n);
 * const symbol = FpLegendre(Fp, 4n);
 * ```
 */
function FpLegendre(Fp, n) {
    validateField(Fp);
    const F = Fp;
    aoddModulus(F.ORDER, 'FpLegendre');
    // We can use 3rd argument as optional cache of this value
    // but seems unneeded for now. The operation is very fast.
    const p1mod2 = (F.ORDER - _1n$5) / _2n$5;
    const powered = F.pow(n, p1mod2);
    const yes = F.eql(powered, F.ONE);
    const zero = F.eql(powered, F.ZERO);
    const no = F.eql(powered, F.neg(F.ONE));
    if (!yes && !zero && !no)
        throw new Error('invalid Legendre symbol result');
    return yes ? 1 : zero ? 0 : -1;
}
/**
 * @param n - Curve order. Callers are expected to pass a positive order.
 * @param nBitLength - Optional cached bit length. Callers are expected to pass a positive cached
 *   value when overriding the derived bit length.
 * @returns Byte and bit lengths.
 * @throws If the order or cached bit length is invalid. {@link Error}
 * @example
 * Measure the encoding sizes needed for one modulus.
 *
 * ```ts
 * nLength(255n);
 * ```
 */
function nLength(n, nBitLength) {
    // Bit size, byte size of CURVE.n
    if (nBitLength !== undefined)
        anumber(nBitLength);
    if (n <= _0n$6)
        throw new Error('invalid n length: expected positive n, got ' + n);
    if (nBitLength !== undefined && nBitLength < 1)
        throw new Error('invalid n length: expected positive bit length, got ' + nBitLength);
    const bits = bitLen(n);
    // Cached bit lengths smaller than ORDER would truncate serialized scalars/elements and poison
    // any math that relies on the derived field metadata.
    if (nBitLength !== undefined && nBitLength < bits)
        throw new Error(`invalid n length: expected nBitLength (${nBitLength}) >= bitLen(n) (${bits})`);
    const _nBitLength = nBitLength !== undefined ? nBitLength : bits;
    const nByteLength = Math.ceil(_nBitLength / 8);
    return { nBitLength: _nBitLength, nByteLength };
}
// Keep the lazy sqrt cache off-instance so Field(...) can return a frozen object. Otherwise the
// cached helper write would keep the field surface externally mutable.
const FIELD_SQRT = new WeakMap();
class _Field {
    ORDER;
    BITS;
    BYTES;
    isLE;
    ZERO = _0n$6;
    ONE = _1n$5;
    _lengths;
    _mod;
    constructor(ORDER, opts = {}) {
        // ORDER <= 1 is degenerate: ONE would not be a valid field element and helpers like pow/inv
        // would stop modeling field arithmetic.
        if (ORDER <= _1n$5)
            throw new Error('invalid field: expected ORDER > 1, got ' + ORDER);
        let _nbitLength = undefined;
        this.isLE = false;
        if (opts != null && typeof opts === 'object') {
            // Cached bit lengths are trusted here and should already be positive / consistent with ORDER.
            if (typeof opts.BITS === 'number')
                _nbitLength = opts.BITS;
            if (typeof opts.sqrt === 'function')
                // `_Field.prototype` is frozen below, so custom sqrt hooks must become own properties
                // explicitly instead of relying on writable prototype shadowing via assignment.
                Object.defineProperty(this, 'sqrt', { value: opts.sqrt, enumerable: true });
            if (typeof opts.isLE === 'boolean')
                this.isLE = opts.isLE;
            if (opts.allowedLengths)
                this._lengths = Object.freeze(opts.allowedLengths.slice());
            if (typeof opts.modFromBytes === 'boolean')
                this._mod = opts.modFromBytes;
        }
        const { nBitLength, nByteLength } = nLength(ORDER, _nbitLength);
        if (nByteLength > 2048)
            throw new Error('invalid field: expected ORDER of <= 2048 bytes');
        this.ORDER = ORDER;
        this.BITS = nBitLength;
        this.BYTES = nByteLength;
        Object.freeze(this);
    }
    create(num) {
        return mod(num, this.ORDER);
    }
    isValid(num) {
        if (typeof num !== 'bigint')
            throw new TypeError('invalid field element: expected bigint, got ' + typeof num);
        return _0n$6 <= num && num < this.ORDER; // 0 is valid element, but it's not invertible
    }
    is0(num) {
        return num === _0n$6;
    }
    // is valid and invertible
    isValidNot0(num) {
        return !this.is0(num) && this.isValid(num);
    }
    isOdd(num) {
        return (num & _1n$5) === _1n$5;
    }
    neg(num) {
        return mod(-num, this.ORDER);
    }
    eql(lhs, rhs) {
        return lhs === rhs;
    }
    sqr(num) {
        return mod(num * num, this.ORDER);
    }
    add(lhs, rhs) {
        return mod(lhs + rhs, this.ORDER);
    }
    sub(lhs, rhs) {
        return mod(lhs - rhs, this.ORDER);
    }
    mul(lhs, rhs) {
        return mod(lhs * rhs, this.ORDER);
    }
    pow(num, power) {
        return pow(num, power, this.ORDER);
    }
    div(lhs, rhs) {
        return mod(lhs * invert(rhs, this.ORDER), this.ORDER);
    }
    // Same as above, but doesn't normalize
    sqrN(num) {
        return num * num;
    }
    addN(lhs, rhs) {
        return lhs + rhs;
    }
    subN(lhs, rhs) {
        return lhs - rhs;
    }
    mulN(lhs, rhs) {
        return lhs * rhs;
    }
    inv(num) {
        return invert(num, this.ORDER);
    }
    sqrt(num) {
        // Caching sqrt helpers speeds up sqrt9mod16 by 5x and Tonelli-Shanks by about 10% without keeping
        // the field instance itself mutable.
        let sqrt = FIELD_SQRT.get(this);
        if (!sqrt)
            FIELD_SQRT.set(this, (sqrt = FpSqrt(this.ORDER)));
        return sqrt(this, num);
    }
    toBytes(num) {
        // Serialize fixed-width limbs without re-validating the field range. Callers that need a
        // canonical encoding must pass a valid element; some protocols intentionally serialize raw
        // residues here and reduce or validate them elsewhere.
        return this.isLE ? numberToBytesLE(num, this.BYTES) : numberToBytesBE(num, this.BYTES);
    }
    fromBytes(bytes, skipValidation = false) {
        abytes(bytes);
        const { _lengths: allowedLengths, BYTES, isLE, ORDER, _mod: modFromBytes } = this;
        if (allowedLengths) {
            // `allowedLengths` must list real positive byte lengths; otherwise empty input would get
            // padded into zero and silently decode as a field element.
            if (bytes.length < 1 || !allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
                throw new Error('Field.fromBytes: expected ' + allowedLengths + ' bytes, got ' + bytes.length);
            }
            const padded = new Uint8Array(BYTES);
            // isLE add 0 to right, !isLE to the left.
            padded.set(bytes, isLE ? 0 : padded.length - bytes.length);
            bytes = padded;
        }
        if (bytes.length !== BYTES)
            throw new Error('Field.fromBytes: expected ' + BYTES + ' bytes, got ' + bytes.length);
        let scalar = isLE ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
        if (modFromBytes)
            scalar = mod(scalar, ORDER);
        if (!skipValidation)
            if (!this.isValid(scalar))
                throw new Error('invalid field element: outside of range 0..ORDER');
        // Range validation is optional here because some protocols intentionally decode raw residues
        // and reduce or validate them elsewhere.
        return scalar;
    }
    // TODO: we don't need it here, move out to separate fn
    invertBatch(lst) {
        // `passZero` keeps the `bigint[]` contract honest: zero inputs map to `0` instead of leaking
        // `undefined` into a `bigint[]`. Callers that must distinguish non-invertible inputs should use
        // `FpInvertBatch` directly, whose default omits `passZero` and returns `(bigint | undefined)[]`.
        return FpInvertBatch(this, lst, true);
    }
    // We can't move this out because Fp6, Fp12 implement it
    // and it's unclear what to return in there.
    cmov(a, b, condition) {
        // Field elements have `isValid(...)`; the CMOV branch bit is a direct runtime input, so reject
        // non-boolean selectors here instead of letting JS truthiness silently change arithmetic.
        abool(condition, 'condition');
        return condition ? b : a;
    }
}
/**
 * Creates a finite field. Major performance optimizations:
 * * 1. Denormalized operations like mulN instead of mul.
 * * 2. Identical object shape: never add or remove keys.
 * * 3. Frozen stable object shape; the lazy sqrt cache lives in a module-level `WeakMap`.
 * Fragile: always run a benchmark on a change.
 * Security note: operations and low-level serializers like `toBytes` don't check `isValid` for
 * all elements for performance and protocol-flexibility reasons; callers are responsible for
 * supplying valid elements when they need canonical field behavior.
 * This is low-level code, please make sure you know what you're doing.
 *
 * Note about field properties:
 * * CHARACTERISTIC p = prime number, number of elements in main subgroup.
 * * ORDER q = similar to cofactor in curves, may be composite `q = p^m`.
 *
 * @param ORDER - field order, probably prime, or could be composite
 * @param opts - Field options such as bit length or endianness. See {@link FieldOpts}.
 * @returns Frozen field instance with a stable object shape. This wrapper forwards `opts` straight
 *   into `_Field`, so it inherits `_Field`'s assumptions about cached sizes and `allowedLengths`.
 * @example
 * Construct one prime field with optional overrides.
 *
 * ```ts
 * Field(11n);
 * ```
 */
function Field(ORDER, opts = {}) {
    // Freeze the shared method surface before any instance is reachable; otherwise callers can
    // poison every Field instance by monkey-patching `_Field.prototype` even if each instance is
    // frozen. Freezing here instead of module scope keeps `_Field` tree-shakeable for importers
    // that never construct a field; the call is idempotent and cheap.
    Object.freeze(_Field.prototype);
    return new _Field(ORDER, opts);
}
/**
 * Returns total number of bytes consumed by the field element.
 * For example, 32 bytes for usual 256-bit weierstrass curve.
 * @param fieldOrder - number of field elements, usually CURVE.n. Callers are expected to pass an
 *   order greater than 1.
 * @returns byte length of field
 * @throws If the field order is not a bigint. {@link Error}
 * @example
 * Read the fixed-width byte length of one field.
 *
 * ```ts
 * getFieldBytesLength(255n);
 * ```
 */
function getFieldBytesLength(fieldOrder) {
    if (typeof fieldOrder !== 'bigint')
        throw new Error('field order must be bigint');
    // Valid field elements are in 0..ORDER-1, so ORDER <= 1 would make the encoded range degenerate.
    if (fieldOrder <= _1n$5)
        throw new Error('field order must be greater than 1');
    // Valid field elements are < ORDER, so the maximal encoded element is ORDER - 1.
    const bitLength = bitLen(fieldOrder - _1n$5);
    return Math.ceil(bitLength / 8);
}
/**
 * Returns minimal amount of bytes that can be safely reduced
 * by field order.
 * Should be 2^-128 for 128-bit curve such as P256.
 * This is the reduction / modulo-bias lower bound; higher-level helpers may still impose a larger
 * absolute floor for policy reasons.
 * @param fieldOrder - number of field elements greater than 1, usually CURVE.n.
 * @returns byte length of target hash
 * @throws If the field order is invalid. {@link Error}
 * @example
 * Compute the minimum hash length needed for field reduction.
 *
 * ```ts
 * getMinHashLength(255n);
 * ```
 */
function getMinHashLength(fieldOrder) {
    const length = getFieldBytesLength(fieldOrder);
    return length + Math.ceil(length / 2);
}
/**
 * "Constant-time" private key generation utility.
 * Can take (n + n/2) or more bytes of uniform input e.g. from CSPRNG or KDF
 * and convert them into private scalar, with the modulo bias being negligible.
 * Needs at least 48 bytes of input for 32-byte private key. The implementation also keeps a hard
 * 16-byte minimum even when `getMinHashLength(...)` is smaller, so toy-small inputs do not look
 * accidentally acceptable for real scalar derivation.
 * See {@link https://research.kudelskisecurity.com/2020/07/28/the-definitive-guide-to-modulo-bias-and-how-to-avoid-it/ | Kudelski's modulo-bias guide},
 * {@link https://csrc.nist.gov/publications/detail/fips/186/5/final | FIPS 186-5 appendix A.2}, and
 * {@link https://www.rfc-editor.org/rfc/rfc9380#section-5 | RFC 9380 section 5}. Unlike RFC 9380
 * `hash_to_field`, this helper intentionally maps into the non-zero private-scalar range `1..n-1`.
 * @param key - Uniform input bytes.
 * @param fieldOrder - Size of subgroup.
 * @param isLE - interpret hash bytes as LE num
 * @returns valid private scalar
 * @throws If the hash length or field order is invalid for scalar reduction. {@link Error}
 * @example
 * Map hash output into a private scalar range.
 *
 * ```ts
 * mapHashToField(new Uint8Array(48).fill(1), 255n);
 * ```
 */
function mapHashToField(key, fieldOrder, isLE = false) {
    abytes(key);
    const len = key.length;
    const fieldLen = getFieldBytesLength(fieldOrder);
    const minLen = Math.max(getMinHashLength(fieldOrder), 16);
    // No toy-small inputs: the helper is for real scalar derivation, not tiny test curves. No huge
    // inputs: easier to reason about JS timing / allocation behavior.
    if (len < minLen || len > 1024)
        throw new Error('expected ' + minLen + '-1024 bytes of input, got ' + len);
    const num = isLE ? bytesToNumberLE(key) : bytesToNumberBE(key);
    // Map into the non-zero scalar range [1, fieldOrder-1]: reduce mod (fieldOrder-1) to land in
    // [0, fieldOrder-2], then add 1. This shifts the range off zero; it is NOT equal to
    // `mod(num, fieldOrder)` (which spans [0, fieldOrder-1] and can be 0). A residual modulo bias
    // remains but is negligible (~2^-(nBits/2), e.g. ~2^-128 for a 256-bit order) because `key` is
    // required to be at least `getMinHashLength(fieldOrder)` (~1.5x field size) bytes of input.
    const reduced = mod(num, fieldOrder - _1n$5) + _1n$5;
    return isLE ? numberToBytesLE(reduced, fieldLen) : numberToBytesBE(reduced, fieldLen);
}

/**
 * Methods for elliptic curve multiplication by scalars.
 * Contains wNAF-based ScalarMultiplier, pippenger.
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const _0n$5 = /* @__PURE__ */ BigInt(0);
const _1n$4 = /* @__PURE__ */ BigInt(1);
const _4n$2 = /* @__PURE__ */ BigInt(4);
const BLIND_BYTES = 16;
const BLIND_BITS = 128;
// Fixed-window width for the constant-time multiply of un-precomputed points (W===1).
// A flat 2^FW_WINDOW table has a small, scalar-independent build cost that amortizes over a single
// multiply, unlike the larger per-point wNAF tables that only pay off when cached.
const FW_WINDOW = 5;
// Precompute tables are capped at ~2 GiB of estimated heap. Rejecting larger windows up front
// turns a typo'd window size into an immediate error instead of a multi-GB allocation (or an
// effective hang) when the lazy table is built on first multiply.
const TABLE_BYTES_MAX = /* @__PURE__ */ (() => 2 ** 31)();
/**
 * Validates the static surface of a point constructor.
 * This is only a cheap sanity check for the constructor hooks and fields consumed by generic
 * factories; it does not certify `BASE`/`ZERO` semantics or prove the curve implementation itself.
 * @param Point - Runtime point constructor.
 * @throws On missing constructor hooks or malformed field metadata. {@link TypeError}
 * @example
 * Check that one point constructor exposes the static hooks generic helpers need.
 *
 * ```ts
 * import { ed25519 } from '@noble/curves/ed25519.js';
 * import { validatePointCons } from '@noble/curves/abstract/curve.js';
 * validatePointCons(ed25519.Point);
 * ```
 */
function validatePointCons(Point) {
    const pc = Point;
    if (typeof pc !== 'function')
        throw new TypeError('"Point" expected constructor, got type=' + typeof Point);
    afunction(pc.fromAffine, 'Point.fromAffine');
    afunction(pc.fromBytes, 'Point.fromBytes');
    afunction(pc.fromHex, 'Point.fromHex');
    // Generic helpers (ScalarMultiplier, normalizeZ, MSM) dereference BASE / ZERO:
    // fail here with a typed error instead of an `undefined` access later.
    aobject(pc.BASE, 'Point.BASE');
    aobject(pc.ZERO, 'Point.ZERO');
    validateField(pc.Fp);
    validateField(pc.Fn);
}
/**
 * Takes a bunch of Projective Points but executes only one
 * inversion on all of them. Inversion is very slow operation,
 * so this improves performance massively.
 * Optimization: converts a list of projective points to a list of identical points with Z=1.
 * Input points are left unchanged; the normalized points are returned as fresh instances.
 * @param c - Point constructor.
 * @param points - Projective points.
 * @returns Fresh projective points reconstructed from normalized affine coordinates.
 * @example
 * Batch-normalize projective points with a single shared inversion.
 *
 * ```ts
 * import { normalizeZ } from '@noble/curves/abstract/curve.js';
 * import { p256 } from '@noble/curves/nist.js';
 * const points = normalizeZ(p256.Point, [p256.Point.BASE, p256.Point.BASE.double()]);
 * ```
 */
function normalizeZ(c, points) {
    // Match MSM helpers: reject malformed public inputs before reading projective internals.
    validatePointCons(c);
    validateMSMPoints(points, c);
    // Identity points (Z=0) rely on an implicit contract: FpInvertBatch without `passZero`
    // yields `undefined` for zero inputs, and `toAffine(undefined)` falls back to its internal
    // is0 handling instead of using the batch inverse.
    const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
    return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW(W, bits, min = 1) {
    if (!Number.isSafeInteger(W) || W < min || W > bits)
        throw new Error('invalid window size, expected [' + min + '..' + bits + '], got W=' + W);
}
// Rough per-point heap estimate for the {@link TABLE_BYTES_MAX} cap: up to 4 projective/extended
// coordinates of Fp.BYTES each, plus bigint/object overhead. Callers pass the point count of the
// largest table the checked parameters can produce.
function validateTableBytes(numPoints, fpBytes) {
    const bytes = numPoints * (4 * fpBytes + 128);
    if (bytes > TABLE_BYTES_MAX)
        throw new Error('invalid window size: table would need ~' +
            Math.ceil(bytes / 2 ** 20) +
            ' MiB, max ' +
            TABLE_BYTES_MAX / 2 ** 20 +
            ' MiB');
}
/**
 * Probes an RNG once, at construction time: returns `undefined` when it is unavailable —
 * throws or returns malformed bytes — so callers can downgrade to their unblinded /
 * deterministic constant-time fallback. Blinding is defense-in-depth (DPA/template
 * hardening), not a correctness or key-secrecy requirement, so availability-based
 * downgrade is acceptable.
 *
 * The downgrade decision is deliberately static. After a successful probe the RNG becomes
 * part of the trusted contract: later misbehavior must fail closed in per-call validation
 * (throw), never downgrade — a dynamic fallback would let a tampered RNG silently strip
 * blinding on demand. A probe can only ever classify broken environments, not adversarial
 * RNGs: a stateful RNG can always behave while probed and misbehave later.
 * @param randomBytes - RNG to probe, or `undefined` when the environment provides none.
 * @param length - Byte length requested from the probe call.
 * @returns The RNG when the probe produced `length` valid bytes; `undefined` otherwise.
 * @example
 * Probe an RNG once before enabling scalar blinding.
 *
 * ```ts
 * import { probeRandomBytes } from '@noble/curves/abstract/curve.js';
 * import { randomBytes } from '@noble/hashes/utils.js';
 * const rng = probeRandomBytes(randomBytes, 16);
 * ```
 */
function probeRandomBytes(randomBytes, length) {
    if (randomBytes === undefined)
        return undefined;
    afunction(randomBytes, 'randomBytes');
    try {
        const probe = randomBytes(length);
        if (!isBytes(probe) || probe.length !== length)
            return undefined;
    }
    catch {
        return undefined;
    }
    return randomBytes;
}
function validateMSMPoints(points, c) {
    aarray(points, 'points');
    points.forEach((p, i) => {
        if (!(p instanceof c))
            throw new Error('invalid point at index ' + i);
    });
}
// Default bound is field membership (0 <= s < field.ORDER); a `maxScalar` override widens it
// to 0 <= s < maxScalar for callers that accept oversized scalars.
function validateMSMScalars(scalars, field, maxScalar) {
    if (!Array.isArray(scalars))
        throw new Error('array of scalars expected');
    scalars.forEach((s, i) => {
        const ok = maxScalar === undefined ? field.isValid(s) : isPosBig(s) && s < maxScalar;
        if (!ok)
            throw new Error('invalid scalar at index ' + i);
    });
}
const pointWindowSizes = new WeakMap();
function getWindowSize(P) {
    // `1` is the uncached sentinel: use the non-precomputed (wNAF / fixed-window) path.
    return pointWindowSizes.get(P) || 1;
}
/** Table of odd multiples [1P, 3P, ..., (2⋅size−1)P]; width-W wNAF uses size = 2^(W−2). */
function oddMultiples(p, size) {
    const dbl = p.double();
    const t = [p];
    for (let j = 1; j < size; j++)
        t.push(t[j - 1].add(dbl));
    return t;
}
/**
 * Width-W wNAF signed-digit recoding (W >= 2), LSB-first: digits are 0 or odd with
 * |digit| < 2^(W−1); nonzero density ~1/(W+1) (a nonzero digit is followed by W−1 zeros).
 */
function wnafDigits(n, W) {
    const size = 2 ** W;
    const half = size / 2;
    const mask = BigInt(size - 1);
    const d = [];
    while (n > _0n$5) {
        let w = 0;
        if (n & _1n$4) {
            w = Number(n & mask); // n mod 2^W, odd
            if (w >= half)
                w -= size; // signed residue
            n -= BigInt(w); // n - w ≡ 0 mod 2^W: next W−1 digits are zero
        }
        d.push(w);
        n >>= _1n$4;
    }
    return d;
}
/**
 * Fixed-position signed-window recoding for precomputed wNAF: `n = Σ digits[w]⋅2^(w⋅W)` with
 * digits in `[−2^(W−1)+1, 2^(W−1)]`. Digit count is fixed by `windows` (callers reserve one
 * extra window for the final carry), so recoding length does not depend on the scalar.
 */
function signedWindowDigits(n, W, windows) {
    const size = 2 ** W;
    const half = size / 2;
    const mask = BigInt(size - 1);
    const shiftBy = BigInt(W);
    const d = [];
    for (let w = 0; w < windows; w++) {
        let v = Number(n & mask);
        n >>= shiftBy;
        if (v > half) {
            v -= size; // negative digit, carry into the next window
            n += _1n$4;
        }
        d.push(v);
    }
    // Internal invariant: leftover bits mean the window count did not cover the scalar.
    if (n !== _0n$5)
        throw new Error('invalid wnaf');
    return d;
}
/**
 * Shared vartime walk over per-scalar wNAF digit streams: one doubling of a single shared
 * accumulator per bit position of the longest recoding, one signed table addition per
 * nonzero digit. `tables[i]` must hold the odd multiples of the i-th point.
 */
function wnafWalk(zero, tables, digits) {
    let max = 0;
    for (const d of digits)
        max = Math.max(max, d.length);
    let acc = zero;
    for (let bit = max - 1; bit >= 0; bit--) {
        if (bit !== max - 1)
            acc = acc.double();
        for (let i = 0; i < digits.length; i++) {
            const w = digits[i][bit]; // reads past shorter recodings yield undefined, skipped below
            if (w) {
                const item = tables[i][(Math.abs(w) - 1) >> 1];
                acc = acc.add(w < 0 ? item.negate() : item);
            }
        }
    }
    return acc;
}
/**
 * Elliptic curve multiplication of Point by scalar.
 * Routes between cached-table, fixed-window, and one-shot wNAF paths; entry points validate
 * their own scalars (`mulCT`/`mulCTBlinded`: `1 <= s < Fn.ORDER`; `mulUnsafe`: up to the
 * `Fn.ORDER^4` DoS cap via {@link mulAddUnsafe}).
 * Table generation is expensive and happens on first call of `multiply()`
 * (or eagerly via `precompute(W, false)`). By default, `BASE` point is precomputed.
 *
 * Cached algorithm is signed fixed-window wNAF:
 * - table stores, for every window w, the multiples `[1..2^(W−1)]⋅2^(w⋅W)⋅P` — all doublings
 *   are baked in, so a multiplication is exactly one table addition per window
 * - window count is fixed (`ceil(bits/W) + 1`), so the point-operation count is scalar-independent
 *   (basis of the constant-time path)
 * - for a 256-bit curve and W=6: 44⋅32 = 1408 table points, 44 additions per multiply
 * - secret scalars are additionally blinded (see {@link ScalarMultiplier.mulCTBlinded}), which
 *   widens tables by 128 bits
 * @param Point - Point constructor.
 * @param randomBytes - RNG used for scalar blinding; required by the blinded secret path.
 * @example
 * Elliptic curve multiplication of Point by scalar.
 *
 * ```ts
 * import { ScalarMultiplier } from '@noble/curves/abstract/curve.js';
 * import { p256 } from '@noble/curves/nist.js';
 * const mul = new ScalarMultiplier(p256.Point);
 * ```
 */
class ScalarMultiplier {
    Point;
    BASE;
    ZERO;
    randomBytes;
    wnafPrecomputes = new WeakMap();
    baseCanBeBlinded;
    bits;
    // Parametrized with a given Point class (not individual point)
    constructor(Point, randomBytes) {
        validatePointCons(Point);
        // Probe the RNG once (see {@link probeRandomBytes}): in environments without working
        // randomness (e.g. no WebCrypto), shouldBlind() then routes secret multiplication to the
        // unblinded constant-time path instead of throwing on every multiply(). The shape of
        // returned bytes is still validated on every blinded call, where breakage fails closed.
        this.randomBytes = probeRandomBytes(randomBytes, BLIND_BYTES);
        this.Point = Point;
        this.BASE = Point.BASE;
        this.ZERO = Point.ZERO;
        this.bits = Point.Fn.BITS;
    }
    /**
     * Creates a signed fixed-window wNAF precomputation table: for every window w, the
     * multiples `[1..2^(W−1)]⋅2^(w⋅W)⋅P`, flattened. All doublings are baked into the table,
     * so cached multiplication is additions-only. `windows = ceil(bits/W) + 1`: the extra
     * window absorbs the final carry of signed-digit recoding.
     * For a 256-bit curve and W=6, the table is 44⋅32 = 1408 points.
     * @param point - Point instance
     * @param W - window size
     * @param bits - scalar bitlength the table must cover
     */
    buildWnafTable(point, W, bits) {
        // W needs no re-validation: its only source is setWindowSize(), which enforces
        // 1 <= W <= Fn.BITS <= bits (the blinded path only ever widens bits) and caps the
        // resulting table at ~2 GiB (sized against the wider blinded layout).
        const windows = Math.ceil(bits / W) + 1;
        const half = 2 ** (W - 1);
        const comp = [];
        let base = point;
        for (let w = 0; w < windows; w++) {
            let acc = base;
            for (let i = 0; i < half; i++) {
                comp.push(acc);
                acc = acc.add(base);
            }
            base = comp[comp.length - 1].double(); // 2⋅(2^(W−1)⋅base) = next window's base
        }
        return { W, bits, windows, comp };
    }
    /**
     * Implements ec multiplication using precomputed signed fixed-window wNAF tables.
     * Constant-time: fixed window count with one table addition per window — zero digits feed
     * the fake accumulator — and no doublings; the lookup scans the whole window slice.
     * Scalar bounds are validated by the public entry points ({@link ScalarMultiplier.mulCT},
     * {@link ScalarMultiplier.mulCTBlinded}, {@link ScalarMultiplier.mulUnsafe});
     * signedWindowDigits throws if `n` exceeds the table.
     * @returns real and fake (for const-time) points
     */
    wnafCachedCT(precomputes, n) {
        const { W, windows, comp } = precomputes;
        const half = 2 ** (W - 1);
        const digits = signedWindowDigits(n, W, windows);
        let p = this.ZERO;
        let f = this.BASE;
        for (let w = 0; w < windows; w++) {
            const digit = digits[w];
            const start = w * half;
            // Data-oblivious select: touch every entry of the window before the digit branch.
            const idx = Math.abs(digit) - 1; // -1 for zero digits: matches nothing, `sel` unused
            let sel = comp[start];
            for (let i = 1; i < half; i++)
                sel = i === idx ? comp[start + i] : sel;
            const neg = sel.negate(); // compute both signs; the digit only picks one
            if (digit === 0)
                f = f.add(comp[start]);
            else
                p = p.add(digit < 0 ? neg : sel);
        }
        return { p, f };
    }
    // Cache key is point identity plus (W, bits); at most two entries exist per point (public-width
    // `Fn.BITS` and blinded `Fn.BITS + BLIND_BITS`). Callers must not reuse the same point with
    // incompatible `transform(...)` layouts and expect a separate cache entry.
    getWnafPrecomputes(W, point, bits, transform) {
        let entries = this.wnafPrecomputes.get(point);
        let comp = entries?.find((entry) => entry.W === W && entry.bits === bits);
        if (!comp) {
            comp = this.buildWnafTable(point, W, bits);
            if (typeof transform === 'function')
                comp = { ...comp, comp: transform(comp.comp) };
            if (!entries) {
                entries = [];
                this.wnafPrecomputes.set(point, entries);
            }
            entries.push(comp);
        }
        return comp;
    }
    assertPoint(point) {
        if (!(point instanceof this.Point))
            throw new TypeError('"point" expected Point instance, got type=' + typeof point);
    }
    // Shared prologue of the constant-time entry points. Rejects scalar 0: in key/signature-style
    // callers a zero scalar means broken upstream plumbing, and concrete Points already reject it.
    // Uses inRange instead of Fn.isValidNot0: validateField() only certifies the arithmetic subset.
    validateMulInput(point, scalar) {
        this.assertPoint(point);
        if (!inRange(scalar, _1n$4, this.Point.Fn.ORDER))
            throw new Error('invalid scalar');
    }
    // Constant-time dispatch shared by mulCT / mulCTBlinded. Un-precomputed points (W===1, e.g.
    // ECDH peer keys) skip building a throwaway cached table in favor of a small fixed-window
    // multiply. `n` must be < 2^bits.
    runCT(point, n, bits, transform) {
        const W = getWindowSize(point);
        if (W === 1)
            return this.fixedWindowCT(point, n, bits);
        return this.wnafCachedCT(this.getWnafPrecomputes(W, point, bits, transform), n);
    }
    mulCT(point, scalar, transform) {
        this.validateMulInput(point, scalar);
        return this.runCT(point, scalar, this.bits, transform);
    }
    mulCTBlinded(point, scalar, transform) {
        this.validateMulInput(point, scalar);
        // Blinding computes n = scalar + blind*Fn.ORDER, then n*P via a constant-time multiply. This
        // equals scalar*P only when Fn.ORDER*P == O; callers guarantee that via shouldBlind() (always
        // for cofactor-1 curves; for cofactored curves only BASE, and only after checking BASE*n == O).
        // Fail before building the (large) precompute table if randomness is unavailable.
        if (this.randomBytes === undefined)
            throw new Error('randomBytes is required for scalar blinding');
        const bits = this.Point.Fn.BITS + BLIND_BITS;
        const blind = this.randomBytes(BLIND_BYTES);
        if (!isBytes(blind) || blind.length !== BLIND_BYTES)
            throw new Error('randomBytes returned invalid byte array');
        // Force the top two bits of the 128-bit blind to 10xxxxxx, so blind is in [2^127, 1.5*2^127):
        // * `| 0x80` (bit 127 = 1) is the load-bearing part: it guarantees blind >= 2^127, so the blind
        //   is always a full-width, nonzero factor and the scalar is masked even with a degenerate RNG.
        // * `& 0x3f` (bit 126 = 0) is a safety margin: it caps blind < 1.5*2^127, keeping
        //   blind*Fn.ORDER + scalar < 0.75*2^(nBits+128), i.e. ~half a window below the 2^(nBits+128)
        //   ceiling. Not strictly required for the bound (see below), but it reserves headroom so the
        //   guarantee does not rest on the tight `Fn.ORDER < 2^Fn.BITS` fact and the final carry window
        //   only ever holds a small carry, never a full digit.
        blind[0] = (blind[0] & 0x3f) | 0x80;
        // Even at the extreme (blind < 2^128, scalar < Fn.ORDER < 2^nBits): n <= 2^128*Fn.ORDER - 1 <
        // 2^(nBits+128), so n stays below 2^bits and within the blinded table's
        // window count. Both cached CT kernels run a fixed number of windows/rows with one point-add
        // each, so the add count is independent of scalar (constant-time).
        const n = scalar + bytesToNumberBE(blind) * this.Point.Fn.ORDER;
        return this.runCT(point, n, bits, transform);
    }
    /**
     * Constant-time multiplication `n*point` for an un-precomputed point, via a small fixed window.
     * A cached wNAF table only pays off when reused; a flat 2^FW_WINDOW table (`size-1` adds) is
     * far cheaper to build for a single use. The point-operation sequence is independent of `n`:
     * build the table, then per window exactly FW_WINDOW doublings, a data-oblivious scan over
     * every table entry, and one addition (adds the identity when the window digit is 0 — never
     * skipped).
     *
     * `n` must be `< 2^bits`. Assumes complete addition (adding the identity costs the same as any
     * add), which holds for the Weierstrass/Edwards point types used here. The table is left in
     * projective form (no normalizeZ): normalizing this small a table costs more than the
     * mixed-add savings it would buy for a single multiply.
     * @returns real point `p`; `f` duplicates it only to match {@link wnafCachedCT}'s return shape
     * (this path needs no fake accumulator — its op-count is already scalar-independent).
     */
    fixedWindowCT(point, n, bits) {
        const W = FW_WINDOW;
        const size = 1 << W;
        const mask = bitMask(W);
        // Flat table [O, point, 2*point, ..., (size-1)*point].
        const table = new Array(size);
        table[0] = this.ZERO;
        for (let i = 1; i < size; i++)
            table[i] = table[i - 1].add(point);
        // Horner MSB->LSB. windows*W >= bits and n < 2^bits, so every bit of n is consumed.
        const windows = Math.ceil(bits / W);
        let acc = this.ZERO;
        for (let window = windows - 1; window >= 0; window--) {
            // W doublings per window; skipped for the first (topmost) window, where acc is still the
            // identity. The skip is scalar-independent: it depends only on the loop index.
            if (window !== windows - 1)
                for (let d = 0; d < W; d++)
                    acc = acc.double();
            const digit = Number((n >> BigInt(window * W)) & mask);
            // Data-oblivious select: touch every entry, same as wnafCachedCT.
            let sel = table[0];
            for (let i = 1; i < size; i++)
                sel = i === digit ? table[i] : sel;
            acc = acc.add(sel); // one add per window, even for digit 0
        }
        return { p: acc, f: acc };
    }
    shouldBlind(point, cofactor) {
        // No usable RNG (probed in the constructor): blinding is impossible, use the plain CT path.
        if (this.randomBytes === undefined)
            return false;
        if (cofactor === _1n$4)
            return true;
        if (point !== this.BASE)
            return false;
        if (this.baseCanBeBlinded === undefined)
            this.baseCanBeBlinded = this.mulUnsafe(this.BASE, this.Point.Fn.ORDER).is0();
        return this.baseCanBeBlinded;
    }
    mulSecret(point, scalar, cofactor, transform) {
        return this.shouldBlind(point, cofactor)
            ? this.mulCTBlinded(point, scalar, transform)
            : this.mulCT(point, scalar, transform);
    }
    mulUnsafe(point, scalar, transform) {
        this.assertPoint(point);
        if (!isPosBig(scalar))
            throw new Error('invalid scalar');
        const W = getWindowSize(point);
        // W === 1 (un-precomputed): one-shot width-4 wNAF via {@link mulAddUnsafe} with L=1 —
        // a cached table would be thrown away after one use. `allowOversized` swaps the
        // `s < Fn.ORDER` check for mulAddUnsafe's `Fn.ORDER^4` DoS cap.
        //
        // Oversized scalar could happen when:
        // a) user passes large scalar on their own (rare)
        // b) `assertValidity()` calls `isTorsionFree()`, which multiplies point by `Fn.ORDER`
        if (W === 1 || scalar >= this.Point.Fn.ORDER)
            return mulAddUnsafe(this.Point, [point], [scalar], true);
        // Precomputed points reuse the CT kernel (fake accumulator discarded): with W=6 only
        // ~1/64 of window-adds are skippable, so a dedicated vartime kernel saved just ~6% on
        // this path while doubling the cached-table code surface.
        const precomputes = this.getWnafPrecomputes(W, point, this.bits, transform);
        return this.wnafCachedCT(precomputes, scalar).p;
    }
    // Remembers the window size used for precomputed wNAF multiplication of the given point
    // and drops any previously built tables. Usually only the base point is precomputed.
    // W=1 resets the point to the un-precomputed (table-less) paths.
    // W is additionally capped so tables stay under ~2 GiB ({@link TABLE_BYTES_MAX}).
    setWindowSize(point, W) {
        this.assertPoint(point);
        validateW(W, this.bits);
        // Size against the widest table this W can produce: the blinded path adds BLIND_BITS.
        const windows = Math.ceil((this.bits + BLIND_BITS) / W) + 1;
        validateTableBytes(windows * 2 ** (W - 1), this.Point.Fp.BYTES);
        pointWindowSizes.set(point, W);
        this.wnafPrecomputes.delete(point);
    }
    // True when a window size is set: tables themselves are built lazily on first multiply.
    hasWindowSize(point) {
        return getWindowSize(point) !== 1;
    }
}
/**
 * Combined multi-scalar multiplication `Σ scalars[i]⋅points[i]` via interleaved width-4 wNAF
 * (Strauss–Shamir). Every input gets its own table of odd multiples `[1P, 3P, 5P, 7P]` and
 * signed-digit recoding, but all walks share one doubling chain, so total cost is
 * `~bits` doublings + `L⋅bits/5` additions instead of `L⋅bits` doublings for separate
 * multiplications. Intended for the 2-4 point shapes of signature verification
 * (`R = u1⋅G + u2⋅P`); use {@link pippenger} for larger batches.
 *
 * Not constant-time: only for public inputs. Scalars must satisfy `0 <= s < Fn.ORDER`;
 * fold negative signs into the points before calling.
 * @param c - Point constructor.
 * @param points - Array of curve points.
 * @param scalars - Array of non-negative scalars, same length as points.
 * @param allowOversized - Replace the `s < Fn.ORDER` scalar check with a `Fn.ORDER^4` DoS cap.
 *   Off by default. For scalars that must NOT be reduced mod ORDER: torsion checks
 *   (`Fn.ORDER⋅P ≟ O`) and cofactor-clearing multiples. Walk length grows with `bitLen(s)`.
 * @returns Combined multiplication result; identity for empty input.
 * @throws If the point set or scalar set is invalid. {@link Error}
 * @example
 * Combined multi-scalar multiplication via Strauss–Shamir.
 *
 * ```ts
 * import { mulAddUnsafe } from '@noble/curves/abstract/curve.js';
 * import { p256 } from '@noble/curves/nist.js';
 * const G = p256.Point.BASE;
 * const R = mulAddUnsafe(p256.Point, [G, G.double()], [2n, 3n]); // 2⋅G + 3⋅(2⋅G)
 * ```
 */
function mulAddUnsafe(c, points, scalars, allowOversized = false) {
    validatePointCons(c);
    validateMSMPoints(points, c);
    abool(allowOversized, 'allowOversized');
    // Oversized cap is ORDER^4: hard bound to mitigate DoS, walk length grows with bitLen(s).
    validateMSMScalars(scalars, c.Fn, allowOversized ? c.Fn.ORDER ** _4n$2 : undefined);
    if (points.length !== scalars.length)
        throw new Error('arrays of points and scalars must have equal length');
    const tables = points.map((p) => oddMultiples(p, 4));
    const digits = scalars.map((n) => wnafDigits(n, 4));
    return wnafWalk(c.ZERO, tables, digits);
}
function createField(order, field, isLE) {
    if (field) {
        // Reuse supplied field overrides as-is; `isLE` only affects freshly constructed fallback
        // fields, and validateField() below only checks the arithmetic subset, not full byte/cmov
        // behavior.
        if (field.ORDER !== order)
            throw new Error('Field.ORDER must match order: Fp == p, Fn == n');
        validateField(field);
        return field;
    }
    else {
        return Field(order, { isLE });
    }
}
/**
 * Validates basic CURVE shape and field membership, then creates fields.
 * This does not prove that the generator is on-curve, that subgroup/order data are consistent, or
 * that the curve equation itself is otherwise sane.
 * @param type - Curve family.
 * @param CURVE - Curve parameters.
 * @param curveOpts - Optional field overrides. See {@link FpFn}:
 *   - `Fp` (optional): Optional base-field override.
 *   - `Fn` (optional): Optional scalar-field override.
 * @param FpFnLE - Whether field encoding is little-endian.
 * @returns Frozen curve parameters and fields.
 * @throws If the curve parameters or field overrides are invalid. {@link Error}
 * @example
 * Build curve fields from raw constants before constructing a curve instance.
 *
 * ```ts
 * const curve = createCurveFields('weierstrass', {
 *   p: 17n,
 *   n: 19n,
 *   h: 1n,
 *   a: 2n,
 *   b: 2n,
 *   Gx: 5n,
 *   Gy: 1n,
 * });
 * ```
 */
function createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
    if (type !== 'weierstrass' && type !== 'edwards')
        throw new Error('expected curve type "weierstrass" or "edwards"');
    if (FpFnLE === undefined)
        FpFnLE = type === 'edwards';
    if (!CURVE || typeof CURVE !== 'object')
        throw new Error(`expected valid ${type} CURVE object`);
    // Validate before reading Fp/Fn so explicit null fails with an options-object error.
    validateObject(curveOpts);
    for (const p of ['p', 'n', 'h']) {
        const val = CURVE[p];
        if (!(isPosBig(val) && val !== _0n$5))
            throw new Error(`CURVE.${p} must be positive bigint`);
    }
    const Fp = createField(CURVE.p, curveOpts.Fp, FpFnLE);
    const Fn = createField(CURVE.n, curveOpts.Fn, FpFnLE);
    const _b = type === 'weierstrass' ? 'b' : 'd';
    const params = ['Gx', 'Gy', 'a', _b];
    for (const p of params) {
        // @ts-ignore
        if (!Fp.isValid(CURVE[p]))
            throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
    }
    CURVE = Object.freeze(Object.assign({}, CURVE));
    return { CURVE, Fp, Fn };
}
/**
 * @param randomSecretKey - Secret-key generator.
 * @param getPublicKey - Public-key derivation helper.
 * @returns Keypair generator.
 * @example
 * Build a `keygen()` helper from existing secret-key and public-key primitives.
 *
 * ```ts
 * import { createKeygen } from '@noble/curves/abstract/curve.js';
 * import { p256 } from '@noble/curves/nist.js';
 * const keygen = createKeygen(p256.utils.randomSecretKey, p256.getPublicKey);
 * const pair = keygen();
 * ```
 */
function createKeygen(randomSecretKey, getPublicKey) {
    return function keygen(seed) {
        const secretKey = randomSecretKey(seed);
        return { secretKey, publicKey: getPublicKey(secretKey) };
    };
}

/**
 * HMAC: RFC2104 message authentication code.
 * @module
 */
/**
 * Internal class for HMAC.
 * Accepts any byte key, although RFC 2104 §3 recommends keys at least
 * `HashLen` bytes long.
 */
class _HMAC {
    oHash;
    iHash;
    blockLen;
    outputLen;
    canXOF = false;
    finished = false;
    destroyed = false;
    constructor(hash, key) {
        ahash(hash);
        abytes$1(key, undefined, 'key');
        this.iHash = hash.create();
        if (typeof this.iHash.update !== 'function')
            throw new Error('expected Hash instance');
        this.blockLen = this.iHash.blockLen;
        this.outputLen = this.iHash.outputLen;
        const blockLen = this.blockLen;
        const pad = new Uint8Array(blockLen);
        // blockLen can be bigger than outputLen
        pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
        for (let i = 0; i < pad.length; i++)
            pad[i] ^= 0x36;
        this.iHash.update(pad);
        // By doing update (processing of the first block) of the outer hash here,
        // we can re-use it between multiple calls via clone.
        this.oHash = hash.create();
        // Undo internal XOR && apply outer XOR
        for (let i = 0; i < pad.length; i++)
            pad[i] ^= 0x36 ^ 0x5c;
        this.oHash.update(pad);
        clean(pad);
    }
    update(buf) {
        aexists(this);
        this.iHash.update(buf);
        return this;
    }
    digestInto(out) {
        aexists(this);
        aoutput(out, this);
        this.finished = true;
        const buf = out.subarray(0, this.outputLen);
        // Reuse the first outputLen bytes for the inner digest; the outer hash consumes them before
        // overwriting that same prefix with the final tag, leaving any oversized tail untouched.
        this.iHash.digestInto(buf);
        this.oHash.update(buf);
        this.oHash.digestInto(buf);
        this.destroy();
    }
    digest() {
        const out = new Uint8Array(this.oHash.outputLen);
        this.digestInto(out);
        return out;
    }
    _cloneInto(to) {
        // Create new instance without calling constructor since the key
        // is already in state and we don't know it.
        to ||= Object.create(Object.getPrototypeOf(this), {});
        const { oHash, iHash, finished, destroyed, blockLen, outputLen, canXOF } = this;
        to = to;
        to.finished = finished;
        to.destroyed = destroyed;
        to.blockLen = blockLen;
        to.outputLen = outputLen;
        to.canXOF = canXOF;
        to.oHash = oHash._cloneInto(to.oHash);
        to.iHash = iHash._cloneInto(to.iHash);
        return to;
    }
    clone() {
        return this._cloneInto();
    }
    destroy() {
        this.destroyed = true;
        this.oHash.destroy();
        this.iHash.destroy();
    }
}
const hmac = /* @__PURE__ */ (() => {
    const hmac_ = ((hash, key, message) => new _HMAC(hash, key).update(message).digest());
    hmac_.create = (hash, key) => new _HMAC(hash, key);
    return hmac_;
})();

/**
 * ASN.1 DER (Distinguished Encoding Rules) helpers for ECDSA signatures.
 * Only implements the tiny subset needed for `SEQUENCE(INTEGER r, INTEGER s)`.
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const _0n$4 = /* @__PURE__ */ BigInt(0);
/**
 * @param m - Error message.
 * @example
 * Throw a DER-specific error when signature parsing encounters invalid bytes.
 *
 * ```ts
 * new DERErr('bad der');
 * ```
 */
class DERErr extends Error {
    constructor(m = '') {
        super(m);
    }
}
// Plain const so the freezes can live inside the pure initializer of the `DER` export below:
// bare top-level `Object.freeze(...)` calls would defeat tree-shaking for every importer.
const _DER = {
    // asn.1 DER encoding utils
    Err: DERErr,
    // Basic building block is TLV (Tag-Length-Value)
    _tlv: {
        encode: (tag, data) => {
            const { Err: E } = _DER;
            asafenumber(tag, 'tag');
            if (tag < 0 || tag > 255)
                throw new E('tlv.encode: wrong tag');
            astring(data, 'data');
            // Internal helper: callers hand this already-validated hex payload, so we only enforce
            // byte alignment here instead of re-validating every nibble.
            if (data.length & 1)
                throw new E('tlv.encode: unpadded data');
            const dataLen = data.length / 2;
            const len = numberToHexUnpadded(dataLen);
            if ((len.length / 2) & 0b1000_0000)
                throw new E('tlv.encode: long form length too big');
            // length of length with long form flag
            const lenLen = dataLen > 127 ? numberToHexUnpadded((len.length / 2) | 0b1000_0000) : '';
            const t = numberToHexUnpadded(tag);
            return t + lenLen + len + data;
        },
        // v - value, l - left bytes (unparsed)
        decode(tag, data) {
            const { Err: E } = _DER;
            data = abytes(data, undefined, 'DER data');
            let pos = 0;
            if (tag < 0 || tag > 255)
                throw new E('tlv.decode: wrong tag');
            if (data.length < 2 || data[pos++] !== tag)
                throw new E('tlv.decode: wrong tlv');
            const first = data[pos++];
            // First bit of first length byte is the short/long form flag.
            const isLong = !!(first & 0b1000_0000);
            let length = 0;
            if (!isLong)
                length = first;
            else {
                // Long form: [longFlag(1bit), lengthLength(7bit), length (BE)]
                const lenLen = first & 0b0111_1111;
                if (!lenLen)
                    throw new E('tlv.decode(long): indefinite length not supported');
                // This would overflow u32 in JS.
                if (lenLen > 4)
                    throw new E('tlv.decode(long): byte length is too big');
                const lengthBytes = data.subarray(pos, pos + lenLen);
                if (lengthBytes.length !== lenLen)
                    throw new E('tlv.decode: length bytes not complete');
                if (lengthBytes[0] === 0)
                    throw new E('tlv.decode(long): zero leftmost byte');
                for (const b of lengthBytes)
                    length = (length << 8) | b;
                pos += lenLen;
                if (length < 128)
                    throw new E('tlv.decode(long): not minimal encoding');
            }
            const v = data.subarray(pos, pos + length);
            if (v.length !== length)
                throw new E('tlv.decode: wrong value length');
            return { v, l: data.subarray(pos + length) };
        },
    },
    // https://crypto.stackexchange.com/a/57734 Leftmost bit of first byte is 'negative' flag,
    // since we always use positive integers here. It must always be empty:
    // - add zero byte if exists
    // - if next byte doesn't have a flag, leading zero is not allowed (minimal encoding)
    _int: {
        encode(num) {
            const { Err: E } = _DER;
            abignumber(num);
            if (num < _0n$4)
                throw new E('integer: negative integers are not allowed');
            let hex = numberToHexUnpadded(num);
            // Pad with zero byte if negative flag is present
            if (Number.parseInt(hex[0], 16) & 0b1000)
                hex = '00' + hex;
            if (hex.length & 1)
                throw new E('unexpected DER parsing assertion: unpadded hex');
            return hex;
        },
        decode(data) {
            const { Err: E } = _DER;
            if (data.length < 1)
                throw new E('invalid signature integer: empty');
            if (data[0] & 0b1000_0000)
                throw new E('invalid signature integer: negative');
            // Single-byte zero `00` is the canonical DER INTEGER encoding for zero.
            if (data.length > 1 && data[0] === 0x00 && !(data[1] & 0b1000_0000))
                throw new E('invalid signature integer: unnecessary leading zero');
            return bytesToNumberBE(data);
        },
    },
    toSig(bytes, maxScalarBytes) {
        // parse DER signature
        const { Err: E, _int: int, _tlv: tlv } = _DER;
        if (maxScalarBytes !== undefined) {
            asafenumber(maxScalarBytes, 'maxScalarBytes');
            if (maxScalarBytes < 1)
                throw new E('invalid signature: maxScalarBytes must be positive');
        }
        const data = abytes(bytes, undefined, 'signature');
        const { v: seqBytes, l: seqLeftBytes } = tlv.decode(0x30, data);
        if (seqLeftBytes.length)
            throw new E('invalid signature: left bytes after parsing');
        const { v: rBytes, l: rLeftBytes } = tlv.decode(0x02, seqBytes);
        const { v: sBytes, l: sLeftBytes } = tlv.decode(0x02, rLeftBytes);
        if (sLeftBytes.length)
            throw new E('invalid signature: left bytes after parsing');
        // Enforce curve-provided bounds before bytes-to-hex-to-BigInt conversion can amplify memory.
        if (maxScalarBytes !== undefined &&
            (rBytes.length > maxScalarBytes || sBytes.length > maxScalarBytes))
            throw new E('invalid signature: integer too large');
        return { r: int.decode(rBytes), s: int.decode(sBytes) };
    },
    hexFromSig(sig) {
        const { _tlv: tlv, _int: int } = _DER;
        validateObject(sig, { r: 'bigint', s: 'bigint' }, {}, 'sig');
        const rs = tlv.encode(0x02, int.encode(sig.r));
        const ss = tlv.encode(0x02, int.encode(sig.s));
        const seq = rs + ss;
        return tlv.encode(0x30, seq);
    },
};
/**
 * ASN.1 DER encoding utilities. ASN is very complex & fragile. Format:
 *
 *     [0x30 (SEQUENCE), bytelength, 0x02 (INTEGER), intLength, R, 0x02 (INTEGER), intLength, S]
 *
 * Docs: {@link https://letsencrypt.org/docs/a-warm-welcome-to-asn1-and-der/ | Let's Encrypt ASN.1 guide} and
 * {@link https://luca.ntop.org/Teaching/Appunti/asn1.html | Luca Deri's ASN.1 notes}.
 * @example
 * ASN.1 DER encoding utilities.
 *
 * ```ts
 * const der = DER.hexFromSig({ r: 1n, s: 2n });
 * ```
 */
const DER = /* @__PURE__ */ (() => {
    Object.freeze(_DER._tlv);
    Object.freeze(_DER._int);
    return Object.freeze(_DER);
})();

/**
 * Short Weierstrass curve methods. The formula is: y² = x³ + ax + b.
 *
 * ### Design rationale for types
 *
 * * Interaction between classes from different curves should fail:
 *   `k256.Point.BASE.add(p256.Point.BASE)`
 * * For this purpose we want to use `instanceof` operator, which is fast and works during runtime
 * * Different calls of `curve()` would return different classes -
 *   `curve(params) !== curve(params)`: if somebody decided to monkey-patch their curve,
 *   it won't affect others
 *
 * TypeScript can't infer types for classes created inside a function. Classes is one instance
 * of nominative types in TypeScript and interfaces only check for shape, so it's hard to create
 * unique type for every function call.
 *
 * We can use generic types via some param, like curve opts, but that would:
 *     1. Enable interaction between `curve(params)` and `curve(params)` (curves of same params)
 *     which is hard to debug.
 *     2. Params can be generic and we can't enforce them to be constant value:
 *     if somebody creates curve from non-constant params,
 *     it would be allowed to interact with other curves with non-constant params
 *
 * @todo https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-7.html#unique-symbol
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
// We construct the basis so `den` is always positive and equals `n`,
// but the `num` sign depends on the basis, not on the secret value.
// Exact half-way cases round away from zero, which keeps the split symmetric
// around the reduced-basis boundaries used by endomorphism decomposition.
const divNearest = (num, den) => (num + (num >= 0 ? den : -den) / _2n$4) / den;
/** Splits scalar for GLV endomorphism. */
function _splitEndoScalar(k, basis, n) {
    // Split scalar into two such that part is ~half bits: `abs(part) < sqrt(N)`
    // Since part can be negative, we need to do this on point.
    // Callers must provide a reduced GLV basis whose vectors satisfy
    // `a + b * lambda ≡ 0 (mod n)`; this helper only sees the basis and `n`.
    // Reject unreduced scalars instead of silently treating them mod n.
    aInRange('scalar', k, _0n$3, n);
    // TODO: verifyScalar function which consumes lambda
    const [[a1, b1], [a2, b2]] = basis;
    const c1 = divNearest(b2 * k, n);
    const c2 = divNearest(-b1 * k, n);
    // |k1|/|k2| is < sqrt(N), but can be negative.
    // If we do `k1 mod N`, we'll get big scalar (`> sqrt(N)`): so, we do cheaper negation instead.
    let k1 = k - c1 * a1 - c2 * a2;
    let k2 = -c1 * b1 - c2 * b2;
    const k1neg = k1 < _0n$3;
    const k2neg = k2 < _0n$3;
    if (k1neg)
        k1 = -k1;
    if (k2neg)
        k2 = -k2;
    // Double check that resulting scalar is less than half bits of N: the wNAF pair walk
    // relies on the halves being short. This should only happen on wrong bases.
    // Also, the math inside is complex enough that this guard is worth keeping.
    const MAX_NUM = bitMask(Math.ceil(bitLen(n) / 2)) + _1n$3; // Half bits of N
    if (k1 < _0n$3 || k1 >= MAX_NUM || k2 < _0n$3 || k2 >= MAX_NUM) {
        throw new Error('splitScalar (endomorphism): failed for k');
    }
    return { k1neg, k1, k2neg, k2 };
}
function validateSigFormat(format) {
    if (!['compact', 'recovered', 'der'].includes(format))
        throw new Error('Signature format must be "compact", "recovered", or "der"');
    return format;
}
function validateSigOpts(opts, def) {
    validateObject(opts);
    const optsn = {};
    // Normalize only the declared option subset from `def`; unknown keys are
    // intentionally ignored so shared / superset option bags stay valid here too.
    // `extraEntropy` stays an opaque payload until the signing path consumes it.
    for (let optName of Object.keys(def)) {
        // @ts-ignore
        optsn[optName] = opts[optName] === undefined ? def[optName] : opts[optName];
    }
    abool(optsn.lowS, 'lowS');
    abool(optsn.prehash, 'prehash');
    if (optsn.format !== undefined)
        validateSigFormat(optsn.format);
    return optsn;
}
// Be friendly to bad ECMAScript parsers by not using bigint literals
// prettier-ignore
const _0n$3 = /* @__PURE__ */ BigInt(0), _1n$3 = /* @__PURE__ */ BigInt(1), _2n$4 = /* @__PURE__ */ BigInt(2), _3n$1 = /* @__PURE__ */ BigInt(3), _4n$1 = /* @__PURE__ */ BigInt(4);
/**
 * Creates weierstrass Point constructor, based on specified curve options.
 *
 * See {@link WeierstrassOpts}.
 * @param params - Curve parameters. See {@link WeierstrassOpts}.
 * @param extraOpts - Optional helpers and overrides. See {@link WeierstrassExtraOpts}.
 * @returns Weierstrass point constructor.
 * @throws If the curve parameters, overrides, or point codecs are invalid. {@link Error}
 *
 * @example
 * Construct a point type from explicit Weierstrass curve parameters.
 *
 * ```js
 * const opts = {
 *   p: 0xfffffffffffffffffffffffffffffffeffffac73n,
 *   n: 0x100000000000000000001b8fa16dfab9aca16b6b3n,
 *   h: 1n,
 *   a: 0n,
 *   b: 7n,
 *   Gx: 0x3b4c382ce37aa192a4019e763036f4f5dd4d7ebbn,
 *   Gy: 0x938cf935318fdced6bc28286531733c3f03c4feen,
 * };
 * const secp160k1_Point = weierstrass(opts);
 * ```
 */
function weierstrass(params, extraOpts = {}) {
    const validated = createCurveFields('weierstrass', params, extraOpts);
    const Fp = validated.Fp;
    const Fn = validated.Fn;
    let CURVE = validated.CURVE;
    const { h: cofactor, n: CURVE_ORDER } = CURVE;
    validateObject(extraOpts, {}, {
        allowInfinityPoint: 'boolean',
        clearCofactor: 'function',
        isTorsionFree: 'function',
        fromBytes: 'function',
        toBytes: 'function',
        endo: 'object',
        randomBytes: 'function',
    });
    // Snapshot every hook and take an owned copy of nested GLV configuration. Later mutations of
    // the caller's options must not change arithmetic, subgroup, or codec policy.
    const { endo: endoOpts, allowInfinityPoint, clearCofactor, isTorsionFree, fromBytes, toBytes, } = extraOpts;
    const randomBytes$1 = extraOpts.randomBytes === undefined ? randomBytes : extraOpts.randomBytes;
    if (endoOpts) {
        if (!Fp.is0(CURVE.a) || typeof endoOpts.beta !== 'bigint' || !Array.isArray(endoOpts.basises)) {
            throw new Error('invalid endo: expected "beta": bigint and "basises": array');
        }
    }
    const endo = endoOpts
        ? {
            beta: endoOpts.beta,
            basises: endoOpts.basises.map((basis) => [...basis]),
        }
        : undefined;
    const lengths = getWLengths(Fp, Fn);
    function assertCompressionIsSupported() {
        if (!Fp.isOdd)
            throw new Error('compression is not supported: Field does not have .isOdd()');
    }
    // Implements IEEE P1363 point encoding
    function pointToBytes(_c, point, isCompressed) {
        // Handle infinity before toAffine(), which maps ZERO to (0, 0) silently: without this the
        // encoder would emit an all-zero byte string that decodes back as a different point. Only
        // curves that opt into infinity as a public point value get the SEC 1 byte form.
        if (point.is0()) {
            if (!allowInfinityPoint)
                throw new Error('bad point: ZERO');
            return Uint8Array.of(0); // SEC 1 v2.0 §2.3.3
        }
        const { x, y } = point.toAffine();
        const bx = Fp.toBytes(x);
        abool(isCompressed, 'isCompressed');
        if (isCompressed) {
            assertCompressionIsSupported();
            const hasEvenY = !Fp.isOdd(y);
            return concatBytes(pprefix(hasEvenY), bx);
        }
        else {
            return concatBytes(Uint8Array.of(0x04), bx, Fp.toBytes(y));
        }
    }
    function pointFromBytes(bytes) {
        abytes(bytes, undefined, 'Point');
        const { publicKey: comp, publicKeyUncompressed: uncomp } = lengths; // e.g. for 32-byte: 33, 65
        const length = bytes.length;
        const head = bytes[0];
        const tail = bytes.subarray(1);
        // SEC 1 v2.0 §2.3.4 decodes 0x00 as infinity, but §3.2.2 rejects infinity as a public key.
        // Leaving 0x00 undecodable by default makes that rejection structural rather than a check:
        // callers reuse this parser as the strict key boundary, and infinity is simply not
        // expressible. Curves where infinity is a real wire value opt into the codec instead.
        // secp256k1 crosstests show OpenSSL raw point codecs accept 0x00 too.
        if (allowInfinityPoint && length === 1 && head === 0x00)
            return { x: Fp.ZERO, y: Fp.ZERO };
        // No actual validation is done here: use .assertValidity()
        if (length === comp && (head === 0x02 || head === 0x03)) {
            const x = Fp.fromBytes(tail);
            if (!Fp.isValid(x))
                throw new Error('bad point: is not on curve, wrong x');
            const y2 = weierstrassEquation(x); // y² = x³ + ax + b
            let y;
            try {
                y = Fp.sqrt(y2); // y = y² ^ (p+1)/4
            }
            catch (sqrtError) {
                const err = sqrtError instanceof Error ? ': ' + sqrtError.message : '';
                throw new Error('bad point: is not on curve, sqrt error' + err);
            }
            assertCompressionIsSupported();
            const evenY = Fp.isOdd(y);
            const evenH = (head & 1) === 1; // ECDSA-specific
            if (evenH !== evenY)
                y = Fp.neg(y);
            return { x, y };
        }
        else if (length === uncomp && head === 0x04) {
            // TODO: more checks
            const L = Fp.BYTES;
            const x = Fp.fromBytes(tail.subarray(0, L));
            const y = Fp.fromBytes(tail.subarray(L, L * 2));
            if (!isValidXY(x, y))
                throw new Error('bad point: is not on curve');
            return { x, y };
        }
        else {
            throw new Error(`bad point: got length ${length}, expected compressed=${comp} or uncompressed=${uncomp}`);
        }
    }
    const encodePoint = toBytes === undefined ? pointToBytes : toBytes;
    const decodePoint = fromBytes === undefined ? pointFromBytes : fromBytes;
    // Hoisted from double() / add(): curve params never change after construction.
    // Koblitz curves (a=0, e.g. secp256k1) skip the three a-multiplications per operation;
    // the selection depends only on public curve constants.
    const b3 = Fp.mul(CURVE.b, _3n$1);
    const mulA = Fp.is0(CURVE.a) ? (_) => Fp.ZERO : (x) => Fp.mul(CURVE.a, x);
    function weierstrassEquation(x) {
        const x2 = Fp.sqr(x);
        const x3 = Fp.mul(x2, x);
        return Fp.add(Fp.add(x3, Fp.mul(x, CURVE.a)), CURVE.b); // x³ + a * x + b
    }
    // TODO: move top-level
    /** Checks whether equation holds for given x, y: y² == x³ + ax + b */
    function isValidXY(x, y) {
        const left = Fp.sqr(y);
        const right = weierstrassEquation(x); // x³ + ax + b
        return Fp.eql(left, right);
    }
    // Keep constructor-time generator validation cheap: callers are responsible for supplying the
    // correct prime-order base point, while eager subgroup checks here would slow heavy module imports.
    // Test 1: equation y² = x³ + ax + b should work for generator point.
    if (!isValidXY(CURVE.Gx, CURVE.Gy))
        throw new Error('bad curve params: generator point');
    // Test 2: discriminant Δ part should be non-zero: 4a³ + 27b² != 0.
    // Guarantees curve is genus-1, smooth (non-singular).
    const _4a3 = Fp.mul(Fp.pow(CURVE.a, _3n$1), _4n$1);
    const _27b2 = Fp.mul(Fp.sqr(CURVE.b), BigInt(27));
    if (Fp.is0(Fp.add(_4a3, _27b2)))
        throw new Error('bad curve params: a or b');
    /** Asserts coordinate is valid: 0 <= n < Fp.ORDER. */
    function acoord(title, n, banZero = false) {
        if (!Fp.isValid(n) || (banZero && Fp.is0(n)))
            throw new Error(`bad point coordinate ${title}`);
        // Extension-field elements are objects. Keep point coordinates detached from caller-owned
        // objects so their mutation cannot invalidate cached on-curve / subgroup checks. Primitive
        // field elements (bigints in shipped prime fields) are already immutable values.
        return typeof n === 'object' && n !== null ? Fp.create(n) : n;
    }
    function aprjpoint(other) {
        if (!(other instanceof Point))
            throw new Error('Weierstrass Point expected');
    }
    function splitEndoScalarN(k) {
        if (!endo || !endo.basises)
            throw new Error('no endo');
        return _splitEndoScalar(k, endo.basises, Fn.ORDER);
    }
    /**
     * Appends a (point, scalar) pair to the inputs of a vartime wNAF walk
     * ({@link mulAddUnsafe}). With GLV endomorphism the scalar is split into two half-width
     * pairs against P and ψ(P) = (β⋅x, y), halving the walk's shared doubling chain;
     * split signs fold into the points.
     */
    function pushWnafPair(points, scalars, p, k) {
        if (!Fn.isValid(k))
            throw new RangeError('invalid scalar: out of range'); // 0 is valid
        if (endo) {
            const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(k);
            const psi = new Point(Fp.mul(p.X, endo.beta), p.Y, p.Z);
            points.push(k1neg ? p.negate() : p, k2neg ? psi.negate() : psi);
            scalars.push(k1, k2);
        }
        else {
            points.push(p);
            scalars.push(k);
        }
    }
    // Successful assertValidity() results are cached: Point instances are frozen at construction,
    // so on-curve + subgroup facts cannot change afterwards. Only success is cached — invalid
    // points re-throw on every call. This matters most for pairing curves, where subgroup checks
    // cost a scalar multiplication and the same instance is re-validated across layers
    // (signature fromBytes, pairingBatch) or across repeated verifies with a cached public key.
    const validityCache = new WeakSet();
    /**
     * Projective Point works in 3d / projective (homogeneous) coordinates:(X, Y, Z) ∋ (x=X/Z, y=Y/Z).
     * Default Point works in 2d / affine coordinates: (x, y).
     * We're doing calculations in projective, because its operations don't require costly inversion.
     */
    class Point {
        static BASE = new Point(CURVE.Gx, CURVE.Gy, Fp.ONE);
        static ZERO = new Point(Fp.ZERO, Fp.ONE, Fp.ZERO);
        static Fp = Fp;
        static Fn = Fn;
        X;
        Y;
        Z;
        /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
        constructor(X, Y, Z) {
            this.X = acoord('x', X);
            // This is not just about ZERO / infinity: ambient curves can have real
            // finite points with y=0. Those points are 2-torsion, so they cannot lie
            // in the odd prime-order subgroups this point type is meant to represent.
            this.Y = acoord('y', Y, true);
            this.Z = acoord('z', Z);
            Object.freeze(this);
        }
        static CURVE() {
            return CURVE;
        }
        /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
        static fromAffine(p) {
            const { x, y } = p || {};
            if (!p || !Fp.isValid(x) || !Fp.isValid(y))
                throw new Error('invalid affine point');
            if (p instanceof Point)
                throw new Error('projective point not allowed');
            // (0, 0) would've produced (0, 0, 1) - instead, we need (0, 1, 0)
            if (Fp.is0(x) && Fp.is0(y))
                return Point.ZERO;
            return new Point(x, y, Fp.ONE);
        }
        static fromBytes(bytes) {
            const P = Point.fromAffine(decodePoint(abytes(bytes, undefined, 'point')));
            P.assertValidity();
            return P;
        }
        static fromHex(hex) {
            return Point.fromBytes(hexToBytes(hex));
        }
        get x() {
            return this.toAffine().x;
        }
        get y() {
            return this.toAffine().y;
        }
        /**
         * @param isLazy - true will defer table computation until the first multiplication
         */
        precompute(windowSize = 6, isLazy = true) {
            wnaf.setWindowSize(this, windowSize);
            if (!isLazy)
                this.multiply(_3n$1); // random number
            return this;
        }
        // TODO: return `this`
        /** A point on curve is valid if it conforms to equation. */
        assertValidity() {
            const p = this;
            if (p.is0()) {
                // (0, 1, 0) aka ZERO is invalid in most contexts.
                // In BLS, ZERO can be serialized, so we allow it.
                // Keep the accepted infinity encoding canonical: projective-equivalent (X, Y, 0) points
                // like (1, 1, 0) compare equal to ZERO, but only (0, 1, 0) should pass this guard.
                if (allowInfinityPoint && Fp.is0(p.X) && Fp.eql(p.Y, Fp.ONE) && Fp.is0(p.Z))
                    return;
                throw new Error('bad point: ZERO');
            }
            if (validityCache.has(p))
                return;
            // Some 3rd-party test vectors require different wording between here & `fromCompressedHex`
            const { x, y } = p.toAffine();
            if (!Fp.isValid(x) || !Fp.isValid(y))
                throw new Error('bad point: x or y not field elements');
            if (!isValidXY(x, y))
                throw new Error('bad point: equation left != right');
            if (!p.isTorsionFree())
                throw new Error('bad point: not in prime-order subgroup');
            validityCache.add(p);
        }
        hasEvenY() {
            const { y } = this.toAffine();
            if (!Fp.isOdd)
                throw new Error("Field doesn't support isOdd");
            return !Fp.isOdd(y);
        }
        /** Compare one point to another. */
        equals(other) {
            aprjpoint(other);
            const { X: X1, Y: Y1, Z: Z1 } = this;
            const { X: X2, Y: Y2, Z: Z2 } = other;
            const U1 = Fp.eql(Fp.mul(X1, Z2), Fp.mul(X2, Z1));
            const U2 = Fp.eql(Fp.mul(Y1, Z2), Fp.mul(Y2, Z1));
            return U1 && U2;
        }
        /** Flips point to one corresponding to (x, -y) in Affine coordinates. */
        negate() {
            return new Point(this.X, Fp.neg(this.Y), this.Z);
        }
        // Renes-Costello-Batina exception-free doubling formula.
        // There is 30% faster Jacobian formula, but it is not complete.
        // https://eprint.iacr.org/2015/1060, algorithm 3
        // Cost: 8M + 3S + 3*a + 2*b3 + 15add.
        double() {
            const { X: X1, Y: Y1, Z: Z1 } = this;
            let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO; // prettier-ignore
            let t0 = Fp.mul(X1, X1); // step 1
            let t1 = Fp.mul(Y1, Y1);
            let t2 = Fp.mul(Z1, Z1);
            let t3 = Fp.mul(X1, Y1);
            t3 = Fp.add(t3, t3); // step 5
            Z3 = Fp.mul(X1, Z1);
            Z3 = Fp.add(Z3, Z3);
            X3 = mulA(Z3);
            Y3 = Fp.mul(b3, t2);
            Y3 = Fp.add(X3, Y3); // step 10
            X3 = Fp.sub(t1, Y3);
            Y3 = Fp.add(t1, Y3);
            Y3 = Fp.mul(X3, Y3);
            X3 = Fp.mul(t3, X3);
            Z3 = Fp.mul(b3, Z3); // step 15
            t2 = mulA(t2);
            t3 = Fp.sub(t0, t2);
            t3 = mulA(t3);
            t3 = Fp.add(t3, Z3);
            Z3 = Fp.add(t0, t0); // step 20
            t0 = Fp.add(Z3, t0);
            t0 = Fp.add(t0, t2);
            t0 = Fp.mul(t0, t3);
            Y3 = Fp.add(Y3, t0);
            t2 = Fp.mul(Y1, Z1); // step 25
            t2 = Fp.add(t2, t2);
            t0 = Fp.mul(t2, t3);
            X3 = Fp.sub(X3, t0);
            Z3 = Fp.mul(t2, t1);
            Z3 = Fp.add(Z3, Z3); // step 30
            Z3 = Fp.add(Z3, Z3);
            return new Point(X3, Y3, Z3);
        }
        // Renes-Costello-Batina exception-free addition formula.
        // There is 30% faster Jacobian formula, but it is not complete.
        // https://eprint.iacr.org/2015/1060, algorithm 1
        // Cost: 12M + 0S + 3*a + 3*b3 + 23add.
        add(other) {
            aprjpoint(other);
            const { X: X1, Y: Y1, Z: Z1 } = this;
            const { X: X2, Y: Y2, Z: Z2 } = other;
            let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO; // prettier-ignore
            let t0 = Fp.mul(X1, X2); // step 1
            let t1 = Fp.mul(Y1, Y2);
            let t2 = Fp.mul(Z1, Z2);
            let t3 = Fp.add(X1, Y1);
            let t4 = Fp.add(X2, Y2); // step 5
            t3 = Fp.mul(t3, t4);
            t4 = Fp.add(t0, t1);
            t3 = Fp.sub(t3, t4);
            t4 = Fp.add(X1, Z1);
            let t5 = Fp.add(X2, Z2); // step 10
            t4 = Fp.mul(t4, t5);
            t5 = Fp.add(t0, t2);
            t4 = Fp.sub(t4, t5);
            t5 = Fp.add(Y1, Z1);
            X3 = Fp.add(Y2, Z2); // step 15
            t5 = Fp.mul(t5, X3);
            X3 = Fp.add(t1, t2);
            t5 = Fp.sub(t5, X3);
            Z3 = mulA(t4);
            X3 = Fp.mul(b3, t2); // step 20
            Z3 = Fp.add(X3, Z3);
            X3 = Fp.sub(t1, Z3);
            Z3 = Fp.add(t1, Z3);
            Y3 = Fp.mul(X3, Z3);
            t1 = Fp.add(t0, t0); // step 25
            t1 = Fp.add(t1, t0);
            t2 = mulA(t2);
            t4 = Fp.mul(b3, t4);
            t1 = Fp.add(t1, t2);
            t2 = Fp.sub(t0, t2); // step 30
            t2 = mulA(t2);
            t4 = Fp.add(t4, t2);
            t0 = Fp.mul(t1, t4);
            Y3 = Fp.add(Y3, t0);
            t0 = Fp.mul(t5, t4); // step 35
            X3 = Fp.mul(t3, X3);
            X3 = Fp.sub(X3, t0);
            t0 = Fp.mul(t3, t1);
            Z3 = Fp.mul(t5, Z3);
            Z3 = Fp.add(Z3, t0); // step 40
            return new Point(X3, Y3, Z3);
        }
        subtract(other) {
            // Validate before calling `negate()` so wrong inputs fail with the point guard
            // instead of leaking a foreign `negate()` error.
            aprjpoint(other);
            return this.add(other.negate());
        }
        is0() {
            return this.equals(Point.ZERO);
        }
        /**
         * Constant time multiplication.
         * Uses precomputed tables (signed fixed-window wNAF) when available.
         * Uses scalar blinding and avoids endomorphism splitting in the secret-scalar path.
         * @param scalar - by which the point would be multiplied
         * @returns New point
         */
        multiply(scalar) {
            // Keep the subgroup-scalar contract strict instead of reducing 0 / n to ZERO.
            // In key/signature-style callers, those values usually mean broken hash/scalar plumbing,
            // and failing closed is safer than silently producing the identity point.
            if (!Fn.isValidNot0(scalar))
                throw new RangeError('invalid scalar: out of range'); // 0 is invalid
            const { p, f } = wnaf.mulSecret(this, scalar, cofactor, normalize);
            return normalize([p, f])[0];
        }
        /**
         * Non-constant-time multiplication. Uses width-4 wNAF with GLV endomorphism splitting
         * when available (two half-width scalars sharing one halved doubling chain).
         * It's faster, but should only be used when you don't care about
         * an exposed secret key e.g. sig verification, which works over *public* keys.
         */
        multiplyUnsafe(scalar) {
            const p = this;
            const sc = scalar;
            // Public-scalar callers may need 0, but n and larger values stay rejected here too.
            // Reducing them mod n would turn bad caller input into an accidental identity point.
            if (!Fn.isValid(sc))
                throw new RangeError('invalid scalar: out of range'); // 0 is valid
            if (sc === _0n$3 || p.is0())
                return Point.ZERO;
            if (sc === _1n$3)
                return p;
            if (wnaf.hasWindowSize(this))
                return wnaf.mulUnsafe(p, sc, normalize); // precomputes
            const points = [];
            const scalars = [];
            pushWnafPair(points, scalars, p, sc);
            return mulAddUnsafe(Point, points, scalars);
        }
        /**
         * Non-constant-time double-scalar multiplication `a⋅this + b⋅other` (Strauss–Shamir).
         * Both walks share one doubling chain via {@link mulAddUnsafe}, and GLV endomorphism
         * (when available) halves the chain again by splitting each scalar into two half-width
         * parts. Used by ECDSA verification and public-key recovery for `R = u1⋅G + u2⋅P`.
         * Only for public scalars.
         */
        mulAddUnsafe(a, other, b) {
            aprjpoint(other);
            const points = [];
            const scalars = [];
            pushWnafPair(points, scalars, this, a);
            pushWnafPair(points, scalars, other, b);
            return mulAddUnsafe(Point, points, scalars);
        }
        /**
         * Converts Projective point to affine (x, y) coordinates.
         * (X, Y, Z) ∋ (x=X/Z, y=Y/Z).
         * @param invertedZ - Z^-1 (inverted zero) - optional, precomputation is useful for invertBatch
         */
        toAffine(invertedZ) {
            const p = this;
            let iz = invertedZ;
            if (iz != null && !Fp.isValid(iz))
                throw new RangeError('"invertedZ" expected valid field element');
            const { X, Y, Z } = p;
            // Fast-path for normalized points
            if (Fp.eql(Z, Fp.ONE))
                return { x: X, y: Y };
            const is0 = p.is0();
            // If invZ was 0, we return zero point. However we still want to execute
            // all operations, so we replace invZ with a random number, 1.
            if (iz == null)
                iz = is0 ? Fp.ONE : Fp.inv(Z);
            const x = Fp.mul(X, iz);
            const y = Fp.mul(Y, iz);
            const zz = Fp.mul(Z, iz);
            if (is0)
                return { x: Fp.ZERO, y: Fp.ZERO };
            if (!Fp.eql(zz, Fp.ONE))
                throw new Error('invZ was invalid');
            return { x, y };
        }
        /**
         * Checks whether Point is free of torsion elements (is in prime subgroup).
         * Always torsion-free for cofactor=1 curves.
         */
        isTorsionFree() {
            if (cofactor === _1n$3)
                return true;
            if (isTorsionFree)
                return isTorsionFree(Point, this);
            // unsafe() will use the uncached wNAF path internally, since CURVE_ORDER >= Fn.ORDER
            return wnaf.mulUnsafe(this, CURVE_ORDER).is0();
        }
        clearCofactor() {
            if (cofactor === _1n$3)
                return this; // Fast-path
            if (clearCofactor)
                return clearCofactor(Point, this);
            // Default fallback assumes the cofactor fits the usual subgroup-scalar
            // multiplyUnsafe() contract. Curves with larger / structured cofactors
            // should define a clearCofactor override anyway (e.g. psi/Frobenius maps).
            return this.multiplyUnsafe(cofactor);
        }
        isSmallOrder() {
            if (cofactor === _1n$3)
                return this.is0(); // Fast-path
            return this.clearCofactor().is0();
        }
        toBytes(isCompressed = true) {
            abool(isCompressed, 'isCompressed');
            // assertValidity() covers on-curve and subgroup membership. The encoder below repeats the
            // infinity check rather than relying on this call, so it stays correct for any caller.
            this.assertValidity();
            return encodePoint(Point, this, isCompressed);
        }
        toHex(isCompressed = true) {
            return bytesToHex(this.toBytes(isCompressed));
        }
        toString() {
            return `<Point ${this.is0() ? 'ZERO' : this.toHex()}>`;
        }
    }
    const normalize = (points) => normalizeZ(Point, points);
    const wnaf = new ScalarMultiplier(Point, randomBytes$1);
    // Enable W=6 wNAF precomputes. Slows down first publicKey computation.
    // Disable for tiny toy curves, with scalar fields < 6 bits.
    if (wnaf.bits >= 6)
        Point.BASE.precompute(6);
    Object.freeze(Point.prototype);
    Object.freeze(Point);
    return Point;
}
// Points start with byte 0x02 when y is even; otherwise 0x03
function pprefix(hasEvenY) {
    return Uint8Array.of(hasEvenY ? 0x02 : 0x03);
}
function getWLengths(Fp, Fn) {
    return {
        secretKey: Fn.BYTES,
        publicKey: 1 + Fp.BYTES,
        publicKeyUncompressed: 1 + 2 * Fp.BYTES,
        publicKeyHasPrefix: true,
        // Raw compact `(r || s)` signature width; DER and recovered signatures use
        // different lengths outside this helper.
        signature: 2 * Fn.BYTES,
    };
}
/**
 * Sometimes users only need getPublicKey, getSharedSecret, and secret key handling.
 * This helper ensures no signature functionality is present. Less code, smaller bundle size.
 * @param Point - Weierstrass point constructor.
 * @param ecdhOpts - Optional randomness helpers:
 *   - `randomBytes` (optional): Optional RNG override.
 * @returns ECDH helper namespace.
 * @example
 * Sometimes users only need getPublicKey, getSharedSecret, and secret key handling.
 *
 * ```ts
 * import { ecdh } from '@noble/curves/abstract/weierstrass.js';
 * import { p256 } from '@noble/curves/nist.js';
 * const dh = ecdh(p256.Point);
 * const alice = dh.keygen();
 * const shared = dh.getSharedSecret(alice.secretKey, alice.publicKey);
 * ```
 */
function ecdh(Point, ecdhOpts = {}) {
    validatePointCons(Point);
    const { Fn } = Point;
    const randomBytes_ = ecdhOpts.randomBytes === undefined ? randomBytes : ecdhOpts.randomBytes;
    // Keep the advertised seed length aligned with mapHashToField(), which keeps a hard 16-byte
    // minimum even on toy curves.
    const lengths = Object.assign(getWLengths(Point.Fp, Fn), {
        seed: Math.max(getMinHashLength(Fn.ORDER), 16),
    });
    function isValidSecretKey(secretKey) {
        try {
            const num = Fn.fromBytes(secretKey);
            return Fn.isValidNot0(num);
        }
        catch (error) {
            return false;
        }
    }
    function isValidPublicKey(publicKey, isCompressed) {
        const { publicKey: comp, publicKeyUncompressed } = lengths;
        try {
            const l = publicKey.length;
            if (isCompressed === true && l !== comp)
                return false;
            if (isCompressed === false && l !== publicKeyUncompressed)
                return false;
            // SEC 1 §3.2.2: the identity is never a valid public key, even on curves whose codec
            // can decode it.
            return !Point.fromBytes(publicKey).is0();
        }
        catch (error) {
            return false;
        }
    }
    /**
     * Produces cryptographically secure secret key from random of size
     * (groupLen + ceil(groupLen / 2)) with modulo bias being negligible.
     */
    function randomSecretKey(seed) {
        seed = seed === undefined ? randomBytes_(lengths.seed) : seed;
        return mapHashToField(abytes(seed, lengths.seed, 'seed'), Fn.ORDER);
    }
    /**
     * Computes public key for a secret key. Checks for validity of the secret key.
     * @param isCompressed - whether to return compact (default), or full key
     * @returns Public key, full when isCompressed=false; short when isCompressed=true
     */
    function getPublicKey(secretKey, isCompressed = true) {
        return Point.BASE.multiply(Fn.fromBytes(secretKey)).toBytes(isCompressed);
    }
    /**
     * Quick and dirty check for item being public key. Does not validate hex, or being on-curve.
     */
    function isProbPub(item) {
        const { secretKey, publicKey, publicKeyUncompressed } = lengths;
        const allowedLengths = Fn._lengths;
        if (!isBytes(item))
            return undefined;
        const l = abytes(item, undefined, 'key').length;
        const isPub = l === publicKey || l === publicKeyUncompressed;
        const isSec = l === secretKey || !!allowedLengths?.includes(l);
        // P-521 accepts both 65- and 66-byte secret keys, so overlapping lengths stay ambiguous.
        if (isPub && isSec)
            return undefined;
        return isPub;
    }
    /**
     * ECDH (Elliptic Curve Diffie Hellman).
     * Computes encoded shared point from secret key A and public key B.
     * Checks: 1) secret key validity 2) shared key is on-curve.
     * Does NOT hash the result or expose the SEC 1 x-coordinate-only `z`.
     * Returns the encoded shared point on purpose: callers that need `x_P`
     * can derive it from the encoded point, but `x_P` alone cannot recover the
     * point/parity back.
     * This helper only exposes the fully validated public-key path, not cofactor DH.
     * @param isCompressed - whether to return compact (default), or full key
     * @returns shared point encoding
     */
    function getSharedSecret(secretKeyA, publicKeyB, isCompressed = true) {
        if (isProbPub(secretKeyA) === true)
            throw new Error('first arg must be private key');
        if (isProbPub(publicKeyB) === false)
            throw new Error('second arg must be public key');
        const s = Fn.fromBytes(secretKeyA);
        const b = Point.fromBytes(publicKeyB); // checks for being on-curve
        if (b.is0())
            throw new Error('invalid public key: point at infinity');
        return b.multiply(s).toBytes(isCompressed);
    }
    const utils = {
        isValidSecretKey,
        isValidPublicKey,
        randomSecretKey,
    };
    const keygen = createKeygen(randomSecretKey, getPublicKey);
    Object.freeze(utils);
    Object.freeze(lengths);
    return Object.freeze({ getPublicKey, getSharedSecret, keygen, Point, utils, lengths });
}
/**
 * Creates ECDSA signing interface for given elliptic curve `Point` and `hash` function.
 *
 * @param Point - created using {@link weierstrass} function
 * @param hash - used for 1) message prehash-ing 2) k generation in `sign`, using hmac_drbg(hash)
 * @param ecdsaOpts - rarely needed, see {@link ECDSAOpts}:
 *   - `lowS`: Default low-S policy.
 *   - `hmac`: HMAC implementation used by RFC6979 DRBG.
 *   - `randomBytes`: Optional RNG override.
 *   - `bits2int`: Optional hash-to-int conversion override.
 *   - `bits2int_modN`: Optional hash-to-int-mod-n conversion override.
 *
 * @returns ECDSA helper namespace.
 * @example
 * Create an ECDSA signer/verifier bundle for one curve implementation.
 *
 * ```ts
 * import { ecdsa } from '@noble/curves/abstract/weierstrass.js';
 * import { p256 } from '@noble/curves/nist.js';
 * import { sha256 } from '@noble/hashes/sha2.js';
 * const p256ecdsa = ecdsa(p256.Point, sha256);
 * const { secretKey, publicKey } = p256ecdsa.keygen();
 * const msg = new TextEncoder().encode('hello noble');
 * const sig = p256ecdsa.sign(msg, secretKey);
 * const isValid = p256ecdsa.verify(sig, msg, publicKey);
 * ```
 */
function ecdsa(Point, hash, ecdsaOpts = {}) {
    validatePointCons(Point);
    // Custom hash / bits2int hooks are treated as pure functions over validated caller-owned bytes.
    const hash_ = hash;
    ahash(hash_);
    validateObject(ecdsaOpts, {}, {
        hmac: 'function',
        lowS: 'boolean',
        randomBytes: 'function',
        bits2int: 'function',
        bits2int_modN: 'function',
    });
    const opts = Object.assign({}, ecdsaOpts);
    const randomBytes$1 = opts.randomBytes === undefined ? randomBytes : opts.randomBytes;
    const hmac$1 = opts.hmac === undefined
        ? (key, msg) => hmac(hash_, key, msg)
        : opts.hmac;
    const { Fp, Fn } = Point;
    const { ORDER: CURVE_ORDER, BITS: fnBits } = Fn;
    // Nonce-inversion blinding in k2sig draws `getMinHashLength(n)` bytes per sign. Probe the RNG
    // once (see {@link probeRandomBytes}, shared with ScalarMultiplier): in environments without
    // working randomness, signing downgrades to Fermat inversion (invertCt) instead of throwing on
    // every sign(). The shape of returned bytes is still validated (by mapHashToField) on every
    // blinded call, where breakage fails closed.
    const blindLength = getMinHashLength(CURVE_ORDER);
    const csprng = probeRandomBytes(randomBytes$1, blindLength);
    const { keygen, getPublicKey, getSharedSecret, utils, lengths } = ecdh(Point, opts);
    const defaultSigOpts = {
        prehash: true,
        lowS: typeof opts.lowS === 'boolean' ? opts.lowS : true,
        format: 'compact',
        extraEntropy: false,
    };
    // SEC 1 4.1.6 public-key recovery tries x = r + jn for j = 0..h. Our recovered-signature
    // format only stores one overflow bit, so it can only distinguish q.x = r from q.x = r + n.
    // A third lift would have the form q.x = r + 2n. Since valid ECDSA r is in 1..n-1, the
    // smallest such lift is 1 + 2n, not 2n.
    const hasLargeRecoveryLifts = CURVE_ORDER * _2n$4 + _1n$3 < Fp.ORDER;
    function isBiggerThanHalfOrder(number) {
        const HALF = CURVE_ORDER >> _1n$3;
        return number > HALF;
    }
    function validateRS(title, num) {
        if (!Fn.isValidNot0(num))
            throw new Error(`invalid signature ${title}: out of range 1..Point.Fn.ORDER`);
        return num;
    }
    function assertFieldSignIsSupported() {
        if (!Fp.isOdd)
            throw new Error("Field doesn't support isOdd");
    }
    // Recovery id of an affine point (x, y) whose x reduces to signature `r` mod n:
    // bit 0 = y parity, bit 1 = x overflowed the group order (x = r + n).
    function getRecoveryBit(x, y, r) {
        assertFieldSignIsSupported();
        return (x === r ? 0 : 2) | Number(Fp.isOdd(y));
    }
    function assertRecoverableCurve() {
        // ECDSA recovery only supports curves where the current recovery id can distinguish
        // q.x = r and q.x = r + n; larger lifts may need additional `r + n*i` branches.
        // SEC 1 4.1.6 recovers candidates via x = r + jn, but this format only encodes j = 0 or 1.
        // The next possible candidate is q.x = r + 2n, and its smallest valid value is 1 + 2n.
        // To easily get i, we either need to:
        // a. increase amount of valid recid values (4, 5...); OR
        // b. prohibit recovered signatures for those curves.
        if (hasLargeRecoveryLifts)
            throw new Error('"recovered" sig type is not supported for cofactor >2 curves');
    }
    function validateSigLength(bytes, format) {
        validateSigFormat(format);
        const size = lengths.signature;
        const sizer = format === 'compact' ? size : format === 'recovered' ? size + 1 : undefined;
        return abytes(bytes, sizer);
    }
    /**
     * ECDSA signature with its (r, s) properties. Supports compact, recovered & DER representations.
     */
    class Signature {
        r;
        s;
        recovery;
        constructor(r, s, recovery) {
            this.r = validateRS('r', r); // r in [1..N-1];
            this.s = validateRS('s', s); // s in [1..N-1];
            if (recovery != null) {
                assertRecoverableCurve();
                if (![0, 1, 2, 3].includes(recovery))
                    throw new Error('invalid recovery id');
                this.recovery = recovery;
            }
            Object.freeze(this);
        }
        static fromBytes(bytes, format = defaultSigOpts.format) {
            validateSigLength(bytes, format);
            let recid;
            if (format === 'der') {
                // Valid scalar INTEGERs use at most Fn.BYTES plus one DER sign-padding byte. Keep the
                // total bound conservative so malformed inputs are rejected before parsing any INTEGER.
                if (bytes.length > 2 * Fn.BYTES + 16)
                    throw new DER.Err('invalid signature: DER signature too long');
                const { r, s } = DER.toSig(abytes(bytes), Fn.BYTES + 1);
                return new Signature(r, s);
            }
            if (format === 'recovered') {
                recid = bytes[0];
                format = 'compact';
                bytes = bytes.subarray(1);
            }
            const L = lengths.signature / 2;
            const r = bytes.subarray(0, L);
            const s = bytes.subarray(L, L * 2);
            return new Signature(Fn.fromBytes(r), Fn.fromBytes(s), recid);
        }
        static fromHex(hex, format) {
            return this.fromBytes(hexToBytes(hex), format);
        }
        assertRecovery() {
            const { recovery } = this;
            if (recovery == null)
                throw new Error('invalid recovery id: must be present');
            return recovery;
        }
        addRecoveryBit(recovery) {
            return new Signature(this.r, this.s, recovery);
        }
        // Unlike the top-level helper below, this method expects a digest that has
        // already been hashed to the curve's message representative.
        recoverPublicKey(messageHash) {
            const { r, s } = this;
            const recovery = this.assertRecovery();
            const radj = recovery === 2 || recovery === 3 ? r + CURVE_ORDER : r;
            if (!Fp.isValid(radj))
                throw new Error('invalid recovery id: sig.r+curve.n != R.x');
            const x = Fp.toBytes(radj);
            const R = Point.fromBytes(concatBytes(pprefix((recovery & 1) === 0), x));
            const ir = Fn.inv(radj); // r^-1
            const h = bits2int_modN(abytes(messageHash, undefined, 'msgHash')); // Truncate hash
            const u1 = Fn.create(-h * ir); // -hr^-1
            const u2 = Fn.create(s * ir); // sr^-1
            // (sr^-1)R-(hr^-1)G = -(hr^-1)G + (sr^-1). unsafe is fine: there is no private data.
            const Q = Point.BASE.mulAddUnsafe(u1, R, u2);
            if (Q.is0())
                throw new Error('invalid recovery: point at infinify');
            Q.assertValidity();
            return Q;
        }
        // Signatures should be low-s, to prevent malleability.
        hasHighS() {
            return isBiggerThanHalfOrder(this.s);
        }
        toBytes(format = defaultSigOpts.format) {
            validateSigFormat(format);
            if (format === 'der')
                return hexToBytes(DER.hexFromSig(this));
            const { r, s } = this;
            const rb = Fn.toBytes(r);
            const sb = Fn.toBytes(s);
            if (format === 'recovered') {
                assertRecoverableCurve();
                return concatBytes(Uint8Array.of(this.assertRecovery()), rb, sb);
            }
            return concatBytes(rb, sb);
        }
        toHex(format) {
            return bytesToHex(this.toBytes(format));
        }
    }
    Object.freeze(Signature.prototype);
    Object.freeze(Signature);
    // RFC6979: ensure ECDSA msg is X bytes and < N. RFC suggests optional truncating via bits2octets.
    // FIPS 186-4 4.6 suggests the leftmost min(nBitLen, outLen) bits, which matches bits2int.
    // bits2int can produce res>N, we can do mod(res, N) since the bitLen is the same.
    // int2octets can't be used; pads small msgs with 0: unacceptatble for trunc as per RFC vectors
    const bits2int = opts.bits2int === undefined
        ? function bits2int_def(bytes) {
            // Our custom check "just in case", for protection against DoS
            if (bytes.length > 8192)
                throw new Error('input is too large');
            // For curves with nBitLength % 8 !== 0: bits2octets(bits2octets(m)) !== bits2octets(m)
            // for some cases, since bytes.length * 8 is not actual bitLength.
            const num = bytesToNumberBE(bytes); // check for == u8 done here
            const delta = bytes.length * 8 - fnBits; // truncate to nBitLength leftmost bits
            return delta > 0 ? num >> BigInt(delta) : num;
        }
        : opts.bits2int;
    const bits2int_modN = opts.bits2int_modN === undefined
        ? function bits2int_modN_def(bytes) {
            return Fn.create(bits2int(bytes)); // can't use bytesToNumberBE here
        }
        : opts.bits2int_modN;
    const ORDER_MASK = bitMask(fnBits);
    // Pads output with zero as per spec.
    /** Converts to bytes. Checks if num in `[0..ORDER_MASK-1]` e.g.: `[0..2^256-1]`. */
    function int2octets(num) {
        aInRange('num < 2^' + fnBits, num, _0n$3, ORDER_MASK);
        return Fn.toBytes(num);
    }
    function validateMsgAndHash(message, prehash) {
        abytes(message, undefined, 'message');
        return (prehash ? abytes(hash_(message), undefined, 'prehashed message') : message);
    }
    /**
     * Steps A, D of RFC6979 3.2.
     * Creates RFC6979 seed; converts msg/privKey to numbers.
     * Used only in sign, not in verify.
     *
     * Warning: we cannot assume here that message has same amount of bytes as curve order,
     * this will be invalid at least for P521. Also it can be bigger for P224 + SHA256.
     */
    function prepSig(message, secretKey, opts) {
        const { lowS, prehash, extraEntropy } = validateSigOpts(opts, defaultSigOpts);
        message = validateMsgAndHash(message, prehash); // RFC6979 3.2 A: h1 = H(m)
        // We can't later call bits2octets, since nested bits2int is broken for curves
        // with fnBits % 8 !== 0. Because of that, we unwrap it here as int2octets call.
        // const bits2octets = (bits) => int2octets(bits2int_modN(bits))
        const h1int = bits2int_modN(message);
        const d = Fn.fromBytes(secretKey); // validate secret key, convert to bigint
        if (!Fn.isValidNot0(d))
            throw new Error('invalid private key');
        const seedArgs = [int2octets(d), int2octets(h1int)];
        // extraEntropy. RFC6979 3.6: additional k' (optional).
        if (extraEntropy != null && extraEntropy !== false) {
            // K = HMAC_K(V || 0x00 || int2octets(x) || bits2octets(h1) || k')
            // gen random bytes OR pass as-is
            const e = extraEntropy === true ? randomBytes$1(lengths.secretKey) : extraEntropy;
            seedArgs.push(abytes(e, undefined, 'extraEntropy')); // check for being bytes
        }
        const seed = concatBytes(...seedArgs); // Step D of RFC6979 3.2
        const m = h1int; // no need to call bits2int second time here, it is inside truncateHash!
        // Converts signature params into point w r/s, checks result for validity.
        // To transform k => Signature:
        // q = k⋅G
        // r = q.x mod n
        // s = k^-1(m + rd) mod n
        // The nonce inversion is blinded: with random b ∈ [1,n−1], s = (bk)^-1(bm + bdr) per
        // https://tches.iacr.org/index.php/TCHES/article/view/7337/6509. Fn.inv()'s extended-Euclidean
        // loop count depends on its input (cf. Minerva), but here it only ever sees b·k — uniformly
        // random, independent of k — so its timing reveals nothing about the nonce; b also masks d in
        // the products. Without a CSPRNG (probed in ecdsa()) we fall back to Fermat inversion
        // (invertCt), whose control flow is data-independent, at ~4x the inversion cost.
        function k2sig(kBytes) {
            // RFC 6979 Section 3.2, step 3: k = bits2int(T)
            // Important: all mod() calls here must be done over N
            const k = bits2int(kBytes); // Cannot use fields methods, since it is group element
            if (!Fn.isValidNot0(k))
                return; // Valid scalars (including k) must be in 1..N-1
            const q = Point.BASE.multiply(k).toAffine(); // q = k⋅G
            const r = Fn.create(q.x); // r = q.x mod n
            if (r === _0n$3)
                return;
            let s;
            if (csprng !== undefined) {
                // mapHashToField maps 1.5x-order-length uniform bytes into [1, n-1], negligible bias.
                const b = bytesToNumberBE(mapHashToField(csprng(blindLength), CURVE_ORDER));
                const ibk = Fn.inv(Fn.mul(b, k)); // (bk)^-1: inversion input is decorrelated from k
                const bm = Fn.mul(b, m);
                const bd = Fn.mul(b, d);
                s = Fn.create(ibk * Fn.create(bm + bd * r)); // s = (bk)^-1(bm + bdr) = k^-1(m + rd) mod n
            }
            else {
                const ik = invertCt(k, CURVE_ORDER); // k^-1 mod n with data-independent control flow
                s = Fn.create(ik * Fn.create(m + r * d)); // s = k^-1(m + rd) mod n
            }
            if (s === _0n$3)
                return;
            let recovery = getRecoveryBit(q.x, q.y, r); // recovery bit (2 or 3 when q.x>n)
            let normS = s;
            if (lowS && isBiggerThanHalfOrder(s)) {
                normS = Fn.neg(s); // if lowS was passed, ensure s is always in the bottom half of N
                recovery ^= 1;
            }
            return new Signature(r, normS, hasLargeRecoveryLifts ? undefined : recovery);
        }
        return { seed, k2sig };
    }
    /**
     * Signs a message or message hash with a secret key.
     * With the default `prehash: true`, raw message bytes are hashed internally;
     * only `{ prehash: false }` expects a caller-supplied digest.
     *
     * ```
     * sign(m, d) where
     *   k = rfc6979_hmac_drbg(m, d)
     *   (x, y) = G × k
     *   r = x mod n
     *   s = (m + dr) / k mod n
     * ```
     */
    function sign(message, secretKey, opts = {}) {
        const { seed, k2sig } = prepSig(message, secretKey, opts); // Steps A, D of RFC6979 3.2.
        const drbg = createHmacDrbg(hash_.outputLen, Fn.BYTES, hmac$1);
        const sig = drbg(seed, k2sig); // Steps B, C, D, E, F, G
        return sig.toBytes(opts.format);
    }
    /**
     * Verifies a signature against message and public key.
     * Rejects lowS signatures by default: see {@link ECDSAVerifyOpts}.
     * Implements section 4.1.4 from https://www.secg.org/sec1-v2.pdf:
     *
     * ```
     * verify(r, s, h, P) where
     *   u1 = hs^-1 mod n
     *   u2 = rs^-1 mod n
     *   R = u1⋅G + u2⋅P
     *   mod(R.x, n) == r
     * ```
     */
    function verify(signature, message, publicKey, opts = {}) {
        const { lowS, prehash, format } = validateSigOpts(opts, defaultSigOpts);
        publicKey = abytes(publicKey, undefined, 'publicKey');
        message = validateMsgAndHash(message, prehash);
        if (!isBytes(signature)) {
            const end = signature instanceof Signature ? ', use sig.toBytes()' : '';
            throw new Error('verify expects Uint8Array signature' + end);
        }
        validateSigLength(signature, format); // execute this twice because we want loud error
        try {
            const sig = Signature.fromBytes(signature, format);
            const P = Point.fromBytes(publicKey);
            // SEC 1 verification keys must not be the identity, even when the generic point decoder
            // permits infinity for another protocol (for example, a pairing curve).
            if (P.is0())
                return false;
            if (lowS && sig.hasHighS())
                return false;
            const { r, s } = sig;
            const h = bits2int_modN(message); // mod n, not mod p
            const is = Fn.inv(s); // s^-1 mod n
            const u1 = Fn.create(h * is); // u1 = hs^-1 mod n
            const u2 = Fn.create(r * is); // u2 = rs^-1 mod n
            const R = Point.BASE.mulAddUnsafe(u1, P, u2); // u1⋅G + u2⋅P, joint Strauss–Shamir
            if (R.is0())
                return false;
            const q = R.toAffine();
            const v = Fn.create(q.x); // v = R.x mod n
            if (v !== r)
                return false;
            // R is the exact point `recoverPublicKey(r, recid)` reconstructs (sR = hG + rP),
            // so binding the signature to its recovery id only needs R's parity/overflow bits.
            if (format === 'recovered' && sig.recovery !== getRecoveryBit(q.x, q.y, r))
                return false;
            return true;
        }
        catch (e) {
            return false;
        }
    }
    function recoverPublicKey(signature, message, opts = {}) {
        // Top-level recovery mirrors `sign()` / `verify()`: it hashes raw message
        // bytes first unless the caller passes `{ prehash: false }`.
        const { prehash } = validateSigOpts(opts, defaultSigOpts);
        message = validateMsgAndHash(message, prehash);
        return Signature.fromBytes(signature, 'recovered').recoverPublicKey(message).toBytes();
    }
    // utils.isValidPublicKey() already rejects the identity, so ECDSA needs no shadow copy.
    return Object.freeze({
        keygen,
        getPublicKey,
        getSharedSecret,
        utils,
        lengths,
        Point,
        sign,
        verify,
        recoverPublicKey,
        Signature,
        hash: hash_,
    });
}

/**
 * NIST P256, P384, P521 curves.
 * https://www.secg.org/sec2-v2.pdf, https://neuromancer.sk/std/nist/P-256
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
// p = 2n**224n * (2n**32n-1n) + 2n**192n + 2n**96n - 1n
// a = Fp256.create(BigInt('-3'));
const p256_CURVE = /* @__PURE__ */ (() => ({
    p: BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff'),
    n: BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'),
    h: BigInt(1),
    a: BigInt('0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc'),
    b: BigInt('0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b'),
    Gx: BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'),
    Gy: BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5'),
}))();
// p = 2n**384n - 2n**128n - 2n**96n + 2n**32n - 1n
const p384_CURVE = /* @__PURE__ */ (() => ({
    p: BigInt('0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000ffffffff'),
    n: BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973'),
    h: BigInt(1),
    a: BigInt('0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000fffffffc'),
    b: BigInt('0xb3312fa7e23ee7e4988e056be3f82d19181d9c6efe8141120314088f5013875ac656398d8a2ed19d2a85c8edd3ec2aef'),
    Gx: BigInt('0xaa87ca22be8b05378eb1c71ef320ad746e1d3b628ba79b9859f741e082542a385502f25dbf55296c3a545e3872760ab7'),
    Gy: BigInt('0x3617de4a96262c6f5d9e98bf9292dc29f8f41dbd289a147ce9da3113b5f0b8c00a60b1ce1d7e819d7a431d7c90ea0e5f'),
}))();
// p = 2n**521n - 1n
const p521_CURVE = /* @__PURE__ */ (() => ({
    p: BigInt('0x1ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
    n: BigInt('0x01fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa51868783bf2f966b7fcc0148f709a5d03bb5c9b8899c47aebb6fb71e91386409'),
    h: BigInt(1),
    a: BigInt('0x1fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc'),
    b: BigInt('0x0051953eb9618e1c9a1f929a21a0b68540eea2da725b99b315f3b8b489918ef109e156193951ec7e937b1652c0bd3bb1bf073573df883d2c34f1ef451fd46b503f00'),
    Gx: BigInt('0x00c6858e06b70404e9cd9e3ecb662395b4429c648139053fb521f828af606b4d3dbaa14b5e77efe75928fe1dc127a2ffa8de3348b3c1856a429bf97e7e31c2e5bd66'),
    Gy: BigInt('0x011839296a789a3bc0045c8a5fb42c7d1bd998f54449579b446817afbd17273e662c97ee72995ef42640c550b9013fad0761353c7086a272c24088be94769fd16650'),
}))();
// NIST P256
const p256_Point = /* @__PURE__ */ weierstrass(p256_CURVE);
/**
 * NIST P256 (aka secp256r1, prime256v1) curve, ECDSA and ECDH methods.
 * Hashes inputs with sha256 by default.
 *
 * @example
 * Generate one P-256 keypair, sign a message, and verify it.
 *
 * ```js
 * import { p256 } from '@noble/curves/nist.js';
 * const { secretKey, publicKey } = p256.keygen();
 * const recovered = p256.getPublicKey(secretKey);
 * const peer = p256.keygen();
 * const shared = p256.getSharedSecret(secretKey, peer.publicKey);
 * const msg = new TextEncoder().encode('hello noble');
 * const sig = p256.sign(msg, secretKey, { lowS: true, prehash: true });
 * const isValid = p256.verify(sig, msg, publicKey);
 * // const sigKeccak = p256.sign(keccak256(msg), secretKey, { prehash: false });
 * ```
 */
const p256 = /* @__PURE__ */ ecdsa(p256_Point, sha256);
const p384_Point = /* @__PURE__ */ weierstrass(p384_CURVE);
/**
 * NIST P384 (aka secp384r1) curve, ECDSA and ECDH methods. Hashes inputs with sha384 by default.
 * @example
 * Generate one P-384 keypair, sign a message, and verify it.
 *
 * ```ts
 * const { secretKey, publicKey } = p384.keygen();
 * const msg = new TextEncoder().encode('hello noble');
 * const sig = p384.sign(msg, secretKey);
 * const isValid = p384.verify(sig, msg, publicKey);
 * ```
 */
const p384 = /* @__PURE__ */ ecdsa(p384_Point, sha384);
// NIST P521
// RFC 7518 fixes the canonical JWK/JOSE width at 66 bytes:
// - Section 3.4 says ECDSA octet strings must not omit leading zero octets
// - Sections 6.2.1.2/6.2.1.3 say P-521 coordinates "x"/"y" must be 66 octets
// - Section 6.2.2.1 says private scalar "d" must be ceil(log2(n)/8) octets, i.e. 66 for P-521
// NIST FIPS 186-5 Appendix A.3.3 also routes deterministic ECDSA private keys through Appendix
// B.2.3, whose Integer-to-Octet-String output has explicit fixed length L; for P-521 that is the
// same 66-byte order width.
// RFC 6979 matches that width too: private key x is an integer, while `int2octets(x)` uses
// rlen = 8 * ceil(qlen/8); for P-521, qlen = 521 so the canonical octet width is 66 bytes.
// Wycheproof ECDH stores private values as integers, not fixed-width scalar bytes, so it does not
// require a dedicated 65-byte parser path; the repo tests now normalize those integer fixtures to
// the canonical 66-byte width before use. There is no good standards or oracle reason to accept
// exactly 65 bytes here: the coherent choices are canonical 66 only, or a broader integer-style
// parser across many widths. Since this field parser is fixed-width, keep it canonical and use the
// default exact-66-byte scalar field path.
// A dedicated MersenneField primitive would allow speed-ups here: +40% getPublicKey, +23% sign,
// +53% verify, +53% getSharedSecret.
const p521_Point = /* @__PURE__ */ weierstrass(p521_CURVE);
/**
 * NIST P521 (aka secp521r1) curve, ECDSA and ECDH methods. Hashes inputs with sha512 by default.
 * Deterministic `keygen(seed)` expects 99 seed bytes here because the generic scalar-derivation
 * helper uses `getMinHashLength(n)`, not the 66-byte canonical secret-key width.
 * @example
 * Generate one P-521 keypair, sign a message, and verify it.
 *
 * ```ts
 * const { secretKey, publicKey } = p521.keygen();
 * const msg = new TextEncoder().encode('hello noble');
 * const sig = p521.sign(msg, secretKey);
 * const isValid = p521.verify(sig, msg, publicKey);
 * ```
 */
const p521 = /* @__PURE__ */ ecdsa(p521_Point, sha512);

/**
 * Twisted Edwards curve. The formula is: ax² + y² = 1 + dx²y².
 * For design rationale of types / exports, see weierstrass module documentation.
 * Untwisted Edwards curves exist, but they aren't used in real-world protocols.
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
// Be friendly to bad ECMAScript parsers by not using bigint literals
// prettier-ignore
const _0n$2 = /* @__PURE__ */ BigInt(0), _1n$2 = /* @__PURE__ */ BigInt(1), _2n$3 = /* @__PURE__ */ BigInt(2), _4n = /* @__PURE__ */ BigInt(4), _8n = /* @__PURE__ */ BigInt(8);
// Affine Edwards-equation check only; this does not prove subgroup membership, canonical
// encoding, prime-order base-point requirements, or identity exclusion.
function isEdValidXY(Fp, CURVE, x, y) {
    const x2 = Fp.sqr(x);
    const y2 = Fp.sqr(y);
    const left = Fp.add(Fp.mul(CURVE.a, x2), y2);
    const right = Fp.add(Fp.ONE, Fp.mul(CURVE.d, Fp.mul(x2, y2)));
    return Fp.eql(left, right);
}
/**
 * @param params - Curve parameters. See {@link EdwardsOpts}.
 * @param extraOpts - Optional helpers and overrides. See {@link EdwardsExtraOpts}.
 * @returns Edwards point constructor. Generator validation here only checks
 *   that `(Gx, Gy)` satisfies the affine Edwards equation.
 *   RFC 8032 base-point constraints like `B != (0,1)` and `[L]B = 0`
 *   are left to the caller's chosen parameters, since eager subgroup
 *   validation here adds about 10-15ms to heavyweight imports like ed448.
 *   The returned constructor also eagerly marks `Point.BASE` for W=6
 *   precompute caching. Some code paths still assume
 *   `Fp.BYTES === Fn.BYTES`, so mismatched byte lengths are not fully audited here.
 * @throws If the curve parameters or Edwards overrides are invalid. {@link Error}
 * @example
 * ```ts
 * import { edwards } from '@noble/curves/abstract/edwards.js';
 * import { jubjub } from '@noble/curves/misc.js';
 * // Build a point constructor from explicit curve parameters, then use its base point.
 * const Point = edwards(jubjub.Point.CURVE());
 * Point.BASE.toHex();
 * ```
 */
function edwards(params, extraOpts = {}) {
    validateObject(extraOpts, {}, {}, 'extraOpts');
    const opts = extraOpts;
    const validated = createCurveFields('edwards', params, opts, opts.FpFnLE);
    const { Fp, Fn } = validated;
    let CURVE = validated.CURVE;
    const { h: cofactor } = CURVE;
    // The unified add-2008-hwcd formulas (see EdwardsPoint.add/double) are complete —
    // exception-free for every input pair — only when a is a square and d a non-square in Fp
    // (Bernstein–Birkner–Joye–Lange–Peters, "Twisted Edwards curves", thm 3.3). The constant-time
    // kernels in curve.ts assume completeness, so an incomplete curve could silently produce
    // wrong results on exceptional inputs. Fail construction instead.
    if (FpLegendre(Fp, CURVE.a) !== 1)
        throw new Error('edwards: CURVE.a must be a square in Fp for complete addition formulas');
    if (FpLegendre(Fp, CURVE.d) !== -1)
        throw new Error('edwards: CURVE.d must be a non-square in Fp for complete addition formulas');
    validateObject(opts, {}, { uvRatio: 'function', randomBytes: 'function' });
    const randomBytes$1 = opts.randomBytes === undefined ? randomBytes : opts.randomBytes;
    // Coordinate and ZIP-215 bounds follow the base-field byte container, not scalar bytes.
    const MASK = _2n$3 << (BigInt(Fp.BYTES * 8) - _1n$2);
    function isOdd(n) {
        if (!Fp.isOdd)
            throw new Error('Field does not have .isOdd()');
        return Fp.isOdd(n);
    }
    // sqrt(u/v)
    const uvRatio = opts.uvRatio === undefined
        ? (u, v) => {
            try {
                return { isValid: true, value: Fp.sqrt(Fp.div(u, v)) };
            }
            catch (e) {
                return { isValid: false, value: _0n$2 };
            }
        }
        : opts.uvRatio;
    // Validate whether the passed curve params are valid.
    // equation ax² + y² = 1 + dx²y² should work for generator point.
    if (!isEdValidXY(Fp, CURVE, CURVE.Gx, CURVE.Gy))
        throw new Error('bad curve params: generator point');
    // Multiplication by param `a` sits on the double() / add() hot paths. For the common twists
    // a=-1 (ed25519, jubjub) and a=1 (ed448) the full field multiplication is replaced with
    // negation / identity. Selection depends only on public curve constants.
    const mulA = Fp.eql(CURVE.a, Fp.neg(Fp.ONE)) ? (x) => Fp.neg(x)
        : Fp.eql(CURVE.a, Fp.ONE) ? (x) => x
            : (x) => Fp.mul(CURVE.a, x); // prettier-ignore
    /**
     * Asserts coordinate is valid: 0 <= n < MASK.
     * Coordinates >= Fp.ORDER are allowed for zip215.
     */
    function acoord(title, n, banZero = false) {
        const min = banZero ? _1n$2 : _0n$2;
        aInRange('coordinate ' + title, n, min, MASK);
        return n;
    }
    function aedpoint(other) {
        if (!(other instanceof Point))
            throw new Error('EdwardsPoint expected');
    }
    // Extended Point works in extended coordinates: (X, Y, Z, T) ∋ (x=X/Z, y=Y/Z, T=xy).
    // https://en.wikipedia.org/wiki/Twisted_Edwards_curve#Extended_coordinates
    class Point {
        static BASE = new Point(CURVE.Gx, CURVE.Gy, Fp.ONE, Fp.mul(CURVE.Gx, CURVE.Gy));
        static ZERO = new Point(Fp.ZERO, Fp.ONE, Fp.ONE, Fp.ZERO);
        static Fp = Fp;
        static Fn = Fn;
        X;
        Y;
        Z;
        T;
        constructor(X, Y, Z, T) {
            this.X = acoord('x', X);
            this.Y = acoord('y', Y);
            this.Z = acoord('z', Z, true);
            this.T = acoord('t', T);
            Object.freeze(this);
        }
        static CURVE() {
            return CURVE;
        }
        /**
         * Create one extended Edwards point from affine coordinates.
         * Does NOT validate that the point is on-curve or torsion-free.
         * Use `.assertValidity()` on adversarial inputs.
         */
        static fromAffine(p) {
            if (p instanceof Point)
                throw new Error('extended point not allowed');
            const { x, y } = p || {};
            acoord('x', x);
            acoord('y', y);
            return new Point(x, y, Fp.ONE, Fp.mul(x, y));
        }
        // Uses algo from RFC8032 5.1.3.
        static fromBytes(bytes, zip215 = false) {
            const len = Fp.BYTES;
            const { a, d } = CURVE;
            bytes = copyBytes(abytes(bytes, len, 'point'));
            abool(zip215, 'zip215');
            const normed = copyBytes(bytes); // copy again, we'll manipulate it
            const lastByte = bytes[len - 1]; // select last byte
            normed[len - 1] = lastByte & -129; // clear last bit
            const y = bytesToNumberLE(normed);
            // zip215=true is good for consensus-critical apps. =false follows RFC8032 / NIST186-5.
            // RFC8032 prohibits >= p, but ZIP215 doesn't
            // zip215=true:  0 <= y < MASK (2^256 for ed25519)
            // zip215=false: 0 <= y < P (2^255-19 for ed25519)
            const max = zip215 ? MASK : Fp.ORDER;
            aInRange('point.y', y, _0n$2, max);
            // Ed25519: x² = (y²-1)/(dy²+1) mod p. Ed448: x² = (y²-1)/(dy²-1) mod p. Generic case:
            // ax²+y²=1+dx²y² => y²-1=dx²y²-ax² => y²-1=x²(dy²-a) => x²=(y²-1)/(dy²-a)
            const y2 = Fp.sqr(y); // denominator is always non-0 mod p.
            const u = Fp.sub(y2, Fp.ONE); // u = y² - 1
            const v = Fp.sub(Fp.mulN(d, y2), a); // v = d y² - a.
            let { isValid, value: x } = uvRatio(u, v); // √(u/v)
            if (!isValid)
                throw new Error('bad point: invalid y coordinate');
            const isXOdd = isOdd(x); // There are 2 square roots. Use x_0 bit to select proper
            const isLastByteOdd = (lastByte & 0x80) !== 0; // x_0, last bit
            if (!zip215 && Fp.is0(x) && isLastByteOdd)
                // if x=0 and x_0 = 1, fail
                throw new Error('bad point: x=0 and x_0=1');
            if (isLastByteOdd !== isXOdd)
                x = Fp.neg(x); // if x_0 != x mod 2, set x = p-x
            return Point.fromAffine({ x, y });
        }
        static fromHex(hex, zip215 = false) {
            return Point.fromBytes(hexToBytes(hex), zip215);
        }
        get x() {
            return this.toAffine().x;
        }
        get y() {
            return this.toAffine().y;
        }
        precompute(windowSize = 6, isLazy = true) {
            wnaf.setWindowSize(this, windowSize);
            if (!isLazy)
                this.multiply(_2n$3); // random number
            return this;
        }
        // Useful in fromAffine() - not for fromBytes(), which always created valid points.
        assertValidity() {
            const p = this;
            const { a, d } = CURVE;
            // Keep generic Edwards validation fail-closed on the neutral point.
            // Even though ZERO is algebraically valid and can roundtrip through encodings, higher-level
            // callers often reach it only through broken hash/scalar plumbing; rejecting it here avoids
            // silently treating that degenerate state as an ordinary public point.
            if (p.is0())
                throw new Error('bad point: ZERO'); // TODO: optimize, with vars below?
            // Equation in affine coordinates: ax² + y² = 1 + dx²y²
            // Equation in projective coordinates (X/Z, Y/Z, Z):  (aX² + Y²)Z² = Z⁴ + dX²Y²
            const { X, Y, Z, T } = p;
            const X2 = Fp.sqr(X); // X²
            const Y2 = Fp.sqr(Y); // Y²
            const Z2 = Fp.sqr(Z); // Z²
            const Z4 = Fp.sqr(Z2); // Z⁴
            const aX2 = Fp.mul(X2, a); // aX²
            const left = Fp.mul(Fp.add(aX2, Y2), Z2); // (aX² + Y²)Z²
            const right = Fp.add(Z4, Fp.mul(d, Fp.mul(X2, Y2))); // Z⁴ + dX²Y²
            if (!Fp.eql(left, right))
                throw new Error('bad point: equation left != right (1)');
            // In Extended coordinates we also have T, which is x*y=T/Z: check X*Y == Z*T
            const XY = Fp.mul(X, Y);
            const ZT = Fp.mul(Z, T);
            if (!Fp.eql(XY, ZT))
                throw new Error('bad point: equation left != right (2)');
        }
        // Compare one point to another.
        equals(other) {
            aedpoint(other);
            const { X: X1, Y: Y1, Z: Z1 } = this;
            const { X: X2, Y: Y2, Z: Z2 } = other;
            const X1Z2 = Fp.mul(X1, Z2);
            const X2Z1 = Fp.mul(X2, Z1);
            const Y1Z2 = Fp.mul(Y1, Z2);
            const Y2Z1 = Fp.mul(Y2, Z1);
            return Fp.eql(X1Z2, X2Z1) && Fp.eql(Y1Z2, Y2Z1);
        }
        is0() {
            return this.equals(Point.ZERO);
        }
        negate() {
            // Flips point sign to a negative one (-x, y in affine coords)
            return new Point(Fp.neg(this.X), this.Y, this.Z, Fp.neg(this.T));
        }
        // Fast algo for doubling Extended Point.
        // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#doubling-dbl-2008-hwcd
        // Cost: 4M + 4S + 1*a + 6add + 1*2.
        double() {
            const { X: X1, Y: Y1, Z: Z1 } = this;
            const A = Fp.sqr(X1); // A = X12
            const B = Fp.sqr(Y1); // B = Y12
            const C = Fp.mul(Fp.sqr(Z1), _2n$3); // C = 2*Z12
            const D = mulA(A); // D = a*A
            const x1y1 = Fp.addN(X1, Y1);
            const E = Fp.sub(Fp.subN(Fp.sqr(x1y1), A), B); // E = (X1+Y1)2-A-B
            const G = Fp.addN(D, B); // G = D+B
            const F = Fp.subN(G, C); // F = G-C
            const H = Fp.subN(D, B); // H = D-B
            const X3 = Fp.mul(E, F); // X3 = E*F
            const Y3 = Fp.mul(G, H); // Y3 = G*H
            const T3 = Fp.mul(E, H); // T3 = E*H
            const Z3 = Fp.mul(F, G); // Z3 = F*G
            return new Point(X3, Y3, Z3, T3);
        }
        // Fast algo for adding 2 Extended Points.
        // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#addition-add-2008-hwcd
        // Cost: 9M + 1*a + 1*d + 7add.
        add(other) {
            aedpoint(other);
            const { d } = CURVE;
            const { X: X1, Y: Y1, Z: Z1, T: T1 } = this;
            const { X: X2, Y: Y2, Z: Z2, T: T2 } = other;
            const A = Fp.mul(X1, X2); // A = X1*X2
            const B = Fp.mul(Y1, Y2); // B = Y1*Y2
            const C = Fp.mul(Fp.mulN(T1, d), T2); // C = T1*d*T2
            const D = Fp.mul(Z1, Z2); // D = Z1*Z2
            // E = (X1+Y1)*(X2+Y2)-A-B
            const E = Fp.sub(Fp.subN(Fp.mulN(Fp.addN(X1, Y1), Fp.addN(X2, Y2)), A), B);
            const F = Fp.subN(D, C); // F = D-C
            const G = Fp.addN(D, C); // G = D+C
            const H = Fp.sub(B, mulA(A)); // H = B-a*A
            const X3 = Fp.mul(E, F); // X3 = E*F
            const Y3 = Fp.mul(G, H); // Y3 = G*H
            const T3 = Fp.mul(E, H); // T3 = E*H
            const Z3 = Fp.mul(F, G); // Z3 = F*G
            return new Point(X3, Y3, Z3, T3);
        }
        subtract(other) {
            // Validate before calling `negate()` so wrong inputs fail with the point guard
            // instead of leaking a foreign `negate()` error.
            aedpoint(other);
            return this.add(other.negate());
        }
        // Constant-time multiplication.
        multiply(scalar) {
            // 1 <= scalar < L
            // Keep the subgroup-scalar contract strict instead of reducing 0 / n to ZERO.
            // In keygen/signing-style callers, those values usually mean broken hash/scalar plumbing,
            // and failing closed is safer than silently producing the identity point.
            if (!Fn.isValidNot0(scalar))
                throw new RangeError('invalid scalar: expected 1 <= sc < curve.n');
            const { p, f } = wnaf.mulSecret(this, scalar, cofactor, normalize);
            return normalize([p, f])[0];
        }
        // Non-constant-time multiplication. Uses double-and-add algorithm.
        // It's faster, but should only be used when you don't care about
        // an exposed private key e.g. sig verification.
        // Keeps the same subgroup-scalar contract: 0 is allowed for public-scalar callers, but
        // n and larger values are rejected instead of being reduced mod n to the identity point.
        multiplyUnsafe(scalar) {
            // 0 <= scalar < L
            if (!Fn.isValid(scalar))
                throw new RangeError('invalid scalar: expected 0 <= sc < curve.n');
            if (scalar === _0n$2)
                return Point.ZERO;
            if (this.is0() || scalar === _1n$2)
                return this;
            return wnaf.mulUnsafe(this, scalar, normalize);
        }
        // Checks if point is of small order.
        // If you add something to small order point, you will have "dirty"
        // point with torsion component.
        // Clears cofactor and checks if the result is 0.
        isSmallOrder() {
            return this.clearCofactor().is0();
        }
        // Multiplies point by curve order and checks if the result is 0.
        // Returns `false` is the point is dirty.
        isTorsionFree() {
            return wnaf.mulUnsafe(this, CURVE.n).is0();
        }
        // Converts Extended point to default (x, y) coordinates.
        // Can accept precomputed Z^-1 - for example, from invertBatch.
        toAffine(invertedZ) {
            const p = this;
            let iz = invertedZ;
            if (iz != null && typeof iz !== 'bigint')
                throw new TypeError('"invertedZ" expected bigint, got type=' + typeof iz);
            const { X, Y, Z } = p;
            const is0 = p.is0();
            if (iz == null)
                iz = is0 ? Fp.create(_8n) : Fp.inv(Z);
            const x = Fp.mul(X, iz);
            const y = Fp.mul(Y, iz);
            const zz = Fp.mul(Z, iz);
            if (is0)
                return { x: Fp.ZERO, y: Fp.ONE };
            if (!Fp.eql(zz, Fp.ONE))
                throw new Error('invZ was invalid');
            return { x, y };
        }
        clearCofactor() {
            if (cofactor === _1n$2)
                return this;
            // 2.8-3.8x speed-up vs naive
            if (cofactor === _2n$3)
                return this.double();
            if (cofactor === _4n)
                return this.double().double();
            if (cofactor === _8n)
                return this.double().double().double();
            return this.multiplyUnsafe(cofactor);
        }
        toBytes() {
            const { x, y } = this.toAffine();
            // Fp.toBytes() allows non-canonical encoding of y (>= p).
            const bytes = Fp.toBytes(y);
            // Each y has 2 valid points: (x, y), (x,-y).
            // When compressing, it's enough to store y and use the last byte to encode sign of x
            bytes[bytes.length - 1] |= isOdd(x) ? 0x80 : 0;
            return bytes;
        }
        toHex() {
            return bytesToHex(this.toBytes());
        }
        toString() {
            return `<Point ${this.is0() ? 'ZERO' : this.toHex()}>`;
        }
    }
    // Keep constructor work cheap: subgroup/generator validation belongs to the caller's curve
    // parameters, and doing the extra checks here adds about 10-15ms to heavy module imports.
    // Callers that construct custom curves are responsible for supplying the correct base point.
    // try {
    //   Point.BASE.assertValidity();
    //   if (!Point.BASE.isTorsionFree()) throw new Error('bad point: not in prime-order subgroup');
    // } catch {
    //   throw new Error('bad curve params: generator point');
    // }
    const normalize = (points) => normalizeZ(Point, points);
    const wnaf = new ScalarMultiplier(Point, randomBytes$1);
    // Enable W=6 wNAF precomputes. Slows down first publicKey computation.
    // Disable for tiny toy curves, with scalar fields < 6 bits.
    if (wnaf.bits >= 6)
        Point.BASE.precompute(6);
    Object.freeze(Point.prototype);
    Object.freeze(Point);
    return Point;
}
/**
 * Initializes EdDSA signatures over given Edwards curve.
 * @param Point - Edwards point constructor.
 * @param cHash - Hash function.
 * @param eddsaOpts - Optional signature helpers. See {@link EdDSAOpts}.
 * @returns EdDSA helper namespace.
 * @throws If the hash function, options, or derived point operations are invalid. {@link Error}
 * @example
 * Initializes EdDSA signatures over given Edwards curve.
 *
 * ```ts
 * import { eddsa } from '@noble/curves/abstract/edwards.js';
 * import { jubjub } from '@noble/curves/misc.js';
 * import { sha512 } from '@noble/hashes/sha2.js';
 * const sigs = eddsa(jubjub.Point, sha512);
 * const { secretKey, publicKey } = sigs.keygen();
 * const msg = new TextEncoder().encode('hello noble');
 * const sig = sigs.sign(msg, secretKey);
 * const isValid = sigs.verify(sig, msg, publicKey);
 * ```
 */
function eddsa(Point, cHash, eddsaOpts = {}) {
    validatePointCons(Point);
    if (typeof cHash !== 'function')
        throw new Error('"hash" function param is required');
    const hash = cHash;
    const opts = eddsaOpts;
    validateObject(opts, {}, {
        adjustScalarBytes: 'function',
        randomBytes: 'function',
        domain: 'function',
        prehash: 'function',
        zip215: 'boolean',
        mapToCurve: 'function',
        toMontgomery: 'function',
        toMontgomerySecret: 'function',
    });
    const { prehash } = opts;
    const { BASE, Fp, Fn } = Point;
    const outputLen = hash.outputLen;
    const expectedLen = 2 * Fp.BYTES;
    // When hash metadata is available, reject incompatible EdDSA wrappers at construction time
    // instead of deferring the mismatch until the first keygen/sign call.
    if (outputLen !== undefined) {
        asafenumber(outputLen, 'hash.outputLen');
        if (outputLen !== expectedLen)
            throw new Error(`hash.outputLen must be ${expectedLen}, got ${outputLen}`);
    }
    const randomBytes$1 = opts.randomBytes === undefined ? randomBytes : opts.randomBytes;
    const toMontgomery = opts.toMontgomery;
    const toMontgomerySecret = opts.toMontgomerySecret;
    const adjustScalarBytes = opts.adjustScalarBytes === undefined
        ? (bytes) => bytes
        : opts.adjustScalarBytes;
    const domain = opts.domain === undefined
        ? (data, ctx, phflag) => {
            abool(phflag, 'phflag');
            if (ctx.length || phflag)
                throw new Error('Contexts/pre-hash are not supported');
            return data;
        }
        : opts.domain; // NOOP
    // Parse an EdDSA digest as a little-endian integer and reduce it modulo the scalar field order.
    function modN_LE(hash) {
        return Fn.create(bytesToNumberLE(hash)); // Not Fn.fromBytes: it has length limit
    }
    // Get the hashed private scalar per RFC8032 5.1.5
    function getPrivateScalar(key) {
        const len = lengths.secretKey;
        abytes(key, lengths.secretKey, 'secretKey');
        // Hash private key with curve's hash function to produce uniformingly random input
        // Check byte lengths: ensure(64, h(ensure(32, key)))
        const hashed = abytes(hash(key), 2 * len, 'hashedSecretKey');
        // Slice before clamping so in-place adjustors don't corrupt the prefix half.
        const head = adjustScalarBytes(hashed.slice(0, len)); // clear first half bits, produce FE
        const prefix = hashed.slice(len, 2 * len); // second half is called key prefix (5.1.6)
        const scalar = modN_LE(head); // The actual private scalar
        return { head, prefix, scalar };
    }
    /** Convenience method that creates public key from scalar. RFC8032 5.1.5
     * Also exposes the derived scalar/prefix tuple and point form reused by sign().
     */
    function getExtendedPublicKey(secretKey) {
        const { head, prefix, scalar } = getPrivateScalar(secretKey);
        const point = BASE.multiply(scalar); // Point on Edwards curve aka public key
        const pointBytes = point.toBytes();
        return { head, prefix, scalar, point, pointBytes };
    }
    /** Calculates EdDSA pub key. RFC8032 5.1.5. */
    function getPublicKey(secretKey) {
        return getExtendedPublicKey(secretKey).pointBytes;
    }
    // Hash domain-separated chunks into a little-endian scalar modulo the group order.
    function hashDomainToScalar(context = Uint8Array.of(), ...msgs) {
        const msg = concatBytes(...msgs);
        return modN_LE(hash(domain(msg, abytes(context, undefined, 'context'), !!prehash)));
    }
    /** Signs message with secret key. RFC8032 5.1.6 */
    function sign(msg, secretKey, options = {}) {
        validateObject(options, {}, {}, 'options');
        // Snapshot once: nonce and challenge must use the same invocation-time message bytes.
        msg = copyBytes(abytes(msg, undefined, 'message'));
        if (prehash)
            msg = prehash(msg); // for ed25519ph etc.
        const { prefix, scalar, pointBytes } = getExtendedPublicKey(secretKey);
        const r = hashDomainToScalar(options.context, prefix, msg); // r = dom2(F, C) || prefix || PH(M)
        // RFC 8032 5.1.6 allows r mod L = 0, and SUPERCOP ref10 accepts the resulting identity-point
        // signature.
        // We intentionally keep the safe multiply() rejection here so a miswired all-zero hash provider
        // fails loudly instead of silently producing a degenerate signature.
        const R = BASE.multiply(r).toBytes(); // R = rG
        const k = hashDomainToScalar(options.context, R, pointBytes, msg); // R || A || PH(M)
        const s = Fn.create(r + k * scalar); // S = (r + k * s) mod L
        if (!Fn.isValid(s))
            throw new Error('sign failed: invalid s'); // 0 <= s < L
        const rs = concatBytes(R, Fn.toBytes(s));
        return abytes(rs, lengths.signature, 'result');
    }
    // Keep the shared helper strict by default: RFC 8032 / NIST-style wrappers should reject
    // non-canonical encodings unless they explicitly opt into ZIP-215's more permissive decode rules.
    const verifyOpts = {
        zip215: opts.zip215,
    };
    /**
     * Verifies EdDSA signature against message and public key. RFC 8032 §§5.1.7 and 5.2.7.
     * A cofactored verification equation is checked.
     */
    function verify(sig, msg, publicKey, options = verifyOpts) {
        // Validate before destructuring so explicit null follows the standard options error.
        validateObject(options);
        // Preserve the wrapper-selected default for `{}` / `{ zip215: undefined }`, not just omitted opts.
        const { context } = options;
        const zip215 = options.zip215 === undefined ? !!verifyOpts.zip215 : options.zip215;
        const len = lengths.signature;
        sig = abytes(sig, len, 'signature');
        msg = abytes(msg, undefined, 'message');
        publicKey = abytes(publicKey, lengths.publicKey, 'publicKey');
        if (zip215 !== undefined)
            abool(zip215, 'zip215');
        if (prehash)
            msg = prehash(msg); // for ed25519ph, etc
        const mid = len / 2;
        const r = sig.subarray(0, mid);
        const s = bytesToNumberLE(sig.subarray(mid, len));
        let A, R, SB;
        try {
            // ZIP-215 is more permissive than RFC 8032 / NIST186-5. Use it only for wrappers that
            // explicitly want consensus-style unreduced encoding acceptance.
            // zip215=true:  0 <= y < MASK (2^256 for ed25519)
            // zip215=false: 0 <= y < P (2^255-19 for ed25519)
            A = Point.fromBytes(publicKey, zip215);
            R = Point.fromBytes(r, zip215);
            SB = BASE.multiplyUnsafe(s); // 0 <= s < l is done inside
        }
        catch (error) {
            return false;
        }
        // RFC 8032 §§5.1.7/5.2.7 and FIPS 186-5 §§7.7.2/7.8.2 only decode A' and check the cofactored
        // verification equation; they do not add a separate low-order-public-key rejection here.
        // Strict mode still rejects small-order A' intentionally for SBS-style non-repudiation and to
        // avoid ambiguous verification outcomes where unusual low-order keys can make distinct
        // key/signature/message combinations verify.
        if (!zip215 && A.isSmallOrder())
            return false;
        // ZIP-215 accepts noncanonical / unreduced point encodings, so the challenge hash must use the
        // exact signature/public-key bytes rather than canonicalized re-encodings of the decoded points.
        const k = hashDomainToScalar(context, r, publicKey, msg);
        const RkA = R.add(A.multiplyUnsafe(k));
        // Check the cofactored verification equation via the curve cofactor h.
        // [h][S]B = [h]R + [h][k]A'
        return RkA.subtract(SB).clearCofactor().is0();
    }
    const _size = Fp.BYTES; // 32 for ed25519, 57 for ed448
    const lengths = {
        secretKey: _size,
        publicKey: _size,
        signature: 2 * _size,
        seed: _size,
    };
    function randomSecretKey(seed) {
        seed = seed === undefined ? randomBytes$1(lengths.seed) : seed;
        return abytes(seed, lengths.seed, 'seed');
    }
    function isValidSecretKey(key) {
        return isBytes(key) && key.length === lengths.secretKey;
    }
    function isValidPublicKey(key, zip215) {
        try {
            // Preserve the wrapper-selected default for omitted / `undefined` ZIP-215 flags here too.
            return !!Point.fromBytes(key, zip215 === undefined ? verifyOpts.zip215 : zip215);
        }
        catch (error) {
            return false;
        }
    }
    const utils = {
        getExtendedPublicKey,
        randomSecretKey,
        isValidSecretKey,
        isValidPublicKey,
        /** Converts an Edwards public key to a companion Montgomery public key. */
        toMontgomery(publicKey) {
            if (toMontgomery === undefined)
                throw new Error('Montgomery conversion is not supported for this curve');
            return toMontgomery(Point.fromBytes(publicKey));
        },
        toMontgomerySecret(secretKey) {
            if (toMontgomerySecret === undefined)
                throw new Error('Montgomery conversion is not supported for this curve');
            return toMontgomerySecret(secretKey);
        },
    };
    Object.freeze(lengths);
    Object.freeze(utils);
    return Object.freeze({
        keygen: createKeygen(randomSecretKey, getPublicKey),
        getPublicKey,
        sign,
        verify,
        utils,
        Point,
        lengths,
    });
}

/**
 * Montgomery curve methods. It's not really whole montgomery curve,
 * just bunch of very specific methods for X25519 / X448 from
 * [RFC 7748](https://www.rfc-editor.org/rfc/rfc7748)
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const _0n$1 = /* @__PURE__ */ BigInt(0);
const _1n$1 = /* @__PURE__ */ BigInt(1);
const _2n$2 = /* @__PURE__ */ BigInt(2);
// cswap from RFC7748 "example code", adapted to BigInt.
//
// RFC: "dummy = mask(swap) AND (x_2 XOR x_3), where mask(swap) is the all-1 or all-0 word of the
// same length as x_2 and x_3". On fixed-width machine words both cases cost the same. BigInt has
// no fixed width, so a {0n, 1n} selector does not: V8 short-circuits `0n * v` - and, identically,
// `0n & v`, `v + 0n`, `v - 0n` - to a no-op, while `1n * v` is a real multiply. The ladder calls
// this with swap = k_t XOR k_(t+1), which would make total running time a linear function of how
// often adjacent bits of the secret scalar differ: remotely measurable, and worth ~4 bits of a
// long-term key.
//
// So select with a full-width mask instead, and interpolate rather than mask off a dummy.
/**
 * Selector for cswap(): `P` to keep, `P + 1` to swap, chosen by the low bit of `swap`.
 * Higher bits are ignored, and `swap` is passed in whole rather than as a {0n, 1n} bit on
 * purpose: `P + (swap & _1n)` would short-circuit the addition whenever the bit is clear, which
 * is the very leak this construction avoids, one round-trip further down. Subtracting `swap`
 * with its low bit cleared keeps every operand full-width instead.
 * @param P - Field modulus.
 * @param swap - Value whose low bit selects; ignored above that bit.
 * @returns `P` when the low bit is clear, `P + 1` when it is set.
 */
function cmask(P, swap) {
    return P + swap - ((swap >> _1n$1) << _1n$1);
}
/**
 * Swap two field elements when `mask` is `P + 1`, keep them when it is `P`:
 *
 *   d    = 6P + x_3 - x_2
 *   x_2' = d * mask + x_2   (mod P)      x_3' = (x_2 + x_3) - x_2'
 *
 * The extra `6P * mask` vanishes modulo P, so `mask === P` leaves x_2 and `mask === P + 1`
 * leaves x_3. Without the offset, the reduction dividend changes sign with input order and crosses
 * BigInt limb boundaries; those classes measured differently on the tested Node/V8 build. For
 * canonical inputs, the deliberately left-associative `offset + x_3 - x_2` is between 5P and 7P,
 * keeping the dividend positive and in one word-count band for both RFC fields and masks. Six is
 * the smallest coefficient `c` for which the shared offset `cP` has that property.
 *
 * This reduced the tested sign/size timing ratios, but JavaScript BigInt has no constant-time
 * contract and the contents of the multiply and remainder still vary. Valid ladder states can
 * contain genuine zero coordinates; this construction does not mask those value-shape effects.
 * Computing `x_3'` independently as `((6P + x_2 - x_3) * mask + x_3) % P` is more symmetric.
 * On the tested Node/V8 build, it reduced the timing difference between keeping `(0, v)` and
 * swapping `(v, 0)`—both return `(0, v)`—from about 10%/13% for X25519/X448 to about 3%.
 * Successful calls cannot reach that zero-in-the-first-output case. For the case they can reach,
 * swapping `(0, v)` and keeping `(v, 0)` both return `(v, 0)`; the difference instead grew from
 * about 0.7%/1.1% to 2.7%/2.8%. The extra multiply/remainder also made public
 * `getSharedSecret()` about 16% slower. The retained one-remainder form measured about 2.5%
 * slower than the prior helper for public X25519 `getSharedSecret()` in the same environment.
 * x_3' falls out of the sum, which a swap leaves invariant: no second multiply or reduction is
 * needed. Bind `6P` once per field so production and the timing regression exercise the same
 * configured helper without paying for the multiplication in every ladder round.
 *
 * The returned function is called twice per ladder round, so it validates nothing. Both elements
 * MUST already be reduced mod P; unreduced input silently corrupts the kept-side output.
 * @param P - Field modulus.
 * @returns A field-bound swap function taking mask, x_2, and x_3.
 */
function cswap(P) {
    const offset = BigInt(6) * P;
    return (mask, x_2, x_3) => {
        const sum = x_2 + x_3;
        const d = offset + x_3 - x_2;
        const a = (d * mask + x_2) % P;
        return { x_2: a, x_3: sum - a };
    };
}
function validateOpts(curve) {
    // Validate constructor config eagerly, but do not call user-provided hooks here:
    // `randomBytes` may be transcript-backed or otherwise contextual. Runtime type checks are
    // enough to fail fast on malformed configs without consuming user state.
    validateObject(curve, {
        P: 'bigint',
        type: 'string',
        adjustScalarBytes: 'function',
        powPminus2: 'function',
    }, {
        randomBytes: 'function',
        scalarMultBase: 'function',
    });
    return Object.freeze({ ...curve });
}
/**
 * @param curveDef - Montgomery curve definition.
 * @returns ECDH helper namespace.
 * @throws If the curve definition or derived shared point is invalid. {@link Error}
 * @example
 * Build an X25519 helper from curve parameters, then derive one public key.
 *
 * ```ts
 * import { montgomery } from '@noble/curves/abstract/montgomery.js';
 * const P = 2n ** 255n - 19n;
 * const mod = (num: bigint) => {
 *   const out = num % P;
 *   return out >= 0n ? out : out + P;
 * };
 * const pow = (num: bigint, power: bigint) => {
 *   let res = 1n;
 *   for (; power > 0n; power >>= 1n) {
 *     if (power & 1n) res = mod(res * num);
 *     num = mod(num * num);
 *   }
 *   return res;
 * };
 * const x25519 = montgomery({
 *   P,
 *   type: 'x25519',
 *   adjustScalarBytes(bytes: Uint8Array) {
 *     bytes[0] &= 248;
 *     bytes[31] &= 127;
 *     bytes[31] |= 64;
 *     return bytes;
 *   },
 *   powPminus2(x) {
 *     return pow(x, P - 2n);
 *   },
 * });
 * const publicKey = x25519.getPublicKey(new Uint8Array(32).fill(1));
 * ```
 */
function montgomery(curveDef) {
    const CURVE = validateOpts(curveDef);
    const { P, type, adjustScalarBytes, powPminus2, randomBytes: rand } = CURVE;
    const mulBaseHook = CURVE.scalarMultBase;
    const is25519 = type === 'x25519';
    if (!is25519 && type !== 'x448')
        throw new Error('invalid type');
    const randomBytes_ = rand === undefined ? randomBytes : rand;
    const montgomeryBits = is25519 ? 255 : 448;
    const swap = cswap(P);
    const fieldLen = is25519 ? 32 : 56;
    const Gu = is25519 ? BigInt(9) : BigInt(5);
    // RFC 7748 #5:
    // The constant a24 is (486662 - 2) / 4 = 121665 for curve25519/X25519 and
    // (156326 - 2) / 4 = 39081 for curve448/X448
    // const a = is25519 ? 486662n : 156326n;
    const a24 = is25519 ? BigInt(121665) : BigInt(39081);
    // RFC: x25519 "the resulting integer is of the form 2^254 plus
    // eight times a value between 0 and 2^251 - 1 (inclusive)"
    // x448: "2^447 plus four times a value between 0 and 2^445 - 1 (inclusive)"
    const minScalar = is25519 ? _2n$2 ** BigInt(254) : _2n$2 ** BigInt(447);
    const maxAdded = is25519
        ? BigInt(8) * (_2n$2 ** BigInt(251) - _1n$1)
        : BigInt(4) * (_2n$2 ** BigInt(445) - _1n$1);
    const maxScalar = minScalar + maxAdded + _1n$1; // (inclusive)
    const modP = (n) => mod(n, P);
    const GuBytes = encodeU(Gu);
    function encodeU(u) {
        return numberToBytesLE(modP(u), fieldLen);
    }
    function decodeU(u) {
        const _u = copyBytes(abytes(u, fieldLen, 'uCoordinate'));
        // RFC: When receiving such an array, implementations of X25519
        // (but not X448) MUST mask the most significant bit in the final byte.
        if (is25519)
            _u[31] &= 127; // 0b0111_1111
        // RFC: Implementations MUST accept non-canonical values and process them as
        // if they had been reduced modulo the field prime.  The non-canonical
        // values are 2^255 - 19 through 2^255 - 1 for X25519 and 2^448 - 2^224
        // - 1 through 2^448 - 1 for X448.
        return modP(bytesToNumberLE(_u));
    }
    function decodeScalar(scalar) {
        return bytesToNumberLE(adjustScalarBytes(copyBytes(abytes(scalar, fieldLen, 'scalar'))));
    }
    /**
     * u coordinates whose order divides the cofactor, on the curve and on its quadratic twist -
     * the ladder sends every one of them to zero. Same blocklist libsodium and post-CVE-2017-0379
     * Libgcrypt carry. decodeU() reduces mod P first, so the non-canonical encodings P and P + 1
     * collapse onto 0 and 1, and `type` admits no curve beyond these two, so both lists are total.
     *
     * Complete by construction: x-only doubling sends u to (u^2 - 1)^2 / 4u(u^2 + a*u + 1). Order 4
     * therefore needs (u^2 - 1)^2 === 0, i.e. u = +-1; order 2 needs u(u^2 + a*u + 1) === 0, and
     * a^2 - 4 is a non-residue on both curves, leaving u = 0. curve448 stops there (cofactor 4);
     * curve25519 (cofactor 8) adds the two order-8 roots below. Cross-checked by clearing the
     * cofactor with those same doublings over 200k random u: no sixth value exists.
     */
    const lowOrderU = new Set(is25519
        ? [
            _0n$1,
            _1n$1,
            P - _1n$1,
            BigInt('325606250916557431795983626356110631294008115727848805560023387167927233504'),
            BigInt('39382357235489614581723060781553021112529911719440698176882885853963445705823'),
        ]
        : [_0n$1, _1n$1, P - _1n$1]);
    function scalarMult(scalar, u) {
        // Some public keys are useless, of low-order. Curve author doesn't think
        // it needs to be validated, but we do it nonetheless.
        // https://cr.yp.to/ecdh.html#validate
        //
        // Reject them BEFORE the ladder. RFC 7748 #6.1 also permits detecting them from the
        // all-zero output, but that first runs all 255 rounds against the long-term secret,
        // handing an unauthenticated attacker a free timing oracle. Low-order inputs also drive
        // the ladder into a degenerate state (x_2 + z_2 === 0) whose extra zero-operand
        // multiplications amplify any residual key-dependent timing.
        const pointU = decodeU(u);
        if (lowOrderU.has(pointU))
            throw new Error('invalid private or public key received');
        const pu = montgomeryLadder(pointU, decodeScalar(scalar));
        // Unreachable for RFC 7748 clamped scalars, which are cofactor multiples smaller than the
        // group order; kept because adjustScalarBytes is caller-supplied.
        if (pu === _0n$1)
            throw new Error('invalid private or public key received');
        return encodeU(pu);
    }
    // Computes public key from private. By doing scalar multiplication of base point.
    // With a curve-provided fixed-base hook (Edwards tables), the ladder is skipped, but the
    // contract — scalar validation, low-order rejection, encoding — stays identical.
    function scalarMultBase(scalar) {
        if (mulBaseHook === undefined)
            return scalarMult(scalar, GuBytes);
        const k = decodeScalar(scalar);
        aInRange('scalar', k, minScalar, maxScalar);
        const pu = modP(mulBaseHook(k));
        if (pu === _0n$1)
            throw new Error('invalid private or public key received');
        return encodeU(pu);
    }
    const getPublicKey = scalarMultBase;
    const getSharedSecret = scalarMult;
    /**
     * Montgomery x-only multiplication ladder for the selected X25519/X448 curve.
     * @param pointU - decoded Montgomery u coordinate for the selected curve
     * @param scalar - decoded clamped scalar by which the point is multiplied
     * @returns resulting Montgomery u coordinate for the selected curve
     */
    function montgomeryLadder(u, scalar) {
        aInRange('u', u, _0n$1, P);
        aInRange('scalar', scalar, minScalar, maxScalar);
        const k = scalar;
        const x_1 = u;
        let x_2 = _1n$1;
        let z_2 = _0n$1;
        let x_3 = u;
        let z_3 = _1n$1;
        // The RFC tracks `swap` across rounds to hold k_t XOR k_(t+1); the low bit of `kx >> t` is
        // the same value, without the carried state. aInRange above pins bit (montgomeryBits - 1)
        // of k set and everything above it clear, so `kx >> t` is never zero and its width is a
        // function of t alone - never of a secret bit.
        const kx = k ^ (k >> _1n$1);
        for (let t = BigInt(montgomeryBits - 1); t >= _0n$1; t--) {
            const mask = cmask(P, kx >> t);
            ({ x_2, x_3 } = swap(mask, x_2, x_3));
            ({ x_2: z_2, x_3: z_3 } = swap(mask, z_2, z_3));
            const A = x_2 + z_2;
            const AA = modP(A * A);
            const B = x_2 - z_2;
            const BB = modP(B * B);
            const E = AA - BB;
            const C = x_3 + z_3;
            const D = x_3 - z_3;
            const DA = modP(D * A);
            const CB = modP(C * B);
            const dacb = DA + CB;
            const da_cb = DA - CB;
            x_3 = modP(dacb * dacb);
            z_3 = modP(x_1 * modP(da_cb * da_cb));
            x_2 = modP(AA * BB);
            z_2 = modP(E * (AA + modP(a24 * E)));
        }
        // trailing cswap: the RFC's `swap` holds k_0 here, which is the low bit of k
        const mask = cmask(P, k);
        ({ x_2, x_3 } = swap(mask, x_2, x_3));
        ({ x_2: z_2, x_3: z_3 } = swap(mask, z_2, z_3));
        const z2 = powPminus2(z_2); // `Fp.pow(x, P - _2n)` is much slower equivalent
        return modP(x_2 * z2); // Return x_2 * (z_2^(p - 2))
    }
    const lengths = {
        secretKey: fieldLen,
        publicKey: fieldLen,
        seed: fieldLen,
    };
    const randomSecretKey = (seed) => {
        seed = seed === undefined ? randomBytes_(fieldLen) : seed;
        abytes(seed, lengths.seed, 'seed');
        // Reuse caller-supplied seed bytes verbatim; clamping is deferred until
        // decodeScalar(...) when the secret key is actually used.
        return seed;
    };
    const utils = { randomSecretKey };
    Object.freeze(lengths);
    Object.freeze(utils);
    return Object.freeze({
        keygen: createKeygen(randomSecretKey, getPublicKey),
        getSharedSecret,
        getPublicKey,
        scalarMult,
        scalarMultBase,
        utils,
        GuBytes: GuBytes.slice(),
        lengths,
    });
}

/**
 * Edwards448 (also called Goldilocks) curve with following addons:
 * - X448 ECDH
 * - Decaf cofactor elimination
 * - Elligator hash-to-group / point indistinguishability
 * Conforms to RFC 8032 https://www.rfc-editor.org/rfc/rfc8032.html#section-5.2
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
// edwards448 curve
// a = 1n
// d = Fp.neg(39081n)
// Finite field 2n**448n - 2n**224n - 1n
// Subgroup order
// 2n**446n - 13818066809895115352007386748515426880336692474882178609894547503885n
const ed448_CURVE_p = /* @__PURE__ */ BigInt('0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
const ed448_CURVE = /* @__PURE__ */ (() => ({
    p: ed448_CURVE_p,
    n: BigInt('0x3fffffffffffffffffffffffffffffffffffffffffffffffffffffff7cca23e9c44edb49aed63690216cc2728dc58f552378c292ab5844f3'),
    h: BigInt(4),
    a: BigInt(1),
    d: BigInt('0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffffffffffffffffffffffffffffffffffffffffffffffff6756'),
    Gx: BigInt('0x4f1970c66bed0ded221d15a622bf36da9e146570470f1767ea6de324a3d3a46412ae1af72ab66511433b80e18b00938e2626a82bc70cc05e'),
    Gy: BigInt('0x693f46716eb6bc248876203756c9c7624bea73736ca3984087789c1e05a0c2d73ad3ff1ce67c39c4fdbd132c4ed7c8ad9808795bf230fa14'),
}))();
const shake256_114 = /* @__PURE__ */ createHasher(() => shake256.create({ dkLen: 114 }));
// prettier-ignore
const _0n = /* @__PURE__ */ BigInt(0), _1n = /* @__PURE__ */ BigInt(1), _2n$1 = /* @__PURE__ */ BigInt(2), _3n = /* @__PURE__ */ BigInt(3), _11n = /* @__PURE__ */ BigInt(11);
// prettier-ignore
const _22n = /* @__PURE__ */ BigInt(22), _44n = /* @__PURE__ */ BigInt(44), _88n = /* @__PURE__ */ BigInt(88), _223n = /* @__PURE__ */ BigInt(223);
// powPminus3div4 calculates z = x^k mod p, where k = (p-3)/4.
// Used for efficient square root calculation.
// ((P-3)/4).toString(2) would produce bits [223x 1, 0, 222x 1]
function ed448_pow_Pminus3div4(x) {
    const P = ed448_CURVE_p;
    const b2 = (x * x * x) % P;
    const b3 = (b2 * b2 * x) % P;
    const b6 = (pow2(b3, _3n, P) * b3) % P;
    const b9 = (pow2(b6, _3n, P) * b3) % P;
    const b11 = (pow2(b9, _2n$1, P) * b2) % P;
    const b22 = (pow2(b11, _11n, P) * b11) % P;
    const b44 = (pow2(b22, _22n, P) * b22) % P;
    const b88 = (pow2(b44, _44n, P) * b44) % P;
    const b176 = (pow2(b88, _88n, P) * b88) % P;
    const b220 = (pow2(b176, _44n, P) * b44) % P;
    const b222 = (pow2(b220, _2n$1, P) * b2) % P;
    const b223 = (pow2(b222, _1n, P) * x) % P;
    return (pow2(b223, _223n, P) * b222) % P;
}
// Mutates and returns the provided buffer in place. The final `bytes[56] = 0`
// write is the Ed448 path; for 56-byte X448 inputs it is an out-of-bounds no-op.
function adjustScalarBytes(bytes) {
    // Section 5: Likewise, for X448, set the two least significant bits of the first byte to 0,
    bytes[0] &= 252; // 0b11111100
    // and the most significant bit of the last byte to 1.
    bytes[55] |= 128; // 0b10000000
    // NOTE: is NOOP for 56 bytes scalars (X25519/X448)
    bytes[56] = 0; // Byte outside of group (456 buts vs 448 bits)
    return bytes;
}
// Constant-time Ed448 decode helper for RFC 8032 §5.2.3 steps 2-3. Unlike
// `SQRT_RATIO_M1`, the returned `value` only has the documented meaning when
// `isValid` is true.
function uvRatio(u, v) {
    const P = ed448_CURVE_p;
    // https://www.rfc-editor.org/rfc/rfc8032#section-5.2.3
    // To compute the square root of (u/v), the first step is to compute the
    //   candidate root x = (u/v)^((p+1)/4).  This can be done using the
    // following trick, to use a single modular powering for both the
    // inversion of v and the square root:
    // x = (u/v)^((p+1)/4)   = u³v(u⁵v³)^((p-3)/4)   (mod p)
    const u2v = mod(u * u * v, P); // u²v
    const u3v = mod(u2v * u, P); // u³v
    const u5v3 = mod(u3v * u2v * v, P); // u⁵v³
    const root = ed448_pow_Pminus3div4(u5v3);
    const x = mod(u3v * root, P);
    // Verify that root is exists
    const x2 = mod(x * x, P); // x²
    // If vx² = u, the recovered x-coordinate is x.  Otherwise, no
    // square root exists, and the decoding fails.
    return { isValid: mod(x2 * v, P) === u, value: x };
}
// Finite field 2n**448n - 2n**224n - 1n
// RFC 8032 encodes Ed448 field/scalar elements in 57 bytes even though field
// values fit in 448 bits and scalars in 446 bits. Noble models that with a
// 456-bit storage width so the final-octet x-sign bit (bit 455) still fits in
// the shared little-endian container.
const Fp = /* @__PURE__ */ (() => Field(ed448_CURVE_p, { BITS: 456, isLE: true }))();
// Same 57-byte container shape as `Fp`; canonical scalar encodings still have
// the top ten bits clear per RFC 8032.
const Fn = /* @__PURE__ */ (() => Field(ed448_CURVE.n, { BITS: 456, isLE: true }))();
// Generic 56-byte field shape used by decaf448 and raw X448 u-coordinates.
// Plain `Field` decoding stays canonical here, so callers that want RFC 7748's
// modulo-p acceptance must reduce externally.
const Fp448 = /* @__PURE__ */ (() => Field(ed448_CURVE_p, { BITS: 448, isLE: true }))();
function toMontgomery(point) {
    // RFC 7748 section 4.2 maps Ed448-Goldilocks to Curve448 via a 4-isogeny.
    // The u-coordinate map is:
    //   u = y^2 / x^2
    // In projective coordinates this is:
    //   u = Y^2 / X^2
    const u = Fp.div(Fp.mul(point.Y, point.Y), Fp.mul(point.X, point.X));
    return Fp448.toBytes(u);
}
function toMontgomerySecret(secretKey) {
    const size = ed448_Point.Fp.BYTES;
    abytes(secretKey, size);
    return adjustScalarBytes(shake256_114(secretKey.subarray(0, size))).subarray(0, 56);
}
// SHAKE256(dom4(phflag,context)||x, 114)
// RFC 8032 `dom4` prefix. Empty contexts are valid; the accepted length range
// is 0..255 octets inclusive.
function dom4(data, ctx, phflag) {
    if (ctx.length > 255)
        throw new Error('context must be smaller than 255, got: ' + ctx.length);
    return concatBytes$1(asciiToBytes('SigEd448'), new Uint8Array([phflag ? 1 : 0, ctx.length]), ctx, data);
}
const ed448_Point = /* @__PURE__ */ edwards(ed448_CURVE, { Fp, Fn, uvRatio });
// Shared internal factory for both `ed448` and `ed448ph`; callers are only
// expected to override narrow family options such as prehashing.
function ed4(opts) {
    return eddsa(ed448_Point, shake256_114, Object.assign({ adjustScalarBytes, domain: dom4, toMontgomery, toMontgomerySecret }, opts));
}
/**
 * ed448 EdDSA curve and methods.
 * @example
 * Generate one Ed448 keypair, sign a message, and verify it.
 *
 * ```js
 * import { ed448 } from '@noble/curves/ed448.js';
 * const { secretKey, publicKey } = ed448.keygen();
 * // const publicKey = ed448.getPublicKey(secretKey);
 * const msg = new TextEncoder().encode('hello noble');
 * const sig = ed448.sign(msg, secretKey);
 * const isValid = ed448.verify(sig, msg, publicKey);
 * ```
 */
const ed448 = /* @__PURE__ */ ed4({});
/**
 * ECDH using curve448 aka x448.
 * The wrapper aborts on all-zero shared secrets by default, and seeded
 * `keygen(seed)` reuses the provided 56-byte seed buffer instead of copying it.
 *
 * @example
 * Derive one shared secret between two X448 peers.
 *
 * ```js
 * import { x448 } from '@noble/curves/ed448.js';
 * const alice = x448.keygen();
 * const bob = x448.keygen();
 * const shared = x448.getSharedSecret(alice.secretKey, bob.publicKey);
 * ```
 */
const x448 = /* @__PURE__ */ (() => {
    const P = ed448_CURVE_p;
    const powPminus2 = (x) => {
        const Pminus3div4 = ed448_pow_Pminus3div4(x);
        const Pminus3 = pow2(Pminus3div4, _2n$1, P);
        return mod(Pminus3 * x, P); // Pminus3 * x = Pminus2
    };
    return montgomery({
        P,
        type: 'x448',
        powPminus2,
        adjustScalarBytes,
        // ~3x faster fixed-base: [k]B on Ed448-Goldilocks using cached base tables, mapped back
        // through the 4-isogeny to curve448: u = y²/x² = Y²/X² (the isogeny is a homomorphism and
        // sends the Ed448 base point to u=5, so no scalar correction factor is needed).
        scalarMultBase: (k) => {
            // Clamped k (≈2^447) exceeds n, but B has prime order n, so [k]B == [k mod n]B.
            const kn = mod(k, ed448_Point.Fn.ORDER);
            // k ≡ 0 (mod n): [k]B is the point at infinity, whose u is 0 in the x-only ladder;
            // returning 0 makes montgomery() reject it exactly like the ladder path.
            if (kn === _0n)
                return _0n;
            const p = ed448_Point.BASE.multiply(kn);
            // X == 0 only at the identity and the order-2 point, both excluded from the prime-order
            // subgroup hit by kn in 1..n-1.
            return mod(p.Y * p.Y * powPminus2(mod(p.X * p.X, P)), P);
        },
    });
})();

/**
 * SECG secp256k1. See [pdf](https://www.secg.org/sec2-v2.pdf).
 *
 * Belongs to Koblitz curves: it has efficiently-computable GLV endomorphism ψ,
 * check out {@link EndomorphismOpts}. Seems to be rigid (not backdoored).
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
// Seems like generator was produced from some seed:
// `Pointk1.BASE.multiply(Pointk1.Fn.inv(2n, N)).toAffine().x`
// // gives short x 0x3b78ce563f89a0ed9414f5aa28ad0d96d6795f9c63n
const secp256k1_CURVE = {
    p: BigInt('0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f'),
    n: BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141'),
    h: BigInt(1),
    a: BigInt(0),
    b: BigInt(7),
    Gx: BigInt('0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'),
    Gy: BigInt('0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8'),
};
const secp256k1_ENDO = {
    beta: BigInt('0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee'),
    basises: [
        [BigInt('0x3086d221a7d46bcde86c90e49284eb15'), -BigInt('0xe4437ed6010e88286f547fa90abfe4c3')],
        [BigInt('0x114ca50f7a8e2f3f657c1108d9d44cfd8'), BigInt('0x3086d221a7d46bcde86c90e49284eb15')],
    ],
};
const _2n = /* @__PURE__ */ BigInt(2);
/**
 * √n = n^((p+1)/4) for fields p = 3 mod 4. We unwrap the loop and multiply bit-by-bit.
 * (P+1n/4n).toString(2) would produce bits [223x 1, 0, 22x 1, 4x 0, 11, 00]
 */
function sqrtMod(y) {
    const P = secp256k1_CURVE.p;
    // prettier-ignore
    const _3n = BigInt(3), _6n = BigInt(6), _11n = BigInt(11), _22n = BigInt(22);
    // prettier-ignore
    const _23n = BigInt(23), _44n = BigInt(44), _88n = BigInt(88);
    const b2 = (y * y * y) % P; // x^3, 11
    const b3 = (b2 * b2 * y) % P; // x^7
    const b6 = (pow2(b3, _3n, P) * b3) % P;
    const b9 = (pow2(b6, _3n, P) * b3) % P;
    const b11 = (pow2(b9, _2n, P) * b2) % P;
    const b22 = (pow2(b11, _11n, P) * b11) % P;
    const b44 = (pow2(b22, _22n, P) * b22) % P;
    const b88 = (pow2(b44, _44n, P) * b44) % P;
    const b176 = (pow2(b88, _88n, P) * b88) % P;
    const b220 = (pow2(b176, _44n, P) * b44) % P;
    const b223 = (pow2(b220, _3n, P) * b3) % P;
    const t1 = (pow2(b223, _23n, P) * b22) % P;
    const t2 = (pow2(t1, _6n, P) * b2) % P;
    const root = pow2(t2, _2n, P);
    if (!Fpk1.eql(Fpk1.sqr(root), y))
        throw new Error('Cannot find square root');
    return root;
}
const Fpk1 = /* @__PURE__ */ Field(secp256k1_CURVE.p, { sqrt: sqrtMod });
const Pointk1 = /* @__PURE__ */ weierstrass(secp256k1_CURVE, {
    Fp: Fpk1,
    endo: secp256k1_ENDO,
});
/**
 * secp256k1 curve: ECDSA and ECDH methods.
 *
 * Uses sha256 to hash messages. To use a different hash,
 * pass `{ prehash: false }` to sign / verify.
 *
 * @example
 * Generate one secp256k1 keypair, sign a message, and verify it.
 *
 * ```js
 * import { secp256k1 } from '@noble/curves/secp256k1.js';
 * const { secretKey, publicKey } = secp256k1.keygen();
 * // const publicKey = secp256k1.getPublicKey(secretKey);
 * const msg = new TextEncoder().encode('hello noble');
 * const sig = secp256k1.sign(msg, secretKey);
 * const isValid = secp256k1.verify(sig, msg, publicKey);
 * // const sigKeccak = secp256k1.sign(keccak256(msg), secretKey, { prehash: false });
 * ```
 */
const secp256k1 = /* @__PURE__ */ ecdsa(Pointk1, sha256);

/**
 * Miscellaneous, rarely used curves.
 * jubjub, babyjubjub, pallas, vesta.
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const brainpoolP256r1_CURVE = /* @__PURE__ */ (() => ({
    p: BigInt('0xa9fb57dba1eea9bc3e660a909d838d726e3bf623d52620282013481d1f6e5377'),
    a: BigInt('0x7d5a0975fc2c3057eef67530417affe7fb8055c126dc5c6ce94a4b44f330b5d9'),
    b: BigInt('0x26dc5c6ce94a4b44f330b5d9bbd77cbf958416295cf7e1ce6bccdc18ff8c07b6'),
    n: BigInt('0xa9fb57dba1eea9bc3e660a909d838d718c397aa3b561a6f7901e0e82974856a7'),
    Gx: BigInt('0x8bd2aeb9cb7e57cb2c4b482ffc81b7afb9de27e1e3bd23c23a4453bd9ace3262'),
    Gy: BigInt('0x547ef835c3dac4fd97f8461a14611dc9c27745132ded8e545c1d54c72f046997'),
    h: BigInt(1),
}))();
/**
 * Brainpool P256r1 with sha256, from RFC 5639.
 * @example
 * Generate one Brainpool P256r1 keypair, sign a message, and verify it.
 *
 * ```ts
 * const { secretKey, publicKey } = brainpoolP256r1.keygen();
 * const msg = new TextEncoder().encode('hello noble');
 * const sig = brainpoolP256r1.sign(msg, secretKey);
 * const isValid = brainpoolP256r1.verify(sig, msg, publicKey);
 * ```
 */
const brainpoolP256r1 = /* @__PURE__ */ (() => ecdsa(weierstrass(brainpoolP256r1_CURVE), sha256))();
const brainpoolP384r1_CURVE = /* @__PURE__ */ (() => ({
    p: BigInt('0x8cb91e82a3386d280f5d6f7e50e641df152f7109ed5456b412b1da197fb71123acd3a729901d1a71874700133107ec53'),
    a: BigInt('0x7bc382c63d8c150c3c72080ace05afa0c2bea28e4fb22787139165efba91f90f8aa5814a503ad4eb04a8c7dd22ce2826'),
    b: BigInt('0x04a8c7dd22ce28268b39b55416f0447c2fb77de107dcd2a62e880ea53eeb62d57cb4390295dbc9943ab78696fa504c11'),
    n: BigInt('0x8cb91e82a3386d280f5d6f7e50e641df152f7109ed5456b31f166e6cac0425a7cf3ab6af6b7fc3103b883202e9046565'),
    Gx: BigInt('0x1d1c64f068cf45ffa2a63a81b7c13f6b8847a3e77ef14fe3db7fcafe0cbd10e8e826e03436d646aaef87b2e247d4af1e'),
    Gy: BigInt('0x8abe1d7520f9c2a45cb1eb8e95cfd55262b70b29feec5864e19c054ff99129280e4646217791811142820341263c5315'),
    h: BigInt(1),
}))();
/**
 * Brainpool P384r1 with sha384, from RFC 5639.
 * @example
 * Generate one Brainpool P384r1 keypair, sign a message, and verify it.
 *
 * ```ts
 * const { secretKey, publicKey } = brainpoolP384r1.keygen();
 * const msg = new TextEncoder().encode('hello noble');
 * const sig = brainpoolP384r1.sign(msg, secretKey);
 * const isValid = brainpoolP384r1.verify(sig, msg, publicKey);
 * ```
 */
const brainpoolP384r1 = /* @__PURE__ */ (() => ecdsa(weierstrass(brainpoolP384r1_CURVE), sha384))();
const brainpoolP512r1_CURVE = /* @__PURE__ */ (() => ({
    p: BigInt('0xaadd9db8dbe9c48b3fd4e6ae33c9fc07cb308db3b3c9d20ed6639cca703308717d4d9b009bc66842aecda12ae6a380e62881ff2f2d82c68528aa6056583a48f3'),
    a: BigInt('0x7830a3318b603b89e2327145ac234cc594cbdd8d3df91610a83441caea9863bc2ded5d5aa8253aa10a2ef1c98b9ac8b57f1117a72bf2c7b9e7c1ac4d77fc94ca'),
    b: BigInt('0x3df91610a83441caea9863bc2ded5d5aa8253aa10a2ef1c98b9ac8b57f1117a72bf2c7b9e7c1ac4d77fc94cadc083e67984050b75ebae5dd2809bd638016f723'),
    n: BigInt('0xaadd9db8dbe9c48b3fd4e6ae33c9fc07cb308db3b3c9d20ed6639cca70330870553e5c414ca92619418661197fac10471db1d381085ddaddb58796829ca90069'),
    Gx: BigInt('0x81aee4bdd82ed9645a21322e9c4c6a9385ed9f70b5d916c1b43b62eef4d0098eff3b1f78e2d0d48d50d1687b93b97d5f7c6d5047406a5e688b352209bcb9f822'),
    Gy: BigInt('0x7dde385d566332ecc0eabfa9cf7822fdf209f70024a57b1aa000c55b881f8111b2dcde494a5f485e5bca4bd88a2763aed1ca2b2fa8f0540678cd1e0f3ad80892'),
    h: BigInt(1),
}))();
/**
 * Brainpool P512r1 with sha512, from RFC 5639.
 * @example
 * Generate one Brainpool P512r1 keypair, sign a message, and verify it.
 *
 * ```ts
 * const { secretKey, publicKey } = brainpoolP512r1.keygen();
 * const msg = new TextEncoder().encode('hello noble');
 * const sig = brainpoolP512r1.sign(msg, secretKey);
 * const isValid = brainpoolP512r1.verify(sig, msg, publicKey);
 * ```
 */
const brainpoolP512r1 = /* @__PURE__ */ (() => ecdsa(weierstrass(brainpoolP512r1_CURVE), sha512))();

/**
 * @access private
 * This file is needed to dynamic import the noble-curves.
 * Separate dynamic imports are not convenient as they result in too many chunks,
 * which share a lot of code anyway.
 */
const nobleCurves = new Map(Object.entries({
    nistP256: p256,
    nistP384: p384,
    nistP521: p521,
    brainpoolP256r1,
    brainpoolP384r1,
    brainpoolP512r1,
    secp256k1,
    x448,
    ed448
}));

export { nobleCurves };
