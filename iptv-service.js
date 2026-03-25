const IPTV_SOURCES = Object.freeze([
    {
        key: 'merged_ipv4',
        name: 'IPv4 综合可播源',
        url: 'builtin://merged-ipv4',
        requiresIpv6: false,
        upstreamUrls: [
            'https://raw.githubusercontent.com/hujingguang/ChinaIPTV/main/cnTV_AutoUpdate.m3u8'
        ],
        playlistText: `#EXTM3U
#EXTINF:-1 tvg-name="湖南爱晚" group-title="湖南台",湖南爱晚
http://phoneqq.qing.mgtv.com/nn_live/nn_x64/dWlwPTEwNi4xNC4zOC41NSZ0ZXJtPTUmcWlkPSZyYXV0aF9lbmFibGU9b2ZmJmNkbmV4X2lkPXFxX3Bob25lX2xpdmUmY2hzPSZkZWY9MSZzPWVlMzllMjhmMzAzNThiY2RhNjM5YTAwODJlYjExNDEzJnVpZD0mdXVpZD04OWQyNWVjMDYyNDRiMjc0N2E1YTUxZWZhOGY2M2M3Mi02YTBlMjYzNyZ2PTImYXM9MCZlcz0xNzc0NDI0NTA5/HNGGMPP360.m3u8
#EXTINF:-1 tvg-name="湖南都市" group-title="湖南台",湖南都市
http://phoneqq.qing.mgtv.com/nn_live/nn_x64/dWlwPTEwNi4xNC4zOC41NSZ0ZXJtPTUmcWlkPSZyYXV0aF9lbmFibGU9b2ZmJmNkbmV4X2lkPXFxX3Bob25lX2xpdmUmY2hzPSZkZWY9MSZzPWY3Yzc2NTA0N2MyOWI2MzI0MjkwN2NlODFkOGYxY2I1JnVpZD0mdXVpZD0xYmM3MmM4ZGQzMDA1NTI1MjMxNzg4ODBlOWU0YmNmNy02YTBlMjYzNyZ2PTImYXM9MCZlcz0xNzc0NDE0ODEw/HNDSMPP360.m3u8
#EXTINF:-1 tvg-name="湖南娱乐频道" group-title="湖南台",湖南娱乐频道
http://phoneqq.qing.mgtv.com/nn_live/nn_x64/dWlwPTEwNi4xNC4zOC41NSZ0ZXJtPTUmcWlkPSZyYXV0aF9lbmFibGU9b2ZmJmNkbmV4X2lkPXFxX3Bob25lX2xpdmUmY2hzPSZkZWY9MSZzPTdlMTExOWM2ZGI5MWY1NDAwM2NmNmEyYTRmY2I3NThiJnVpZD0mdXVpZD03NmZlNjY4ZDY5YTc3Y2UxZDhmZjdiY2JjNWZjMDRmZi02YTBlMjYzNyZ2PTImYXM9MCZlcz0xNzc0NDE4NzUx/HNYLMPP360.m3u8
#EXTINF:-1 tvg-name="湖南经视" group-title="湖南台",湖南经视
http://phoneqq.qing.mgtv.com/nn_live/nn_x64/dWlwPTEwNi4xNC4zOC41NSZ0ZXJtPTUmcWlkPSZyYXV0aF9lbmFibGU9b24mY2RuZXhfaWQ9cXFfcGhvbmVfbGl2ZSZjaHM9JmRlZj0xJnM9NzI4ODBjNjc2NjFkMjRiNTg5ZmQ3MDk1Y2MwZDEzNWYmdWlkPSZ1dWlkPWIzYjRlOTg0NzAwN2FhODc5Yjk0ZGVhMjE2YzZmYmFlLTZhMGUyNjM3JnY9MiZhcz0wJmVzPTE3NzQ0MjU2MTY,/HNJSMPP360.m3u8
#EXTINF:-1 tvg-name="金鹰纪实频道" group-title="湖南台",金鹰纪实频道
https://phoneqq.qing.mgtv.com/nn_live/nn_x64/dWlwPTEwNi4xNC4zOC41NSZ0ZXJtPTUmcWlkPSZyYXV0aF9lbmFibGU9b2ZmJmNkbmV4X2lkPXFxX3Bob25lX2xpdmUmY2hzPSZkZWY9MSZzPWEzYWZlZjgzMjdmM2M5ZjkyMmUyNDgyZGQ1YmIzN2Q4JnVpZD0mdXVpZD1kODg4NWFlYzYzYzJhOGNkODA5ZDY0ZWU1Yzk4Y2MzMi02YTBlMjYzNyZ2PTImYXM9MCZlcz0xNzc0NDE4MTE5/JYJSMPP360.m3u8
#EXTINF:-1 tvg-name="金鹰卡通" group-title="湖南台",金鹰卡通
http://phonehwei.qing.mgtv.com/nn_live/nn_x64/dWlwPTEwNi4xNC4zOC41NSZ0ZXJtPTUmcWlkPSZyYXV0aF9lbmFibGU9b2ZmJmNkbmV4X2lkPWh3X3Bob25lJmNocz0mZGVmPTEmcz1iZDExY2Y3MmRkNWZkNzEzOWJhMGE2MDA1MzI3NDU1NiZ1aWQ9JnV1aWQ9Y2E4OWEwMzFiZmQyYjE0YjFhYjgzM2VjYzVkN2E2N2UtNmEwZTI2Mzcmdj0yJmFzPTAmZXM9MTc3NDQxNDgyMw,,/JYKTMPP360.m3u8
#EXTINF:-1 tvg-name="CGTN英语" group-title="国际频道",CGTN英语
https://english-livebkali.cgtn.com/live/encgtn_0.m3u8
#EXTINF:-1 tvg-name="CGTN纪录" group-title="国际频道",CGTN纪录
https://english-livebkali.cgtn.com/live/doccgtn_0.m3u8
#EXTINF:-1 tvg-name="河北4K" group-title="4K频道",河北4K
https://event.pull.hebtv.com:443/live/live101.m3u8
#EXTINF:-1 tvg-name="苏州4K" group-title="4K频道",苏州4K
https://tylive.kan0512.com/norecord/csztv4k_4k.m3u8
#EXTINF:-1 tvg-name="东方卫视4K" group-title="4K频道",东方卫视4K
http://bp-resource-dfl.bestv.cn/148/3/video.m3u8
#EXTINF:-1 tvg-name="北京卫视4K" group-title="4K频道",北京卫视4K
http://8.138.7.223/tv/btime.php?id=bjws4k`
    }
]);

