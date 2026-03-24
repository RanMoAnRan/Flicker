(function initMusicLibraryPage() {
    const QUEUE_DRAWER_ANIMATION_MS = 240;
    const LYRIC_DIALOG_ANIMATION_MS = 240;
    const RECOMMENDED_PLUGIN_PRIORITY = ['网易', '爱听', '元力 QQ', '元力 KW', '小秋音乐', '小芸音乐', 'qq', 'w音乐'];
    const PLAYER_STORAGE_KEY = 'fuguang_music_player_state';
    const PLAYER_STATE_VERSION = 1;
    const PLAYER_STATE_MAX_AGE_MS = 1000 * 60 * 60 * 24;
    const PLAYER_STATE_PERSIST_INTERVAL_MS = 1500;
    const MEDIA_POSITION_SYNC_INTERVAL_MS = 1000;
    const VISIBILITY_RESUME_GUARD_MS = 1200;
    const NEXT_TRACK_PREFETCH_THRESHOLD_SECONDS = 20;
    const EARLY_TRACK_ADVANCE_THRESHOLD_SECONDS = 0.45;
    const TRACK_COMPLETION_PAUSE_THRESHOLD_SECONDS = 1.2;
    const PREFETCH_AHEAD_COUNT = 4;
    const PLAY_MODES = {
        SEQUENTIAL: 'sequential',
        LOOP: 'loop',
        SHUFFLE: 'shuffle'
    };

    const state = {
        plugins: [],
        enabledPlugins: [],
        pluginTab: 'recommended',
        activePlugin: 'all',
        activeRecommendPlugin: '',
        recommendTopListGroups: [],
        activeTopListGroupKey: '',
        activeTopListId: '',
        activeTopListGroupTitle: '',
        currentKeyword: '',
        searchPaginationVisible: false,
        searchPage: 1,
        searchHasNextPage: false,
        searchPluginStatuses: [],
        isSearchPaginationLoading: false,
        searchResults: [],
        resultsHydrationToken: 0,
        recommendationRequestToken: 0,
        queue: [],
        currentQueueIndex: -1,
        currentTrack: null,
        currentQuality: '',
        playMode: PLAY_MODES.SEQUENTIAL,
        currentLyrics: [],
        activeLyricIndex: -1,
        desiredPlaybackState: 'paused',
        queueStepInFlight: false,
        isTrackTransitioning: false,
        visibilityResumeGuardUntil: 0,
        lastPlayerStatePersistAt: 0,
        lastMediaPositionSyncAt: 0,
        prefetchedTrackMedia: {},
        prefetchingTrackKeys: [],
        nearEndAdvanceTrackKey: ''
    };

    const elements = {
        searchInput: document.getElementById('musicSearchInput'),
        searchClearButton: document.getElementById('musicSearchClearButton'),
        searchButton: document.getElementById('musicSearchButton'),
        pluginStatus: document.getElementById('musicPluginStatus'),
        pluginPanel: document.querySelector('.music-plugin-panel'),
        pluginChips: document.getElementById('musicPluginChips'),
        pluginTabsDock: document.getElementById('musicPluginTabsDock'),
        pluginTabsDockInner: document.getElementById('musicPluginTabsDockInner'),
        resultEyebrow: document.getElementById('musicResultEyebrow'),
        resultTitle: document.getElementById('musicResultTitle'),
        resultMeta: document.getElementById('musicResultMeta'),
        resultsPanel: document.getElementById('musicResults')?.closest('.panel-card'),
        searchPagination: document.getElementById('musicSearchPagination'),
        topListPanel: document.getElementById('musicTopListPanel'),
        topListStatus: document.getElementById('musicTopListStatus'),
        topListGroups: document.getElementById('musicTopListGroups'),
        results: document.getElementById('musicResults'),
        playerStatus: document.getElementById('musicPlayerStatus'),
        playerAudio: document.getElementById('musicAudio'),
        playerCover: document.getElementById('playerCover'),
        playerTitle: document.getElementById('playerTrackTitle'),
        playerArtist: document.getElementById('playerTrackArtist'),
        playerTags: document.getElementById('playerTrackTags'),
        queueToggleButton: document.getElementById('musicQueueToggleButton'),
        queueToggleBadge: document.getElementById('musicQueueToggleBadge'),
        queueOverlay: document.getElementById('musicQueueOverlay'),
        queueDrawer: document.getElementById('musicQueueDrawer'),
        queueCloseButton: document.getElementById('musicQueueCloseButton'),
        queueCount: document.getElementById('musicQueueCount'),
        lyricToggleButton: document.getElementById('musicLyricToggleButton'),
        lyricOverlay: document.getElementById('musicLyricOverlay'),
        lyricDialog: document.getElementById('musicLyricDialog'),
        lyricDialogTitle: document.getElementById('musicLyricDialogTitle'),
        lyricCloseButton: document.getElementById('musicLyricCloseButton'),
        playerQualitySelect: document.getElementById('playerQualitySelect'),
        prevTrackButton: document.getElementById('prevTrackButton'),
        stopTrackButton: document.getElementById('stopTrackButton'),
        nextTrackButton: document.getElementById('nextTrackButton'),
        playModeButton: document.getElementById('playModeButton'),
        lyricStatus: document.getElementById('musicLyricStatus'),
        lyricBody: document.getElementById('musicLyricBody'),
        queueStatus: document.getElementById('musicQueueStatus'),
        queueList: document.getElementById('musicQueueList'),
        clearQueueButton: document.getElementById('clearQueueButton')
    };

    let queueDrawerHideTimer = null;
    let lyricDialogHideTimer = null;

    function updateSearchClearButton() {
        if (!elements.searchClearButton) {
            return;
        }

        const hasValue = Boolean(elements.searchInput?.value.trim());
        elements.searchClearButton.hidden = !hasValue;
    }

    function setPluginStatus(text = '') {
        if (!elements.pluginStatus) {
            return;
        }

        const nextText = String(text || '').trim();
        elements.pluginStatus.textContent = nextText;
        elements.pluginStatus.hidden = !nextText;
    }

    function isMobileCompactResults() {
        return window.matchMedia('(max-width: 640px)').matches;
    }

    function syncSearchClearButtonSoon() {
        window.setTimeout(() => {
            updateSearchClearButton();
        }, 0);
    }

    function normalizePluginName(name) {
        return String(name || '').replace(/\s+/g, '').toLowerCase();
    }

    function sortPluginsByPriority(list = []) {
        return list
            .map((plugin, index) => ({ plugin, index }))
            .sort((left, right) => {
                const leftPriority = RECOMMENDED_PLUGIN_PRIORITY.indexOf(normalizePluginName(left.plugin?.name));
                const rightPriority = RECOMMENDED_PLUGIN_PRIORITY.indexOf(normalizePluginName(right.plugin?.name));
                const leftRank = leftPriority >= 0 ? leftPriority : Number.MAX_SAFE_INTEGER;
                const rightRank = rightPriority >= 0 ? rightPriority : Number.MAX_SAFE_INTEGER;

                if (leftRank !== rightRank) {
                    return leftRank - rightRank;
                }

                return left.index - right.index;
            })
            .map(item => item.plugin);
    }

    function sanitizeDownloadPart(value) {
        return String(value || '')
            .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function inferDownloadExtensionFromContentType(contentType = '') {
        const normalized = String(contentType || '').toLowerCase();
        if (normalized.includes('audio/flac')) {
            return '.flac';
        }
        if (normalized.includes('audio/mp4') || normalized.includes('audio/x-m4a')) {
            return '.m4a';
        }
        if (normalized.includes('audio/ogg')) {
            return '.ogg';
        }
        if (normalized.includes('audio/wav') || normalized.includes('audio/wave')) {
            return '.wav';
        }
        if (normalized.includes('audio/aac')) {
            return '.aac';
        }
        if (normalized.includes('audio/x-ms-wma')) {
            return '.wma';
        }
        return '.mp3';
    }

    function parseDownloadFilename(disposition = '') {
        const text = String(disposition || '');
        const encoded = text.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
        if (encoded) {
            try {
                return decodeURIComponent(encoded);
            } catch (error) {
                return encoded;
            }
        }

        const plain = text.match(/filename="?([^";]+)"?/i)?.[1];
        return plain ? plain.trim() : '';
    }

    function buildTrackDownloadFilename(track, contentType = '') {
        const title = sanitizeDownloadPart(track?.title) || '未命名歌曲';
        const artist = sanitizeDownloadPart(track?.artist) || sanitizeDownloadPart(track?.plugin) || '未知歌手';
        return `${title} - ${artist}${inferDownloadExtensionFromContentType(contentType)}`;
    }

    function normalizePlayMode(mode) {
        return Object.values(PLAY_MODES).includes(mode)
            ? mode
            : PLAY_MODES.SEQUENTIAL;
    }

    function getPlayModePresentation(mode = state.playMode) {
        switch (normalizePlayMode(mode)) {
            case PLAY_MODES.LOOP:
                return {
                    mode: PLAY_MODES.LOOP,
                    label: '列表循环',
                    icon: '↻'
                };
            case PLAY_MODES.SHUFFLE:
                return {
                    mode: PLAY_MODES.SHUFFLE,
                    label: '随机播放',
                    icon: '⇄'
                };
            default:
                return {
                    mode: PLAY_MODES.SEQUENTIAL,
                    label: '顺序播放',
                    icon: '→'
                };
        }
    }

    function updatePlayModeButton() {
        if (!elements.playModeButton) {
            return;
        }

        const presentation = getPlayModePresentation();
        elements.playModeButton.innerHTML = `<span class="music-icon-mark" aria-hidden="true">${presentation.icon}</span>`;
        elements.playModeButton.setAttribute('aria-label', `播放模式：${presentation.label}，点击切换`);
        elements.playModeButton.title = `播放模式：${presentation.label}`;
        elements.playModeButton.classList.toggle('is-active', presentation.mode !== PLAY_MODES.SEQUENTIAL);
    }

    function updateTransportToggleButton() {
        if (!elements.stopTrackButton) {
            return;
        }

        const hasSource = Boolean(getPlayerSourceUrl() || state.currentTrack);
        const isPlaying = state.desiredPlaybackState === 'playing'
            && (!elements.playerAudio.paused || state.isTrackTransitioning);
        const icon = isPlaying ? '■' : '▶';
        const label = isPlaying ? '停止播放' : '开始播放';

        elements.stopTrackButton.innerHTML = `<span class="music-icon-mark" aria-hidden="true">${icon}</span>`;
        elements.stopTrackButton.setAttribute('aria-label', label);
        elements.stopTrackButton.title = label;
        elements.stopTrackButton.classList.toggle('is-playing', isPlaying);
        elements.stopTrackButton.disabled = !hasSource;
    }

    function cyclePlayMode() {
        switch (state.playMode) {
            case PLAY_MODES.SEQUENTIAL:
                state.playMode = PLAY_MODES.LOOP;
                break;
            case PLAY_MODES.LOOP:
                state.playMode = PLAY_MODES.SHUFFLE;
                break;
            default:
                state.playMode = PLAY_MODES.SEQUENTIAL;
                break;
        }

        updatePlayModeButton();
        updateQueueActions();
        persistPlayerState({ force: true });
        UI.showToast(`已切换为${getPlayModePresentation().label}`, 'success');
    }

    async function toggleTransportPlayback() {
        const isPlaying = state.desiredPlaybackState === 'playing'
            && (!elements.playerAudio.paused || state.isTrackTransitioning);
        if (isPlaying) {
            stopPlayback();
            return;
        }

        if (getPlayerSourceUrl()) {
            const resumed = await resumeAudioPlayback({ updateStatus: true });
            if (resumed && state.currentTrack) {
                elements.playerStatus.textContent = `正在播放 ${state.currentTrack.title}`;
            }
            updateTransportToggleButton();
            return;
        }

        if (state.currentTrack) {
            await playTrack(state.currentTrack, state.currentQuality || state.currentTrack.defaultQuality);
        }
        updateTransportToggleButton();
    }

    function cloneTrackForStorage(track) {
        if (!track) {
            return null;
        }

        return {
            id: track.id || '',
            plugin: track.plugin || '',
            title: track.title || '',
            artist: track.artist || '',
            album: track.album || '',
            artwork: track.artwork || '',
            playable: track.playable !== false,
            playableReason: track.playableReason || '',
            duration: Number(track.duration) || 0,
            durationText: track.durationText || '',
            defaultQuality: track.defaultQuality || 'standard',
            qualities: Array.isArray(track.qualities)
                ? track.qualities.map(item => ({
                    key: item?.key || '',
                    size: Number(item?.size) || 0,
                    isFallback: Boolean(item?.isFallback)
                })).filter(item => item.key)
                : []
        };
    }

    function renderPlayerQualityOptions(track, selectedQuality) {
        elements.playerQualitySelect.innerHTML = getRenderableQualities(track).map(item => `
            <option value="${escapeHtml(item.key)}" ${item.key === selectedQuality ? 'selected' : ''}>
                ${escapeHtml(item.isFallback ? `${item.key} · 自动` : item.key)}${item.size ? ` · ${escapeHtml(formatBytes(item.size))}` : ''}
            </option>
        `).join('');
    }

    function inferArtworkMimeType(url) {
        const path = String(url || '').split('?')[0].toLowerCase();
        if (path.endsWith('.png')) {
            return 'image/png';
        }
        if (path.endsWith('.webp')) {
            return 'image/webp';
        }
        if (path.endsWith('.gif')) {
            return 'image/gif';
        }
        return 'image/jpeg';
    }

    function buildArtworkEntries(url) {
        if (!url) {
            return [];
        }

        const type = inferArtworkMimeType(url);
        return ['96x96', '128x128', '192x192', '256x256', '384x384', '512x512'].map(size => ({
            src: url,
            sizes: size,
            type
        }));
    }

    function getPlayerSourceUrl() {
        return elements.playerAudio.currentSrc || elements.playerAudio.src || '';
    }

    function getTrackRequestKey(track, quality) {
        return `${getTrackKey(track)}::${quality || track?.defaultQuality || 'standard'}`;
    }

    function persistPlayerState(options = {}) {
        const force = Boolean(options.force);
        const now = Date.now();
        if (!force && now - state.lastPlayerStatePersistAt < PLAYER_STATE_PERSIST_INTERVAL_MS) {
            return;
        }

        if (!state.currentTrack && state.queue.length === 0) {
            Storage.remove(PLAYER_STORAGE_KEY);
            state.lastPlayerStatePersistAt = now;
            return;
        }

        Storage.set(PLAYER_STORAGE_KEY, {
            version: PLAYER_STATE_VERSION,
            queue: state.queue.map(cloneTrackForStorage).filter(Boolean),
            currentQueueIndex: Number.isInteger(state.currentQueueIndex) ? state.currentQueueIndex : -1,
            currentTrack: cloneTrackForStorage(state.currentTrack),
            currentQuality: state.currentQuality || '',
            playMode: normalizePlayMode(state.playMode),
            currentTime: Number(elements.playerAudio.currentTime) || 0,
            audioSrc: getPlayerSourceUrl(),
            playbackState: state.desiredPlaybackState,
            activePlugin: state.activePlugin || 'all',
            currentKeyword: state.currentKeyword || '',
            updatedAt: now
        });
        state.lastPlayerStatePersistAt = now;
    }

    function readPersistedPlayerState() {
        const saved = Storage.get(PLAYER_STORAGE_KEY);
        if (!saved || typeof saved !== 'object') {
            return null;
        }

        const version = Number(saved.version) || 0;
        const updatedAt = Number(saved.updatedAt) || 0;
        if (version !== PLAYER_STATE_VERSION) {
            return null;
        }

        if (!updatedAt || Date.now() - updatedAt > PLAYER_STATE_MAX_AGE_MS) {
            Storage.remove(PLAYER_STORAGE_KEY);
            return null;
        }

        const queue = Array.isArray(saved.queue)
            ? saved.queue.map(cloneTrackForStorage).filter(Boolean)
            : [];
        const currentTrack = cloneTrackForStorage(saved.currentTrack);

        if (!currentTrack && queue.length === 0) {
            return null;
        }

        return {
            ...saved,
            queue,
            currentTrack,
            currentQueueIndex: Number.isInteger(saved.currentQueueIndex) ? saved.currentQueueIndex : -1,
            currentTime: Number(saved.currentTime) || 0,
            currentQuality: String(saved.currentQuality || ''),
            playMode: normalizePlayMode(saved.playMode),
            audioSrc: String(saved.audioSrc || ''),
            playbackState: saved.playbackState === 'playing' ? 'playing' : 'paused',
            activePlugin: String(saved.activePlugin || 'all'),
            currentKeyword: String(saved.currentKeyword || '')
        };
    }

    function applySavedCurrentTime(targetTime) {
        const nextTime = Number(targetTime) || 0;
        if (nextTime <= 0) {
            return;
        }

        const applyTime = () => {
            try {
                const duration = Number(elements.playerAudio.duration);
                if (Number.isFinite(duration) && duration > 0) {
                    elements.playerAudio.currentTime = Math.min(nextTime, Math.max(0, duration - 0.25));
                    return;
                }
                elements.playerAudio.currentTime = nextTime;
            } catch (error) {
                console.warn('恢复播放进度失败:', error);
            }
        };

        if (elements.playerAudio.readyState >= 1) {
            applyTime();
            return;
        }

        elements.playerAudio.addEventListener('loadedmetadata', applyTime, { once: true });
    }

    function updateMediaSessionMetadata(track) {
        if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') {
            return;
        }

        try {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: track?.title || '浮光音乐库',
                artist: track?.artist || '',
                album: track?.album || track?.plugin || '浮光',
                artwork: buildArtworkEntries(track?.artwork)
            });
        } catch (error) {
            console.warn('更新系统媒体元数据失败:', error);
        }
    }

    function updateMediaSessionPlaybackState(options = {}) {
        if (!('mediaSession' in navigator)) {
            return;
        }

        try {
            const keepPlayingDuringTransition = options.keepPlayingDuringTransition !== false;
            const isPlaying = (!elements.playerAudio.paused && !elements.playerAudio.ended)
                || (keepPlayingDuringTransition && state.isTrackTransitioning && state.desiredPlaybackState === 'playing');
            navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
        } catch (error) {
            console.warn('更新系统播放状态失败:', error);
        }
    }

    function syncMediaSessionPositionState(options = {}) {
        const force = Boolean(options.force);
        const now = Date.now();
        if (!force && now - state.lastMediaPositionSyncAt < MEDIA_POSITION_SYNC_INTERVAL_MS) {
            return;
        }

        if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') {
            return;
        }

        const duration = Number(elements.playerAudio.duration);
        if (!Number.isFinite(duration) || duration <= 0) {
            return;
        }

        try {
            navigator.mediaSession.setPositionState({
                duration,
                playbackRate: elements.playerAudio.playbackRate || 1,
                position: Math.min(duration, Math.max(0, Number(elements.playerAudio.currentTime) || 0))
            });
            state.lastMediaPositionSyncAt = now;
        } catch (error) {
            console.warn('更新系统播放进度失败:', error);
        }
    }

    function markDesiredPlaybackState(nextState) {
        state.desiredPlaybackState = nextState === 'playing' ? 'playing' : 'paused';
        updateMediaSessionPlaybackState();
        persistPlayerState();
    }

    function beginTrackTransition(track) {
        state.isTrackTransitioning = true;
        state.desiredPlaybackState = 'playing';
        if (track) {
            updateMediaSessionMetadata(track);
        }
        updateMediaSessionPlaybackState();
    }

    function endTrackTransition(options = {}) {
        state.isTrackTransitioning = false;
        if (options.paused) {
            state.desiredPlaybackState = 'paused';
        }
        updateMediaSessionPlaybackState();
    }

    async function resumeAudioPlayback(options = {}) {
        const updateStatus = options.updateStatus !== false;
        if (!getPlayerSourceUrl()) {
            return false;
        }

        try {
            await elements.playerAudio.play();
            return true;
        } catch (error) {
            if (updateStatus && state.currentTrack) {
                elements.playerStatus.textContent = `已恢复 ${state.currentTrack.title}，请点一下播放继续`;
            }
            return false;
        }
    }

    function restorePlayerFromStorage() {
        const savedState = readPersistedPlayerState();
        if (!savedState) {
            return;
        }

        state.queue = savedState.queue.map(item => ({ ...item }));
        state.currentQueueIndex = savedState.currentQueueIndex;
        state.currentTrack = savedState.currentTrack ? { ...savedState.currentTrack } : null;
        state.currentQuality = savedState.currentQuality || state.currentTrack?.defaultQuality || '';
        state.playMode = normalizePlayMode(savedState.playMode);
        state.desiredPlaybackState = savedState.playbackState;
        state.activePlugin = savedState.activePlugin || state.activePlugin;
        state.currentKeyword = savedState.currentKeyword || state.currentKeyword;

        if (state.currentQueueIndex >= state.queue.length) {
            state.currentQueueIndex = -1;
        }

        if (state.currentTrack && state.currentQueueIndex >= 0 && state.currentQueueIndex < state.queue.length) {
            state.queue[state.currentQueueIndex] = mergeTrackData(state.queue[state.currentQueueIndex], state.currentTrack);
        }

        renderQueue();
        updatePlayModeButton();
        updateTransportToggleButton();

        if (!state.currentTrack) {
            return;
        }

        renderPlayerQualityOptions(state.currentTrack, state.currentQuality);
        updateCurrentShowcase(state.currentTrack, state.currentQuality);
        updateMediaSessionMetadata(state.currentTrack);
        updateMediaSessionPlaybackState();
        void loadLyrics(state.currentTrack);

        if (savedState.audioSrc) {
            elements.playerAudio.src = savedState.audioSrc;
            applySavedCurrentTime(savedState.currentTime);
        }

        elements.playerStatus.textContent = state.desiredPlaybackState === 'playing'
            ? `已恢复 ${state.currentTrack.title}，等待继续播放`
            : `已恢复 ${state.currentTrack.title}`;
        persistPlayerState({ force: true });
    }

    function installMediaSessionHandlers() {
        if (!('mediaSession' in navigator)) {
            return;
        }

        const handlers = [
            ['play', async () => {
                state.desiredPlaybackState = 'playing';
                await resumeAudioPlayback({ updateStatus: false });
            }],
            ['pause', () => {
                elements.playerAudio.pause();
            }],
            ['previoustrack', async () => {
                await stepQueue(-1, { silentBoundary: true });
            }],
            ['nexttrack', async () => {
                await stepQueue(1, { silentBoundary: true });
            }],
            ['seekbackward', details => {
                const step = Number(details?.seekOffset) || 10;
                elements.playerAudio.currentTime = Math.max(0, (Number(elements.playerAudio.currentTime) || 0) - step);
                syncMediaSessionPositionState({ force: true });
                persistPlayerState({ force: true });
            }],
            ['seekforward', details => {
                const step = Number(details?.seekOffset) || 10;
                const duration = Number(elements.playerAudio.duration);
                const currentTime = Number(elements.playerAudio.currentTime) || 0;
                const nextTime = currentTime + step;
                elements.playerAudio.currentTime = Number.isFinite(duration) && duration > 0
                    ? Math.min(duration, nextTime)
                    : nextTime;
                syncMediaSessionPositionState({ force: true });
                persistPlayerState({ force: true });
            }],
            ['seekto', details => {
                const targetTime = Number(details?.seekTime);
                if (!Number.isFinite(targetTime) || targetTime < 0) {
                    return;
                }

                elements.playerAudio.currentTime = targetTime;
                syncMediaSessionPositionState({ force: true });
                persistPlayerState({ force: true });
            }]
        ];

        handlers.forEach(([action, handler]) => {
            try {
                navigator.mediaSession.setActionHandler(action, handler);
            } catch (error) {
                // 部分移动浏览器只支持部分媒体按键，忽略不支持的动作即可。
            }
        });
    }

    function maybeResumePlaybackAfterForeground() {
        if (document.visibilityState !== 'visible') {
            persistPlayerState({ force: true });
            return;
        }

        state.visibilityResumeGuardUntil = Date.now() + VISIBILITY_RESUME_GUARD_MS;

        if (state.desiredPlaybackState !== 'playing') {
            return;
        }

        if (!state.currentTrack || !getPlayerSourceUrl() || !elements.playerAudio.paused || elements.playerAudio.ended) {
            return;
        }

        window.setTimeout(() => {
            if (document.visibilityState !== 'visible') {
                return;
            }

            if (state.desiredPlaybackState !== 'playing') {
                return;
            }

            if (!state.currentTrack || !getPlayerSourceUrl() || !elements.playerAudio.paused || elements.playerAudio.ended) {
                return;
            }

            void resumeAudioPlayback();
        }, 120);
    }

    async function requestTrackMedia(track, quality) {
        const query = new URLSearchParams({
            plugin: track.plugin,
            id: track.id,
            quality: quality || track.defaultQuality
        });
        const payload = await fetchJson(`/api/music/media?${query.toString()}`);
        return {
            mediaTrack: mergeTrackData(track, payload.track || track),
            media: payload.media || {}
        };
    }

    async function downloadTrack(track, quality, button) {
        if (!track || track.playable === false) {
            UI.showToast(track?.playableReason || `${track?.plugin || '当前插件'} 暂不支持下载`, 'error');
            return;
        }

        const query = new URLSearchParams({
            plugin: track.plugin,
            id: track.id,
            quality: quality || track.defaultQuality
        });
        const originalContent = button ? button.innerHTML : '';

        if (button) {
            button.disabled = true;
            button.classList.add('is-loading');
            button.innerHTML = '<span aria-hidden="true">…</span>';
        }

        try {
            const response = await fetch(`/api/music/download?${query.toString()}`);
            if (!response.ok) {
                let message = '下载失败，请稍后再试';
                try {
                    const payload = await response.json();
                    message = payload?.error || message;
                } catch (error) {
                    const text = await response.text();
                    if (text) {
                        message = text;
                    }
                }
                throw new Error(message);
            }

            const blob = await response.blob();
            const contentType = response.headers.get('content-type') || blob.type || '';
            const filename = parseDownloadFilename(response.headers.get('content-disposition'))
                || buildTrackDownloadFilename(track, contentType);
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = filename;
            link.rel = 'noopener';
            document.body.appendChild(link);
            link.click();
            link.remove();

            window.setTimeout(() => {
                URL.revokeObjectURL(objectUrl);
            }, 1000);

            UI.showToast(`开始下载：${track.title}`, 'success');
        } catch (error) {
            UI.showToast(error.message || '下载失败，请稍后再试', 'error');
        } finally {
            if (button) {
                button.disabled = false;
                button.classList.remove('is-loading');
                button.innerHTML = originalContent;
            }
        }
    }

    function getQueueTrack(index) {
        if (index < 0 || index >= state.queue.length) {
            return null;
        }

        return state.queue[index] || null;
    }

    function getRandomQueueIndex(excludeIndex = -1) {
        const excludedIndexes = Array.isArray(excludeIndex)
            ? excludeIndex.filter(index => Number.isInteger(index))
            : [excludeIndex].filter(index => Number.isInteger(index));

        if (!state.queue.length) {
            return -1;
        }

        if (state.queue.length === 1) {
            return excludedIndexes.includes(0) ? -1 : 0;
        }

        const candidates = state.queue
            .map((_, index) => index)
            .filter(index => !excludedIndexes.includes(index));
        if (candidates.length === 0) {
            return -1;
        }

        return candidates[Math.floor(Math.random() * candidates.length)] ?? -1;
    }

    function resolvePreviousQueueIndex() {
        if (!state.queue.length || state.currentQueueIndex < 0) {
            return -1;
        }

        const previousIndex = state.currentQueueIndex - 1;
        if (previousIndex >= 0) {
            return previousIndex;
        }

        if (state.playMode === PLAY_MODES.LOOP && state.queue.length > 0) {
            return state.queue.length - 1;
        }

        return -1;
    }

    function resolveNextQueueIndex(options = {}) {
        if (!state.queue.length || state.currentQueueIndex < 0) {
            return -1;
        }

        if (state.playMode === PLAY_MODES.SHUFFLE) {
            const randomIndex = getRandomQueueIndex(state.currentQueueIndex);
            if (randomIndex >= 0) {
                return randomIndex;
            }

            return -1;
        }

        const nextIndex = state.currentQueueIndex + 1;
        if (nextIndex < state.queue.length) {
            return nextIndex;
        }

        if (state.playMode === PLAY_MODES.LOOP && state.queue.length > 0) {
            return 0;
        }

        return -1;
    }

    function getNextQueueTrack(options = {}) {
        return getQueueTrack(resolveNextQueueIndex(options));
    }

    function resolveAutoplayTarget() {
        const nextIndex = resolveNextQueueIndex({ isAutoplay: true });
        return {
            nextIndex,
            nextTrack: getQueueTrack(nextIndex)
        };
    }

    function getUpcomingQueueIndexes() {
        if (!state.queue.length || state.currentQueueIndex < 0 || state.playMode === PLAY_MODES.SHUFFLE) {
            return [];
        }

        const indexes = [];
        let cursor = state.currentQueueIndex;

        for (let offset = 0; offset < PREFETCH_AHEAD_COUNT; offset += 1) {
            let nextIndex = cursor + 1;
            if (nextIndex >= state.queue.length) {
                if (state.playMode !== PLAY_MODES.LOOP) {
                    break;
                }
                nextIndex = 0;
            }

            if (indexes.includes(nextIndex) || nextIndex === state.currentQueueIndex) {
                break;
            }

            indexes.push(nextIndex);
            cursor = nextIndex;
        }

        return indexes;
    }

    function getPrefetchedTrackMedia(track, quality) {
        if (!track) {
            return null;
        }

        const requestKey = getTrackRequestKey(track, quality);
        const cached = state.prefetchedTrackMedia?.[requestKey];
        return cached && cached.media?.url ? cached : null;
    }

    function canUsePrefetchedTrack(track, quality) {
        return Boolean(getPrefetchedTrackMedia(track, quality));
    }

    function getUpcomingRequestKeys() {
        return getUpcomingQueueIndexes()
            .map(index => getQueueTrack(index))
            .filter(Boolean)
            .map(track => getTrackRequestKey(track, track.defaultQuality));
    }

    function prunePrefetchedTrackMedia() {
        const allowedKeys = new Set(getUpcomingRequestKeys());
        const nextCache = {};

        Object.entries(state.prefetchedTrackMedia || {}).forEach(([requestKey, value]) => {
            if (!allowedKeys.has(requestKey)) {
                return;
            }
            nextCache[requestKey] = value;
        });

        state.prefetchedTrackMedia = nextCache;
    }

    async function prefetchTrackMedia(track, quality) {
        if (!track) {
            return;
        }

        const requestKey = getTrackRequestKey(track, quality);
        if (state.prefetchingTrackKeys.includes(requestKey) || canUsePrefetchedTrack(track, quality)) {
            return;
        }

        state.prefetchingTrackKeys.push(requestKey);

        try {
            const resolved = await requestTrackMedia(track, quality);
            if (!resolved.media?.url) {
                return;
            }

            state.prefetchedTrackMedia[requestKey] = {
                requestKey,
                trackKey: getTrackKey(track),
                quality: quality || track.defaultQuality,
                mediaTrack: resolved.mediaTrack,
                media: resolved.media
            };
            prunePrefetchedTrackMedia();
        } catch (error) {
            // 预取失败不影响当前播放，等真正切歌时再正常请求。
        } finally {
            state.prefetchingTrackKeys = state.prefetchingTrackKeys.filter(item => item !== requestKey);
        }
    }

    function maybePrefetchNextTrack(options = {}) {
        const upcomingIndexes = getUpcomingQueueIndexes();

        if (options.force) {
            upcomingIndexes.forEach(index => {
                const track = getQueueTrack(index);
                if (track) {
                    void prefetchTrackMedia(track, track.defaultQuality);
                }
            });
            return;
        }

        const duration = Number(elements.playerAudio.duration);
        const currentTime = Number(elements.playerAudio.currentTime) || 0;

        if (!Number.isFinite(duration) || duration <= 0) {
            return;
        }

        if (duration - currentTime > NEXT_TRACK_PREFETCH_THRESHOLD_SECONDS) {
            return;
        }

        upcomingIndexes.forEach(index => {
            const track = getQueueTrack(index);
            if (track) {
                void prefetchTrackMedia(track, track.defaultQuality);
            }
        });
    }

    async function maybeAdvanceBeforeTrackEnds() {
        if (state.queueStepInFlight || state.isTrackTransitioning) {
            return;
        }

        const currentTrack = state.currentTrack;
        const { nextIndex, nextTrack } = resolveAutoplayTarget();
        if (!currentTrack || nextIndex < 0 || !nextTrack) {
            return;
        }

        const duration = Number(elements.playerAudio.duration);
        const currentTime = Number(elements.playerAudio.currentTime) || 0;
        if (!Number.isFinite(duration) || duration <= 0) {
            return;
        }

        const remaining = duration - currentTime;
        if (remaining > EARLY_TRACK_ADVANCE_THRESHOLD_SECONDS) {
            return;
        }

        const currentTrackKey = getTrackKey(currentTrack);
        if (state.nearEndAdvanceTrackKey === currentTrackKey) {
            return;
        }

        if (!canUsePrefetchedTrack(nextTrack, nextTrack.defaultQuality)) {
            return;
        }

        state.nearEndAdvanceTrackKey = currentTrackKey;
        beginTrackTransition(nextTrack);
        persistPlayerState({ force: true });
        await stepQueue(1, {
            silentBoundary: true,
            autoSkipOnFailure: true,
            isAutoplay: true,
            targetIndex: nextIndex
        });
    }

    function isNearTrackCompletion() {
        const duration = Number(elements.playerAudio.duration);
        const currentTime = Number(elements.playerAudio.currentTime) || 0;
        if (!Number.isFinite(duration) || duration <= 0) {
            return false;
        }

        return duration - currentTime <= TRACK_COMPLETION_PAUSE_THRESHOLD_SECONDS;
    }

    function updateLyricDialogState() {
        const isOpen = Boolean(elements.lyricOverlay && !elements.lyricOverlay.hidden);
        if (elements.lyricToggleButton) {
            elements.lyricToggleButton.setAttribute('aria-expanded', String(isOpen));
        }
    }

    function updateQueueDrawerState() {
        const isOpen = Boolean(elements.queueOverlay && !elements.queueOverlay.hidden);
        if (elements.queueToggleButton) {
            elements.queueToggleButton.setAttribute('aria-expanded', String(isOpen));
        }
    }

    function openLyricDialog() {
        if (!elements.lyricOverlay) {
            return;
        }

        if (elements.queueOverlay && !elements.queueOverlay.hidden) {
            closeQueueDrawer();
        }

        if (lyricDialogHideTimer) {
            clearTimeout(lyricDialogHideTimer);
            lyricDialogHideTimer = null;
        }

        elements.lyricOverlay.hidden = false;
        updateLyricDialogState();
        requestAnimationFrame(() => {
            elements.lyricOverlay.classList.add('is-visible');
        });
        if (elements.lyricCloseButton) {
            elements.lyricCloseButton.focus();
        }
    }

    function closeLyricDialog(options = {}) {
        if (!elements.lyricOverlay) {
            return;
        }

        elements.lyricOverlay.classList.remove('is-visible');
        updateLyricDialogState();

        if (lyricDialogHideTimer) {
            clearTimeout(lyricDialogHideTimer);
        }

        lyricDialogHideTimer = window.setTimeout(() => {
            elements.lyricOverlay.hidden = true;
            lyricDialogHideTimer = null;
        }, LYRIC_DIALOG_ANIMATION_MS);

        if (options.restoreFocus && elements.lyricToggleButton) {
            elements.lyricToggleButton.focus();
        }
    }

    function toggleLyricDialog() {
        if (!elements.lyricOverlay) {
            return;
        }

        if (elements.lyricOverlay.hidden) {
            openLyricDialog();
            return;
        }

        closeLyricDialog({ restoreFocus: true });
    }

    function openQueueDrawer() {
        if (!elements.queueOverlay) {
            return;
        }

        if (elements.lyricOverlay && !elements.lyricOverlay.hidden) {
            closeLyricDialog();
        }

        if (queueDrawerHideTimer) {
            clearTimeout(queueDrawerHideTimer);
            queueDrawerHideTimer = null;
        }

        elements.queueOverlay.hidden = false;
        updateQueueDrawerState();
        requestAnimationFrame(() => {
            elements.queueOverlay.classList.add('is-visible');
            syncQueueDrawerPosition({ behavior: 'auto' });
        });
        if (elements.queueCloseButton) {
            elements.queueCloseButton.focus();
        }
    }

    function closeQueueDrawer(options = {}) {
        if (!elements.queueOverlay) {
            return;
        }

        elements.queueOverlay.classList.remove('is-visible');
        updateQueueDrawerState();

        if (queueDrawerHideTimer) {
            clearTimeout(queueDrawerHideTimer);
        }

        queueDrawerHideTimer = window.setTimeout(() => {
            elements.queueOverlay.hidden = true;
            queueDrawerHideTimer = null;
        }, QUEUE_DRAWER_ANIMATION_MS);

        if (options.restoreFocus && elements.queueToggleButton) {
            elements.queueToggleButton.focus();
        }
    }

    function toggleQueueDrawer() {
        if (!elements.queueOverlay) {
            return;
        }

        if (elements.queueOverlay.hidden) {
            openQueueDrawer();
            return;
        }

        closeQueueDrawer({ restoreFocus: true });
    }

    function syncQueueDrawerPosition(options = {}) {
        if (!elements.queueOverlay || elements.queueOverlay.hidden) {
            return;
        }

        const activeItem = elements.queueList?.querySelector('.music-queue-row.active');
        if (activeItem) {
            activeItem.scrollIntoView({
                block: 'center',
                behavior: options.behavior || 'smooth'
            });
            return;
        }

        elements.queueList?.scrollTo({
            top: 0,
            behavior: options.behavior || 'auto'
        });
    }

    async function fetchJson(url) {
        const response = await fetch(url, {
            cache: 'no-store'
        });

        const text = await response.text();
        let payload = {};

        try {
            payload = text ? JSON.parse(text) : {};
        } catch (error) {
            throw new Error('返回结果不是有效的 JSON');
        }

        if (!response.ok) {
            throw new Error(payload.error || `请求失败：HTTP ${response.status}`);
        }

        return payload;
    }

    function formatBytes(size) {
        const value = Number(size) || 0;
        if (!value) {
            return '';
        }

        if (value < 1024 * 1024) {
            return `${Math.round(value / 1024)} KB`;
        }

        return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }

    function formatDurationText(duration) {
        const rawValue = Number(duration) || 0;
        const totalSeconds = rawValue > 1000 ? Math.round(rawValue / 1000) : Math.round(rawValue);
        if (!totalSeconds) {
            return '';
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

    function getRenderableQualities(track) {
        const qualities = Array.isArray(track?.qualities) ? track.qualities.filter(item => item && item.key) : [];
        if (qualities.length > 0) {
            return qualities;
        }

        return [{
            key: track?.defaultQuality || 'standard',
            size: 0,
            isFallback: true
        }];
    }

    function mergeTrackData(baseTrack, incomingTrack = {}) {
        const mergedDuration = Number(incomingTrack.duration) || Number(baseTrack.duration) || 0;
        const mergedQualities = Array.isArray(incomingTrack.qualities) && incomingTrack.qualities.length > 0
            ? incomingTrack.qualities
            : (Array.isArray(baseTrack.qualities) ? baseTrack.qualities : []);

        return {
            ...baseTrack,
            ...incomingTrack,
            artwork: incomingTrack.artwork || baseTrack.artwork || '',
            album: incomingTrack.album || baseTrack.album || '',
            artist: incomingTrack.artist || baseTrack.artist || '',
            title: incomingTrack.title || baseTrack.title || '',
            duration: mergedDuration,
            durationText: formatDurationText(mergedDuration) || incomingTrack.durationText || baseTrack.durationText || '',
            qualities: mergedQualities,
            defaultQuality: incomingTrack.defaultQuality || baseTrack.defaultQuality || mergedQualities[0]?.key || 'standard'
        };
    }

    function trackNeedsHydration(track) {
        return !Number(track?.duration) || !Array.isArray(track?.qualities) || track.qualities.length === 0;
    }

    function patchTrackCollections(updatedTrack, options = {}) {
        if (!updatedTrack?.id || !updatedTrack?.plugin) {
            return;
        }

        const targetKey = getTrackKey(updatedTrack);
        let resultsChanged = false;
        state.searchResults = state.searchResults.map(track => {
            if (getTrackKey(track) !== targetKey) {
                return track;
            }

            resultsChanged = true;
            return mergeTrackData(track, updatedTrack);
        });

        let queueChanged = false;
        state.queue = state.queue.map(track => {
            if (getTrackKey(track) !== targetKey) {
                return track;
            }

            queueChanged = true;
            return mergeTrackData(track, updatedTrack);
        });

        if (state.currentTrack && getTrackKey(state.currentTrack) === targetKey) {
            state.currentTrack = mergeTrackData(state.currentTrack, updatedTrack);
            updateCurrentShowcase(state.currentTrack, state.currentQuality);
        }

        if (resultsChanged && options.renderResults) {
            renderResults(state.searchResults);
        }

        if (queueChanged && options.renderQueue) {
            renderQueue();
        }
    }

    async function fetchTrackDetails(track) {
        const query = new URLSearchParams({
            plugin: track.plugin,
            id: track.id
        });
        const payload = await fetchJson(`/api/music/track?${query.toString()}`);
        return payload.track || null;
    }

    async function hydrateSearchResultsMetadata() {
        const token = ++state.resultsHydrationToken;
        const pendingTracks = state.searchResults.filter(trackNeedsHydration).slice(0, 24);
        if (pendingTracks.length === 0) {
            return;
        }

        const updates = await Promise.all(pendingTracks.map(async track => {
            try {
                const detailTrack = await fetchTrackDetails(track);
                if (!detailTrack) {
                    return null;
                }

                return {
                    key: getTrackKey(track),
                    track: mergeTrackData(track, detailTrack)
                };
            } catch (error) {
                return null;
            }
        }));

        if (token !== state.resultsHydrationToken) {
            return;
        }

        const updateMap = new Map(
            updates
                .filter(Boolean)
                .map(item => [item.key, item.track])
        );

        if (updateMap.size === 0) {
            return;
        }

        let changed = false;
        state.searchResults = state.searchResults.map(track => {
            const nextTrack = updateMap.get(getTrackKey(track));
            if (!nextTrack) {
                return track;
            }

            changed = true;
            return nextTrack;
        });

        if (!changed) {
            return;
        }

        state.queue = state.queue.map(track => updateMap.get(getTrackKey(track)) || track);
        if (state.currentTrack) {
            state.currentTrack = updateMap.get(getTrackKey(state.currentTrack)) || state.currentTrack;
            updateCurrentShowcase(state.currentTrack, state.currentQuality);
        }

        renderResults(state.searchResults);
        renderQueue();
    }

    function syncRealDurationFromPlayer() {
        if (!state.currentTrack) {
            return;
        }

        const audioDuration = Number(elements.playerAudio.duration);
        if (!Number.isFinite(audioDuration) || audioDuration <= 0) {
            return;
        }

        const nextDuration = Math.round(audioDuration);
        const prevDuration = Number(state.currentTrack.duration) > 1000
            ? Math.round(Number(state.currentTrack.duration) / 1000)
            : Math.round(Number(state.currentTrack.duration) || 0);

        if (prevDuration > 0 && Math.abs(prevDuration - nextDuration) < 2) {
            return;
        }

        patchTrackCollections({
            ...state.currentTrack,
            duration: nextDuration,
            durationText: formatDurationText(nextDuration)
        }, {
            renderResults: true,
            renderQueue: true
        });
    }

    function renderTrackTags(track) {
        const tags = [];

        if (track.plugin) {
            tags.push(UI.renderBadge(track.plugin, 'accent'));
        }

        if (Number(track?.duration) > 0) {
            tags.push(UI.renderBadge(track.durationText, 'success'));
        }

        if (track.playable === false) {
            tags.push(UI.renderBadge('仅搜索', 'default'));
        }

        return tags.join('');
    }

    function getTrackKey(track) {
        return `${track?.plugin || ''}::${track?.id || ''}`;
    }

    function findQueueIndex(track, queue = state.queue) {
        const targetKey = getTrackKey(track);
        return queue.findIndex(item => getTrackKey(item) === targetKey);
    }

    function parseLrc(rawLrc, translation = '') {
        const translationMap = new Map();
        const translationLines = String(translation || '').split(/\r?\n/);

        translationLines.forEach(line => {
            const timeTags = [...line.matchAll(/\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
            const text = line.replace(/\[[^\]]+\]/g, '').trim();
            if (!text || timeTags.length === 0) {
                return;
            }

            timeTags.forEach(match => {
                const time = toLyricSeconds(match[1], match[2], match[3]);
                translationMap.set(time.toFixed(3), text);
            });
        });

        const parsed = [];
        const lines = String(rawLrc || '').split(/\r?\n/);
        lines.forEach(line => {
            const timeTags = [...line.matchAll(/\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
            const text = line.replace(/\[[^\]]+\]/g, '').trim();
            if (timeTags.length === 0) {
                return;
            }

            timeTags.forEach(match => {
                const time = toLyricSeconds(match[1], match[2], match[3]);
                parsed.push({
                    time,
                    text,
                    translation: translationMap.get(time.toFixed(3)) || ''
                });
            });
        });

        return parsed
            .filter(item => item.text)
            .sort((a, b) => a.time - b.time);
    }

    function toLyricSeconds(minutes, seconds, fraction) {
        const minuteValue = Number(minutes || 0);
        const secondValue = Number(seconds || 0);
        const fractionText = String(fraction || '0').padEnd(3, '0').slice(0, 3);
        const fractionValue = Number(fractionText) / 1000;
        return minuteValue * 60 + secondValue + fractionValue;
    }

    function renderLyrics() {
        const lyrics = state.currentLyrics;
        if (!lyrics || lyrics.length === 0) {
            UI.showEmpty(elements.lyricBody, '暂无歌词', '当前歌曲没有返回可展示的 LRC 歌词。');
            return;
        }

        elements.lyricBody.innerHTML = `
            <div class="music-lyric-lines">
                ${lyrics.map((line, index) => `
                    <div class="music-lyric-line ${index === state.activeLyricIndex ? 'active' : ''}" data-lyric-index="${index}">
                        <p>${escapeHtml(line.text)}</p>
                        ${line.translation ? `<span>${escapeHtml(line.translation)}</span>` : ''}
                    </div>
                `).join('')}
            </div>
        `;
    }

    function stopPlayback() {
        if (!state.currentTrack && !getPlayerSourceUrl()) {
            return;
        }

        state.isTrackTransitioning = false;
        state.nearEndAdvanceTrackKey = '';
        state.desiredPlaybackState = 'paused';
        updateMediaSessionPlaybackState();
        elements.playerAudio.pause();

        try {
            elements.playerAudio.currentTime = 0;
        } catch (error) {
            // 部分浏览器在媒体未就绪时会抛错，忽略即可。
        }

        markDesiredPlaybackState('paused');
        syncMediaSessionPositionState({ force: true });
        if (state.currentTrack) {
            elements.playerStatus.textContent = `已停止 ${state.currentTrack.title}`;
        } else {
            elements.playerStatus.textContent = '播放已停止';
        }
        updateTransportToggleButton();
        persistPlayerState({ force: true });
    }

    function updateQueueActions() {
        const hasQueue = state.queue.length > 0 && state.currentQueueIndex >= 0;
        const canPrev = hasQueue && resolvePreviousQueueIndex() >= 0;
        const canNext = hasQueue && resolveNextQueueIndex() >= 0;

        elements.prevTrackButton.disabled = !canPrev;
        elements.nextTrackButton.disabled = !canNext;
        updateTransportToggleButton();
        elements.clearQueueButton.disabled = state.queue.length === 0;
        if (elements.queueToggleButton) {
            elements.queueToggleButton.setAttribute('aria-label', `播放队列，当前 ${state.queue.length} 首`);
            elements.queueToggleButton.title = `播放队列（${state.queue.length} 首）`;
        }
        if (elements.queueToggleBadge) {
            elements.queueToggleBadge.textContent = String(state.queue.length);
        }
        if (elements.queueCount) {
            elements.queueCount.textContent = `${state.queue.length} 首`;
        }

        if (!hasQueue) {
            elements.queueStatus.textContent = state.queue.length > 0
                ? `队列共 ${state.queue.length} 首，当前播放未锁定在队列中`
                : '等待加入队列';
            return;
        }

        elements.queueStatus.textContent = `第 ${state.currentQueueIndex + 1} 首 / 共 ${state.queue.length} 首`;
    }

    function renderQueue() {
        if (!state.queue.length) {
            UI.showEmpty(elements.queueList, '队列为空', '搜索结果中点击“立即播放”后，这里会保留当前队列。');
            updateQueueActions();
            return;
        }

        elements.queueList.innerHTML = state.queue.map((track, index) => `
            <div class="music-queue-row ${index === state.currentQueueIndex ? 'active' : ''}" data-queue-index="${index}">
                <button type="button" class="music-queue-item ${index === state.currentQueueIndex ? 'active' : ''}" data-queue-index="${index}">
                    <span class="music-queue-item-index">${String(index + 1).padStart(2, '0')}</span>
                    <span class="music-queue-item-copy">
                        <strong>${escapeHtml(track.title)}</strong>
                        <em>${escapeHtml(track.artist || '未知歌手')}${Number(track?.duration) > 0 ? ` · ${escapeHtml(track.durationText)}` : ''}</em>
                    </span>
                    <span class="music-queue-item-plugin">${escapeHtml(track.plugin)}</span>
                </button>
                <button type="button" class="music-queue-remove" data-remove-index="${index}">移除</button>
            </div>
        `).join('');

        elements.queueList.querySelectorAll('.music-queue-item').forEach(button => {
            button.addEventListener('click', async () => {
                const index = Number(button.dataset.queueIndex);
                const track = state.queue[index];
                if (!track) {
                    return;
                }
                await playTrack(track, track.defaultQuality, {
                    queue: state.queue,
                    queueIndex: index
                });
            });
        });

        elements.queueList.querySelectorAll('.music-queue-remove').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                removeFromQueue(Number(button.dataset.removeIndex));
            });
        });

        updateQueueActions();
        syncQueueDrawerPosition();
    }

    function clearQueue(options = {}) {
        state.queue = [];
        state.currentQueueIndex = -1;
        renderQueue();
        persistPlayerState({ force: true });

        if (!options.silent) {
            UI.showToast('播放队列已清空', 'success');
        }
    }

    function removeFromQueue(index) {
        if (index < 0 || index >= state.queue.length) {
            return;
        }

        const removedTrack = state.queue[index];
        state.queue.splice(index, 1);

        if (index < state.currentQueueIndex) {
            state.currentQueueIndex -= 1;
        } else if (index === state.currentQueueIndex) {
            state.currentQueueIndex = -1;
        }

        renderQueue();
        persistPlayerState({ force: true });

        if (state.currentTrack && getTrackKey(state.currentTrack) === getTrackKey(removedTrack)) {
            elements.queueStatus.textContent = state.queue.length > 0
                ? `已移除当前歌曲，队列剩余 ${state.queue.length} 首`
                : '当前歌曲已从队列移除';
        }

        UI.showToast(`已从队列移除 ${removedTrack.title}`, 'success');
    }

    function addToQueue(track, options = {}) {
        if (!track) {
            return false;
        }

        const existingIndex = findQueueIndex(track);
        if (existingIndex >= 0) {
            if (options.focusExisting) {
                state.currentQueueIndex = existingIndex;
                renderQueue();
            }
            return false;
        }

        state.queue.push({ ...track });
        if (options.makeCurrent) {
            state.currentQueueIndex = state.queue.length - 1;
        }
        renderQueue();
        persistPlayerState({ force: true });
        return true;
    }

    function syncLyricByCurrentTime() {
        if (!state.currentLyrics.length) {
            return;
        }

        const currentTime = elements.playerAudio.currentTime || 0;
        let nextIndex = -1;

        for (let index = 0; index < state.currentLyrics.length; index += 1) {
            const currentLine = state.currentLyrics[index];
            const nextLine = state.currentLyrics[index + 1];
            if (currentTime >= currentLine.time && (!nextLine || currentTime < nextLine.time)) {
                nextIndex = index;
                break;
            }
        }

        if (nextIndex === state.activeLyricIndex) {
            return;
        }

        state.activeLyricIndex = nextIndex;
        elements.lyricBody.querySelectorAll('.music-lyric-line').forEach((node, index) => {
            node.classList.toggle('active', index === nextIndex);
        });

        const activeLine = nextIndex >= 0
            ? elements.lyricBody.querySelector(`.music-lyric-line[data-lyric-index="${nextIndex}"]`)
            : null;

        if (activeLine && elements.lyricOverlay && !elements.lyricOverlay.hidden) {
            activeLine.scrollIntoView({
                block: 'center',
                behavior: 'smooth'
            });
        }
    }

    async function loadLyrics(track) {
        elements.lyricStatus.textContent = `正在加载 ${track.title} 的歌词...`;
        UI.showLoading(elements.lyricBody, '正在同步歌词...');
        state.currentLyrics = [];
        state.activeLyricIndex = -1;

        try {
            const query = new URLSearchParams({
                plugin: track.plugin,
                id: track.id
            });
            const payload = await fetchJson(`/api/music/lyric?${query.toString()}`);
            state.currentLyrics = parseLrc(payload.lyric?.rawLrc || '', payload.lyric?.translation || '');
            const lyricSourceName = payload.plugin || track.plugin || '';
            const lyricSourceText = payload.fallback && lyricSourceName
                ? ` · 由 ${lyricSourceName} 补充`
                : (lyricSourceName ? ` · 来自 ${lyricSourceName}` : '');
            elements.lyricStatus.textContent = state.currentLyrics.length > 0
                ? `已加载 ${state.currentLyrics.length} 行歌词${lyricSourceText}`
                : '当前歌曲暂无可展示歌词';
            renderLyrics();
            syncLyricByCurrentTime();
        } catch (error) {
            elements.lyricStatus.textContent = '歌词加载失败';
            UI.showError(elements.lyricBody, error.message || '歌词加载失败');
        }
    }

    function updateLyricDialogTitle(track) {
        if (!elements.lyricDialogTitle) {
            return;
        }

        elements.lyricDialogTitle.textContent = track?.title
            ? `${track.title} 歌词`
            : '当前歌曲歌词';
    }

    function updateCurrentShowcase(track, qualityLabel) {
        const coverMarkup = track.artwork
            ? `<img src="${escapeHtml(track.artwork)}" alt="${escapeHtml(track.title)}">`
            : escapeHtml(track.title.slice(0, 4) || '浮光');

        elements.playerCover.innerHTML = coverMarkup;
        elements.playerTitle.textContent = track.title;
        elements.playerArtist.textContent = `${track.artist}${track.album ? ` · ${track.album}` : ''}`;
        elements.playerTags.innerHTML = renderTrackTags(track);
        elements.playerAudio.removeAttribute('title');
        updateLyricDialogTitle(track);
        updateMediaSessionMetadata(track);
    }

    function getPluginTabKey(plugin) {
        if (!plugin) {
            return 'recommended';
        }

        if (!plugin.searchable) {
            return 'non-music';
        }

        if (plugin.recommended) {
            return 'recommended';
        }

        return 'other-music';
    }

    function syncPluginTabByActivePlugin() {
        if (state.activePlugin === 'all') {
            state.pluginTab = 'recommended';
            return;
        }

        const activePlugin = state.plugins.find(plugin => plugin.name === state.activePlugin);
        state.pluginTab = getPluginTabKey(activePlugin);
    }

    function getPluginPanelElement() {
        return elements.pluginPanel || elements.pluginChips?.closest('.music-plugin-panel') || null;
    }

    function getStickyHeaderOffset() {
        const header = document.querySelector('.header');
        if (!header) {
            return 12;
        }

        const styles = window.getComputedStyle(header);
        const borderBottomWidth = Number.parseFloat(styles.borderBottomWidth) || 0;
        return Math.ceil(header.getBoundingClientRect().height + borderBottomWidth + 12);
    }

    function scrollToPluginPanel(options = {}) {
        const panel = getPluginPanelElement();
        if (!panel) {
            return;
        }

        const targetTop = Math.max(
            0,
            window.scrollY + panel.getBoundingClientRect().top - getStickyHeaderOffset()
        );
        const currentTop = window.scrollY || document.documentElement.scrollTop || 0;
        if (!options.force && Math.abs(currentTop - targetTop) < 12) {
            return;
        }

        window.scrollTo({
            top: targetTop,
            behavior: options.behavior || 'smooth'
        });
    }

    function getResultsPanelElement() {
        return elements.resultsPanel || elements.results?.closest('.panel-card') || null;
    }

    function scrollToResultsPanel(options = {}) {
        const panel = getResultsPanelElement();
        if (!panel) {
            return;
        }

        const targetTop = Math.max(
            0,
            window.scrollY + panel.getBoundingClientRect().top - getStickyHeaderOffset()
        );
        const currentTop = window.scrollY || document.documentElement.scrollTop || 0;
        if (!options.force && Math.abs(currentTop - targetTop) < 12) {
            return;
        }

        window.scrollTo({
            top: targetTop,
            behavior: options.behavior || 'smooth'
        });
    }

    function resetSearchPagination(options = {}) {
        if (options.clearKeyword) {
            state.currentKeyword = '';
        }

        state.searchPaginationVisible = false;
        state.searchPage = 1;
        state.searchHasNextPage = false;
        state.searchPluginStatuses = [];
        state.isSearchPaginationLoading = false;
        renderSearchPagination();
    }

    function updateSearchPagination(pluginStatuses, page) {
        state.searchPage = Math.max(1, Number(page) || 1);
        state.searchPluginStatuses = Array.isArray(pluginStatuses) ? pluginStatuses.map(item => ({ ...item })) : [];
        state.searchHasNextPage = state.searchPluginStatuses.some(plugin => (
            plugin?.ok
            && Number(plugin?.count) > 0
            && plugin?.isEnd === false
        ));
    }

    function renderSearchPagination() {
        if (!elements.searchPagination) {
            return;
        }

        const shouldShow = Boolean(state.searchPaginationVisible);
        if (!shouldShow) {
            elements.searchPagination.hidden = true;
            elements.searchPagination.innerHTML = '';
            return;
        }

        const currentPage = Math.max(1, Number(state.searchPage) || 1);
        const firstDisabled = currentPage <= 1 || state.isSearchPaginationLoading;
        const prevDisabled = currentPage <= 1 || state.isSearchPaginationLoading;
        const nextDisabled = !state.searchHasNextPage || state.isSearchPaginationLoading;
        const pageLabel = state.isSearchPaginationLoading
            ? `第 ${currentPage} 页加载中...`
            : `第 ${currentPage} 页`;

        elements.searchPagination.hidden = false;
        elements.searchPagination.innerHTML = `
            <button type="button" data-search-page-action="first" ${firstDisabled ? 'disabled' : ''}>首页</button>
            <button type="button" data-search-page-action="prev" ${prevDisabled ? 'disabled' : ''}>上一页</button>
            <span class="page-info">${escapeHtml(pageLabel)}</span>
            <button type="button" data-search-page-action="next" ${nextDisabled ? 'disabled' : ''}>下一页</button>
        `;

        elements.searchPagination.querySelector('[data-search-page-action="first"]')?.addEventListener('click', () => {
            if (state.searchPage <= 1 || state.isSearchPaginationLoading) {
                return;
            }

            void performSearch({
                page: 1,
                keyword: state.currentKeyword,
                scrollToResults: true
            });
        });

        elements.searchPagination.querySelector('[data-search-page-action="prev"]')?.addEventListener('click', () => {
            if (state.searchPage <= 1 || state.isSearchPaginationLoading) {
                return;
            }

            void performSearch({
                page: state.searchPage - 1,
                keyword: state.currentKeyword,
                scrollToResults: true
            });
        });

        elements.searchPagination.querySelector('[data-search-page-action="next"]')?.addEventListener('click', () => {
            if (!state.searchHasNextPage || state.isSearchPaginationLoading) {
                return;
            }

            void performSearch({
                page: state.searchPage + 1,
                keyword: state.currentKeyword,
                scrollToResults: true
            });
        });
    }

    function buildPluginTabsMarkup(tabs, activeTabKey) {
        const activeTab = tabs.find(tab => tab.key === activeTabKey) || tabs[0];
        const activeTabIndex = Math.max(0, tabs.findIndex(tab => tab.key === activeTab.key));

        return `
            <div
                class="music-plugin-tabs"
                role="tablist"
                aria-label="插件分类"
                style="--tab-count:${tabs.length}; --active-tab-index:${activeTabIndex};"
            >
                <span class="music-plugin-tab-indicator" aria-hidden="true"></span>
                ${tabs.map(tab => `
                    <button
                        type="button"
                        class="music-plugin-tab ${tab.key === activeTab.key ? 'active' : ''}"
                        data-plugin-tab="${escapeHtml(tab.key)}"
                        role="tab"
                        aria-selected="${tab.key === activeTab.key ? 'true' : 'false'}"
                    >
                        <span>${escapeHtml(tab.title)}</span>
                        <em>${escapeHtml(`${tab.count} 个`)}</em>
                    </button>
                `).join('')}
            </div>
        `;
    }

    function bindPluginTabEvents(root, options = {}) {
        if (!root) {
            return;
        }

        root.querySelectorAll('[data-plugin-tab]').forEach(button => {
            button.addEventListener('click', () => {
                const nextTab = button.dataset.pluginTab || 'recommended';
                if (nextTab === state.pluginTab) {
                    if (options.scrollToPanel) {
                        scrollToPluginPanel();
                    }
                    return;
                }
                state.pluginTab = nextTab;
                renderPluginChips();
                if (options.scrollToPanel) {
                    scrollToPluginPanel({ force: true });
                }
            });
        });
    }

    function renderPluginChips() {
        const recommendedPlugins = state.enabledPlugins;
        const extraSearchablePlugins = state.plugins.filter(plugin => plugin.searchable && !plugin.recommended);
        const unsupportedPlugins = state.plugins.filter(plugin => !plugin.searchable);

        if (state.plugins.length === 0) {
            if (elements.pluginTabsDock) {
                elements.pluginTabsDock.hidden = true;
            }

            if (elements.pluginTabsDockInner) {
                elements.pluginTabsDockInner.innerHTML = '';
            }

            elements.pluginChips.innerHTML = `
                <div class="empty-state">
                    <div class="icon">🎵</div>
                    <h3>当前没有可用插件目录</h3>
                    <p>请稍后再试，或检查本地代理服务是否正常启动。</p>
                </div>
            `;
            return;
        }

        const renderChip = (plugin, options = {}) => {
            const isAll = options.mode === 'all';
            const isDisabled = Boolean(options.disabled);
            const showReason = options.showReason !== false;
            const name = isAll ? 'all' : plugin.name;
            const title = isAll ? '推荐插件' : plugin.name;
            const meta = isAll
                ? `${recommendedPlugins.length} 个`
                : `${plugin.kindLabel}${plugin.version ? ` · ${plugin.version}` : ''}`;

            return `
                <button
                    type="button"
                    class="music-plugin-chip ${state.activePlugin === name ? 'active' : ''} ${isDisabled ? 'disabled' : ''}"
                    data-plugin="${escapeHtml(name)}"
                    ${isDisabled ? 'disabled' : ''}
                    title="${escapeHtml(plugin?.reason || '从远程插件目录接入')}"
                >
                    <span>${escapeHtml(title)}</span>
                    <em>${escapeHtml(meta)}</em>
                    ${!isAll && showReason && plugin.reason ? `<strong>${escapeHtml(plugin.reason)}</strong>` : ''}
                </button>
            `;
        };

        const tabs = [
            {
                key: 'recommended',
                title: '推荐音乐插件',
                caption: '',
                count: recommendedPlugins.length,
                content: recommendedPlugins.map(plugin => renderChip(plugin, { showReason: false })).join(''),
                emptyTitle: '暂无推荐音乐插件',
                emptyDescription: '当前还没有通过完整验证的推荐插件。'
            },
            {
                key: 'other-music',
                title: '其他音乐插件',
                caption: '',
                count: extraSearchablePlugins.length,
                content: extraSearchablePlugins.map(plugin => renderChip(plugin, { showReason: false })).join(''),
                emptyTitle: '当前没有其他音乐插件',
                emptyDescription: '远程目录里暂时没有待筛选的额外音乐插件。'
            },
            {
                key: 'non-music',
                title: '非音乐插件',
                caption: '',
                count: unsupportedPlugins.length,
                content: unsupportedPlugins.map(plugin => renderChip(plugin, { disabled: true })).join(''),
                emptyTitle: '当前没有非音乐插件',
                emptyDescription: '远程目录里暂时没有同步到非音乐条目。'
            }
        ];

        const activeTab = tabs.find(tab => tab.key === state.pluginTab) || tabs[0];
        const tabsMarkup = buildPluginTabsMarkup(tabs, activeTab.key);

        if (elements.pluginTabsDockInner) {
            elements.pluginTabsDockInner.innerHTML = tabsMarkup;
        }

        if (elements.pluginTabsDock) {
            elements.pluginTabsDock.hidden = false;
        }

        elements.pluginChips.innerHTML = `
            <section class="music-plugin-section music-plugin-tab-panel" data-plugin-panel="${escapeHtml(activeTab.key)}">
                ${activeTab.content
                    ? `<div class="music-plugin-chip-grid">${activeTab.content}</div>`
                    : `
                        <div class="music-plugin-empty">
                            <strong>${escapeHtml(activeTab.emptyTitle)}</strong>
                            <p>${escapeHtml(activeTab.emptyDescription)}</p>
                        </div>
                    `
                }
            </section>
        `;

        bindPluginTabEvents(elements.pluginTabsDockInner, { scrollToPanel: true });

        elements.pluginChips.querySelectorAll('.music-plugin-chip:not(.disabled)').forEach(button => {
            button.addEventListener('click', async () => {
                state.activePlugin = button.dataset.plugin || 'all';
                const hasSearchKeyword = Boolean(elements.searchInput.value.trim());
                syncPluginTabByActivePlugin();
                renderPluginChips();

                if (hasSearchKeyword) {
                    await performSearch();
                    return;
                }

                if (state.activePlugin === 'all') {
                    resetRecommendTopLists();
                    showBrowseHint();
                    return;
                }

                await loadPluginRecommendations(state.activePlugin);
            });
        });
    }

    function renderResults(list) {
        if (!Array.isArray(list) || list.length === 0) {
            UI.showEmpty(elements.results, '没有找到匹配的歌曲', '换个歌名、歌手或专辑关键词再试试。');
            return;
        }

        elements.results.innerHTML = list.map(track => {
            const isPlayable = track.playable !== false;
            const isCurrentTrack = state.currentTrack && getTrackKey(state.currentTrack) === getTrackKey(track);
            const artwork = track.artwork
                ? `<img class="track-card-cover-image" src="${escapeHtml(track.artwork)}" alt="${escapeHtml(track.title)}">`
                : `<div class="track-card-cover-fallback">${escapeHtml(track.title.slice(0, 2) || '浮光')}</div>`;

            const qualityOptions = getRenderableQualities(track).map(item => `
                <option value="${escapeHtml(item.key)}" ${item.key === track.defaultQuality ? 'selected' : ''}>
                    ${escapeHtml(item.isFallback ? `${item.key} · 自动` : item.key)}${item.size ? ` · ${escapeHtml(formatBytes(item.size))}` : ''}
                </option>
            `).join('');

            return `
                <article class="track-card ${isCurrentTrack ? 'is-current' : ''}" data-track-id="${escapeHtml(track.id)}" data-plugin="${escapeHtml(track.plugin)}">
                    <div class="track-card-side">
                        <div class="track-card-cover">${artwork}</div>
                    </div>
                    <div class="track-card-body">
                        <div class="track-card-top">
                            <div class="track-card-topline">
                                <div>
                                    <p class="track-card-title" title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</p>
                                    <p class="track-card-artist">${escapeHtml(track.artist || '未知歌手')}</p>
                                </div>
                                <div class="music-quality-inline track-card-quality">
                                    <label for="quality-${escapeHtml(track.id)}">音质</label>
                                    <select id="quality-${escapeHtml(track.id)}" class="track-quality-select">
                                        ${qualityOptions}
                                    </select>
                                </div>
                            </div>
                            <div class="track-card-tags">
                                ${isCurrentTrack ? UI.renderBadge('播放中', 'accent') : ''}
                                ${UI.renderBadge(track.plugin, 'accent')}
                                ${Number(track?.duration) > 0 ? UI.renderBadge(track.durationText, 'default') : ''}
                                ${track.playable === false ? UI.renderBadge('仅搜索', 'default') : ''}
                            </div>
                        </div>
                        <button type="button" class="track-play-inline-btn" ${isPlayable ? '' : 'disabled'} title="${escapeHtml(track.playableReason || '')}" aria-label="${escapeHtml(isPlayable ? `播放 ${track.title}` : `${track.title} 暂不可播放`)}">${isPlayable ? '▶' : '×'}</button>
                        <div class="track-card-actions">
                            <div class="track-action-buttons">
                                <button type="button" class="btn-secondary track-queue-btn" ${isPlayable ? '' : 'disabled'} title="${escapeHtml(track.playableReason || '')}">加入队列</button>
                                <button type="button" class="btn-primary track-play-btn" ${isPlayable ? '' : 'disabled'} title="${escapeHtml(track.playableReason || '')}">${isPlayable ? (isCurrentTrack ? '播放中' : '立即播放') : '暂不可播'}</button>
                            </div>
                        </div>
                    </div>
                </article>
            `;
        }).join('');

        elements.results.querySelectorAll('.track-card').forEach(card => {
            const button = card.querySelector('.track-play-btn');
            const inlinePlayButton = card.querySelector('.track-play-inline-btn');
            const queueButton = card.querySelector('.track-queue-btn');
            const qualitySelect = card.querySelector('.track-quality-select');
            const trackId = card.dataset.trackId;
            const plugin = card.dataset.plugin;
            const track = list.find(item => item.id === trackId && item.plugin === plugin);

            const playFromCard = async () => {
                if (track.playable === false) {
                    UI.showToast(track.playableReason || `${track.plugin} 当前仅支持搜索`, 'error');
                    return;
                }

                clearQueue({ silent: true });
                state.searchResults.forEach(item => {
                    if (item.playable === false) {
                        return;
                    }
                    addToQueue(item);
                });
                const queueIndex = findQueueIndex(track);
                state.currentQueueIndex = queueIndex;
                renderQueue();
                await playTrack(track, qualitySelect.value, {
                    queue: state.queue,
                    queueIndex
                });
            };

            queueButton.addEventListener('click', () => {
                if (track.playable === false) {
                    UI.showToast(track.playableReason || `${track.plugin} 当前仅支持搜索`, 'error');
                    return;
                }
                const added = addToQueue(track);
                if (added) {
                    UI.showToast(`已加入队列：${track.title}`, 'success');
                    return;
                }
                UI.showToast('这首歌已经在队列里了', 'error');
            });

            button.addEventListener('click', async () => {
                await playFromCard();
            });

            inlinePlayButton.addEventListener('click', async event => {
                event.stopPropagation();
                await playFromCard();
            });

            card.addEventListener('click', async event => {
                if (event.target.closest('button, select, label')) {
                    return;
                }

                await playFromCard();
            });
        });
    }

    function setResultTitle(text = '') {
        if (!elements.resultTitle) {
            return;
        }

        const nextText = String(text || '').trim();
        elements.resultTitle.textContent = nextText;
        elements.resultTitle.hidden = !nextText;
    }

    function setResultEyebrow(text = '') {
        if (!elements.resultEyebrow) {
            return;
        }

        elements.resultEyebrow.textContent = String(text || '').trim() || '榜单结果';
    }

    function showBrowseHint() {
        resetSearchPagination({ clearKeyword: true });
        state.searchResults = [];
        setResultEyebrow('榜单结果');
        setResultTitle('');
        elements.resultMeta.textContent = '“全部搜索”默认只检索推荐音乐插件；你也可以直接点某个推荐插件浏览它的榜单。';
        UI.showEmpty(elements.results, '等待搜索或浏览榜单', '输入歌名搜索，或先从上面的推荐插件里选一个直接查看默认榜单。');
    }

    function setTopListPanelHint(text = '') {
        if (!elements.topListStatus) {
            return;
        }

        const nextText = String(text || '').trim();
        elements.topListStatus.textContent = nextText || '榜单';
    }

    function getTopListGroupEntries() {
        return state.recommendTopListGroups.map((group, index) => ({
            ...group,
            key: `toplist-group-${index}-${normalizePluginName(group?.title || 'default')}`
        }));
    }

    function findTopListGroupEntryByTopListId(topListId) {
        if (!topListId) {
            return null;
        }

        return getTopListGroupEntries().find(group => (
            Array.isArray(group.data) && group.data.some(item => item?.id === topListId)
        )) || null;
    }

    function resolveActiveTopListGroup(options = {}) {
        const groupEntries = getTopListGroupEntries();
        if (groupEntries.length === 0) {
            state.activeTopListGroupKey = '';
            return null;
        }

        if (options.syncWithActiveTopList && state.activeTopListId) {
            const matchedGroup = findTopListGroupEntryByTopListId(state.activeTopListId);
            if (matchedGroup) {
                state.activeTopListGroupKey = matchedGroup.key;
                return matchedGroup;
            }
        }

        const currentGroup = groupEntries.find(group => group.key === state.activeTopListGroupKey);
        if (currentGroup) {
            return currentGroup;
        }

        const matchedGroup = state.activeTopListId
            ? findTopListGroupEntryByTopListId(state.activeTopListId)
            : null;
        if (matchedGroup) {
            state.activeTopListGroupKey = matchedGroup.key;
            return matchedGroup;
        }

        state.activeTopListGroupKey = groupEntries[0].key;
        return groupEntries[0];
    }

    function resetRecommendTopLists() {
        state.recommendationRequestToken += 1;
        state.activeRecommendPlugin = '';
        state.recommendTopListGroups = [];
        state.activeTopListGroupKey = '';
        state.activeTopListId = '';
        state.activeTopListGroupTitle = '';

        if (elements.topListPanel) {
            elements.topListPanel.hidden = true;
        }

        if (elements.topListStatus) {
            setTopListPanelHint();
        }

        if (elements.topListGroups) {
            elements.topListGroups.innerHTML = '';
        }
    }

    function renderRecommendTopLists() {
        if (!elements.topListPanel || !elements.topListGroups) {
            return;
        }

        if (state.currentKeyword) {
            elements.topListPanel.hidden = true;
            return;
        }

        if (!state.recommendTopListGroups.length || !state.activeRecommendPlugin) {
            resetRecommendTopLists();
            return;
        }

        const activeGroup = resolveActiveTopListGroup();
        const groupEntries = getTopListGroupEntries();
        const activeGroupItems = Array.isArray(activeGroup?.data) ? activeGroup.data : [];

        elements.topListPanel.hidden = false;
        elements.topListGroups.innerHTML = `
            <div class="music-toplist-tabs" role="tablist" aria-label="榜单分组">
                ${groupEntries.map(group => `
                    <button
                        type="button"
                        class="music-toplist-tab ${group.key === activeGroup?.key ? 'active' : ''}"
                        data-toplist-group-key="${escapeHtml(group.key)}"
                        role="tab"
                        aria-selected="${group.key === activeGroup?.key ? 'true' : 'false'}"
                    >
                        <span>${escapeHtml(group.title || '推荐榜单')}</span>
                        <em>${escapeHtml(`${Array.isArray(group.data) ? group.data.length : 0} 个`)}</em>
                    </button>
                `).join('')}
            </div>
            <section class="music-toplist-group" data-toplist-group-key="${escapeHtml(activeGroup?.key || '')}">
                <div class="music-toplist-group-head">
                    <strong>${escapeHtml(activeGroup?.title || '推荐榜单')}</strong>
                </div>
                <div class="music-toplist-row">
                    ${activeGroupItems.map(item => `
                        <button
                            type="button"
                            class="music-toplist-chip ${item.id === state.activeTopListId ? 'active' : ''}"
                            data-toplist-id="${escapeHtml(item.id)}"
                            data-toplist-group="${escapeHtml(activeGroup?.title || '')}"
                        >
                            <span>${escapeHtml(item.title || '未命名榜单')}</span>
                        </button>
                    `).join('')}
                </div>
            </section>
        `;

        elements.topListGroups.querySelectorAll('.music-toplist-tab[data-toplist-group-key]').forEach(button => {
            button.addEventListener('click', () => {
                const nextGroupKey = button.dataset.toplistGroupKey || '';
                if (!nextGroupKey || nextGroupKey === state.activeTopListGroupKey) {
                    return;
                }

                state.activeTopListGroupKey = nextGroupKey;
                renderRecommendTopLists();

                const visibleGroup = resolveActiveTopListGroup();
                const includesActiveTopList = Array.isArray(visibleGroup?.data)
                    && visibleGroup.data.some(item => item?.id === state.activeTopListId);
                if (!includesActiveTopList) {
                    elements.resultMeta.textContent = `${visibleGroup?.title || '推荐榜单'} · 请选择下方榜单查看歌曲`;
                }
            });
        });

        elements.topListGroups.querySelectorAll('[data-toplist-id]').forEach(button => {
            button.addEventListener('click', async () => {
                const topListId = button.dataset.toplistId || '';
                if (!topListId || topListId === state.activeTopListId) {
                    return;
                }

                await loadRecommendationTopListDetail(state.activeRecommendPlugin, topListId, {
                    preserveResultsOnError: true
                });
            });
        });
    }

    async function loadRecommendationTopListDetail(pluginName, topListId, options = {}) {
        if (!pluginName || !topListId) {
            return false;
        }

        const requestToken = Number.isInteger(options.requestToken)
            ? options.requestToken
            : ++state.recommendationRequestToken;
        const previousResults = state.searchResults.slice();
        const previousTopListId = state.activeTopListId;
        const previousGroupTitle = state.activeTopListGroupTitle;

        elements.resultMeta.textContent = '正在加载榜单歌曲...';

        if (!options.preserveResultsOnError) {
            UI.showLoading(elements.results, '正在加载榜单歌曲...');
        }

        try {
            const query = new URLSearchParams({
                plugin: pluginName,
                topListId
            });
            const payload = await fetchJson(`/api/music/recommend/detail?${query.toString()}`);
            if (requestToken !== state.recommendationRequestToken) {
                return false;
            }
            state.activeRecommendPlugin = pluginName;
            state.activeTopListId = payload.source?.topListId || topListId;
            state.activeTopListGroupTitle = payload.source?.groupTitle || '';
            resolveActiveTopListGroup({ syncWithActiveTopList: true });
            state.searchResults = payload.list || [];
            renderSearchPagination();
            renderRecommendTopLists();
            renderResults(state.searchResults);
            void hydrateSearchResultsMetadata();

            const sourceTitle = payload.source?.title || '推荐榜单';
            const sourceGroup = payload.source?.groupTitle || pluginName;
            setResultEyebrow('榜单结果');
            setResultTitle('');
            elements.resultMeta.textContent = `${sourceGroup} · 当前榜单：${sourceTitle} · 共 ${payload.total || state.searchResults.length} 首歌曲。`;
            setTopListPanelHint('榜单');
            return true;
        } catch (error) {
            if (requestToken !== state.recommendationRequestToken) {
                return false;
            }
            state.activeTopListId = previousTopListId;
            state.activeTopListGroupTitle = previousGroupTitle;
            renderRecommendTopLists();

            if (options.preserveResultsOnError && previousResults.length > 0) {
                state.searchResults = previousResults;
                UI.showToast(error.message || '榜单歌曲加载失败', 'error');
                elements.resultMeta.textContent = '榜单切换失败，请稍后再试';
                return false;
            }

            elements.resultMeta.textContent = `${pluginName} 推荐加载失败`;
            UI.showError(elements.results, error.message || '推荐歌曲加载失败');
            setTopListPanelHint(`${pluginName} · 榜单目录暂不可用`);
            return false;
        }
    }

    async function loadPlugins() {
        const payload = await fetchJson('/api/music/plugins');
        state.plugins = payload.plugins || [];
        state.enabledPlugins = sortPluginsByPriority(
            state.plugins.filter(plugin => plugin.recommended && plugin.searchable)
        );
        state.activePlugin = state.enabledPlugins[0]?.name || state.plugins.find(plugin => plugin.searchable)?.name || 'all';
        syncPluginTabByActivePlugin();
        setPluginStatus('');

        renderPluginChips();
    }

    async function loadPluginRecommendations(pluginName) {
        if (!pluginName || pluginName === 'all') {
            resetRecommendTopLists();
            showBrowseHint();
            return;
        }

        const plugin = state.plugins.find(item => item.name === pluginName);
        if (!plugin || !plugin.searchable) {
            resetRecommendTopLists();
            showBrowseHint();
            return;
        }

        const requestToken = ++state.recommendationRequestToken;
        state.currentKeyword = '';
        resetSearchPagination();
        state.searchResults = [];
        setResultTitle('');
        elements.resultMeta.textContent = `正在加载 ${pluginName} 的推荐榜单...`;
        UI.showLoading(elements.results, `正在载入 ${pluginName} 的推荐榜单...`);
        state.activeRecommendPlugin = pluginName;
        state.recommendTopListGroups = [];
        state.activeTopListGroupKey = '';
        state.activeTopListId = '';
        state.activeTopListGroupTitle = '';

        if (elements.topListPanel) {
            elements.topListPanel.hidden = false;
        }

        setTopListPanelHint(`正在同步 ${pluginName} 的榜单目录...`);

        if (elements.topListGroups) {
            elements.topListGroups.innerHTML = '';
        }

        try {
            const query = new URLSearchParams({
                plugin: pluginName
            });
            const payload = await fetchJson(`/api/music/recommend/toplists?${query.toString()}`);
            if (requestToken !== state.recommendationRequestToken) {
                return;
            }
            state.recommendTopListGroups = Array.isArray(payload.groups) ? payload.groups : [];
            state.activeRecommendPlugin = pluginName;
            state.activeTopListId = payload.defaultTopListId || '';
            resolveActiveTopListGroup({ syncWithActiveTopList: true });
            renderRecommendTopLists();

            if (!state.activeTopListId) {
                state.searchResults = [];
                elements.resultMeta.textContent = `${pluginName} 暂无可用榜单`;
                UI.showEmpty(elements.results, '暂无推荐榜单', '这个插件当前没有可展示的推荐榜单。');
                setTopListPanelHint(`${pluginName} · 暂无可用榜单`);
                return;
            }

            await loadRecommendationTopListDetail(pluginName, state.activeTopListId, { requestToken });
        } catch (error) {
            if (requestToken !== state.recommendationRequestToken) {
                return;
            }
            resetRecommendTopLists();
            state.searchResults = [];
            elements.resultMeta.textContent = `${pluginName} 推荐加载失败`;
            UI.showError(elements.results, error.message || '推荐歌曲加载失败');
        }
    }

    async function performSearch(options = {}) {
        const requestedPage = Math.max(1, Number(options.page) || 1);
        const rawKeyword = options.keyword ?? (requestedPage > 1 ? state.currentKeyword : elements.searchInput.value);
        const keyword = String(rawKeyword || '').trim();
        if (!keyword) {
            resetSearchPagination({ clearKeyword: true });
            updateSearchClearButton();
            elements.searchInput.focus();

            if (state.activePlugin && state.activePlugin !== 'all') {
                await loadPluginRecommendations(state.activePlugin);
                return;
            }

            showBrowseHint();
            return;
        }

        resetRecommendTopLists();
        state.currentKeyword = keyword;
        state.searchPaginationVisible = true;
        state.searchPage = requestedPage;
        state.isSearchPaginationLoading = true;
        renderSearchPagination();
        setResultEyebrow('搜索结果');
        setResultTitle(`搜索：${keyword}`);
        const activePlugin = state.activePlugin === 'all'
            ? null
            : state.plugins.find(plugin => plugin.name === state.activePlugin);

        if (activePlugin && !activePlugin.searchable) {
            UI.showToast(`当前选择的 ${activePlugin.kindLabel} 插件不参与歌曲搜索`, 'error');
            return;
        }

        elements.resultMeta.textContent = state.activePlugin === 'all'
            ? `正在检索推荐音乐插件，第 ${requestedPage} 页...`
            : `正在检索插件 ${state.activePlugin}，第 ${requestedPage} 页...`;
        UI.showLoading(elements.results, state.activePlugin === 'all'
            ? `正在搜索推荐音乐插件，第 ${requestedPage} 页...`
            : `正在搜索 ${state.activePlugin}，第 ${requestedPage} 页...`);

        try {
            const query = new URLSearchParams({
                wd: keyword,
                plugin: state.activePlugin || 'all',
                page: String(requestedPage)
            });
            const payload = await fetchJson(`/api/music/search?${query.toString()}`);
            const pluginStatuses = Array.isArray(payload.plugins) ? payload.plugins : [];
            const okPlugins = pluginStatuses.filter(plugin => plugin.ok);
            const failedPlugins = pluginStatuses.filter(plugin => !plugin.ok);

            if (state.activePlugin !== 'all' && failedPlugins.length > 0 && okPlugins.length === 0) {
                const failedPlugin = failedPlugins[0];
                UI.showError(
                    elements.results,
                    failedPlugin?.error
                        ? `${state.activePlugin} 搜索失败：${failedPlugin.error}`
                        : `${state.activePlugin} 搜索失败`
                );
                elements.resultMeta.textContent = failedPlugin?.error
                    ? `${state.activePlugin} 暂时不可用：${failedPlugin.error}`
                    : `${state.activePlugin} 搜索失败，请稍后再试`;
                state.searchResults = [];
                state.isSearchPaginationLoading = false;
                updateSearchPagination(pluginStatuses, requestedPage);
                renderSearchPagination();
                return;
            }

            state.searchResults = payload.list || [];
            state.isSearchPaginationLoading = false;
            updateSearchPagination(pluginStatuses, requestedPage);
            renderResults(state.searchResults);
            renderSearchPagination();
            void hydrateSearchResultsMetadata();
            elements.resultMeta.textContent = state.activePlugin === 'all'
                ? `第 ${requestedPage} 页 · 已搜索 ${payload.plugins?.length || 0} 个推荐插件，成功 ${okPlugins.length} 个，本页找到 ${payload.total || 0} 首歌曲。`
                : `第 ${requestedPage} 页 · 插件 ${state.activePlugin} 搜索完成，本页找到 ${payload.total || 0} 首歌曲。`;
            if (options.scrollToResults) {
                scrollToResultsPanel({ force: true });
            }
        } catch (error) {
            state.isSearchPaginationLoading = false;
            updateSearchPagination([], requestedPage);
            renderSearchPagination();
            UI.showError(elements.results, error.message || '音乐搜索失败');
            elements.resultMeta.textContent = '搜索失败，请稍后再试';
        }
    }

    async function playTrack(track, quality, options = {}) {
        if (!track) {
            return false;
        }

        state.nearEndAdvanceTrackKey = '';

        if (Array.isArray(options.queue) && options.queue.length > 0) {
            state.queue = options.queue.map(item => ({ ...item }));
            state.currentQueueIndex = Number.isInteger(options.queueIndex)
                ? options.queueIndex
                : findQueueIndex(track, state.queue);
            renderQueue();
        } else if (state.queue.length > 0) {
            const queueIndex = findQueueIndex(track, state.queue);
            if (queueIndex >= 0) {
                state.currentQueueIndex = queueIndex;
                updateQueueActions();
            }
        }

        prunePrefetchedTrackMedia();

        elements.playerStatus.textContent = `正在请求 ${track.title} 的播放地址...`;
        updateCurrentShowcase(track, quality);
        beginTrackTransition(track);
        persistPlayerState({ force: true });

        try {
            const requestQuality = quality || track.defaultQuality;
            const prefetched = getPrefetchedTrackMedia(track, requestQuality);
            const resolved = prefetched || await requestTrackMedia(track, requestQuality);
            const mediaTrack = resolved.mediaTrack;
            const media = resolved.media || {};

            if (prefetched) {
                delete state.prefetchedTrackMedia[getTrackRequestKey(track, requestQuality)];
            }

            state.currentTrack = mediaTrack;
            state.currentQuality = media.quality || requestQuality || mediaTrack.defaultQuality;
            patchTrackCollections(mediaTrack, {
                renderResults: true,
                renderQueue: false
            });

            if (state.currentQueueIndex >= 0 && state.currentQueueIndex < state.queue.length) {
                state.queue[state.currentQueueIndex] = {
                    ...state.queue[state.currentQueueIndex],
                    ...mediaTrack
                };
                renderQueue();
            }

            renderPlayerQualityOptions(mediaTrack, state.currentQuality);

            updateCurrentShowcase(mediaTrack, state.currentQuality);
            elements.playerStatus.textContent = `正在播放 ${mediaTrack.title}`;
            elements.playerAudio.src = media.url || '';
            elements.playerAudio.load();
            void loadLyrics(mediaTrack);
            await elements.playerAudio.play();
            endTrackTransition();
            maybePrefetchNextTrack({ force: true });
            persistPlayerState({ force: true });
            return true;
        } catch (error) {
            endTrackTransition({ paused: true });
            elements.playerStatus.textContent = '播放失败';
            if (options.suppressFailureToast) {
                elements.playerStatus.textContent = `${track.title} 无法播放，正在尝试下一首`;
            } else {
                UI.showToast(error.message || '获取播放地址失败', 'error');
            }
            persistPlayerState({ force: true });
            return false;
        }
    }

    async function stepQueue(direction, options = {}) {
        if (!state.queue.length || state.currentQueueIndex < 0) {
            if (!options.silentBoundary) {
                UI.showToast('当前还没有可切换的播放队列', 'error');
            }
            return;
        }

        if (state.queueStepInFlight) {
            return;
        }

        const targetIndex = Number.isInteger(options.targetIndex)
            ? Number(options.targetIndex)
            : (direction < 0
                ? resolvePreviousQueueIndex()
                : resolveNextQueueIndex({ isAutoplay: Boolean(options.isAutoplay) }));

        if (targetIndex < 0 || targetIndex >= state.queue.length) {
            if (!options.silentBoundary) {
                UI.showToast(direction > 0 ? '已经是最后一首了' : '已经是第一首了', 'error');
            }
            return;
        }

        const targetTrack = state.queue[targetIndex];
        state.queueStepInFlight = true;

        try {
            const shouldAutoSkipOnFailure = Boolean(options.autoSkipOnFailure && direction > 0);
            const maxAttempts = shouldAutoSkipOnFailure
                ? Math.max(
                    1,
                    Number.isFinite(options.maxAttempts) ? Number(options.maxAttempts) : state.queue.length
                )
                : 1;

            let attempts = 0;
            let nextIndex = targetIndex;
            let played = false;
            const attemptedIndexes = new Set([state.currentQueueIndex]);

            while (attempts < maxAttempts && nextIndex >= 0 && nextIndex < state.queue.length) {
                const nextTrack = state.queue[nextIndex];
                attemptedIndexes.add(nextIndex);
                const success = await playTrack(nextTrack, nextTrack.defaultQuality, {
                    queue: state.queue,
                    queueIndex: nextIndex,
                    suppressFailureToast: shouldAutoSkipOnFailure
                });

                if (success) {
                    played = true;
                    break;
                }

                if (!shouldAutoSkipOnFailure) {
                    break;
                }

                attempts += 1;
                if (Boolean(options.isAutoplay) && state.playMode === PLAY_MODES.SHUFFLE) {
                    nextIndex = getRandomQueueIndex(Array.from(attemptedIndexes));
                    continue;
                }

                nextIndex += direction;
            }

            if (!played && shouldAutoSkipOnFailure) {
                markDesiredPlaybackState('paused');
                elements.playerStatus.textContent = '后续歌曲均无法播放，自动播放已停止';
                UI.showToast('后续歌曲均无法播放，已停止自动播放', 'error');
            }
        } finally {
            state.queueStepInFlight = false;
        }
    }

    function bindEvents() {
        elements.searchButton.addEventListener('click', () => {
            performSearch();
        });

        elements.searchInput.addEventListener('input', () => {
            updateSearchClearButton();
        });

        elements.searchInput.addEventListener('change', () => {
            updateSearchClearButton();
        });

        elements.searchInput.addEventListener('focus', () => {
            syncSearchClearButtonSoon();
        });

        elements.searchInput.addEventListener('animationstart', event => {
            if (event.animationName === 'search-autofill-sync') {
                syncSearchClearButtonSoon();
            }
        });

        elements.searchInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                performSearch();
            }
        });

        if (elements.searchClearButton) {
            elements.searchClearButton.addEventListener('click', async () => {
                elements.searchInput.value = '';
                resetSearchPagination({ clearKeyword: true });
                updateSearchClearButton();
                elements.searchInput.focus();

                if (state.activePlugin && state.activePlugin !== 'all') {
                    await loadPluginRecommendations(state.activePlugin);
                    return;
                }

                showBrowseHint();
            });
        }

        elements.playerQualitySelect.addEventListener('change', async () => {
            if (state.currentTrack) {
                await playTrack(state.currentTrack, elements.playerQualitySelect.value);
            }
        });

        elements.prevTrackButton.addEventListener('click', async () => {
            await stepQueue(-1);
        });

        if (elements.stopTrackButton) {
            elements.stopTrackButton.addEventListener('click', async () => {
                await toggleTransportPlayback();
            });
        }

        elements.nextTrackButton.addEventListener('click', async () => {
            await stepQueue(1);
        });

        if (elements.playModeButton) {
            elements.playModeButton.addEventListener('click', () => {
                cyclePlayMode();
            });
        }

        elements.clearQueueButton.addEventListener('click', () => {
            clearQueue();
        });

        if (elements.queueToggleButton) {
            elements.queueToggleButton.addEventListener('click', () => {
                toggleQueueDrawer();
            });
        }

        if (elements.queueCloseButton) {
            elements.queueCloseButton.addEventListener('click', () => {
                closeQueueDrawer({ restoreFocus: true });
            });
        }

        if (elements.queueOverlay) {
            elements.queueOverlay.addEventListener('click', event => {
                if (event.target !== elements.queueOverlay) {
                    return;
                }

                closeQueueDrawer({ restoreFocus: true });
            });
        }

        if (elements.lyricToggleButton) {
            elements.lyricToggleButton.addEventListener('click', () => {
                toggleLyricDialog();
            });

            elements.lyricToggleButton.addEventListener('keydown', event => {
                if (event.key !== 'Enter' && event.key !== ' ') {
                    return;
                }

                event.preventDefault();
                toggleLyricDialog();
            });
        }

        if (elements.lyricCloseButton) {
            elements.lyricCloseButton.addEventListener('click', () => {
                closeLyricDialog({ restoreFocus: true });
            });
        }

        if (elements.lyricOverlay) {
            elements.lyricOverlay.addEventListener('click', event => {
                if (event.target !== elements.lyricOverlay) {
                    return;
                }

                closeLyricDialog({ restoreFocus: true });
            });
        }

        document.addEventListener('keydown', event => {
            if (event.key === ' ' || event.code === 'Space') {
                const target = event.target;
                const isEditable = target instanceof HTMLElement && (
                    target.isContentEditable
                    || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)
                    || Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'))
                );

                if (!isEditable && !event.metaKey && !event.ctrlKey && !event.altKey) {
                    event.preventDefault();
                    void toggleTransportPlayback();
                    return;
                }
            }

            if (event.key !== 'Escape') {
                return;
            }

            if (elements.queueOverlay && !elements.queueOverlay.hidden) {
                closeQueueDrawer({ restoreFocus: true });
                return;
            }

            if (elements.lyricOverlay && !elements.lyricOverlay.hidden) {
                closeLyricDialog({ restoreFocus: true });
            }
        });

        document.addEventListener('visibilitychange', () => {
            maybeResumePlaybackAfterForeground();
        });

        window.addEventListener('pagehide', () => {
            persistPlayerState({ force: true });
        });

        window.addEventListener('beforeunload', () => {
            persistPlayerState({ force: true });
        });

        elements.playerAudio.addEventListener('play', () => {
            markDesiredPlaybackState('playing');
            updateTransportToggleButton();
            if (state.currentTrack) {
                elements.playerStatus.textContent = `正在播放 ${state.currentTrack.title}`;
                updateMediaSessionMetadata(state.currentTrack);
            }
        });

        elements.playerAudio.addEventListener('playing', () => {
            endTrackTransition();
            updateMediaSessionPlaybackState();
            updateTransportToggleButton();
        });

        elements.playerAudio.addEventListener('timeupdate', () => {
            syncLyricByCurrentTime();
            maybePrefetchNextTrack();
            void maybeAdvanceBeforeTrackEnds();
            syncMediaSessionPositionState();
            persistPlayerState();
        });

        elements.playerAudio.addEventListener('loadedmetadata', () => {
            syncLyricByCurrentTime();
            syncRealDurationFromPlayer();
            syncMediaSessionPositionState({ force: true });
            persistPlayerState({ force: true });
        });

        elements.playerAudio.addEventListener('pause', () => {
            if (state.isTrackTransitioning && state.desiredPlaybackState === 'playing') {
                updateMediaSessionPlaybackState();
                updateTransportToggleButton();
                return;
            }

            if (
                state.desiredPlaybackState === 'playing'
                && !elements.playerAudio.ended
                && (
                    document.visibilityState !== 'visible'
                    || Date.now() < state.visibilityResumeGuardUntil
                )
            ) {
                updateMediaSessionPlaybackState();
                updateTransportToggleButton();
                return;
            }

            const autoplayTarget = resolveAutoplayTarget();

            if (
                state.desiredPlaybackState === 'playing'
                && !elements.playerAudio.ended
                && !state.queueStepInFlight
                && state.currentTrack
                && autoplayTarget.nextIndex >= 0
                && isNearTrackCompletion()
            ) {
                const { nextIndex, nextTrack } = autoplayTarget;
                if (nextIndex < 0 || !nextTrack) {
                    return;
                }
                beginTrackTransition(nextTrack);
                persistPlayerState({ force: true });
                void stepQueue(1, {
                    silentBoundary: true,
                    autoSkipOnFailure: true,
                    isAutoplay: true,
                    targetIndex: nextIndex
                });
                return;
            }

            if (!elements.playerAudio.ended) {
                markDesiredPlaybackState('paused');
            }
            updateTransportToggleButton();
            if (state.currentTrack && !elements.playerAudio.ended) {
                elements.playerStatus.textContent = `已暂停 ${state.currentTrack.title}`;
            }
        });

        elements.playerAudio.addEventListener('ended', () => {
            if (state.isTrackTransitioning || state.queueStepInFlight) {
                return;
            }

            const { nextIndex, nextTrack } = resolveAutoplayTarget();
            if (state.currentTrack && nextIndex >= 0 && nextTrack) {
                beginTrackTransition(nextTrack);
                persistPlayerState({ force: true });
                void stepQueue(1, {
                    silentBoundary: true,
                    autoSkipOnFailure: true,
                    isAutoplay: true,
                    targetIndex: nextIndex
                });
                return;
            }

            markDesiredPlaybackState('paused');
            updateTransportToggleButton();
            if (state.currentTrack) {
                elements.playerStatus.textContent = `${state.currentTrack.title} 播放完成`;
            }
        });

        elements.playerAudio.addEventListener('error', () => {
            updateMediaSessionPlaybackState();
            persistPlayerState({ force: true });
            updateTransportToggleButton();
            elements.playerStatus.textContent = '播放器遇到错误';
            UI.showToast('音频加载失败，可能是远程音源已失效', 'error');
        });
    }

    async function init() {
        ThemeManager.init();
        installMediaSessionHandlers();
        bindEvents();
        updateSearchClearButton();
        syncSearchClearButtonSoon();
        updateLyricDialogState();
        updateQueueDrawerState();
        updatePlayModeButton();
        showBrowseHint();
        UI.showEmpty(elements.lyricBody, '等待播放', '开始播放一首歌之后，这里会自动显示并同步歌词。');
        UI.showEmpty(elements.queueList, '队列为空', '搜索结果中点击“立即播放”后，这里会保留当前队列。');
        updateQueueActions();
        restorePlayerFromStorage();

        try {
            await loadPlugins();
            if (state.activePlugin && state.activePlugin !== 'all') {
                await loadPluginRecommendations(state.activePlugin);
            }
        } catch (error) {
            setPluginStatus(error.message || '无法读取插件目录');
            UI.showError(elements.results, error.message || '音乐插件加载失败');
        }
    }

    init();
}());
