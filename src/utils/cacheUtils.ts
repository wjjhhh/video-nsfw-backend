import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AnalysisResult } from '../types';

const CACHE_DIR = path.join(__dirname, '../../cache');

// Ensure cache directory exists
export const ensureCacheDir = async (): Promise<void> => {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating cache directory:', error);
  }
};

// Generate hash from file content
export const generateFileHash = async (filePath: string): Promise<string> => {
  try {
    const fileBuffer = await fs.readFile(filePath);
    const hash = crypto.createHash('sha256');
    hash.update(fileBuffer);
    return hash.digest('hex');
  } catch (error) {
    console.error('Error generating file hash:', error);
    throw error;
  }
};

// Get cache key for video analysis
export const getCacheKey = (fileHash: string): string => {
  return `${fileHash}.json`;
};

// Check if analysis result is cached
export const isCached = async (fileHash: string): Promise<boolean> => {
  try {
    await ensureCacheDir();
    const cacheKey = getCacheKey(fileHash);
    const cachePath = path.join(CACHE_DIR, cacheKey);
    
    await fs.access(cachePath);
    return true;
  } catch (error) {
    return false;
  }
};

// Get cached analysis result
export const getCachedResult = async (fileHash: string): Promise<AnalysisResult | null> => {
  try {
    await ensureCacheDir();
    const cacheKey = getCacheKey(fileHash);
    const cachePath = path.join(CACHE_DIR, cacheKey);
    
    const cachedData = await fs.readFile(cachePath, 'utf8');
    return JSON.parse(cachedData) as AnalysisResult;
  } catch (error) {
    console.error('Error getting cached result:', error);
    return null;
  }
};

// Cache analysis result
export const cacheResult = async (fileHash: string, result: AnalysisResult): Promise<void> => {
  try {
    await ensureCacheDir();
    const cacheKey = getCacheKey(fileHash);
    const cachePath = path.join(CACHE_DIR, cacheKey);
    
    await fs.writeFile(cachePath, JSON.stringify(result, null, 2));
    console.log(`Result cached for hash: ${fileHash}`);
  } catch (error) {
    console.error('Error caching result:', error);
  }
};

// Cleanup old cache (optional)
export const cleanupCache = async (maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> => {
  try {
    await ensureCacheDir();
    const files = await fs.readdir(CACHE_DIR);
    const now = Date.now();
    
    for (const file of files) {
      const filePath = path.join(CACHE_DIR, file);
      const stats = await fs.stat(filePath);
      
      if (now - stats.mtime.getTime() > maxAge) {
        await fs.unlink(filePath);
        console.log(`Cleaned up old cache: ${file}`);
      }
    }
  } catch (error) {
    console.error('Error cleaning up cache:', error);
  }
};

// Clear all cache
export const clearAllCache = async (): Promise<{ success: boolean; count: number }> => {
  try {
    await ensureCacheDir();
    const files = await fs.readdir(CACHE_DIR);
    let count = 0;
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(CACHE_DIR, file);
        await fs.unlink(filePath);
        count++;
        console.log(`Deleted cache file: ${file}`);
      }
    }
    
    console.log(`Cleared ${count} cache files`);
    return { success: true, count };
  } catch (error) {
    console.error('Error clearing cache:', error);
    return { success: false, count: 0 };
  }
};
