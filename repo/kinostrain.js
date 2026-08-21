// ==MiruExtension==
// @name         Kinostrain
// @version      v0.0.9
// @author       CakesTwix
// @lang         uk
// @license      MIT
// @icon         https://www.google.com/s2/favicons?domain=kinostrain.com&sz=256
// @package      kinostrain
// @type         bangumi
// @webSite      https://kinostrain.com
// ==/MiruExtension==

const mainUrl = "https://kinostrain.com";
const apiUrl = "https://api.kinostrain.com";

function fixUrl(url) {
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("//")) return "https:" + url;
    if (url.startsWith("/")) return mainUrl + url;
    return mainUrl + "/" + url;
}

function fixAshdiTls(url) {
    if (url && url.includes("ashdi.vip")) {
        return url.replace("https://", "http://");
    }
    return url;
}

class NuxtResolver {
    constructor(array) {
        this.array = array;
    }
    get(index) {
        if (index < 0 || index >= this.array.length) return null;
        return this.array[index];
    }
    getObject(index) {
        const val = this.get(index);
        return (val && typeof val === 'object' && !Array.isArray(val)) ? val : null;
    }
    resolve(obj, key) {
        if (!obj || typeof obj !== 'object') return null;
        const val = obj[key];
        if (val === undefined) return null;
        return typeof val === 'number' ? this.get(val) : val;
    }
    resolveString(obj, key) {
        const res = this.resolve(obj, key);
        return res ? String(res) : null;
    }
    resolveInt(obj, key) {
        const res = this.resolve(obj, key);
        if (res === null || res === undefined) return null;
        const num = parseInt(res, 10);
        return isNaN(num) ? null : num;
    }
    resolveObject(obj, key) {
        const res = this.resolve(obj, key);
        return (res && typeof res === 'object' && !Array.isArray(res)) ? res : null;
    }
    resolveArray(obj, key) {
        let res = this.resolve(obj, key);
        if (res === null || res === undefined) return null;
        if (Array.isArray(res)) return res;
        if (typeof res === 'object') return Object.values(res);
        return [res];
    }
}

export default class extends Extension {
    async fetch(url, options = {}) {
        options.headers = options.headers || {};
        if (url.startsWith("http://") || url.startsWith("https://")) {
            options.headers["Miru-Url"] = url;
            return this.request("", options);
        }
        return this.request(url, options);
    }

    async createFilter(filter) { return {}; }
    async checkUpdate(url) { return ""; }

    async latest(page) {
        const res = await this.request(`/movies?page=${page}`);
        const items = await this.querySelectorAll(res, "div.grid > article");
        const results = [];
        
        for (const item of items) {
            const html = typeof item === 'string' ? item : (item.content || "");
            if (!html) continue;
            
            const href = await this.getAttributeText(html, "a", "href");
            if (!href) continue;
            
            let title = "Без назви";
            try {
                const aEl = await this.querySelector(html, "a");
                if (aEl) {
                    const text = await aEl.text;
                    if (text && text.trim()) title = text.trim();
                }
            } catch (e) { /* ignore */ }
            
            if (title === "Без назви") {
                const alt = await this.getAttributeText(html, "img", "alt");
                if (alt) title = alt;
            }
            
            const poster = await this.getAttributeText(html, "img", "src");
            
            results.push({ title, url: fixUrl(href), cover: fixUrl(poster) });
        }
        return results;
    }

    async search(kw, page, filter) {
        const res = await this.fetch(`/api/search?q=${encodeURIComponent(kw)}&limit=10`);
        const data = typeof res === 'string' ? JSON.parse(res) : res;
        
        if (!data || !data.data) return [];
        
        const results = [];
        for (const item of data.data) {
            const title = item.name;
            let url = "";
            if (item.type === "movie") {
                url = `${mainUrl}/movie-${item.slug}`;
            } else {
                const seasonNum = item.firstReadySeason?.number || 1;
                url = `${mainUrl}/${item.slug}/season-${seasonNum}`;
            }
            results.push({ title, url: url, cover: item.posterUrl ? fixUrl(item.posterUrl) : "" });
        }
        return results;
    }

