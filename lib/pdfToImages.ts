/**
 * PDF를 브라우저에서 페이지별 PNG 이미지로 바꾼다. (클라이언트 전용)
 * PDF 원본·텍스트 레이어·메타데이터는 서버로 보내지 않고, 여기서 만든 이미지만 가리기 화면으로 넘긴다.
 * pdfjs-dist는 브라우저 전용 API(DOMMatrix 등)를 쓰므로 반드시 동적 import로만 불러온다.
 */

export const PDF_MAX_PAGES = 5;
export const PDF_MAX_LONG_SIDE = 1600;

export class PdfOpenError extends Error {
  constructor() {
    super("열 수 없는 PDF예요");
    this.name = "PdfOpenError";
  }
}

/**
 * pdf.js가 한글 글꼴(CMap)·기본 글꼴·이미지 디코더(wasm)를 읽는 곳.
 * public/ 없이 번들러가 파일을 배포 자산으로 내보내도록 정적 new URL(...)로 가리키고,
 * 실제로 필요할 때만 내려받는다. 목록에 없는 이름은 거절하며 pdf.js는 해당 요소만 건너뛴다.
 */
function createAssetUrls(): Record<string, string> {
  return {
    "cMapUrl:Adobe-Korea1-0.bcmap": new URL("pdfjs-dist/cmaps/Adobe-Korea1-0.bcmap", import.meta.url).toString(),
    "cMapUrl:Adobe-Korea1-1.bcmap": new URL("pdfjs-dist/cmaps/Adobe-Korea1-1.bcmap", import.meta.url).toString(),
    "cMapUrl:Adobe-Korea1-2.bcmap": new URL("pdfjs-dist/cmaps/Adobe-Korea1-2.bcmap", import.meta.url).toString(),
    "cMapUrl:Adobe-Korea1-UCS2.bcmap": new URL("pdfjs-dist/cmaps/Adobe-Korea1-UCS2.bcmap", import.meta.url).toString(),
    "cMapUrl:KSC-EUC-H.bcmap": new URL("pdfjs-dist/cmaps/KSC-EUC-H.bcmap", import.meta.url).toString(),
    "cMapUrl:KSC-EUC-V.bcmap": new URL("pdfjs-dist/cmaps/KSC-EUC-V.bcmap", import.meta.url).toString(),
    "cMapUrl:KSC-H.bcmap": new URL("pdfjs-dist/cmaps/KSC-H.bcmap", import.meta.url).toString(),
    "cMapUrl:KSC-V.bcmap": new URL("pdfjs-dist/cmaps/KSC-V.bcmap", import.meta.url).toString(),
    "cMapUrl:KSCms-UHC-H.bcmap": new URL("pdfjs-dist/cmaps/KSCms-UHC-H.bcmap", import.meta.url).toString(),
    "cMapUrl:KSCms-UHC-V.bcmap": new URL("pdfjs-dist/cmaps/KSCms-UHC-V.bcmap", import.meta.url).toString(),
    "cMapUrl:KSCms-UHC-HW-H.bcmap": new URL("pdfjs-dist/cmaps/KSCms-UHC-HW-H.bcmap", import.meta.url).toString(),
    "cMapUrl:KSCms-UHC-HW-V.bcmap": new URL("pdfjs-dist/cmaps/KSCms-UHC-HW-V.bcmap", import.meta.url).toString(),
    "cMapUrl:KSCpc-EUC-H.bcmap": new URL("pdfjs-dist/cmaps/KSCpc-EUC-H.bcmap", import.meta.url).toString(),
    "cMapUrl:KSCpc-EUC-V.bcmap": new URL("pdfjs-dist/cmaps/KSCpc-EUC-V.bcmap", import.meta.url).toString(),
    "cMapUrl:UniKS-UCS2-H.bcmap": new URL("pdfjs-dist/cmaps/UniKS-UCS2-H.bcmap", import.meta.url).toString(),
    "cMapUrl:UniKS-UCS2-V.bcmap": new URL("pdfjs-dist/cmaps/UniKS-UCS2-V.bcmap", import.meta.url).toString(),
    "cMapUrl:UniKS-UTF16-H.bcmap": new URL("pdfjs-dist/cmaps/UniKS-UTF16-H.bcmap", import.meta.url).toString(),
    "cMapUrl:UniKS-UTF16-V.bcmap": new URL("pdfjs-dist/cmaps/UniKS-UTF16-V.bcmap", import.meta.url).toString(),
    "cMapUrl:Adobe-Japan1-UCS2.bcmap": new URL("pdfjs-dist/cmaps/Adobe-Japan1-UCS2.bcmap", import.meta.url).toString(),
    "cMapUrl:Adobe-GB1-UCS2.bcmap": new URL("pdfjs-dist/cmaps/Adobe-GB1-UCS2.bcmap", import.meta.url).toString(),
    "cMapUrl:Adobe-CNS1-UCS2.bcmap": new URL("pdfjs-dist/cmaps/Adobe-CNS1-UCS2.bcmap", import.meta.url).toString(),
    "standardFontDataUrl:FoxitDingbats.pfb": new URL("pdfjs-dist/standard_fonts/FoxitDingbats.pfb", import.meta.url).toString(),
    "standardFontDataUrl:FoxitFixed.pfb": new URL("pdfjs-dist/standard_fonts/FoxitFixed.pfb", import.meta.url).toString(),
    "standardFontDataUrl:FoxitFixedBold.pfb": new URL("pdfjs-dist/standard_fonts/FoxitFixedBold.pfb", import.meta.url).toString(),
    "standardFontDataUrl:FoxitFixedBoldItalic.pfb": new URL("pdfjs-dist/standard_fonts/FoxitFixedBoldItalic.pfb", import.meta.url).toString(),
    "standardFontDataUrl:FoxitFixedItalic.pfb": new URL("pdfjs-dist/standard_fonts/FoxitFixedItalic.pfb", import.meta.url).toString(),
    "standardFontDataUrl:FoxitSerif.pfb": new URL("pdfjs-dist/standard_fonts/FoxitSerif.pfb", import.meta.url).toString(),
    "standardFontDataUrl:FoxitSerifBold.pfb": new URL("pdfjs-dist/standard_fonts/FoxitSerifBold.pfb", import.meta.url).toString(),
    "standardFontDataUrl:FoxitSerifBoldItalic.pfb": new URL("pdfjs-dist/standard_fonts/FoxitSerifBoldItalic.pfb", import.meta.url).toString(),
    "standardFontDataUrl:FoxitSerifItalic.pfb": new URL("pdfjs-dist/standard_fonts/FoxitSerifItalic.pfb", import.meta.url).toString(),
    "standardFontDataUrl:FoxitSymbol.pfb": new URL("pdfjs-dist/standard_fonts/FoxitSymbol.pfb", import.meta.url).toString(),
    "standardFontDataUrl:LiberationSans-Bold.ttf": new URL("pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf", import.meta.url).toString(),
    "standardFontDataUrl:LiberationSans-BoldItalic.ttf": new URL("pdfjs-dist/standard_fonts/LiberationSans-BoldItalic.ttf", import.meta.url).toString(),
    "standardFontDataUrl:LiberationSans-Italic.ttf": new URL("pdfjs-dist/standard_fonts/LiberationSans-Italic.ttf", import.meta.url).toString(),
    "standardFontDataUrl:LiberationSans-Regular.ttf": new URL("pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf", import.meta.url).toString(),
    "wasmUrl:jbig2.wasm": new URL("pdfjs-dist/wasm/jbig2.wasm", import.meta.url).toString(),
    "wasmUrl:openjpeg.wasm": new URL("pdfjs-dist/wasm/openjpeg.wasm", import.meta.url).toString(),
    "wasmUrl:qcms_bg.wasm": new URL("pdfjs-dist/wasm/qcms_bg.wasm", import.meta.url).toString(),
  };
}

