const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { execFile, execFileSync, spawn } = require('child_process');
const { createMusicPluginService } = require('./music-plugin-service');
const { createIptvService } = require('./iptv-service');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;

const MIME_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const DOWNLOAD_MIME_TYPES = {
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.wma': 'audio/x-ms-wma'
};

function getSystemProxyUrl() {
    const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
    if (envProxy) {
        return envProxy;
    }

    try {
        const output = execFileSync('scutil', ['--proxy'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        });

        const httpEnabled = /HTTPEnable\s*:\s*1/.test(output);
        const httpsEnabled = /HTTPSEnable\s*:\s*1/.test(output);
        const httpProxy = output.match(/HTTPProxy\s*:\s*(.+)/)?.[1]?.trim();
        const httpPort = output.match(/HTTPPort\s*:\s*(\d+)/)?.[1]?.trim();
        const httpsProxy = output.match(/HTTPSProxy\s*:\s*(.+)/)?.[1]?.trim();
        const httpsPort = output.match(/HTTPSPort\s*:\s*(\d+)/)?.[1]?.trim();

        if (httpsEnabled && httpsProxy && httpsPort) {
            return `http://${httpsProxy}:${httpsPort}`;
        }

        if (httpEnabled && httpProxy && httpPort) {
            return `http://${httpProxy}:${httpPort}`;
        }
    } catch (error) {
        return '';
    }

    return '';
}

const SYSTEM_PROXY_URL = getSystemProxyUrl();
const musicPluginService = createMusicPluginService({
    rootDir: ROOT_DIR,
    systemProxyUrl: SYSTEM_PROXY_URL
});
const iptvService = createIptvService({
    fetchText: async (targetUrl) => {
        const parsedTargetUrl = new URL(targetUrl);
        const response = await requestViaCurl(parsedTargetUrl, {
            accept: 'Accept: application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*'
        });

        if (response.statusCode < 200 || response.statusCode >= 300) {
            const error = new Error(`上游 IPTV 源响应异常 (${response.statusCode})`);
            error.statusCode = 502;
            error.code = 'IPTV_UPSTREAM_BAD_STATUS';
            error.upstream = parsedTargetUrl.toString();
            throw error;
        }

        return response.body;
    },
    probeStream: async (targetUrl) => {
        const parsedTargetUrl = new URL(targetUrl);
        return requestPreviewViaCurl(parsedTargetUrl, {
            accept: 'Accept: application/vnd.apple.mpegurl, application/x-mpegURL, video/*, audio/*, */*',
            maxTimeSeconds: 8,
            range: '0-1023'
        });
    }
});

process.on('unhandledRejection', reason => {
    console.error('[server] 捕获到未处理的 Promise 拒绝:', reason);
});

process.on('uncaughtException', error => {
    console.error('[server] 捕获到未处理异常，服务将继续运行:', error);
});

