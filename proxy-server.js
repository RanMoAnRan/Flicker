const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { execFile, execFileSync } = require('child_process');
const { createMusicPluginService } = require('./music-plugin-service');

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

process.on('unhandledRejection', reason => {
    console.error('[server] 捕获到未处理的 Promise 拒绝:', reason);
});

process.on('uncaughtException', error => {
    console.error('[server] 捕获到未处理异常，服务将继续运行:', error);
});

function requestViaCurl(targetUrl) {
    const curlArgs = [
        '-L',
        '-sS',
        '--globoff',
        '--max-time', '20',
        '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '-H', 'Accept: application/json, text/plain, */*',
        '-H', 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
        '-H', 'Cache-Control: no-cache',
        '-H', `Referer: ${targetUrl.protocol}//${targetUrl.host}`,
        '-w', '\n__FG_STATUS__:%{http_code}\n__FG_CONTENT_TYPE__:%{content_type}\n',
        targetUrl.toString()
    ];

    if (SYSTEM_PROXY_URL) {
        curlArgs.unshift(SYSTEM_PROXY_URL);
        curlArgs.unshift('--proxy');
    }

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
});
