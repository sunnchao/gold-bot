package main

import (
	"errors"
	"testing"

	"gold-bot/internal/config"
)

type fakeApp struct {
	runErr   error
	closeErr error
	closed   bool
}

func (a *fakeApp) Run() error {
	return a.runErr
}

func (a *fakeApp) Close() error {
	a.closed = true
	return a.closeErr
}

func TestRunClosesAppAfterRunReturns(t *testing.T) {
	cfg := config.Config{HTTPAddr: ":0", DBPath: "test.sqlite"}
	app := &fakeApp{runErr: errors.New("run failed")}

	err := run(
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
