// Application error class and standardized error codes for Sketchpiler API failures.
export type ErrorCode =
  | 'invalid_image'
  | 'too_large'
  | 'provider_rate_limited'
  | 'provider_error'
  | 'output_truncated'
  | 'unparseable_output'
  | 'empty_diagram'
  | 'invalid_representation';

export function getHttpStatusForErrorCode(code: ErrorCode): number {
  switch (code) {
    case 'invalid_image':
    case 'invalid_representation':
      return 400;
    case 'too_large':
      return 413;
    case 'provider_rate_limited':
      return 429;
    case 'provider_error':
      return 502;
    case 'output_truncated':
    case 'unparseable_output':
    case 'empty_diagram':
      return 422;
    default:
      return 500;
  }
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = getHttpStatusForErrorCode(code);
    Object.setPrototypeOf(this, AppError.prototype);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
      },
    };
  }
}
