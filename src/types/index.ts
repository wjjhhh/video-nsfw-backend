export interface AnalysisResult {
  isNSFW: boolean;
  confidence: number;
  frameResults: FrameResult[];
  totalFrames: number;
  nsfwFrames: number;
}

export interface FrameResult {
  frameIndex: number;
  timestamp: number;
  predictions: Prediction[];
  isNSFW: boolean;
  frameImage?: string;
}

export interface Prediction {
  className: string;
  probability: number;
}

export interface UploadResponse {
  success: boolean;
  message: string;
  result?: AnalysisResult;
  error?: string;
  previewUrl?: string;
  converted?: boolean;
}
