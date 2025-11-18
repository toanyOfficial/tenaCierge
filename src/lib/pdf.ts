export type PdfOptions = {
  title: string;
  bodyHtml: string;
};

export function buildPdfTemplate({ title, bodyHtml }: PdfOptions) {
  return `<!doctype html>
  <html lang="ko">
    <head>
      <meta charset="utf-8" />
      <style>
        body { font-family: 'Pretendard', sans-serif; margin: 40px; }
        h1 { font-size: 20px; margin-bottom: 24px; }
      </style>
    </head>
    <body>
      <h1>${title}</h1>
      <div>${bodyHtml}</div>
    </body>
  </html>`;
}
