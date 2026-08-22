// ==MiruExtension==
// @name         Serialno
// @version      v0.0.12
// @author       CakesTwix
// @lang         uk
// @license      MIT
// @icon         https://www.google.com/s2/favicons?domain=serialno.tv&sz=256
// @package      serialno.tv
// @type         bangumi
// @webSite      https://serialno.tv
// ==/MiruExtension==

const mainUrl = "https://serialno.tv";
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

// --- Crypto Helpers (Without CryptoJS or atob) ---

function bytesToUtf8(bytes) {
    let str = "";
    for (let i = 0; i < bytes.length; i++) {
        let byte1 = bytes[i];
        if (byte1 < 0x80) {
            str += String.fromCharCode(byte1);
        } else if (byte1 < 0xC0) {
            str += String.fromCharCode(byte1);
        } else if (byte1 < 0xE0) {
            let byte2 = bytes[++i];
            str += String.fromCharCode(((byte1 & 0x1F) << 6) | (byte2 & 0x3F));
        } else if (byte1 < 0xF0) {
            let byte2 = bytes[++i];
            let byte3 = bytes[++i];
            str += String.fromCharCode(((byte1 & 0x0F) << 12) | ((byte2 & 0x3F) << 6) | (byte3 & 0x3F));
        } else {
            let byte2 = bytes[++i];
            let byte3 = bytes[++i];
            let byte4 = bytes[++i];
            let codePoint = ((byte1 & 0x07) << 18) | ((byte2 & 0x3F) << 12) | ((byte3 & 0x3F) << 6) | (byte4 & 0x3F);
            codePoint -= 0x10000;
            str += String.fromCharCode(0xD800 + (codePoint >> 10), 0xDC00 + (codePoint & 0x3FF));
        }
    }
    return str;
}

// Pure JS Base64 to Uint8Array (no atob, no CryptoJS)
function base64ToBytes(base64) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let clean = base64.replace(/[^A-Za-z0-9+/]/g, "");
    while (clean.length % 4) clean += "=";
    
    let bytes = [];
    for (let i = 0; i < clean.length; i += 4) {
        let c1 = chars.indexOf(clean[i]);
        let c2 = chars.indexOf(clean[i+1]);
        let c3 = chars.indexOf(clean[i+2]);
        let c4 = chars.indexOf(clean[i+3]);
        
        if (c1 === -1 || c2 === -1) break;
        
        let b1 = (c1 << 2) | (c2 >> 4);
        bytes.push(b1);
        
        if (c3 !== -1 && clean[i+2] !== "=") {
            let b2 = ((c2 & 15) << 4) | (c3 >> 2);
            bytes.push(b2);
        }
        if (c4 !== -1 && clean[i+3] !== "=") {
            let b3 = ((c3 & 3) << 6) | c4;
            bytes.push(b3);
        }
    }
    return new Uint8Array(bytes);
}

function torDecrypt(encoded) {
    if (!encoded) return "";
    try {
        let clean = encoded.replace(/[^A-Za-z0-9+/]/g, '');
        const pad = clean.length % 4;
        if (pad === 1) {
            clean = clean.slice(0, -1);
        } else if (pad > 1) {
            clean += "=".repeat(4 - pad);
        }
        
        const bytes = base64ToBytes(clean);
        if (bytes.length < 2) return "";
        
        const salt = bytes[0];
        const result = new Uint8Array(bytes.length - 1);
        for (let i = 1; i < bytes.length; i++) {
            const key = (salt + 7 * (i - 1) + 13) % 256;
            result[i - 1] = (bytes[i] ^ key) & 0xFF;
        }
        
        return bytesToUtf8(result);
    } catch (e) {
        return "";
    }
}

function tortugaDecode(encoded) {
    const res = torDecrypt(encoded);
    if (res && (res.includes("http") || res.includes(".m3u8"))) return res;
    return null;
}

function decodeBase64(encodedString) {
    if (!encodedString) return null;
    try {
        let clean = encodedString.replace(/=/g, "");
        const pad = clean.length % 4;
        if (pad === 1) {
            clean = clean.slice(0, -1);
        } else if (pad > 1) {
            clean += "=".repeat(4 - pad);
        }
        const bytes = base64ToBytes(clean);
        return bytesToUtf8(bytes);
    } catch (e) {
        return null;
    }
}

function decodeAndReverse(encodedString) {
    const tortuga = tortugaDecode(encodedString);
    if (tortuga && tortuga.startsWith("http")) return tortuga;

    const decrypted = torDecrypt(encodedString);
    if (decrypted.startsWith("http") || decrypted.startsWith("[")) return decrypted;

    const decoded = decodeBase64(encodedString);
    return decoded ? decoded.split('').reverse().join('') : null;
}

function sanitizeJson(str) {
    return str.replace(/[\x00-\x1f\x7f-\x9f]/g, function(c) {
        return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
    });
}

