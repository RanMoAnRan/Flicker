function parseValue(value, radix = 10) {
    if (typeof value === 'bigint') {
        return value;
    }

    if (value && typeof value.value === 'bigint') {
        return value.value;
    }

    const source = String(value ?? '0').trim();
    if (!source) {
        return 0n;
    }

    const sign = source.startsWith('-') ? -1n : 1n;
    const digits = sign < 0n ? source.slice(1) : source;
    const base = BigInt(radix || 10);
    let result = 0n;

    for (const char of digits.toLowerCase()) {
        const code = char.charCodeAt(0);
        let digit = -1;

        if (code >= 48 && code <= 57) {
            digit = code - 48;
        } else if (code >= 97 && code <= 122) {
            digit = code - 87;
        }

        if (digit < 0 || digit >= Number(base)) {
            continue;
        }

        result = result * base + BigInt(digit);
    }

    return result * sign;
}

function powMod(base, exponent, modulus) {
    if (modulus === 1n) {
        return 0n;
    }

    let result = 1n;
    let currentBase = ((base % modulus) + modulus) % modulus;
    let currentExponent = exponent;

    while (currentExponent > 0n) {
        if (currentExponent & 1n) {
            result = (result * currentBase) % modulus;
        }

        currentExponent >>= 1n;
        currentBase = (currentBase * currentBase) % modulus;
    }

    return result;
}

function createBigInteger(value, radix) {
    const current = parseValue(value, radix);

    return {
        value: current,
        add(other) {
            return createBigInteger(current + parseValue(other));
        },
        subtract(other) {
            return createBigInteger(current - parseValue(other));
        },
        multiply(other) {
            return createBigInteger(current * parseValue(other));
        },
        divide(other) {
            return createBigInteger(current / parseValue(other));
        },
        mod(other) {
            return createBigInteger(current % parseValue(other));
        },
        pow(exponent) {
            return createBigInteger(current ** parseValue(exponent));
        },
        modPow(exponent, modulus) {
            return createBigInteger(powMod(current, parseValue(exponent), parseValue(modulus)));
        },
        compare(other) {
            const target = parseValue(other);
            if (current > target) {
                return 1;
            }
            if (current < target) {
                return -1;
            }
            return 0;
        },
        equals(other) {
            return current === parseValue(other);
        },
        toString(base = 10) {
            return current.toString(base);
        }
    };
}

module.exports = createBigInteger;
