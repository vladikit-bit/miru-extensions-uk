// ==MiruExtension==
// @name         AnimeUA
// @version      v0.0.1
// @author       CakesTwix
// @lang         uk
// @license      MIT
// @icon         https://www.google.com/s2/favicons?domain=animeua.club&sz=256
// @package      animeua
// @type         bangumi
// @webSite      https://animeua.club
// ==/MiruExtension==

const mainUrl = "https://animeua.club";
const UA = "Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.215 Mobile Safari/537.36";

function fixUrl(url) {
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("//")) return "https:" + url;
    if (url.startsWith("/")) return mainUrl + url;
    return mainUrl + "/" + url;
}

function fixTls(url) {
    if (url && (url.includes("tortuga.wtf") || url.includes("ashdi.vip")) && url.startsWith("https://")) {
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
        const res = await this.request(`/page/${page}/`);
        const items = await this.querySelectorAll(res, "a.poster");
        const results = [];
        
        for (const item of items) {
            const html = item.content;
            const href = await this.getAttributeText(html, ".fd-column", "href");
            if (!href) continue;
            
            const titleEl = await this.querySelector(html, "h3.poster__title");
            const title = (await titleEl?.text || "").trim();
            
            let poster = await this.getAttributeText(html, ".img-fit-cover img", "data-src");
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
        
        const items = await this.querySelectorAll(res, "a.poster");
        const results = [];
        
        for (const item of items) {
            const html = item.content;
            const href = await this.getAttributeText(html, ".fd-column", "href");
            if (!href) continue;
            
            const titleEl = await this.querySelector(html, "h3.poster__title");
            const title = (await titleEl?.text || "").trim();
            
            let poster = await this.getAttributeText(html, ".img-fit-cover img", "data-src");
            if (poster && !poster.startsWith("http")) poster = mainUrl + poster;
            
            results.push({ title, url: fixUrl(href), cover: fixUrl(poster) });
        }
        return results;
    }

    async fetchPlayerJson(playerUrl) {
        const safeUrl = fixTls(playerUrl);
        const playerHtml = await this.fetch(safeUrl);
        
        const scripts = await this.querySelectorAll(playerHtml, "script");
        let scriptHtml = "";
        for (const script of scripts) {
            scriptHtml += (await script.text || "") + "\n";
        }
        
        const fileMatch = scriptHtml.match(/file\s*:\s*["']([^"']+)["']/);
        if (!fileMatch || !fileMatch[1]) throw new Error("No file: found in player scripts");
        
        const rawFile = fileMatch[1];
        
        if (rawFile.startsWith("http")) {
            return { isDirectUrl: true, directUrl: rawFile };
        }
        
        let playlist;
        try {
            playlist = JSON.parse(rawFile);
        } catch (e) {
            throw new Error("Failed to parse playlist JSON: " + e.message);
        }
        
        return { isDirectUrl: false, playlist };
    }

    async detail(url) {
        const res = await this.fetch(url);
        
        let title = "";
        try {
            const titleEl = await this.querySelector(res, ".page__subcol-main h1");
            title = (await titleEl?.text || "").trim();
        } catch (e) { /* ignore */ }

        let poster = "";
        try {
            poster = await this.getAttributeText(res, "div.page__subcol-side .img-fit-cover img", "data-src");
            if (poster && !poster.startsWith("http")) poster = mainUrl + poster;
        } catch (e) { /* ignore */ }

        let desc = "";
        try {
            const descEl = await this.querySelector(res, ".full-text");
            desc = (await descEl?.text || "").trim();
        } catch (e) { /* ignore */ }

        const playerUrl = await this.getAttributeText(res, ".video-responsive > iframe", "data-src");
        if (!playerUrl) throw new Error("No player iframe found");

        const safePlayerUrl = fixUrl(playerUrl);
        
        const episodeGroups = [];
        const episodes = [];
        
        let playerData = null;
        try {
            playerData = await this.fetchPlayerJson(safePlayerUrl);
        } catch (e) { /* ignore */ }
        
        if (playerData && !playerData.isDirectUrl && Array.isArray(playerData.playlist)) {
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
        
        if (url.startsWith("movie:")) {
            const playerUrl = url.replace("movie:", "");
            const playerData = await this.fetchPlayerJson(playerUrl);
            
            if (playerData.isDirectUrl) {
                streamUrl = playerData.directUrl;
            } else if (Array.isArray(playerData.playlist)) {
                streamUrl = playerData.playlist[0]?.file || "";
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
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        if (!streamUrl) throw new Error("Failed to extract stream URL");

        streamUrl = fixTls(streamUrl);
        
        return {
            type: "hls",
            url: streamUrl,
            headers: {
                "Referer": "https://tortuga.wtf/",
                "User-Agent": UA
            }
        };
    }
}