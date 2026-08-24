import http from 'http';
import fs from 'fs';
import path from 'path';
import { URL } from 'url';
import { getAllResults, countLeads } from './db/repository';

const PORT = parseInt(process.env.PORT ?? '3000');
const HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/api/results') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(getAllResults()));
    return;
  }

  if (url.pathname === '/api/summary') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(countLeads()));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
}

const server = http.createServer((req, res) => {
  try { handleRequest(req, res); }
  catch (err) { res.writeHead(500); res.end((err as Error).message); }
});

server.listen(PORT, () => {
  console.log('\n  Mystery Shopper Dashboard');
  console.log('  http://localhost:' + PORT + '\n');
});
