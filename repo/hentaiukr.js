// ==MiruExtension==
// @name         HentaiUkr 18+
// @version      v0.0.1
// @author       CakesTwix
// @lang         uk
// @license      MIT
// @icon         https://www.google.com/s2/favicons?domain=hentaiukr.com&sz=256
// @package      hentaiukr
// @type         bangumi
// @webSite      https://hentaiukr.com
// ==/MiruExtension==

const mainUrl = "https://hentaiukr.com";
const objectsUrl = `${mainUrl}/search/objects.json`;

function fixUrl(url) {
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("//")) return "https:" + url;
    if (url.startsWith("/")) return mainUrl + url;
    return mainUrl + "/" + url;
}

export default class extends Extension {
    async fetch(url, options = {}) {
        options.headers = options.headers || {};
        options.headers["User-Agent"] = "Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.215 Mobile Safari/537.36";
        
        if (url.startsWith("http://") || url.startsWith("https://")) {
            options.headers["Miru-Url"] = url;
            return this.request("", options);
        }
        return this.request(url, options);
    }

    async createFilter(filter) { return {}; }
    async checkUpdate(url) { return ""; }

    async fetchObjectsJson() {
        let res;
        try {
            res = await this.request("/search/objects.json");
            if (typeof res === 'string') res = JSON.parse(res);
        } catch (e) { return null; }
        return res;
    }

    async latest(page) {
        const data = await this.fetchObjectsJson();
        if (!data || !Array.isArray(data.video)) return [];
        
        return data.video.map(item => ({
            title: item.name || "Без назви",
            url: fixUrl(item.url),
            cover: fixUrl(item.thumb)
        }));
    }

    async search(kw, page, filter) {
        const data = await this.fetchObjectsJson();
        if (!data || !Array.isArray(data.video)) return [];
        
        const lowerQuery = kw.toLowerCase();
        return data.video
            .filter(item => item.name && item.name.toLowerCase().includes(lowerQuery))
            .map(item => ({
                title: item.name,
                url: fixUrl(item.url),
                cover: fixUrl(item.thumb)
            }));
    }

    async fetchPlurCfg(titleUrl) {
        const safeUrl = titleUrl.endsWith("/") ? titleUrl : titleUrl + "/";
        const cfgUrl = `${safeUrl}plur.cfg.json`;
        let res;
        try {
            res = await this.fetch(cfgUrl, {
                headers: {
                    "Referer": mainUrl + "/",
                    "Accept": "application/json, text/javascript, */*; q=0.01",
                    "X-Requested-With": "XMLHttpRequest"
                }
            });
            
            if (typeof res === 'string') {
                // Якщо сервер повернув HTML (напр., помилку 403/404)
                if (res.trim().startsWith("<")) {
                    throw new Error("Server returned HTML instead of JSON");
                }
                res = JSON.parse(res);
            }
        } catch (e) {
            throw new Error("fetchPlurCfg_ERROR: " + e.message + " | URL: " + cfgUrl);
        }
        return res;
    }

    async detail(url) {
        const detailUrl = fixUrl(url);
        
        const htmlRes = await this.fetch(detailUrl);
        
        let title = "";
        try {
            const titleEl = await this.querySelector(htmlRes, "#name-ukr");
            title = (await titleEl?.text || "").trim() || "Без назви";
        } catch (e) { /* ignore */ }

        let poster = "";
        try {
            poster = await this.getAttributeText(htmlRes, "#img-placeholder img", "src");
            if (poster && !poster.startsWith("http")) poster = mainUrl + poster;
        } catch (e) { /* ignore */ }

        let desc = "";
        try {
            const descEl = await this.querySelector(htmlRes, "#about");
            desc = (await descEl?.text || "").trim();
        } catch (e) { /* ignore */ }

        const cfgList = await this.fetchPlurCfg(detailUrl);
        
        const episodeGroups = [];
        const episodes = [];
        
        if (Array.isArray(cfgList)) {
            for (let i = 0; i < cfgList.length; i++) {
                const cfg = cfgList[i];
                if (!cfg || !Array.isArray(cfg.sources) || cfg.sources.length === 0) continue;
                
                const bestSource = cfg.sources.slice().sort((a, b) => (b.size || 0) - (a.size || 0))[0];
                const qualityLabel = bestSource.size ? `${bestSource.size}p` : "Невідомо";
                const srcIndex = cfg.sources.indexOf(bestSource);
                
                // Передаємо дані через query-параметри
                episodes.push({
                    name: `Серія ${i + 1} (${qualityLabel})`,
                    url: `${detailUrl}?ep=${i}&src=${srcIndex}`
                });
            }
        }
        
        if (episodes.length > 0) {
            episodeGroups.push({ title: "Серії", urls: episodes });
        } else {
            episodeGroups.push({
                title: "Дивитися",
                urls: [{ name: "Відтворити", url: `${detailUrl}?ep=0&src=0` }]
            });
        }

        return {
            title,
            cover: fixUrl(poster),
            desc,
            episodes: episodeGroups
        };
    }

