// ==MiruExtension==
// @name         KlonTV
// @version      v0.0.1
// @author       CakesTwix
// @lang         uk
// @license      MIT
// @icon         https://www.google.com/s2/favicons?domain=klonua.com&sz=256
// @package      klontv
// @type         bangumi
// @webSite      https://klonua.com
// ==/MiruExtension==

const mainUrl = "https://klonua.com";
const UA = "Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.215 Mobile Safari/537.36";

function fixUrl(url) {
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("//")) return "https:" + url;
    if (url.startsWith("/")) return mainUrl + url;
    return mainUrl + "/" + url;
}

function fixTls(url) {
    if (url && (url.includes("tortuga.wtf") || url.includes("tortuga.tw")) && url.startsWith("https://")) {
        return url.replace("https://", "http://");
    }
    return url;
}

export default class extends Extension {
    async fetch(url, options = {}) {
        options.headers = options.headers || {};
        options.headers["User-Agent"] = UA;
        options.headers["Referer"] = mainUrl;
        
        if (url.startsWith("http://") || url.startsWith("https://")) {
            options.headers["Miru-Url"] = url;
            return this.request("", options);
        }
        return this.request(url, options);
    }

    async createFilter(filter) { return {}; }
    async checkUpdate(url) { return ""; }

    async latest(page) {
        const res = await this.request(`/filmy/page/${page}/`);
        const items = await this.querySelectorAll(res, ".short-news__slide-item");
        const results = [];
        
        for (const item of items) {
            const html = item.content;
            const href = await this.getAttributeText(html, ".card-link__style, .text-module__main", "href");
            if (!href) continue;
            
            const titleEl = await this.querySelector(html, ".card-link__style, .text-module__main");
            const title = (await titleEl?.text || "").trim();
            
            let poster = await this.getAttributeText(html, ".card-poster__img, .cover-image, .owl-carousel .owl-item img", "data-src");
            if (poster && !poster.startsWith("http")) poster = mainUrl + poster;
            
            results.push({ title, url: fixUrl(href), cover: fixUrl(poster) });
        }
        return results;
    }

    async search(kw, page, filter) {
        const res = await this.request("", {
            method: "POST",
            data: {
                do: "search",
                subaction: "search",
                story: kw.replace(" ", "+")
            },
            headers: {
                "Miru-Url": mainUrl,
                "Content-Type": "application/x-www-form-urlencoded"
            }
        });
        
        const items = await this.querySelectorAll(res, ".short-news__slide-item");
        const results = [];
        
        for (const item of items) {
            const html = item.content;
            const href = await this.getAttributeText(html, ".card-link__style, .text-module__main", "href");
            if (!href) continue;
            
            const titleEl = await this.querySelector(html, ".card-link__style, .text-module__main");
            const title = (await titleEl?.text || "").trim();
            
            let poster = await this.getAttributeText(html, ".card-poster__img, .cover-image, .owl-carousel .owl-item img", "data-src");
            if (poster && !poster.startsWith("http")) poster = mainUrl + poster;
            
            results.push({ title, url: fixUrl(href), cover: fixUrl(poster) });
        }
        return results;
    }

