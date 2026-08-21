// ==MiruExtension==
// @name         Anitubeinua
// @version      v0.0.1
// @author       CakesTwix
// @lang         uk
// @license      MIT
// @icon         https://www.google.com/s2/favicons?domain=anitube.in.ua&sz=256
// @package      anitube.in.ua
// @type         bangumi
// @webSite      https://anitube.in.ua
// ==/MiruExtension==

const mainUrl = "https://anitube.in.ua";
const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0";

function fixUrl(url) {
    if (!url) return "";

    if (url.startsWith("http://") || url.startsWith("https://")) {
        return url;
    }

    if (url.startsWith("//")) {
        return "https:" + url;
    }

    if (url.startsWith("/")) {
        return mainUrl + url;
    }

    return mainUrl + "/" + url;
}

function fixAshdiTls(url) {
    if (url && url.includes("ashdi.vip")) {
        return url.replace("https://", "http://");
    }

    return url;
}

// --- MoonExtractor Crypto Logic ---

function bytesToUint8Array(wordArray) {
    const words = wordArray.words;
    const sigBytes = wordArray.sigBytes;
    const u8 = new Uint8Array(sigBytes);

    for (let i = 0; i < sigBytes; i++) {
        const byte =
            (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
        u8[i] = byte;
    }

    return u8;
}

function moonOuterDecode(base64Blob) {
    try {
        const raw = CryptoJS.enc.Base64.parse(base64Blob);
        const bytes = bytesToUint8Array(raw);

        if (bytes.length < 33) {
            return "";
        }

        const state0 = bytes[0];
        const key = bytes.slice(1, 33);
        const data = bytes.slice(33);

        let result = "";
        let state = state0;

        for (let i = 0; i < data.length; i++) {
            const d = data[i];
            const k = key[i % 32];

            const dec = (d ^ k ^ state) & 0xff;

            result += String.fromCharCode(dec);
            state = (d + k) & 0xff;
        }

        return result;
    } catch (e) {
        return "";
    }
}

function moonDecrypt(encoded, key = "mAnK") {
    try {
        const raw = CryptoJS.enc.Base64.parse(encoded);
        const bytes = bytesToUint8Array(raw);

        let result = "";

        for (let i = 0; i < bytes.length; i++) {
            result += String.fromCharCode(
                (bytes[i] ^ key.charCodeAt(i % key.length)) & 0xff
            );
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

    async createFilter(filter) {
        return {};
    }

    async checkUpdate(url) {
        return "";
    }

    async parseItems(html) {
        const items = await this.querySelectorAll(html, "article.story");
        const results = [];

        for (const item of items) {
            const itemHtml = item.content;

            const href = await this.getAttributeText(
                itemHtml,
                ".story_c h2 a, div.text_content a",
                "href"
            );

            if (!href) {
                continue;
            }

            let title = "";

            try {
                const titleEl = await this.querySelector(
                    itemHtml,
                    ".story_c h2 a, div.text_content a"
                );

                title = (await titleEl?.text || "").trim();
            } catch (e) {
                // ignore
            }

            let poster = "";

            try {
                poster =
                    await this.getAttributeText(
                        itemHtml,
                        ".story_c_l span.story_post img",
                        "src"
                    ) ||
                    await this.getAttributeText(
                        itemHtml,
                        "a img",
                        "data-src"
                    );
            } catch (e) {
                // ignore
            }

            results.push({
                title,
                url: fixUrl(href),
                cover: fixUrl(poster)
            });
        }

        return results;
    }

    async latest(page) {
        const res = await this.request(`/anime/page/${page}`);
        return await this.parseItems(res);
    }

    async search(kw, page, filter) {
        const res = await this.request("", {
            method: "POST",
            data: {
                do: "search",
                subaction: "search",
                story: kw
            },
            headers: {
                "Miru-Url": mainUrl,
                "Content-Type": "application/x-www-form-urlencoded"
            }
        });

        return await this.parseItems(res);
    }

    async detail(url) {
        const res = await this.fetch(url);
        
        let title = "";
        try {
            const titleEl = await this.querySelector(res, ".story_c h2");
            title = (await titleEl?.text || "").trim();
        } catch (e) { /* ignore */ }

        let poster = "";
        try {
            poster = await this.getAttributeText(res, ".story_c_left span.story_post img", "src");
        } catch (e) { /* ignore */ }

        let desc = "";
        try {
            const descEl = await this.querySelector(res, "div.my-text");
            desc = (await descEl?.text || "").trim();
        } catch (e) { /* ignore */ }

        // Extract dle_login_hash
        const hashMatch = res.match(/dle_login_hash = '([^']+)'/);
        const dleLoginHash = hashMatch ? hashMatch[1] : "";

        // Extract news_id
        const idMatch = url.split("/").pop().match(/^(\d+)/);
        const newsId = idMatch ? idMatch[1] : null;
        
        const episodeGroups = [];
        
        if (newsId && dleLoginHash) {
            const ajaxUrl = `/engine/ajax/playlists.php?news_id=${newsId}&xfield=playlist&user_hash=${dleLoginHash}`;
            const ajaxRes = await this.fetch(ajaxUrl, {
                headers: {
                    "X-Requested-With": "XMLHttpRequest"
                }
            });
            
            if (ajaxRes && ajaxRes.success && ajaxRes.response) {
                const playlistHtml = ajaxRes.response;
                const items = await this.querySelectorAll(playlistHtml, ".playlists-videos .playlists-items li");
                
                const episodes = [];
                
                for (const item of items) {
                    const itemHtml = item.content;
                    const fileUrl = await this.getAttributeText(itemHtml, "li", "data-file");
                    const dataId = await this.getAttributeText(itemHtml, "li", "data-id");
                    let epName = (await this.querySelector(itemHtml, "li")?.text || "").trim();

                    if (fileUrl) {
                        // Додаємо ID або позначку, якщо є дублікати назв епізодів
                        if (dataId && dataId !== "0_0_0_0") {
                            epName = `${epName} (${dataId})`;
                        }
                        episodes.push({ name: epName, url: fixUrl(fileUrl) });
                    }
                }
                
                if (episodes.length > 0) {
                    episodeGroups.push({ title: "Епізоди", urls: episodes });
                }
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
        if (!url) {
            throw new Error("No stream URL provided");
        }

        const safeUrl = fixAshdiTls(url);
        const playerHtml = await this.fetch(safeUrl);

        let streamUrl = null;
        let referer = mainUrl;

        // 1. Ashdi Extractor
        if (safeUrl.includes("ashdi.vip")) {
            const vodUrl = safeUrl.replace(
                "/embed/",
                "/vod/"
            );

            const vodHtml = await this.fetch(vodUrl);

            const fileMatch = vodHtml.match(
                /file\s*:\s*["']([^"']+)["']/
            );

            if (fileMatch && fileMatch[1]) {
                streamUrl = fixAshdiTls(fileMatch[1]);
                referer = "https://qeruya.cyou";
            }
        }

        // 2. Moon Extractor
        else if (safeUrl.includes("moonanime.art")) {
            const atobMatch = playerHtml.match(
                /atob\s*\(\s*["']([^"']+)["']\s*\)/
            );

            if (atobMatch && atobMatch[1]) {
                const decodedJs = moonOuterDecode(
                    atobMatch[1]
                );

                if (decodedJs) {
                    const keyMatch = decodedJs.match(
                        /var\s+k\s*=\s*["']([^"']+)["']/
                    );

                    const key = keyMatch
                        ? keyMatch[1]
                        : "mAnK";

                    const encodedMatches = decodedJs.match(
                        /_0xd\s*\(\s*["']([^"']+)["']\s*\)/g
                    );

                    if (encodedMatches) {
                        for (const encMatch of encodedMatches) {
                            const encValueMatch =
                                encMatch.match(
                                    /["']([^"']+)["']/
                                );

                            if (!encValueMatch) {
                                continue;
                            }

                            const decoded = moonDecrypt(
                                encValueMatch[1],
                                key
                            );

                            if (
                                decoded &&
                                (
                                    decoded.includes(".m3u8") ||
                                    decoded.includes(".mp4")
                                )
                            ) {
                                streamUrl = decoded;
                                referer =
                                    "https://moonanime.art/";
                                break;
                            }
                        }
                    }
                }
            }
        }

        // 3. csst / monstro Extractor
        else if (
            safeUrl.includes("csst.online") ||
            safeUrl.includes("monstro.site") ||
            safeUrl.includes("monstro.online")
        ) {
            const fileMatch = playerHtml.match(
                /file\s*:\s*["']([^"']+)["']/
            );

            if (fileMatch && fileMatch[1]) {
                streamUrl = fileMatch[1];
            }
        }

        // 4. Fallback
        else {
            const fileMatch = playerHtml.match(
                /file\s*:\s*["']([^"']+)["']/
            );

            if (fileMatch && fileMatch[1]) {
                streamUrl = fileMatch[1];
            }
        }

        if (!streamUrl) {
            throw new Error(
                "Failed to extract stream URL"
            );
        }

        const isHls = streamUrl.includes(".m3u8");

        return {
            type: isHls ? "hls" : "mp4",
            url: streamUrl,
            headers: {
                "Referer": referer,
                "User-Agent": UA
            }
        };
    }
}