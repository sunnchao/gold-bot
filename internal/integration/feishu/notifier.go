package feishu

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type Notifier struct {
	WebhookURL string
	Secret     string
	Client     *http.Client
	Cooldown   time.Duration
	lastSent   time.Time
}

func New(webhookURL, secret string, client *http.Client) *Notifier {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &Notifier{
		WebhookURL: webhookURL,
		Secret:     secret,
		Client:     client,
		Cooldown:   10 * time.Minute,
	}
}

func (n *Notifier) Send(ctx context.Context, content string, title string) error {
	if n.WebhookURL == "" {
		return fmt.Errorf("feishu webhook URL is empty")
	}
	if !n.lastSent.IsZero() && time.Since(n.lastSent) < n.Cooldown {
		return nil
	}

	timestamp := time.Now().Unix()
	payload := map[string]any{
		"timestamp": timestamp,
		"sign":      sign(timestamp, n.Secret),
		"msg_type":  "interactive",
		"card": map[string]any{
			"header": map[string]any{
				"title": map[string]any{
					"tag":     "plain_text",
					"content": title,
				},
				"template": "blue",
			},
			"elements": []map[string]any{
				{
					"tag":     "markdown",
					"content": content,
				},
			},
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal feishu payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, n.WebhookURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build feishu request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := n.Client.Do(req)
	if err != nil {
		return fmt.Errorf("send feishu notification: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("feishu status: %d", resp.StatusCode)
	}

	n.lastSent = time.Now()
	return nil
}

func sign(timestamp int64, secret string) string {
	stringToSign := fmt.Sprintf("%d\n%s", timestamp, secret)
	mac := hmac.New(sha256.New, []byte(stringToSign))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}
