package breakoutcache

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const ttl = time.Hour

// Cache stores pending breakout confirmations.
type Cache interface {
	Set(symbol, side string, bbLevel float64) error
	Get(symbol, side string) (bbLevel float64, ok bool, err error)
	Del(symbol, side string) error
}

type redisCache struct {
	client *redis.Client
}

type record struct {
	BBLevel     float64 `json:"bb_level"`
	TriggerTime string  `json:"trigger_time"`
}

// New initializes a Redis-backed cache. It returns nil when Redis is not
// configured or unavailable so callers can keep the original direct behavior.
func New() Cache {
	redisURL := strings.TrimSpace(os.Getenv("REDIS_URL"))
	if redisURL == "" {
		return nil
	}

	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Printf("[STRATEGY] Redis breakout cache disabled: invalid REDIS_URL: %v", err)
		return nil
	}

	client := redis.NewClient(opts)
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		log.Printf("[STRATEGY] Redis breakout cache disabled: ping failed: %v", err)
		return nil
	}

	return &redisCache{client: client}
}

func (c *redisCache) Set(symbol, side string, bbLevel float64) error {
	data, err := json.Marshal(record{
		BBLevel:     bbLevel,
		TriggerTime: time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		return err
	}

	return c.client.Set(context.Background(), key(symbol, side), data, ttl).Err()
}

func (c *redisCache) Get(symbol, side string) (float64, bool, error) {
	data, err := c.client.Get(context.Background(), key(symbol, side)).Bytes()
	if errors.Is(err, redis.Nil) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}

	var rec record
	if err := json.Unmarshal(data, &rec); err != nil {
		return 0, false, err
	}
	return rec.BBLevel, true, nil
}

func (c *redisCache) Del(symbol, side string) error {
	return c.client.Del(context.Background(), key(symbol, side)).Err()
}

func key(symbol, side string) string {
	symbol = url.QueryEscape(strings.ToUpper(strings.TrimSpace(symbol)))
	side = url.QueryEscape(strings.ToUpper(strings.TrimSpace(side)))
	return "breakout_confirm:" + symbol + ":" + side
}
