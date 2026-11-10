import { useEffect, useMemo, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import type { AttachmentMeta, MessageDetail } from "@shared/mail";
import { buildSrcDoc, sanitizeEmailHtml, splitQuoted, textToHtml } from "@/lib/sanitize";
import { attachmentUrl } from "@/lib/mail";
import { useSession } from "@/lib/session";

/** Fetch inline (cid:) images as data URLs so they render inside the locked-down iframe. */
function useCidMap(accountId: string, inline: AttachmentMeta[]) {
  const [map, setMap] = useState<Record<string, string>>({});
  const key = inline.map((a) => a.attachmentId).join(",");
  useEffect(() => {
    let cancelled = false;
    const wanted = inline.filter((a) => a.contentId && a.size < 2_000_000 && /^image\/(png|gif|jpe?g|webp)$/.test(a.mimeType));
    if (!wanted.length) return;
    void Promise.all(wanted.map(async (a) => {
      const res = await fetch(attachmentUrl(accountId, a.messageId, a.attachmentId, a.filename), { credentials: "same-origin" });
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return [a.contentId!, `data:${a.mimeType};base64,${btoa(bin)}`] as const;
    })).then((entries) => {
      if (!cancelled) setMap(Object.fromEntries(entries.filter((e): e is readonly [string, string] => e !== null)));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, key]);
  return map;
}

export function EmailBody({ message, accountId }: { message: MessageDetail; accountId: string }) {
  const { session } = useSession();
  const pref = session?.settings?.privacy.loadRemoteImages ?? "ask";
  const [allowImages, setAllowImages] = useState(pref === "always");
  const [showQuoted, setShowQuoted] = useState(false);
  const [height, setHeight] = useState(80);
  const frame = useRef<HTMLIFrameElement>(null);
  const dark = document.documentElement.classList.contains("dark");
  const cidMap = useCidMap(accountId, message.attachments.filter((a) => a.inline));

  const rendered = useMemo(() => {
    if (message.bodyHtml) {
      const r = sanitizeEmailHtml(message.bodyHtml, { allowRemoteImages: allowImages, cidMap });
      return { ...r, srcDoc: buildSrcDoc(r.html, { dark, rich: r.rich, allowRemoteImages: allowImages, showQuoted }), hasQuote: /gmail_quote|type="cite"|blockquote/i.test(r.html) };
    }
    const { main, quoted } = splitQuoted(message.bodyText ?? "");
    const html = textToHtml(showQuoted && quoted ? `${main}\n\n${quoted}` : main);
    return { html, blockedImages: 0, rich: false, srcDoc: buildSrcDoc(html, { dark, rich: false, allowRemoteImages: false, showQuoted: true }), hasQuote: Boolean(quoted) };
  }, [message.bodyHtml, message.bodyText, allowImages, cidMap, dark, showQuoted]);

  useEffect(() => {
    const f = frame.current;
    if (!f) return;
    let ro: ResizeObserver | undefined;
    const measure = () => {
      const doc = f.contentDocument;
      if (!doc?.body) return;
      setHeight(Math.min(Math.max(doc.documentElement.scrollHeight, 24), 20000));
    };
    const onLoad = () => {
      measure();
      const doc = f.contentDocument;
      if (doc?.body) {
        ro = new ResizeObserver(measure);
        ro.observe(doc.body);
      }
    };
    f.addEventListener("load", onLoad);
    return () => {
      f.removeEventListener("load", onLoad);
      ro?.disconnect();
    };
  }, [rendered.srcDoc]);

  return (
    <div className="space-y-2">
      {rendered.blockedImages > 0 && !allowImages && pref !== "never" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12.5px] text-fg-2">
          <ImageOff className="size-4 text-fg-3" aria-hidden />
          <span className="flex-1">Remote images are hidden to protect your privacy (they can track when you open mail).</span>
          <button type="button" className="font-medium text-accent-400 hover:underline" onClick={() => setAllowImages(true)}>Show images</button>
        </div>
      )}
      <div className={rendered.rich ? "overflow-hidden rounded-xl bg-white" : ""}>
        <iframe
          ref={frame}
          title={`Message from ${message.from.name}`}
          // No allow-scripts: email content can never execute. allow-same-origin only lets FLUENT measure height.
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          srcDoc={rendered.srcDoc}
          className="block w-full border-0"
          style={{ height }}
        />
      </div>
      {rendered.hasQuote && (
        <button type="button" onClick={() => setShowQuoted((v) => !v)} className="rounded-md bg-surface-2 px-2 py-0.5 text-[12px] text-fg-3 hover:text-fg" aria-expanded={showQuoted}>
          {showQuoted ? "Hide quoted text" : "••• Show quoted text"}
        </button>
      )}
    </div>
  );
}
