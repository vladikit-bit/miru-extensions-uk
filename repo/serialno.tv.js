// ==MiruExtension==
// @name         Serialno
// @version      v0.0.1
// @author       vladikit-bit (Miru port), CakesTwix (original CloudStream provider)
// @lang         uk
// @license      GPL3
// @icon         https://www.google.com/s2/favicons?domain=serialno.tv&sz=%size%
// @package      serialno.tv
// @type         bangumi
// @webSite      https://serialno.tv
// @description  Україномовні серіали, мультсеріали та міні-серіали з Serialno.TV. Портування CloudStream-провайдера CakesTwix у Miru Alpha V1.
// @apiVersion   1
// ==/MiruExtension==
//
// Original source: https://github.com/CakesTwix/cloudstream-extensions-uk
// File: SerialnoProvider/src/main/kotlin/com/lagradost/SerialnoProvider.kt
//
// Adaptation notes
// ----------------
// Miru Alpha V1 uses the goja JS runtime (NOT QuickJS as often rumoured).
// Two runtime quirks make direct ports of Kotlin decoders break on UTF-8 input:
//
//   1. `atob()` is implemented with Go's `base64.RawStdEncoding.DecodeString`
//      followed by `vm.ToValue(string(str))`. Go `string([]byte)` is a byte-wise
//      copy, but goja treats strings as UTF-8 — bytes >= 0x80 end up as U+FFFD
//      or Latin-1 code units, NOT recoverable through `.charCodeAt(i)` in
//      downstream JSON serialisation. So `atob()` is unsafe for any payload
//      containing Cyrillic characters (which is exactly what Serialno serves).
//
//   2. `TextDecoder` is not registered in goja. We must decode UTF-8 manually.
//
// Strategy used here:
//   - For Base64 → bytes : `CryptoJS.enc.Base64.parse()` returns a WordArray
//     whose `.words`/`.sigBytes` preserve every byte exactly. We then project
//     that into a `Uint8Array` via `bytesToUint8Array()` (byte-perfect, no
//     Latin-1 round-trip). This is the same approach vladikit-bit used in
//     simpsonsua.tv.js / uakino.js / uaserials.pro.js.
//   - For bytes → UTF-8 string : a hand-rolled `utf8FromBytes()` walks the
//     Uint8Array and emits the correct code units (incl. 4-byte surrogate
//     pairs), because `TextDecoder` is unavailable in goja.
//
// All Tortuga decryption therefore happens in the byte domain and only the
// final plaintext is ever converted to a JS string — keeping Cyrillic titles,
// subtitle URLs and JSON keys intact.

const { CryptoJS } = require("crypto-js");

// =====================================================================
// Byte / encoding helpers
// =====================================================================

/**
 * Project a CryptoJS WordArray into a Uint8Array without ever round-tripping
 * through a Latin-1 JS string. This is the safe replacement for `atob()`.
 */
