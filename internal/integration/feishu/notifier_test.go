package feishu

import (
	"context"
	"io"
	"net/http"
	"sync/atomic"
	"testing"
	"time"
)

func TestSendReturnsWithoutWaitingForWebhook(t *testing.T) {
	transport := &blockingTransport{
		started: make(chan struct{}, 1),
		release: make(chan struct{}),
	}
	notifier := New("https://example.invalid/webhook", "secret", &http.Client{Transport: transport})
	notifier.Cooldown = time.Minute

	start := time.Now()
	err := notifier.Send(context.Background(), "hello", "title")
	if err != nil {
		t.Fatalf("Send returned error: %v", err)
	}
	if time.Since(start) > 100*time.Millisecond {
		t.Fatalf("Send blocked for %v, want under %v", time.Since(start), 100*time.Millisecond)
	}

	select {
	case <-transport.started:
	case <-time.After(time.Second):
		t.Fatal("webhook request did not start")
	}

	err = notifier.Send(context.Background(), "hello again", "title")
	if err != nil {
		t.Fatalf("second Send returned error: %v", err)
	}
	if got := transport.calls.Load(); got != 1 {
		t.Fatalf("transport calls = %d, want 1", got)
	}

	close(transport.release)
}

type blockingTransport struct {
	started chan struct{}
	release chan struct{}
	calls   atomic.Int32
}

func (t *blockingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	t.calls.Add(1)
	select {
	case t.started <- struct{}{}:
	default:
	}
	<-t.release
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(&emptyReader{}),
		Header:     make(http.Header),
	}, nil
}

type emptyReader struct{}

func (*emptyReader) Read([]byte) (int, error) {
	return 0, io.EOF
}
