package discord

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

type Notifier struct {
	WebhookURL string
	Client     *http.Client
	Cooldown   time.Duration
	lastSent   time.Time
	mu         sync.Mutex
}

func New(webhookURL string, client *http.Client) *Notifier {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &Notifier{
		WebhookURL: webhookURL,
		Client:     client,
		Cooldown:   15 * time.Minute,
	}
}

func (n *Notifier) Send(ctx context.Context, payload map[string]any) error {
	if n.WebhookURL == "" {
		return fmt.Errorf("discord webhook URL is empty")
	}

	n.mu.Lock()
	if !n.lastSent.IsZero() && time.Since(n.lastSent) < n.Cooldown {
		n.mu.Unlock()
		return nil
	}
	n.lastSent = time.Now()
	n.mu.Unlock()

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal discord payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, n.WebhookURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build discord request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	go func() {
		resp, err := n.Client.Do(req)
		if err != nil {
			log.Printf("[DISCORD] send notification failed: %v", err)
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
			log.Printf("[DISCORD] webhook status: %d", resp.StatusCode)
		}
	}()

	return nil
}
