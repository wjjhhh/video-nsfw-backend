import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Worker } from 'worker_threads';
import { extractFrames, cleanupFiles, cleanupDirectory, ensureTempDir, getVideoDuration, convertToMp4, needsConversion } from '../services/videoProcessor';
import { analyzeFrame } from '../services/nsfwDetector';
import { generateFileHash, isCached, getCachedResult, cacheResult, clearAllCache } from '../utils/cacheUtils';
import { AnalysisResult, UploadResponse } from '../types';

const router = Router();

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const uploadDir = path.join(__dirname, '../../temp/uploads');
    await ensureTempDir();
    try {
      const fs = await import('fs');
      await fs.promises.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error as Error, uploadDir);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      'video/mp4',
      'video/webm',
      'video/quicktime',
      'video/x-msvideo',
      'video/avi',
      'video/x-ms-wmv',
      'video/mpeg',
      'video/3gpp',
      'video/x-flv',
      'video/flv'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video files are allowed.'));
    }
  }
});

// SSE event types
interface SSEvent {
  type: 'progress' | 'frame' | 'complete' | 'error';
  data: any;
}

const sendSSEvent = (res: Response, event: SSEvent) => {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event.data)}\n\n`);
};

router.post('/analyze', upload.single('video'), async (req: Request, res: Response) => {
  let videoPath: string | null = null;
  let convertedPath: string | null = null;
  let frameDir: string | null = null;

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No video file uploaded',
        error: 'NO_FILE'
      } as UploadResponse);
    }

    videoPath = req.file.path;
    console.log(`Processing video: ${videoPath}, type: ${req.file.mimetype}`);
    console.log(`File size: ${req.file.size} bytes`);
    
    // Check if file exists and is readable
    try {
      const fs = await import('fs');
      await fs.promises.access(videoPath, fs.constants.R_OK);
      console.log(`Video file is readable: ${videoPath}`);
    } catch (error) {
      console.error(`Video file is not accessible: ${videoPath}`, error);
      sendSSEvent(res, {
        type: 'error',
        data: { message: 'Video file is not accessible' }
      });
      res.end();
      return;
    }

    // Set SSE headers for all responses
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Check cache first
    try {
      const fileHash = await generateFileHash(videoPath);
      console.log(`Video hash: ${fileHash}`);
      
      if (await isCached(fileHash)) {
        console.log('Cache hit! Using cached analysis result');
        const cachedResult = await getCachedResult(fileHash);
        
        // Send progress event
        sendSSEvent(res, {
          type: 'progress',
          data: { message: 'Loading from cache...' }
        });
        
        // Send complete event
        sendSSEvent(res, {
          type: 'complete',
          data: cachedResult
        });
        
        // Cleanup
        await cleanupFiles(videoPath);
        
        res.end();
        return;
      }
      console.log('Cache miss, performing analysis');
    } catch (error) {
      console.error('Cache check error:', error);
      // Continue with analysis if cache check fails
    }

    // Skip video conversion for analysis - extract frames directly from original
    // This is much faster for long videos
    const processingPath = videoPath;

    sendSSEvent(res, {
      type: 'progress',
      data: { message: 'Analyzing video duration...' }
    });
    const duration = await getVideoDuration(processingPath);
    console.log(`Video duration: ${duration}s`);

    // Dynamic frame interval based on video length
    let frameInterval: number;
    if (duration < 300) { // < 5 minutes
      frameInterval = 10; // Every 10 seconds
    } else if (duration < 1200) { // < 20 minutes
      frameInterval = 30; // Every 30 seconds
    } else { // >= 20 minutes
      frameInterval = 60; // Every 60 seconds
    }
    
    // Calculate total frames
    const maxFrames = Math.max(3, Math.ceil(duration / frameInterval));
    console.log(`Frame interval: ${frameInterval}s, Total frames: ${maxFrames}`);

    sendSSEvent(res, {
      type: 'progress',
      data: { message: 'Extracting frames...' }
    });
    console.log('Extracting frames...');
    const framePaths = await extractFrames(processingPath, frameInterval);
    console.log(`Extracted ${framePaths.length} frames`);

    if (framePaths.length === 0) {
      sendSSEvent(res, {
        type: 'error',
        data: { message: 'Could not extract frames from video' }
      });
      res.end();
      
      // Cleanup
      if (videoPath) await cleanupFiles(videoPath);
      if (convertedPath) await cleanupFiles(convertedPath);
      
      return;
    }

    frameDir = path.dirname(framePaths[0]);

    sendSSEvent(res, {
      type: 'progress',
      data: { message: 'Analyzing frames...', totalFrames: framePaths.length }
    });
    console.log('Analyzing frames...');
    
    const frameResults = [];
    for (let i = 0; i < framePaths.length; i++) {
      const timestamp = i * frameInterval;
      sendSSEvent(res, {
        type: 'progress',
        data: { message: `Analyzing frame ${i + 1}/${framePaths.length}` }
      });
      
      const result = await analyzeFrame(framePaths[i], i, timestamp);
      frameResults.push(result);
      
      // Send frame result as it's completed
      sendSSEvent(res, {
        type: 'frame',
        data: result
      });
      
      console.log(`Analyzed frame ${i + 1}/${framePaths.length}`);
    }

    const nsfwFrames = frameResults.filter(f => f.isNSFW).length;
    const avgNsfwConfidence = frameResults
      .filter(f => f.isNSFW)
      .reduce((sum, f) => {
        const nsfwProb = f.predictions
          .filter(p => ['Porn', 'Sexy', 'Hentai'].includes(p.className))
          .reduce((s, p) => s + p.probability, 0);
        return sum + nsfwProb;
      }, 0) / Math.max(nsfwFrames, 1);

    const isNSFW = nsfwFrames > 0;
    const confidence = isNSFW ? avgNsfwConfidence * 100 : (1 - avgNsfwConfidence) * 100;

    const result: AnalysisResult = {
      isNSFW,
      confidence: Math.round(confidence * 100) / 100,
      frameResults,
      totalFrames: framePaths.length,
      nsfwFrames
    };

    console.log(`Analysis complete. NSFW: ${isNSFW}, Confidence: ${confidence.toFixed(2)}%`);

    // Cache the result
    try {
      const fileHash = await generateFileHash(videoPath!);
      await cacheResult(fileHash, result);
    } catch (error) {
      console.error('Error caching result:', error);
    }

    // Send complete result
    sendSSEvent(res, {
      type: 'complete',
      data: result
    });

    // Cleanup files
    if (videoPath) {
      await cleanupFiles(videoPath);
    }
    if (convertedPath) {
      await cleanupFiles(convertedPath);
    }
    if (frameDir) {
      await cleanupDirectory(frameDir);
    }

    res.end();

  } catch (error) {
    console.error('Error analyzing video:', error);

    // Send error event
    sendSSEvent(res, {
      type: 'error',
      data: { message: error instanceof Error ? error.message : 'Unknown error' }
    });

    // Cleanup on error
    if (videoPath) {
      await cleanupFiles(videoPath);
    }
    if (convertedPath) {
      await cleanupFiles(convertedPath);
    }
    if (frameDir) {
      await cleanupDirectory(frameDir);
    }

    res.end();
  }
});

// Convert video to MP4 for browser playback
router.post('/convert', upload.single('video'), async (req: Request, res: Response) => {
  let videoPath: string | null = null;
  let convertedPath: string | null = null;

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No video file uploaded',
        error: 'NO_FILE'
      });
    }

    videoPath = req.file.path;
    console.log(`Converting video: ${videoPath}, type: ${req.file.mimetype}`);

    // Check if conversion is needed
    if (!needsConversion(req.file.mimetype)) {
      // Return original file URL
      const fs = await import('fs');
      const videoBuffer = await fs.promises.readFile(videoPath);
      const base64 = videoBuffer.toString('base64');

      await cleanupFiles(videoPath);

      return res.json({
        success: true,
        message: 'Video is already in browser-supported format',
        dataUrl: `data:${req.file.mimetype};base64,${base64}`,
        converted: false
      });
    }

    // Convert to MP4
    convertedPath = await convertToMp4(videoPath);
    console.log(`Video converted to: ${convertedPath}`);

    // Read converted file and return as base64
    const fs = await import('fs');
    const videoBuffer = await fs.promises.readFile(convertedPath);
    const base64 = videoBuffer.toString('base64');

    // Cleanup
    await cleanupFiles(videoPath);
    await cleanupFiles(convertedPath);

    return res.json({
      success: true,
      message: 'Video converted successfully',
      dataUrl: `data:video/mp4;base64,${base64}`,
      converted: true
    });

  } catch (error) {
    console.error('Error converting video:', error);

    if (videoPath) await cleanupFiles(videoPath);
    if (convertedPath) await cleanupFiles(convertedPath);

    return res.status(500).json({
      success: false,
      message: 'Error converting video',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Clear all cache
router.delete('/cache', async (_req: Request, res: Response) => {
  try {
    const result = await clearAllCache();
    
    if (result.success) {
      return res.json({
        success: true,
        message: `Successfully cleared ${result.count} cached videos`,
        count: result.count
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Failed to clear cache',
        count: 0
      });
    }
  } catch (error) {
    console.error('Error clearing cache:', error);
    return res.status(500).json({
      success: false,
      message: 'Error clearing cache',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
