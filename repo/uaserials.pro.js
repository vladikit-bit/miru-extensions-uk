// ==MiruExtension==
// @name         UASerialsPro
// @version      v0.0.1
// @author       CakesTwix
// @lang         uk
// @license      MIT
// @icon         https://www.google.com/s2/favicons?domain=uaserials.pro&sz=256
// @package      uaserials.pro
// @type         bangumi
// @webSite      https://uaserials.com
// ==/MiruExtension==

const mainUrl = "https://uaserials.com";
const UA = "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0";
const AES_PASSWORD = "297796CCB81D255125"; // Знайдено в md-інструкції

function fixUrl(url) {
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("//")) return "https:" + url;
    if (url.startsWith("/")) return mainUrl + url;
    return mainUrl + "/" + url;
}

// HTTP fallback для проблемних TLS сертифікатів (tortuga.tw, ashdi.vip)
function fixTls(url) {
    if (!url) return "";
    if ((url.includes("tortuga.tw") || url.includes("ashdi.vip")) && url.startsWith("https://")) {
        return url.replace("https://", "http://");
    }
    return url;
}

// --- Crypto Helpers ---

function bytesToUint8Array(wordArray) {
    const words = wordArray.words;
    const sigBytes = wordArray.sigBytes;
    const u8 = new Uint8Array(sigBytes);
    for (let i = 0; i < sigBytes; i++) {
        const byte = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
        u8[i] = byte;
    }
    return u8;
}

// Tortuga XOR Decoder
function decodeTortuga(encoded) {
    if (!encoded) return null;
    try {
        let clean = encoded.trim().replace(/=+$/, "");
        const padLen = (4 - clean.length % 4) % 4;
        clean += "=".repeat(padLen);
        
        const decoded = CryptoJS.enc.Base64.parse(clean);
        const bytes = bytesToUint8Array(decoded);
        if (bytes.length < 2) return null;
        
        const salt = bytes[0];
        let result = "";
        for (let i = 1; i < bytes.length; i++) {
            const key = (salt + 7 * (i - 1) + 13) % 256;
            result += String.fromCharCode((bytes[i] ^ key) & 0xFF);
        }
        return result.startsWith("http") || result.includes(".m3u8") ? result : null;
    } catch (e) {
        return null;
    }
}

