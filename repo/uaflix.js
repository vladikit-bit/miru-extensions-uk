// ==MiruExtension==
// @name         UAFlix
// @version      v0.0.3
// @author       CakesTwix
// @lang         uk
// @license      MIT
// @icon         https://www.google.com/s2/favicons?domain=uafix.net&sz=256
// @package      uaflix
// @type         bangumi
// @webSite      https://uafix.net
// ==/MiruExtension==

const mainUrl = "https://uafix.net";
const UA = "Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.215 Mobile Safari/537.36";

function fixUrl(url) {
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("//")) return "https:" + url;
    if (url.startsWith("/")) return mainUrl + url;
    return mainUrl + "/" + url;
}

// Парсер субтитрів
function parseUAFlixSubtitle(raw) {
    if (!raw) return null;
    const value = raw.trim();
    if (!value.startsWith("[")) return null;
    const endIndex = value.indexOf(']');
    if (endIndex <= 1) return null;
    const language = value.substring(1, endIndex).trim();
    let url = value.substring(endIndex + 1).trim().trimEnd(',');
    if (url.startsWith("//")) url = "https:" + url;
    if (!url.startsWith("http://") && !url.startsWith("https://")) return null;
    return { language, url };
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
        const res = await this.request(`/film/page/${page}/`);
        const items = await this.querySelectorAll(res, ".video-item");
        const results = [];
        
        for (const item of items) {
            const html = item.content;
            const href = await this.getAttributeText(html, ".vi-img, .sres-wrap", "href");
            if (!href) continue;
            
            let title = (await this.getAttributeText(html, ".vi-img, .sres-img img", "alt") || "").trim();
            let poster = await this.getAttributeText(html, ".img-resp-h img, .sres-img img", "src");
            if (!poster) poster = await this.getAttributeText(html, ".img-resp-h img, .sres-img img", "data-src");
            if (poster && !poster.startsWith("http")) poster = mainUrl + poster;
            
            results.push({ title, url: fixUrl(href), cover: fixUrl(poster) });
        }
        return results;
    }

    async search(kw, page, filter) {
        const res = await this.request(`/index.php?do=search&subaction=search&search_start=0&story=${encodeURIComponent(kw)}`);
        const items = await this.querySelectorAll(res, ".sres-wrap");
        const results = [];
        
        for (const item of items) {
            const html = item.content;
            const href = await this.getAttributeText(html, ".sres-wrap", "href");
            if (!href) continue;
            
            let title = (await this.getAttributeText(html, ".sres-img img", "alt") || "").trim();
            let poster = await this.getAttributeText(html, ".sres-img img", "src");
            if (poster && !poster.startsWith("http")) poster = mainUrl + poster;
            
            results.push({ title, url: fixUrl(href), cover: fixUrl(poster) });
        }
        return results;
    }

    async fetchPlayerJson(playerUrl) {
        const playerHtml = await this.fetch(playerUrl);
        
        const scripts = await this.querySelectorAll(playerHtml, "script");
        let scriptHtml = "";
        for (const script of scripts) {
            scriptHtml += (await script.text || "") + "\n";
        }
        
        const fileMatch = scriptHtml.match(/file\s*:\s*["']([^"']+)["']/);
        if (!fileMatch || !fileMatch[1]) throw new Error("No file: found in player scripts");
        
        const rawFile = fileMatch[1];
        
        // Якщо це пряме посилання на m3u8 (для фільмів на /vod/)
        if (rawFile.startsWith("http")) {
            const subtitleMatch = scriptHtml.match(/subtitle\s*:\s*["']([^"']*)["']/);
            let subtitle = null;
            if (subtitleMatch && subtitleMatch[1]) {
                subtitle = parseUAFlixSubtitle(subtitleMatch[1]);
            }
            return { isDirectUrl: true, directUrl: rawFile, subtitle };
        }
        
        let playlist;
        try {
            playlist = JSON.parse(rawFile);
        } catch (e) {
            throw new Error("Failed to parse playlist JSON: " + e.message);
        }
        
        const subtitleMatch = scriptHtml.match(/subtitle\s*:\s*["']([^"']*)["']/);
        let subtitle = null;
        if (subtitleMatch && subtitleMatch[1]) {
            subtitle = parseUAFlixSubtitle(subtitleMatch[1]);
        }
        
        return { isDirectUrl: false, playlist, subtitle };
    }

    async detail(url) {
        const res = await this.fetch(url);
        
        let title = "";
        try {
            const titleEl = await this.querySelector(res, ".fright h1");
            title = (await titleEl?.text || "").trim().replace("дивитись онлайн", "");
        } catch (e) { /* ignore */ }

        let poster = "";
        try {
            poster = await this.getAttributeText(res, ".img-box img", "data-src");
            if (!poster) poster = await this.getAttributeText(res, ".img-box img", "src");
            if (poster && !poster.startsWith("http")) poster = mainUrl + poster;
        } catch (e) { /* ignore */ }

        let desc = "";
        try {
            const descEl = await this.querySelector(res, "#fdesc");
            desc = (await descEl?.text || "").trim();
        } catch (e) { /* ignore */ }

        const playerUrl = await this.getAttributeText(res, ".video-box iframe", "src");
        if (!playerUrl) throw new Error("No player iframe found");

        const safePlayerUrl = fixUrl(playerUrl);
        
        const episodeGroups = [];
        const episodes = [];
        
        let playerData = null;
        try {
            playerData = await this.fetchPlayerJson(safePlayerUrl);
        } catch (e) {
            // If player fetch fails, fallback to movie mode
        }
        
        if (playerData && !playerData.isDirectUrl && Array.isArray(playerData.playlist)) {
            // Series
            for (const dub of playerData.playlist) {
                const dubName = dub.title || "Озвучка";
                if (!dub.folder) continue;
                
                for (const season of dub.folder) {
                    const seasonTitle = season.title || "Сезон 1";
                    if (!season.folder) continue;
                    
                    for (const ep of season.folder) {
                        if (ep.file) {
                            episodes.push({
                                name: `${seasonTitle} - ${ep.title}`,
                                url: `series:${safePlayerUrl}|${seasonTitle}|${ep.title}`
                            });
                        }
                    }
                }
            }
        }
        
        if (episodes.length > 0) {
            episodeGroups.push({ title: "Серії", urls: episodes });
        } else {
            // Movie
            episodeGroups.push({
                title: "Фільм",
                urls: [{ name: title || "Дивитися", url: `movie:${safePlayerUrl}` }]
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
        
        let streamUrl = "";
        let subtitles = [];
        
        if (url.startsWith("movie:")) {
            const playerUrl = url.replace("movie:", "");
            const playerData = await this.fetchPlayerJson(playerUrl);
            
            if (playerData.isDirectUrl) {
                streamUrl = playerData.directUrl;
                if (playerData.subtitle) {
                    subtitles.push({ title: playerData.subtitle.language, url: playerData.subtitle.url });
                }
            } else if (Array.isArray(playerData.playlist)) {
                streamUrl = playerData.playlist[0]?.file || "";
                if (playerData.playlist[0]?.subtitle) {
                    const sub = parseUAFlixSubtitle(playerData.playlist[0].subtitle);
                    if (sub) subtitles.push({ title: sub.language, url: sub.url });
                }
            }
        } else if (url.startsWith("series:")) {
            const parts = url.split("|");
            const playerUrl = parts[0].replace("series:", "");
            const seasonTitle = parts[1];
            const episodeTitle = parts[2];
            
            const playerData = await this.fetchPlayerJson(playerUrl);
            
            if (!playerData.isDirectUrl && Array.isArray(playerData.playlist)) {
                for (const dub of playerData.playlist) {
                    if (!dub.folder) continue;
                    for (const season of dub.folder) {
                        if (season.title === seasonTitle && season.folder) {
                            for (const ep of season.folder) {
                                if (ep.title === episodeTitle && ep.file) {
                                    streamUrl = ep.file;
                                    if (ep.subtitle) {
                                        const sub = parseUAFlixSubtitle(ep.subtitle);
                                        if (sub) subtitles.push({ title: sub.language, url: sub.url });
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

        return {
            type: "hls",
            url: streamUrl,
            headers: {
                "Referer": "https://tortuga.wtf/",
                "User-Agent": UA
            },
            subtitles: subtitles
        };
    }
}