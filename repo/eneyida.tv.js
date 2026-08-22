// ==MiruExtension==
// @name         Eneyida
// @version      v0.0.1
// @author       CakesTwix
// @lang         uk
// @license      MIT
// @icon         https://www.google.com/s2/favicons?domain=eneyida.tv&sz=256
// @package      eneyida.tv
// @type         bangumi
// @webSite      https://eneyida.tv
// ==/MiruExtension==

const mainUrl = "https://eneyida.tv";
const UA = "Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.215 Mobile Safari/537.36";

function fixUrl(url) {
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("//")) return "https:" + url;
    if (url.startsWith("/")) return mainUrl + url;
    return mainUrl + "/" + url;
}

function fixTls(url) {
    if (url && url.includes("tortuga.wtf") && url.startsWith("https://")) {
        return url.replace("https://", "http://");
    }
    return url;
}

// Кастомний парсер для витягу file: з JS-коду плеєра
function extractEneyidaFileValue(scriptHtml) {
    const match = scriptHtml.match(/file\s*:\s*(['"])/);
    if (!match) return "";
    const quote = match[1];
    const start = match.index + match[0].length;
    let i = start;
    let sb = "";
    while (i < scriptHtml.length) {
        const c = scriptHtml[i];
        if (c === '\\' && i + 1 < scriptHtml.length) {
            sb += scriptHtml[i + 1];
            i += 2;
            continue;
        }
        if (c === quote) break;
        sb += c;
        i++;
    }
    return sb;
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
        const res = await this.request(`/films/page/${page}/`);
        const items = await this.querySelectorAll(res, "article.short");
        const results = [];
        
        for (const item of items) {
            const html = item.content;
            const href = await this.getAttributeText(html, "a.short_title", "href");
            if (!href) continue;
            
            const titleEl = await this.querySelector(html, "a.short_title");
            const title = (await titleEl?.text || "").trim();
            
            let poster = await this.getAttributeText(html, "a.short_img img", "data-src");
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
        
        const items = await this.querySelectorAll(res, "article.short");
        const results = [];
        
        for (const item of items) {
            const html = item.content;
            const href = await this.getAttributeText(html, "a.short_title", "href");
            if (!href) continue;
            
            const titleEl = await this.querySelector(html, "a.short_title");
            const title = (await titleEl?.text || "").trim();
            
            let poster = await this.getAttributeText(html, "a.short_img img", "data-src");
            if (poster && !poster.startsWith("http")) poster = mainUrl + poster;
            
            results.push({ title, url: fixUrl(href), cover: fixUrl(poster) });
        }
        return results;
    }

    async detail(url) {
        const res = await this.fetch(url);
        
        let title = "";
        try {
            const titleEl = await this.querySelector(res, "div.full_header-title h1");
            title = (await titleEl?.text || "").trim();
        } catch (e) { /* ignore */ }

        let poster = "";
        try {
            poster = await this.getAttributeText(res, ".full_content-poster img", "src");
            if (poster && !poster.startsWith("http")) poster = mainUrl + poster;
        } catch (e) { /* ignore */ }

        let desc = "";
        try {
            const descEl = await this.querySelector(res, ".full_content-desc p");
            desc = (await descEl?.text || "").trim();
        } catch (e) { /* ignore */ }

        const playerUrl = await this.getAttributeText(res, ".tabs_b.visible iframe", "src");
        if (!playerUrl) throw new Error("No player iframe found");

        const safePlayerUrl = fixTls(playerUrl);
        const playerHtml = await this.fetch(safePlayerUrl);
        
        const scripts = await this.querySelectorAll(playerHtml, "script");
        let scriptHtml = "";
        for (const script of scripts) {
            scriptHtml += (await script.text || "") + "\n";
        }
        
        const playerRawJson = extractEneyidaFileValue(scriptHtml);
        let parsedJson = null;
        try {
            parsedJson = JSON.parse(playerRawJson);
        } catch (e) { /* ignore */ }

        const episodeGroups = [];
        const episodes = [];
        
        // Визначаємо тип контенту та будуємо епізоди
        if (Array.isArray(parsedJson)) {
            const firstItem = parsedJson[0];
            const isSeasonFirst = firstItem?.title?.toLowerCase().includes("сезон");
            
            if (isSeasonFirst) {
                // Формат А: Сезон -> Озвучка -> Серія
                for (const season of parsedJson) {
                    const seasonTitle = season.title || "Сезон 1";
                    if (!season.folder) continue;
                    
                    for (const dub of season.folder) {
                        if (!dub.folder) continue;
                        for (const ep of dub.folder) {
                            if (ep.file) {
                                episodes.push({
                                    name: `${seasonTitle} - ${ep.title}`,
                                    url: JSON.stringify({
                                        seasonTitle: seasonTitle,
                                        episodeTitle: ep.title,
                                        playerUrl: safePlayerUrl
                                    })
                                });
                            }
                        }
                    }
                }
            } else {
                // Формат Б: Озвучка -> Сезон -> Серія
                for (const dub of parsedJson) {
                    if (!dub.folder) continue;
                    for (const season of dub.folder) {
                        const seasonTitle = season.title || "Сезон 1";
                        if (!season.folder) continue;
                        for (const ep of season.folder) {
                            if (ep.file) {
                                episodes.push({
                                    name: `${seasonTitle} - ${ep.title}`,
                                    url: JSON.stringify({
                                        seasonTitle: seasonTitle,
                                        episodeTitle: ep.title,
                                        playerUrl: safePlayerUrl
                                    })
                                });
                            }
                        }
                    }
                }
            }
        }
        
        if (episodes.length === 0) {
            // Фільм: передаємо playerUrl напряму
            episodeGroups.push({
                title: "Фільм",
                urls: [{ name: title || "Дивитися", url: JSON.stringify({ playerUrl: safePlayerUrl }) }]
            });
        } else {
            episodeGroups.push({ title: "Серії", urls: episodes });
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
        
        let data;
        try {
            data = JSON.parse(url);
        } catch (e) {
            throw new Error("Invalid watch state");
        }

        const playerHtml = await this.fetch(data.playerUrl);
        const scripts = await this.querySelectorAll(playerHtml, "script");
        let scriptHtml = "";
        for (const script of scripts) {
            scriptHtml += (await script.text || "") + "\n";
        }
        
        const playerRawJson = extractEneyidaFileValue(scriptHtml);
        let parsedJson = null;
        try {
            parsedJson = JSON.parse(playerRawJson);
        } catch (e) { /* ignore */ }

        let streamUrl = "";
        
        if (data.seasonTitle && data.episodeTitle) {
            // Серіал
            if (Array.isArray(parsedJson)) {
                const isSeasonFirst = parsedJson[0]?.title?.toLowerCase().includes("сезон");
                
                if (isSeasonFirst) {
                    for (const season of parsedJson) {
                        if (season.title === data.seasonTitle && season.folder) {
                            for (const dub of season.folder) {
                                if (dub.folder) {
                                    for (const ep of dub.folder) {
                                        if (ep.title === data.episodeTitle && ep.file) {
                                            streamUrl = ep.file;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                } else {
                    for (const dub of parsedJson) {
                        if (dub.folder) {
                            for (const season of dub.folder) {
                                if (season.title === data.seasonTitle && season.folder) {
                                    for (const ep of season.folder) {
                                        if (ep.title === data.episodeTitle && ep.file) {
                                            streamUrl = ep.file;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } else {
            // Фільм
            if (Array.isArray(parsedJson)) {
                // Масив озвучок
                streamUrl = parsedJson[0]?.file || "";
            } else {
                // Пряме посилання
                streamUrl = playerRawJson;
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