    async watch(url) {
        if (!url) throw new Error("No stream URL provided");

        let detailUrl = url;
        let epIndex = 0;
        let srcIndex = -1;

        // Виявляємо, чи це старий JSON формат
        if (url.startsWith("{")) {
            try {
                const state = JSON.parse(url);
                detailUrl = state.detailUrl;
                epIndex = state.epIndex || 0;
                srcIndex = state.srcIndex || -1;
            } catch (e) {
                throw new Error("Invalid watch state JSON: " + e.message);
            }
        } else {
            // Парсимо query-параметри
            const queryIndex = url.indexOf("?");
            if (queryIndex !== -1) {
                detailUrl = url.substring(0, queryIndex);
                const queryStr = url.substring(queryIndex + 1);
                const params = queryStr.split("&");
                for (let i = 0; i < params.length; i++) {
                    const pair = params[i].split("=");
                    if (pair[0] === "ep") epIndex = parseInt(pair[1], 10) || 0;
                    else if (pair[0] === "src") srcIndex = parseInt(pair[1], 10);
                }
            }
        }

        // Гарантуємо слеш на кінці, щоб plur.cfg.json знайшовся
        const safeDetailUrl = detailUrl.endsWith("/") ? detailUrl : detailUrl + "/";

        const cfgList = await this.fetchPlurCfg(safeDetailUrl);
        if (!Array.isArray(cfgList)) {
            throw new Error("Failed to load plur.cfg.json");
        }

        const cfg = cfgList[epIndex];
        if (!cfg || !Array.isArray(cfg.sources) || cfg.sources.length === 0) {
            throw new Error(`No sources for episode ${epIndex + 1}`);
        }

        let source;
        if (srcIndex >= 0 && srcIndex < cfg.sources.length) {
            source = cfg.sources[srcIndex];
        } else {
            // Fallback to best quality
            source = cfg.sources.slice().sort((a, b) => (b.size || 0) - (a.size || 0))[0];
        }

        if (!source || !source.src) {
            throw new Error("Empty source");
        }

        // Правильно обробляємо відносні шляхи відео
        let videoUrl = source.src;
        if (videoUrl.startsWith("http://") || videoUrl.startsWith("https://")) {
            // Вже абсолютний URL
        } else if (videoUrl.startsWith("//")) {
            videoUrl = "https:" + videoUrl;
        } else if (videoUrl.startsWith("/")) {
            // Відносний від кореня домену
            videoUrl = mainUrl + videoUrl;
                } else {
            // Відносний від шляху сторінки (напр. "1.mp4" -> "https://hentaiukr.com/video/123/1.mp4")
            // Видаляємо ім'я файлу з URL, щоб отримати базовий шлях
            let basePath = safeDetailUrl;
            // Якщо URL закінчується на /, він вже є базовим шляхом
            if (!basePath.endsWith("/")) {
                // Видаляємо останній сегмент (напр. index.html)
                const lastSlash = basePath.lastIndexOf("/");
                if (lastSlash > 8) { // Зберігаємо https://
                    basePath = basePath.substring(0, lastSlash + 1);
                } else {
                    basePath += "/";
                }
            }
            videoUrl = basePath + videoUrl;
        }

        let type = "mp4";
        if (videoUrl.includes(".m3u8")) {
            type = "hls";
        } else if (videoUrl.includes(".webm")) {
            type = "webm";
        } else if (source.type) {
            const mime = String(source.type).toLowerCase();
            if (mime.includes("mp4")) type = "mp4";
            else if (mime.includes("hls") || mime.includes("mpegurl")) type = "hls";
            else if (mime.includes("webm")) type = "webm";
        }

        const subtitles = [];
        if (Array.isArray(cfg.tracks)) {
            for (let i = 0; i < cfg.tracks.length; i++) {
                const track = cfg.tracks[i];
                if (track && track.src) {
                    let subUrl = track.src;
                    // Також обробляємо відносні шляхи для субтитрів
                    if (!subUrl.startsWith("http") && !subUrl.startsWith("//")) {
                         if (subUrl.startsWith("/")) {
                            subUrl = mainUrl + subUrl;
                        } else {
                            let basePath = safeDetailUrl;
                            if (!basePath.endsWith("/")) {
                                const lastSlash = basePath.lastIndexOf("/");
                                if (lastSlash > 8) {
                                    basePath = basePath.substring(0, lastSlash + 1);
                                } else {
                                    basePath += "/";
                                }
                            }
                            subUrl = basePath + subUrl;
                        }
                    } else if (subUrl.startsWith("//")) {
                        subUrl = "https:" + subUrl;
                    }
                    subtitles.push({
                        title: track.label || `Субтитри ${i + 1}`,
                        url: subUrl
                    });
                }
            }
        }

        const response = {
            type: type,
            url: videoUrl,
            headers: {
                "Referer": safeDetailUrl,
                "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
            }
        };

        if (subtitles.length > 0) {
            response.subtitles = subtitles;
        }

        return response;
    }
}