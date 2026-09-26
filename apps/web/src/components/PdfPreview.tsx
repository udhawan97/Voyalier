import { useEffect, useRef, useState, type CSSProperties } from "react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { Button } from "./Button";

type PreviewStatus = "loading" | "rendering" | "ready" | "error";

const MAX_PDF_IMAGE_PIXELS = 8_000_000;
const MAX_PDF_CANVAS_BYTES = MAX_PDF_IMAGE_PIXELS * 4;
const MAX_CANVAS_EDGE = 4_096;
const MAX_CANVAS_PIXELS = 8_000_000;
const MAX_DISPLAY_EDGE = 2_048;

type PdfRenderer = typeof import("pdfjs-dist");

function loadPdfRenderer(): Promise<PdfRenderer> {
  return import("pdfjs-dist");
}

function validDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function PdfPreview({
  contentBase64,
  label,
  loadRenderer = loadPdfRenderer,
}: {
  contentBase64: string;
  label: string;
  loadRenderer?: () => Promise<PdfRenderer>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [status, setStatus] = useState<PreviewStatus>("loading");

  useEffect(() => {
    let active = true;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    void (async () => {
      try {
        setStatus("loading");
        const pdfjs = await loadRenderer();
        if (!active) return;
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        loadingTask = pdfjs.getDocument({
          data: decodeBase64(contentBase64),
          maxImageSize: MAX_PDF_IMAGE_PIXELS,
          canvasMaxAreaInBytes: MAX_PDF_CANVAS_BYTES,
          stopAtErrors: true,
          useSystemFonts: true,
          useWorkerFetch: false,
        });
        const loaded = await loadingTask.promise;
        if (!active) return;
        setDocument(loaded);
        setPageCount(loaded.numPages);
        setPageNumber(1);
      } catch {
        if (active) setStatus("error");
      }
    })();

    return () => {
      active = false;
      if (loadingTask) void loadingTask.destroy().catch(() => undefined);
    };
  }, [contentBase64, loadRenderer]);

  useEffect(() => {
    if (!document || !canvas.current) return;
    let active = true;
    let renderTask: RenderTask | null = null;

    void (async () => {
      try {
        setStatus("rendering");
        const page = await document.getPage(pageNumber);
        if (!active || !canvas.current) return;
        const baseViewport = page.getViewport({ scale: 1 });
        if (
          !validDimension(baseViewport.width) ||
          !validDimension(baseViewport.height)
        ) {
          throw new Error("PDF page dimensions are invalid");
        }
        const availableWidth = Math.min(
          canvas.current.parentElement?.clientWidth || baseViewport.width,
          720,
        );
        const displayScale = Math.min(
          availableWidth / baseViewport.width,
          MAX_DISPLAY_EDGE / baseViewport.width,
          MAX_DISPLAY_EDGE / baseViewport.height,
        );
        if (!validDimension(displayScale)) {
          throw new Error("PDF display scale is invalid");
        }
        const deviceScale = globalThis.devicePixelRatio || 1;
        const outputScale = Number.isFinite(deviceScale)
          ? Math.max(1, Math.min(deviceScale, 2))
          : 1;
        const requestedScale = displayScale * outputScale;
        let renderViewport = page.getViewport({ scale: requestedScale });
        if (
          !validDimension(renderViewport.width) ||
          !validDimension(renderViewport.height)
        ) {
          throw new Error("PDF render dimensions are invalid");
        }
        const pixelScale = Math.min(
          1,
          MAX_CANVAS_EDGE / renderViewport.width,
          MAX_CANVAS_EDGE / renderViewport.height,
          Math.sqrt(
            MAX_CANVAS_PIXELS / (renderViewport.width * renderViewport.height),
          ),
        );
        if (!validDimension(pixelScale)) {
          throw new Error("PDF render scale is invalid");
        }
        if (pixelScale < 1) {
          renderViewport = page.getViewport({
            scale: requestedScale * pixelScale,
          });
        }
        const canvasWidth = Math.max(1, Math.ceil(renderViewport.width));
        const canvasHeight = Math.max(1, Math.ceil(renderViewport.height));
        if (
          !validDimension(canvasWidth) ||
          !validDimension(canvasHeight) ||
          canvasWidth > MAX_CANVAS_EDGE ||
          canvasHeight > MAX_CANVAS_EDGE ||
          canvasWidth * canvasHeight > MAX_CANVAS_PIXELS
        ) {
          throw new Error("PDF canvas exceeds the preview budget");
        }
        const context = canvas.current.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas rendering is unavailable");

        canvas.current.width = canvasWidth;
        canvas.current.height = canvasHeight;
        canvas.current.style.width = `${Math.max(1, Math.floor(baseViewport.width * displayScale))}px`;
        canvas.current.style.height = `${Math.max(1, Math.floor(baseViewport.height * displayScale))}px`;
        renderTask = page.render({
          canvas: canvas.current,
          canvasContext: context,
          viewport: renderViewport,
          background: "#ffffff",
        });
        await renderTask.promise;
        if (active) setStatus("ready");
      } catch (caught) {
        if (
          active &&
          !(
            caught instanceof Error &&
            caught.name === "RenderingCancelledException"
          )
        ) {
          setStatus("error");
        }
      }
    })();

    return () => {
      active = false;
      renderTask?.cancel();
    };
  }, [document, pageNumber]);

  const progressText =
    status === "loading"
      ? "Loading PDF preview…"
      : status === "rendering"
        ? `Rendering page ${pageNumber}…`
        : `Page ${pageNumber} of ${pageCount}`;

  return (
    <div
      className="voy-concierge__file-preview voy-concierge__file-preview--pdf"
      role="region"
      aria-label={`Preview of ${label}`}
    >
      {status === "error" ? (
        <p className="voy-concierge__pdf-error" role="alert">
          Voyalier couldn’t render this PDF preview. Save a copy to open it in
          another app.
        </p>
      ) : (
        <>
          <canvas
            ref={canvas}
            className="voy-concierge__pdf-canvas"
            title={`Preview of ${label}`}
            aria-label={
              pageCount > 0 ? `Page ${pageNumber} of ${pageCount}` : "PDF page"
            }
          />
          <p
            className="voy-concierge__pdf-status"
            role="status"
            style={
              {
                "--voy-pdf-visible": status === "ready" ? 1 : 0.72,
              } as CSSProperties
            }
          >
            {progressText}
          </p>
          {pageCount > 1 ? (
            <div className="voy-concierge__pdf-pages" aria-label="PDF pages">
              <Button
                variant="secondary"
                disabled={pageNumber === 1 || status === "rendering"}
                onClick={() => setPageNumber((current) => current - 1)}
              >
                Previous page
              </Button>
              <Button
                variant="secondary"
                disabled={pageNumber === pageCount || status === "rendering"}
                onClick={() => setPageNumber((current) => current + 1)}
              >
                Next page
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
