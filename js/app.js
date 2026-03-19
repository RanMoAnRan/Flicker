const CONFIG = {
    PROXY_URL: '/api/proxy',
    DEFAULT_SOURCES: [
        { id: 1, name: '资源1', url: 'http://sdzyapi.com/api.php/provide/vod/', active: false },
        { id: 2, name: '百度', url: 'https://api.apibdzy.com/api.php/provide/vod/', active: false },
        { id: 3, name: '量子影视', url: 'https://cj.lziapi.com/api.php/provide/vod/', active: true },
        { id: 4, name: '量子资讯', url: 'https://cj.lziapi.com/api.php/provide/art/', active: false },
        { id: 5, name: '红牛影视', url: 'https://www.hongniuzy2.com/api.php/provide/vod/', active: false },
        { id: 6, name: '红牛M3U8', url: 'https://www.hongniuzy2.com/api.php/provide/vod/from/hnm3u8/', active: false },
        { id: 7, name: '红牛云播', url: 'https://www.hongniuzy2.com/api.php/provide/vod/from/hnyun/', active: false }
    ],
    STORAGE_KEYS: {
        SOURCES: 'dianying_sources',
        CURRENT_SOURCE: 'dianying_current_source',
        POSTER_CACHE: 'dianying_poster_cache',
        THEME: 'fuguang_theme'
    }
};

const Storage = {
    get(key) {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error('Storage get error:', error);
            return null;
        }
    },

    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error('Storage set error:', error);
            return false;
        }
    },

    remove(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (error) {
            return false;
        }
    }
};

