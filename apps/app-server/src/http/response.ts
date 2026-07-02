export type JsonResponse = {
  statusCode: number;
  headers?: Record<string, string>;
  body: unknown;
  rawBody?: string;
};

export function error(statusCode: number, message: string): JsonResponse {
  return {
    statusCode,
    body: {
      status: 'ERROR',
      message
    }
  };
}

export function ok(body: unknown): JsonResponse {
  return {
    statusCode: 200,
    body
  };
}
