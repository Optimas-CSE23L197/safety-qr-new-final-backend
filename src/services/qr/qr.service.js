// =============================================================================
// services/qr/qr.service.js — RESQID
// QR code generation — produces PNG buffer from a URL.
// Uses 'qrcode' package (already common in Node projects).
//
// Install: npm install qrcode
// =============================================================================

// =============================================================================
// generateQrPng — generate a QR PNG buffer from a URL string
//
// @param {string} url  — scan URL e.g. "https://resqid.in/s/5YbX2m..."
// @returns {Promise<Buffer>} — PNG buffer ready for S3 upload
// =============================================================================

export const generateQrPng = async (url) => {
  if (!url || typeof url !== "string") {
    throw new TypeError("generateQrPng: url must be a non-empty string");
  }

  try {
    const QRCode = await import("qrcode");

    const buffer = await QRCode.default.toBuffer(url, {
      type: "png",
      width: 512,
      margin: 2,
      color: {
        dark: "#000000", // QR modules — black
        light: "#FFFFFF", // background — white
      },
      errorCorrectionLevel: "H", // highest — survives partial card damage
    });

    return buffer;
  } catch (err) {
    if (
      err.code === "ERR_MODULE_NOT_FOUND" ||
      err.message?.includes("Cannot find module")
    ) {
      throw new Error(
        "QR generation failed: 'qrcode' package not installed. Run: npm install qrcode",
      );
    }
    throw err;
  }
};

// =============================================================================
// generateQrDataUrl — base64 data URL (for inline preview, not for S3)
// =============================================================================

export const generateQrDataUrl = async (url) => {
  const QRCode = await import("qrcode");
  return QRCode.default.toDataURL(url, {
    type: "image/png",
    width: 256,
    errorCorrectionLevel: "H",
  });
};
