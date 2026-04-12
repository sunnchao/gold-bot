package app

import (
	"database/sql"
	"errors"
	"net/http"

	"gold-bot/internal/config"
	"gold-bot/internal/store"
)

type App struct {
	db     *sql.DB
	server *http.Server
}

func New(cfg config.Config) (*App, error) {
	db, err := store.OpenSQLite(cfg.DBPath)
	if err != nil {
		return nil, err
	}

	if err := store.RunMigrations(db); err != nil {
		_ = db.Close()
		return nil, err
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	server := &http.Server{
		Addr:    cfg.HTTPAddr,
		Handler: mux,
	}

	return &App{
		db:     db,
		server: server,
	}, nil
}

func (a *App) Run() error {
	return a.server.ListenAndServe()
}

func (a *App) Close() error {
	var err error

	if a.server != nil {
		err = errors.Join(err, a.server.Close())
	}
	if a.db != nil {
		err = errors.Join(err, a.db.Close())
	}

	return err
}
