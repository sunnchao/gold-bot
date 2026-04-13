package app

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"time"

	"gold-bot/internal/api"
	"gold-bot/internal/config"
	"gold-bot/internal/ea"
	"gold-bot/internal/legacy"
	"gold-bot/internal/realtime"
	"gold-bot/internal/scheduler"
	"gold-bot/internal/store"
	sqlitestore "gold-bot/internal/store/sqlite"
)

type App struct {
	db     *sql.DB
	server *http.Server
}

func New(cfg config.Config) (*App, error) {
	log.Printf("[APP] 🚀 初始化 Gold Bolt Server...")
	log.Printf("[APP] 📂 DB path: %s", cfg.DBPath)
	log.Printf("[APP] 🌐 HTTP addr: %s", cfg.HTTPAddr)

	db, err := store.OpenSQLite(cfg.DBPath)
	if err != nil {
		return nil, err
	}
	log.Printf("[APP] ✅ SQLite 数据库已打开")

	if err := store.RunMigrations(db); err != nil {
		_ = db.Close()
		return nil, err
	}
	log.Printf("[APP] ✅ 数据库迁移完成")

	now := time.Now().UTC()

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	accounts := sqlitestore.NewAccountRepository(db)
	tokens := sqlitestore.NewTokenRepository(db)
	commands := sqlitestore.NewCommandRepository(db)
	if err := bootstrapTokens(context.Background(), tokens, cfg, now); err != nil {
		_ = db.Close()
		return nil, err
	}
	log.Printf("[APP] ✅ Token 引导完成")

	events := realtime.NewHub()
	cutover := scheduler.NewCutoverService(scheduler.StaticShadowStatsSource{
		Stats: scheduler.ShadowStats{
			ReplayValidated: true,
		},
	})

	legacy.RegisterRoutes(mux, legacy.Dependencies{
		Accounts: accounts,
		Tokens:   tokens,
	})
	api.RegisterRoutes(mux, api.Dependencies{
		Accounts: accounts,
		Tokens:   tokens,
		Commands: commands,
		Releases: ea.NewLocalReleaseSource("."),
		Events:   events,
		Cutover:  cutover,
	})
	mux.Handle("/", newDashboardHandler(findDashboardDist()))

	log.Printf("[APP] ✅ 路由注册完成 | Legacy: /register, /heartbeat, /tick, /bars, /positions, /poll, /order_result")
	log.Printf("[APP] ✅ 路由注册完成 | API: /api/analysis_payload, /api/ai_result, /api/tokens, /api/v1/overview")
	log.Printf("[APP] ✅ 路由注册完成 | Dashboard: /")

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
	log.Printf("[APP] 🌐 Gold Bolt Server 启动中 %s ...", a.server.Addr)
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