    async detail(url) {
        const res = await this.fetch(url);
        
        let title = "";
        try {
            const titleEl = await this.querySelector(res, ".seo-h1__position");
            title = (await titleEl?.text || "").trim();
            if (!title) {
                const jsonLdMatch = res.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
                if (jsonLdMatch && jsonLdMatch[1]) {
                    const json = JSON.parse(jsonLdMatch[1].trim());
                    title = json.name || "";
                }
            }
        } catch (e) { /* ignore */ }

        let poster = "";
        try {
            poster = await this.getAttributeText(res, ".card-poster__img, .cover-image, .owl-carousel .owl-item img", "data-src");
            if (poster && !poster.startsWith("http")) poster = mainUrl + poster;
        } catch (e) { /* ignore */ }

        let desc = "";
        try {
            const descEl = await this.querySelector(res, ".info-clamp__hid");
            desc = (await descEl?.text || "").trim();
        } catch (e) { /* ignore */ }

        const playerUrl = await this.getAttributeText(res, "div.film-player iframe", "data-src");
        if (!playerUrl) throw new Error("No player iframe found");

        const isSeries = playerUrl.includes("/serial/");
        const episodeGroups = [];

        if (isSeries) {
            // Для серіалів: завантажуємо сторінку плеєра, парсимо JSON
            const safePlayerUrl = fixTls(playerUrl);
            const playerHtml = await this.fetch(safePlayerUrl);
            const fileMatch = playerHtml.match(/file\s*:\s*'([^']+)'/);
            
            if (fileMatch && fileMatch[1]) {
                let playlist;
                try {
                    playlist = JSON.parse(fileMatch[1]);
                } catch (e) {
                    throw new Error("Failed to parse playlist JSON");
                }

                const dubGroups = {};
                for (const dub of playlist) {
                    const dubName = dub.title;
                    if (!dubGroups[dubName]) dubGroups[dubName] = [];
                    
                    for (const season of dub.folder) {
                        for (const ep of season.folder) {
                            dubGroups[dubName].push({
                                name: `${season.title} - ${ep.title}`,
                                url: `series:${playerUrl}|${season.title}|${ep.title}`
                            });
                        }
                    }
                }
                
                for (const dubName in dubGroups) {
                    episodeGroups.push({ title: dubName, urls: dubGroups[dubName] });
                }
            }
        } else {
            // Для фільмів: передаємо URL плеєра у watch()
            episodeGroups.push({
                title: "Фільм",
                urls: [{ name: title, url: `movie:${playerUrl}` }]
            });
        }

        if (episodeGroups.length === 0) {
            throw new Error("No episodes found");
        }

        return {
            title,
            cover: fixUrl(poster),
            desc,
            episodes: episodeGroups
        };
    }

    async watch(url) {
        let streamUrl = "";
        let subtitles = [];
        let referer = "https://tortuga.wtf/";

        if (url.startsWith("movie:")) {
            const playerUrl = fixTls(url.replace("movie:", ""));
            const playerHtml = await this.fetch(playerUrl);
            const fileMatch = playerHtml.match(/file\s*:\s*'([^']+)'/);
            
            if (fileMatch && fileMatch[1]) {
                streamUrl = fixTls(fileMatch[1]);
            }
            
            // Субтитри для фільмів
            const subMatch = playerHtml.match(/subtitle\s*:\s*'([^']+)'/);
            if (subMatch && subMatch[1]) {
                const subRaw = subMatch[1];
                const subName = subRaw.substringAfterLast("[").substringBefore("]");
                const subUrl = subRaw.substringAfter("]");
                if (subUrl) subtitles.push({ title: subName, url: subUrl });
            }
        } else if (url.startsWith("series:")) {
            const parts = url.split("|");
            const playerUrl = fixTls(parts[0].replace("series:", ""));
            const seasonTitle = parts[1];
            const episodeTitle = parts[2];
            
            const playerHtml = await this.fetch(playerUrl);
            const fileMatch = playerHtml.match(/file\s*:\s*'([^']+)'/);
            
            if (fileMatch && fileMatch[1]) {
                let playlist;
                try {
                    playlist = JSON.parse(fileMatch[1]);
                } catch (e) {
                    throw new Error("Failed to parse playlist JSON");
                }

                for (const dub of playlist) {
                    for (const season of dub.folder) {
                        if (season.title === seasonTitle) {
                            for (const ep of season.folder) {
                                if (ep.title === episodeTitle) {
                                    streamUrl = fixTls(ep.file);
                                    if (ep.subtitle) {
                                        const subName = ep.subtitle.substringAfterLast("[").substringBefore("]");
                                        const subUrl = ep.subtitle.substringAfter("]");
                                        if (subUrl) subtitles.push({ title: subName, url: subUrl });
                                    }
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        if (!streamUrl) throw new Error("Failed to extract stream URL");

        const isHls = streamUrl.includes(".m3u8");
        
        return {
            type: isHls ? "hls" : "mp4",
            url: streamUrl,
            headers: {
                "Referer": referer,
                "User-Agent": UA
            },
            subtitles: subtitles
        };
    }
}