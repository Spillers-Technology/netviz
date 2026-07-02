package server

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Spillers-Technology/netviz/internal/storage"
)

const cryptoSHA256 = crypto.SHA256

func newAuthedServer(t *testing.T, oidcCfg OIDCConfig) *httptest.Server {
	t.Helper()
	store, err := storage.OpenSQLite(filepath.Join(t.TempDir(), "server.db"))
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	srv := New(Config{Store: store, IngestKey: "probe-key", Version: "test", OIDC: oidcCfg})
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return ts
}

func noRedirectClient() *http.Client {
	return &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
}

func TestAuthGuardsRoutes(t *testing.T) {
	ts := newAuthedServer(t, OIDCConfig{Issuer: "https://idp.example.com", ClientID: "netviz", PublicURL: "http://localhost"})
	client := noRedirectClient()

	// API without a session: 401.
	resp, err := client.Get(ts.URL + "/api/state")
	if err != nil {
		t.Fatalf("GET /api/state: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated /api/state: got %d, want 401", resp.StatusCode)
	}

	// Page load without a session: redirect into sign-in.
	resp, err = client.Get(ts.URL + "/")
	if err != nil {
		t.Fatalf("GET /: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusFound || resp.Header.Get("Location") != "/auth/login" {
		t.Fatalf("unauthenticated /: got %d -> %q, want 302 -> /auth/login", resp.StatusCode, resp.Header.Get("Location"))
	}

	// Health stays open.
	resp, err = client.Get(ts.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("/healthz with auth on: got %d, want 200", resp.StatusCode)
	}

	// Probe ingest still uses key auth, not sessions.
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/probe/heartbeat", strings.NewReader(`{"status":"ok"}`))
	req.Header.Set("X-Probe-Key", "probe-key")
	req.Header.Set("Content-Type", "application/json")
	resp, err = client.Do(req)
	if err != nil {
		t.Fatalf("POST /probe/heartbeat: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("probe heartbeat with auth on: got %d, want 200", resp.StatusCode)
	}
}

func TestSessionCookieValidation(t *testing.T) {
	auth := newAuthenticator(OIDCConfig{Issuer: "https://idp.example.com"})

	valid, _ := json.Marshal(session{Subject: "user-1", Email: "a@b.c", Expires: time.Now().Add(time.Hour)})
	expired, _ := json.Marshal(session{Subject: "user-1", Expires: time.Now().Add(-time.Minute)})

	makeRequest := func(value string) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/api/state", nil)
		r.AddCookie(&http.Cookie{Name: sessionCookie, Value: value})
		return r
	}

	if _, ok := auth.sessionFrom(makeRequest(auth.sign(valid))); !ok {
		t.Fatal("valid signed session rejected")
	}
	if _, ok := auth.sessionFrom(makeRequest(auth.sign(expired))); ok {
		t.Fatal("expired session accepted")
	}
	tampered := auth.sign(valid)
	tampered = strings.Replace(tampered, ".", "x.", 1)
	if _, ok := auth.sessionFrom(makeRequest(tampered)); ok {
		t.Fatal("tampered session accepted")
	}
	other := newAuthenticator(OIDCConfig{Issuer: "https://idp.example.com"})
	if _, ok := auth.sessionFrom(makeRequest(other.sign(valid))); ok {
		t.Fatal("session signed with a different secret accepted")
	}
}

// TestFullOIDCSignIn drives login -> IdP redirect -> callback -> session
// against a minimal in-process OIDC issuer with a real RSA-signed id_token.
func TestFullOIDCSignIn(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa key: %v", err)
	}

	var issuerURL string
	issuer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			writeJSON(w, http.StatusOK, map[string]any{
				"issuer":                                issuerURL,
				"authorization_endpoint":                issuerURL + "/authorize",
				"token_endpoint":                        issuerURL + "/token",
				"jwks_uri":                              issuerURL + "/keys",
				"id_token_signing_alg_values_supported": []string{"RS256"},
			})
		case "/keys":
			writeJSON(w, http.StatusOK, map[string]any{
				"keys": []map[string]any{{
					"kty": "RSA",
					"kid": "test-key",
					"alg": "RS256",
					"use": "sig",
					"n":   base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
					"e":   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
				}},
			})
		case "/token":
			idToken := signTestJWT(t, key, map[string]any{
				"iss":   issuerURL,
				"aud":   "netviz-client",
				"sub":   "user-42",
				"email": "tech@example.com",
				"exp":   time.Now().Add(time.Hour).Unix(),
				"iat":   time.Now().Unix(),
			})
			writeJSON(w, http.StatusOK, map[string]any{
				"access_token": "test-access",
				"token_type":   "Bearer",
				"id_token":     idToken,
				"expires_in":   3600,
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer issuer.Close()
	issuerURL = issuer.URL

	ts := newAuthedServer(t, OIDCConfig{
		Issuer:    issuerURL,
		ClientID:  "netviz-client",
		PublicURL: "http://localhost",
	})
	client := noRedirectClient()

	// Step 1: login redirects to the IdP with state + PKCE and sets the flow cookie.
	resp, err := client.Get(ts.URL + "/auth/login")
	if err != nil {
		t.Fatalf("GET /auth/login: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("/auth/login: got %d, want 302", resp.StatusCode)
	}
	authorize, err := url.Parse(resp.Header.Get("Location"))
	if err != nil {
		t.Fatalf("parse authorize URL: %v", err)
	}
	state := authorize.Query().Get("state")
	if state == "" || authorize.Query().Get("code_challenge") == "" || authorize.Query().Get("code_challenge_method") != "S256" {
		t.Fatalf("authorize URL missing state or PKCE: %s", authorize)
	}
	var flow *http.Cookie
	for _, cookie := range resp.Cookies() {
		if cookie.Name == flowCookie {
			flow = cookie
		}
	}
	if flow == nil {
		t.Fatal("login did not set the flow cookie")
	}

	// Step 2: callback with the IdP "code" exchanges and establishes a session.
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/auth/callback?state="+url.QueryEscape(state)+"&code=fake-code", nil)
	req.AddCookie(flow)
	resp, err = client.Do(req)
	if err != nil {
		t.Fatalf("GET /auth/callback: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("/auth/callback: got %d, want 302 (session established)", resp.StatusCode)
	}
	var sessionCookieValue *http.Cookie
	for _, cookie := range resp.Cookies() {
		if cookie.Name == sessionCookie && cookie.Value != "" {
			sessionCookieValue = cookie
		}
	}
	if sessionCookieValue == nil {
		t.Fatal("callback did not set a session cookie")
	}

	// Step 3: the session opens the API and /api/me reports identity.
	req, _ = http.NewRequest(http.MethodGet, ts.URL+"/api/me", nil)
	req.AddCookie(sessionCookieValue)
	resp, err = client.Do(req)
	if err != nil {
		t.Fatalf("GET /api/me: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("/api/me with session: got %d, want 200", resp.StatusCode)
	}
	var me struct {
		Auth  bool   `json:"auth"`
		Email string `json:"email"`
		Sub   string `json:"sub"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&me); err != nil {
		t.Fatalf("decode /api/me: %v", err)
	}
	if !me.Auth || me.Email != "tech@example.com" || me.Sub != "user-42" {
		t.Fatalf("/api/me = %+v, want the id_token identity", me)
	}

	// A wrong state must be rejected.
	req, _ = http.NewRequest(http.MethodGet, ts.URL+"/auth/callback?state=wrong&code=fake-code", nil)
	req.AddCookie(flow)
	resp, err = client.Do(req)
	if err != nil {
		t.Fatalf("GET /auth/callback (bad state): %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("callback with wrong state: got %d, want 400", resp.StatusCode)
	}
}

func signTestJWT(t *testing.T, key *rsa.PrivateKey, claims map[string]any) string {
	t.Helper()
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT", "kid": "test-key"})
	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatalf("marshal claims: %v", err)
	}
	signingInput := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload)
	digest := sha256.Sum256([]byte(signingInput))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, cryptoSHA256, digest[:])
	if err != nil {
		t.Fatalf("sign jwt: %v", err)
	}
	return fmt.Sprintf("%s.%s", signingInput, base64.RawURLEncoding.EncodeToString(signature))
}
