import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function safeText(value) {
  return String(value || "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function drawWrappedText(page, text, options) {
  const {
    x,
    y,
    width,
    font,
    size,
    color = rgb(0.12, 0.16, 0.24),
    lineHeight = size + 4,
    maxLines = 8
  } = options;
  const words = safeText(text).split(" ").filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    const next = line ? line + " " + word : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      line = next;
    } else {
      if (line) lines.push(line);
      line = word;
    }

    if (lines.length >= maxLines) break;
  }

  if (line && lines.length < maxLines) lines.push(line);

  lines.forEach((item, index) => {
    page.drawText(item, {
      x,
      y: y - index * lineHeight,
      size,
      font,
      color
    });
  });

  return y - lines.length * lineHeight;
}

async function fetchImageBytes(url) {
  if (!url) return null;

  const response = await fetch(url);
  if (!response.ok) return null;

  return Buffer.from(await response.arrayBuffer());
}

async function embedImage(pdfDoc, bytes) {
  if (!bytes) return null;

  try {
    return await pdfDoc.embedJpg(bytes);
  } catch (_) {
    try {
      return await pdfDoc.embedPng(bytes);
    } catch (_) {
      return null;
    }
  }
}

export async function createProofPhotosPdf({ proof, formId = "", submissionId = "" }) {
  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 42;
  const titleColor = rgb(0.04, 0.16, 0.38);
  const accent = rgb(0.02, 0.42, 0.88);

  const cover = pdfDoc.addPage([pageWidth, pageHeight]);
  cover.drawText("Proof Camera Photo Report", {
    x: margin,
    y: pageHeight - margin - 10,
    size: 24,
    font: bold,
    color: titleColor
  });
  cover.drawText("Camera-only photo evidence", {
    x: margin,
    y: pageHeight - margin - 40,
    size: 11,
    font: regular,
    color: rgb(0.32, 0.38, 0.48)
  });

  const submitter = proof.submitter || {};
  const coverLines = [
    ["Form ID", formId || proof.formId],
    ["Submission ID", submissionId || "-"],
    ["Capture token", proof.captureToken],
    ["Completed at", proof.completedAt],
    ["Submitter", [submitter.name, submitter.email].filter(Boolean).join(" / ")],
    ["Dropbox folder", proof.dropboxFolderUrl || proof.dropboxFolderPath]
  ];
  let coverY = pageHeight - margin - 90;
  coverLines.forEach(([label, value]) => {
    cover.drawText(label + ":", {
      x: margin,
      y: coverY,
      size: 10,
      font: bold,
      color: rgb(0.24, 0.28, 0.36)
    });
    drawWrappedText(cover, value || "-", {
      x: margin + 95,
      y: coverY,
      width: pageWidth - margin * 2 - 95,
      font: regular,
      size: 10,
      maxLines: 2
    });
    coverY -= 28;
  });

  cover.drawText("Photos", {
    x: margin,
    y: coverY - 14,
    size: 15,
    font: bold,
    color: titleColor
  });
  coverY -= 42;

  (proof.photos || []).forEach((photo) => {
    coverY = drawWrappedText(cover, `${photo.index}. ${photo.label} - ${photo.sha256 || ""}`, {
      x: margin,
      y: coverY,
      width: pageWidth - margin * 2,
      font: regular,
      size: 9,
      maxLines: 2
    }) - 4;
  });

  for (const photo of proof.photos || []) {
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    page.drawText(`${photo.index}. ${safeText(photo.label)}`, {
      x: margin,
      y: pageHeight - margin,
      size: 17,
      font: bold,
      color: titleColor
    });
    page.drawLine({
      start: { x: margin, y: pageHeight - margin - 12 },
      end: { x: pageWidth - margin, y: pageHeight - margin - 12 },
      thickness: 1.2,
      color: accent
    });

    const image = await embedImage(pdfDoc, await fetchImageBytes(photo.url));
    if (image) {
      const box = {
        x: margin,
        y: 230,
        width: pageWidth - margin * 2,
        height: 470
      };
      const scale = Math.min(box.width / image.width, box.height / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      page.drawImage(image, {
        x: box.x + (box.width - width) / 2,
        y: box.y + (box.height - height) / 2,
        width,
        height
      });
    } else {
      page.drawText("Photo could not be embedded. Use the URL below.", {
        x: margin,
        y: 480,
        size: 12,
        font: bold,
        color: rgb(0.7, 0.1, 0.1)
      });
    }

    const meta = photo.metadata || {};
    const location = meta.location || {};
    const time = meta.time || {};
    const gps = location.latitude && location.longitude
      ? `${location.latitude}, ${location.longitude} +/- ${Math.round(location.accuracy || 0)}m`
      : "-";

    let y = 190;
    [
      ["Captured time", time.local || time.iso || "-"],
      ["GPS", gps],
      ["SHA-256", photo.sha256 || "-"],
      ["Dropbox photo URL", photo.url || "-"]
    ].forEach(([label, value]) => {
      page.drawText(label + ":", {
        x: margin,
        y,
        size: 9,
        font: bold,
        color: rgb(0.24, 0.28, 0.36)
      });
      y = drawWrappedText(page, value, {
        x: margin + 105,
        y,
        width: pageWidth - margin * 2 - 105,
        font: regular,
        size: 8,
        maxLines: 3
      }) - 8;
    });
  }

  return Buffer.from(await pdfDoc.save());
}
