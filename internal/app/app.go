package app

import (
	"database/sql"
	"net/http"

	"gold-bot/internal/config"
	"gold-bot/internal/store"
)

type App struct {
	cfg    config.Config
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
		cfg:    cfg,
		db:     db,
		server: server,
	}, nil
}

func MustLoadConfig() config.Config {
	return config.MustLoad()
}

func TestConfig() config.Config {
	return config.Config{
		HTTPAddr: ":0",
		DBPath:   ":memory:",
	}
}

func (a *App) Run() error {
	return a.server.ListenAndServe()
}
