/**
 * upload-core.js - Pure helper logic for image intake, rotation math, and validation.
 * Independent ES module with NO DOM access at import, testable in Node.js.
 */

export const DEFAULT_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Normalizes an arbitrary angle in degrees to 0, 90, 180, or 270 degrees.
 * @param {number} degrees 
 * @returns {number} 0, 90, 180, or 270
 */
export function normalizeAngle(degrees) {
    const mod = ((degrees % 360) + 360) % 360;
    return mod;
}

/**
 * Calculates canvas output dimensions after rotating an image by angleDegrees (multiple of 90).
 * @param {number} width - Original width
 * @param {number} height - Original height
 * @param {number} angleDegrees - Rotation angle (-90, 90, 180, 270, etc.)
 * @returns {{ width: number, height: number }}
 */
export function rotatedDimensions(width, height, angleDegrees) {
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        throw new Error('Invalid dimensions: width and height must be positive numbers');
    }
    const angle = normalizeAngle(angleDegrees);
    if (angle === 90 || angle === 270) {
        return { width: height, height: width };
    }
    return { width, height };
}

/**
 * Calculates affine 2D canvas transform parameters for rotating an image.
 * @param {number} angleDegrees - Angle to rotate
 * @param {number} origWidth - Original image natural width
 * @param {number} origHeight - Original image natural height
 * @returns {{ targetWidth: number, targetHeight: number, translateX: number, translateY: number, rotationRad: number }}
 */
export function getRotationTransform(angleDegrees, origWidth, origHeight) {
    const angle = normalizeAngle(angleDegrees);
    const { width: targetWidth, height: targetHeight } = rotatedDimensions(origWidth, origHeight, angle);
    const rotationRad = (angle * Math.PI) / 180;

    let translateX = 0;
    let translateY = 0;

    if (angle === 90) {
        translateX = targetWidth;
        translateY = 0;
    } else if (angle === 180) {
        translateX = targetWidth;
        translateY = targetHeight;
    } else if (angle === 270) {
        translateX = 0;
        translateY = targetHeight;
    }

    return {
        targetWidth,
        targetHeight,
        translateX,
        translateY,
        rotationRad
    };
}

/**
 * Validates a file's MIME type and size.
 * @param {{ type?: string, size?: number } | null | undefined} file 
 * @param {string[]} [allowedTypes]
 * @param {number} [maxBytes]
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateFile(file, allowedTypes = DEFAULT_ALLOWED_TYPES, maxBytes = DEFAULT_MAX_BYTES) {
    if (!file) {
        return { valid: false, error: 'No file provided.' };
    }
    if (!file.type || allowedTypes.indexOf(file.type) < 0) {
        return {
            valid: false,
            error: 'That file is not a JPEG, PNG or WebP image. Choose a photo of your diagram.'
        };
    }
    if (typeof file.size === 'number' && file.size > maxBytes) {
        return {
            valid: false,
            error: 'That image is larger than 10 MB. Take a smaller photo or lower the resolution.'
        };
    }
    return { valid: true };
}

/**
 * Inspects a list-like collection of clipboard DataTransferItems and returns the first image item.
 * @param {ArrayLike<{ type: string, kind?: string }> | null | undefined} items 
 * @returns {{ type: string, kind?: string } | null}
 */
export function findImageItem(items) {
    if (!items || typeof items.length !== 'number') {
        return null;
    }
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item && item.type && item.type.indexOf('image/') === 0) {
            return item;
        }
    }
    return null;
}

if (typeof window !== 'undefined') {
    window.UploadCore = {
        DEFAULT_ALLOWED_TYPES,
        DEFAULT_MAX_BYTES,
        normalizeAngle,
        rotatedDimensions,
        getRotationTransform,
        validateFile,
        findImageItem
    };
}

