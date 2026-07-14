const { performance } = require('node:perf_hooks');

function createBenchmarkTelemetry(fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required for benchmark telemetry.');
  }

  let currentRun = null;

  async function instrumentedFetch(url, options) {
    const start = performance.now();
    try {
      const response = await fetchImpl(url, options);
      const durationMs = Number((performance.now() - start).toFixed(3));
      if (currentRun) {
        currentRun.requests.push(buildRequestRecord(url, response.status, durationMs));
      }
      return response;
    } catch (error) {
      const durationMs = Number((performance.now() - start).toFixed(3));
      if (currentRun) {
        currentRun.requests.push(buildRequestRecord(url, null, durationMs, error));
      }
      throw error;
    }
  }

  return {
    fetchImpl: instrumentedFetch,
    startRun(metadata) {
      if (currentRun) {
        throw new Error('Benchmark telemetry run already in progress.');
      }

      currentRun = {
        metadata: metadata || {},
        requests: [],
      };
    },
    finishRun(extra = {}) {
      if (!currentRun) {
        throw new Error('No benchmark telemetry run is active.');
      }

      const finished = currentRun;
      currentRun = null;
      const requests = finished.requests.map((request) => ({ ...request }));
      const durations = requests.map((request) => request.duration_ms);

      return {
        metadata: { ...finished.metadata },
        requests,
        request_count: requests.length,
        total_ms: round(sum(durations)),
        max_ms: round(durations.length > 0 ? Math.max(...durations) : 0),
        ...extra,
      };
    },
  };
}

function buildRequestRecord(url, status, durationMs, error) {
  const parsed = new URL(String(url));
  const query = {};

  for (const [key, value] of parsed.searchParams.entries()) {
    query[key] = value;
  }

  return {
    url: parsed.toString(),
    pathname: parsed.pathname,
    query,
    status,
    duration_ms: round(durationMs),
    error_code: error?.code || null,
  };
}

function countPageRequests(requests) {
  return requests.filter((request) => request.query.page_number).length;
}

function countDocumentDownloads(requests) {
  return requests.filter((request) => request.pathname === '/modules/document/download.php').length;
}

function round(value) {
  return Number(Number(value || 0).toFixed(3));
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

module.exports = {
  countDocumentDownloads,
  countPageRequests,
  createBenchmarkTelemetry,
};
