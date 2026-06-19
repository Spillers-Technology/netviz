package materialticket

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	defaultTimeout  = 15 * time.Second
	maxErrorBodyLen = 512
)

// Client is a transport-only client for the MaterialTicket probe endpoints. It
// performs no retry or backoff of its own; callers own retry policy so they can
// decide what to do with unsent records.
type Client struct {
	baseURL    string
	apiKey     string
	version    string
	httpClient *http.Client
}

// Option configures a Client.
type Option func(*Client)

// WithHTTPClient overrides the default HTTP client.
func WithHTTPClient(hc *http.Client) Option {
	return func(c *Client) {
		if hc != nil {
			c.httpClient = hc
		}
	}
}

// NewClient builds a MaterialTicket probe client. baseURL is the backend root
// (e.g. https://rmm.spillerstech.us); apiKey is the probe key sent as
// X-Probe-Key; version is reported in heartbeats.
func NewClient(baseURL, apiKey, version string, opts ...Option) *Client {
	c := &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		apiKey:     apiKey,
		version:    version,
		httpClient: &http.Client{Timeout: defaultTimeout},
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// IngestResult is the response from POST /probe/devices.
type IngestResult struct {
	Received int      `json:"received"`
	Created  int      `json:"created"`
	Updated  int      `json:"updated"`
	Errors   []string `json:"errors"`
}

// SendDevices pushes a batch of device records to POST /probe/devices.
func (c *Client) SendDevices(ctx context.Context, records []DeviceRecord) (IngestResult, error) {
	body := map[string]any{"devices": records}
	var result IngestResult
	if err := c.post(ctx, "/probe/devices", body, &result); err != nil {
		return IngestResult{}, err
	}
	return result, nil
}

// Heartbeat reports liveness to POST /probe/heartbeat. status and cidr are
// optional; the client's version is always included.
func (c *Client) Heartbeat(ctx context.Context, status, cidr string) error {
	body := map[string]any{
		"status":  status,
		"version": c.version,
		"cidr":    cidr,
	}
	return c.post(ctx, "/probe/heartbeat", body, nil)
}

// post sends a JSON body and, when out is non-nil, decodes a JSON response.
// Non-2xx responses are returned as errors with the status and a truncated body.
func (c *Client) post(ctx context.Context, path string, body any, out any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("encode request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Probe-Key", c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("post %s: %w", path, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, maxErrorBodyLen))
		return fmt.Errorf("post %s: unexpected status %s: %s", path, resp.Status, strings.TrimSpace(string(snippet)))
	}

	if out == nil {
		return nil
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("decode response from %s: %w", path, err)
	}
	return nil
}
