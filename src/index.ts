import express, { Express, Request, Response } from 'express';
import cors from 'cors';

const app: Express = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(express.json());

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API video endpoints
app.get('/api/video/cache', (_req: Request, res: Response) => {
  res.json({ success: true, message: 'Cache endpoint is working' });
});

app.post('/api/video/analyze', (_req: Request, res: Response) => {
  res.json({ success: true, message: 'Analyze endpoint is working' });
});

app.post('/api/video/convert', (_req: Request, res: Response) => {
  res.json({ success: true, message: 'Convert endpoint is working' });
});

app.delete('/api/video/cache', (_req: Request, res: Response) => {
  res.json({ success: true, message: 'Cache cleared successfully', count: 0 });
});

// Start server only in local development
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

// Export app for Serverless Function
export default (req: Request, res: Response) => {
  // Handle request
  app(req, res);
};