const CACHE_TTL_MS = 10 * 60 * 1000;
const SUPPORTED_STREAM_EXTENSIONS = ['.m3u8', '.mp4', '.webm', '.ogg', '.ogv', '.m4v'];
const PROBE_CONCURRENCY = 8;

function safeTrim(value) {
    return String(value || '').trim();
}

function resolvePlaylistUrl(rawValue, baseUrl) {
    const value = safeTrim(rawValue);
    if (!value) {
        return '';
    }

    if (value.startsWith('//')) {
        return `https:${value}`;
    }

    try {
        return new URL(value, baseUrl).toString();
    } catch (error) {
        return value;
    }
}

function parseExtinfAttributes(line) {
    const attributes = {};
    const matcher = /([A-Za-z0-9_-]+)="([^"]*)"/g;
    let match = matcher.exec(line);

    while (match) {
        attributes[String(match[1] || '').toLowerCase()] = safeTrim(match[2]);
        match = matcher.exec(line);
    }

    return attributes;
}

function parseExtinfTitle(line) {
    const commaIndex = line.indexOf(',');
    if (commaIndex < 0) {
        return '';
    }

    return safeTrim(line.slice(commaIndex + 1));
}

function getPlaybackProfile(streamUrl) {
    const normalizedUrl = safeTrim(streamUrl).toLowerCase();
    const protocol = safeTrim(normalizedUrl.match(/^([a-z0-9+.-]+):/i)?.[1]).toLowerCase();
    const pathWithoutQuery = normalizedUrl.split('?')[0];
    const supportedExtension = SUPPORTED_STREAM_EXTENSIONS.find(extension => pathWithoutQuery.includes(extension)) || '';
    const playbackType = supportedExtension === '.m3u8' ? 'hls' : (supportedExtension ? 'native' : 'unsupported');
    const playable = (protocol === 'http' || protocol === 'https') && Boolean(supportedExtension);

    return {
        protocol,
        playable,
        playbackType
    };
}