function bytesToUint8Array(wordArray) {
    const words = wordArray.words;
    const sigBytes = wordArray.sigBytes;
    const u8 = new Uint8Array(sigBytes);
    for (let i = 0; i < sigBytes; i++) {
        u8[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
    }
    return u8;
}

/**
 * Decode a Base64 string into a Uint8Array of raw bytes.
 * Mirrors Kotlin's Base64.decode but routes through CryptoJS so that the
 * byte stream is never corrupted by the goja string layer.
 *
 * @param {string} b64       Base64 input (padding optional, url-safe chars NOT accepted).
 * @param {boolean} keepNonB64 If false (default), strip everything outside [A-Za-z0-9+/]
 *                              matching Kotlin's `[^A-Za-z0-9+/]` cleanup in torDecrypt.
 */
function base64ToBytes(b64, keepNonB64) {
    let s = String(b64 || "");
    if (!keepNonB64) {
        s = s.replace(/[^A-Za-z0-9+/]/g, "");
    }
    // Re-pad to a multiple of 4 (Base64 invariant). Matches Kotlin's
    //   val pad = cleaned.length % 4
    //   cleanEncoded = cleaned + if (pad > 1) "=".repeat(4 - pad) else ""
    const pad = s.length % 4;
    if (pad > 1) {
        s = s + "=".repeat(4 - pad);
    } else if (pad === 1) {
        // Single trailing char is illegal Base64; pad to next multiple anyway.
        s = s + "===";
    }
    const wordArray = CryptoJS.enc.Base64.parse(s);
    return bytesToUint8Array(wordArray);
}

/**
 * Convert a Uint8Array of UTF-8 bytes into a JS string.
 *
 * goja does not expose TextDecoder, so we decode UTF-8 manually. This handles
 * 1/2/3/4-byte sequences and emits surrogate pairs for code points above the
 * BMP — exactly what TextDecoder('utf-8') would do.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function utf8FromBytes(bytes) {
    let result = "";
    let i = 0;
    const len = bytes.length;
    while (i < len) {
        const b1 = bytes[i++];
        if (b1 < 0x80) {
            // ASCII fast path
            result += String.fromCharCode(b1);
        } else if (b1 < 0xC0) {
            // Stray continuation byte — replace with U+FFFD (matches TextDecoder).
            result += "\uFFFD";
        } else if (b1 < 0xE0) {
            // 2-byte sequence: 110xxxxx 10xxxxxx
            if (i >= len) { result += "\uFFFD"; break; }
            const b2 = bytes[i++];
            if ((b2 & 0xC0) !== 0x80) { result += "\uFFFD"; continue; }
            const cp = ((b1 & 0x1F) << 6) | (b2 & 0x3F);
            if (cp < 0x80) { result += "\uFFFD"; continue; } // overlong
            result += String.fromCharCode(cp);
        } else if (b1 < 0xF0) {
            // 3-byte sequence: 1110xxxx 10xxxxxx 10xxxxxx
            if (i + 1 >= len) { result += "\uFFFD"; break; }
            const b2 = bytes[i++];
            const b3 = bytes[i++];
            if ((b2 & 0xC0) !== 0x80 || (b3 & 0xC0) !== 0x80) { result += "\uFFFD"; continue; }
            const cp = ((b1 & 0x0F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F);
            if (cp < 0x800) { result += "\uFFFD"; continue; } // overlong
            // 0xD800..0xDFFF are reserved for UTF-16 surrogates; reject.
            if (cp >= 0xD800 && cp <= 0xDFFF) { result += "\uFFFD"; continue; }
            result += String.fromCharCode(cp);
        } else {
            // 4-byte sequence: 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx
            if (i + 2 >= len) { result += "\uFFFD"; break; }
            const b2 = bytes[i++];
            const b3 = bytes[i++];
            const b4 = bytes[i++];
            if ((b2 & 0xC0) !== 0x80 || (b3 & 0xC0) !== 0x80 || (b4 & 0xC0) !== 0x80) {
                result += "\uFFFD"; continue;
            }
            const cp = ((b1 & 0x07) << 18) | ((b2 & 0x3F) << 12) | ((b3 & 0x3F) << 6) | (b4 & 0x3F);
            if (cp < 0x10000 || cp > 0x10FFFF) { result += "\uFFFD"; continue; } // overlong / out of range
            // Emit UTF-16 surrogate pair.
            const adjusted = cp - 0x10000;
            result += String.fromCharCode(0xD800 | (adjusted >> 10));
            result += String.fromCharCode(0xDC00 | (adjusted & 0x3FF));
        }
    }
    return result;
}

// =====================================================================
// Tortuga Decoder — direct port of SerialnoProvider.Decoder (Kotlin)
// =====================================================================

const Decoder = {
    /**
     * Tortuga XOR cipher (Kotlin: `torDecrypt`).
     *
     * Algorithm:
     *   1. Strip every char outside [A-Za-z0-9+/].
     *   2. Re-pad to a multiple of 4 with '='.
     *   3. Base64-decode to raw bytes.
     *   4. byte[0] is the salt; for each subsequent byte at index i (1-based):
     *        key  = (salt + 7*(i-1) + 13) % 256
     *        plain[i-1] = cipher[i] XOR key
     *   5. Interpret the result as UTF-8.
     *
     * Returns "" on any failure (mirrors Kotlin).
     */
    torDecrypt(encoded) {
        if (!encoded) return "";
        try {
            const bytes = base64ToBytes(encoded, /* keepNonB64 */ false);
            if (bytes.length < 2) return "";

            const salt = bytes[0] & 0xFF;
            const out = new Uint8Array(bytes.length - 1);
            for (let i = 1; i < bytes.length; i++) {
                const f = (salt + 7 * (i - 1) + 13) % 256;
                out[i - 1] = (bytes[i] ^ f) & 0xFF;
            }
            return utf8FromBytes(out);
        } catch (e) {
            return "";
        }
    },

    /**
     * Tortuga XOR cipher (Kotlin: `tortugaDecode` from UASerialsProProvider).
     * Identical cipher, but only trims trailing '=' instead of stripping
     * every non-base64 char. Used as an alternative attempt in decodeAndReverse.
     */
    tortugaDecode(encoded) {
        if (!encoded || encoded === "") return encoded;
        try {
            // Strip only trailing '=' (do NOT strip other non-base64 chars).
            const clean = String(encoded).replace(/=+$/g, "");
            const bytes = base64ToBytes(clean, /* keepNonB64 */ true);
            if (bytes.length === 0) return encoded;

            const salt = bytes[0] & 0xFF;
            const out = new Uint8Array(bytes.length - 1);
            for (let i = 1; i < bytes.length; i++) {
                const key = (salt + 7 * (i - 1) + 13) % 256;
                out[i - 1] = (bytes[i] ^ key) & 0xFF;
            }
            return utf8FromBytes(out);
        } catch (e) {
            return null;
        }
    },

    /**
     * Plain Base64 decode to a UTF-8 string (Kotlin: `decodeBase64`).
     * Tries removing "==" first, then "===" → "=" as a fallback. CryptoJS's
     * Utf8 encoder handles the byte→string conversion correctly.
     */
    decodeBase64(encodedString) {
        const s = String(encodedString || "");
        try {
            const cleaned1 = s.replace(/==/g, "");
            return CryptoJS.enc.Base64.parse(cleaned1).toString(CryptoJS.enc.Utf8);
        } catch (e1) {
            try {
                const cleaned2 = s.replace(/===/g, "=");
                return CryptoJS.enc.Base64.parse(cleaned2).toString(CryptoJS.enc.Utf8);
            } catch (e2) {
                return null;
            }
        }
    },

    /**
     * Reverse a string (Kotlin: `reverseText`).
     */
    reverseText(inputString) {
        return String(inputString).split("").reverse().join("");
    },

    /**
     * Combined decoder entry point (Kotlin: `decodeAndReverse`).
     *
     * Strategy (mirrors SerialnoProvider.Decoder.decodeAndReverse):
     *   1. Try torDecrypt — if the result starts with "http" or "[" (i.e. it
     *      is a URL or a JSON array), return it as-is. This is the happy path
     *      for Tortuga-encoded playlists.
     *   2. Otherwise fall back to plain Base64 decode + reverse (older
     *      UASerials-style obfuscation).
     *
     * Note: UASerialsProProvider also tries `tortugaDecode` first. We try
     * torDecrypt first because the SerialnoProvider variant is the canonical
     * one for this site and its stricter cleanup matches what Tortuga ships.
     */
    decodeAndReverse(encodedString) {
        const decrypted = this.torDecrypt(encodedString);
        if (decrypted && (decrypted.startsWith("http") || decrypted.startsWith("["))) {
            return decrypted;
        }

        // Defensive fallback: also try tortugaDecode (in case Tortuga ever
        // ships a payload with chars torDecrypt's cleanup would destroy).
        const tortuga = this.tortugaDecode(encodedString);
        if (tortuga && (tortuga.startsWith("http") || tortuga.startsWith("["))) {
            return tortuga;
        }

        const decoded = this.decodeBase64(encodedString);
        if (decoded === null || decoded === undefined) return null;
        return this.reverseText(decoded);
    }
};

