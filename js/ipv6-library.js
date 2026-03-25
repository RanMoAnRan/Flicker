(function() {
    const state = {
        sources: [],
        activeSourceKey: '',
        groups: [],
        activeGroupKey: 'all',
        channels: []
    };

    const elements = {
        heroMeta: document.getElementById('iptvHeroMeta'),
        sourceMeta: document.getElementById('iptvSourceMeta'),
        sourceTabs: document.getElementById('iptvSourceTabs'),
        groupTabs: document.getElementById('iptvGroupTabs'),
        channelTitle: document.getElementById('iptvChannelTitle'),
        channelMeta: document.getElementById('iptvChannelMeta'),
        channelGrid: document.getElementById('iptvChannelGrid')
    };

    function setTextContent(element, value) {
        if (element) {
            element.textContent = value;
        }
    }

    function getSourceBadgeText(source) {
        if (!source?.ok) {
            return source?.error || '不可用';
        }

        const playableCount = Number(source.channelCount || 0);
        const totalCount = Number(source.totalChannelCount || playableCount);
        const countLabel = totalCount > playableCount
            ? `可播 ${playableCount} / 全部 ${totalCount}`
            : `${playableCount} 频道`;

        return `${countLabel}${source.requiresIpv6 ? ' · IPv6' : ''}`;
    }

    async function fetchJson(url) {
        const response = await fetch(url);
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload?.error || '请求失败');
        }

        return payload;
    }

    function getActiveSource() {
        return state.sources.find(source => source.key === state.activeSourceKey) || null;
    }

    function getFilteredChannels() {
        if (state.activeGroupKey === 'all') {
            return state.channels;
        }

        return state.channels.filter(channel => channel.groupKey === state.activeGroupKey);
    }

    function getIptvPlayerUrl(channel) {
        const url = new URL('player.html', window.location.href);
        url.searchParams.set('mode', 'iptv');
        url.searchParams.set('name', channel.name || '未命名频道');
        url.searchParams.set('group', channel.groupTitle || '未分组');
        url.searchParams.set('source_name', channel.sourceName || 'IPTV 源');
        url.searchParams.set('play_url', channel.streamUrl || '');
        if (channel.logo) {
            url.searchParams.set('logo', channel.logo);
        }
        return url.toString();
    }

    function renderSourceTabs() {
        if (!elements.sourceTabs) {
            return;
        }

        if (!Array.isArray(state.sources) || state.sources.length === 0) {
            UI.showEmpty(elements.sourceTabs, '当前没有可用 IPTV 源', '请稍后再试，或检查服务端是否能访问远程 m3u。');
            return;
        }

        elements.sourceTabs.innerHTML = state.sources.map(source => `
            <button
                type="button"
                class="iptv-source-tab ${source.key === state.activeSourceKey ? 'active' : ''}"
                data-iptv-source="${escapeHtml(source.key)}"
                ${source.ok ? '' : 'disabled'}
            >
                <span>${escapeHtml(source.name)}</span>
                <em>${escapeHtml(getSourceBadgeText(source))}</em>
            </button>
        `).join('');

        elements.sourceTabs.querySelectorAll('[data-iptv-source]').forEach(button => {
            button.addEventListener('click', async () => {
                const sourceKey = button.dataset.iptvSource || '';
                if (!sourceKey || sourceKey === state.activeSourceKey) {
                    return;
                }

                await loadChannels(sourceKey);
            });
        });
    }

    function renderGroupTabs() {
        if (!elements.groupTabs) {
            return;
        }

        const groups = [
            { key: 'all', title: '全部频道', count: state.channels.length },
            ...state.groups
        ];

        elements.groupTabs.innerHTML = groups.map(group => `
            <button
                type="button"
                class="iptv-group-tab ${group.key === state.activeGroupKey ? 'active' : ''}"
                data-iptv-group="${escapeHtml(group.key)}"
            >
                <span>${escapeHtml(group.title)}</span>
                <em>${escapeHtml(String(group.count || 0))}</em>
            </button>
        `).join('');

        elements.groupTabs.querySelectorAll('[data-iptv-group]').forEach(button => {
            button.addEventListener('click', () => {
                const groupKey = button.dataset.iptvGroup || 'all';
                if (groupKey === state.activeGroupKey) {
                    return;
                }

                state.activeGroupKey = groupKey;
                renderGroupTabs();
                renderChannels();
            });
        });
    }

    function renderChannels() {
        const activeSource = getActiveSource();
        const visibleChannels = getFilteredChannels();
        const totalChannelCount = Number(activeSource?.totalChannelCount || state.channels.length || 0);
        const currentHint = activeSource?.requiresIpv6 ? ' · 需 IPv6 网络' : '';

        setTextContent(elements.channelTitle, activeSource ? `${activeSource.name} 频道列表` : '等待选择频道源');
        setTextContent(elements.channelMeta, activeSource
            ? `${state.groups.length} 个分组 · 当前展示 ${visibleChannels.length} 个频道${totalChannelCount > state.channels.length ? ` · 已过滤 ${totalChannelCount - state.channels.length} 个不可用或非直播放链接` : ''}${currentHint}`
            : '加载完成后可点击任意频道进入播放。');

        if (!Array.isArray(visibleChannels) || visibleChannels.length === 0) {
            UI.showEmpty(elements.channelGrid, '当前分组没有频道', '可以切换到其他直播分组继续浏览。');
            return;
        }

        elements.channelGrid.innerHTML = visibleChannels.map(channel => `
            <button
                type="button"
                class="iptv-channel-card ${channel.playable === false ? 'disabled' : ''}"
                data-iptv-channel-id="${escapeHtml(channel.id)}"
                ${channel.playable === false ? 'disabled' : ''}
            >
                <span class="iptv-channel-group">${escapeHtml(channel.groupTitle || '未分组')}</span>
                <strong>${escapeHtml(channel.name || '未命名频道')}</strong>
                <em>${escapeHtml(channel.playbackType === 'hls' ? `${channel.sourceName || 'IPTV 源'} · HLS` : (channel.sourceName || 'IPTV 源'))}</em>
            </button>
        `).join('');

        elements.channelGrid.querySelectorAll('[data-iptv-channel-id]').forEach(button => {
            button.addEventListener('click', () => {
                const channel = visibleChannels.find(item => item.id === button.dataset.iptvChannelId);
                if (!channel) {
                    return;
                }

                window.location.href = getIptvPlayerUrl(channel);
            });
        });
    }

    async function loadSources() {
        setTextContent(elements.heroMeta, '正在拉取 IPTV 源信息...');
        setTextContent(elements.sourceMeta, '正在同步频道分组...');
        if (elements.sourceTabs) {
            UI.showLoading(elements.sourceTabs, '正在读取直播源...');
        }
        if (elements.groupTabs) {
            elements.groupTabs.innerHTML = '';
        }
        UI.showLoading(elements.channelGrid, '正在同步 IPTV 源目录...');

        try {
            const payload = await fetchJson('/api/iptv/sources');
            state.sources = Array.isArray(payload.sources) ? payload.sources : [];
            state.activeSourceKey = state.sources.find(source => source.ok)?.key || state.sources[0]?.key || '';

            renderSourceTabs();

            if (!state.activeSourceKey) {
                setTextContent(elements.heroMeta, '当前没有可用 IPTV 源');
                setTextContent(elements.sourceMeta, '请稍后再试');
                if (elements.groupTabs) {
                    elements.groupTabs.innerHTML = '';
                }
                UI.showEmpty(elements.channelGrid, '暂无 IPTV 源', '当前内置源暂时不可用。');
                return;
            }

            setTextContent(elements.heroMeta, `已识别 ${state.sources.length} 个 IPTV 源`);
            await loadChannels(state.activeSourceKey);
        } catch (error) {
            console.error('加载 IPTV 源失败:', error);
            setTextContent(elements.heroMeta, error.message || 'IPTV 源加载失败');
            setTextContent(elements.sourceMeta, '请检查网络连接后重试');
            UI.showError(elements.channelGrid, error.message || 'IPTV 源加载失败');
        }
    }

    async function loadChannels(sourceKey) {
        state.activeSourceKey = sourceKey;
        state.activeGroupKey = 'all';
        if (elements.sourceTabs) {
            UI.showLoading(elements.sourceTabs, '正在读取直播源...');
        }
        setTextContent(elements.sourceMeta, '正在同步频道分组...');
        if (elements.groupTabs) {
            elements.groupTabs.innerHTML = '';
        }
        UI.showLoading(elements.channelGrid, '正在载入频道列表...');

        try {
            const payload = await fetchJson(`/api/iptv/channels?source=${encodeURIComponent(sourceKey)}`);
            state.groups = Array.isArray(payload.groups) ? payload.groups : [];
            state.channels = Array.isArray(payload.channels) ? payload.channels : [];
            state.activeGroupKey = 'all';

            const activeSource = getActiveSource();
            const staleLabel = payload.cache?.stale ? ' · 使用缓存数据' : '';
            const totalChannelCount = Number(payload.summary?.totalChannelCount || state.channels.length || 0);
            const filteredChannelCount = Number(payload.summary?.filteredChannelCount || 0);
            const ipv6Hint = (activeSource?.requiresIpv6 || payload.source?.requiresIpv6) ? ' · 需 IPv6 网络' : '';
            const filterHint = filteredChannelCount > 0 ? ` · 已保留 ${state.channels.length} 个可播频道` : '';
            setTextContent(elements.sourceMeta, `${activeSource?.name || payload.source?.name || 'IPTV 源'} · ${state.groups.length} 个分组 · 原始 ${totalChannelCount} 个频道${filterHint}${ipv6Hint}${staleLabel}`);

            renderSourceTabs();
            renderGroupTabs();
            renderChannels();
        } catch (error) {
            console.error('加载 IPTV 频道失败:', error);
            setTextContent(elements.sourceMeta, error.message || '频道列表加载失败');
            state.groups = [];
            state.channels = [];
            elements.groupTabs.innerHTML = '';
            UI.showError(elements.channelGrid, error.message || '频道列表加载失败');
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        loadSources();
    });
})();
