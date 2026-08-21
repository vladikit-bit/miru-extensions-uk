// ==MiruExtension==
// @name         SimpsonsUA.tv
// @version      v0.0.1
// @author       CakesTwix
// @lang         uk
// @license      MIT
// @icon         https://www.google.com/s2/favicons?domain=simpsonsua.tv&sz=256
// @package      simpsonsua.tv
// @type         bangumi
// @webSite      https://simpsonsua.tv
// ==/MiruExtension==

const mainUrl = "https://simpsonsua.tv";
const UA = "Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.215 Mobile Safari/537.36";

function fixUrl(url) {
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("//")) return "https:" + url;
    if (url.startsWith("/")) return mainUrl + url;
    return mainUrl + "/" + url;
}

function encodeURICompat(s) {
    try { return encodeURIComponent(s); } catch (e) { return s; }
}

function convertToPortraitProxy(url) {
    if (!url) return "";
    try {
        const encoded = encodeURIComponent(url);
        return `https://images.weserv.nl/?url=${encoded}&w=400&h=600&fit=fill&output=webp&q=80`;
    } catch (e) { return url; }
}

function convertToLandscapeProxy(url) {
    if (!url) return "";
    try {
        const encoded = encodeURIComponent(url);
        return `https://images.weserv.nl/?url=${encoded}&w=320&h=180&fit=crop&a=focal&fpx=0.5&fpy=0.17&output=webp&q=75`;
    } catch (e) { return url; }
}

function extractImageUrl(html) {
    const dataSrc = html.match(/data-src="([^"]+)"/)?.[1];
    const dataLazy = html.match(/data-lazy-src="([^"]+)"/)?.[1];
    const src = html.match(/src="([^"]+)"/)?.[1];
    const rawUrl = dataSrc || dataLazy || src || "";
    if (!rawUrl) return "";
    return fixUrl(rawUrl);
}

function parseSeasonNumber(url) {
    const match = url.match(/sezon-(\d+)/);
    return match ? parseInt(match[1], 10) : -1;
}

function parseEpisodeNumber(url, fallback) {
    const match = url.match(/(\d+)-seriya/);
    return match ? parseInt(match[1], 10) : fallback;
}

function cleanTitle(text) {
    if (!text) return "";
    return text
        .replace(/дивитися онлайн.*/i, "")
        .replace(/українською.*/i, "")
        .trim();
}

