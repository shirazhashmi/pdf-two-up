import { useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./App.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

type Crop = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const MM_TO_PT = 72 / 25.4;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState("");
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

  async function loadPDF(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());

    setPdfBytes(bytes);
    setFileName(file.name);

    const pdf = await pdfjsLib.getDocument({
      data: bytes.slice(),
    }).promise;

    setPageCount(pdf.numPages);

    const page = await pdf.getPage(1);

    const vp = page.getViewport({ scale: 1 });

    setPageWidth(vp.width);
    setPageHeight(vp.height);

    const scale = 800 / vp.width;

    const viewport = page.getViewport({
      scale,
    });

    setTimeout(async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d", {
        willReadFrequently: true,
      });

      if (!ctx) return;

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({
        canvasContext: ctx,
        viewport,
      }).promise;
    }, 50);
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

    if (!found) return;

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

    setStatus("Content detected.");
  }

  const cropW =
    pageWidth * crop.width / 100;

  const cropH =
    pageHeight * crop.height / 100;

  const marginPt =
    margin * MM_TO_PT;

  const spacingPt =
    spacing * MM_TO_PT;

  const fits =
    cropW <= pageWidth &&
    cropH * 2 +
      marginPt * 2 +
      spacingPt <=
      pageHeight;

  async function generate() {
    if (!pdfBytes) return;

    try {
      setBusy(true);
      setStatus("Generating...");

      const source =
        await PDFDocument.load(
          pdfBytes.slice()
        );

      const output =
        await PDFDocument.create();

      const pages =
        source.getPages();

      for (
        let i = 0;
        i < pages.length;
        i += 2
      ) {
        const size =
          pages[i].getSize();

        const sheet =
          output.addPage([
            size.width,
            size.height,
          ]);

        async function place(
          index: number,
          row: number
        ) {
          const page =
            pages[index];

          const {
            width,
            height,
          } = page.getSize();

          const left =
            width *
            crop.left /
            100;

          const right =
            width *
            (crop.left + crop.width) /
            100;

          const top =
            height *
            (1 - crop.top / 100);

          const bottom =
            height *
            (
              1 -
              (crop.top + crop.height) /
              100
            );

          const cardWidth =
            right - left;

          const cardHeight =
            top - bottom;

          const embedded =
            await output.embedPage(
              page,
              {
                left,
                right,
                top,
                bottom,
              }
            );

          const x =
            (size.width - cardWidth) / 2;

          const fromTop =
            marginPt +
            row *
              (
                cardHeight +
                spacingPt
              );

          const y =
            size.height -
            fromTop -
            cardHeight;

          sheet.drawPage(
            embedded,
            {
              x,
              y,
              width: cardWidth,
              height: cardHeight,
            }
          );
        }

        await place(i, 0);

        if (i + 1 < pages.length) {
          await place(i + 1, 1);
        }
      }

      const result =
        await output.save();

      const blob =
        new Blob(
          [new Uint8Array(result)],
          {
            type: "application/pdf",
          }
        );

      const url =
        URL.createObjectURL(blob);

      const a =
        document.createElement("a");

      a.href = url;

      a.download =
        fileName.replace(
          /\.pdf$/i,
          ""
        ) +
        "-2-per-page.pdf";

      a.click();

      URL.revokeObjectURL(url);

      setStatus(
        "Done! Your PDF has been downloaded."
      );
    } catch (e) {
      console.error(e);

      setStatus(
        "Could not generate PDF."
      );
    } finally {
      setBusy(false);
    }
  }

  function range(
    label: string,
    value: number,
    max: number,
    update: (n: number) => void
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
          max={max}
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

      {!pdfBytes ? (

        <label className="upload">

          <div className="uploadIcon">
            ↑
          </div>

          <h2>
            Upload PDF
          </h2>

          <p>
            Page 1 + 2 → Sheet 1
          </p>

          <p>
            Page 3 + 4 → Sheet 2
          </p>

          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => {
              const file =
                e.target.files?.[0];

              if (file)
                loadPDF(file);
            }}
          />

          <small>
            Your PDF never leaves your browser.
          </small>

        </label>

      ) : (

        <main>

          <section className="preview">

            <div className="previewTop">
              <div>
                <h2>{fileName}</h2>
                <p>{pageCount} pages</p>
              </div>

              <button
                onClick={() =>
                  setPdfBytes(null)
                }
              >
                Change PDF
              </button>
            </div>

            <div className="paperArea">

              <div className="paper">

                <canvas
                  ref={canvasRef}
                />

                <div
                  className="crop"
                  style={{
                    left: crop.left + "%",
                    top: crop.top + "%",
                    width: crop.width + "%",
                    height: crop.height + "%",
                  }}
                />

              </div>

            </div>

          </section>

          <aside>

            <h2>Layout</h2>

            <button
              className="detect"
              onClick={autoDetect}
            >
              Auto Detect Content
            </button>

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
                value={margin}
                onChange={(e) =>
                  setMargin(
                    Number(
                      e.target.value
                    )
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
                value={spacing}
                onChange={(e) =>
                  setSpacing(
                    Number(
                      e.target.value
                    )
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
              <b>Output</b>

              <p>
                PDF 1 + PDF 2
              </p>

              <p>
                PDF 3 + PDF 4
              </p>

              <p>
                PDF 5 + PDF 6
              </p>
            </div>

            <button
              className="generate"
              disabled={!fits || busy}
              onClick={generate}
            >
              {busy
                ? "Generating..."
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
    </div>
  );
}