function buildCurlArgs(targetUrl, options = {}) {
    const curlArgs = [
        '-L',
        '-sS',
        '--globoff',
        '--max-time', Number.isFinite(options.maxTimeSeconds) ? String(options.maxTimeSeconds) : '20',
        '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '-H', options.accept || 'Accept: application/json, text/plain, */*',
        '-H', 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
        '-H', 'Cache-Control: no-cache',
        '-H', `Referer: ${targetUrl.protocol}//${targetUrl.host}`,
        targetUrl.toString()
    ];

    if (SYSTEM_PROXY_URL) {
        curlArgs.unshift(SYSTEM_PROXY_URL);
        curlArgs.unshift('--proxy');
    }

    return curlArgs;
}

function requestViaCurl(targetUrl, options = {}) {
    const baseArgs = buildCurlArgs(targetUrl, options);
    const curlArgs = [
        ...baseArgs.slice(0, -1),
        '-w', '\n__FG_STATUS__:%{http_code}\n__FG_CONTENT_TYPE__:%{content_type}\n',
        baseArgs[baseArgs.length - 1]
    ];

    return new Promise((resolve, reject) => {
        execFile('curl', curlArgs, {
            encoding: 'utf8',
            maxBuffer: 8 * 1024 * 1024
        }, (error, stdout, stderr) => {
            if (error) {
                error.stderr = stderr;
                reject(error);
                return;
            }

            const statusMatch = stdout.match(/\n__FG_STATUS__:(\d{3})\n__FG_CONTENT_TYPE__:(.*)\n?$/s);
            if (!statusMatch) {
                reject(new Error('无法解析 curl 返回结果'));
                return;
            }

            const body = stdout.slice(0, statusMatch.index);
            const statusCode = Number(statusMatch[1]);
            const contentType = String(statusMatch[2] || '').trim();

            resolve({
                statusCode,
                contentType,
                body
            });
        });
    });
}

function requestPreviewViaCurl(targetUrl, options = {}) {
    const baseArgs = buildCurlArgs(targetUrl, options);
    const curlArgs = [
        ...baseArgs.slice(0, -1),
        '-r', options.range || '0-1023',
        '-w', '\n__FG_STATUS__:%{http_code}\n__FG_CONTENT_TYPE__:%{content_type}\n',
        baseArgs[baseArgs.length - 1]
    ];

    return new Promise((resolve) => {
        execFile('curl', curlArgs, {
            encoding: 'utf8',
            maxBuffer: 512 * 1024
        }, (error, stdout) => {
            if (error) {
                resolve({
                    ok: false,
                    statusCode: 0,
                    contentType: '',
                    preview: ''
                });
                return;
            }

            const statusMatch = stdout.match(/\n__FG_STATUS__:(\d{3})\n__FG_CONTENT_TYPE__:(.*)\n?$/s);
            if (!statusMatch) {
                resolve({
                    ok: false,
                    statusCode: 0,
                    contentType: '',
                    preview: ''
                });
                return;
            }

            const body = stdout.slice(0, statusMatch.index);
            const statusCode = Number(statusMatch[1]);
            const contentType = String(statusMatch[2] || '').trim();

            resolve({
                ok: statusCode >= 200 && statusCode < 300,
                statusCode,
                contentType,
                preview: body.slice(0, 1024)
            });
        });
    });
}

function setNoCacheHeaders(res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
}

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(data));
}

function sanitizeDownloadName(value) {
    return String(value || '')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function inferDownloadExtension(rawUrl) {
    try {
        const parsed = new URL(String(rawUrl || ''));
        const ext = path.extname(parsed.pathname || '').toLowerCase();
        if (ext && /^[.a-z0-9]{2,8}$/i.test(ext)) {
            return ext;
        }
    } catch (error) {
        return '.mp3';
    }

    return '.mp3';
}

function buildAttachmentFilename(track = {}, mediaUrl = '') {
    const extension = inferDownloadExtension(mediaUrl);
    const title = sanitizeDownloadName(track.title) || '未命名歌曲';
    const artist = sanitizeDownloadName(track.artist) || sanitizeDownloadName(track.plugin) || '未知歌手';
    return `${title} - ${artist}${extension}`;
}

function buildContentDisposition(filename) {
    const safeFilename = String(filename || 'track.mp3');
    const fallback = safeFilename
        .replace(/[^\x20-\x7e]/g, '_')
        .replace(/["\\]/g, '_');
    return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`;
}

async function handleMusicDownload(req, res) {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    const plugin = requestUrl.searchParams.get('plugin') || '';
    const id = requestUrl.searchParams.get('id') || '';
    const quality = requestUrl.searchParams.get('quality') || '';

    if (!plugin || !id) {
        sendJson(res, 400, { error: '缺少下载参数' });
        return;
    }

    try {
        const payload = await musicPluginService.getMedia({ plugin, id, quality });
        const mediaUrl = String(payload?.media?.url || '').trim();
        if (!mediaUrl) {
            sendJson(res, 404, { error: '当前歌曲没有可下载的音频地址' });
            return;
        }

        const parsedMediaUrl = new URL(mediaUrl);
        const extension = inferDownloadExtension(mediaUrl);
        const contentType = DOWNLOAD_MIME_TYPES[extension] || 'application/octet-stream';
        const filename = buildAttachmentFilename(payload?.track || {}, mediaUrl);
        const child = spawn('curl', buildCurlArgs(parsedMediaUrl, {
            accept: 'Accept: */*',
            maxTimeSeconds: 0
        }), {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let responseStarted = false;
        let stderr = '';

        const cleanup = () => {
            if (!child.killed) {
                child.kill('SIGTERM');
            }
        };

        res.on('close', cleanup);

        child.on('error', error => {
            res.off('close', cleanup);
            if (responseStarted) {
                res.destroy(error);
                return;
            }

            sendJson(res, 502, {
                error: '下载进程启动失败',
                details: error.message
            });
        });

        child.stderr.on('data', chunk => {
            stderr += chunk.toString('utf8');
        });

        child.stdout.on('data', chunk => {
            if (!responseStarted) {
                responseStarted = true;
                setNoCacheHeaders(res);
                res.writeHead(200, {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': contentType,
                    'Content-Disposition': buildContentDisposition(filename)
                });
            }

            res.write(chunk);
        });

        child.stdout.on('end', () => {
            if (responseStarted && !res.writableEnded) {
                res.end();
            }
        });

        child.on('close', code => {
            res.off('close', cleanup);
            if (code !== 0) {
                const details = stderr.trim() || '上游音频下载失败';
                console.error('[server] 音乐下载失败:', details);
                if (!responseStarted) {
                    sendJson(res, 502, {
                        error: '下载歌曲失败',
                        details
                    });
                    return;
                }

                res.destroy(new Error(details));
                return;
            }

            if (!responseStarted) {
                setNoCacheHeaders(res);
                res.writeHead(200, {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': contentType,
                    'Content-Disposition': buildContentDisposition(filename)
                });
                res.end();
            }
        });
    } catch (error) {
        sendJson(res, error.statusCode || 500, {
            error: error.message || '下载歌曲失败',
            error_code: error.code || 'MUSIC_DOWNLOAD_FAILED',
            details: error.details || '',
            upstream: error.upstream || ''
        });
    }
}