function createBinaryDataFactory() {
  const urls = createAssetUrls();

  return class BundledBinaryDataFactory {
    async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
      const url = urls[`${kind}:${filename}`];
      if (!url) throw new Error(`Unavailable pdf.js asset: ${kind}`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to load pdf.js asset: ${kind}`);
      return new Uint8Array(await response.arrayBuffer());
    }
  };
}

export interface PdfPages {
  files: File[];
  totalPages: number;
  truncated: boolean;
}

export async function pdfToImages(file: File): Promise<PdfPages> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const baseName = file.name.replace(/\.pdf$/i, "") || "pdf";
  const pages: File[] = [];
  let task: ReturnType<typeof pdfjs.getDocument> | null = null;

  try {
    const data = new Uint8Array(await file.arrayBuffer());
    // 암호가 걸린 PDF는 onPassword가 없어 여기서 거절된다.
    task = pdfjs.getDocument({
      data,
      BinaryDataFactory: createBinaryDataFactory(),
    });
    const doc = await task.promise;

    const totalPages = doc.numPages;
    const count = Math.min(totalPages, PDF_MAX_PAGES);

    for (let n = 1; n <= count; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(
        PDF_MAX_LONG_SIDE / Math.max(base.width, base.height),
        4 // 아주 작은 페이지가 과하게 커지지 않게
      );
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas unavailable");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: ctx, canvas, viewport }).promise;
      page.cleanup();

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) throw new Error("toBlob failed");

      pages.push(new File([blob], `${baseName}-${n}쪽.png`, { type: "image/png" }));
    }

    return { files: pages, totalPages, truncated: totalPages > PDF_MAX_PAGES };
  } catch {
    throw new PdfOpenError();
  } finally {
    // 문서와 워커 리소스를 해제한다.
    if (task) {
      await task.destroy();
    }
  }
}