// =====================================================================
// Tortuga episode-file parser — direct port of parseSerialnoEpisodeFile
// =====================================================================

/**
 * Normalise a Tortuga legacy `file` field of the form:
 *     {Source}https://stream.example/index.m3u8(subtitle:[Ukr]https://.../sub.vtt)
 *
 * Returns { source, streamUrl, subtitle } or null if unparseable.
 *
 * NOTE: We deliberately do NOT use Kotlin's substringAfter/substringBefore
//       helpers (they don't exist in JS — the klontv.js port has a bug here).
 *       Plain indexOf/substring is used instead.
 */
function parseSerialnoEpisodeFile(rawFile) {
    const raw = String(rawFile || "").trim();
    if (raw === "") return null;

    let source = "Цікава Ідея"; // matches Kotlin's default
    let streamAndSubtitle = raw;

    if (raw.charAt(0) === "{") {
        const after = raw.substring(1);
        const closeIdx = after.indexOf("}");
        if (closeIdx > 0) {
            const src = after.substring(0, closeIdx).trim();
            if (src !== "") source = src;
            streamAndSubtitle = after.substring(closeIdx + 1);
        }
    }

    const subtitleMarker = streamAndSubtitle.toLowerCase().indexOf("(subtitle:");
    let streamUrl, subtitle;
    if (subtitleMarker >= 0) {
        streamUrl = streamAndSubtitle.substring(0, subtitleMarker);
        const afterMarker = streamAndSubtitle.substring(subtitleMarker + "(subtitle:".length);
        // Strip trailing ")" if present.
        subtitle = afterMarker.endsWith(")")
            ? afterMarker.substring(0, afterMarker.length - 1).trim()
            : afterMarker.trim();
        if (subtitle === "") subtitle = null;
    } else {
        streamUrl = streamAndSubtitle;
        subtitle = null;
    }

    streamUrl = streamUrl.trim();
    if (streamUrl === "") return null;

    return { source: source, streamUrl: streamUrl, subtitle: subtitle };
}

