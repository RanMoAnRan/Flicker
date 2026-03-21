const path = require('path');
const vm = require('vm');
const { execFile } = require('child_process');
const { URL } = require('url');

const MUSIC_PLUGIN_INDEX_URL = 'https://musicfreepluginshub.2020818.xyz/plugins.json';
const PLUGIN_INDEX_TTL = 10 * 60 * 1000;
const PLUGIN_CODE_TTL = 60 * 60 * 1000;
const TRACK_CACHE_TTL = 10 * 60 * 1000;
const TRACK_CACHE_STALE_FALLBACK_TTL = 24 * 60 * 60 * 1000;
const LYRIC_CACHE_TTL = 10 * 60 * 1000;
const QUALITY_PRIORITY = ['standard', 'high', 'low', 'super'];
const DEFAULT_PLUGIN_REQUEST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Connection: 'keep-alive'
};
const MANUAL_PLUGIN_CATALOG = [
    {
        name: '爱听',
        version: 'manual',
        url: 'https://gitee.com/kevinr/tvbox/raw/master/musicfree/plugins/at.js'
    },
    {
        name: '元力 KW',
        version: 'manual',
        url: 'http://music.haitangw.net/cqapi/kw.js'
    },
    {
        name: '元力 QQ',
        version: 'manual',
        url: 'http://music.haitangw.net/cqapi/qq.js'
    }
];
const PLUGIN_ALLOWLIST = {
    爱听: {
        defaultQuality: 'standard',
        note: '已手工接入推荐目录，支持搜索、播放、歌词与推荐榜单'
    },
    '元力 KW': {
        defaultQuality: 'standard',
        note: '已手工接入推荐目录，目标用于酷我链路搜索与播放'
    },
    '元力 QQ': {
        defaultQuality: 'standard',
        note: '已手工接入推荐目录，目标用于 QQ 链路搜索与播放'
    },
    W音乐: {
        defaultQuality: 'standard',
        note: '首批推荐插件'
    },
    qq: {
        defaultQuality: 'standard',
        note: '已验证支持搜索与播放'
    },
    酷我: {
        defaultQuality: 'standard',
        note: '已验证支持搜索与播放'
    },
    小秋音乐: {
        defaultQuality: 'standard',
        note: '已通过兼容映射接入 qq 播放链路'
    },
    小蜗音乐: {
        defaultQuality: 'standard',
        note: '已通过兼容映射接入 酷我 播放链路'
    },
    好听轻音乐: {
        defaultQuality: 'standard',
        note: '已验证支持搜索、播放与推荐榜单'
    },
    网易: {
        defaultQuality: 'standard',
        note: '已验证支持搜索、播放、歌词与推荐榜单'
    },
    小芸音乐: {
        defaultQuality: 'standard',
        note: '已通过兼容映射接入 网易 播放链路'
    },
    酷狗: {
        defaultQuality: 'standard',
        note: '已通过搜索匹配接入 网易 播放链路'
    }
};
const PLUGIN_MEDIA_ALIAS = {
    小秋音乐: 'qq',
    小蜗音乐: '酷我',
    小芸音乐: '网易'
};
const PLUGIN_MEDIA_SEARCH_ALIAS = {
    酷狗: '网易'
};
const PLUGIN_SEARCH_ONLY_BLOCKLIST = {
    '5sing': '当前仅支持搜索结果展示，暂不提供站内播放'
};
const PLUGIN_REMOVE_BLOCKLIST = {
    歌曲宝: '搜索解析异常，当前无法稳定运行',
    果核音乐: '网络链路异常，当前无法稳定运行',
    小蜜音乐: '插件执行异常，当前无法稳定运行',
    种子: '插件执行异常，当前无法稳定运行',
    mg: '插件执行异常，当前无法稳定运行'
};
const NON_MUSIC_KEYWORDS = {
    lyric: ['歌词'],
    radio: ['电台', 'radio', 'fm'],
    audiobook: ['听书'],
    library: ['webdav', 'navidrome'],
    video: ['youtube', 'bilibili', '快手', '音悦台'],
    ai: ['suno', 'udio']
};

function createHttpError(statusCode, message, code = 'MUSIC_SERVICE_ERROR', extra = {}) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    Object.assign(error, extra);
    return error;
}

