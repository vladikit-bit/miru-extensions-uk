// ==MiruExtension==
// @name         Uakino
// @version      v0.0.2
// @author       ported
// @lang         uk
// @license      MIT
// @icon         https://www.google.com/s2/favicons?domain=uakino.best&sz=256
// @package      uakino
// @type         bangumi
// @webSite      https://uakino.best
// ==/MiruExtension==

export default class extends Extension {
    mainUrl = "https://uakino.best";
    ua = "Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.215 Mobile Safari/537.36";
    blackUrls = /\/news\/|\/franchise\//;

    async createFilter(filter) {
        return {};
    }

    siteHeaders() {
        return {
            "User-Agent": this.ua,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7",
            "Referer": this.mainUrl, // БЕЗ + "/"
        };
    }

    ajaxHeaders() {
        return {
            "Referer": this.mainUrl, // БЕЗ + "/"
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent": this.ua,
        };
    }
    async latest(page) {
    let html;
    try {
        html = await this.request(`/seriesss/page/${page}`, {
            headers: this.siteHeaders(),
        });
    } catch (e) {
        // DioException містить response data навіть для 403
        const errStr = String(e);
        let body = "";
        try {
            // Спроба витягнути тіло з exception
            if (e.response && e.response.data) {
                body = String(e.response.data).substring(0, 500);
            }
        } catch(_) {}
        throw new Error(
            "UAKINO_403_DIAG\n" +
            "URL: https://uakino.best/seriesss/page/" + page + "\n" +
            "ERROR: " + errStr.substring(0, 300) + "\n" +
            "BODY: " + body
        );
    }
    if (!html || html.length < 100) {
        throw new Error("UAKINO_EMPTY: len=" + (html?.length || 0));
    }
    return await this.parseItems(html, "div.owl-item, div.movie-item");
}

    async search(kw, page, filter) {
        const html = await this.request("/ua/", {
            method: "post",
            data: {
                do: "search",
                subaction: "search",
                story: kw,
            },
            headers: this.siteHeaders(),
        });
        if (!html) return [];
        return await this.parseItems(html, "div.movie-item.short-item");
    }

    async detail(url) {
        const html = await this.request(url, {
            headers: this.siteHeaders(),
        });

        const titleEl = await this.querySelector(html, "h1 span.solototle");
        if (!titleEl) throw new Error("Not a detail page: " + url);

        const title = (await titleEl.text)?.trim() || "Без назви";
        const poster = this.fixImgUrl(
            await this.getAttributeText(html, "div.film-poster img", "src")
        );
        const descEl = await this.querySelector(html, "div[itemprop=description]");
        const desc = (await descEl?.text)?.trim() || "";

        const playlistAjax = await this.querySelector(html, "div.playlists-ajax");
        let episodes;

        if (playlistAjax) {
            episodes = await this.buildSeriesEpisodes(playlistAjax, url);
        } else {
            episodes = await this.buildMovieEpisode(html, title);
        }

        return { title, cover: poster, desc, episodes };
    }

    async watch(url) {
        if (!url) throw new Error("No player URL provided");

        const playerHtml = await this.request("", {
            headers: {
                "Miru-Url": url,
                "User-Agent": this.ua,
                "Referer": this.mainUrl + "/",
            },
        });

        const scripts = await this.querySelectorAll(playerHtml, "script");
        if (!scripts || scripts.length === 0) {
            throw new Error("No scripts found in player page");
        }

        let scriptData = "";
        for (const s of scripts) {
            scriptData += s.content + "\n";
        }

        let m3uLink = null;
        const fileRegex = /file\s*:\s*["']([^"',]+?)["']/g;
        let match;
        while ((match = fileRegex.exec(scriptData)) !== null) {
            if (match[1].includes(".m3u8")) {
                m3uLink = match[1];
                break;
            }
        }
        if (!m3uLink) {
            const fb = /file\s*:\s*["']([^"',]+?)["']/;
            const fbMatch = fb.exec(scriptData);
            m3uLink = fbMatch ? fbMatch[1] : null;
        }

        m3uLink = this.resolveStreamUrl(m3uLink);
        if (!m3uLink) throw new Error("Could not extract stream URL from player");

        const subsMatch = /subtitle\s*:\s*["']([^"',]+?)["']/.exec(scriptData);
        const subtitles = [];
        if (subsMatch && subsMatch[1]) {
            const s = subsMatch[1];
            const openIdx = s.indexOf("[");
            const closeIdx = s.indexOf("]");
            if (openIdx >= 0 && closeIdx > openIdx) {
                subtitles.push({
                    title: s.substring(openIdx + 1, closeIdx),
                    url: s.substring(closeIdx + 1),
                });
            }
        }

        const hostMatch = url.match(/^(https?:\/\/[^/]+)/);
        const referer = hostMatch ? hostMatch[1] + "/" : this.mainUrl + "/";

        const isHls = m3uLink.includes(".m3u8");
        const result = {
            type: isHls ? "hls" : "mp4",
            url: m3uLink,
            headers: { Referer: referer },
        };
        if (subtitles.length > 0) {
            result.subtitles = subtitles;
        }
        return result;
    }

