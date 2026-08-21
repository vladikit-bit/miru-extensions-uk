// ==MiruExtension==
// @name         AnimeON
// @version      v0.0.7
// @author       CakesTwix
// @lang         uk
// @license      MIT
// @icon         https://animeon.club/assets/images/short-logo.png
// @package      animeon.club
// @type         bangumi
// @webSite      https://animeon.club
// ==/MiruExtension==

const mainUrl = "https://animeon.club";
const apiUrl = `${mainUrl}/api/anime`;
const posterApi = `${mainUrl}/api/uploads/images/%s`;
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36";

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

// --- Moon Crypto Helpers (using atob for reliability) ---

function strToBytes(str) {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
        bytes[i] = str.charCodeAt(i);
    }
    return bytes;
}

function moonOuterDecode(base64Blob) {
    if (!base64Blob) return "";
    try {
        const raw = atob(base64Blob);
        const bytes = strToBytes(raw);
        if (bytes.length < 33) return "";
        
        const state0 = bytes[0];
        const key = bytes.slice(1, 33);
        const data = bytes.slice(33);
        
        let result = "";
        let state = state0;
        for (let i = 0; i < data.length; i++) {
            const d = data[i];
            const k = key[i % 32];
            const dec = (d ^ k ^ state) & 0xFF;
            result += String.fromCharCode(dec);
            state = (d + k) & 0xFF;
        }
        return result;
    } catch (e) {
        return "";
    }
}

