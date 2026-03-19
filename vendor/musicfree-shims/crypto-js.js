const crypto = require('crypto');

function createWordArray(buffer) {
    const safeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');

    return {
        buffer: safeBuffer,
        sigBytes: safeBuffer.length,
        toString(encoder) {
            if (encoder === enc.Hex) {
                return safeBuffer.toString('hex');
            }
            if (encoder === enc.Base64) {
                return safeBuffer.toString('base64');
            }
            if (encoder === enc.Utf8) {
                return safeBuffer.toString('utf8');
            }
            return safeBuffer.toString();
        }
    };
}

const enc = {
    Utf8: {
        parse(value) {
            return createWordArray(Buffer.from(String(value ?? ''), 'utf8'));
        },
        stringify(value) {
            return createWordArray(value?.buffer || value).toString(enc.Utf8);
        }
    },
    Hex: {
        parse(value) {
            return createWordArray(Buffer.from(String(value ?? ''), 'hex'));
        },
        stringify(value) {
            return createWordArray(value?.buffer || value).toString(enc.Hex);
        }
    },
    Base64: {
        parse(value) {
            return createWordArray(Buffer.from(String(value ?? ''), 'base64'));
        },
        stringify(value) {
            return createWordArray(value?.buffer || value).toString(enc.Base64);
        }
    }
};

const mode = {
    ECB: 'ECB',
    CBC: 'CBC'
};

const pad = {
    Pkcs7: 'Pkcs7'
};

function normalizeBuffer(value, encoding = 'utf8') {
    if (Buffer.isBuffer(value)) {
        return value;
    }

    if (value?.buffer && Buffer.isBuffer(value.buffer)) {
        return value.buffer;
    }

    return Buffer.from(String(value ?? ''), encoding);
}

function resolveAlgorithm(keyBuffer, cipherMode) {
    const bitSize = keyBuffer.length * 8;
    const normalizedMode = cipherMode === mode.CBC ? 'cbc' : 'ecb';
    return `aes-${bitSize}-${normalizedMode}`;
}

function createCipherParams(buffer) {
    const wordArray = createWordArray(buffer);

    return {
        ciphertext: wordArray,
        toString(encoder = enc.Base64) {
            return wordArray.toString(encoder);
        }
    };
}

const AES = {
    encrypt(text, key, options = {}) {
        const sourceBuffer = normalizeBuffer(text);
        const keyBuffer = normalizeBuffer(key);
        const cipherMode = options.mode === mode.CBC ? mode.CBC : mode.ECB;
        const algorithm = resolveAlgorithm(keyBuffer, cipherMode);
        const ivBuffer = cipherMode === mode.CBC ? normalizeBuffer(options.iv).subarray(0, 16) : null;
        const cipher = crypto.createCipheriv(algorithm, keyBuffer, ivBuffer);

        cipher.setAutoPadding(true);
        const encrypted = Buffer.concat([cipher.update(sourceBuffer), cipher.final()]);
        return createCipherParams(encrypted);
    },

    decrypt(ciphertext, key, options = {}) {
        const encryptedBuffer = normalizeBuffer(ciphertext?.ciphertext || ciphertext, 'base64');
        const keyBuffer = normalizeBuffer(key);
        const cipherMode = options.mode === mode.CBC ? mode.CBC : mode.ECB;
        const algorithm = resolveAlgorithm(keyBuffer, cipherMode);
        const ivBuffer = cipherMode === mode.CBC ? normalizeBuffer(options.iv).subarray(0, 16) : null;
        const decipher = crypto.createDecipheriv(algorithm, keyBuffer, ivBuffer);

        decipher.setAutoPadding(true);
        const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
        return createWordArray(decrypted);
    }
};

function MD5(data) {
    const sourceBuffer = normalizeBuffer(data);
    const digest = crypto.createHash('md5').update(sourceBuffer).digest();
    return createWordArray(digest);
}

module.exports = {
    MD5,
    AES,
    enc,
    mode,
    pad
};