    // Універсальний парсер, що обробляє і серіали, і фільми
    async parseNuxtEpisodes(documentHtml) {
        let scriptText = "";
        try {
            const scriptEl = await this.querySelector(documentHtml, "script#__NUXT_DATA__");
            scriptText = await scriptEl?.text;
        } catch (e) { /* ignore */ }
        
        if (!scriptText) {
            const scriptMatch = documentHtml.match(/<script[^>]*id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/);
            if (scriptMatch && scriptMatch[1]) {
                scriptText = scriptMatch[1];
            }
        }

        if (!scriptText) return [];

        let jsonArray;
        try {
            jsonArray = JSON.parse(scriptText);
        } catch (e) {
            return [];
        }

        const resolver = new NuxtResolver(jsonArray);

        let contentIndex = -1;
        for (let i = 0; i < jsonArray.length; i++) {
            const item = jsonArray[i];
            if (item && typeof item === 'object' && !Array.isArray(item)) {
                for (const key in item) {
                    if (key.startsWith("content-")) {
                        contentIndex = item[key];
                        break;
                    }
                }
            }
            if (contentIndex !== -1) break;
        }

        if (contentIndex === -1) return [];

        let content = resolver.getObject(contentIndex);
        if (!content) return [];
        
        const wrappedContent = resolver.resolveObject(content, "data");
        if (wrappedContent) content = wrappedContent;

        const seasonsArray = resolver.resolveArray(content, "seasons");
        if (!seasonsArray) return [];

        const allEpisodes = [];

        for (let i = 0; i < seasonsArray.length; i++) {
            const seasonIdx = seasonsArray[i];
            const seasonObj = resolver.getObject(seasonIdx);
            if (!seasonObj) continue;

            const seasonNumber = resolver.resolveInt(seasonObj, "number") || (i + 1);
            const playerData = resolver.resolveObject(seasonObj, "playerData");
            if (!playerData) continue;

            const episodesArray = resolver.resolveArray(seasonObj, "episodes");
            
            if (episodesArray && episodesArray.length > 0) {
                // ЛОГІКА ДЛЯ СЕРІАЛІВ
                for (let j = 0; j < episodesArray.length; j++) {
                    const epIdx = episodesArray[j];
                    const epObj = resolver.getObject(epIdx);
                    if (!epObj) continue;
                    
                    const epNumber = resolver.resolveInt(epObj, "number") || (j + 1);
                    const epName = resolver.resolveString(epObj, "name") || `Серія ${epNumber}`;

                    const epPlayerData = resolver.resolveObject(playerData, epNumber.toString());
                    if (epPlayerData) {
                        const episodeSources = [];
                        for (const pKey in epPlayerData) {
                            const sourcesArray = resolver.resolveArray(epPlayerData, pKey);
                            if (sourcesArray) {
                                for (let k = 0; k < sourcesArray.length; k++) {
                                    const srcIdx = sourcesArray[k];
                                    const srcObj = resolver.getObject(srcIdx);
                                    if (srcObj) {
                                        const name = resolver.resolveString(srcObj, "name") || pKey;
                                        const link = resolver.resolveString(srcObj, "link");
                                        if (link) episodeSources.push({ name, link });
                                    }
                                }
                            }
                        }

                        if (episodeSources.length > 0) {
                            allEpisodes.push({
                                name: `${epName} (Сезон ${seasonNumber})`,
                                url: JSON.stringify(episodeSources)
                            });
                        }
                    }
                }
            } else {
                // ЛОГІКА ДЛЯ ФІЛЬМІВ (або серіалів без масиву episodes)
                // У Kotlin: val epPlayerData = resolver.resolveObject(playerData, "1") ?: playerData
                const epPlayerData = resolver.resolveObject(playerData, "1") || playerData;
                const episodeSources = [];
                
                for (const pKey in epPlayerData) {
                    const sourcesArray = resolver.resolveArray(epPlayerData, pKey);
                    if (sourcesArray) {
                        for (let k = 0; k < sourcesArray.length; k++) {
                            const srcIdx = sourcesArray[k];
                            const srcObj = resolver.getObject(srcIdx);
                            if (srcObj) {
                                const name = resolver.resolveString(srcObj, "name") || pKey;
                                const link = resolver.resolveString(srcObj, "link");
                                if (link) episodeSources.push({ name, link });
                            }
                        }
                    }
                }
                
                if (episodeSources.length > 0) {
                    allEpisodes.push({
                        name: `Фільм (Сезон ${seasonNumber})`,
                        url: JSON.stringify(episodeSources)
                    });
                }
            }
        }

        return allEpisodes;
    }

    async detail(url) {
        const res = await this.fetch(url);
        
        let jsonLd = {};
        const jsonLdMatch = res.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
        if (jsonLdMatch && jsonLdMatch[1]) {
            try {
                jsonLd = JSON.parse(jsonLdMatch[1].trim());
            } catch (e) { /* ignore */ }
        }
        
        const title = jsonLd.name || "Без назви";
        const poster = jsonLd.image ? fixUrl(jsonLd.image) : "";
        const desc = jsonLd.description || "";
        
        // Спочатку шукаємо посилання на сезони
        const seasonLinks = await this.querySelectorAll(res, "div.seasons-grid a.season-item");
        let episodes = [];
        
        if (seasonLinks.length > 0) {
            for (const link of seasonLinks) {
                const linkHtml = typeof link === 'string' ? link : (link.content || "");
                const seasonUrl = fixUrl(await this.getAttributeText(linkHtml, "a", "href"));
                if (!seasonUrl) continue;
                
                const seasonRes = await this.fetch(seasonUrl);
                episodes.push(...await this.parseNuxtEpisodes(seasonRes));
            }
        } else {
            // Якщо це фільм або 1 сезон
            episodes = await this.parseNuxtEpisodes(res);
        }
        
        if (episodes.length === 0) {
            throw new Error("No episodes found");
        }

        return {
            title,
            cover: poster,
            desc,
            episodes: [{ title: "Серії", urls: episodes }]
        };
    }

    async watch(url) {
        if (!url) throw new Error("No stream URL provided");
        
        let sources = [];
        try {
            sources = JSON.parse(url);
        } catch (e) {
            throw new Error("Invalid sources format");
        }

        for (const source of sources) {
            if (source.link.includes("ashdi.vip")) {
                const safeUrl = fixAshdiTls(source.link);
                const playerHtml = await this.fetch(safeUrl);
                const fileMatch = playerHtml.match(/file\s*:\s*["']([^"']+)["']/);
                
                if (fileMatch && fileMatch[1]) {
                    let streamUrl = fixAshdiTls(fileMatch[1]);
                    return {
                        type: "hls",
                        url: streamUrl,
                        headers: { "Referer": safeUrl }
                    };
                }
            } else if (source.link.includes(".m3u8")) {
                return {
                    type: "hls",
                    url: source.link,
                    headers: { "Referer": mainUrl }
                };
            } else if (source.link) {
                return {
                    type: "mp4",
                    url: source.link,
                    headers: { "Referer": mainUrl }
                };
            }
        }
        throw new Error("Failed to extract stream URL");
    }
}