function mapProxyError(error) {
    const causeCode = error?.cause?.code || error?.code || '';
    const message = error?.message || '请求失败';

    if (causeCode === 'UND_ERR_CONNECT_TIMEOUT' || message.includes('Connect Timeout')) {
        return {
            statusCode: 504,
            error: '连接超时',
            errorCode: 'CONNECT_TIMEOUT'
        };
    }

    if (causeCode === 'EHOSTUNREACH' || causeCode === 'ENETUNREACH') {
        return {
            statusCode: 502,
            error: '网络不可达',
            errorCode: causeCode
        };
    }

    if (causeCode === 'ENOTFOUND' || causeCode === 'EAI_AGAIN') {
        return {
            statusCode: 502,
            error: '域名解析失败',
            errorCode: causeCode
        };
    }

    if (causeCode === 'ECONNREFUSED') {
        return {
            statusCode: 502,
            error: '目标服务器拒绝连接',
            errorCode: causeCode
        };
    }

    if (causeCode === 'ETIMEDOUT') {
        return {
            statusCode: 504,
            error: '请求超时',
            errorCode: causeCode
        };
    }

    return {
        statusCode: 502,
        error: '请求上游接口失败',
        errorCode: causeCode || 'UPSTREAM_FETCH_FAILED'
    };
}

function sendFile(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                sendJson(res, 404, { error: '文件不存在' });
                return;
            }

            sendJson(res, 500, { error: '读取文件失败' });
            return;
        }

        setNoCacheHeaders(res);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
}

function getSafeFilePath(urlPath) {
    const pathname = urlPath === '/' ? '/index.html' : urlPath;
    const normalizedPath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(ROOT_DIR, normalizedPath);

    if (!filePath.startsWith(ROOT_DIR)) {
        return null;
    }

    return filePath;
}

