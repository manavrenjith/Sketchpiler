// Unit tests for client-side image intake validation and rotation math.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeAngle,
    rotatedDimensions,
    getRotationTransform,
    validateFile,
    findImageItem,
    DEFAULT_MAX_BYTES
} from '../public/js/upload-core.js';

describe('upload-core: Angle Normalization', () => {
    it('normalizes 0, 90, 180, 270 degrees', () => {
        assert.strictEqual(normalizeAngle(0), 0);
        assert.strictEqual(normalizeAngle(90), 90);
        assert.strictEqual(normalizeAngle(180), 180);
        assert.strictEqual(normalizeAngle(270), 270);
    });

    it('normalizes negative angles and multiples of 360', () => {
        assert.strictEqual(normalizeAngle(-90), 270);
        assert.strictEqual(normalizeAngle(-180), 180);
        assert.strictEqual(normalizeAngle(-270), 90);
        assert.strictEqual(normalizeAngle(360), 0);
        assert.strictEqual(normalizeAngle(450), 90);
    });
});

describe('upload-core: Rotated Dimensions', () => {
    it('swaps width and height for 90 and 270 degree rotations', () => {
        const result90 = rotatedDimensions(800, 600, 90);
        assert.deepStrictEqual(result90, { width: 600, height: 800 });

        const result270 = rotatedDimensions(800, 600, 270);
        assert.deepStrictEqual(result270, { width: 600, height: 800 });

        const resultNegative90 = rotatedDimensions(800, 600, -90);
        assert.deepStrictEqual(resultNegative90, { width: 600, height: 800 });
    });

    it('preserves width and height for 0 and 180 degree rotations', () => {
        const result0 = rotatedDimensions(800, 600, 0);
        assert.deepStrictEqual(result0, { width: 800, height: 600 });

        const result180 = rotatedDimensions(800, 600, 180);
        assert.deepStrictEqual(result180, { width: 800, height: 600 });
    });

    it('rejects invalid dimensions', () => {
        assert.throws(() => rotatedDimensions(0, 100, 90), /Invalid dimensions/);
        assert.throws(() => rotatedDimensions(100, -50, 90), /Invalid dimensions/);
    });
});

describe('upload-core: Rotation Transform Matrix Parameters', () => {
    it('calculates transform offsets for 90 degrees clockwise', () => {
        const t = getRotationTransform(90, 800, 600);
        assert.strictEqual(t.targetWidth, 600);
        assert.strictEqual(t.targetHeight, 800);
        assert.strictEqual(t.translateX, 600);
        assert.strictEqual(t.translateY, 0);
        assert.strictEqual(t.rotationRad, Math.PI / 2);
    });

    it('calculates transform offsets for 270 degrees clockwise (-90 counter-clockwise)', () => {
        const t = getRotationTransform(-90, 800, 600);
        assert.strictEqual(t.targetWidth, 600);
        assert.strictEqual(t.targetHeight, 800);
        assert.strictEqual(t.translateX, 0);
        assert.strictEqual(t.translateY, 800);
        assert.strictEqual(t.rotationRad, (3 * Math.PI) / 2);
    });

    it('calculates transform offsets for 180 degrees', () => {
        const t = getRotationTransform(180, 800, 600);
        assert.strictEqual(t.targetWidth, 800);
        assert.strictEqual(t.targetHeight, 600);
        assert.strictEqual(t.translateX, 800);
        assert.strictEqual(t.translateY, 600);
        assert.strictEqual(t.rotationRad, Math.PI);
    });
});

describe('upload-core: File Validation', () => {
    it('accepts valid JPEG, PNG and WebP files under 10 MB', () => {
        assert.deepStrictEqual(validateFile({ type: 'image/jpeg', size: 1024 * 1024 }), { valid: true });
        assert.deepStrictEqual(validateFile({ type: 'image/png', size: 5 * 1024 * 1024 }), { valid: true });
        assert.deepStrictEqual(validateFile({ type: 'image/webp', size: 9 * 1024 * 1024 }), { valid: true });
    });

    it('rejects unsupported mime types', () => {
        const result = validateFile({ type: 'application/pdf', size: 1024 });
        assert.strictEqual(result.valid, false);
        assert.match(result.error || '', /not a JPEG, PNG or WebP/);
    });

    it('rejects files larger than 10 MB', () => {
        const result = validateFile({ type: 'image/png', size: DEFAULT_MAX_BYTES + 1 });
        assert.strictEqual(result.valid, false);
        assert.match(result.error || '', /larger than 10 MB/);
    });

    it('rejects empty or missing file', () => {
        assert.strictEqual(validateFile(null).valid, false);
        assert.strictEqual(validateFile(undefined).valid, false);
    });
});

describe('upload-core: Clipboard Image Item Detection', () => {
    it('extracts first image item from DataTransferItems-like array', () => {
        const items = [
            { type: 'text/plain', kind: 'string' },
            { type: 'image/png', kind: 'file' }
        ];
        const found = findImageItem(items);
        assert.ok(found);
        assert.strictEqual(found.type, 'image/png');
    });

    it('returns null if no image is in items', () => {
        const items = [
            { type: 'text/plain', kind: 'string' },
            { type: 'text/html', kind: 'string' }
        ];
        assert.strictEqual(findImageItem(items), null);
        assert.strictEqual(findImageItem([]), null);
        assert.strictEqual(findImageItem(null), null);
    });
});
