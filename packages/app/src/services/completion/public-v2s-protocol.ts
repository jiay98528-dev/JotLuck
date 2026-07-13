import type {
  PublicEngineGenerateRequest,
  PublicEngineGenerateResponse,
} from './public-engine-types';
import type { PublicV2sModelMetadata } from './public-v2s-binary';

export interface PublicV2sWorkerInitRequest {
  type: 'init';
  requestId: number;
  protocolVersion: number;
  modelUrl: string;
  expectedSha256: string;
  expectedModelBytes: number;
  expectedContainerHeaderSha256?: string;
  maxModelBytes: number;
  maxOutputCodePoints: number;
}

export interface PublicV2sWorkerGenerateRequest {
  type: 'generate';
  requestId: number;
  request: PublicEngineGenerateRequest;
}

export interface PublicV2sWorkerCancelRequest {
  type: 'cancel';
  requestId: number;
}

export type PublicV2sWorkerRequest =
  | PublicV2sWorkerInitRequest
  | PublicV2sWorkerGenerateRequest
  | PublicV2sWorkerCancelRequest;

export interface PublicV2sWorkerReadyResponse {
  type: 'ready';
  requestId: number;
  protocolVersion: number;
  modelSha256: string;
  containerHeaderSha256: string;
  metadata: PublicV2sModelMetadata;
}

export interface PublicV2sWorkerGeneratedResponse {
  type: 'generated';
  requestId: number;
  response: PublicEngineGenerateResponse;
}

export interface PublicV2sWorkerErrorResponse {
  type: 'error';
  requestId: number;
  error: string;
}

export type PublicV2sWorkerResponse =
  | PublicV2sWorkerReadyResponse
  | PublicV2sWorkerGeneratedResponse
  | PublicV2sWorkerErrorResponse;
