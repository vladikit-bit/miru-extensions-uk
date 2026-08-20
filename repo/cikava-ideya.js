// ==MiruExtension==
// @name         Цікава Ідея
// @version      v0.0.4
// @author       CakesTwix
// @lang         uk
// @license      GPL3
// @icon         https://www.google.com/s2/favicons?domain=cikava-ideya.top&sz=256
// @package      cikava-ideya
// @type         bangumi
// @webSite      https://cikava-ideya.top
// ==/MiruExtension==

const mainUrl = "https://cikava-ideya.top";

function fixUrl(url) {
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("//")) return "https:" + url;
    if (url.startsWith("/")) return mainUrl + url;
    return mainUrl + "/" + url;
}

// Helper to fix unquoted keys in DLE JSON-like strings
// Оновлений регекс для підтримки кирилиці та пробілів у ключах (напр., "1 сезон", "1 серія")
function fixDleJson(jsonStr) {
    return jsonStr.replace(/([{,]\s*)([^"'\s][^:,}]*?)(\s*:)/g, '$1"$2"$3');
}

// Helper to bypass self-signed TLS issues on Ashdi by falling back to HTTP
function fixAshdiTls(url) {
    if (url && url.includes("ashdi.vip")) {
        return url.replace("https://", "http://");
    }
    return url;
}

function isCikavaDeleted(text) {
    if (!text) return false;
    return text.includes("ВИДАЛЕНО") ||
           text.includes("Озвучення ставимо на пауз") ||
           text.includes("Видалено на прохання правовласника");
}

function parseCikavaPlayerJson(html) {
    const scriptTags = html.match(/<script[\s\S]*?<\/script>/g) || [];
    const targetScript = scriptTags.find(s => s.includes("switches = Object"));
    if (!targetScript) return {};
    const start = targetScript.indexOf("Object(") + "Object(".length;
    const end = targetScript.lastIndexOf(");");
    if (start < "Object(".length || end <= start) return {};
    let jsonStr = targetScript.substring(start, end);
    
    try {
        // Apply fix for unquoted keys before parsing
        const fixedJsonStr = fixDleJson(jsonStr);
        return JSON.parse(fixedJsonStr);
    } catch (e) {
        console.log("JSON Parse Error:", e.message);
        return {};
    }
}

function hasCikavaValue(obj) {
    if (typeof obj === 'string') return obj.trim() !== '';
    if (Array.isArray(obj)) return obj.some(hasCikavaValue);
    if (obj && typeof obj === 'object') return Object.values(obj).some(hasCikavaValue);
    return false;
}

function hasCikavaPlayableMaterial(playerJson) {
    return playerJson && playerJson.Player1 && hasCikavaValue(playerJson.Player1);
}

function parseCikavaPlayerData(scriptHtml) {
    const fileRegex = /file\s*:\s*['"]([^'"]+)['"]/;
    const subtitleRegex = /subtitle\s*:\s*['"]([^'"]*)['"]/;
    const streamUrl = scriptHtml.match(fileRegex)?.[1]?.trim() || "";
    const subtitleRaw = scriptHtml.match(subtitleRegex)?.[1];
    let subtitle = null;
    if (subtitleRaw) {
        const value = subtitleRaw.trim();
        if (value.startsWith("[")) {
            const endIndex = value.indexOf(']');
            if (endIndex > 1) {
                const language = value.substring(1, endIndex).trim();
                let url = value.substring(endIndex + 1).trim().trimEnd(',');
                if (url.startsWith("//")) url = "https:" + url;
                if (language && (url.startsWith("http://") || url.startsWith("https://"))) {
                    subtitle = { language, url };
                }
            }
        }
    }
    return { streamUrl, subtitle };
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

    async latest(page) {
    const res = await this.request(`/filmy/page/${page}`);
    const items = await this.querySelectorAll(res, ".th-item");
    const results = [];

    for (const item of items) {
        const html = item.content;

        const titleEl = await this.querySelector(html, ".th-title");
        const title = titleEl ? ((await titleEl.text) || "").trim() : "";

        const href = await this.getAttributeText(html, ".th-in", "href");
        const posterUrl = await this.getAttributeText(html, ".img-fit img", "src");

        if (!href) continue;

        results.push({
            title,
            url: fixUrl(href),
            cover: fixUrl(posterUrl)
        });
    }

    return results;
}

    async search(kw, page, filter) {
        const res = await this.request("", {
            method: "POST",
            data: {
                do: "search",
                subaction: "search",
                story: kw
            }
        });
        const items = await this.querySelectorAll(res, ".th-item");
        const results = [];
        for (const item of items) {
            const html = item.content;
            const qualityText = await this.querySelector(html, ".fquality").text;
            if (isCikavaDeleted(qualityText)) continue;
            const title = (await this.querySelector(html, ".th-title").text || "").trim();
            const href = await this.getAttributeText(html, ".th-in", "href");
            const posterUrl = await this.getAttributeText(html, ".img-fit img", "src");
            results.push({ title, url: fixUrl(href), cover: fixUrl(posterUrl) });
        }
        return results;
    }

    async detail(url) {
        const res = await this.fetch(url);
        const playerJson = parseCikavaPlayerJson(res);
        if (!hasCikavaPlayableMaterial(playerJson)) {
            throw new Error("No playable material found for: " + url);
        }

        const title = (await this.querySelector(res, ".full h1").text || "").trim();
        const poster = await this.getAttributeText(res, ".img-fit img", "src");
        const desc = (await this.querySelector(res, ".fdesc").text || "").trim();
        
        const player1 = playerJson.Player1;
        
        if (typeof player1 === 'string') {
            return {
                title,
                cover: fixUrl(poster),
                desc,
                episodes: [{ title: "Фільм", urls: [{ name: "Фільм", url: fixUrl(player1) }] }]
            };
        } else if (typeof player1 === 'object' && player1 !== null) {
            const episodes = [];
            for (const seasonKey in player1) {
                const seasonObj = player1[seasonKey];
                const seasonEpisodes = [];
                for (const episodeKey in seasonObj) {
                    if (Object.prototype.hasOwnProperty.call(seasonObj, episodeKey)) {
                        seasonEpisodes.push({
                            name: episodeKey,
                            url: fixUrl(seasonObj[episodeKey])
                        });
                    }
                }
                episodes.push({
                    title: seasonKey,
                    urls: seasonEpisodes
                });
            }
            return {
                title,
                cover: fixUrl(poster),
                desc,
                episodes: episodes
            };
        } else {
            throw new Error("Unknown player format for: " + url);
        }
    }

    async watch(url) {
        const playerPageHeaders = {
            "Referer": "https://cikava-ideya.top/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        };

        // Застосовуємо HTTP fallback для Ashdi перед запитом
        const safeFetchUrl = fixAshdiTls(url);
        const res = await this.fetch(safeFetchUrl, { headers: playerPageHeaders });
        
        const playerData = parseCikavaPlayerData(res);
        if (!playerData.streamUrl) {
            throw new Error("No stream URL found on player page: " + safeFetchUrl);
        }
        
        const subtitles = [];
        if (playerData.subtitle) {
            subtitles.push({
                title: playerData.subtitle.language,
                url: fixUrl(playerData.subtitle.url)
            });
        }

        let playReferer = "https://tortuga.wtf/";
        try {
            const playUrlObj = new URL(fixUrl(playerData.streamUrl));
            playReferer = `${playUrlObj.protocol}//${playUrlObj.host}/`;
        } catch (e) {
            console.log("Failed to parse Referer from stream URL, using default tortuga.wtf");
        }

        // Застосовуємо HTTP fallback також до фінального m3u8 URL
        const safeStreamUrl = fixAshdiTls(fixUrl(playerData.streamUrl));

        return {
            type: "hls",
            url: safeStreamUrl,
            headers: {
                "Referer": playReferer,
                "User-Agent": playerPageHeaders["User-Agent"]
            },
            subtitles: subtitles
        };
    }
}