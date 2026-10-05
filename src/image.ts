// Image intake validation, format detection, and resizing using sharp.
import sharp from 'sharp';
import { AppError } from './errors.js';

export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_DIMENSION = 1600;

export type SupportedImageFormat = 'jpeg' | 'png' | 'webp';

export function detectImageFormat(buffer: Buffer): SupportedImageFormat | null {
  if (!buffer || buffer.length < 12) {
    return null;
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }

  // WebP: RIFF (4 bytes) + 4 bytes length + WEBP (4 bytes)
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'webp';
  }

  return null;
}

export interface ProcessedImage {
  mimeType: 'image/jpeg';
  data: Buffer;
}

export async function processImageIntake(buffer: Buffer): Promise<ProcessedImage> {
  if (!buffer || buffer.length === 0) {
    throw new AppError('invalid_image', 'Empty image payload');
  }

  if (buffer.length > MAX_IMAGE_SIZE) {
    throw new AppError('too_large', 'Image exceeds 10 MB limit');
  }

  const format = detectImageFormat(buffer);
  if (!format) {
    throw new AppError('invalid_image', 'Invalid image format. Only JPEG, PNG, and WebP are allowed.');
  }

  try {
    const downscaled = await sharp(buffer)
      .resize(MAX_DIMENSION, MAX_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer();

    return {
      mimeType: 'image/jpeg',
      data: downscaled,
    };
  } catch (err: any) {
    throw new AppError('invalid_image', `Corrupted or unreadable image: ${err?.message || err}`);
  }
}
