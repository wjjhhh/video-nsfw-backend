import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-wasm';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { Prediction, FrameResult } from '../types';

let model: tf.LayersModel | null = null;
let useMockModel = false;

const NSFW_THRESHOLD = 0.7;
const CLASSES = ['Drawing', 'Hentai', 'Neutral', 'Porn', 'Sexy'];

const MODEL_DIR = path.join(__dirname, '../../models');

class LocalModelHandler {
  private modelDir: string;

  constructor(modelDir: string) {
    this.modelDir = modelDir;
  }

  async load(): Promise<ModelArtifacts> {
    const modelJsonPath = path.join(this.modelDir, 'model.json');
    const modelJson = JSON.parse(fs.readFileSync(modelJsonPath, 'utf-8'));

    const weightSpecs: WeightsManifestEntry[] = modelJson.weightsManifest.map(
      (entry: { paths: string[]; weights: WeightsManifestEntry['weights'] }) => ({
        paths: entry.paths,
        weights: entry.weights
      })
    );

    const weightDataArray: Uint8Array[] = [];
    for (const entry of modelJson.weightsManifest) {
      for (const weightPath of entry.paths) {
        const weightFilePath = path.join(this.modelDir, weightPath);
        const weightData = fs.readFileSync(weightFilePath);
        weightDataArray.push(new Uint8Array(weightData));
      }
    }

    const totalLength = weightDataArray.reduce((sum, arr) => sum + arr.length, 0);
    const weightData = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of weightDataArray) {
      weightData.set(arr, offset);
      offset += arr.length;
    }

    return {
      modelTopology: modelJson.modelTopology,
      weightSpecs: weightSpecs.flatMap(w => w.weights),
      weightData: weightData.buffer
    };
  }
}

interface ModelArtifacts {
  modelTopology: object;
  weightSpecs: WeightsManifestEntry['weights'];
  weightData: ArrayBuffer;
}

interface WeightsManifestEntry {
  paths: string[];
  weights: Array<{
    name: string;
    shape: number[];
    dtype: string;
  }>;
}

export const initModel = async (): Promise<void> => {
  try {
    // Set WASM backend for better performance
    console.log('Setting up WASM backend...');
    await tf.setBackend('wasm');
    console.log('WASM backend initialized');
    
    const modelJsonPath = path.join(MODEL_DIR, 'model.json');
    
    if (!fs.existsSync(modelJsonPath)) {
      console.log('Local model not found at:', MODEL_DIR);
      console.log('To use real model, place model files in:', MODEL_DIR);
      useMockModel = true;
      console.log('Mock model initialized (for demo purposes only)');
      return;
    }

    console.log('Loading NSFW model from local path:', modelJsonPath);
    
    const handler = new LocalModelHandler(MODEL_DIR);
    const modelArtifacts = await handler.load();
    
    model = await tf.loadLayersModel(tf.io.fromMemory(
      modelArtifacts.modelTopology as any,
      modelArtifacts.weightSpecs as any,
      modelArtifacts.weightData
    ));
    
    console.log('NSFW model loaded successfully from local path');
    console.log('Model input shape:', model.inputs[0].shape);
    console.log('Using backend:', tf.getBackend());
  } catch (error) {
    console.warn('Failed to load model, using mock model for demo');
    console.warn('Error:', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.warn('Stack:', error.stack.split('\n').slice(0, 5).join('\n'));
    }
    useMockModel = true;
    console.log('Mock model initialized (for demo purposes only)');
  }
};

const loadImageAsTensor = async (imagePath: string): Promise<tf.Tensor> => {
  const { data, info } = await sharp(imagePath)
    .resize(224, 224, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const normalizedData = new Float32Array(info.width * info.height * 3);
  for (let i = 0; i < data.length; i++) {
    normalizedData[i] = data[i] / 255;
  }

  const tensor = tf.tensor4d(normalizedData, [1, info.height, info.width, 3]);
  return tensor;
};

const mockClassify = (): Prediction[] => {
  const random = Math.random();
  if (random < 0.3) {
    return [
      { className: 'Porn', probability: 0.7 + Math.random() * 0.2 },
      { className: 'Sexy', probability: 0.1 + Math.random() * 0.1 },
      { className: 'Hentai', probability: Math.random() * 0.05 },
      { className: 'Neutral', probability: Math.random() * 0.1 },
      { className: 'Drawing', probability: Math.random() * 0.05 },
    ];
  } else if (random < 0.5) {
    return [
      { className: 'Sexy', probability: 0.6 + Math.random() * 0.2 },
      { className: 'Neutral', probability: 0.1 + Math.random() * 0.1 },
      { className: 'Porn', probability: Math.random() * 0.1 },
      { className: 'Hentai', probability: Math.random() * 0.05 },
      { className: 'Drawing', probability: Math.random() * 0.05 },
    ];
  } else {
    return [
      { className: 'Neutral', probability: 0.7 + Math.random() * 0.2 },
      { className: 'Drawing', probability: 0.1 + Math.random() * 0.1 },
      { className: 'Sexy', probability: Math.random() * 0.05 },
      { className: 'Porn', probability: Math.random() * 0.02 },
      { className: 'Hentai', probability: Math.random() * 0.03 },
    ];
  }
};

export const classifyImage = async (imagePath: string): Promise<Prediction[]> => {
  if (useMockModel) {
    return mockClassify();
  }

  if (!model) {
    throw new Error('Model not initialized');
  }

  const tensor = await loadImageAsTensor(imagePath);

  try {
    const predictions = model.predict(tensor) as tf.Tensor;
    const probabilities = await predictions.data();
    
    const results = CLASSES.map((className, index) => ({
      className,
      probability: probabilities[index]
    }));

    results.sort((a, b) => b.probability - a.probability);
    return results;
  } finally {
    tensor.dispose();
  }
};

export const isNSFW = (predictions: Prediction[]): boolean => {
  const nsfwClasses = ['Porn', 'Sexy', 'Hentai'];
  const totalNsfwProb = predictions
    .filter(p => nsfwClasses.includes(p.className))
    .reduce((sum, p) => sum + p.probability, 0);

  return totalNsfwProb > NSFW_THRESHOLD;
};

export const analyzeFrame = async (
  imagePath: string,
  frameIndex: number,
  timestamp: number
): Promise<FrameResult> => {
  // First get predictions (AI analysis)
  const predictions = await classifyImage(imagePath);
  const nsfw = isNSFW(predictions);

  // Read frame image as base64 for display
  const imageBuffer = await fs.promises.readFile(imagePath);
  const frameImage = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

  return {
    frameIndex,
    timestamp,
    predictions,
    isNSFW: nsfw,
    frameImage
  };
};

export const isUsingMockModel = (): boolean => useMockModel;