// =====================================================================
// URL / TLS helpers
// =====================================================================

const BASE_URL = "https://serialno.tv";

function fixUrl(url, base) {
    const b = base || BASE_URL;
    if (!url) return "";
    url = String(url).trim();
    if (url === "") return "";
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("//")) return "https:" + url;
    if (url.charAt(0) === "/") return b + url;
    return b + "/" + url;
}

/**
 * Some tortuga.tw / tortuga.wtf endpoints reject Miru's default TLS handshake
 * (the user's miru-core fork on `feat/default-tls-client` mitigates this by
 * routing every V1 request through the Chrome-133 TLS profile, but upstream
 * Miru does not). Downgrade known-broken Tortuga hosts to plain HTTP, which
 * the player endpoints accept without complaint.
 *
 * This matches the same trick used in simpsonsua.tv.js / uaserials.pro.js.
 */
function fixTls(url) {
    if (!url) return url;
    if (typeof url !== "string") return url;
    if (url.indexOf("tortuga.tw") !== -1 || url.indexOf("tortuga.wtf") !== -1) {
        return url.replace(/^https:\/\//i, "http://");
    }
    return url;
}

/**
 * Pick the correct Referer for a Tortuga HLS stream.
 * Kotlin hard-codes `https://tortuga.wtf/`, but if the stream is actually
 * served from `tortuga.tw` we use that origin instead (some endpoints are
 * picky about the exact Referer host).
 */
function refererForStream(streamUrl) {
    if (streamUrl && streamUrl.indexOf("tortuga.tw") !== -1) {
        return "https://tortuga.tw/";
    }
    return "https://tortuga.wtf/";
}

// =====================================================================
// DOM query helpers (defensive — V1Element.querySelector throws if not found)
// =====================================================================

/**
 * linkedom returns `null` from `document.querySelector(sel)` when no element
 * matches; the V1 runtime then does `null.outerHTML`, which throws TypeError.
 * We swallow that and return null instead so callers can `.map()` safely.
 */
function safeQs(extension, html, selector) {
    try {
        const el = extension.querySelector(html, selector);
        // Verify the underlying document actually has content.
        if (!el || !el.document || !el.content) return null;
        return el;
    } catch (e) {
        return null;
    }
}

function safeText(el) {
    try {
        return el && el.text ? String(el.text).trim() : "";
    } catch (e) {
        return "";
    }
}

function safeAttr(el, attr) {
    try {
        if (!el || !el.getAttributeText) return null;
        const v = el.getAttributeText(attr);
        return v ? String(v).trim() : null;
    } catch (e) {
        return null;
    }
}

/**
 * Concatenate the innerHTML of every <script> tag in `html`.
 *
 * Miru's V1 querySelectorAll returns V1Element[] where each element has an
 * `innerHTML` getter that returns the script's body (without the <script>
 * tags themselves). Tortuga's obfuscated `file:'...'` payload lives inline
 * in one of these scripts, so we glue them all together and regex over the
 * combined text — robust against script ordering and the occasional extra
 * analytics script.
 */
function concatScripts(extension, html) {
    const htmlStr = typeof html === "string" ? html : "";
    if (htmlStr === "") return "";
    const scripts = extension.querySelectorAll(htmlStr, "script");
    if (!scripts || scripts.length === 0) return "";
    let out = "";
    for (let i = 0; i < scripts.length; i++) {
        try {
            const s = scripts[i];
            // innerHTML is the raw script body; outerHTML includes the tags.
            const body = s.innerHTML || s.text || s.outerHTML || "";
            out += "\n" + body;
        } catch (e) {
            // ignore individual broken scripts
        }
    }
    return out;
}

// The exact regex from SerialnoProvider.kt — matches `file: '...'` / `file:"..."`.
const FILE_REGEX = /file\s*:\s*["']([^"',']+?)["']/;

/**
 * Fetch a Tortuga player page and decode its `file:'...'` payload.
 * Returns the decoded string (URL or JSON array) or null.
 */
async function fetchDecodedPlayer(extension, playerUrl) {
    const tlsSafe = fixTls(fixUrl(playerUrl));
    const html = await extension.fetch(tlsSafe, {
        headers: { "Referer": BASE_URL + "/" }
    });
    const htmlStr = typeof html === "string" ? html : "";
    if (htmlStr === "") return null;

    const scriptText = concatScripts(extension, htmlStr);
    const match = FILE_REGEX.exec(scriptText);
    if (!match || !match[1]) return null;

    return Decoder.decodeAndReverse(match[1]);
}

// =====================================================================
// Extension
// =====================================================================

class Serialno extends Extension {

    /**
     * Wrapper around this.request that allows absolute URLs via the
     * `Miru-Url` header trick documented in runtime_v1.js. The Miru host
     * strips that header before issuing the request and uses its value as
     * the actual URL, leaving `this.webSite` untouched.
     */
    async fetch(url, opts) {
        opts = opts || {};
        if (url && typeof url === "string" && url.indexOf("http") === 0) {
            opts.headers = opts.headers || {};
            // Don't overwrite an explicit Miru-Url if the caller set one.
            if (!opts.headers["Miru-Url"]) {
                opts.headers["Miru-Url"] = url;
                return this.request("", opts);
            }
        }
        return this.request(url, opts);
    }

    // -----------------------------------------------------------------
    // latest — main page sections (Серіали / Мультсеріали / Міні-серіали)
    // -----------------------------------------------------------------
    async latest(page) {
        const p = page || 1;
        const sections = [
            { url: "/series/page/" + p + "/",        name: "Серіали" },
            { url: "/cartoons/page/" + p + "/",       name: "Мультсеріали" },
            { url: "/mini-serials/page/" + p + "/",   name: "Міні-серіали" }
        ];

        // Fire all three section fetches in parallel — Tortuga pages can be
        // slow, and this cuts latest() latency by ~3x.
        const responses = await Promise.all(sections.map(async (s) => {
            try {
                const r = await this.fetch(s.url, {
                    headers: { "Referer": BASE_URL + "/" }
                });
                return typeof r === "string" ? r : "";
            } catch (e) {
                return "";
            }
        }));

        const out = [];
        for (let i = 0; i < responses.length; i++) {
            const html = responses[i];
            if (!html) continue;
            const items = this.querySelectorAll(html, ".th-item");
            if (!items) continue;
            for (let j = 0; j < items.length; j++) {
                const el = items[j];
                const titleEl = el.querySelector(".th-title");
                const linkEl  = el.querySelector(".th-in");
                const imgEl   = el.querySelector(".img-fit img");
                const href = safeAttr(linkEl, "href");
                const title = safeText(titleEl);
                const coverSrc = safeAttr(imgEl, "data-src") || safeAttr(imgEl, "src");
                if (!title || !href) continue;
                out.push({
                    title: title,
                    url: fixUrl(href),
                    cover: fixUrl(coverSrc),
                    update: sections[i].name
                });
            }
        }
        return out;
    }

    // -----------------------------------------------------------------
    // search — DLE-style POST to /?do=search&subaction=search&story=...
    // -----------------------------------------------------------------
    async search(kw, page, filter) {
        const query = String(kw || "").trim();
        if (query === "") return [];

        // Kotlin does `query.replace(" ", "+")`. We replicate that here so
        // the request body is byte-identical to what serialno.tv expects.
        const story = query.replace(/\s+/g, "+");
        const body = "do=search&subaction=search&story=" + encodeURIComponent(story);

        const res = await this.request("/", {
            method: "POST",
            body: body,
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": BASE_URL + "/",
                "Origin": BASE_URL,
                "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
            }
        });

        const html = typeof res === "string" ? res : "";
        const items = this.querySelectorAll(html, ".th-item");
        if (!items) return [];

        const out = [];
        for (let i = 0; i < items.length; i++) {
            const el = items[i];
            const titleEl = el.querySelector(".th-title");
            const linkEl  = el.querySelector(".th-in");
            const imgEl   = el.querySelector(".img-fit img");
            const href = safeAttr(linkEl, "href");
            const title = safeText(titleEl);
            const coverSrc = safeAttr(imgEl, "data-src") || safeAttr(imgEl, "src");
            if (!title || !href) continue;
            out.push({
                title: title,
                url: fixUrl(href),
                cover: fixUrl(coverSrc)
            });
        }
        return out;
    }

    // -----------------------------------------------------------------
    // detail — scrape series page, find player iframe, decode playlist
    // -----------------------------------------------------------------
    async detail(url) {
        const html = await this.fetch(url, {
            headers: { "Referer": BASE_URL + "/" }
        });
        const htmlStr = typeof html === "string" ? html : "";

        // Title
        const titleEl = safeQs(this, htmlStr, ".full h1");
        const title = safeText(titleEl) || "Без назви";

        // Poster
        const posterEl = safeQs(this, htmlStr, ".fposter a");
        const poster = fixUrl(safeAttr(posterEl, "href"));

        // Description
        const descEl = safeQs(this, htmlStr, ".full-text");
        let desc = safeText(descEl);

        // General info list — year and tags live in .flist li
        const flist = this.querySelectorAll(htmlStr, ".flist li") || [];
        let year = null;
        const tags = [];
        if (flist.length > 4) {
            const yearEl = safeQs(this, flist[1].outerHTML, "a");
            year = parseInt(safeText(yearEl), 10) || null;
            const tagLinks = this.querySelectorAll(flist[4].outerHTML, "a") || [];
            for (let i = 0; i < tagLinks.length; i++) {
                const t = safeText(tagLinks[i]);
                if (t) tags.push(t);
            }
        } else if (flist.length > 3) {
            const yearEl = safeQs(this, flist[1].outerHTML, "a");
            year = parseInt(safeText(yearEl), 10) || null;
            const tagLinks = this.querySelectorAll(flist[3].outerHTML, "a") || [];
            for (let i = 0; i < tagLinks.length; i++) {
                const t = safeText(tagLinks[i]);
                if (t) tags.push(t);
            }
        }

        // Build the description block we hand back to Miru.
        const descLines = [];
        if (year) descLines.push("Рік: " + year);
        if (tags.length > 0) descLines.push("Жанри: " + tags.join(", "));
        if (desc) descLines.push(desc);
        const fullDesc = descLines.join("\n");

        // Player iframe (Tortuga)
        const playerUrlRaw = this.getAttributeText(htmlStr, "div.video-box iframe", "src");
        const playerUrl = playerUrlRaw ? fixUrl(playerUrlRaw) : null;

        // Episodes
        const episodes = [];
        if (playerUrl) {
            try {
                const decoded = await fetchDecodedPlayer(this, playerUrl);
                if (decoded) {
                    let parsed = null;
                    try {
                        parsed = JSON.parse(decoded);
                    } catch (e) {
                        // Sometimes the decoded string has trailing junk.
                        // Try slicing to the last ']' like UASerials does.
                        const lastBracket = decoded.lastIndexOf("]");
                        if (lastBracket > 0) {
                            try {
                                parsed = JSON.parse(decoded.substring(0, lastBracket + 1));
                            } catch (e2) {
                                parsed = null;
                            }
                        }
                    }

                    if (Array.isArray(parsed)) {
                        for (let s = 0; s < parsed.length; s++) {
                            const season = parsed[s];
                            if (!season || !season.folder || !Array.isArray(season.folder)) continue;
                            const seasonTitle = String(season.title || ("Сезон " + (season.season || (s + 1))));
                            const urls = [];
                            for (let e = 0; e < season.folder.length; e++) {
                                const ep = season.folder[e];
                                if (!ep || !ep.file) continue;
                                const epTitle = String(ep.title || ("Епізод " + (ep.number || (e + 1))));
                                // Encode state for watch(): series:<playerUrl>|<season>|<episode>
                                const state = "series:" + playerUrl + "|" + seasonTitle + "|" + epTitle;
                                urls.push({
                                    name: epTitle,
                                    url: state,
                                    cover: ep.poster ? fixUrl(ep.poster) : null
                                });
                            }
                            if (urls.length > 0) {
                                episodes.push({ title: seasonTitle, urls: urls });
                            }
                        }
                    }
                }
            } catch (e) {
                // Fall through to the movie fallback below.
                console.log("Serialno detail player error:", e && e.message);
            }
        }

        // Fallback: if we couldn't parse episodes, surface a single "Watch" entry
        // pointing at the player iframe. watch() will resolve it as a movie.
        if (episodes.length === 0 && playerUrl) {
            episodes.push({
                title: "Дивитися",
                urls: [{ name: "Відтворити", url: "movie:" + playerUrl }]
            });
        }

        return {
            title: title,
            cover: poster,
            desc: fullDesc,
            episodes: episodes
        };
    }

    // -----------------------------------------------------------------
    // watch — resolve an episode/movie state into a final HLS URL.
    // -----------------------------------------------------------------
    async watch(url) {
        if (typeof url !== "string") {
            throw new Error("Invalid watch URL: " + url);
        }

        // Movie fallback: state = "movie:<playerUrl>"
        if (url.indexOf("movie:") === 0) {
            const playerUrl = url.substring("movie:".length);
            const decoded = await fetchDecodedPlayer(this, playerUrl);
            if (!decoded) throw new Error("Could not decode player for movie");

            // Try to find the first playable stream in the playlist.
            let parsed = null;
            try { parsed = JSON.parse(decoded); } catch (e) {
                const lastBracket = decoded.lastIndexOf("]");
                if (lastBracket > 0) {
                    try { parsed = JSON.parse(decoded.substring(0, lastBracket + 1)); } catch (e2) {}
                }
            }

            if (Array.isArray(parsed)) {
                for (let s = 0; s < parsed.length; s++) {
                    const season = parsed[s];
                    if (!season || !Array.isArray(season.folder)) continue;
                    for (let e = 0; e < season.folder.length; e++) {
                        const ep = season.folder[e];
                        if (ep && ep.file) {
                            return this.buildWatchResponse(ep.file);
                        }
                    }
                }
            }

            // Not a JSON playlist — treat the decoded value as a direct URL.
            if (decoded.indexOf("http") === 0) {
                return this.buildWatchResponse(decoded);
            }
            throw new Error("No playable stream found in player");
        }

        // Series state: "series:<playerUrl>|<seasonTitle>|<episodeTitle>"
        if (url.indexOf("series:") === 0) {
            const state = url.substring("series:".length);
            const firstPipe = state.indexOf("|");
            if (firstPipe < 0) throw new Error("Invalid series state: " + url);
            const playerUrl = state.substring(0, firstPipe);
            const rest = state.substring(firstPipe + 1);
            const secondPipe = rest.indexOf("|");
            if (secondPipe < 0) throw new Error("Invalid series state: " + url);
            const seasonTitle = rest.substring(0, secondPipe);
            const episodeTitle = rest.substring(secondPipe + 1);

            const decoded = await fetchDecodedPlayer(this, playerUrl);
            if (!decoded) throw new Error("Could not decode player for series");

            let parsed = null;
            try { parsed = JSON.parse(decoded); } catch (e) {
                const lastBracket = decoded.lastIndexOf("]");
                if (lastBracket > 0) {
                    try { parsed = JSON.parse(decoded.substring(0, lastBracket + 1)); } catch (e2) {}
                }
            }

            if (!Array.isArray(parsed)) {
                throw new Error("Expected JSON playlist from player");
            }

            // Find the requested season (match by title, fall back to season number).
            let season = null;
            for (let i = 0; i < parsed.length; i++) {
                const s = parsed[i];
                if (!s) continue;
                if (String(s.title) === seasonTitle) { season = s; break; }
            }
            if (!season) season = parsed[0];
            if (!season || !Array.isArray(season.folder)) {
                throw new Error("Season not found: " + seasonTitle);
            }

            // Find the requested episode (match by title, fall back to first).
            let episode = null;
            for (let i = 0; i < season.folder.length; i++) {
                const e = season.folder[i];
                if (e && String(e.title) === episodeTitle) { episode = e; break; }
            }
            if (!episode) episode = season.folder[0];
            if (!episode || !episode.file) {
                throw new Error("Episode not found: " + episodeTitle);
            }

            return this.buildWatchResponse(episode.file);
        }

        // Direct URL fallback — assume HLS.
        return this.buildWatchResponse(url);
    }

    /**
     * Build the V1 watch() return value from a Tortuga `file` field
     * (either a plain URL or a `{Source}streamUrl(subtitle:[Lang]url)` string).
     */
    buildWatchResponse(rawFile) {
        const parsed = parseSerialnoEpisodeFile(rawFile);
        if (!parsed) throw new Error("Could not parse episode file: " + rawFile);

        const streamUrl = fixTls(parsed.streamUrl);
        const headers = { "Referer": refererForStream(parsed.streamUrl) };

        const response = {
            type: streamUrl.indexOf(".m3u8") !== -1 ? "hls" : "mp4",
            url: streamUrl,
            headers: headers
        };

        if (parsed.subtitle) {
            // Format: [Lang]url  (e.g. "[Українські]https://tortuga.tw/.../sub.vtt")
            const sub = parsed.subtitle;
            const closeIdx = sub.indexOf("]");
            let lang = "Субтитри";
            let subUrl = sub;
            if (sub.charAt(0) === "[" && closeIdx > 0) {
                lang = sub.substring(1, closeIdx);
                subUrl = sub.substring(closeIdx + 1);
            }
            subUrl = subUrl.trim();
            if (subUrl) {
                response.subtitles = [{
                    title: lang,
                    url: fixTls(subUrl)
                }];
            }
        }

        return response;
    }

    // -----------------------------------------------------------------
    // createFilter / load — no-op stubs required by the V1 contract.
    // -----------------------------------------------------------------
    async createFilter(filter) {
        return {};
    }

    async load() {
        // No persistent state to initialise. Miru disposes the VM after
        // every call anyway — anything we cache here would be lost.
    }
}
