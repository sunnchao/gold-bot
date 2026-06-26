package metrics

import (
	"context"
	"database/sql"
	"log"
	"time"
)

// DBStatsCollector periodically collects database connection pool statistics
type DBStatsCollector struct {
	db       *sql.DB
	interval time.Duration
	stopCh   chan struct{}
}

// NewDBStatsCollector creates a new database stats collector
func NewDBStatsCollector(db *sql.DB, interval time.Duration) *DBStatsCollector {
	return &DBStatsCollector{
		db:       db,
		interval: interval,
		stopCh:   make(chan struct{}),
	}
}

// Start begins collecting database stats
func (c *DBStatsCollector) Start(ctx context.Context) {
	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()

	log.Printf("[METRICS] 📊 Database stats collector started (interval: %v)", c.interval)

	for {
		select {
		case <-ticker.C:
			stats := c.db.Stats()
			DBConnectionsOpen.Set(float64(stats.OpenConnections))
			DBConnectionsInUse.Set(float64(stats.InUse))
		case <-c.stopCh:
			log.Printf("[METRICS] 📊 Database stats collector stopped")
			return
		case <-ctx.Done():
			log.Printf("[METRICS] 📊 Database stats collector stopped (context cancelled)")
			return
		}
	}
}

// Stop stops the collector
func (c *DBStatsCollector) Stop() {
	close(c.stopCh)
}