function decodeTortuga(encoded) {
    if (!encoded) return null;
    try {
        let clean = encoded.trim().replace(/=+$/, "");
        const padLen = (4 - clean.length % 4) % 4;
        clean += "=".repeat(padLen);
        
        const decoded = CryptoJS.enc.Base64.parse(clean);
        if (decoded.sigBytes < 2) return null;
        
        const words = decoded.words;
        const sigBytes = decoded.sigBytes;
        const salt = (words[0] >>> 24) & 0xff;
        
        const result = [];
        for (let i = 1; i < sigBytes; i++) {
            const wordIdx = (i / 4) | 0;
            const byteOff = 3 - (i % 4);
            const byte = (words[wordIdx] >>> (byteOff * 8)) & 0xff;
            const key = (salt + 7 * (i - 1) + 13) % 256;
            result.push((byte ^ key) & 0xff);
        }
        const str = String.fromCharCode.apply(null, result);
        return str.startsWith("http") || str.includes(".m3u8") ? str : null;
    } catch (e) {
        return null;
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
        const items = await this.querySelectorAll(html, "#dle-content div.movie_item");
        const results = [];
        for (const item of items) {
            const itemHtml = item.content;
            const href = await this.getAttributeText(itemHtml, "a", "href");
            if (!href) continue;
            
            let title = "";
            const titleMatch = itemHtml.match(/<!--\s*(.*?)\s*-->/);
            if (titleMatch) title = titleMatch[1].trim();
            
            if (!title) {
                const slug = href.split("/").filter(Boolean).pop() || "";
                title = slug.replace(/-\d+$/, "").replace(/-/g, " ");
            }
            
            const poster = extractImageUrl(itemHtml);
            results.push({ 
                title: title || "Без назви", 
                url: fixUrl(href), 
                cover: convertToPortraitProxy(poster)
            });
        }
        return results;
    }

    async latest(page) {
        const res = await this.fetch(`/multserialy-ukrainskoyu/page/${page}/`);
        return await this.parseItems(res);
    }

    async search(kw, page, filter) {
        const res = await this.fetch(`/?s=${encodeURICompat(kw)}`);
        return await this.parseItems(res);
    }

    async detail(url) {
        const res = await this.fetch(url);
        
        let title = "";
        const titleEl = await this.querySelector(res, ".poster h2, .cat-nazva h1, h1");
        title = (await titleEl?.text || "").trim();
        
        const mainImgEl = await this.querySelector(res, ".movie_item, div.story, .poster");
        const rawPoster = extractImageUrl(mainImgEl?.content || "");
        const poster = convertToPortraitProxy(rawPoster);
        
        const descEl = await this.querySelector(res, ".sez-opys, .fullstory, div.story");
        const desc = (await descEl?.text || "").trim();

        const episodes = [];
        const isSeasonPage = parseSeasonNumber(url) > 0;
        
        const directCards = await this.querySelectorAll(res, "#dle-content .movie_item");
        
        if (isSeasonPage) {
            const seasonNum = parseSeasonNumber(url);
            for (const card of directCards) {
                const cardHtml = card.content;
                const epUrl = await this.getAttributeText(cardHtml, "a", "href");
                if (!epUrl) continue;
                
                const epNum = parseEpisodeNumber(epUrl, episodes.length + 1);
                const nameEl = await this.querySelector(cardHtml, ".descr.nazva, .title, h2");
                const epName = cleanTitle((await nameEl?.text || `Серія ${epNum}`).trim());
                const epPoster = extractImageUrl(cardHtml);
                
                episodes.push({
                    name: epName,
                    url: fixUrl(epUrl),
                    cover: convertToLandscapeProxy(epPoster)
                });
            }
        } else {
            // Catalog page: find seasons and fetch them
            const subItems = [];
            const links = await this.querySelectorAll(res, "#dle-content .movie_item a");
            for (const link of links) {
                const href = await this.getAttributeText(link.content, "a", "href");
                if (href && parseSeasonNumber(href) > 0) {
                    subItems.push(fixUrl(href));
                }
            }
            
            // Fetch all seasons concurrently
            const seasonPromises = subItems.map(async (seasonUrl) => {
                try {
                    const seasonRes = await this.fetch(seasonUrl);
                    const seasonCards = await this.querySelectorAll(seasonRes, "#dle-content .movie_item");
                    const seasonEps = [];
                    for (const card of seasonCards) {
                        const cardHtml = card.content;
                        const epUrl = await this.getAttributeText(cardHtml, "a", "href");
                        if (!epUrl) continue;
                        
                        const epNum = parseEpisodeNumber(epUrl, seasonEps.length + 1);
                        const nameEl = await this.querySelector(cardHtml, ".descr.nazva, .title, h2");
                        const epName = cleanTitle((await nameEl?.text || `Серія ${epNum}`).trim());
                        const epPoster = extractImageUrl(cardHtml);
                        
                        seasonEps.push({
                            name: epName,
                            url: fixUrl(epUrl),
                            cover: convertToLandscapeProxy(epPoster)
                        });
                    }
                    return seasonEps;
                } catch (e) {
                    return [];
                }
            });
            
            const seasonsEpisodes = await Promise.all(seasonPromises);
            for (const seasonEps of seasonsEpisodes) {
                episodes.push(...seasonEps);
            }
        }

        if (episodes.length === 0) {
            episodes.push({ name: title || "Епізод 1", url: url });
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
        
        const res = await this.fetch(url);
        let streamUrl = null;
        let referer = mainUrl;
        
        // 1. Search for standard iframes (Ashdi, etc.)
        const iframeRegex = /<iframe[^>]+data-player="([^"]+)"[^>]+src="([^"]+)"/g;
        let match;
        while ((match = iframeRegex.exec(res)) !== null) {
            let iframeUrl = fixUrl(match[2]);
            if (iframeUrl.includes("tortuga")) continue;
            
            try {
                const playerHtml = await this.fetch(iframeUrl);
                const fileMatch = playerHtml.match(/file\s*:\s*["']([^"']{20,})["']/);
                if (fileMatch && fileMatch[1]) {
                    if (fileMatch[1].includes(".m3u8")) {
                        streamUrl = fileMatch[1];
                    } else {
                        streamUrl = decodeTortuga(fileMatch[1]);
                    }
                    if (streamUrl) {
                        referer = iframeUrl;
                        break;
                    }
                }
            } catch (e) { /* ignore fetch errors */ }
        }
        
        // 2. Search for Tortuga iframes
        if (!streamUrl) {
            const tortugaRegex = /<iframe[^>]+data-player="([^"]+)"[^>]+src="([^"]*tortuga\.tw[^"]*)"[^>]*>/g;
            while ((match = tortugaRegex.exec(res)) !== null) {
                let iframeUrl = fixUrl(match[2]);
                try {
                    const playerHtml = await this.fetch(iframeUrl);
                    const fileMatch = playerHtml.match(/file\s*:\s*["']([^"']{20,})["']/);
                    if (fileMatch && fileMatch[1]) {
                        if (fileMatch[1].includes(".m3u8")) {
                            streamUrl = fileMatch[1];
                        } else {
                            streamUrl = decodeTortuga(fileMatch[1]);
                        }
                        if (streamUrl) {
                            referer = iframeUrl;
                            break;
                        }
                    }
                } catch (e) { /* ignore */ }
            }
        }

        if (!streamUrl) throw new Error("No playable stream found");
        
        return {
            type: "hls",
            url: streamUrl,
            headers: {
                "Referer": referer,
                "User-Agent": UA
            }
        };
    }
}