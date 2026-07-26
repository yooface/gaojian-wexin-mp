export function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlToText(value) {
  return decodeHtml(String(value || "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<(br|\/p|\/div|\/section|\/li|\/h[1-6])\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, ""));
}

export function parseWechatPublishedAt(html) {
  const source = String(html || "");
  const meta = source.match(/<meta[^>]+(?:property|name)=["']article:published_time["'][^>]+content=["']([^"']+)/i)
    || source.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']article:published_time["']/i);
  const variable = [
    /ori_create_time\s*:\s*["']?(\d{10,13})/i,
    /create_time\s*:\s*["']([^"']+)/i,
    /publish_time\s*[:=]\s*["']?(\d{10,13})/i,
    /var\s+ct\s*=\s*["']?(\d{10,13})/i,
  ].map((pattern) => source.match(pattern)).find(Boolean);
  const raw = decodeHtml(meta?.[1] || variable?.[1] || "").trim();
  if (!raw) return "";
  if (/^\d{10,13}$/.test(raw)) {
    const timestamp = Number(raw) * (raw.length === 10 ? 1_000 : 1);
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }
  const normalized = raw.replace(/\//g, "-").replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function htmlAttribute(tag, names) {
  for (const name of names) {
    const quoted = tag.match(new RegExp(`${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
    if (quoted) return decodeHtml(quoted[2]);
    const bare = tag.match(new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, "i"));
    if (bare) return decodeHtml(bare[1]);
  }
  return "";
}

export function extractStructuredBlocks(fragment) {
  const safe = String(fragment || "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  const tokens = safe.match(/<img\b[^>]*>|<\/?(?:p|h[1-6]|blockquote|li|br|section|div)\b[^>]*>|[^<]+/gi) || [];
  const blocks = [];
  let buffer = "";
  let currentType = "paragraph";
  const flush = () => {
    const text = decodeHtml(buffer.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
    if (text) blocks.push({ type: currentType, text });
    buffer = "";
    currentType = "paragraph";
  };
  for (const token of tokens) {
    if (/^<img\b/i.test(token)) {
      flush();
      const src = htmlAttribute(token, ["data-src", "src"]);
      const alt = htmlAttribute(token, ["alt", "title"]);
      const className = htmlAttribute(token, ["class"]);
      const hintedType = htmlAttribute(token, ["data-type", "data-filetype"]);
      const isGif = /\.gif(?:$|\?)/i.test(src) || /gif/i.test(hintedType);
      const isEmoji = /emoji|emotion/i.test(className) || /^(?:\[.+\]|[\p{Extended_Pictographic}])$/u.test(alt);
      blocks.push({ type: isEmoji ? "emoji" : isGif ? "gif" : "image", src, alt, position: blocks.filter((block) => block.text).length });
      continue;
    }
    if (/^<h[1-6]\b/i.test(token)) { flush(); currentType = "heading"; continue; }
    if (/^<(?:p|blockquote|li)\b/i.test(token)) { flush(); currentType = "paragraph"; continue; }
    if (/^<\/(?:p|h[1-6]|blockquote|li)>/i.test(token) || /^<br\b/i.test(token)) { flush(); continue; }
    if (/^<\/?(?:section|div)\b/i.test(token)) { if (buffer.trim()) flush(); continue; }
    buffer += token;
  }
  flush();
  return blocks.slice(0, 800);
}