    async buildSeriesEpisodes(playlistAjax, detailUrl) {
        let newsId = await playlistAjax.getAttributeText("data-news_id");
        if (!newsId) {
            const idMatch = detailUrl.match(/\/(\d+)-/);
            newsId = idMatch ? idMatch[1] : null;
        }
        if (!newsId) throw new Error("Could not extract news_id");

        const ajaxUrl =
            `/engine/ajax/playlists.php?news_id=${newsId}&xfield=playlist&time=${Date.now()}`;
        const ajaxRes = await this.request(ajaxUrl, {
            headers: this.ajaxHeaders(),
        });

        if (!ajaxRes?.success || !ajaxRes.response) {
            throw new Error("Playlist AJAX request failed");
        }

        const items = await this.querySelectorAll(
            ajaxRes.response,
            "div.playlists-videos li"
        );
        if (!items || items.length === 0) {
            throw new Error("No episodes found in playlist");
        }

        const voiceMap = {};
        for (const li of items) {
            const name = (await li.text)?.trim() || "";
            const rawUrl = (await li.getAttributeText("data-file")) || "";
            const playerUrl = this.normalizePlayerUrl(rawUrl);
            const voice =
                (await li.getAttributeText("data-voice")) || "Основна озвучка";

            if (!name || !playerUrl) continue;

            if (!voiceMap[voice]) voiceMap[voice] = [];
            voiceMap[voice].push({ name, url: playerUrl });
        }

        const episodes = Object.entries(voiceMap).map(([voice, eps]) => ({
            title: voice,
            urls: eps,
        }));

        if (episodes.length === 0) {
            throw new Error("No playable episodes after filtering");
        }

        return episodes;
    }

    async buildMovieEpisode(html, title) {
        const iframe = await this.querySelector(html, "iframe#pre");
        if (!iframe) throw new Error("No player iframe found for movie");

        const rawSrc = (await iframe.getAttributeText("src")) || "";
        const playerUrl = this.normalizePlayerUrl(rawSrc);
        if (!playerUrl) throw new Error("Player iframe has no src");

        return [
            {
                title: "Фільм",
                urls: [{ name: title, url: playerUrl }],
            },
        ];
    }

    async parseItems(html, selector) {
        const items = await this.querySelectorAll(html, selector);
        if (!items) return [];

        const results = [];
        for (const item of items) {
            const href = await this.getAttributeText(
                item.content,
                "a.movie-title, a.full-movie",
                "href"
            );
            if (!href || this.blackUrls.test(href)) continue;

            const titleEl = await this.querySelector(
                item.content,
                "a.movie-title, div.full-movie-title"
            );
            const title = titleEl
                ? (await titleEl.text)?.trim() || "Без назви"
                : "Без назви";

            const cover = this.fixImgUrl(
                await this.getAttributeText(item.content, "img", "src")
            );

            results.push({
                title,
                url: this.toRelativePath(href),
                cover,
            });
        }
        return results;
    }

    toRelativePath(url) {
        if (!url) return "";
        url = url.trim();
        if (url.startsWith("/")) return url;
        if (url.startsWith("//")) {
            const m = url.match(/\/\/[^/]+(\/[^?#]*)/);
            return m ? m[1] : "/";
        }
        const match = url.match(/^https?:\/\/[^/]+(\/[^?#]*)/);
        return match ? match[1] : "/";
    }

    normalizePlayerUrl(raw) {
        if (!raw) return "";
        raw = raw.trim();
        if (raw.startsWith("//")) return "https:" + raw;
        if (raw.startsWith("http://"))
            return "https://" + raw.substring(7);
        return raw;
    }

    resolveStreamUrl(raw) {
        if (!raw) return null;
        raw = raw.trim();
        if (raw.startsWith("http://") || raw.startsWith("https://"))
            return raw;
        return this.decodeTortuga(raw);
    }

    fixImgUrl(url) {
        if (!url) return "";
        url = url.trim();
        if (url.startsWith("//")) return "https:" + url;
        if (url.startsWith("http://") || url.startsWith("https://"))
            return url;
        return this.mainUrl + url;
    }

    decodeTortuga(encoded) {
        if (!encoded) return null;
        let clean = encoded.trim().replace(/\s/g, "").replace(/=+$/, "");
        if (!clean) return null;

        try {
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
            return str.startsWith("http://") || str.startsWith("https://")
                ? str
                : null;
        } catch (e) {
            return null;
        }
    }
}
