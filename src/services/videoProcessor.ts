import ffmpeg from 'fluent-ffmpeg';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const TEMP_DIR = path.join(__dirname, '../../temp');

export const ensureTempDir = async (): Promise<void> => {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating temp directory:', error);
  }
};

export const extractFrames = async (
  videoPath: string,
  frameInterval: number = 1
): Promise<string[]> => {
  await ensureTempDir();

  const frameDir = path.join(TEMP_DIR, uuidv4());
  await fs.mkdir(frameDir, { recursive: true });

  // Get video duration first
  const duration = await getVideoDuration(videoPath);
  
  // Calculate timestamps for frame extraction
  const timestamps: number[] = [];
  for (let i = 0; i < duration; i += frameInterval) {
    timestamps.push(i);
  }

  console.log(`Extracting frames at timestamps: ${timestamps.join(', ')}s`);

  // Extract frames at specific timestamps (much faster for long videos)
  const framePaths: string[] = [];
  
  for (let i = 0; i < timestamps.length; i++) {
    const timestamp = timestamps[i];
    const outputPath = path.join(frameDir, `frame-${String(i + 1).padStart(4, '0')}.jpg`);
    
    try {
      await extractFrameAtTimestamp(videoPath, timestamp, outputPath);
      framePaths.push(outputPath);
      console.log(`Extracted frame ${i + 1}/${timestamps.length} at ${timestamp}s`);
    } catch (error) {
      console.error(`Error extracting frame at ${timestamp}s:`, error);
      throw new Error(`Failed to extract frame at ${timestamp}s: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return framePaths;
};

const extractFrameAtTimestamp = (
  videoPath: string,
  timestamp: number,
  outputPath: string
): Promise<void> => {
  return new Promise((resolve, reject) => {
    console.log(`Extracting frame at ${timestamp}s to ${outputPath}`);
    ffmpeg(videoPath)
      .seekInput(timestamp)
      .frames(1)
      .outputOptions([
               '-preset ultrafast',
               '-q:v 40',
               '-vf scale=240:-2',
               '-threads 0'
             ])
      .output(outputPath)
      .on('end', () => {
        console.log(`Successfully extracted frame at ${timestamp}s`);
        resolve();
      })
      .on('error', (err, stdout, stderr) => {
        console.error(`Error extracting frame at ${timestamp}s:`, err.message);
        console.error('FFmpeg stderr:', stderr);
        reject(err);
      })
      .run();
  });
};

export const cleanupFiles = async (filePath: string): Promise<void> => {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    console.error('Error cleaning up file:', error);
  }
};

export const cleanupDirectory = async (dirPath: string): Promise<void> => {
  try {
    const files = await fs.readdir(dirPath);
    await Promise.all(files.map(file => fs.unlink(path.join(dirPath, file))));
    await fs.rmdir(dirPath);
  } catch (error) {
    console.error('Error cleaning up directory:', error);
  }
};

export const getVideoDuration = (videoPath: string): Promise<number> => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(metadata.format.duration || 0);
    });
  });
};

// Convert video to MP4 for browser playback (optimized for preview)
export const convertToMp4 = async (videoPath: string): Promise<string> => {
  await ensureTempDir();

  const outputPath = path.join(TEMP_DIR, `${uuidv4()}.mp4`);

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions([
        '-c:v libx264',
        '-c:a aac',
        '-movflags +faststart',
        '-pix_fmt yuv420p',
        '-preset ultrafast',
        '-crf 32',
        '-vf scale=480:-2',
        '-r 15',
        '-threads 0'
      ])
      .output(outputPath)
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', (err) => {
        reject(err);
      })
      .run();
  });
};

// Check if video needs conversion for browser playback
export const needsConversion = (mimeType: string): boolean => {
  const browserSupported = [
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ];
  return !browserSupported.includes(mimeType);
};
