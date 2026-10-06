// Express web application setup, middleware configuration, and API route registrations.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { AppError } from './errors.js';
import { extractFlowchart } from './pipeline.js';
import { ProviderAdapter } from './providers/types.js';
import { validateRepresentation } from './validator.js';
import { generatePseudocode } from './generator.js';
import { buildMermaid } from './mermaid.js';
import { FlowchartRepresentation } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');

function isValidRepresentation(rep: any): rep is FlowchartRepresentation {
  if (!rep || typeof rep !== 'object') return false;
  if (!Array.isArray(rep.nodes) || !Array.isArray(rep.edges)) return false;
  if (rep.nodes.length === 0) return false;
  for (const node of rep.nodes) {
    if (!node || typeof node !== 'object') return false;
    if (typeof node.id !== 'string' || typeof node.type !== 'string' || typeof node.text !== 'string') {
      return false;
    }
  }
  for (const edge of rep.edges) {
    if (!edge || typeof edge !== 'object') return false;
    if (typeof edge.from !== 'string' || typeof edge.to !== 'string') {
      return false;
    }
  }
  return true;
}

export function createApp(provider: ProviderAdapter) {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use('/', express.static(publicDir));

  // Configure multer for in-memory upload with 10MB limit
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 10 * 1024 * 1024,
    },
  });

  // GET /api/health
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      provider: provider.name,
    });
  });

  // POST /api/extract
  app.post(
    '/api/extract',
    upload.single('image'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.file || !req.file.buffer) {
          throw new AppError('invalid_image', 'No image file uploaded in field "image"');
        }

        const result = await extractFlowchart({
          imageBuffer: req.file.buffer,
          provider,
        });

        res.json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /api/generate
  app.post('/api/generate', (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.body || typeof req.body !== 'object' || !req.body.representation) {
        throw new AppError('invalid_representation', 'Missing representation in request body');
      }

      const rep = req.body.representation;
      if (!isValidRepresentation(rep)) {
        throw new AppError(
          'invalid_representation',
          'Invalid flowchart representation: nodes and edges must be arrays and contain at least one node'
        );
      }

      const validation = validateRepresentation(rep);
      const genResult = generatePseudocode(rep);
      const mermaid = buildMermaid(rep);
      const warnings = Array.from(new Set([...validation.warnings, ...genResult.warnings]));

      res.json({
        pseudocode: genResult.pseudocode,
        warnings,
        valid: validation.valid,
        confidence: validation.confidence,
        mermaid,
      });
    } catch (err) {
      next(err);
    }
  });

  // Central error handler
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof AppError) {
      return res.status(err.statusCode).json(err.toJSON());
    }

    if (err instanceof SyntaxError && (err as any).status === 400 && 'body' in err) {
      const appErr = new AppError('invalid_representation', 'Malformed JSON in request body');
      return res.status(appErr.statusCode).json(appErr.toJSON());
    }

    if (err?.code === 'LIMIT_FILE_SIZE' || err?.type === 'entity.too.large' || err?.status === 413) {
      const appErr = new AppError('too_large', 'Request payload exceeds limit');
      return res.status(appErr.statusCode).json(appErr.toJSON());
    }

    // Default error
    res.status(500).json({
      error: {
        code: 'internal_error',
        message: err?.message || 'Internal server error',
      },
    });
  });

  return app;
}
