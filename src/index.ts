import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import videoRoutes from './routes/video';
import { initModel } from './services/nsfwDetector';

const app: Express = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(express.json());

app.use('/api/video', videoRoutes);

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize model when the module is loaded
let modelInitialized = false;
const initializeModel = async () => {
  if (!modelInitialized) {
    try {
      console.log('Loading NSFW detection model...');
      await initModel();
      console.log('Model loaded successfully!');
      modelInitialized = true;
    } catch (error) {
      console.error('Failed to load model:', error);
    }
  }
};

// Start server only in local development
if (process.env.NODE_ENV !== 'production') {
  const startServer = async () => {
    await initializeModel();
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  };
  startServer();
}

// Export app for Serverless Function
export default async (req: Request, res: Response) => {
  // Initialize model on first request
  await initializeModel();
  // Handle request
  app(req, res);
};
