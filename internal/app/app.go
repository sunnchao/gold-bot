package app

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"gold-bot/internal/api"
	"gold-bot/internal/config"
	"gold-bot/internal/domain"
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

type arbitrationStoreAdapter struct {
	repo *sqlitestore.PendingSignalRepository
	db   *sql.DB
}

func (a arbitrationStoreAdapter) GetPendingSignals(ctx context.Context, accountID, symbol string) ([]domain.PendingSignal, error) {
	return a.repo.GetPendingSignals(ctx, accountID, symbol)
}

func (a arbitrationStoreAdapter) UpdateArbitration(ctx context.Context, signalID int64, result, reason string) error {
	return a.repo.UpdateArbitration(ctx, signalID, result, reason)
}

func (a arbitrationStoreAdapter) ExpireStaleSignals(ctx context.Context) (int64, error) {
	return a.repo.ExpireStaleSignals(ctx)
}

func New(cfg config.Config) (*App, error) {
	log.Printf("[APP] 🚀 初始化 Gold Bolt Server...")
	log.Printf("[APP] 📂 DB path: %s", cfg.DBPath)
	if cfg.DSN != "" {
		log.Printf("[APP] 🐘 PostgreSQL DSN: %s", maskDSN(cfg.DSN))
	}
	log.Printf("[APP] 🌐 HTTP addr: %s", cfg.HTTPAddr)

	db, err := store.OpenDB(struct{ DBPath, DSN string }{DBPath: cfg.DBPath, DSN: cfg.DSN})
	if err != nil {
		return nil, err
	}
	if store.IsPostgres() {
		log.Printf("[APP] ✅ PostgreSQL 数据库已连接")
	} else {
		log.Printf("[APP] ✅ SQLite 数据库已打开")
	}

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
	arbitration := arbitrationStoreAdapter{repo: sqlitestore.NewPendingSignalRepository(db), db: db}
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
		Accounts:    accounts,
		Tokens:      tokens,
		Commands:    commands,
		LiveTrading: legacy.NewLiveTradingExecutor(accounts, commands),
	})
	api.RegisterRoutes(mux, api.Dependencies{
		Accounts:    accounts,
		Tokens:      tokens,
		Commands:    commands,
		Releases:    ea.NewLocalReleaseSource("."),
		Events:      events,
		Cutover:     cutover,
		Arbitration: arbitration,
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

func maskDSN(dsn string) string {
	// postgres://user:***@host:5432/db
	if i := strings.Index(dsn, "://"); i >= 0 {
		rest := dsn[i+3:]
		if j := strings.Index(rest, "@"); j >= 0 {
			if k := strings.Index(rest[:j], ":"); k >= 0 {
				return dsn[:i+3+k+1] + "***" + rest[j:]
			}
		}
	}
	return dsn
}
