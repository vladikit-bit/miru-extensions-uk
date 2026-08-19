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

// Helper to attempt HTTP fallback for hosts with bad TLS certs
async function fetchWithTlsFallback(extensionInstance, url, options = {}) {
    try {
        return await extensionInstance.fetch(url, options);
    } catch (e) {
        if (String(e).includes("CERTIFICATE_VERIFY_FAILED") && url.startsWith("https://")) {
            console.log("TLS Error detected, retrying with HTTP for:", url);
            const httpUrl = url.replace("https://", "http://");
            return extensionInstance.fetch(httpUrl, options);
        }
        throw e;
    }
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
            const qualityText = await this.querySelector(html, ".fquality").text;
            if (isCikavaDeleted(qualityText)) continue;
            const title = (await this.querySelector(html, ".th-title").text || "").trim();
            const href = await this.getAttributeText(html, ".th-in", "href");
            const posterUrl = await this.getAttributeText(html, ".img-fit img", "src");
            results.push({ title, url: fixUrl(href), cover: fixUrl(posterUrl) });
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

        let diagnostic = [];
        diagnostic.push("HTML_LENGTH=" + res.length);
        diagnostic.push("HAS_SWITCHES=" + res.includes("switches"));

        const scriptTags = res.match(/<script[\s\S]*?<\/script>/g) || [];
        diagnostic.push("SCRIPT_COUNT=" + scriptTags.length);

        const targetScript = scriptTags.find(s => s.includes("switches = Object"));
        diagnostic.push("TARGET_FOUND=" + !!targetScript);

        if (targetScript) {
            // Додатково виводимо початок самого targetScript, щоб бачити контекст
            diagnostic.push("TARGET_SCRIPT_START=" + targetScript.substring(0, 500));

            const start = targetScript.indexOf("Object(") + "Object(".length;
            const end = targetScript.lastIndexOf(");");

            diagnostic.push("START=" + start);
            diagnostic.push("END=" + end);

            if (start > "Object(".length && end > start) {
                const raw = targetScript.substring(start, end);
                diagnostic.push("RAW=" + raw.substring(0, 1500));

                const fixed = fixDleJson(raw);
                diagnostic.push("FIXED=" + fixed.substring(0, 1500));

                try {
                    const parsed = JSON.parse(fixed);
                    diagnostic.push("PARSE=OK");
                    diagnostic.push("TOP_KEYS=" + Object.keys(parsed).join("|"));
                    diagnostic.push("PLAYER1_TYPE=" + typeof parsed.Player1);
                    diagnostic.push("PLAYER1=" + JSON.stringify(parsed.Player1).substring(0, 1000));
                } catch (e) {
                    diagnostic.push("PARSE_ERROR=" + String(e));
                }
            } else {
                diagnostic.push("BOUNDARY_ERROR=Could not find Object(...); correctly");
            }
        } else {
            // Якщо switches немає, шукаємо інші ознаки плеєра
            const altScripts = scriptTags.filter(s => s.includes("Player") || s.includes("tortuga") || s.includes("file:"));
            diagnostic.push("ALT_SCRIPT_COUNT=" + altScripts.length);
            if (altScripts.length > 0) {
                diagnostic.push("ALT_SCRIPT_SAMPLE=" + altScripts[0].substring(0, 500));
            }
            diagnostic.push("HAS_404=" + res.includes("404") || res.includes("not found"));
            diagnostic.push("HAS_CLOUDFLARE=" + res.includes("cf-browser-verification") || res.includes("cloudflare"));
        }

        throw new Error(
            "CIKAVA_DIAGNOSTIC\n" +
            diagnostic.join("\n")
        );
    }
    async watch(url) {
        const playerPageHeaders = {
            "Referer": "https://cikava-ideya.top/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        };

        // Use TLS fallback for problematic hosts like ashdi.vip
        const res = await fetchWithTlsFallback(this, url, { headers: playerPageHeaders });
        
        const playerData = parseCikavaPlayerData(res);
        if (!playerData.streamUrl) {
            throw new Error("No stream URL found on player page: " + url);
        }
        
        const subtitles = [];
        if (playerData.subtitle) {
            subtitles.push({
                title: playerData.subtitle.language,
                url: fixUrl(playerData.subtitle.url)
            });
        }

        // Determine Referer for playback
        // If it's Ashdi, Anitubeinua uses "https://qeruya.cyou", Cikava uses "https://tortuga.wtf/"
        // We extract the host from the stream URL to be safe, fallback to tortuga.wtf
        let playReferer = "https://tortuga.wtf/";
        try {
            const playUrlObj = new URL(fixUrl(playerData.streamUrl));
            playReferer = `${playUrlObj.protocol}//${playUrlObj.host}/`;
        } catch (e) {
            console.log("Failed to parse Referer from stream URL, using default tortuga.wtf");
        }

        return {
            type: "hls",
            url: fixUrl(playerData.streamUrl),
            headers: {
                "Referer": playReferer,
                "User-Agent": playerPageHeaders["User-Agent"]
            },
            subtitles: subtitles
        };
    }
}