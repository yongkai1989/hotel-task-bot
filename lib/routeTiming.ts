export function logRouteTiming(input: {
  route: string;
  method: string;
  startedAt: number;
  status: number;
  requestId?: string | null;
  stages?: Record<string, number>;
  error?: string;
}) {
  const payload = {
    event: 'api_route_complete',
    route: input.route,
    method: input.method,
    status: input.status,
    total_ms: Date.now() - input.startedAt,
    request_id: input.requestId || undefined,
    ...input.stages,
    error: input.error || undefined,
  };
  if (input.status >= 500) console.error(JSON.stringify(payload));
  else console.log(JSON.stringify(payload));
}
