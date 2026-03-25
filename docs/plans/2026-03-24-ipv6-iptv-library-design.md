# IPv6 IPTV 库设计

## 背景

当前项目的“视频库片源”体系只支持苹果 CMS `vod/art` 接口，数据模型围绕分类、列表、详情、剧集和播放线路组织。当前 IPTV 库保留以下内置播放列表源：

- `IPv4 综合可播源`
  - 内置保底频道池，只收录已人工抽测通过的浏览器友好 HLS 频道
  - 动态合并 `https://raw.githubusercontent.com/hujingguang/ChinaIPTV/main/cnTV_AutoUpdate.m3u8`

这类源是 `m3u` 文本播放列表，不是 CMS 接口，无法直接作为现有“片源”接入。

## 目标

- 新增一个独立的“IPv6 IPTV 库”入口
- 第一版支持：
  - 内置一个综合 IPTV 源
  - 查看频道分组
  - 切换分组浏览频道列表
  - 点击频道直接播放
- 复用现有站点视觉风格与播放器能力
- 不影响现有视频库、音乐库、片源管理主链路

## 非目标

- 不把 IPTV 源混入现有 CMS 片源管理
- 不做关键词搜索
- 不做收藏、历史、常看
- 不做节目单、EPG、回看
- 不做后台管理式的自定义 IPTV 源编辑

## 方案

采用“独立 IPTV 库页面 + 独立后端接口 + 复用现有播放器”的方案：

- 前端新增 `ipv6.html` 页面作为 IPTV 库入口
- 后端在 `proxy-server.js` 中新增 `/api/iptv/*` 接口
- 服务端拉取远程 `m3u`，解析成前端可用 JSON
- 播放阶段优先复用现有 `player.html` 与 `hls.js` 能力，但增加 `iptv` 模式

这样可以把 `CMS` 与 `IPTV` 两套模型完全分离，降低耦合与回归风险。

## 信息架构

### 顶部入口

- 首页新增 “IPv6 库” 入口
- IPTV 页面头部保留站点导航与主题切换

### IPTV 页面

页面主体包含以下区域：

- 源切换区
  - 展示内置源
  - 当前选中源高亮
  - 展示“可播数 / 原始数”以及 IPv6 提示
- 分组导航区
  - 展示当前源下的频道分组
  - 支持点击切换
- 频道列表区
  - 展示当前分组下的频道卡片
  - 卡片展示频道名、源名、分组名
- 当前播放提示区
  - 显示当前正在浏览的源与分组信息

### 播放页

- 沿用 `player.html`
- 增加 `mode=iptv` 参数分支
- `iptv` 模式下不再请求影视详情，而是直接使用 URL 参数中的频道信息与流地址进行播放

## 数据模型

### IPTV 源

```json
{
  "key": "merged_ipv4",
  "name": "IPv4 综合可播源",
  "url": "builtin://merged-ipv4",
  "requiresIpv6": false
}
```

### 频道分组

```json
{
  "key": "cctv",
  "title": "CCTV",
  "count": 28
}
```

### 频道

```json
{
  "id": "merged_ipv4::cctv1",
  "name": "CCTV-1 综合",
  "groupKey": "cctv",
  "groupTitle": "CCTV",
  "streamUrl": "https://example.com/live.m3u8",
  "logo": "https://example.com/logo.png",
  "sourceKey": "merged_ipv4",
  "sourceName": "IPv4 综合可播源",
  "playbackType": "hls",
  "requiresIpv6": false
}
```

## 后端设计

### 接口

新增以下接口：

1. `GET /api/iptv/sources`
- 返回内置 IPTV 源列表
- 返回每个源的频道总数与分组总数概览

2. `GET /api/iptv/channels?source=<sourceKey>`
- 拉取并解析指定 `m3u` 源
- 返回：
  - 当前源信息
  - 分组列表
  - 频道列表

### 解析策略

按 `m3u` 常见格式解析：

- 读取 `#EXTINF` 行中的：
  - 频道名
  - `group-title`
  - `tvg-logo`
- 读取其后一行作为真实播放地址

解析规则：

- 没有 `group-title` 时归入 “未分组”
- 没有 `logo` 时允许为空
- 去掉空白行与非法条目
- 使用 `sourceKey + channelName + streamUrl` 生成稳定 ID
- 只保留更接近浏览器可播放的链接：
  - `m3u8`
  - `mp4`
  - `webm / ogg / ogv / m4v`
- `rtp / rtmp / rtsp / udp` 以及无法从 URL 判断为浏览器可播的链接在服务端直接过滤
- 对候选频道执行实际连通性探测，只保留当前环境下返回正常的频道

### 缓存策略

- 服务端使用内存缓存
- 默认缓存 10 分钟
- 避免每次打开页面都直接请求 GitHub Raw
- 拉取失败时：
  - 若有旧缓存则优先返回旧缓存并标注 `stale`
  - 若无缓存则返回明确错误

## 前端设计

### 新页面

新增 `ipv6.html`：

- 结构风格参考 `music.html`
- 保持现有视觉系统、卡片样式、二级导航语言一致
- 移动端优先，桌面端兼容

### 页面状态

- `sources`
- `activeSourceKey`
- `groups`
- `activeGroupKey`
- `channels`
- `filteredChannels`
- `loading`
- `error`

### 交互

1. 页面加载时请求 `/api/iptv/sources`
2. 默认选择第一个源
3. 请求 `/api/iptv/channels`
4. 渲染分组导航
5. 默认进入 “全部频道”
6. 点击频道后跳转到：

```text
player.html?mode=iptv&name=频道名&group=分组名&source_name=源名&play_url=流地址
```

## 播放器设计

### `player.html` 新增 IPTV 模式

当 `mode=iptv` 时：

- 不读取 `id`、`ep`、`source`、`source_id`
- 不调用 `Api.getVideoDetail`
- 直接从 URL 中读取：
  - `name`
  - `group`
  - `source_name`
  - `play_url`

播放器展示：

- 标题显示频道名
- 副标题显示分组与来源
- 元信息显示“直播频道 / IPTV 源 / 实时播放”
- 不渲染影视线路和剧集列表
- 控制台区域改为“当前直播流信息”

播放逻辑：

- 若链接为 `m3u8`，优先使用 `hls.js`
- 若浏览器可直接播放，则回退到原生 `video.src`
- 若两者都不支持，展示错误提示

## 风险与对策

### 1. 远程源不稳定

- 风险：GitHub Raw 访问失败或源内容变化
- 对策：增加内存缓存与错误提示

### 2. 频道链接不可播

- 风险：部分频道失效
- 对策：只提示当前频道播放失败，不影响整体页面

### 3. 流格式不统一

- 风险：不是所有链接都一定是 HLS
- 对策：优先 HLS，回退原生播放器，最终给出不支持提示

### 4. 页面入口过多

- 风险：首页入口继续增加会加重头部负担
- 对策：IPTV 入口第一版只在首页展示一个稳定跳转按钮，不塞进现有片源管理

## 验收标准

- 首页可进入 `IPv6 IPTV 库`
- 页面可展示内置 IPTV 源
- 页面可展示每个源的“可播数 / 原始数”
- 切换源后可看到对应分组与频道列表
- 切换分组后频道列表正确刷新
- 点击频道后能进入播放器页
- 至少部分 `m3u8` 频道可正常播放
- 源拉取失败时页面有明确提示
- 现有 `index.html`、`music.html`、`player.html` 影视模式不受影响