function parseSerialnoEpisodeFile(rawFile) {
    if (!rawFile) return null;
    const raw = rawFile.trim();
    if (!raw) return null;
    
    let source = "Серіально";
    let streamAndSubtitle = raw;
    if (raw.startsWith("{")) {
        const endBracket = raw.indexOf("}");
        if (endBracket !== -1) {
            const srcName = raw.substring(1, endBracket).trim();
            if (srcName) source = srcName;
            streamAndSubtitle = raw.substring(endBracket + 1);
        }
    }
    
    const subtitleMarker = streamAndSubtitle.toLowerCase().indexOf("(subtitle:");
    let streamUrl = streamAndSubtitle;
    let subtitle = null;
    if (subtitleMarker >= 0) {
        streamUrl = streamAndSubtitle.substring(0, subtitleMarker);
        subtitle = streamAndSubtitle.substring(subtitleMarker + "(subtitle:".length).replace(/\)$/, "").trim();
        if (!subtitle) subtitle = null;
    }
    streamUrl = streamUrl.trim();
    if (!streamUrl) return null;
    
    return { source, streamUrl, subtitle };
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
        const res = await this.request(`/series/page/${page}/`);
        const items = await this.querySelectorAll(res, ".th-item");
        const results = [];
        
        for (const item of items) {
            const html = item.content;
            const href = await this.getAttributeText(html, ".th-in", "href");
            if (!href) continue;
            
            const titleEl = await this.querySelector(html, ".th-title");
            const title = (await titleEl?.text || "").trim();
            
            let poster = await this.getAttributeText(html, ".img-fit img", "data-src");
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
        
        const items = await this.querySelectorAll(res, ".th-item");
        const results = [];
        
        for (const item of items) {
            const html = item.content;
            const href = await this.getAttributeText(html, ".th-in", "href");
            if (!href) continue;
            
            const titleEl = await this.querySelector(html, ".th-title");
            const title = (await titleEl?.text || "").trim();
            
            let poster = await this.getAttributeText(html, ".img-fit img", "data-src");
            if (poster && !poster.startsWith("http")) poster = mainUrl + poster;
            
            results.push({ title, url: fixUrl(href), cover: fixUrl(poster) });
        }
        return results;
    }

    async detail(url) {
        const res = await this.fetch(url);
        
        let title = "";
        try {
            const titleEl = await this.querySelector(res, ".full h1");
            title = (await titleEl?.text || "").trim();
        } catch (e) { /* ignore */ }

        let poster = "";
        try {
            poster = await this.getAttributeText(res, ".fposter a", "href");
        } catch (e) { /* ignore */ }

        let desc = "";
        try {
            const descEl = await this.querySelector(res, ".full-text");
            desc = (await descEl?.text || "").trim();
        } catch (e) { /* ignore */ }

        const playerUrl = await this.getAttributeText(res, "div.video-box iframe", "src");
        if (!playerUrl) throw new Error("No player iframe found");

        const safePlayerUrl = fixTls(playerUrl);
        const playerHtml = await this.fetch(safePlayerUrl);
        
        const scripts = await this.querySelectorAll(playerHtml, "script");
        let scriptHtml = "";
        for (const script of scripts) {
            scriptHtml += (await script.text || "") + "\n";
        }
        
        const fileMatch = scriptHtml.match(/file\s*:\s*["']([^"',']+?)["']/);
        if (!fileMatch || !fileMatch[1]) throw new Error("No file: found in player scripts");
        
        const rawFile = fileMatch[1];
        const decodedJson = decodeAndReverse(rawFile);
        
        if (!decodedJson) throw new Error("Failed to decode playlist JSON");

        const sanitizedJson = sanitizeJson(decodedJson);
        
        let playlist;
        try {
            playlist = JSON.parse(sanitizedJson);
        } catch (e) {
            throw new Error("Failed to parse playlist JSON: " + e.message + " | Decoded: " + sanitizedJson.substring(0, 100));
        }

        const episodeGroups = [];
        const dubGroups = {};

        // ВИПРАВЛЕНО: Три рівні вкладеності (Dub -> Season -> Episode)
        for (const dub of playlist) {
            const dubName = dub.title || "Озвучка";
            if (!dubGroups[dubName]) dubGroups[dubName] = [];
            if (!dub.folder) continue;
            
            for (const season of dub.folder) {
                const seasonName = season.title || "Сезон 1";
                if (!season.folder) continue;
                
                for (const ep of season.folder) {
                    if (!ep.file) continue;
                    const parsedFile = parseSerialnoEpisodeFile(ep.file);
                    if (parsedFile) {
                        dubGroups[dubName].push({
                            name: `${seasonName} - ${ep.title}`,
                            url: JSON.stringify({
                                streamUrl: fixTls(parsedFile.streamUrl),
                                subtitle: parsedFile.subtitle
                            })
                        });
                    }
                }
            }
        }

        for (const dubName in dubGroups) {
            if (dubGroups[dubName].length > 0) {
                episodeGroups.push({ title: dubName, urls: dubGroups[dubName] });
            }
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
        if (!url) throw new Error("No stream URL provided");
        
        let streamUrl = "";
        let subtitles = [];
        
        try {
            const data = JSON.parse(url);
            streamUrl = data.streamUrl || "";
            if (data.subtitle) {
                const subRaw = data.subtitle;
                const subName = subRaw.substringAfterLast("[").substringBefore("]");
                const subUrl = subRaw.substringAfter("]");
                if (subUrl) subtitles.push({ title: subName, url: subUrl });
            }
        } catch (e) {
            streamUrl = url; // Fallback, якщо це просто URL
        }

        if (!streamUrl) throw new Error("No stream URL found");

        const isHls = streamUrl.includes(".m3u8");
        
        return {
            type: isHls ? "hls" : "mp4",
            url: streamUrl,
            headers: {
                "Referer": "https://tortuga.wtf/",
                "User-Agent": UA
            },
            subtitles: subtitles
        };
    }
}