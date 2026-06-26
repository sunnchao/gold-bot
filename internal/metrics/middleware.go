package metrics

import (
	"net/http"
	"time"
)

// HTTPMetricsMiddleware wraps an http.Handler to record metrics
type HTTPMetricsMiddleware struct {
	handler http.Handler
}

// NewHTTPMetricsMiddleware creates a new metrics middleware
func NewHTTPMetricsMiddleware(handler http.Handler) *HTTPMetricsMiddleware {
	return &HTTPMetricsMiddleware{handler: handler}
}

func (m *HTTPMetricsMiddleware) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	// Wrap the ResponseWriter to capture status code
	rw := &responseWriter{
		ResponseWriter: w,
		statusCode:     http.StatusOK,
	}

	// Call the actual handler
	m.handler.ServeHTTP(rw, r)

	// Record metrics
	duration := time.Since(start)
	RecordHTTPRequest(r.Method, normalizePath(r.URL.Path), rw.statusCode, duration)
}

// responseWriter wraps http.ResponseWriter to capture status code
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

// normalizePath normalizes URL paths to avoid high cardinality
func normalizePath(path string) string {
	// Legacy EA endpoints
	switch path {
	case "/register", "/heartbeat", "/tick", "/bars", "/positions", "/poll", "/order_result":
		return path
	}

	// API endpoints - keep as-is for now, can be normalized if needed
	if len(path) >= 4 && path[:4] == "/api" {
		// For paths like /api/v1/accounts/123, normalize to /api/v1/accounts/:id
		// This is a simple implementation - enhance as needed
		return path
	}

	// Health check
	if path == "/healthz" || path == "/metrics" {
		return path
	}

	// Dashboard - group all under /
	return "/"
}
