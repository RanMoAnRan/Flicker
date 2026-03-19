(function initMusicLibraryPage() {
    const QUEUE_DRAWER_ANIMATION_MS = 240;
    const LYRIC_DIALOG_ANIMATION_MS = 240;
    const RECOMMENDED_PLUGIN_PRIORITY = ['网易', '小秋音乐', '小芸音乐', 'qq', 'w音乐'];
    const PLAYER_STORAGE_KEY = 'fuguang_music_player_state';
    const PLAYER_STATE_VERSION = 1;
    const PLAYER_STATE_MAX_AGE_MS = 1000 * 60 * 60 * 24;
    const PLAYER_STATE_PERSIST_INTERVAL_MS = 1500;
    const MEDIA_POSITION_SYNC_INTERVAL_MS = 1000;
    const NEXT_TRACK_PREFETCH_THRESHOLD_SECONDS = 20;

    const state = {
        plugins: [],
        enabledPlugins: [],
        pluginTab: 'recommended',
        activePlugin: 'all',
        currentKeyword: '',
        searchResults: [],
        resultsHydrationToken: 0,
        queue: [],
        currentQueueIndex: -1,
        currentTrack: null,
        currentQuality: '',
        currentLyrics: [],
        activeLyricIndex: -1,
        desiredPlaybackState: 'paused',
        queueStepInFlight: false,
        lastPlayerStatePersistAt: 0,
        lastMediaPositionSyncAt: 0,
        prefetchedTrackMedia: null,
        prefetchingTrackKey: ''
    };

    const elements = {
        searchInput: document.getElementById('musicSearchInput'),
        searchClearButton: document.getElementById('musicSearchClearButton'),
        searchButton: document.getElementById('musicSearchButton'),
        pluginStatus: document.getElementById('musicPluginStatus'),
        pluginChips: document.getElementById('musicPluginChips'),
        resultTitle: document.getElementById('musicResultTitle'),
        resultMeta: document.getElementById('musicResultMeta'),
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
        nextTrackButton: document.getElementById('nextTrackButton'),
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

    function updateMediaSessionPlaybackState() {
        if (!('mediaSession' in navigator)) {
            return;
        }

        try {
            navigator.mediaSession.playbackState = (!elements.playerAudio.paused && !elements.playerAudio.ended)
                ? 'playing'
                : 'paused';
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

        if (state.desiredPlaybackState !== 'playing') {
            return;
        }

        if (!state.currentTrack || !getPlayerSourceUrl() || !elements.playerAudio.paused || elements.playerAudio.ended) {
            return;
        }

        void resumeAudioPlayback();
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

    function getQueueTrack(index) {
        if (index < 0 || index >= state.queue.length) {
            return null;
        }

        return state.queue[index] || null;
    }

    function getNextQueueTrack() {
        return getQueueTrack(state.currentQueueIndex + 1);
    }

    function canUsePrefetchedTrack(track, quality) {
        if (!state.prefetchedTrackMedia || !track) {
            return false;
        }

        return state.prefetchedTrackMedia.requestKey === getTrackRequestKey(track, quality)
            && Boolean(state.prefetchedTrackMedia.media?.url);
    }

    async function prefetchTrackMedia(track, quality) {
        if (!track) {
            return;
        }

        const requestKey = getTrackRequestKey(track, quality);
        if (state.prefetchingTrackKey === requestKey || canUsePrefetchedTrack(track, quality)) {
            return;
        }

        state.prefetchingTrackKey = requestKey;

        try {
            const resolved = await requestTrackMedia(track, quality);
            if (!resolved.media?.url) {
                return;
            }

            state.prefetchedTrackMedia = {
                requestKey,
                trackKey: getTrackKey(track),
                quality: quality || track.defaultQuality,
                mediaTrack: resolved.mediaTrack,
                media: resolved.media
            };
        } catch (error) {
            // 预取失败不影响当前播放，等真正切歌时再正常请求。
        } finally {
            if (state.prefetchingTrackKey === requestKey) {
                state.prefetchingTrackKey = '';
            }
        }
    }

    function maybePrefetchNextTrack(options = {}) {
        const nextTrack = getNextQueueTrack();
        if (!nextTrack) {
            return;
        }

        if (options.force) {
            void prefetchTrackMedia(nextTrack, nextTrack.defaultQuality);
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

        void prefetchTrackMedia(nextTrack, nextTrack.defaultQuality);
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

        if (track.album) {
            tags.push(UI.renderBadge(track.album, 'default'));
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

    function updateQueueActions() {
        const hasQueue = state.queue.length > 0 && state.currentQueueIndex >= 0;
        const canPrev = hasQueue && state.currentQueueIndex > 0;
        const canNext = hasQueue && state.currentQueueIndex < state.queue.length - 1;

        elements.prevTrackButton.disabled = !canPrev;
        elements.nextTrackButton.disabled = !canNext;
        elements.clearQueueButton.disabled = state.queue.length === 0;
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
        elements.playerAudio.setAttribute('title', track.title || '浮光音乐库');
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

    function renderPluginChips() {
        const recommendedPlugins = state.enabledPlugins;
        const extraSearchablePlugins = state.plugins.filter(plugin => plugin.searchable && !plugin.recommended);
        const unsupportedPlugins = state.plugins.filter(plugin => !plugin.searchable);

        if (state.plugins.length === 0) {
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
                content: extraSearchablePlugins.map(plugin => renderChip(plugin)).join(''),
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
        const activeTabIndex = Math.max(0, tabs.findIndex(tab => tab.key === activeTab.key));

        elements.pluginChips.innerHTML = `
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

        elements.pluginChips.querySelectorAll('[data-plugin-tab]').forEach(button => {
            button.addEventListener('click', () => {
                const nextTab = button.dataset.pluginTab || 'recommended';
                if (nextTab === state.pluginTab) {
                    return;
                }
                state.pluginTab = nextTab;
                renderPluginChips();
            });
        });

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

    async function loadPlugins() {
        const payload = await fetchJson('/api/music/plugins');
        state.plugins = payload.plugins || [];
        state.enabledPlugins = sortPluginsByPriority(
            state.plugins.filter(plugin => plugin.recommended && plugin.searchable)
        );
        state.activePlugin = state.enabledPlugins[0]?.name || state.plugins.find(plugin => plugin.searchable)?.name || 'all';
        syncPluginTabByActivePlugin();
        elements.pluginStatus.textContent = state.activePlugin && state.activePlugin !== 'all'
            ? `默认选中 ${state.activePlugin}`
            : (state.enabledPlugins.length > 0
                ? `默认聚合 ${state.enabledPlugins.length} 个推荐音乐插件`
                : '当前没有推荐音乐插件');

        renderPluginChips();
    }

    async function loadPluginRecommendations(pluginName) {
        if (!pluginName || pluginName === 'all') {
            return;
        }

        const plugin = state.plugins.find(item => item.name === pluginName);
        if (!plugin || !plugin.searchable) {
            return;
        }

        state.currentKeyword = '';
        elements.resultTitle.textContent = `${pluginName} 推荐音乐`;
        elements.resultMeta.textContent = `正在加载 ${pluginName} 的推荐歌曲...`;
        UI.showLoading(elements.results, `正在载入 ${pluginName} 的推荐歌曲...`);

        try {
            const query = new URLSearchParams({
                plugin: pluginName
            });
            const payload = await fetchJson(`/api/music/recommend?${query.toString()}`);
            state.searchResults = payload.list || [];
            renderResults(state.searchResults);
            void hydrateSearchResultsMetadata();

            const sourceTitle = payload.source?.title || '推荐榜单';
            const sourceGroup = payload.source?.groupTitle || pluginName;
            elements.resultTitle.textContent = `${pluginName} 推荐音乐`;
            elements.resultMeta.textContent = `${sourceGroup} · ${sourceTitle}，共 ${payload.total || state.searchResults.length} 首歌曲。`;
        } catch (error) {
            elements.resultMeta.textContent = `${pluginName} 推荐加载失败`;
            UI.showError(elements.results, error.message || '推荐歌曲加载失败');
        }
    }

    async function performSearch() {
        const keyword = elements.searchInput.value.trim();
        if (!keyword) {
            UI.showToast('先输入一个歌曲关键词吧', 'error');
            elements.searchInput.focus();
            return;
        }

        state.currentKeyword = keyword;
        elements.resultTitle.textContent = `搜索：${keyword}`;
        const activePlugin = state.activePlugin === 'all'
            ? null
            : state.plugins.find(plugin => plugin.name === state.activePlugin);

        if (activePlugin && !activePlugin.searchable) {
            UI.showToast(`当前选择的 ${activePlugin.kindLabel} 插件不参与歌曲搜索`, 'error');
            return;
        }

        elements.resultMeta.textContent = state.activePlugin === 'all'
            ? '正在检索推荐音乐插件...'
            : `正在检索插件 ${state.activePlugin} ...`;
        UI.showLoading(elements.results, state.activePlugin === 'all'
            ? '正在搜索推荐音乐插件...'
            : `正在搜索 ${state.activePlugin} ...`);

        try {
            const query = new URLSearchParams({
                wd: keyword,
                plugin: state.activePlugin || 'all',
                page: '1'
            });
            const payload = await fetchJson(`/api/music/search?${query.toString()}`);
            state.searchResults = payload.list || [];
            renderResults(state.searchResults);
            void hydrateSearchResultsMetadata();

            const okPlugins = (payload.plugins || []).filter(plugin => plugin.ok);
            elements.resultMeta.textContent = state.activePlugin === 'all'
                ? `已搜索 ${payload.plugins?.length || 0} 个推荐插件，成功 ${okPlugins.length} 个，共找到 ${payload.total || 0} 首歌曲。`
                : `插件 ${state.activePlugin} 搜索完成，共找到 ${payload.total || 0} 首歌曲。`;
        } catch (error) {
            UI.showError(elements.results, error.message || '音乐搜索失败');
            elements.resultMeta.textContent = '搜索失败，请稍后再试';
        }
    }

    async function playTrack(track, quality, options = {}) {
        if (!track) {
            return false;
        }

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

        elements.playerStatus.textContent = `正在请求 ${track.title} 的播放地址...`;
        updateCurrentShowcase(track, quality);
        state.desiredPlaybackState = 'playing';
        persistPlayerState({ force: true });

        try {
            const requestQuality = quality || track.defaultQuality;
            const resolved = canUsePrefetchedTrack(track, requestQuality)
                ? state.prefetchedTrackMedia
                : await requestTrackMedia(track, requestQuality);
            const mediaTrack = resolved.mediaTrack;
            const media = resolved.media || {};

            if (canUsePrefetchedTrack(track, requestQuality)) {
                state.prefetchedTrackMedia = null;
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
            maybePrefetchNextTrack({ force: true });
            persistPlayerState({ force: true });
            return true;
        } catch (error) {
            elements.playerStatus.textContent = '播放失败';
            UI.showToast(error.message || '获取播放地址失败', 'error');
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

        const targetIndex = state.currentQueueIndex + direction;
        if (targetIndex < 0 || targetIndex >= state.queue.length) {
            if (!options.silentBoundary) {
                UI.showToast(direction > 0 ? '已经是最后一首了' : '已经是第一首了', 'error');
            }
            return;
        }

        const targetTrack = state.queue[targetIndex];
        state.queueStepInFlight = true;

        try {
            await playTrack(targetTrack, targetTrack.defaultQuality, {
                queue: state.queue,
                queueIndex: targetIndex
            });
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
            elements.searchClearButton.addEventListener('click', () => {
                elements.searchInput.value = '';
                state.currentKeyword = '';
                updateSearchClearButton();
                elements.searchInput.focus();
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

        elements.nextTrackButton.addEventListener('click', async () => {
            await stepQueue(1);
        });

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
            if (state.currentTrack) {
                elements.playerStatus.textContent = `正在播放 ${state.currentTrack.title}`;
                updateMediaSessionMetadata(state.currentTrack);
            }
        });

        elements.playerAudio.addEventListener('timeupdate', () => {
            syncLyricByCurrentTime();
            maybePrefetchNextTrack();
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
            if (!elements.playerAudio.ended) {
                markDesiredPlaybackState('paused');
            }
            if (state.currentTrack && !elements.playerAudio.ended) {
                elements.playerStatus.textContent = `已暂停 ${state.currentTrack.title}`;
            }
        });

        elements.playerAudio.addEventListener('ended', () => {
            if (state.currentTrack && state.currentQueueIndex >= 0 && state.currentQueueIndex < state.queue.length - 1) {
                state.desiredPlaybackState = 'playing';
                persistPlayerState({ force: true });
                void stepQueue(1, { silentBoundary: true });
                return;
            }

            markDesiredPlaybackState('paused');
            if (state.currentTrack) {
                elements.playerStatus.textContent = `${state.currentTrack.title} 播放完成`;
            }
        });

        elements.playerAudio.addEventListener('error', () => {
            updateMediaSessionPlaybackState();
            persistPlayerState({ force: true });
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
        UI.showEmpty(elements.results, '等待搜索', '输入歌名、歌手或专辑后，这里会展示可播放结果。');
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
            elements.pluginStatus.textContent = error.message || '无法读取插件目录';
            UI.showError(elements.results, error.message || '音乐插件加载失败');
        }
    }

    init();
}());