function moonDecrypt(encoded, key = "mAnK") {
    if (!encoded || !key) return "";
    try {
        const raw = atob(encoded);
        const bytes = strToBytes(raw);
        let result = "";
        for (let i = 0; i < bytes.length; i++) {
            result += String.fromCharCode((bytes[i] ^ key.charCodeAt(i % key.length)) & 0xFF);
        }
        return result;
    } catch (e) {
        return "";
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

    async createFilter(filter) { return {}; }
    async checkUpdate(url) { return ""; }

    async latest(page) {
        let res;
        try {
            res = await this.request(`/api/anime?pageSize=24&pageIndex=${page - 1}`);
            if (typeof res === 'string') res = JSON.parse(res);
        } catch (e) { return []; }
        
        if (!res || !Array.isArray(res.results)) return [];
        
        return res.results.map(item => ({
            title: item.titleUa || "Без назви",
            url: `anime/${item.id}`,
            cover: item.image?.preview ? posterApi.replace("%s", item.image.preview) : ""
        }));
    }

    async search(kw, page, filter) {
        let res;
        try {
            res = await this.request(`/api/anime?search=${encodeURIComponent(kw)}`);
            if (typeof res === 'string') res = JSON.parse(res);
        } catch (e) { return []; }
        
        if (!res || !Array.isArray(res.results)) return [];
        
        return res.results.map(item => ({
            title: item.titleUa || "Без назви",
            url: `anime/${item.id}`,
            cover: item.image?.preview ? posterApi.replace("%s", item.image.preview) : ""
        }));
    }

    async resolveMoonContent(contentUrl) {
        try {
            const res = await this.fetch(contentUrl);
            if (res && res.trim().startsWith("http")) return res.trim();
            if (res && (res.includes("<html") || res.includes("<!DOCTYPE"))) return null;
            return contentUrl; 
        } catch (e) {
            return null;
        }
    }

    async getMovieVideoUrl(animeId) {
        let transRes;
        try {
            transRes = await this.request(`/api/player/${animeId}/translations`);
            if (typeof transRes === 'string') transRes = JSON.parse(transRes);
        } catch (e) { return null; }

        if (!transRes || !transRes.translations) return null;

        for (const t of transRes.translations) {
            for (const player of t.player) {
                try {
                    const epRes = await this.request(`/api/player/${animeId}/episodes?take=100&playerId=${player.id}&translationId=${t.translation.id}&skip=0&includeAlternative=true`);
                    if (typeof epRes === 'string') epRes = JSON.parse(epRes);
                    
                    if (epRes && epRes.episodes && epRes.episodes.length > 0) {
                        const epId = epRes.episodes[0].id;
                        const videoRes = await this.request(`/api/player/${epId}/episode`);
                        if (typeof videoRes === 'string') videoRes = JSON.parse(videoRes);
                        if (videoRes.videoUrl || videoRes.fileUrl) return videoRes.videoUrl || videoRes.fileUrl;
                    } else {
                        const directRes = await this.request(`/api/player/${player.id}/${t.translation.id}`);
                        if (typeof directRes === 'string') directRes = JSON.parse(directRes);
                        if (directRes && (directRes.videoUrl || directRes.fileUrl)) {
                            return directRes.videoUrl || directRes.fileUrl;
                        }
                    }
                } catch (e) { /* ignore */ }
            }
        }
        return null;
    }

    async detail(url) {
        const animeId = url.split("/").pop();
        
        let apiPath = `/api/anime/${animeId}`;
        let res;
        try {
            res = await this.request(apiPath);
            if (typeof res === 'string') res = JSON.parse(res);
            if (res && res.moved === true && res.slug) {
                apiPath = `/api/anime/${res.slug}`;
                res = await this.request(apiPath);
                if (typeof res === 'string') res = JSON.parse(res);
            }
        } catch (e) {
            throw new Error("Failed to load anime API");
        }
        
        if (!res || !res.titleUa) throw new Error("Failed to load anime");
        
        const title = res.titleUa || "Без назви";
        const poster = res.image?.preview ? posterApi.replace("%s", res.image.preview) : "";
        const desc = res.description || "";
        const isMovie = res.type?.includes("movie");
        
        const episodeGroups = [];
        
        if (isMovie) {
            episodeGroups.push({
                title: "Фільм",
                urls: [{ name: title, url: `movie:${animeId}` }]
            });
        } else {
            let episodeInfoMap = {};
            try {
                const infoRes = await this.request(`/api/anime/${res.slug || animeId}/episodes-info`);
                if (typeof infoRes === 'string') infoRes = JSON.parse(infoRes);
                if (infoRes && Array.isArray(infoRes)) {
                    for (const ep of infoRes) {
                        episodeInfoMap[ep.episode] = ep.titleUa || ep.title || "";
                    }
                }
            } catch (e) { /* ignore */ }

            let transRes;
            try {
                transRes = await this.request(`/api/player/${animeId}/translations`);
                if (typeof transRes === 'string') transRes = JSON.parse(transRes);
            } catch (e) {
                throw new Error("No translations API found");
            }

            if (transRes && transRes.translations) {
                const tempGroups = {};
                
                for (const t of transRes.translations) {
                    const tName = t.translation.name;
                    if (!tempGroups[tName]) tempGroups[tName] = {};
                    
                    for (const player of t.player) {
                        try {
                            const epRes = await this.request(`/api/player/${animeId}/episodes?take=100&playerId=${player.id}&translationId=${t.translation.id}&skip=0&includeAlternative=true`);
                            if (typeof epRes === 'string') epRes = JSON.parse(epRes);
                            
                            if (epRes && epRes.episodes) {
                                for (const ep of epRes.episodes) {
                                    if (!tempGroups[tName][ep.episode]) {
                                        const customName = episodeInfoMap[ep.episode] && episodeInfoMap[ep.episode] !== "" ? episodeInfoMap[ep.episode] : `Серія ${ep.episode}`;
                                        tempGroups[tName][ep.episode] = {
                                            name: customName,
                                            url: ep.id.toString()
                                        };
                                    }
                                }
                            }
                        } catch (e) { /* ignore player errors */ }
                    }
                }
                
                for (const tName in tempGroups) {
                    const episodes = Object.values(tempGroups[tName]).sort((a, b) => {
                        const numA = parseInt(a.name.match(/\d+/)?.[0] || "0", 10);
                        const numB = parseInt(b.name.match(/\d+/)?.[0] || "0", 10);
                        return numA - numB;
                    });
                    if (episodes.length > 0) {
                        episodeGroups.push({ title: tName, urls: episodes });
                    }
                }
            }
        }

        if (episodeGroups.length === 0) {
            throw new Error("No episodes found");
        }

        return {
            title,
            cover: poster,
            desc,
            episodes: episodeGroups
        };
    }

    async watch(url) {
        let videoUrl = "";
        
        if (url.startsWith("movie:")) {
            const animeId = url.split(":")[1];
            videoUrl = await this.getMovieVideoUrl(animeId);
        } else {
            const episodeId = url;
            try {
                let res = await this.request(`/api/player/${episodeId}/episode`);
                if (typeof res === 'string') res = JSON.parse(res);
                videoUrl = res.videoUrl || res.fileUrl;
            } catch (e) {
                throw new Error("Failed to fetch episode video URL");
            }
        }
        
        if (!videoUrl) throw new Error("No video URL found");

        const moonHeaders = {
            "Referer": "https://moonanime.art/",
            "Origin": "https://moonanime.art",
            "User-Agent": UA,
            "Accept": "*/*",
            "Accept-Language": "uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7",
            "Sec-Fetch-Site": "cross-site",
            "Sec-Fetch-Mode": "no-cors",
            "Sec-Fetch-Dest": "video",
            "X-Requested-With": "mark.via.gp"
        };

        // 1. Direct M3U8 (not Ashdi/Moon specific)
        if (videoUrl.includes(".m3u8") && !videoUrl.includes("ashdi.vip") && !videoUrl.includes("moonanime.art")) {
            return {
                type: "hls",
                url: videoUrl,
                headers: { "Referer": mainUrl }
            };
        }
        
        // 2. Ashdi Extractor
        if (videoUrl.includes("ashdi.vip")) {
            const safeUrl = fixAshdiTls(videoUrl);
            // If it's already an m3u8 link
            if (safeUrl.includes(".m3u8")) {
                 return {
                    type: "hls",
                    url: safeUrl,
                    headers: { "Referer": "https://ashdi.vip/" }
                };
            }
            
            const playerHtml = await this.fetch(safeUrl);
            const fileMatch = playerHtml.match(/file:'([^']+)'/);
            if (fileMatch && fileMatch[1]) {
                let streamUrl = fileMatch[1];
                if (streamUrl.endsWith(".m3u8")) {
                    return {
                        type: "hls",
                        url: fixAshdiTls(streamUrl),
                        headers: { "Referer": "https://ashdi.vip/" }
                    };
                }
            }
            // Fallback regex
            const m3u8Match = playerHtml.match(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/);
            if (m3u8Match && m3u8Match[1]) {
                 return {
                    type: "hls",
                    url: fixAshdiTls(m3u8Match[1]),
                    headers: { "Referer": "https://ashdi.vip/" }
                };
            }
            throw new Error("Ashdi: No direct m3u8 found");
        } 
        
        // 3. Moon Extractor
        if (videoUrl.includes("moonanime.art")) {
            // If it's already an m3u8 link
            if (videoUrl.includes(".m3u8")) {
                return {
                    type: "hls",
                    url: videoUrl,
                    headers: moonHeaders
                };
            }

            // Otherwise, fetch the player page
            const playerHtml = await this.fetch(videoUrl);
            
            // Крок 1: Знаходимо правильний atob() блок
            const atobMatches = [...playerHtml.matchAll(/atob\s*\(\s*["']([^"']+)["']\s*\)/g)];
            let decodedJs = "";
            
            for (const match of atobMatches) {
                const d = moonOuterDecode(match[1]);
                if (d && (d.includes("_0xd") || d.includes("file"))) {
                    decodedJs = d;
                    break;
                }
            }
            
            // Крок 2: Якщо знайшли блок, шукаємо в ньому відео
            if (decodedJs) {
                const keyMatch = decodedJs.match(/var\s+k\s*=\s*["']([^"']+)["']/);
                const xorKey = keyMatch ? keyMatch[1] : null;
                
                if (xorKey) {
                    const encodedMatches = [...decodedJs.matchAll(/_0xd\s*\(\s*["']([^"']+)["']\s*\)/g)];
                    const allDecoded = [];
                    
                    for (const encMatch of encodedMatches) {
                        const decoded = moonDecrypt(encMatch[1], xorKey);
                        if (decoded) allDecoded.push(decoded);
                    }
                    
                    for (const decoded of allDecoded) {
                        const isVideoOrPlaylist = decoded.includes(".m3u8") || decoded.includes(".mp4") || decoded.includes(".webm") || decoded.startsWith("[");
                        const isMoonDomain = decoded.includes("mooncdn") || decoded.includes("moonanime.art/content") || decoded.includes("s.moonanime.art");
                        const isStaticAsset = /\.(jpg|jpeg|png|vtt|srt|txt)(\?|$)/i.test(decoded);
                        
                        if ((isVideoOrPlaylist || isMoonDomain) && !isStaticAsset) {
                            let finalUrl = decoded;
                            
                            // Якщо це плейлист (напр., [1080p]url,[720p]url2)
                            if (finalUrl.startsWith("[")) {
                                const qMatch = finalUrl.match(/\[\d+p\](https?:\/\/[^\s,]+)/);
                                if (qMatch && qMatch[1]) {
                                    finalUrl = qMatch[1];
                                }
                            }
                            
                            // Якщо це контент s.moonanime.art
                            if (finalUrl.includes("s.moonanime.art") || finalUrl.includes("moonanime.art/content")) {
                                const resolved = await this.resolveMoonContent(finalUrl);
                                if (resolved) finalUrl = resolved;
                            }
                            
                            return {
                                type: finalUrl.includes(".m3u8") ? "hls" : "mp4",
                                url: finalUrl,
                                headers: moonHeaders
                            };
                        }
                    }
                }
                
                // Крок 3: Якщо не знайшли через _0xd, шукаємо прямий content URL
                const contentMatch = decodedJs.match(/(https?:\/\/s\.moonanime\.art\/content\/[^\s"'`]+)/);
                if (contentMatch && contentMatch[1] && !/\.(jpg|jpeg|png)$/.test(contentMatch[1])) {
                    const resolved = await this.resolveMoonContent(contentMatch[1]);
                    if (resolved) {
                        return {
                            type: "mp4",
                            url: resolved,
                            headers: moonHeaders
                        };
                    }
                }
            }
            
            // Крок 4: Fallback - шукаємо хеш у iframe URL
            const hashMatch = videoUrl.match(/\/iframe\/([a-zA-Z0-9]+)/);
            if (hashMatch && hashMatch[1]) {
                const hash = hashMatch[1];
                const resolved = await this.resolveMoonContent(`https://s.moonanime.art/content/v/${hash}/1080/`);
                if (resolved) {
                    return {
                        type: "mp4",
                        url: resolved,
                        headers: moonHeaders
                    };
                }
            }
            
            throw new Error("Moon: No stream URL found");
        }
        
        // 4. Direct MP4
        if (videoUrl.includes(".mp4")) {
            return {
                type: "mp4",
                url: videoUrl,
                headers: { "Referer": mainUrl }
            };
        }
        
        throw new Error("Failed to extract stream URL");
    }
}