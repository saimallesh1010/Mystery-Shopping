import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleRequest } from '../src/server';

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  try {
    handleRequest(req, res);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end((err as Error).message);
  }
}