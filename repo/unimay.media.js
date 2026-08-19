// ==MiruExtension==
// @name         Unimay
// @version      v0.0.2
// @author       CakesTwix
// @lang         uk
// @license      MIT
// @icon         https://www.google.com/s2/favicons?domain=unimay.media&sz=256
// @package      unimay.media
// @type         bangumi
// @webSite      https://api.unimay.media
// ==/MiruExtension==

export default class extends Extension {
    imagesUrl = "https://img.unimay.media/";
    referer = "https://www.unimay.media";

    async latest(page) {
        const res = await this.request(`/v1/release/search?page_size=20&page=${page - 1}`);
        if (!res || !res.content) return [];
        return res.content.map(item => ({
            title: item.names?.ukr || "Без назви",
            url: item.code,
            cover: this.imagesUrl + item.images?.poster + "?width=640&format=webp",
            update: `${item.playlistSize || 0} еп.`
        }));
    }

    async search(kw, page, filter) {
        const res = await this.request(`/v1/release/search?title=${encodeURIComponent(kw)}&page=${page - 1}&page_size=20`);
        if (!res || !res.content) return [];
        return res.content.map(item => ({
            title: item.names?.ukr || "Без назви",
            url: item.code,
            cover: this.imagesUrl + item.images?.poster + "?width=640&format=webp",
            update: `${item.playlistSize || 0} еп.`
        }));
    }

    async detail(url) {
        // url = code (напр. "jobless-reincarnation")
        const res = await this.request(`/v1/release?code=${url}`, {
            headers: {
                "Accept": "application/json"
            }
        });

        if (!res || !res.playlist) {
            throw new Error(`Failed to load release: ${url}`);
        }

        const episodes = res.playlist
            .filter(p => !p.premium)
            .map(p => ({
                name: p.title || `Епізод ${p.number}`,
                url: p.hls?.master || ""
            }))
            .filter(ep => ep.url !== "");

        if (episodes.length === 0) {
            throw new Error(`No playable episodes found for: ${url}`);
        }

        return {
            title: res.names?.ukr || "Без назви",
            cover: this.imagesUrl + res.images?.poster + "?width=640&format=webp",
            desc: res.description || "",
            episodes: [{
                title: "Епізоди",
                urls: episodes
            }]
        };
    }

    async watch(url) {
        // url = прямий HLS master URL з detail()
        if (!url) {
            throw new Error("No stream URL provided");
        }

        return {
            type: "hls",
            url: url,
            headers: {
                "Referer": this.referer
            }
        };
    }
}