async function handleProxy(req, res) {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    const targetUrl = requestUrl.searchParams.get('url');

    if (!targetUrl) {
        sendJson(res, 400, { error: '缺少url参数' });
        return;
    }

    let parsedTargetUrl;
    try {
        parsedTargetUrl = new URL(targetUrl);
    } catch (error) {
        sendJson(res, 400, { error: 'url参数无效' });
        return;
    }

    if (!['http:', 'https:'].includes(parsedTargetUrl.protocol)) {
        sendJson(res, 400, { error: '仅支持 http/https 协议' });
        return;
    }

    console.log('代理请求:', parsedTargetUrl.toString());

    try {
        const response = await requestViaCurl(parsedTargetUrl);
        setNoCacheHeaders(res);
        res.setHeader('Access-Control-Allow-Origin', '*');

        const contentType = response.contentType || '';
        const text = response.body;

        if (contentType.includes('application/json')) {
            res.writeHead(response.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(text);
            return;
        }

        try {
            JSON.parse(text);
            res.writeHead(response.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(text);
        } catch (error) {
            res.writeHead(response.statusCode, { 'Content-Type': `${contentType || 'text/plain; charset=utf-8'}` });
            res.end(text);
        }
    } catch (error) {
        const mappedError = mapProxyError(error);
        console.error('代理错误:', mappedError.error, error.message);
        sendJson(res, mappedError.statusCode, {
            error: mappedError.error,
            error_code: mappedError.errorCode,
            details: error.message,
            upstream: parsedTargetUrl.toString()
        });
    }
}

async function handleMusicApi(req, res) {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    try {
        if (requestUrl.pathname === '/api/music/plugins') {
            sendJson(res, 200, await musicPluginService.listPlugins());
            return;
        }

        if (requestUrl.pathname === '/api/music/search') {
            sendJson(res, 200, await musicPluginService.search({
                plugin: requestUrl.searchParams.get('plugin') || 'all',
                keyword: requestUrl.searchParams.get('wd') || requestUrl.searchParams.get('keyword') || '',
                page: requestUrl.searchParams.get('page') || '1'
            }));
            return;
        }

        if (requestUrl.pathname === '/api/music/recommend') {
            sendJson(res, 200, await musicPluginService.getRecommendations({
                plugin: requestUrl.searchParams.get('plugin') || ''
            }));
            return;
        }

        if (requestUrl.pathname === '/api/music/recommend/toplists') {
            sendJson(res, 200, await musicPluginService.getRecommendationTopLists({
                plugin: requestUrl.searchParams.get('plugin') || ''
            }));
            return;
        }

        if (requestUrl.pathname === '/api/music/recommend/detail') {
            sendJson(res, 200, await musicPluginService.getRecommendationTopListDetail({
                plugin: requestUrl.searchParams.get('plugin') || '',
                topListId: requestUrl.searchParams.get('topListId') || requestUrl.searchParams.get('top_list_id') || ''
            }));
            return;
        }

        if (requestUrl.pathname === '/api/music/media') {
            sendJson(res, 200, await musicPluginService.getMedia({
                plugin: requestUrl.searchParams.get('plugin') || '',
                id: requestUrl.searchParams.get('id') || '',
                quality: requestUrl.searchParams.get('quality') || ''
            }));
            return;
        }

        if (requestUrl.pathname === '/api/music/download') {
            await handleMusicDownload(req, res);
            return;
        }

        if (requestUrl.pathname === '/api/music/track') {
            sendJson(res, 200, await musicPluginService.getTrack({
                plugin: requestUrl.searchParams.get('plugin') || '',
                id: requestUrl.searchParams.get('id') || ''
            }));
            return;
        }

        if (requestUrl.pathname === '/api/music/lyric') {
            sendJson(res, 200, await musicPluginService.getLyric({
                plugin: requestUrl.searchParams.get('plugin') || '',
                id: requestUrl.searchParams.get('id') || ''
            }));
            return;
        }

        sendJson(res, 404, { error: '音乐接口不存在' });
    } catch (error) {
        sendJson(res, error.statusCode || 500, {
            error: error.message || '音乐接口请求失败',
            error_code: error.code || 'MUSIC_API_FAILED',
            details: error.details || '',
            upstream: error.upstream || ''
        });
    }
}

async function handleIptvApi(req, res) {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    try {
        if (requestUrl.pathname === '/api/iptv/sources') {
            sendJson(res, 200, await iptvService.listSources());
            return;
        }

        if (requestUrl.pathname === '/api/iptv/channels') {
            const sourceKey = requestUrl.searchParams.get('source') || '';
            sendJson(res, 200, await iptvService.getChannels(sourceKey));
            return;
        }

        sendJson(res, 404, { error: 'IPTV 接口不存在' });
    } catch (error) {
        sendJson(res, error.statusCode || 500, {
            error: error.message || 'IPTV 接口请求失败',
            error_code: error.code || 'IPTV_API_FAILED',
            details: error.details || '',
            upstream: error.upstream || ''
        });
    }
}

const server = http.createServer(async (req, res) => {
    if (!req.url) {
        sendJson(res, 400, { error: '无效请求' });
        return;
    }

    if (req.method !== 'GET') {
        sendJson(res, 405, { error: '仅支持 GET 请求' });
        return;
    }

    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (requestUrl.pathname === '/api/proxy') {
        await handleProxy(req, res);
        return;
    }

    if (requestUrl.pathname.startsWith('/api/music/')) {
        await handleMusicApi(req, res);
        return;
    }

    if (requestUrl.pathname.startsWith('/api/iptv/')) {
        await handleIptvApi(req, res);
        return;
    }

    const filePath = getSafeFilePath(requestUrl.pathname);
    if (!filePath) {
        sendJson(res, 403, { error: '禁止访问' });
        return;
    }

    fs.stat(filePath, (error, stats) => {
        if (error || !stats.isFile()) {
            sendJson(res, 404, { error: '文件不存在' });
            return;
        }

        sendFile(res, filePath);
    });
});

server.listen(PORT, () => {
    console.log('影视网站服务已启动:');
    console.log(`- 网站地址: http://localhost:${PORT}`);
    console.log(`- 代理接口: http://localhost:${PORT}/api/proxy?url=xxx`);
    console.log(`- 音乐接口: http://localhost:${PORT}/api/music/plugins`);
    console.log(`- IPTV 接口: http://localhost:${PORT}/api/iptv/sources`);
});