const ThemeManager = {
    getTheme() {
        const savedTheme = Storage.get(CONFIG.STORAGE_KEYS.THEME);
        return savedTheme === 'light' ? 'light' : 'dark';
    },

    applyTheme(theme) {
        document.documentElement.dataset.theme = theme;
    },

    setTheme(theme) {
        const nextTheme = theme === 'light' ? 'light' : 'dark';
        Storage.set(CONFIG.STORAGE_KEYS.THEME, nextTheme);
        this.applyTheme(nextTheme);
        this.updateToggleLabels(nextTheme);
    },

    toggleTheme() {
        const currentTheme = this.getTheme();
        this.setTheme(currentTheme === 'light' ? 'dark' : 'light');
    },

    updateToggleLabels(theme) {
        document.querySelectorAll('.theme-toggle').forEach(button => {
            const isLight = theme === 'light';
            button.setAttribute('aria-label', isLight ? '切换到暗色主题' : '切换到亮色主题');
            button.innerHTML = `
                <span class="theme-toggle-mark">${isLight ? '月' : '光'}</span>
                <span class="theme-toggle-copy">
                    <strong>${isLight ? '暗色' : '亮色'}</strong>
                    <em>${isLight ? 'Night' : 'Light'}</em>
                </span>
            `;
        });
    },

    ensureToggle() {
        const headerRight = document.querySelector('.header-right');
        if (!headerRight || headerRight.querySelector('.theme-toggle')) {
            return;
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'theme-toggle';
        button.addEventListener('click', () => {
            this.toggleTheme();
        });

        const searchBox = headerRight.querySelector('.music-nav-search, .cinematic-search, .search-box');
        if (searchBox && searchBox.nextSibling) {
            headerRight.insertBefore(button, searchBox.nextSibling);
            return;
        }

        if (searchBox) {
            headerRight.appendChild(button);
            return;
        }

        if (document.body.classList.contains('music-page')) {
            const musicSearch = headerRight.querySelector('.music-nav-search');
            if (musicSearch && musicSearch.nextSibling) {
                headerRight.insertBefore(button, musicSearch.nextSibling);
                return;
            }

            if (musicSearch) {
                headerRight.appendChild(button);
                return;
            }
        }

        headerRight.insertBefore(button, headerRight.firstChild);
    },

    init() {
        const theme = this.getTheme();
        this.applyTheme(theme);
        this.ensureToggle();
        this.updateToggleLabels(theme);
    }
};

function escapeHtml(value) {
    const stringValue = String(value ?? '');
    return stringValue
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function stripHtml(value) {
    return String(value ?? '').replace(/<[^>]*>/g, '').trim();
}

function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeKeyText(value) {
    return normalizeText(value).toLowerCase();
}

function truncateText(value, maxLength = 80) {
    const text = normalizeText(value);
    if (!text) {
        return '';
    }
    return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function resolveMediaUrl(value, baseUrl = '') {
    const source = String(value ?? '').trim();
    if (!source) {
        return '';
    }

    if (source.startsWith('//')) {
        return `https:${source}`;
    }

    try {
        return new URL(source, baseUrl || window.location.origin).toString();
    } catch (error) {
        return source;
    }
}

function normalizeSourceUrl(url) {
    try {
        const parsedUrl = new URL(url, window.location.origin);
        parsedUrl.search = '';
        parsedUrl.hash = '';
        let normalized = parsedUrl.toString();
        if (!normalized.endsWith('/')) {
            normalized += '/';
        }
        return normalized;
    } catch (error) {
        return url.endsWith('/') ? url : `${url}/`;
    }
}

function scoreVodItemForDedup(item) {
    let score = 0;
    if (item?.vod_pic) score += 4;
    if (item?.vod_content) score += 4;
    if (item?.playable) score += 3;
    if (item?.vod_play_url) score += 3;
    if (item?.vod_remarks) score += 2;
    if (item?.vod_actor) score += 1;
    if (item?.vod_director) score += 1;
    return score;
}

function createSingleSourceDedupKey(item) {
    if (!item) {
        return '';
    }

    if (item.kind === 'art') {
        return [
            'art',
            normalizeKeyText(item.vod_name),
            normalizeKeyText(item.vod_time),
            normalizeKeyText(item.type_name),
            normalizeKeyText(item.art_author || item.art_from)
        ].join('::');
    }

    return [
        'vod',
        normalizeKeyText(item.vod_name),
        normalizeKeyText(item.type_name),
        normalizeKeyText(item.vod_en),
        normalizeKeyText(item.vod_remarks),
        normalizeKeyText(item.vod_actor),
        normalizeKeyText(item.vod_director)
    ].join('::');
}

function dedupeSingleSourceItems(items) {
    if (!Array.isArray(items) || items.length <= 1) {
        return Array.isArray(items) ? items : [];
    }

    const dedupedMap = new Map();

    items.forEach(item => {
        const key = createSingleSourceDedupKey(item);
        if (!key) {
            return;
        }

        const existing = dedupedMap.get(key);
        if (!existing) {
            dedupedMap.set(key, item);
            return;
        }

        const existingScore = scoreVodItemForDedup(existing);
        const nextScore = scoreVodItemForDedup(item);

        if (nextScore > existingScore) {
            dedupedMap.set(key, {
                ...existing,
                ...item,
                vod_pic: item.vod_pic || existing.vod_pic,
                vod_content: item.vod_content || existing.vod_content,
                vod_actor: item.vod_actor || existing.vod_actor,
                vod_director: item.vod_director || existing.vod_director,
                vod_remarks: item.vod_remarks || existing.vod_remarks
            });
            return;
        }

        dedupedMap.set(key, {
            ...item,
            ...existing,
            vod_pic: existing.vod_pic || item.vod_pic,
            vod_content: existing.vod_content || item.vod_content,
            vod_actor: existing.vod_actor || item.vod_actor,
            vod_director: existing.vod_director || item.vod_director,
            vod_remarks: existing.vod_remarks || item.vod_remarks
        });
    });

    return Array.from(dedupedMap.values());
}

function dedupeEpisodes(episodes) {
    if (!Array.isArray(episodes) || episodes.length <= 1) {
        return Array.isArray(episodes) ? episodes : [];
    }

    const seen = new Set();
    return episodes.filter(episode => {
        const key = `${normalizeKeyText(episode?.name)}::${String(episode?.url || '').trim()}`;
        if (!key || seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function mergeEpisodesByIdentity(baseEpisodes, nextEpisodes) {
    return dedupeEpisodes([...(baseEpisodes || []), ...(nextEpisodes || [])]);
}

const SourceManager = {
    getSources() {
        const sources = Storage.get(CONFIG.STORAGE_KEYS.SOURCES);
        if (!sources || sources.length === 0) {
            Storage.set(CONFIG.STORAGE_KEYS.SOURCES, CONFIG.DEFAULT_SOURCES);
            return CONFIG.DEFAULT_SOURCES;
        }
        return this.ensureBuiltinSources(sources);
    },

    ensureBuiltinSources(existingSources) {
        const normalizedExisting = [...existingSources];
        const existingUrlSet = new Set(
            normalizedExisting.map(source => normalizeSourceUrl(source.url))
        );
        let nextId = normalizedExisting.reduce((max, source) => Math.max(max, Number(source.id) || 0), 0) + 1;
        let hasChanges = false;

        CONFIG.DEFAULT_SOURCES.forEach(defaultSource => {
            const normalizedUrl = normalizeSourceUrl(defaultSource.url);
            if (existingUrlSet.has(normalizedUrl)) {
                return;
            }

            normalizedExisting.push({
                id: nextId,
                name: defaultSource.name,
                url: normalizedUrl,
                active: false
            });
            existingUrlSet.add(normalizedUrl);
            nextId += 1;
            hasChanges = true;
        });

        if (hasChanges) {
            Storage.set(CONFIG.STORAGE_KEYS.SOURCES, normalizedExisting);
        }

        return normalizedExisting;
    },

    saveSources(sources) {
        return Storage.set(CONFIG.STORAGE_KEYS.SOURCES, sources);
    },

    getCurrentSource() {
        const sources = this.getSources();
        const currentId = Storage.get(CONFIG.STORAGE_KEYS.CURRENT_SOURCE);
        if (currentId) {
            const source = sources.find(item => item.id === currentId);
            if (source) {
                return source;
            }
        }
        return sources.find(item => item.active) || sources[0];
    },

    getSourceById(sourceId) {
        const parsedId = Number(sourceId);
        if (!parsedId) {
            return null;
        }
        return this.getSources().find(source => Number(source.id) === parsedId) || null;
    },

    setCurrentSource(sourceId) {
        Storage.set(CONFIG.STORAGE_KEYS.CURRENT_SOURCE, sourceId);
    },

    addSource(name, url) {
        const sources = this.getSources();
        const maxId = sources.reduce((max, source) => Math.max(max, source.id), 0);
        const newSource = {
            id: maxId + 1,
            name: name,
            url: normalizeSourceUrl(url),
            active: false
        };
        sources.push(newSource);
        this.saveSources(sources);
        return newSource;
    },

    updateSource(id, name, url) {
        const sources = this.getSources();
        const index = sources.findIndex(source => source.id === id);
        if (index !== -1) {
            sources[index].name = name;
            sources[index].url = normalizeSourceUrl(url);
            this.saveSources(sources);
            return true;
        }
        return false;
    },

    deleteSource(id) {
        let sources = this.getSources();
        if (sources.length <= 1) {
            return false;
        }
        sources = sources.filter(source => source.id !== id);
        this.saveSources(sources);
        return true;
    }
};

const Api = {
    async request(url, params = {}, options = {}) {
        const { silent = false } = options;
        const requestUrl = new URL(url, window.location.origin);
        const finalParams = { ...params, _t: Date.now() };

        Object.entries(finalParams).forEach(([key, value]) => {
            if (value === undefined || value === null || value === '') {
                requestUrl.searchParams.delete(key);
                return;
            }

            requestUrl.searchParams.set(key, value);
        });

        const fullUrl = requestUrl.toString();
        const proxyUrl = `${CONFIG.PROXY_URL}?url=${encodeURIComponent(fullUrl)}`;

        try {
            const response = await fetch(proxyUrl, {
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache'
                }
            });

            if (!response.ok) {
                const responseText = await response.text();
                let errorMessage = `HTTP error! status: ${response.status}`;
                let errorCode = '';

                try {
                    const errorData = JSON.parse(responseText);
                    if (errorData?.error) {
                        errorMessage = errorData.error;
                    }
                    if (errorData?.details) {
                        errorMessage = `${errorMessage}：${errorData.details}`;
                    }
                    if (errorData?.error_code) {
                        errorCode = errorData.error_code;
                    }
                } catch (parseError) {
                    if (responseText) {
                        errorMessage = `${errorMessage}：${responseText.slice(0, 120)}`;
                    }
                }

                const requestError = new Error(errorMessage);
                requestError.status = response.status;
                requestError.code = errorCode;
                throw requestError;
            }

            return await response.json();
        } catch (error) {
            if (!silent) {
                console.error('API request error:', error);
            }
            throw error;
        }
    },

    async getVideoList(source, params = {}) {
        return this.request(source.url, { ac: 'list', ...params });
    },

    async getVideoDetail(source, videoId) {
        return this.request(source.url, { ac: 'detail', ids: videoId });
    },

    async searchVideos(source, keyword) {
        return this.request(source.url, { ac: 'list', wd: keyword });
    },

    async getVideosByCategory(source, categoryId, page = 1) {
        return this.request(source.url, { ac: 'list', t: categoryId, pg: page });
    },

    async inspectSource(sourceOrUrl, options = {}) {
        const source = typeof sourceOrUrl === 'string'
            ? { url: sourceOrUrl }
            : sourceOrUrl;
        const retryCount = Number(options.retryCount ?? 1);
        const retryDelayMs = Number(options.retryDelayMs ?? 450);
        let lastError = null;
        let startedAt = (typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now();

        for (let attempt = 0; attempt <= retryCount; attempt += 1) {
            startedAt = (typeof performance !== 'undefined' && performance.now)
                ? performance.now()
                : Date.now();

            try {
                const response = await this.request(source.url, { ac: 'list', pg: 1 }, { silent: true });
                const data = DataAdapter.normalizeResponse(response, source);
                const endTime = (typeof performance !== 'undefined' && performance.now)
                    ? performance.now()
                    : Date.now();

                if (!(data.code === 1 || Array.isArray(data.list))) {
                    throw new Error('接口已响应，但数据结构不是预期格式');
                }

                return {
                    ok: true,
                    sourceKind: data.source_kind,
                    kindLabel: DataAdapter.getKindLabel(data.source_kind),
                    total: Number(data.total) || (Array.isArray(data.list) ? data.list.length : 0),
                    categories: Array.isArray(data.class) ? data.class.length : 0,
                    durationMs: Math.max(1, Math.round(endTime - startedAt)),
                    attempts: attempt + 1
                };
            } catch (error) {
                lastError = error;
                if (attempt < retryCount && this.shouldRetryInspect(error)) {
                    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                    continue;
                }
                break;
            }
        }

        const endTime = (typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now();

        return {
            ok: false,
            sourceKind: null,
            kindLabel: '未知',
            total: 0,
            categories: 0,
            durationMs: Math.max(1, Math.round(endTime - startedAt)),
            attempts: retryCount + 1,
            error: lastError?.message || '检测失败',
            errorCode: lastError?.code || ''
        };
    },

    shouldRetryInspect(error) {
        const retryableCodes = new Set([
            'CONNECT_TIMEOUT',
            'UND_ERR_CONNECT_TIMEOUT',
            'EHOSTUNREACH',
            'ENETUNREACH',
            'ETIMEDOUT',
            'ECONNRESET'
        ]);

        return retryableCodes.has(error?.code);
    }
};

const DataAdapter = {
    detectItemKind(item) {
        if (!item || typeof item !== 'object') {
            return null;
        }
        if (item.art_id !== undefined || item.art_name !== undefined) {
            return 'art';
        }
        if (item.vod_id !== undefined || item.vod_name !== undefined) {
            return 'vod';
        }
        return null;
    },

    detectSourceKind(data, source = null) {
        const firstItem = Array.isArray(data?.list) && data.list.length > 0 ? data.list[0] : null;
        const detectedFromItem = this.detectItemKind(firstItem);
        if (detectedFromItem) {
            return detectedFromItem;
        }

        const sourceUrl = String(source?.url || '');
        if (/\/provide\/art\/?/i.test(sourceUrl)) {
            return 'art';
        }

        return 'vod';
    },

    normalizeCategory(category) {
        return {
            ...category,
            type_id: Number(category?.type_id) || category?.type_id || 0,
            type_name: normalizeText(category?.type_name || category?.type_name_en || '未分类')
        };
    },

    normalizeVodItem(item, source = null) {
        return {
            ...item,
            kind: 'vod',
            id: item?.vod_id,
            vod_id: item?.vod_id,
            vod_name: normalizeText(item?.vod_name || '未命名影片'),
            vod_time: item?.vod_time || '',
            vod_pic: resolveMediaUrl(item?.vod_pic, source?.url),
            vod_remarks: normalizeText(item?.vod_remarks || ''),
            vod_content: item?.vod_content || '',
            vod_actor: normalizeText(item?.vod_actor || ''),
            vod_director: normalizeText(item?.vod_director || ''),
            type_id: Number(item?.type_id) || item?.type_id || 0,
            type_name: normalizeText(item?.type_name || '未分类'),
            playable: Boolean(item?.vod_play_from && item?.vod_play_url)
        };
    },

    normalizeArtItem(item, source = null) {
        const title = normalizeText(item?.art_name || item?.vod_name || '未命名资讯');
        const blurb = normalizeText(stripHtml(item?.art_blurb || ''));
        const remarks = normalizeText(item?.art_remarks || '');
        const content = item?.art_content || item?.vod_content || '';

        return {
            ...item,
            kind: 'art',
            id: item?.art_id || item?.vod_id,
            vod_id: item?.art_id || item?.vod_id,
            vod_name: title,
            vod_time: item?.art_time || item?.vod_time || '',
            vod_pic: resolveMediaUrl(item?.art_pic || item?.vod_pic, source?.url),
            vod_remarks: remarks,
            vod_content: content,
            vod_actor: '',
            vod_director: '',
            vod_play_from: '',
            vod_play_url: '',
            type_id: Number(item?.type_id) || item?.type_id || 0,
            type_name: normalizeText(item?.type_name || '资讯'),
            art_id: item?.art_id || item?.vod_id,
            art_name: title,
            art_time: item?.art_time || item?.vod_time || '',
            art_pic: resolveMediaUrl(item?.art_pic || item?.vod_pic, source?.url),
            art_blurb: blurb,
            art_author: normalizeText(item?.art_author || ''),
            art_from: normalizeText(item?.art_from || ''),
            art_score: normalizeText(item?.art_score || ''),
            playable: false
        };
    },

    normalizeItem(item, kind, source = null) {
        if (kind === 'art') {
            return this.normalizeArtItem(item, source);
        }
        return this.normalizeVodItem(item, source);
    },

    normalizeResponse(data, source = null) {
        const kind = this.detectSourceKind(data, source);
        const normalizedList = Array.isArray(data?.list) ? data.list.map(item => {
            const normalizedItem = this.normalizeItem(item, kind, source);
            return {
                ...normalizedItem,
                source_id: source?.id || null,
                source_name: source?.name || '',
                source_kind: kind,
                source_url: source?.url || ''
            };
        }) : [];

        return {
            ...data,
            source_kind: kind,
            class: Array.isArray(data?.class) ? data.class.map(category => this.normalizeCategory(category)) : [],
            list: dedupeSingleSourceItems(normalizedList)
        };
    },

    getKindLabel(kind) {
        if (kind === 'art') {
            return '资讯源';
        }
        if (kind === 'mixed') {
            return '混合内容';
        }
        return '影视源';
    }
};

const RichText = {
    toParagraphs(value) {
        const source = String(value ?? '').trim();
        if (!source) {
            return [];
        }

        if (typeof DOMParser !== 'undefined') {
            const doc = new DOMParser().parseFromString(source, 'text/html');
            const nodes = Array.from(doc.body.querySelectorAll('h1, h2, h3, p, li, blockquote'));
            const paragraphs = nodes
                .map(node => normalizeText(node.textContent))
                .filter(Boolean);

            if (paragraphs.length > 0) {
                return paragraphs;
            }

            const fallbackText = normalizeText(doc.body.textContent);
            return fallbackText ? [fallbackText] : [];
        }

        const plainText = normalizeText(stripHtml(source));
        return plainText ? [plainText] : [];
    },

    renderParagraphs(value, emptyMessage = '暂无内容') {
        const paragraphs = this.toParagraphs(value);
        if (paragraphs.length === 0) {
            return `<p>${escapeHtml(emptyMessage)}</p>`;
        }

        return paragraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('');
    }
};

const VideoParser = {
    parseEpisodes(playUrl) {
        if (!playUrl) {
            return [];
        }

        const episodes = [];
        const parts = playUrl.split('#');

        for (const part of parts) {
            if (!part.trim()) {
                continue;
            }

            const [name, url] = part.split('$');
            if (name && url) {
                episodes.push({
                    name: name.trim(),
                    url: url.trim()
                });
            }
        }

        return dedupeEpisodes(episodes);
    },

    parsePlaySources(playFrom, playUrl) {
        if (!playFrom || !playUrl) {
            return [];
        }

        const fromNames = playFrom.split('$$$');
        const urlParts = playUrl.split('$$$');
        const sources = [];
        const sourceIndexes = new Map();
        const sourceFingerprints = new Set();

        for (let index = 0; index < urlParts.length; index += 1) {
            const episodes = this.parseEpisodes(urlParts[index]);
            if (episodes.length > 0) {
                const sourceName = normalizeText(fromNames[index] || `播放源${index + 1}`);
                const fingerprint = `${normalizeKeyText(sourceName)}::${episodes.map(episode => `${normalizeKeyText(episode.name)}::${episode.url}`).join('||')}`;

                if (sourceFingerprints.has(fingerprint)) {
                    continue;
                }

                sourceFingerprints.add(fingerprint);

                const existingIndex = sourceIndexes.get(normalizeKeyText(sourceName));
                if (typeof existingIndex === 'number') {
                    const mergedEpisodes = mergeEpisodesByIdentity(sources[existingIndex].episodes, episodes);
                    sources[existingIndex] = {
                        ...sources[existingIndex],
                        episodes: mergedEpisodes,
                        isM3u8: sources[existingIndex].isM3u8 || this.isM3u8Source(sourceName, mergedEpisodes)
                    };
                    continue;
                }

                sourceIndexes.set(normalizeKeyText(sourceName), sources.length);
                sources.push({
                    name: sourceName,
                    episodes,
                    isM3u8: this.isM3u8Source(sourceName, episodes)
                });
            }
        }

        return sources;
    },

    isM3u8Source(name, episodes) {
        const lowerName = String(name || '').toLowerCase();
        const nameHasM3u8 = lowerName.includes('m3u8');
        const urlHasM3u8 = episodes.some(episode => String(episode.url || '').toLowerCase().includes('m3u8'));
        return nameHasM3u8 || urlHasM3u8;
    },

    sortSourcesByM3u8(sources) {
        return sources.sort((sourceA, sourceB) => {
            if (sourceA.isM3u8 && !sourceB.isM3u8) {
                return -1;
            }
            if (!sourceA.isM3u8 && sourceB.isM3u8) {
                return 1;
            }
            return 0;
        });
    }
};

const VideoMeta = {
    isRecent(video) {
        if (!video || !video.vod_time) {
            return false;
        }

        const time = new Date(video.vod_time.replace(/-/g, '/'));
        if (Number.isNaN(time.getTime())) {
            return false;
        }

        const now = Date.now();
        const diffDays = (now - time.getTime()) / (1000 * 60 * 60 * 24);
        return diffDays <= 10;
    },

    isSerial(video) {
        if (video?.kind === 'art') {
            return false;
        }
        const remark = String(video?.vod_remarks || '');
        return /更新|第\s*\d+\s*集|连载|抢先|预告/i.test(remark);
    },

    isComplete(video) {
        if (video?.kind === 'art') {
            return false;
        }
        const remark = String(video?.vod_remarks || '');
        return /完结|全集|全\d+集|已完结/i.test(remark);
    },

    isHD(video) {
        if (video?.kind === 'art') {
            return false;
        }
        const remark = String(video?.vod_remarks || '');
        return /4k|2160|1080|超清|高清|蓝光|hd|杜比/i.test(remark);
    },

    hasM3u8(video) {
        if (video?.kind === 'art') {
            return false;
        }
        const playFrom = String(video?.vod_play_from || '');
        return playFrom.toLowerCase().includes('m3u8');
    },

    getSourceCount(video) {
        const playFrom = String(video?.vod_play_from || '');
        return playFrom ? playFrom.split('$$$').filter(Boolean).length : 0;
    },

    getEpisodeCount(playSources) {
        return playSources.reduce((total, source) => total + (source.episodes?.length || 0), 0);
    },

    formatTime(value) {
        if (!value) {
            return '等待更新';
        }
        return String(value).replace('T', ' ').slice(0, 16);
    },

    getYear(video) {
        const time = String(video?.vod_time || '');
        const matched = time.match(/\d{4}/);
        return matched ? matched[0] : '';
    },

    getSourceName(source) {
        return source?.name || '默认线路';
    },

    getPrimarySourceLabel(video) {
        if (video?.kind === 'art') {
            return video?.art_from || '资讯内容';
        }
        const playFrom = String(video?.vod_play_from || '');
        if (!playFrom) {
            return '线路待定';
        }
        const first = playFrom.split('$$$').find(Boolean);
        return first || '线路待定';
    },

    getStatusBadges(video, playSources = null) {
        const badges = [];
        const remark = normalizeText(video?.vod_remarks || '');

        if (video?.kind === 'art') {
            if (this.isRecent(video)) {
                badges.push({ label: '最近更新', tone: 'accent' });
            }
            if (video?.vod_pic) {
                badges.push({ label: '图文', tone: 'success' });
            }
            if (video?.art_blurb) {
                badges.push({ label: '有摘要', tone: 'default' });
            }
            if (video?.art_author) {
                badges.push({ label: '作者', tone: 'default' });
            }
            if (video?.art_from) {
                badges.push({ label: '来源', tone: 'default' });
            }
            return badges.slice(0, 4);
        }

        const sourceCount = playSources ? playSources.length : this.getSourceCount(video);

        if (this.isRecent(video)) {
            badges.push({ label: '最近更新', tone: 'accent' });
        }
        if (this.isSerial(video)) {
            badges.push({ label: '连载中', tone: 'warning' });
        }
        if (this.isComplete(video)) {
            badges.push({ label: '已完结', tone: 'default' });
        }
        if (this.isHD(video)) {
            badges.push({ label: '高清', tone: 'success' });
        }
        if (playSources ? playSources.some(source => source.isM3u8) : this.hasM3u8(video)) {
            badges.push({ label: 'M3U8', tone: 'accent' });
        }
        if (sourceCount > 1) {
            badges.push({ label: `${sourceCount}线路`, tone: 'default' });
        }
        if (remark && badges.length === 0) {
            badges.push({ label: remark, tone: 'default' });
        }

        return badges.slice(0, 4);
    },

    getSearchSummary(video) {
        const parts = [];
        if (video?.type_name) {
            parts.push(video.type_name);
        }
        const year = this.getYear(video);
        if (year) {
            parts.push(year);
        }
        if (video?.kind === 'art') {
            if (video?.art_author) {
                parts.push(video.art_author);
            } else if (video?.art_from) {
                parts.push(video.art_from);
            }
            return parts.join(' · ') || '浮光资讯';
        }
        const sourceCount = this.getSourceCount(video);
        if (sourceCount > 0) {
            parts.push(`${sourceCount}条线路`);
        }
        return parts.join(' · ') || '浮光片库';
    },

    getDescription(video) {
        if (video?.kind === 'art') {
            const description = video?.art_blurb || video?.vod_remarks || video?.vod_content;
            return truncateText(stripHtml(description || ''), 92) || '资讯条目';
        }
        const remark = String(video?.vod_remarks || '').trim();
        if (remark) {
            return remark;
        }
        if (video?.vod_content) {
            const content = stripHtml(video.vod_content).replace(/\s+/g, ' ').trim();
            return content ? content.slice(0, 68) : '片库条目';
        }
        return '片库条目';
    },

    matchesFilter(video, filterKey) {
        if (filterKey === 'vod') {
            return video?.kind === 'vod';
        }
        if (filterKey === 'art') {
            return video?.kind === 'art';
        }
        if (video?.kind === 'art') {
            switch (filterKey) {
                case 'all':
                    return true;
                case 'recent':
                    return this.isRecent(video);
                case 'cover':
                    return Boolean(video?.vod_pic);
                case 'summary':
                    return Boolean(video?.art_blurb || video?.vod_remarks || video?.vod_content);
                case 'source':
                    return Boolean(video?.art_author || video?.art_from);
                default:
                    return false;
            }
        }

        switch (filterKey) {
            case 'cover':
                return Boolean(video?.vod_pic);
            case 'recent':
                return this.isRecent(video);
            case 'serial':
                return this.isSerial(video);
            case 'complete':
                return this.isComplete(video);
            case 'hd':
                return this.isHD(video);
            case 'm3u8':
                return this.hasM3u8(video);
            default:
                return true;
        }
    },

    getCornerTag(video) {
        if (video?.kind === 'art') {
            return video?.art_from || video?.vod_remarks || '';
        }
        return normalizeText(video?.vod_remarks || '');
    },

    getInlineTag(video) {
        if (video?.kind === 'art') {
            return video?.vod_pic ? '图文' : '资讯';
        }
        return this.hasM3u8(video) ? 'M3U8' : '';
    }
};

const SearchAggregator = {
    async searchAll(keyword, sources) {
        const settled = await Promise.allSettled(
            sources.map(source => Api.searchVideos(source, keyword))
        );

        const items = [];
        const successSources = [];
        const failedSources = [];

        settled.forEach((result, index) => {
            const source = sources[index];

            if (result.status === 'fulfilled') {
                const normalized = DataAdapter.normalizeResponse(result.value, source);
                successSources.push({
                    id: source.id,
                    name: source.name,
                    kind: normalized.source_kind,
                    count: normalized.list.length
                });
                items.push(...normalized.list.map(item => ({
                    ...item,
                    is_aggregate_result: true
                })));
                return;
            }

            failedSources.push({
                id: source.id,
                name: source.name,
                error: result.reason?.message || '搜索失败'
            });
        });

        const dedupedItems = this.dedupe(items);
        const sortedItems = this.sort(dedupedItems);

        return {
            items: sortedItems,
            successSources,
            failedSources,
            totalSources: sources.length,
            successCount: successSources.length,
            failureCount: failedSources.length,
            kind: this.detectKind(sortedItems)
        };
    },

    dedupe(items) {
        const seen = new Set();
        return items.filter(item => {
            const key = [
                item?.source_id || 'default',
                item?.kind || 'vod',
                normalizeText(item?.vod_name || ''),
                normalizeText(item?.vod_time || '')
            ].join('::');

            if (seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        });
    },

    sort(items) {
        return [...items]
            .map((item, index) => ({ item, index }))
            .sort((entryA, entryB) => {
                const timeDiff = this.parseTime(entryB.item?.vod_time) - this.parseTime(entryA.item?.vod_time);
                if (timeDiff !== 0) {
                    return timeDiff;
                }

                const coverDiff = Number(Boolean(entryB.item?.vod_pic)) - Number(Boolean(entryA.item?.vod_pic));
                if (coverDiff !== 0) {
                    return coverDiff;
                }

                const summaryDiff = Number(Boolean(VideoMeta.getDescription(entryB.item))) - Number(Boolean(VideoMeta.getDescription(entryA.item)));
                if (summaryDiff !== 0) {
                    return summaryDiff;
                }

                return entryA.index - entryB.index;
            })
            .map(entry => entry.item);
    },

    parseTime(value) {
        if (!value) {
            return 0;
        }

        const parsed = new Date(String(value).replace(/-/g, '/')).getTime();
        return Number.isNaN(parsed) ? 0 : parsed;
    },

    detectKind(items) {
        const kinds = new Set(items.map(item => item?.kind).filter(Boolean));
        if (kinds.size > 1) {
            return 'mixed';
        }
        return kinds.values().next().value || 'vod';
    }
};

const PosterCache = {
    getCacheKey(videoId, source) {
        return `${source?.url || 'default'}::${videoId}`;
    },

    get(videoId, source) {
        const cache = Storage.get(CONFIG.STORAGE_KEYS.POSTER_CACHE) || {};
        return cache[this.getCacheKey(videoId, source)];
    },

    set(videoId, source, posterUrl) {
        const cache = Storage.get(CONFIG.STORAGE_KEYS.POSTER_CACHE) || {};
        cache[this.getCacheKey(videoId, source)] = posterUrl;
        Storage.set(CONFIG.STORAGE_KEYS.POSTER_CACHE, cache);
    },

    async fetchAndCache(videoId, source) {
        const cached = this.get(videoId, source);
        if (cached) {
            return cached;
        }

        try {
            const data = DataAdapter.normalizeResponse(await Api.getVideoDetail(source, videoId), source);
            if (data.list && data.list[0] && data.list[0].vod_pic) {
                const posterUrl = data.list[0].vod_pic;
                this.set(videoId, source, posterUrl);
                return posterUrl;
            }
        } catch (error) {
            console.error('Fetch poster error:', error);
        }

        return null;
    }
};

const UI = {
    renderBadge(label, tone = 'default') {
        return `<span class="meta-badge meta-badge-${tone}">${escapeHtml(label)}</span>`;
    },

    showLoading(container, message = '片库正在载入中...') {
        container.innerHTML = `
            <div class="loading">
                <div class="loading-spinner"></div>
                <p>${escapeHtml(message)}</p>
            </div>
        `;
    },

    showEmpty(container, message = '暂无数据', description = '试试切换数据源或更换搜索关键词。') {
        container.innerHTML = `
            <div class="empty-state">
                <div class="icon">📭</div>
                <h3>${escapeHtml(message)}</h3>
                <p>${escapeHtml(description)}</p>
            </div>
        `;
    },

    showError(container, message = '加载失败') {
        container.innerHTML = `
            <div class="empty-state">
                <div class="icon">😢</div>
                <h3>${escapeHtml(message)}</h3>
                <p>请检查数据源配置或网络连接</p>
            </div>
        `;
    },

    showToast(message, type = 'info') {
        const existing = document.querySelector('.toast');
        if (existing) {
            existing.remove();
        }

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 2800);
    },

    renderPosterPlaceholder(targetId, label = '浮光') {
        return `<div class="placeholder poster-glow" id="${escapeHtml(targetId)}">${escapeHtml(label)}</div>`;
    },

    renderVideoCard(video) {
        const badges = VideoMeta.getStatusBadges(video).map(item => this.renderBadge(item.label, item.tone)).join('');
        const cornerTag = VideoMeta.getCornerTag(video);
        const inlineTag = VideoMeta.getInlineTag(video);
        const topTag = cornerTag ? `<span class="video-corner-tag">${escapeHtml(cornerTag)}</span>` : '';
        const sourceTag = inlineTag ? `<span class="video-inline-tag">${escapeHtml(inlineTag)}</span>` : '';

        return `
            <article class="video-card" onclick="goToDetail(${video.vod_id}, ${video.source_id || 'null'})" data-id="${video.vod_id}">
                <div class="video-poster">
                    ${this.renderPosterPlaceholder(`poster-${video.vod_id}`, '浮光')}
                    <div class="video-poster-overlay"></div>
                    <div class="video-poster-topline">
                        ${topTag}
                        ${sourceTag}
                    </div>
                </div>
                <div class="video-info">
                    <div class="video-tags">${badges}</div>
                    <h3 class="video-name">${escapeHtml(video.vod_name || '未命名影片')}</h3>
                    <p class="video-subline">${escapeHtml(VideoMeta.getDescription(video))}</p>
                    ${video.is_aggregate_result && video.source_name ? `
                        <div class="video-source-line">
                            <span class="source-pill">${escapeHtml(video.source_name)}</span>
                            <em>${escapeHtml(DataAdapter.getKindLabel(video.source_kind || video.kind))}</em>
                        </div>
                    ` : ''}
                    <div class="video-meta-row">
                        <span>${escapeHtml(VideoMeta.getSearchSummary(video))}</span>
                        <span>${escapeHtml(VideoMeta.formatTime(video.vod_time))}</span>
                    </div>
                </div>
            </article>
        `;
    },

    setPoster(targetId, posterUrl, alt = '海报') {
        const target = document.getElementById(targetId);
        if (!target || !posterUrl) {
            return;
        }

        target.innerHTML = `<img src="${escapeHtml(posterUrl)}" alt="${escapeHtml(alt)}" loading="lazy" onerror="this.parentElement.textContent='浮光'">`;
    },

    async loadPosterAsync(videoId, source, targetId = `poster-${videoId}`, alt = '海报') {
        const posterUrl = await PosterCache.fetchAndCache(videoId, source);
        this.setPoster(targetId, posterUrl, alt);
    },

    renderPagination(currentPage, totalPages) {
        const container = document.getElementById('pagination');
        if (!container || totalPages <= 1) {
            if (container) {
                container.innerHTML = '';
            }
            return;
        }

        container.innerHTML = `
            <button onclick="changePage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}>上一页</button>
            <div class="page-jump">
                <span class="page-info">第 ${currentPage} / ${totalPages} 页</span>
                <input type="number" min="1" max="${totalPages}" value="${currentPage}" onkeypress="if(event.key==='Enter') jumpToPage(this.value, ${totalPages})">
                <button onclick="jumpToPage(document.querySelector('.page-jump input').value, ${totalPages})">跳转</button>
            </div>
            <button onclick="changePage(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''}>下一页</button>
        `;
    }
};

function getDetailUrl(videoId, sourceId = null) {
    const url = new URL('detail.html', window.location.href);
    url.searchParams.set('id', videoId);
    if (sourceId) {
        url.searchParams.set('source_id', sourceId);
    }
    return url.toString();
}

function getPlayerUrl(videoId, episodeIndex, sourceIndex = 0, sourceId = null) {
    const url = new URL('player.html', window.location.href);
    url.searchParams.set('id', videoId);
    url.searchParams.set('ep', episodeIndex);
    url.searchParams.set('source', sourceIndex);
    if (sourceId) {
        url.searchParams.set('source_id', sourceId);
    }
    return url.toString();
}

function goToDetail(videoId, sourceId = null) {
    window.location.href = getDetailUrl(videoId, sourceId);
}

function goToPlayer(videoId, episodeIndex, sourceIndex = 0, sourceId = null) {
    window.location.href = getPlayerUrl(videoId, episodeIndex, sourceIndex, sourceId);
}

function changePage(page) {
    if (page < 1) {
        return;
    }
    const url = new URL(window.location);
    url.searchParams.set('page', page);
    window.location.href = url.toString();
}

function jumpToPage(page, maxPage) {
    const parsedPage = parseInt(page, 10);
    if (parsedPage >= 1 && parsedPage <= maxPage) {
        changePage(parsedPage);
    }
}

function getUrlParam(name) {
    const url = new URL(window.location);
    return url.searchParams.get(name);
}

document.addEventListener('DOMContentLoaded', function() {
    ThemeManager.init();

    const sourceSelector = document.getElementById('sourceSelector');
    if (!sourceSelector) {
        return;
    }

    const sources = SourceManager.getSources();
    const selectedSource = SourceManager.getSourceById(getUrlParam('source_id')) || SourceManager.getCurrentSource();

    sourceSelector.innerHTML = sources.map(source => `
        <option value="${source.id}" ${source.id === selectedSource.id ? 'selected' : ''}>${escapeHtml(source.name)}</option>
    `).join('');

    sourceSelector.addEventListener('change', function() {
        SourceManager.setCurrentSource(parseInt(this.value, 10));
        if (typeof reloadAll === 'function') {
            reloadAll();
        } else if (typeof loadVideos === 'function') {
            loadCategories();
            loadVideos();
        } else {
            window.location.reload();
        }
    });
});
