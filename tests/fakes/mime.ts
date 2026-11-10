/** Minimal RFC 822 / MIME parser used by the fake Gmail to turn `raw` messages into payload trees. */
export interface FakePart {
  partId: string;
  mimeType: string;
  filename: string;
  headers: Array<{ name: string; value: string }>;
  body: { size: number; data?: string; attachmentId?: string };
  parts?: FakePart[];
}

function splitHeadBody(src: string): [string, string] {
  const idx = src.search(/\r?\n\r?\n/);
  if (idx < 0) return [src, ""];
  const m = src.slice(idx).match(/^\r?\n\r?\n/)!;
  return [src.slice(0, idx), src.slice(idx + m[0].length)];
}

export function parseHeaders(head: string): Array<{ name: string; value: string }> {
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  return unfolded.split(/\r?\n/).filter(Boolean).map((line) => {
    const i = line.indexOf(":");
    return { name: line.slice(0, i).trim(), value: decodeWords(line.slice(i + 1).trim()) };
  });
}

export function decodeWords(v: string): string {
  return v.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, _cs, enc: string, text: string) => {
    if (enc.toUpperCase() === "B") return Buffer.from(text, "base64").toString("utf8");
    return Buffer.from(text.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8");
  });
}

function header(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeBody(body: string, encoding: string): Buffer {
  const enc = encoding.toLowerCase();
  if (enc === "base64") return Buffer.from(body.replace(/\s+/g, ""), "base64");
  if (enc === "quoted-printable") {
    const s = body.replace(/=\r?\n/g, "");
    const bytes: number[] = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "=" && /^[0-9A-F]{2}$/i.test(s.slice(i + 1, i + 3))) {
        bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
        i += 2;
      } else bytes.push(s.charCodeAt(i));
    }
    return Buffer.from(bytes);
  }
  return Buffer.from(body, "utf8");
}

export function parseMime(src: string, partId = "", attachments?: Map<string, Buffer>): FakePart {
  const [head, body] = splitHeadBody(src);
  const headers = parseHeaders(head);
  const ctype = header(headers, "Content-Type") || "text/plain";
  const mimeType = ctype.split(";")[0]!.trim().toLowerCase();
  const disp = header(headers, "Content-Disposition");
  const fnMatch = /filename\*?="?([^";]+)"?/i.exec(disp) ?? /name="?([^";]+)"?/i.exec(ctype);
  const filename = fnMatch ? decodeWords(fnMatch[1]!) : "";
  if (mimeType.startsWith("multipart/")) {
    const boundary = /boundary="?([^";]+)"?/i.exec(ctype)?.[1] ?? "";
    const chunks = body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?\\s*`)).slice(1).filter((c) => c.trim().length > 0);
    return {
      partId,
      mimeType,
      filename: "",
      headers,
      body: { size: 0 },
      parts: chunks.map((c, i) => parseMime(c, partId ? `${partId}.${i}` : String(i), attachments)),
    };
  }
  const data = decodeBody(body, header(headers, "Content-Transfer-Encoding") || "7bit");
  if (filename && attachments) {
    const id = `att-${Math.random().toString(36).slice(2, 12)}`;
    attachments.set(id, data);
    return { partId, mimeType, filename, headers, body: { size: data.length, attachmentId: id } };
  }
  return { partId, mimeType, filename, headers, body: { size: data.length, data: data.toString("base64url") } };
}