function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeMatchText(value) {
    return String(value ?? '')
        .toLowerCase()
        .replace(/[\s\-_/()（）[\]【】·.,，。!！?？:：'"`~]+/g, '')
        .trim();
}

function normalizeArtwork(value) {
    const source = String(value ?? '').trim();
    if (!source) {
        return '';
    }
    if (source.startsWith('//')) {
        return `https:${source}`;
    }
    return source;
}

function pickFirstText(...values) {
    for (const value of values) {
        const normalized = normalizeText(value);
        if (normalized) {
            return normalized;
        }
    }

    return '';
}

function splitCombinedTrackText(text = '') {
    const normalized = normalizeText(text);
    if (!normalized) {
        return null;
    }

    const separators = [' - ', ' — ', ' – ', ' / ', '_', '-'];

    for (const separator of separators) {
        if (!normalized.includes(separator)) {
            continue;
        }

        const parts = normalized.split(separator).map(item => normalizeText(item)).filter(Boolean);
        if (parts.length < 2) {
            continue;
        }

        return {
            artist: parts[0],
            title: parts.slice(1).join(' ')
        };
    }

    return null;
}

function hasUsableLyricContent(lyric = {}) {
    return Boolean(normalizeText(lyric?.rawLrc) || normalizeText(lyric?.translation));
}

function isAbsoluteHttpUrl(value) {
    return /^https?:\/\//i.test(String(value || '').trim());
}

function getPluginPlaybackRestriction(pluginName) {
    return PLUGIN_SEARCH_ONLY_BLOCKLIST[pluginName] || '';
}

function formatDuration(duration) {
    const rawValue = Number(duration) || 0;
    const totalSeconds = rawValue > 1000 ? Math.round(rawValue / 1000) : Math.round(rawValue);
    if (!totalSeconds) {
        return '00:00';
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return [
            String(hours).padStart(2, '0'),
            String(minutes).padStart(2, '0'),
            String(seconds).padStart(2, '0')
        ].join(':');
    }

    return [
        String(minutes).padStart(2, '0'),
        String(seconds).padStart(2, '0')
    ].join(':');
}

function pickQuality(qualities = {}, preferredQuality = '') {
    const available = Object.keys(qualities || {});
    if (available.length === 0) {
        return preferredQuality || 'standard';
    }

    if (preferredQuality && available.includes(preferredQuality)) {
        return preferredQuality;
    }

    return QUALITY_PRIORITY.find(quality => available.includes(quality)) || available[0];
}

function inferPluginKind(name, url = '') {
    const text = `${name} ${url}`.toLowerCase();

    if (NON_MUSIC_KEYWORDS.lyric.some(keyword => text.includes(keyword.toLowerCase()))) {
        return 'lyric';
    }

    if (NON_MUSIC_KEYWORDS.audiobook.some(keyword => text.includes(keyword.toLowerCase()))) {
        return 'audiobook';
    }

    if (NON_MUSIC_KEYWORDS.radio.some(keyword => text.includes(keyword.toLowerCase()))) {
        return 'radio';
    }

    if (NON_MUSIC_KEYWORDS.library.some(keyword => text.includes(keyword.toLowerCase()))) {
        return 'library';
    }

    if (NON_MUSIC_KEYWORDS.video.some(keyword => text.includes(keyword.toLowerCase()))) {
        return 'video';
    }

    if (NON_MUSIC_KEYWORDS.ai.some(keyword => text.includes(keyword.toLowerCase()))) {
        return 'ai';
    }

    return 'music';
}

function getPluginKindLabel(kind) {
    const map = {
        music: '音乐',
        lyric: '歌词',
        radio: '电台',
        audiobook: '听书',
        library: '本地库',
        video: '视频',
        ai: 'AI 音乐',
        unknown: '其他'
    };

    return map[kind] || map.unknown;
}

function normalizeTopListGroups(topLists, options = {}) {
    const includeRaw = Boolean(options.includeRaw);
    const source = Array.isArray(topLists) ? topLists : [];
    const hasGroupedShape = source.some(group => Array.isArray(group?.data));
    const groupedSource = hasGroupedShape
        ? source
        : [{ title: '推荐榜单', data: source }];

    return groupedSource
        .map(group => {
            const groupTitle = normalizeText(group?.title || '推荐榜单');
            const data = Array.isArray(group?.data)
                ? group.data
                    .filter(item => item && item.id != null)
                    .map(item => {
                        const normalizedItem = {
                            id: String(item.id),
                            title: normalizeText(item.title || '未命名榜单'),
                            description: normalizeText(item.description || ''),
                            coverImg: normalizeArtwork(item.coverImg || item.artwork || ''),
                            groupTitle
                        };

                        if (includeRaw) {
                            normalizedItem.raw = item;
                        }

                        return normalizedItem;
                    })
                : [];

            return {
                title: groupTitle,
                data
            };
        })
        .filter(group => group.data.length > 0);
}

class MusicPluginService {
    constructor(options = {}) {
        this.rootDir = options.rootDir || process.cwd();
        this.systemProxyUrl = options.systemProxyUrl || '';
        this.pluginIndexCache = {
            expiresAt: 0,
            value: null
        };
        this.remoteTextCache = new Map();
        this.pluginRuntimeCache = new Map();
        this.trackInfoCache = new Map();
        this.lyricCache = new Map();
    }

    async listPlugins() {
        const catalog = await this.getPluginCatalog();
        const kinds = catalog.reduce((result, plugin) => {
            result[plugin.kind] = (result[plugin.kind] || 0) + 1;
            return result;
        }, {});

        return {
            source: MUSIC_PLUGIN_INDEX_URL,
            total: catalog.length,
            enabled: catalog.filter(plugin => plugin.enabled).length,
            recommended: catalog.filter(plugin => plugin.recommended).length,
            searchable: catalog.filter(plugin => plugin.searchable).length,
            kinds,
            plugins: catalog
        };
    }

    async search(params = {}) {
        const keyword = normalizeText(params.keyword || params.wd);
        if (!keyword) {
            throw createHttpError(400, '缺少搜索关键词', 'MUSIC_SEARCH_KEYWORD_REQUIRED');
        }

        const page = Math.max(1, Number(params.page) || 1);
        const targetPlugin = normalizeText(params.plugin || 'all');
        const pluginNames = targetPlugin === 'all'
            ? await this.getEnabledPluginNames()
            : [targetPlugin];

        if (pluginNames.length === 0) {
            throw createHttpError(503, '当前没有可用的音乐插件', 'MUSIC_PLUGIN_UNAVAILABLE');
        }

        const settled = await Promise.allSettled(
            pluginNames.map(pluginName => this.searchWithPlugin(pluginName, keyword, page))
        );

        const plugins = [];
        const results = [];

        settled.forEach((item, index) => {
            const pluginName = pluginNames[index];
            if (item.status === 'fulfilled') {
                plugins.push({
                    name: pluginName,
                    ok: true,
                    count: item.value.results.length,
                    isEnd: item.value.isEnd
                });
                results.push(...item.value.results);
                return;
            }

            plugins.push({
                name: pluginName,
                ok: false,
                count: 0,
                error: item.reason?.message || '搜索失败'
            });
        });

        return {
            keyword,
            page,
            total: results.length,
            plugins,
            list: results
        };
    }

    async getMedia(params = {}) {
        const pluginName = normalizeText(params.plugin);
        const trackId = normalizeText(params.id);
        const preferredQuality = normalizeText(params.quality);

        if (!pluginName) {
            throw createHttpError(400, '缺少插件名称', 'MUSIC_PLUGIN_REQUIRED');
        }

        if (!trackId) {
            throw createHttpError(400, '缺少歌曲 ID', 'MUSIC_TRACK_ID_REQUIRED');
        }

        const playbackRestriction = getPluginPlaybackRestriction(pluginName);
        if (playbackRestriction) {
            throw createHttpError(501, playbackRestriction, 'MUSIC_MEDIA_DISABLED_FOR_PLUGIN');
        }

        const plugin = await this.loadPlugin(pluginName);
        if (typeof plugin.getMediaSource !== 'function') {
            throw createHttpError(501, `插件 ${pluginName} 暂不支持获取播放地址`, 'MUSIC_MEDIA_UNSUPPORTED');
        }

        const track = await this.getTrackInfo(pluginName, trackId);
        const quality = pickQuality(track.raw.qualities, preferredQuality || track.normalized.defaultQuality);
        const primaryAttempt = await this.getMediaSourceWithPluginReload(pluginName, track.raw, quality);
        let media = primaryAttempt.media;
        let originalError = primaryAttempt.error;

        if ((!media || !media.url) && PLUGIN_MEDIA_ALIAS[pluginName]) {
            media = await this.getMediaFromAliasPlugin(PLUGIN_MEDIA_ALIAS[pluginName], track, quality);
        }

        if ((!media || !media.url) && PLUGIN_MEDIA_SEARCH_ALIAS[pluginName]) {
            media = await this.getMediaFromSearchAliasPlugin(PLUGIN_MEDIA_SEARCH_ALIAS[pluginName], track, quality);
        }

        if (!media || !media.url) {
            throw createHttpError(502, '插件未返回可播放地址', 'MUSIC_MEDIA_EMPTY', {
                details: originalError?.message || ''
            });
        }

        return {
            plugin: pluginName,
            quality: media.quality || quality,
            track: track.normalized,
            media: {
                url: String(media.url),
                size: Number(media.size) || 0,
                quality: media.quality || quality
            }
        };
    }

    async getMediaSourceWithPluginReload(pluginName, track, quality) {
        let media = null;
        let originalError = null;
        let plugin = await this.loadPlugin(pluginName);

        try {
            media = await plugin.getMediaSource(track, quality);
        } catch (error) {
            originalError = error;
        }

        if (media && media.url) {
            return { media, error: originalError };
        }

        this.invalidatePluginRuntime(pluginName);
        plugin = await this.loadPlugin(pluginName, { forceReload: true });

        try {
            media = await plugin.getMediaSource(track, quality);
        } catch (error) {
            if (!originalError) {
                originalError = error;
            }
        }

        return { media, error: originalError };
    }

    async getMediaFromAliasPlugin(aliasPluginName, track, quality) {
        let aliasPlugin = await this.loadPlugin(aliasPluginName);
        let aliasTrack = track.raw;

        if (typeof aliasPlugin.getMusicInfo === 'function') {
            try {
                const info = await aliasPlugin.getMusicInfo({ id: track.normalized.id });
                if (info && info.id) {
                    aliasTrack = info;
                }
            } catch (error) {
                // 某些别名插件本身没有详情接口，保留搜索结果原始对象继续兜底
            }
        }

        if (typeof aliasPlugin.getMediaSource !== 'function') {
            return null;
        }

        const response = await this.getMediaSourceWithPluginReload(aliasPluginName, aliasTrack, quality);
        return response.media || null;
    }

    async getMediaFromSearchAliasPlugin(aliasPluginName, track, quality) {
        const aliasPlugin = await this.loadPlugin(aliasPluginName);
        if (typeof aliasPlugin.search !== 'function' || typeof aliasPlugin.getMediaSource !== 'function') {
            return null;
        }

        const keyword = [track.normalized.title, track.normalized.artist].filter(Boolean).join(' ');
        if (!keyword) {
            return null;
        }

        const response = await aliasPlugin.search(keyword, 1, 'music');
        const candidates = Array.isArray(response?.data) ? response.data.filter(item => item && item.id) : [];
        const matched = this.findSearchAliasTrack(candidates, track.normalized);
        if (!matched) {
            return null;
        }

        const matchedQuality = pickQuality(matched.qualities, quality || 'standard');
        const mediaResponse = await this.getMediaSourceWithPluginReload(aliasPluginName, matched, matchedQuality);
        return mediaResponse.media || null;
    }

    findSearchAliasTrack(candidates, sourceTrack) {
        return this.findBestTrackCandidate(candidates, sourceTrack, {
            minScore: 5,
            requireId: true
        });
    }

    findLyricCandidate(candidates, sourceTrack) {
        return this.findBestTrackCandidate(candidates, sourceTrack, {
            minScore: sourceTrack.artist ? 5 : 4,
            requireId: false
        });
    }

    rankTrackCandidates(candidates, sourceTrack, options = {}) {
        const sourceTitle = normalizeMatchText(sourceTrack.title);
        const sourceArtist = normalizeMatchText(sourceTrack.artist);
        const sourceAlbum = normalizeMatchText(sourceTrack.album);
        const requireId = Boolean(options.requireId);

        return candidates
            .filter(item => item && (!requireId || item.id))
            .map(item => {
                const title = normalizeMatchText(item.title || item.name);
                const artist = normalizeMatchText(item.artist || item.singer || item.author);
                const album = normalizeMatchText(item.album || item.albumName);
                let score = 0;

                if (title && sourceTitle && title === sourceTitle) {
                    score += 4;
                } else if (title && sourceTitle && (title.includes(sourceTitle) || sourceTitle.includes(title))) {
                    score += 2;
                }

                if (artist && sourceArtist && (artist.includes(sourceArtist) || sourceArtist.includes(artist))) {
                    score += 3;
                }

                if (album && sourceAlbum && (album === sourceAlbum || album.includes(sourceAlbum) || sourceAlbum.includes(album))) {
                    score += 1;
                }

                return {
                    item,
                    score
                };
            })
            .sort((left, right) => right.score - left.score);
    }

    findBestTrackCandidate(candidates, sourceTrack, options = {}) {
        const minScore = Number(options.minScore) || 5;
        const scored = this.rankTrackCandidates(candidates, sourceTrack, options);
        const best = scored[0];
        return best && best.score >= minScore ? best.item : null;
    }

    async getLyric(params = {}) {
        const pluginName = normalizeText(params.plugin);
        const trackId = normalizeText(params.id);

        if (!pluginName) {
            throw createHttpError(400, '缺少插件名称', 'MUSIC_PLUGIN_REQUIRED');
        }

        if (!trackId) {
            throw createHttpError(400, '缺少歌曲 ID', 'MUSIC_TRACK_ID_REQUIRED');
        }

        const cacheKey = `${pluginName}:${trackId}`;
        const cached = this.lyricCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.value;
        }

        const track = await this.getTrackInfo(pluginName, trackId);
        let lyricPluginName = pluginName;
        let lyric = null;

        try {
            lyric = await this.getLyricFromTrackPlugin(pluginName, track);
        } catch (error) {
            if (error?.statusCode && error.code !== 'MUSIC_LYRIC_UNSUPPORTED') {
                console.warn(`[music-lyric] 主插件 ${pluginName} 获取歌词失败：${error.message}`);
            }
        }

        if (!hasUsableLyricContent(lyric)) {
            const fallback = await this.getLyricFromFallbackPlugins(track, pluginName);
            if (fallback) {
                lyricPluginName = fallback.pluginName;
                lyric = fallback.lyric;
            }
        }

        const value = {
            plugin: lyricPluginName,
            requestedPlugin: pluginName,
            fallback: lyricPluginName !== pluginName,
            track: track.normalized,
            lyric: {
                rawLrc: String(lyric?.rawLrc || ''),
                translation: String(lyric?.translation || '')
            }
        };

        this.lyricCache.set(cacheKey, {
            value,
            expiresAt: Date.now() + LYRIC_CACHE_TTL
        });

        return value;
    }

    async getLyricPluginNames() {
        const catalog = await this.getPluginCatalog();
        return catalog
            .filter(plugin => plugin.kind === 'lyric')
            .map(plugin => plugin.name);
    }

    async getLyricFromTrackPlugin(pluginName, track) {
        const plugin = await this.loadPlugin(pluginName);
        if (typeof plugin.getLyric !== 'function') {
            throw createHttpError(501, `插件 ${pluginName} 暂不支持歌词`, 'MUSIC_LYRIC_UNSUPPORTED');
        }

        return plugin.getLyric(track.raw);
    }

    async getLyricFromFallbackPlugins(track, requestedPluginName) {
        const lyricPluginNames = await this.getLyricPluginNames();

        for (const pluginName of lyricPluginNames) {
            if (!pluginName || pluginName === requestedPluginName) {
                continue;
            }

            try {
                const lyric = await this.getLyricFromLyricPlugin(pluginName, track);
                if (hasUsableLyricContent(lyric)) {
                    return {
                        pluginName,
                        lyric
                    };
                }
            } catch (error) {
                if (!this.isIgnorableLyricFallbackError(error)) {
                    console.warn(`[music-lyric] 兜底插件 ${pluginName} 获取歌词失败：${error.message}`);
                }
            }
        }

        return null;
    }

    async getLyricFromLyricPlugin(pluginName, track) {
        const plugin = await this.loadPlugin(pluginName);
        if (typeof plugin.getLyric !== 'function') {
            return null;
        }

        if (typeof plugin.search === 'function') {
            const keyword = [track.normalized.title, track.normalized.artist].filter(Boolean).join(' ');
            for (const searchArgs of [
                ['lyric'],
                []
            ]) {
                if (!keyword) {
                    break;
                }

                try {
                    const response = await plugin.search(keyword, 1, ...searchArgs);
                    const candidates = Array.isArray(response?.data) ? response.data.filter(Boolean) : [];
                    const rankedCandidates = this.rankTrackCandidates(candidates, track.normalized, {
                        minScore: track.normalized.artist ? 5 : 4,
                        requireId: false
                    }).filter(item => item.score >= (track.normalized.artist ? 5 : 4));

                    for (const candidate of rankedCandidates.slice(0, 3)) {
                        if (!this.canUseLyricCandidate(pluginName, candidate.item)) {
                            continue;
                        }

                        try {
                            const lyric = await plugin.getLyric(candidate.item);
                            if (hasUsableLyricContent(lyric)) {
                                return lyric;
                            }
                        } catch (error) {
                            if (!this.isIgnorableLyricFallbackError(error)) {
                                throw error;
                            }
                        }
                    }
                } catch (error) {
                    if (!this.isIgnorableLyricFallbackError(error)) {
                        // 不同歌词插件支持的搜索方式不一致，继续尝试下一种
                    }
                }
            }
        }

        return null;
    }

    canUseLyricCandidate(pluginName, candidate) {
        if (!candidate || typeof candidate !== 'object') {
            return false;
        }

        const locatorFields = [
            candidate.url,
            candidate.link,
            candidate.href,
            candidate.id
        ];

        if (['歌词网', '歌词千寻'].includes(pluginName)) {
            return locatorFields.some(isAbsoluteHttpUrl);
        }

        return Boolean(
            candidate.id ||
            candidate.url ||
            candidate.link ||
            candidate.href ||
            candidate.lyric ||
            candidate.rawLrc
        );
    }

    isIgnorableLyricFallbackError(error) {
        const text = [
            error?.message,
            error?.details,
            error?.code,
            error?.cause?.message,
            error?.cause?.code
        ].filter(Boolean).join(' ');

        return /Invalid URL|ERR_INVALID_URL|MUSIC_LYRIC_UNSUPPORTED/i.test(text);
    }

    async getTrack(params = {}) {
        const pluginName = normalizeText(params.plugin);
        const trackId = normalizeText(params.id);

        if (!pluginName) {
            throw createHttpError(400, '缺少插件名称', 'MUSIC_PLUGIN_REQUIRED');
        }

        if (!trackId) {
            throw createHttpError(400, '缺少歌曲 ID', 'MUSIC_TRACK_ID_REQUIRED');
        }

        const track = await this.getTrackInfo(pluginName, trackId);
        return {
            plugin: pluginName,
            track: track.normalized
        };
    }

    async getRecommendations(params = {}) {
        return this.getRecommendationTopListDetail(params);
    }

    async getRecommendationTopLists(params = {}) {
        const pluginName = normalizeText(params.plugin);
        if (!pluginName || pluginName === 'all') {
            throw createHttpError(400, '推荐歌曲需要指定插件', 'MUSIC_RECOMMEND_PLUGIN_REQUIRED');
        }

        const plugin = await this.loadPlugin(pluginName);
        if (typeof plugin.getTopLists !== 'function' || typeof plugin.getTopListDetail !== 'function') {
            throw createHttpError(501, `插件 ${pluginName} 暂不支持推荐歌曲`, 'MUSIC_RECOMMEND_UNSUPPORTED');
        }

        const topLists = await plugin.getTopLists();
        const groups = normalizeTopListGroups(topLists);
        const firstGroup = groups.find(group => Array.isArray(group?.data) && group.data.length > 0);
        const firstItem = firstGroup?.data?.find(Boolean);

        if (!firstItem) {
            throw createHttpError(404, `插件 ${pluginName} 暂无可用推荐榜单`, 'MUSIC_RECOMMEND_EMPTY');
        }

        return {
            plugin: pluginName,
            defaultTopListId: String(firstItem.id),
            groups: groups.map(group => ({
                title: group.title,
                data: group.data.map(item => ({
                    id: item.id,
                    title: item.title,
                    description: item.description,
                    coverImg: item.coverImg
                }))
            }))
        };
    }

    async getRecommendationTopListDetail(params = {}) {
        const pluginName = normalizeText(params.plugin);
        const requestedTopListId = normalizeText(params.topListId || params.top_list_id);
        if (!pluginName || pluginName === 'all') {
            throw createHttpError(400, '推荐歌曲需要指定插件', 'MUSIC_RECOMMEND_PLUGIN_REQUIRED');
        }

        const plugin = await this.loadPlugin(pluginName);
        if (typeof plugin.getTopLists !== 'function' || typeof plugin.getTopListDetail !== 'function') {
            throw createHttpError(501, `插件 ${pluginName} 暂不支持推荐歌曲`, 'MUSIC_RECOMMEND_UNSUPPORTED');
        }

        const topLists = await plugin.getTopLists();
        const groups = normalizeTopListGroups(topLists, { includeRaw: true });
        const firstGroup = groups.find(group => Array.isArray(group?.data) && group.data.length > 0);
        const firstItem = firstGroup?.data?.find(Boolean);
        const selected = requestedTopListId
            ? groups
                .flatMap(group => group.data || [])
                .find(item => String(item.id) === requestedTopListId)
            : (firstItem ? { ...firstItem, groupTitle: firstGroup?.title || '推荐榜单' } : null);

        if (!selected) {
            throw createHttpError(404, `插件 ${pluginName} 暂无可用推荐榜单`, 'MUSIC_RECOMMEND_EMPTY');
        }

        const detail = await plugin.getTopListDetail(selected.raw || selected);
        const rawList = Array.isArray(detail?.musicList) ? detail.musicList : [];
        const list = rawList
            .filter(item => item && item.id)
            .map(item => this.storeTrackInfo(pluginName, item).normalized);

        if (list.length === 0) {
            throw createHttpError(404, `插件 ${pluginName} 推荐榜单暂无歌曲`, 'MUSIC_RECOMMEND_TRACKS_EMPTY');
        }

        return {
            plugin: pluginName,
            source: {
                groupTitle: normalizeText(selected.groupTitle || '推荐榜单'),
                title: normalizeText(selected.title || '热门推荐'),
                description: normalizeText(selected.description || detail?.description || ''),
                coverImg: normalizeArtwork(selected.coverImg || detail?.coverImg || ''),
                topListId: String(selected.id)
            },
            total: list.length,
            list
        };
    }

    async getEnabledPluginNames() {
        const catalog = await this.getPluginCatalog();
        return catalog
            .filter(plugin => plugin.recommended)
            .map(plugin => plugin.name);
    }

    async getPluginCatalog() {
        const now = Date.now();
        if (this.pluginIndexCache.value && this.pluginIndexCache.expiresAt > now) {
            return this.pluginIndexCache.value;
        }

        const payload = await this.fetchJson(MUSIC_PLUGIN_INDEX_URL, {
            ttl: PLUGIN_INDEX_TTL,
            cacheKey: 'plugin-index'
        });
        const remotePlugins = Array.isArray(payload?.plugins)
            ? payload.plugins.filter(item => !PLUGIN_REMOVE_BLOCKLIST[item?.name])
            : [];
        const mergedPlugins = new Map();

        remotePlugins.forEach(item => {
            if (!item?.name) {
                return;
            }
            mergedPlugins.set(item.name, item);
        });

        MANUAL_PLUGIN_CATALOG.forEach(item => {
            if (!item?.name || !item?.url) {
                return;
            }
            mergedPlugins.set(item.name, {
                ...mergedPlugins.get(item.name),
                ...item
            });
        });

        const catalog = Array.from(mergedPlugins.values()).map(item => {
            const allowlistItem = PLUGIN_ALLOWLIST[item.name];
            const kind = inferPluginKind(item.name, item.url || '');
            const recommended = Boolean(allowlistItem);
            const playbackRestriction = getPluginPlaybackRestriction(item.name);
            return {
                name: item.name,
                version: item.version || '',
                url: item.url || '',
                kind,
                kindLabel: getPluginKindLabel(kind),
                enabled: recommended,
                recommended,
                sourceType: recommended ? 'recommended' : 'catalog',
                reason: recommended
                    ? allowlistItem.note
                    : playbackRestriction || `目录已接入，当前归类为${getPluginKindLabel(kind)}插件`,
                supportedSearchTypes: kind === 'music' ? ['music'] : [],
                searchable: kind === 'music',
                playable: kind === 'music' && !playbackRestriction
            };
        }).sort((left, right) => {
            if (left.recommended !== right.recommended) {
                return left.recommended ? -1 : 1;
            }

            if (left.searchable !== right.searchable) {
                return left.searchable ? -1 : 1;
            }

            return String(left.name || '').localeCompare(String(right.name || ''), 'zh-Hans-CN');
        });

        this.pluginIndexCache = {
            value: catalog,
            expiresAt: now + PLUGIN_INDEX_TTL
        };

        return catalog;
    }

    async getPluginMeta(pluginName) {
        const catalog = await this.getPluginCatalog();
        const plugin = catalog.find(item => item.name === pluginName);

        if (!plugin) {
            throw createHttpError(404, `未找到插件：${pluginName}`, 'MUSIC_PLUGIN_NOT_FOUND');
        }

        return plugin;
    }

    async searchWithPlugin(pluginName, keyword, page) {
        const plugin = await this.loadPlugin(pluginName);
        if (typeof plugin.search !== 'function') {
            throw createHttpError(501, `插件 ${pluginName} 不支持搜索`, 'MUSIC_PLUGIN_SEARCH_UNSUPPORTED');
        }

        const searchType = Array.isArray(plugin.supportedSearchType) && plugin.supportedSearchType.includes('music')
            ? 'music'
            : 'music';

        const response = await plugin.search(keyword, page, searchType);
        const list = Array.isArray(response?.data) ? response.data : [];

        return {
            isEnd: Boolean(response?.isEnd),
            results: list
                .filter(item => item && item.id)
                .map(item => this.storeTrackInfo(pluginName, item).normalized)
        };
    }

    async getTrackInfo(pluginName, trackId) {
        const cacheKey = `${pluginName}:${trackId}`;
        const cached = this.trackInfoCache.get(cacheKey);
        const now = Date.now();
        if (cached && cached.expiresAt > now) {
            return cached.value;
        }

        const plugin = await this.loadPlugin(pluginName);
        if (typeof plugin.getMusicInfo !== 'function') {
            if (cached && cached.staleUntil > now) {
                return cached.value;
            }
            throw createHttpError(501, `插件 ${pluginName} 不支持读取歌曲详情，请先执行搜索`, 'MUSIC_INFO_UNSUPPORTED');
        }

        try {
            const info = await plugin.getMusicInfo({ id: trackId });
            if (!info || !info.id) {
                throw createHttpError(404, '未找到歌曲详情', 'MUSIC_INFO_NOT_FOUND');
            }

            return this.storeTrackInfo(pluginName, info);
        } catch (error) {
            const fallback = this.trackInfoCache.get(cacheKey);
            if (fallback && fallback.staleUntil > now) {
                return fallback.value;
            }

            if (error?.statusCode) {
                throw error;
            }

            throw createHttpError(502, `插件 ${pluginName} 读取歌曲详情失败`, 'MUSIC_INFO_FETCH_FAILED', {
                details: error.message
            });
        }
    }

    normalizeTrackItem(item, pluginName) {
        const qualityMap = item?.qualities || {};
        const qualityKeys = Object.keys(qualityMap);
        const playbackRestriction = getPluginPlaybackRestriction(pluginName);
        const title = pickFirstText(
            item?.title,
            item?.name,
            item?.songName,
            item?.songname,
            item?.musicName,
            item?.musicname,
            item?.trackName,
            item?.trackname,
            item?.songTitle,
            item?.songtitle,
            item?.raw?.title,
            item?.raw?.name
        ) || '未命名歌曲';
        const artist = pickFirstText(
            item?.artist,
            item?.singer,
            item?.author,
            item?.subtitle,
            item?.artists,
            item?.artistName,
            item?.artistname,
            item?.raw?.artist,
            item?.raw?.singer
        ) || '未知歌手';
        const album = pickFirstText(
            item?.album,
            item?.albumName,
            item?.albumname,
            item?.collection,
            item?.raw?.album
        );
        let resolvedTitle = title;
        let resolvedArtist = artist;

        if (pluginName === '爱听' && resolvedTitle === '未命名歌曲') {
            const combined = splitCombinedTrackText(resolvedArtist);
            if (combined?.title) {
                resolvedTitle = combined.title;
                resolvedArtist = combined.artist || resolvedArtist;
            }
        }

        return {
            id: String(item.id || ''),
            plugin: pluginName,
            title: resolvedTitle,
            artist: resolvedArtist,
            album,
            artwork: normalizeArtwork(item.artwork),
            duration: Number(item.duration) || 0,
            durationText: formatDuration(item.duration),
            defaultQuality: pickQuality(qualityMap, PLUGIN_ALLOWLIST[pluginName]?.defaultQuality || 'standard'),
            playable: !playbackRestriction,
            playableReason: playbackRestriction,
            qualities: qualityKeys.map(quality => ({
                key: quality,
                size: Number(qualityMap[quality]?.size) || 0
            }))
        };
    }

    storeTrackInfo(pluginName, item) {
        const value = {
            raw: item,
            normalized: this.normalizeTrackItem(item, pluginName)
        };

        this.trackInfoCache.set(`${pluginName}:${value.normalized.id}`, {
            value,
            expiresAt: Date.now() + TRACK_CACHE_TTL,
            staleUntil: Date.now() + TRACK_CACHE_STALE_FALLBACK_TTL
        });

        return value;
    }

    invalidatePluginRuntime(pluginName) {
        this.pluginRuntimeCache.delete(pluginName);
    }

    async loadPlugin(pluginName, options = {}) {
        if (options.forceReload) {
            this.invalidatePluginRuntime(pluginName);
        }

        if (this.pluginRuntimeCache.has(pluginName)) {
            return this.pluginRuntimeCache.get(pluginName);
        }

        const pluginMeta = await this.getPluginMeta(pluginName);
        const code = await this.fetchText(pluginMeta.url, {
            ttl: PLUGIN_CODE_TTL,
            cacheKey: `plugin-code:${pluginName}`
        });

        const plugin = this.evaluatePluginCode(code, pluginName);
        this.pluginRuntimeCache.set(pluginName, plugin);
        return plugin;
    }

    evaluatePluginCode(code, pluginName) {
        const sanitizedCode = this.sanitizePluginCode(code, pluginName);
        const moduleObject = { exports: {} };
        const sandbox = {
            module: moduleObject,
            exports: moduleObject.exports,
            require: (moduleName) => this.resolvePluginRequire(moduleName),
            console,
            env: {
                getUserVariables() {
                    return {
                        music_u: '',
                        ikun_key: '',
                        source: ''
                    };
                }
            },
            Buffer,
            URL,
            setTimeout,
            clearTimeout
        };

        vm.runInNewContext(sanitizedCode, sandbox, {
            filename: `${pluginName}.plugin.js`
        });

        const exported = this.normalizePluginModule(moduleObject.exports);

        if (!exported || typeof exported !== 'object') {
            throw createHttpError(500, `插件 ${pluginName} 加载失败`, 'MUSIC_PLUGIN_LOAD_FAILED');
        }

        return this.wrapPluginRuntime(exported, pluginName);
    }

    normalizePluginModule(exported) {
        if (!exported || typeof exported !== 'object') {
            return exported;
        }

        if (typeof exported.search === 'function' || typeof exported.getMediaSource === 'function') {
            return exported;
        }

        const defaultExport = exported.default;
        if (defaultExport && typeof defaultExport === 'object') {
            if (typeof defaultExport.search === 'function' || typeof defaultExport.getMediaSource === 'function') {
                return defaultExport;
            }
        }

        return exported;
    }

    wrapPluginRuntime(plugin, pluginName) {
        if (!plugin || typeof plugin !== 'object') {
            return plugin;
        }

        const wrapped = { ...plugin };

        Object.keys(plugin).forEach(methodName => {
            const original = plugin[methodName];
            if (typeof original !== 'function') {
                return;
            }

            wrapped[methodName] = async (...args) => {
                try {
                    return await original.apply(plugin, args);
                } catch (error) {
                    if (error?.statusCode) {
                        throw error;
                    }

                    console.error(`[music-plugin] ${pluginName}.${methodName} 执行失败:`, error);
                    throw createHttpError(502, `插件 ${pluginName} 执行失败`, 'MUSIC_PLUGIN_RUNTIME_ERROR', {
                        details: `${methodName}: ${error?.message || String(error)}`,
                        plugin: pluginName,
                        pluginMethod: methodName
                    });
                }
            };
        });

        return wrapped;
    }

    sanitizePluginCode(code, pluginName) {
        let sanitized = String(code || '');

        // 某些第三方插件会把本地调试代码一起发布出来，加载时会主动发起搜索/歌词请求并导致进程异常。
        sanitized = sanitized.replace(
            /\n\$[\w$]+var\$search\("童话镇",\s*1,\s*"music"\)\.then\(\(res\)=>\{[\s\S]*?\n\}\);\s*/g,
            '\n'
        );

        if (sanitized !== code) {
            console.warn(`已移除插件 ${pluginName} 的顶层调试代码`);
        }

        if (pluginName === '酷狗') {
            const kugouPatched = sanitized.replace(
                'const validMusicFilter = (_) => _.privilege === 0 || _.privilege === 8;',
                'const validMusicFilter = (_) => [0, 8, 10].includes(Number(_.privilege));'
            );

            if (kugouPatched !== sanitized) {
                sanitized = kugouPatched;
                console.warn('已兼容修正插件 酷狗 的搜索过滤条件');
            }
        }

        return sanitized;
    }

    resolvePluginRequire(moduleName) {
        if (moduleName === 'axios') {
            return this.createCurlAxiosCompat();
        }

        if (moduleName === 'dayjs') {
            return require(path.join(this.rootDir, 'vendor', 'musicfree-shims', 'dayjs.js'));
        }

        if (moduleName === 'crypto-js') {
            return require(path.join(this.rootDir, 'vendor', 'musicfree-shims', 'crypto-js.js'));
        }

        if (moduleName === 'he') {
            return require(path.join(this.rootDir, 'vendor', 'musicfree-shims', 'he.js'));
        }

        if (moduleName === 'qs') {
            return require(path.join(this.rootDir, 'vendor', 'musicfree-shims', 'qs.js'));
        }

        if (moduleName === 'big-integer') {
            return require(path.join(this.rootDir, 'vendor', 'musicfree-shims', 'big-integer.js'));
        }

        return require(moduleName);
    }

    createCurlAxiosCompat() {
        const instance = (config) => this.curlRequestAsAxios(config);
        instance.get = (url, config = {}) => this.curlRequestAsAxios({ ...config, url, method: 'GET' });
        instance.post = (url, data, config = {}) => this.curlRequestAsAxios({ ...config, url, data, method: 'POST' });
        instance.request = (config = {}) => this.curlRequestAsAxios(config);
        instance.create = () => instance;
        instance.default = instance;
        instance.__esModule = true;
        instance.interceptors = {
            request: {
                use() {
                    return 0;
                }
            },
            response: {
                use() {
                    return 0;
                }
            }
        };
        return instance;
    }

    async curlRequestAsAxios(config = {}) {
        const response = await this.requestWithCurl(config);
        let data = response.body;

        if (typeof data === 'string') {
            try {
                data = JSON.parse(data);
            } catch (error) {
                // 保持原始文本，交给插件自行处理
            }
        }

        return {
            data,
            status: response.statusCode,
            headers: {
                'content-type': response.contentType
            },
            config
        };
    }

    async fetchJson(url, options = {}) {
        const text = await this.fetchText(url, options);
        try {
            return JSON.parse(text);
        } catch (error) {
            throw createHttpError(502, '音乐插件目录解析失败', 'MUSIC_PLUGIN_INDEX_INVALID_JSON', {
                details: error.message
            });
        }
    }

    async fetchText(url, options = {}) {
        const cacheKey = options.cacheKey || url;
        const cached = this.remoteTextCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.value;
        }

        const response = await this.requestWithCurl({
            url,
            method: 'GET',
            headers: {
                ...DEFAULT_PLUGIN_REQUEST_HEADERS
            },
            timeoutSeconds: 25
        });

        if (response.statusCode < 200 || response.statusCode >= 300) {
            throw createHttpError(502, `拉取远程资源失败：HTTP ${response.statusCode}`, 'MUSIC_REMOTE_FETCH_FAILED', {
                upstream: url
            });
        }

        this.remoteTextCache.set(cacheKey, {
            value: response.body,
            expiresAt: Date.now() + Number(options.ttl || PLUGIN_CODE_TTL)
        });

        return response.body;
    }

    async requestWithCurl(config = {}) {
        const targetUrl = config.url;
        if (!targetUrl) {
            throw createHttpError(500, '缺少请求地址', 'MUSIC_CURL_URL_REQUIRED');
        }

        const urlObject = new URL(targetUrl);
        const mergedHeaders = {
            ...DEFAULT_PLUGIN_REQUEST_HEADERS,
            ...(config.headers || {})
        };

        if (!mergedHeaders.Referer) {
            mergedHeaders.Referer = `${urlObject.protocol}//${urlObject.host}/`;
        }

        if (!mergedHeaders.Origin && /^https?:$/i.test(urlObject.protocol)) {
            mergedHeaders.Origin = `${urlObject.protocol}//${urlObject.host}`;
        }

        const params = config.params || {};
        Object.entries(params).forEach(([key, value]) => {
            if (value === undefined || value === null || value === '') {
                return;
            }
            urlObject.searchParams.set(key, String(value));
        });

        const method = String(config.method || 'GET').toUpperCase();
        const curlArgs = [
            '-L',
            '-sS',
            '--globoff',
            '--compressed',
            '--max-time', String(Number(config.timeoutSeconds || 25)),
            '-X', method
        ];

        if (this.systemProxyUrl) {
            curlArgs.push('--proxy', this.systemProxyUrl);
        }

        Object.entries(mergedHeaders).forEach(([key, value]) => {
            if (value === undefined || value === null || value === '') {
                return;
            }
            curlArgs.push('-H', `${key}: ${value}`);
        });

        if (config.data !== undefined && config.data !== null) {
            const body = typeof config.data === 'string'
                ? config.data
                : JSON.stringify(config.data);
            curlArgs.push('--data-raw', body);
        }

        curlArgs.push(
            '-w',
            '\n__FG_STATUS__:%{http_code}\n__FG_CONTENT_TYPE__:%{content_type}\n',
            urlObject.toString()
        );

        return new Promise((resolve, reject) => {
            execFile('curl', curlArgs, {
                encoding: 'utf8',
                maxBuffer: 12 * 1024 * 1024
            }, (error, stdout) => {
                if (error) {
                    reject(createHttpError(502, '音乐插件网络请求失败', 'MUSIC_CURL_REQUEST_FAILED', {
                        details: error.message,
                        upstream: urlObject.toString()
                    }));
                    return;
                }

                const matched = stdout.match(/\n__FG_STATUS__:(\d{3})\n__FG_CONTENT_TYPE__:(.*)\n?$/s);
                if (!matched) {
                    reject(createHttpError(502, '无法解析音乐插件网络响应', 'MUSIC_CURL_RESPONSE_INVALID', {
                        upstream: urlObject.toString()
                    }));
                    return;
                }

                resolve({
                    statusCode: Number(matched[1]),
                    contentType: String(matched[2] || '').trim(),
                    body: stdout.slice(0, matched.index)
                });
            });
        });
    }
}

function createMusicPluginService(options = {}) {
    return new MusicPluginService(options);
}

module.exports = {
    createMusicPluginService
};
