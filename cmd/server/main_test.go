package main

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"testing"
	"time"

	"gold-bot/internal/config"
)

type fakeApp struct {
	runErr   error
	closeErr error
	runGate  chan struct{}
	runStart chan struct{}

	mu         sync.Mutex
	closeOnce  sync.Once
	closeCalls int
	closed     bool
}

func (a *fakeApp) Run() error {
	if a.runStart != nil {
		close(a.runStart)
	}
	if a.runGate != nil {
		<-a.runGate
	}
	return a.runErr
}

func (a *fakeApp) Close() error {
	a.mu.Lock()
	a.closed = true
	a.closeCalls++
	a.mu.Unlock()

	a.closeOnce.Do(func() {
		if a.runGate != nil {
			close(a.runGate)
		}
	})

	return a.closeErr
}

func TestRunClosesAppAfterRunReturns(t *testing.T) {
	cfg := config.Config{HTTPAddr: ":0", DBPath: "test.sqlite"}
	app := &fakeApp{runErr: errors.New("run failed")}

	err := run(
		context.Background(),
		func() config.Config { return cfg },
		func(got config.Config) (runner, error) {
			if got != cfg {
				t.Fatalf("config = %#v, want %#v", got, cfg)
			}
			return app, nil
		},
	)
	if !errors.Is(err, app.runErr) {
		t.Fatalf("error = %v, want run error %v", err, app.runErr)
	}
	if !app.closed {
		t.Fatal("Close was not called after Run returned")
	}
}

func TestRunReturnsCloseErrorWhenRunSucceeds(t *testing.T) {
	app := &fakeApp{closeErr: errors.New("close failed")}

	err := run(
		context.Background(),
		func() config.Config { return config.Config{} },
		func(config.Config) (runner, error) {
			return app, nil
		},
	)
	if !errors.Is(err, app.closeErr) {
		t.Fatalf("error = %v, want close error %v", err, app.closeErr)
	}
	if !app.closed {
		t.Fatal("Close was not called")
	}
}

func TestRunClosesAppWhenContextCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	app := &fakeApp{
		runErr:   http.ErrServerClosed,
		runGate:  make(chan struct{}),
		runStart: make(chan struct{}),
	}

	errCh := make(chan error, 1)
	go func() {
		errCh <- run(
			ctx,
			func() config.Config { return config.Config{} },
			func(config.Config) (runner, error) {
				return app, nil
			},
		)
	}()

	select {
	case <-app.runStart:
	case <-time.After(time.Second):
		t.Fatal("Run was not called")
	}

	cancel()

	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			t.Fatalf("error = %v, want %v", err, http.ErrServerClosed)
		}
	case <-time.After(time.Second):
		t.Fatal("run did not return after context cancellation")
	}

	app.mu.Lock()
	defer app.mu.Unlock()
	if !app.closed {
		t.Fatal("Close was not called after context cancellation")
	}
	if app.closeCalls != 1 {
		t.Fatalf("Close called %d times, want 1", app.closeCalls)
	}
}

func TestRunReturnsCloseErrorOnShutdown(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	app := &fakeApp{
		runErr:   http.ErrServerClosed,
		closeErr: errors.New("close failed"),
		runGate:  make(chan struct{}),
		runStart: make(chan struct{}),
	}

	errCh := make(chan error, 1)
	go func() {
		errCh <- run(
			ctx,
			func() config.Config { return config.Config{} },
			func(config.Config) (runner, error) {
				return app, nil
			},
		)
	}()

	select {
	case <-app.runStart:
	case <-time.After(time.Second):
		t.Fatal("Run was not called")
	}

	cancel()

	select {
	case err := <-errCh:
		if !errors.Is(err, app.closeErr) {
			t.Fatalf("error = %v, want close error %v", err, app.closeErr)
		}
		if errors.Is(err, http.ErrServerClosed) {
			t.Fatalf("error = %v, did not want %v once close failed", err, http.ErrServerClosed)
		}
	case <-time.After(time.Second):
		t.Fatal("run did not return after context cancellation")
	}
}
