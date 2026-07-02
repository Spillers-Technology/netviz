package server

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

// OIDCConfig enables web sign-in. When Issuer is empty the server runs in
// trusted-LAN mode with no web auth (logged loudly at startup); probe
// endpoints always use X-Probe-Key regardless.
type OIDCConfig struct {
	Issuer       string
	ClientID     string
	ClientSecret string
	// PublicURL is the externally visible base URL of this server, used to
	// build the redirect URI (<PublicURL>/auth/callback).
	PublicURL string
	// SessionSecret signs session cookies. When empty a random per-boot
	// secret is generated, which invalidates sessions on restart.
	SessionSecret []byte
}

const (
	sessionCookie  = "netviz_session"
	flowCookie     = "netviz_auth_flow"
	sessionTTL     = 12 * time.Hour
	flowTTL        = 10 * time.Minute
	sessionRefresh = time.Hour
)

type authenticator struct {
	cfg    OIDCConfig
	secret []byte

	mu       sync.Mutex
	provider *oidc.Provider
	oauth    *oauth2.Config
	initErr  error
}

func newAuthenticator(cfg OIDCConfig) *authenticator {
	secret := cfg.SessionSecret
	if len(secret) == 0 {
		secret = make([]byte, 32)
		_, _ = rand.Read(secret)
	}
	return &authenticator{cfg: cfg, secret: secret}
}

func (a *authenticator) enabled() bool {
	return a != nil && a.cfg.Issuer != ""
}

// setup performs OIDC discovery lazily so the server starts (and tests run)
// without the IdP reachable; the result, success or failure, is retried on
// the next login rather than cached forever only on failure.
func (a *authenticator) setup(ctx context.Context) (*oidc.Provider, *oauth2.Config, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.provider != nil {
		return a.provider, a.oauth, nil
	}
	provider, err := oidc.NewProvider(ctx, a.cfg.Issuer)
	if err != nil {
		return nil, nil, fmt.Errorf("OIDC discovery for %s: %w", a.cfg.Issuer, err)
	}
	a.provider = provider
	a.oauth = &oauth2.Config{
		ClientID:     a.cfg.ClientID,
		ClientSecret: a.cfg.ClientSecret,
		Endpoint:     provider.Endpoint(),
		RedirectURL:  strings.TrimRight(a.cfg.PublicURL, "/") + "/auth/callback",
		Scopes:       []string{oidc.ScopeOpenID, "profile", "email"},
	}
	return a.provider, a.oauth, nil
}

type session struct {
	Subject string    `json:"sub"`
	Email   string    `json:"email,omitempty"`
	Name    string    `json:"name,omitempty"`
	Expires time.Time `json:"exp"`
}

type authFlow struct {
	State    string    `json:"state"`
	Verifier string    `json:"verifier"`
	Expires  time.Time `json:"exp"`
}

// sign produces base64(payload) + "." + base64(hmac-sha256(payload)).
func (a *authenticator) sign(payload []byte) string {
	mac := hmac.New(sha256.New, a.secret)
	mac.Write(payload)
	return base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (a *authenticator) verify(value string) ([]byte, error) {
	payloadPart, sigPart, ok := strings.Cut(value, ".")
	if !ok {
		return nil, errors.New("malformed token")
	}
	payload, err := base64.RawURLEncoding.DecodeString(payloadPart)
	if err != nil {
		return nil, err
	}
	sig, err := base64.RawURLEncoding.DecodeString(sigPart)
	if err != nil {
		return nil, err
	}
	mac := hmac.New(sha256.New, a.secret)
	mac.Write(payload)
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return nil, errors.New("bad signature")
	}
	return payload, nil
}

func (a *authenticator) sessionFrom(r *http.Request) (*session, bool) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil {
		return nil, false
	}
	payload, err := a.verify(cookie.Value)
	if err != nil {
		return nil, false
	}
	var s session
	if err := json.Unmarshal(payload, &s); err != nil {
		return nil, false
	}
	if time.Now().After(s.Expires) {
		return nil, false
	}
	return &s, true
}

func (a *authenticator) secureCookies() bool {
	return strings.HasPrefix(strings.ToLower(a.cfg.PublicURL), "https://")
}

func (a *authenticator) setCookie(w http.ResponseWriter, name string, payload any, ttl time.Duration) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    a.sign(data),
		Path:     "/",
		MaxAge:   int(ttl.Seconds()),
		HttpOnly: true,
		Secure:   a.secureCookies(),
		SameSite: http.SameSiteLaxMode,
	})
	return nil
}

func clearCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
}

// withAuth guards everything except health, probe ingest (key-authed), and
// the auth flow itself. Unauthenticated API calls get 401 JSON; page loads
// get redirected into the sign-in flow.
func (s *Server) withAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.auth.enabled() || authExempt(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		if _, ok := s.auth.sessionFrom(r); ok {
			next.ServeHTTP(w, r)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			writeError(w, http.StatusUnauthorized, "sign-in required")
			return
		}
		http.Redirect(w, r, "/auth/login", http.StatusFound)
	})
}

func authExempt(path string) bool {
	return path == "/healthz" ||
		strings.HasPrefix(path, "/probe/") ||
		strings.HasPrefix(path, "/auth/")
}

func (s *Server) authLogin(w http.ResponseWriter, r *http.Request) {
	if !s.auth.enabled() {
		http.Redirect(w, r, "/", http.StatusFound)
		return
	}
	_, oauthCfg, err := s.auth.setup(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	stateBytes := make([]byte, 16)
	if _, err := rand.Read(stateBytes); err != nil {
		writeError(w, http.StatusInternalServerError, "generate state: "+err.Error())
		return
	}
	state := base64.RawURLEncoding.EncodeToString(stateBytes)
	verifier := oauth2.GenerateVerifier()
	if err := s.auth.setCookie(w, flowCookie, authFlow{State: state, Verifier: verifier, Expires: time.Now().Add(flowTTL)}, flowTTL); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	http.Redirect(w, r, oauthCfg.AuthCodeURL(state, oauth2.S256ChallengeOption(verifier)), http.StatusFound)
}

func (s *Server) authCallback(w http.ResponseWriter, r *http.Request) {
	if !s.auth.enabled() {
		http.Redirect(w, r, "/", http.StatusFound)
		return
	}
	provider, oauthCfg, err := s.auth.setup(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	flowCookieValue, err := r.Cookie(flowCookie)
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing sign-in flow state; start again at /auth/login")
		return
	}
	payload, err := s.auth.verify(flowCookieValue.Value)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid sign-in flow state")
		return
	}
	var flow authFlow
	if err := json.Unmarshal(payload, &flow); err != nil || time.Now().After(flow.Expires) {
		writeError(w, http.StatusBadRequest, "sign-in flow expired; start again at /auth/login")
		return
	}
	if state := r.URL.Query().Get("state"); state == "" || state != flow.State {
		writeError(w, http.StatusBadRequest, "sign-in state mismatch")
		return
	}
	clearCookie(w, flowCookie)

	token, err := oauthCfg.Exchange(r.Context(), r.URL.Query().Get("code"), oauth2.VerifierOption(flow.Verifier))
	if err != nil {
		writeError(w, http.StatusBadGateway, "token exchange failed: "+err.Error())
		return
	}
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok {
		writeError(w, http.StatusBadGateway, "identity provider returned no id_token")
		return
	}
	idToken, err := provider.Verifier(&oidc.Config{ClientID: s.auth.cfg.ClientID}).Verify(r.Context(), rawIDToken)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "id_token verification failed: "+err.Error())
		return
	}

	var claims struct {
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	_ = idToken.Claims(&claims)
	if err := s.auth.setCookie(w, sessionCookie, session{
		Subject: idToken.Subject,
		Email:   claims.Email,
		Name:    claims.Name,
		Expires: time.Now().Add(sessionTTL),
	}, sessionTTL); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	http.Redirect(w, r, "/", http.StatusFound)
}

func (s *Server) authLogout(w http.ResponseWriter, r *http.Request) {
	clearCookie(w, sessionCookie)
	http.Redirect(w, r, "/", http.StatusFound)
}

// me reports the signed-in identity (or that auth is disabled) so the web UI
// can render session state.
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	if !s.auth.enabled() {
		writeJSON(w, http.StatusOK, map[string]any{"auth": false})
		return
	}
	if session, ok := s.auth.sessionFrom(r); ok {
		writeJSON(w, http.StatusOK, map[string]any{
			"auth":  true,
			"sub":   session.Subject,
			"email": session.Email,
			"name":  session.Name,
		})
		return
	}
	writeError(w, http.StatusUnauthorized, "sign-in required")
}
