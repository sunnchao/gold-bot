package discord

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type Notifier struct {
	WebhookURL string
	Client     *http.Client
	Cooldown   time.Duration
	lastSent   time.Time
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
	if !n.lastSent.IsZero() && time.Since(n.lastSent) < n.Cooldown {
		return nil
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal discord payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, n.WebhookURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build discord request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := n.Client.Do(req)
	if err != nil {
		return fmt.Errorf("send discord notification: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("discord status: %d", resp.StatusCode)
	}

	n.lastSent = time.Now()
	return nil
}
