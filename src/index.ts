import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import videoRoutes from './routes/video';
import { initModel } from './services/nsfwDetector';

const app: Express = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));
app.use(express.json());

app.use('/api/video', videoRoutes);

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const startServer = async () => {
  try {
    console.log('Loading NSFW detection model...');
    await initModel();
    console.log('Model loaded successfully!');

    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
