export type OracleFixture = {
  fixture: string;
  oracle: {
    source: string;
    head: string;
  };
  request?: FixtureRequest;
  response?: FixtureResponse;
  cases?: FixtureCase[];
  normalization?: Record<string, unknown>;
};

export type FixtureRequest = {
  method: string;
  path: string;
  headers?: Record<string, unknown>;
  body?: unknown;
};

export type FixtureResponse = {
  status_code: number;
  headers?: Record<string, unknown>;
  body?: unknown;
  body_ref?: string;
  frames?: string[];
};

export type FixtureCase = {
  name: string;
  request: FixtureRequest;
  response: FixtureResponse;
};

export function parseOracleFixture(value: unknown): OracleFixture {
  const fixture = expectRecord(value, 'fixture');

  const parsed: OracleFixture = {
    fixture: expectString(fixture.fixture, 'fixture.fixture'),
    oracle: parseOracle(fixture.oracle)
  };

  if ('request' in fixture) {
    parsed.request = parseRequest(fixture.request, 'fixture.request');
  }
  if ('response' in fixture) {
    parsed.response = parseResponse(fixture.response, 'fixture.response');
  }
  if ('cases' in fixture) {
    parsed.cases = expectArray(fixture.cases, 'fixture.cases').map((item, index) => parseCase(item, `fixture.cases[${index}]`));
  }
  if ('normalization' in fixture) {
    parsed.normalization = expectRecord(fixture.normalization, 'fixture.normalization');
  }
  if (parsed.cases == null && (parsed.request == null || parsed.response == null)) {
    throw new Error('fixture must include request/response or cases');
  }

  return parsed;
}

function parseOracle(value: unknown): OracleFixture['oracle'] {
  const oracle = expectRecord(value, 'fixture.oracle');
  return {
    source: expectString(oracle.source, 'fixture.oracle.source'),
    head: expectString(oracle.head, 'fixture.oracle.head')
  };
}

function parseCase(value: unknown, path: string): FixtureCase {
  const fixtureCase = expectRecord(value, path);
  return {
    name: expectString(fixtureCase.name, `${path}.name`),
    request: parseRequest(fixtureCase.request, `${path}.request`),
    response: parseResponse(fixtureCase.response, `${path}.response`)
  };
}

function parseRequest(value: unknown, path: string): FixtureRequest {
  const request = expectRecord(value, path);
  const parsed: FixtureRequest = {
    method: expectString(request.method, `${path}.method`),
    path: expectString(request.path, `${path}.path`)
  };

  if ('headers' in request) {
    parsed.headers = expectRecord(request.headers, `${path}.headers`);
  }
  if ('body' in request) {
    parsed.body = request.body;
  }

  return parsed;
}

function parseResponse(value: unknown, path: string): FixtureResponse {
  const response = expectRecord(value, path);
  const parsed: FixtureResponse = {
    status_code: expectNumber(response.status_code, `${path}.status_code`)
  };

  if ('headers' in response) {
    parsed.headers = expectRecord(response.headers, `${path}.headers`);
  }
  if ('body' in response) {
    parsed.body = response.body;
  }
  if ('body_ref' in response) {
    parsed.body_ref = expectString(response.body_ref, `${path}.body_ref`);
  }
  if ('frames' in response) {
    parsed.frames = expectArray(response.frames, `${path}.frames`).map((frame, index) =>
      expectString(frame, `${path}.frames[${index}]`)
    );
  }

  return parsed;
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function expectNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
  return value;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }
  return value;
}