// AES-256-CBC Decryptor (PBKDF2-SHA512)
function decryptAES(encryptedData, pass) {
    try {
        const salt = CryptoJS.enc.Hex.parse(encryptedData.salt);
        const iv = CryptoJS.enc.Hex.parse(encryptedData.iv);
        const ct = CryptoJS.enc.Base64.parse(encryptedData.ciphertext);
        
        // Перевіряємо, чи існує SHA512 у цій збірці CryptoJS
        if (!CryptoJS.algo || !CryptoJS.algo.SHA512) {
            throw new Error("CryptoJS.algo.SHA512 is MISSING in this runtime");
        }
        
        const key = CryptoJS.PBKDF2(pass, salt, { 
            hasher: CryptoJS.algo.SHA512, 
            keySize: 256 / 32, 
            iterations: 999 
        });
        
        const decrypted = CryptoJS.AES.decrypt(
            { ciphertext: ct }, 
            key, 
            { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.NoPadding }
        );
        
        let result = decrypted.toString(CryptoJS.enc.Utf8).replace(/\\/g, "");
        const lastBracket = result.lastIndexOf("]");
        if (lastBracket !== -1) {
            result = result.substring(0, lastBracket + 1);
        }
        return result;
    } catch (e) {
        // Виводимо справжню помилку CryptoJS
        throw new Error("AES_DECRYPT_ERR: " + e.message + " (Salt len: " + (encryptedData.salt?.length || 0) + ")");
    }
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

    async createFilter(filter) {
        return {};
    }

    async checkUpdate(url) {
        return "";
    }

    async latest(page) {
        const res = await this.request(`/films/page/${page}/`);
        const items = await this.querySelectorAll(res, ".short-item");
        const results = [];
        
        for (const item of items) {
            const html = item.content;
            const href = await this.getAttributeText(html, ".short-item.width-16 .short-img", "href");
            if (!href) continue;
            
            const titleEl = await this.querySelector(html, "div.th-title.truncate");
            const title = (await titleEl?.text || "").trim();
            const poster = await this.getAttributeText(html, ".img-fit img", "data-src");
            
            results.push({ title, url: fixUrl(href), cover: fixUrl(poster) });
        }
        return results;
    }

    async search(kw, page, filter) {
        const encodedQuery = encodeURIComponent(kw).replace(/\+/g, "%20");
        const res = await this.request(`/search/${encodedQuery}/`);
        const items = await this.querySelectorAll(res, ".uas-card");
        const results = [];
        
        for (const item of items) {
            const html = item.content;
            const href = await this.getAttributeText(html, ".uas-card", "href");
            if (!href) continue;
            
            const titleEl = await this.querySelector(html, ".uas-card__title");
            const title = (await titleEl?.text || "").trim();
            let poster = await this.getAttributeText(html, ".uas-card__img", "data-src");
            if (poster && poster.startsWith("/")) poster = mainUrl + poster;
            
            results.push({ title, url: fixUrl(href), cover: fixUrl(poster) });
        }
        return results;
    }

    async detail(url) {
        const res = await this.fetch(url);
        
        let title = "";
        try {
            const titleEl = await this.querySelector(res, ".short-title");
            title = (await titleEl?.text || "").trim();
        } catch (e) { /* ignore */ }

        let poster = "";
        try {
            poster = await this.getAttributeText(res, "div.fimg.img-wide img", "src");
        } catch (e) { /* ignore */ }

        let desc = "";
        try {
            const descEl = await this.querySelector(res, ".full-text");
            desc = (await descEl?.text || "").trim();
        } catch (e) { /* ignore */ }

        // 1. Extract data-tag1 via Regex to bypass Dart html parser entity issues
        // Шукаємо data-tag1='...' або data-tag1="..."
        const tag1Match = res.match(/data-tag1=(["'])(.*?)\1/);
        if (!tag1Match || !tag1Match[2]) {
            throw new Error("No data-tag1 found via regex");
        }
        
        let rawTag1 = tag1Match[2];
        // Декодуємо HTML-сутності, якщо вони є
        rawTag1 = rawTag1.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

        let aesData;
        try {
            aesData = JSON.parse(rawTag1);
        } catch (e) {
            throw new Error("Failed to parse AES data: " + e.message + " | RAW: " + rawTag1.substring(0, 100));
        }

        const decryptedJson = decryptAES(aesData, AES_PASSWORD);
        if (!decryptedJson) {
            throw new Error("AES Decryption failed");
        }

        let playerTabs;
        try {
            playerTabs = JSON.parse(decryptedJson);
        } catch (e) {
            throw new Error("Failed to parse player tabs JSON: " + e.message);
        }

        // 2. Find first available player URL
        let playerUrl = null;
        const preferredTab = playerTabs.find(t => t.tabName === "Плеєр");
        if (preferredTab && preferredTab.url) {
            playerUrl = preferredTab.url;
        } else {
            const validTab = playerTabs.find(t => t.url && t.url.trim() !== "");
            if (validTab) playerUrl = validTab.url;
        }

        if (!playerUrl) {
            throw new Error("No player URL found in tabs");
        }

        // 3. Fetch player page
        const safePlayerUrl = fixTls(playerUrl);
        const playerHtml = await this.fetch(safePlayerUrl);
        
        // 4. Extract file: from player script
        const fileMatch = playerHtml.match(/file\s*:\s*["']([^"']+)["']/);
        if (!fileMatch || !fileMatch[1]) {
            throw new Error("No file: found in player HTML");
        }
        
        let rawFile = fileMatch[1];
        let decodedFile = "";
        if (rawFile.startsWith("http")) {
            decodedFile = rawFile;
        } else {
            decodedFile = decodeTortuga(rawFile) || "";
        }

        const episodeGroups = [];
        
        // 5. Check if it's a series (JSON playlist) or movie (direct URL)
        if (decodedFile.startsWith("[")) {
            // Series
            let seasons;
            try {
                seasons = JSON.parse(decodedFile);
            } catch (e) {
                throw new Error("Failed to parse seasons JSON: " + e.message);
            }

            const episodes = [];
            for (let s = 0; s < seasons.length; s++) {
                const season = seasons[s];
                const seasonNum = parseInt(season.season, 10) || (s + 1);
                
                for (let e = 0; e < season.folder.length; e++) {
                    const ep = season.folder[e];
                    const epNum = parseInt(ep.number, 10) || (e + 1);
                    const epName = ep.title || `Серія ${epNum}`;
                    const epUrl = ep.file; // Формат: Name1{URL1};Name2{URL2}
                    
                    if (epUrl) {
                        episodes.push({
                            name: `${epName} (Сезон ${seasonNum})`,
                            url: epUrl
                        });
                    }
                }
            }
            
            if (episodes.length > 0) {
                episodeGroups.push({ title: "Серії", urls: episodes });
            }
        } else if (decodedFile) {
            // Movie
            const safeStreamUrl = fixTls(decodedFile);
            episodeGroups.push({
                title: "Фільм",
                urls: [{ name: title, url: safeStreamUrl }]
            });
        }

        if (episodeGroups.length === 0) {
            throw new Error("No playable episodes found");
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
        
        // Для серіалів URL має формат: Name1{URL1};Name2{URL2}
        // Для фільмів URL це прямий m3u8 URL
        let finalStreamUrl = url;
        
        if (url.includes("{") && url.includes("}")) {
            // Серіал: беремо перший доступний трек
            const tracks = url.split(";");
            for (const track of tracks) {
                const urlStart = track.indexOf("{");
                const urlEnd = track.indexOf("}");
                if (urlStart !== -1 && urlEnd !== -1 && urlEnd > urlStart) {
                    finalStreamUrl = track.substring(urlStart + 1, urlEnd);
                    break;
                }
            }
        }

        // Застосовуємо TLS fallback
        finalStreamUrl = fixTls(finalStreamUrl);
        
        const isHls = finalStreamUrl.includes(".m3u8");
        
        return {
            type: isHls ? "hls" : "mp4",
            url: finalStreamUrl,
            headers: {
                "Referer": "https://tortuga.tw/",
                "User-Agent": UA
            }
        };
    }
}