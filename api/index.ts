import type { Request, Response } from 'express';
import app from '../server.js';

// Vercel rewrites static Vite routes to this single Node function.
export default function handler(req: Request, res: Response) {
  const url = new URL(req.url || '/', 'https://hubstudio2.vercel.app');
  const route = url.searchParams.get('__route') || req.url?.split('?')[0] || '/';
  url.searchParams.delete('__route');
  req.url = `${route}${url.searchParams.size ? '?' + url.searchParams.toString() : ''}`;
  return app(req, res);
}
