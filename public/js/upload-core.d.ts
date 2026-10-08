// TypeScript type declarations for Sketchpiler upload validation and image rotation.
export declare const DEFAULT_ALLOWED_TYPES: string[];
export declare const DEFAULT_MAX_BYTES: number;

export declare function normalizeAngle(degrees: number): number;

export declare function rotatedDimensions(
    width: number,
    height: number,
    angleDegrees: number
): { width: number; height: number };

export declare function getRotationTransform(
    angleDegrees: number,
    origWidth: number,
    origHeight: number
): {
    targetWidth: number;
    targetHeight: number;
    translateX: number;
    translateY: number;
    rotationRad: number;
};

export declare function validateFile(
    file: { type?: string; size?: number } | null | undefined,
    allowedTypes?: string[],
    maxBytes?: number
): { valid: boolean; error?: string };

export declare function findImageItem<T extends { type: string; kind?: string }>(
    items: ArrayLike<T> | null | undefined
): T | null;
