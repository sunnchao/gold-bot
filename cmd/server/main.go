package main

import (
	"errors"
	"log"
	"net/http"

	"gold-bot/internal/app"
	"gold-bot/internal/config"
)

type runner interface {
	Run() error
	Close() error
}

func main() {
	err := run(
		config.MustLoad,
		func(cfg config.Config) (runner, error) {
			return app.New(cfg)
		},
	)
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func run(loadConfig func() config.Config, newApp func(config.Config) (runner, error)) (err error) {
	server, err := newApp(loadConfig())
	if err != nil {
		return err
	}
	defer func() {
		err = errors.Join(err, server.Close())
	}()

	return server.Run()
}