function parsePlaylist(text, source) {
    const channels = [];
    const fingerprints = new Set();
    const lines = String(text || '').split(/\r?\n/);
    let pending = null;
    let totalChannelCount = 0;
    let filteredChannelCount = 0;

    lines.forEach(rawLine => {
        const line = safeTrim(rawLine);
        if (!line) {
            return;
        }

        if (line.startsWith('#EXTINF')) {
            const attributes = parseExtinfAttributes(line);
            const title = parseExtinfTitle(line) || attributes['tvg-name'] || '未命名频道';
            pending = {
                name: safeTrim(title) || '未命名频道',
                groupTitle: safeTrim(attributes['group-title']) || '未分组',
                logo: resolvePlaylistUrl(attributes['tvg-logo'], source.url)
            };
            return;
        }

        if (line.startsWith('#')) {
            return;
        }

        if (!pending) {
            return;
        }

        const streamUrl = resolvePlaylistUrl(line, source.url);
        if (!streamUrl) {
            pending = null;
            return;
        }

        totalChannelCount += 1;

        const playbackProfile = getPlaybackProfile(streamUrl);
        if (!playbackProfile.playable) {
            filteredChannelCount += 1;
            pending = null;
            return;
        }

        const fingerprint = `${pending.name.toLowerCase()}::${streamUrl}`;
        if (fingerprints.has(fingerprint)) {
            pending = null;
            return;
        }

        fingerprints.add(fingerprint);

        channels.push({
            id: '',
            name: pending.name,
            groupKey: '',
            groupTitle: safeTrim(pending.groupTitle) || '未分组',
            streamUrl,
            protocol: playbackProfile.protocol,
            playable: playbackProfile.playable,
            playbackType: playbackProfile.playbackType,
            logo: pending.logo || '',
            sourceKey: source.key,
            sourceName: source.name,
            requiresIpv6: Boolean(source.requiresIpv6)
        });

        pending = null;
    });

    return {
        channels,
        summary: {
            totalChannelCount,
            playableChannelCount: channels.length,
            filteredChannelCount
        }
    };
}

function buildGroupsAndChannels(source, channels) {
    const groups = [];
    const groupMap = new Map();

    const normalizedChannels = channels.map((channel, index) => {
        const title = safeTrim(channel.groupTitle) || '未分组';
        if (!groupMap.has(title)) {
            const group = {
                key: `group-${groups.length + 1}`,
                title,
                count: 0
            };
            groupMap.set(title, group);
            groups.push(group);
        }

        const group = groupMap.get(title);
        group.count += 1;

        return {
            ...channel,
            id: `${source.key}::${index + 1}`,
            groupKey: group.key,
            groupTitle: group.title
        };
    });

    return {
        groups,
        channels: normalizedChannels
    };
}

function looksLikePlayableResponse(channel, response) {
    if (!response || response.ok !== true) {
        return false;
    }

    const contentType = safeTrim(response.contentType).toLowerCase();
    const preview = safeTrim(response.preview).toLowerCase();

    if (channel.playbackType === 'hls') {
        return contentType.includes('mpegurl')
            || contentType.includes('application/octet-stream')
            || preview.includes('#extm3u');
    }

    return contentType.startsWith('video/')
        || contentType.startsWith('audio/')
        || preview.includes('#extm3u');
}

async function mapWithConcurrency(items, limit, iteratee) {
    const results = new Array(items.length);
    let cursor = 0;

    async function worker() {
        while (cursor < items.length) {
            const currentIndex = cursor;
            cursor += 1;
            results[currentIndex] = await iteratee(items[currentIndex], currentIndex);
        }
    }

    const workerCount = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}

