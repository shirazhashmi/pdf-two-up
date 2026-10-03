import { useRef, useState } from "react";
import { PDFDocument, PDFPage } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import JSZip from "jszip";
import "./App.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

type Crop = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type BatchPdf = {
  path: string;
  name: string;
  bytes: Uint8Array;
};

type SourceType = "pdf" | "zip" | null;

const MM_TO_PT = 72 / 25.4;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [sourceType, setSourceType] = useState<SourceType>(null);
  const [sourceName, setSourceName] = useState("");
  const [previewName, setPreviewName] = useState("");

  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [batchFiles, setBatchFiles] = useState<BatchPdf[]>([]);

  const [pageCount, setPageCount] = useState(0);
  const [pageWidth, setPageWidth] = useState(0);
  const [pageHeight, setPageHeight] = useState(0);

  const [crop, setCrop] = useState<Crop>({
    left: 0,
    top: 6,
    width: 100,
    height: 36,
  });

  const [margin, setMargin] = useState(10);
  const [spacing, setSpacing] = useState(15);

  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  async function renderPreview(bytes: Uint8Array) {
    const pdf = await pdfjsLib.getDocument({
      data: bytes.slice(),
    }).promise;

    setPageCount(pdf.numPages);

    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 1 });

    setPageWidth(vp.width);
    setPageHeight(vp.height);

    const scale = 800 / vp.width;
    const viewport = page.getViewport({ scale });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", {
      willReadFrequently: true,
    });

    if (!ctx) return;

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvas,
      canvasContext: ctx,
      viewport,
    }).promise;
  }

  async function loadInput(file: File) {
    try {
      setStatus("Reading file...");
      setProgress(0);

      const lower = file.name.toLowerCase();

      if (lower.endsWith(".pdf")) {
        const bytes = new Uint8Array(await file.arrayBuffer());

        setSourceType("pdf");
        setSourceName(file.name);
        setPreviewName(file.name);
        setBatchFiles([]);
        setPdfBytes(bytes);

        await renderPreview(bytes);

        setStatus("");
        return;
      }

      if (lower.endsWith(".zip")) {
        setStatus("Reading ZIP...");

        const zip = await JSZip.loadAsync(file);

        const entries = Object.values(zip.files).filter((entry) => {
          const name = entry.name.toLowerCase();

          return (
            !entry.dir &&
            name.endsWith(".pdf") &&
            !name.startsWith("__macosx/") &&
            !name.includes("/__macosx/")
          );
        });

        if (entries.length === 0) {
          throw new Error("No PDF files were found inside this ZIP.");
        }

        const files: BatchPdf[] = [];

        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];

          setStatus(
            `Loading PDF ${i + 1} of ${entries.length}: ${entry.name}`
          );

          const bytes = await entry.async("uint8array");

          const pieces = entry.name.split("/");
          const name = pieces[pieces.length - 1];

          files.push({
            path: entry.name,
            name,
            bytes,
          });

          setProgress(
            Math.round(((i + 1) / entries.length) * 100)
          );
        }

        setSourceType("zip");
        setSourceName(file.name);
        setBatchFiles(files);

        setPdfBytes(files[0].bytes);
        setPreviewName(files[0].name);

        await renderPreview(files[0].bytes);

        setProgress(0);
        setStatus(`${files.length} PDFs found inside ZIP.`);

        return;
      }

      throw new Error("Please select a PDF or ZIP file.");
    } catch (error) {
      console.error(error);

      setStatus(
        error instanceof Error
          ? error.message
          : "Could not read this file."
      );

      setSourceType(null);
      setPdfBytes(null);
      setBatchFiles([]);
    }
  }

  function reset() {
    setSourceType(null);
    setSourceName("");
    setPreviewName("");
    setPdfBytes(null);
    setBatchFiles([]);
    setPageCount(0);
    setStatus("");
    setProgress(0);
  }

  function autoDetect() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", {
      willReadFrequently: true,
    });

    if (!ctx) return;

    const { width, height } = canvas;

    const pixels = ctx.getImageData(
      0,
      0,
      width,
      height
    ).data;

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let found = false;

    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const i = (y * width + x) * 4;

        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];

        if (r < 240 || g < 240 || b < 240) {
          found = true;

          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (!found) {
      setStatus("Could not automatically detect content.");
      return;
    }

    const px = width * 0.015;
    const py = height * 0.015;

    minX = Math.max(0, minX - px);
    minY = Math.max(0, minY - py);
    maxX = Math.min(width, maxX + px);
    maxY = Math.min(height, maxY + py);

    setCrop({
      left: (minX / width) * 100,
      top: (minY / height) * 100,
      width: ((maxX - minX) / width) * 100,
      height: ((maxY - minY) / height) * 100,
    });

    setStatus(
      sourceType === "zip"
        ? "Content detected from the first PDF. These settings will be applied to every PDF in the ZIP."
        : "Content detected."
    );
  }

  const cropW = pageWidth * crop.width / 100;
  const cropH = pageHeight * crop.height / 100;

  const marginPt = margin * MM_TO_PT;
  const spacingPt = spacing * MM_TO_PT;

  const fits =
    !!pdfBytes &&
    cropW <= pageWidth &&
    cropH * 2 + marginPt * 2 + spacingPt <= pageHeight;

  async function processPdf(
    inputBytes: Uint8Array
  ): Promise<Uint8Array> {
    const source = await PDFDocument.load(
      inputBytes.slice()
    );

    const output = await PDFDocument.create();
    const pages = source.getPages();

    function getCropBox(page: PDFPage) {
      const { width, height } = page.getSize();

      const left =
        width * crop.left / 100;

      const right =
        width * (crop.left + crop.width) / 100;

      const top =
        height * (1 - crop.top / 100);

      const bottom =
        height *
        (1 - (crop.top + crop.height) / 100);

      return {
        page,
        width,
        height,
        left,
        right,
        top,
        bottom,
        cardWidth: right - left,
        cardHeight: top - bottom,
      };
    }

    for (let i = 0; i < pages.length; i += 2) {
      const first = getCropBox(pages[i]);

      const second =
        i + 1 < pages.length
          ? getCropBox(pages[i + 1])
          : null;

      const sheetWidth = first.width;
      const sheetHeight = first.height;

      const neededHeight = second
        ? marginPt +
          first.cardHeight +
          spacingPt +
          second.cardHeight +
          marginPt
        : marginPt +
          first.cardHeight +
          marginPt;

      if (
        first.cardWidth > sheetWidth ||
        (second && second.cardWidth > sheetWidth) ||
        neededHeight > sheetHeight
      ) {
        throw new Error(
          `The selected crop does not fit at 100% size on pages ${i + 1}` +
          (second ? ` and ${i + 2}.` : ".")
        );
      }

      const sheet = output.addPage([
        sheetWidth,
        sheetHeight,
      ]);

      const embeddedFirst = await output.embedPage(
        first.page,
        {
          left: first.left,
          right: first.right,
          top: first.top,
          bottom: first.bottom,
        }
      );

      const firstX =
        (sheetWidth - first.cardWidth) / 2;

      const firstY =
        sheetHeight -
        marginPt -
        first.cardHeight;

      sheet.drawPage(embeddedFirst, {
        x: firstX,
        y: firstY,
        width: first.cardWidth,
        height: first.cardHeight,
      });

      if (second) {
        const embeddedSecond =
          await output.embedPage(
            second.page,
            {
              left: second.left,
              right: second.right,
              top: second.top,
              bottom: second.bottom,
            }
          );

        const secondX =
          (sheetWidth - second.cardWidth) / 2;

        const secondY =
          firstY -
          spacingPt -
          second.cardHeight;

        sheet.drawPage(embeddedSecond, {
          x: secondX,
          y: secondY,
          width: second.cardWidth,
          height: second.cardHeight,
        });
      }
    }

    return new Uint8Array(
      await output.save()
    );
  }

  function downloadBlob(
    blob: Blob,
    filename: string
  ) {
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");

    a.href = url;
    a.download = filename;

    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 2000);
  }

  async function generate() {
    if (!sourceType || !pdfBytes) return;

    try {
      setBusy(true);
      setProgress(0);

      if (sourceType === "pdf") {
        setStatus("Generating PDF...");

        const result =
          await processPdf(pdfBytes);

        const safeBytes = new Uint8Array(result);

        const blob = new Blob(
          [safeBytes.buffer],
          {
            type: "application/pdf",
          }
        );

        const outputName =
          sourceName.replace(/\.pdf$/i, "") +
          "-2-per-page.pdf";

        downloadBlob(blob, outputName);

        setProgress(100);
        setStatus("Done. Your PDF has been downloaded.");
        return;
      }

      const outputZip = new JSZip();

      for (let i = 0; i < batchFiles.length; i++) {
        const file = batchFiles[i];

        setStatus(
          `Processing ${i + 1} of ${batchFiles.length}: ${file.name}`
        );

        try {
          const result =
            await processPdf(file.bytes);

          const outputPath =
            file.path.replace(
              /\.pdf$/i,
              "-2-per-page.pdf"
            );

          outputZip.file(
            outputPath,
            result
          );
        } catch (error) {
          throw new Error(
            `${file.name}: ${
              error instanceof Error
                ? error.message
                : "Could not process PDF."
            }`
          );
        }

        setProgress(
          Math.round(
            ((i + 1) / batchFiles.length) * 90
          )
        );
      }

      setStatus("Creating output ZIP...");

      const zipBlob =
        await outputZip.generateAsync(
          {
            type: "blob",
            compression: "DEFLATE",
            compressionOptions: {
              level: 6,
            },
          },
          (metadata) => {
            setProgress(
              90 +
              Math.round(
                metadata.percent * 0.1
              )
            );
          }
        );

      const outputName =
        sourceName.replace(/\.zip$/i, "") +
        "-processed.zip";

      downloadBlob(
        zipBlob,
        outputName
      );

      setProgress(100);

      setStatus(
        `Done. ${batchFiles.length} PDFs processed and downloaded as ZIP.`
      );
    } catch (error) {
      console.error(error);

      setStatus(
        error instanceof Error
          ? error.message
          : "Could not generate output."
      );
    } finally {
      setBusy(false);
    }
  }

  function range(
    label: string,
    value: number,
    max: number,
    update: (value: number) => void
  ) {
    return (
      <label className="range">
        <div>
          <span>{label}</span>
          <b>{value.toFixed(1)}%</b>
        </div>

        <input
          type="range"
          min="0"
          max={Math.max(0, max)}
          step="0.2"
          value={value}
          onChange={(e) =>
            update(Number(e.target.value))
          }
        />
      </label>
    );
  }

  return (
    <div className="app">
      <header>
        <strong>PDF 2-UP</strong>

        <div>
          <h1>PDF 2-Up Generator</h1>

          <p>
            Put two different consecutive PDF pages on one sheet.
          </p>
        </div>
      </header>

      <div className="trustBar">
        <span>🔒 Local processing</span>
        <span>📄 PDF + ZIP supported</span>
        <span>☁️ No uploads</span>
        <span>💾 Nothing stored</span>

        <a
          href="https://github.com/shirazhashmi/pdf-two-up"
          target="_blank"
          rel="noreferrer"
        >
          ⌘ Open source
        </a>
      </div>

      {!sourceType ? (
        <label className="upload">
          <div className="uploadIcon">
            ↑
          </div>

          <h2>
            Upload PDF or ZIP
          </h2>

          <p>
            PDF: process one file
          </p>

          <p>
            ZIP: process every PDF inside
          </p>

          <input
            type="file"
            accept=".pdf,.zip,application/pdf,application/zip,application/x-zip-compressed"
            onChange={(e) => {
              const file =
                e.target.files?.[0];

              if (file) {
                loadInput(file);
              }
            }}
          />

          <div className="privacyNote">
            <strong>
              Private by design
            </strong>

            <span>
              Files are processed directly on your device.
              They are never uploaded to or stored on our servers.
            </span>
          </div>
        </label>
      ) : (
        <main>
          <section className="preview">
            <div className="previewTop">
              <div>
                <h2>{sourceName}</h2>

                {sourceType === "pdf" ? (
                  <p>
                    {pageCount} pages
                  </p>
                ) : (
                  <p>
                    {batchFiles.length} PDFs detected · Previewing {previewName}
                  </p>
                )}
              </div>

              <button
                onClick={reset}
                disabled={busy}
              >
                Change file
              </button>
            </div>

            <div className="paperArea">
              <div className="paper">
                <canvas ref={canvasRef} />

                <div
                  className="crop"
                  style={{
                    left: crop.left + "%",
                    top: crop.top + "%",
                    width: crop.width + "%",
                    height: crop.height + "%",
                  }}
                >
                  <span>
                    Content area
                  </span>
                </div>
              </div>
            </div>
          </section>

          <aside>
            <h2>
              Crop & Layout
            </h2>

            <button
              className="detect"
              onClick={autoDetect}
              disabled={busy}
            >
              Auto Detect Content
            </button>

            {sourceType === "zip" && (
              <div className="batchInfo">
                <strong>
                  Batch mode
                </strong>

                <p>
                  These crop settings will be applied to all {batchFiles.length} PDFs.
                </p>

                <div className="fileList">
                  {batchFiles
                    .slice(0, 5)
                    .map((file) => (
                      <span key={file.path}>
                        ✓ {file.name}
                      </span>
                    ))}

                  {batchFiles.length > 5 && (
                    <span>
                      + {batchFiles.length - 5} more
                    </span>
                  )}
                </div>
              </div>
            )}

            {range(
              "Top",
              crop.top,
              95,
              (v) =>
                setCrop({
                  ...crop,
                  top: v,
                })
            )}

            {range(
              "Height",
              crop.height,
              100 - crop.top,
              (v) =>
                setCrop({
                  ...crop,
                  height: v,
                })
            )}

            {range(
              "Left",
              crop.left,
              95,
              (v) =>
                setCrop({
                  ...crop,
                  left: v,
                })
            )}

            {range(
              "Width",
              crop.width,
              100 - crop.left,
              (v) =>
                setCrop({
                  ...crop,
                  width: v,
                })
            )}

            <hr />

            <label className="number">
              <span>
                Outer margin
              </span>

              <input
                type="number"
                min="0"
                value={margin}
                onChange={(e) =>
                  setMargin(
                    Number(e.target.value)
                  )
                }
              />

              mm
            </label>

            <label className="number">
              <span>
                Card spacing
              </span>

              <input
                type="number"
                min="0"
                value={spacing}
                onChange={(e) =>
                  setSpacing(
                    Number(e.target.value)
                  )
                }
              />

              mm
            </label>

            <div
              className={
                fits
                  ? "fit good"
                  : "fit bad"
              }
            >
              {fits
                ? "✓ Fits at 100% size"
                : "✕ Does not fit at 100% size"}
            </div>

            <div className="info">
              <b>
                Output logic
              </b>

              <p>
                Page 1 + Page 2 → Sheet 1
              </p>

              <p>
                Page 3 + Page 4 → Sheet 2
              </p>

              <p>
                Page 5 + Page 6 → Sheet 3
              </p>
            </div>

            {busy && (
              <div className="progressWrap">
                <div className="progressTop">
                  <span>
                    Processing
                  </span>

                  <strong>
                    {progress}%
                  </strong>
                </div>

                <div className="progressTrack">
                  <div
                    className="progressBar"
                    style={{
                      width: `${progress}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <button
              className="generate"
              disabled={!fits || busy}
              onClick={generate}
            >
              {busy
                ? sourceType === "zip"
                  ? "Processing ZIP..."
                  : "Generating PDF..."
                : sourceType === "zip"
                  ? `Process ${batchFiles.length} PDFs & Download ZIP`
                  : "Generate PDF"}
            </button>

            {status && (
              <p className="status">
                {status}
              </p>
            )}
          </aside>
        </main>
      )}

      <footer className="siteFooter">
        <span>
          Free & open-source PDF utility
        </span>

        <div className="footerLinks">
          <a
            href="https://shirazhashmi.github.io"
            target="_blank"
            rel="noreferrer"
          >
            Built by Shiraz Hashmi ↗
          </a>

          <a
            href="https://github.com/shirazhashmi/pdf-two-up"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
        </div>
      </footer>
    </div>
  );
}
