import sharp from "sharp";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export type UploadCheck =
  | { ok: true; contentType: "image/png" | "image/jpeg"; width: number; height: number; data: Buffer }
  | { ok: false; error: string };

async function inspect(data: Buffer) {
  if (data.byteLength === 0) return null;
  if (data.byteLength > MAX_UPLOAD_BYTES) return "too-large" as const;
  try {
    return await sharp(data).metadata();
  } catch {
    return null;
  }
}

/** Uploaded frame: PNG, exactly 1200×1800, with an alpha channel and a transparent window (SPEC §8.3). */
export async function validateFrame(data: Buffer): Promise<UploadCheck> {
  const meta = await inspect(data);
  if (meta === "too-large") return { ok: false, error: "File is larger than 20 MB" };
  if (!meta) return { ok: false, error: "Not a readable image" };
  if (meta.format !== "png") return { ok: false, error: "Frame must be a PNG" };
  if (meta.width !== 1200 || meta.height !== 1800)
    return { ok: false, error: `Frame must be exactly 1200×1800 px (got ${meta.width}×${meta.height})` };
  if (!meta.hasAlpha) return { ok: false, error: "Frame PNG must have an alpha channel" };
  const { data: px } = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i]! < 128) transparent++;
  if (transparent === 0) return { ok: false, error: "Frame has no transparent window for the portrait" };
  return { ok: true, contentType: "image/png", width: 1200, height: 1800, data };
}

/**
 * Uploaded background: PNG or JPEG, at least 1024×1536 and croppable to 2:3
 * (SPEC §8.2). Any image that size can be cover-cropped; we additionally reject
 * extreme shapes that would lose most of the picture (outside 1:2 to 1:1).
 * Normalized to an upright, stripped-metadata JPEG or PNG before storing.
 */
export async function validateBackground(data: Buffer): Promise<UploadCheck> {
  const meta = await inspect(data);
  if (meta === "too-large") return { ok: false, error: "File is larger than 20 MB" };
  if (!meta) return { ok: false, error: "Not a readable image" };
  if (meta.format !== "png" && meta.format !== "jpeg") return { ok: false, error: "Background must be PNG or JPEG" };
  // EXIF orientation 5–8 swaps width and height once rotated upright.
  const swap = (meta.orientation ?? 1) >= 5;
  const width = swap ? meta.height! : meta.width!;
  const height = swap ? meta.width! : meta.height!;
  if (width < 1024 || height < 1536)
    return { ok: false, error: `Background must be at least 1024×1536 px (got ${width}×${height})` };
  const ratio = width / height;
  if (ratio < 0.5 || ratio > 1)
    return { ok: false, error: "Background must be portrait, close to 2:3, so it can be cropped to fit" };
  const isPng = meta.format === "png";
  const out = await (isPng ? sharp(data).rotate().png() : sharp(data).rotate().jpeg({ quality: 92 })).toBuffer();
  return { ok: true, contentType: isPng ? "image/png" : "image/jpeg", width, height, data: out };
}