function createIptvService({ fetchText, probeStream }) {
    const cache = new Map();

    function getSourceByKey(sourceKey) {
        return IPTV_SOURCES.find(source => source.key === sourceKey) || null;
    }

    async function verifyChannels(channels) {
        if (typeof probeStream !== 'function' || channels.length === 0) {
            return {
                channels,
                unreachableFilteredCount: 0
            };
        }

        const probeResults = await mapWithConcurrency(channels, PROBE_CONCURRENCY, async channel => {
            try {
                const response = await probeStream(channel.streamUrl, channel);
                return looksLikePlayableResponse(channel, response);
            } catch (error) {
                return false;
            }
        });

        const verifiedChannels = channels.filter((_, index) => probeResults[index]);
        return {
            channels: verifiedChannels,
            unreachableFilteredCount: channels.length - verifiedChannels.length
        };
    }

    async function fetchCatalog(source) {
        const playlistParts = [];

        if (source.playlistText) {
            playlistParts.push(source.playlistText);
        }

        if (Array.isArray(source.upstreamUrls) && source.upstreamUrls.length > 0) {
            const upstreamTexts = await Promise.all(source.upstreamUrls.map(targetUrl => fetchText(targetUrl)));
            playlistParts.push(...upstreamTexts);
        } else if (!source.playlistText) {
            playlistParts.push(await fetchText(source.url));
        }

        const text = playlistParts.join('\n');
        const parsed = parsePlaylist(text, source);
        const verified = await verifyChannels(parsed.channels);
        const normalized = buildGroupsAndChannels(source, verified.channels);
        const fetchedAt = Date.now();
        const payload = {
            source: {
                key: source.key,
                name: source.name,
                url: source.url,
                requiresIpv6: Boolean(source.requiresIpv6)
            },
            groups: normalized.groups,
            channels: normalized.channels,
            summary: {
                ...parsed.summary,
                playableChannelCount: normalized.channels.length,
                filteredChannelCount: parsed.summary.filteredChannelCount + verified.unreachableFilteredCount,
                unreachableFilteredCount: verified.unreachableFilteredCount
            }
        };

        cache.set(source.key, {
            payload,
            fetchedAt
        });

        return {
            ...payload,
            cache: {
                stale: false,
                fetchedAt
            }
        };
    }

    async function getChannels(sourceKey, options = {}) {
        const source = getSourceByKey(sourceKey);
        if (!source) {
            const error = new Error('未找到对应 IPTV 源');
            error.statusCode = 404;
            error.code = 'IPTV_SOURCE_NOT_FOUND';
            throw error;
        }

        const cached = cache.get(source.key);
        const now = Date.now();
        const isFresh = cached && (now - cached.fetchedAt) < CACHE_TTL_MS;

        if (!options.force && isFresh) {
            return {
                ...cached.payload,
                cache: {
                    stale: false,
                    fetchedAt: cached.fetchedAt
                }
            };
        }

        try {
            return await fetchCatalog(source);
        } catch (error) {
            if (cached) {
                return {
                    ...cached.payload,
                    cache: {
                        stale: true,
                        fetchedAt: cached.fetchedAt
                    }
                };
            }

            error.statusCode = error.statusCode || 502;
            error.code = error.code || 'IPTV_FETCH_FAILED';
            throw error;
        }
    }

    async function listSources() {
        const sources = await Promise.all(IPTV_SOURCES.map(async source => {
            try {
                const catalog = await getChannels(source.key);
                return {
                    key: source.key,
                    name: source.name,
                    url: source.url,
                    requiresIpv6: Boolean(source.requiresIpv6),
                    ok: true,
                    groupCount: catalog.groups.length,
                    channelCount: catalog.channels.length,
                    totalChannelCount: catalog.summary?.totalChannelCount || catalog.channels.length,
                    filteredChannelCount: catalog.summary?.filteredChannelCount || 0,
                    stale: Boolean(catalog.cache?.stale)
                };
            } catch (error) {
                return {
                    key: source.key,
                    name: source.name,
                    url: source.url,
                    requiresIpv6: Boolean(source.requiresIpv6),
                    ok: false,
                    groupCount: 0,
                    channelCount: 0,
                    totalChannelCount: 0,
                    filteredChannelCount: 0,
                    stale: false,
                    error: error.message || '加载失败'
                };
            }
        }));

        return { sources };
    }

    return {
        listSources,
        getChannels
    };
}

module.exports = {
    createIptvService
};
