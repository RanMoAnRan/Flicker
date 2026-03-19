function createDayjs(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

    return {
        format(pattern = 'YYYY-MM-DD') {
            if (Number.isNaN(date.getTime())) {
                return '';
            }

            const replacements = {
                YYYY: String(date.getFullYear()),
                MM: String(date.getMonth() + 1).padStart(2, '0'),
                DD: String(date.getDate()).padStart(2, '0'),
                HH: String(date.getHours()).padStart(2, '0'),
                mm: String(date.getMinutes()).padStart(2, '0'),
                ss: String(date.getSeconds()).padStart(2, '0')
            };

            return Object.entries(replacements).reduce((result, [token, replacement]) => (
                result.replace(token, replacement)
            ), pattern);
        },
        toDate() {
            return new Date(date.getTime());
        }
    };
}

createDayjs.unix = function unix(seconds) {
    return createDayjs(Number(seconds || 0) * 1000);
};

module.exports = createDayjs;
