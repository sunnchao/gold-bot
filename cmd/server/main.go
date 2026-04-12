package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"gold-bot/internal/app"
	"gold-bot/internal/config"
)

type runner interface {
	Run() error
	Close() error
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	err := run(
		ctx,
		config.MustLoad,
		func(cfg config.Config) (runner, error) {
			return app.New(cfg)
		},
	)
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func run(ctx context.Context, loadConfig func() config.Config, newApp func(config.Config) (runner, error)) error {
	server, err := newApp(loadConfig())
	if err != nil {
		return err
	}

	var closeOnce sync.Once
	closeServer := func() error {
		var closeErr error
		closeOnce.Do(func() {
			closeErr = server.Close()
		})
		return closeErr
	}

	runErrCh := make(chan error, 1)
	go func() {
		runErrCh <- server.Run()
	}()

	select {
	case runErr := <-runErrCh:
		return combineRunAndCloseErrors(runErr, closeServer())
	case <-ctx.Done():
		closeErr := closeServer()
		runErr := <-runErrCh
		return combineRunAndCloseErrors(runErr, closeErr)
	}
}

func combineRunAndCloseErrors(runErr, closeErr error) error {
	if closeErr != nil {
		if runErr != nil && !errors.Is(runErr, http.ErrServerClosed) {
			return errors.Join(runErr, closeErr)
		}
		return closeErr
	}

	return runErr
}
