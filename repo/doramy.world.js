// ==MiruExtension==
// @name         DoramyWorld
// @version      v0.0.2
// @author       CakesTwix
// @lang         uk
// @license      MIT
// @icon         https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSrZAw8JCRhrw1pDMb5_nYDPYQOPVC4T1JDH3PpLB5Bf35ts32ohXNFsRic&s=10
// @package      doramy.world
// @type         bangumi
// @webSite      https://doramy.world
// ==/MiruExtension==

const mainUrl = "https://doramy.world";

// Helper to bypass self-signed TLS issues on Ashdi by falling back to HTTP
function fixAshdiTls(url) {
    if (url && url.includes("ashdi.vip")) {
        return url.replace("https://", "http://");
    }
    return url;
}

export default class extends Extension {
    // Workaround for Miru concatenating base URL with absolute URLs
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

    async latest(page) {
        const res = await this.request(`/dorama/page/${page}/`);
        const items = await this.querySelectorAll(res, "article.type-dorama, article.type-film, article.type-show");
        const results = [];
        for (const item of items) {
            const html = item.content;
            const linkEl = await this.querySelector(html, "h3.post-title a");
            if (!linkEl) continue;
            
            const href = await this.getAttributeText(html, "h3.post-title a", "href");
            if (!href) continue;
            
            const title = (await linkEl.text || "").trim();
            const poster = await this.getAttributeText(html, "img", "src");
            
            results.push({ title, url: href, cover: poster });
        }
        return results;
    }

    async search(kw, page, filter) {
        const res = await this.request(`/?s=${encodeURIComponent(kw)}`);
        const items = await this.querySelectorAll(res, "article.type-dorama, article.type-film, article.type-show");
        const results = [];
        for (const item of items) {
            const html = item.content;
            const linkEl = await this.querySelector(html, "h3.post-title a");
            if (!linkEl) continue;
            
            const href = await this.getAttributeText(html, "h3.post-title a", "href");
            if (!href) continue;
            
            const title = (await linkEl.text || "").trim();
            const poster = await this.getAttributeText(html, "img", "src");
            
            results.push({ title, url: href, cover: poster });
        }
        return results;
    }

    async detail(url) {
        const res = await this.fetch(url);
        
        const titleElement = await this.querySelector(res, "h1.project-title");
        const title = (await titleElement?.text || "").split("/")[0].trim();
        
        const poster = await this.getAttributeText(res, "meta[property=\"og:image\"]", "content");
        
        const descElements = await this.querySelectorAll(res, "div.about-text-holder p");
        let desc = "";
        for (const el of descElements) {
            desc += (await el.text || "").trim() + "\n";
        }
        
        const playerHolder = await this.querySelector(res, ".external-video-player-holder");
        if (!playerHolder) {
            throw new Error("No player holder found on detail page");
        }

        let dataPlayer = await this.getAttributeText(res, ".external-video-player-holder", "data-player");
        if (!dataPlayer) {
            throw new Error("No data-player attribute found");
        }

        // Декодуємо HTML-сутності, якщо вони присутні
        let decoded = dataPlayer
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&#039;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');

        let groups;
        try {
            groups = JSON.parse(decoded);
        } catch (e) {
            throw new Error("Failed to parse player JSON: " + e.message);
        }

        const episodeGroups = [];

        for (const group of groups) {
            const groupTitle = group.label || "Озвучка";
            const urls = [];
            const seasons = group.seasons || [];

            for (let s = 0; s < seasons.length; s++) {
                const season = seasons[s];
                const seasonLabel = season.label ? season.label.trim() : null;
                const episodes = season.episodes || [];

                for (let e = 0; e < episodes.length; e++) {
                    const epUrl = episodes[e];
                    if (!epUrl) continue;

                    let epName = `Епізод ${e + 1}`;
                    // Якщо сезонів більше одного, додаємо номер сезону
                    if (seasons.length > 1) {
                        epName = `Сезон ${s + 1} - ${epName}`;
                    }
                    // Якщо є лейбл сезону, додаємо його
                    if (seasonLabel) {
                        epName = `${seasonLabel} - ${epName}`;
                    }

                    urls.push({
                        name: epName,
                        url: fixAshdiTls(epUrl)
                    });
                }
            }

            if (urls.length > 0) {
                episodeGroups.push({ title: groupTitle, urls });
            }
        }

        if (episodeGroups.length === 0) {
            throw new Error("No episodes found in data-player");
        }

        return {
            title,
            cover: poster,
            desc,
            episodes: episodeGroups
        };
    }

    async watch(url) {
        // Поки що повертає пряме посилання на сторінку плеєра Ashdi.
        // УВАГА: Цей метод потребує оновлення на наступному кроці!
        // Він має зробити запит до `url` (Ashdi), витягнути `.m3u8` через regex 
        // і повернути його, інакше відтворення не працюватиме.
        if (!url) {
            throw new Error("No stream URL provided");
        }
        
        return {
            type: "hls",
            url: url,
            headers: {
                "Referer": "https://ashdi.vip/"
            }
        };
    }
}