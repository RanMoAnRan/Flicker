function stringify(input = {}) {
    const params = [];

    Object.entries(input).forEach(([key, value]) => {
        if (value === undefined) {
            return;
        }

        if (Array.isArray(value)) {
            value.forEach(item => {
                params.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item ?? ''))}`);
            });
            return;
        }

        params.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value ?? ''))}`);
    });

    return params.join('&');
}

function parse(query = '') {
    return String(query)
        .replace(/^\?/, '')
        .split('&')
        .filter(Boolean)
        .reduce((result, part) => {
            const [key, value = ''] = part.split('=');
            result[decodeURIComponent(key)] = decodeURIComponent(value);
            return result;
        }, {});
}

module.exports = {
    stringify,
    parse
};
