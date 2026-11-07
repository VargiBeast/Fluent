export function buildSafeEmailDocument(html: string, options: { allowRemoteImages: boolean }): string {
  const imagePolicy = options.allowRemoteImages ? "https: data:" : "'none'";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src ${imagePolicy}; base-uri 'none'; form-action 'none'; connect-src 'none'; frame-src 'none'"><style>body{margin:0;font:15px/1.55 Inter,Segoe UI,sans-serif;color:#f5f5fa;background:transparent}a{color:#43b9ff}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;
}
