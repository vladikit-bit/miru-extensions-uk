// ==MiruExtension==
// @name         BambooUA
// @version      v0.0.2
// @author       CakesTwix
// @lang         uk
// @license      MIT
// @icon         https://www.google.com/s2/favicons?domain=bambooua.com&sz=256
// @package      bambooua
// @type         bangumi
// @webSite      https://bambooua.com
// ==/MiruExtension==

const mainUrl = "https://bambooua.com";

function fixUrl(url) {
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("//")) return "https:" + url;
    if (url.startsWith("/")) return mainUrl + url;
    return mainUrl + "/" + url;
}

export default class extends Extension {
    async fetch(url, options = {}) {
        if (url.startsWith("http://") || url.startsWith("https://")) {
            options.headers = options.headers || {};
            options.headers["Miru-Url"] = url;
            return this.request("", options);
        }
        return this.request(url, options);
    }

    async createFilter(filter) {
        return {};
    }

    async checkUpdate(url) {
        return "";
    }

    async parseItems(html) {
        if (!html || typeof html !== 'string') return [];
        
        const items = await this.querySelectorAll(html, "article.swiper-slide");
        const results = [];
        
        for (const item of items) {
            // У Alpha V1 item може бути рядком або об'єктом
            const itemHtml = item.content || item || "";
            if (!itemHtml) continue;
            
            const href = await this.getAttributeText(itemHtml, "a.link-title", "href");
            if (!href) continue;
            
            let title = "";
            try {
                const titleEl = await this.querySelector(itemHtml, "h2.label-3");
                title = (await titleEl?.text || "").trim();
            } catch (e) { /* ignore */ }
            
            const poster = await this.getAttributeText(itemHtml, "div.poster img", "src");
            
            results.push({ 
                title: title || "Без назви", 
                url: fixUrl(href), 
                cover: fixUrl(poster) 
            });
        }
        return results;
    }

    async latest(page) {
        // Використовуємо секцію "Фільми" як основну
        const res = await this.request(`/filmy/page/${page}/`);
        return await this.parseItems(res);
    }

    async search(kw, page, filter) {
        const res = await this.request(`/index.php?do=search&subaction=search&story=${encodeURIComponent(kw)}`);
        return await this.parseItems(res);
    }

    async detail(url) {
        const res = await this.fetch(url);
        
        let title = "";
        try {
            const titleEl = await this.querySelector(res, "h1.label-3");
            title = (await titleEl?.text || "").trim();
        } catch (e) { /* ignore */ }

        let poster = "";
        try {
            poster = await this.getAttributeText(res, "div.poster img", "src");
        } catch (e) { /* ignore */ }

        let desc = "";
        try {
            const descEl = await this.querySelector(res, "div.full-text");
            desc = (await descEl?.text || "").trim();
        } catch (e) { /* ignore */ }
        
        // Extract inline playlist
        const startMarker = "const playlist = ";
        const startIdx = res.indexOf(startMarker);
        
        if (startIdx === -1) {
            throw new Error("Playlist marker not found");
        }
        
        const endMarker = "const player";
        const endIdx = res.indexOf(endMarker, startIdx);
        
        if (endIdx === -1) {
            throw new Error("Playlist end marker not found");
        }
        
        let jsonStr = res.substring(startIdx + startMarker.length, endIdx).trim().replace(/;$/, "");
        
        let playlist;
        try {
            playlist = JSON.parse(jsonStr);
        } catch (e) {
            throw new Error("Failed to parse playlist JSON: " + e.message);
        }

        if (!Array.isArray(playlist)) {
            throw new Error("Playlist is not an array");
        }

        const isMovie = url.includes("/film/") || url.includes("/movies/");
        const episodeGroups = [];

        if (isMovie) {
            const streamUrl = playlist[0]?.file || "";
            episodeGroups.push({
                title: "Фільм",
                urls: [{ name: title, url: fixUrl(streamUrl) }]
            });
        } else {
            const episodes = [];
            playlist.forEach((item, index) => {
                if (item.file) {
                    episodes.push({
                        name: item.title || `Епізод ${index + 1}`,
                        url: fixUrl(item.file)
                    });
                }
            });
            
            if (episodes.length === 0) {
                throw new Error("No playable episodes found");
            }
            
            episodeGroups.push({
                title: "Епізоди",
                urls: episodes
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
        if (!url) {
            throw new Error("No stream URL provided");
        }
        
        return {
            type: "hls",
            url: url,
            headers: {
                "Referer": mainUrl + "/"
            }
        };
    }
}