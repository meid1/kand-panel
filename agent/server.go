package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type Server struct {
	x         *Xray
	jwtSecret []byte
}

// auth — проверка Bearer JWT (транспорт уже защищён mTLS: чужой клиент без серта,
// подписанного нашим CA, вообще не подключится).
func (s *Server) auth(r *http.Request) bool {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return false
	}
	tok := strings.TrimPrefix(h, "Bearer ")
	t, err := jwt.Parse(tok, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		return s.jwtSecret, nil
	})
	return err == nil && t.Valid
}

func (s *Server) guard(fn http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.auth(r) {
			http.Error(w, "unauthorized", 401)
			return
		}
		fn(w, r)
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// POST /apply {"users":[{uuid,email,flow}]} — привести ноду к desired-набору.
func (s *Server) apply(w http.ResponseWriter, r *http.Request) {
	var body struct{ Users []User `json:"users"` }
	if json.NewDecoder(r.Body).Decode(&body) != nil {
		http.Error(w, "bad json", 400)
		return
	}
	added, removed, aduUnavail, err := s.x.Reconcile(body.Users)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, map[string]any{"ok": true, "added": added, "removed": removed,
		"adu_unavailable": aduUnavail, "total": len(body.Users)})
}

// GET /state — версия/здоровье/кол-во юзеров (для сверки панелью).
func (s *Server) state(w http.ResponseWriter, r *http.Request) {
	emails, _ := s.x.cfg.ConfigEmails()
	writeJSON(w, map[string]any{"ok": true, "version": Version,
		"xray_healthy": s.x.Healthy(), "users": len(emails)})
}

// GET /health
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"ok": true, "xray_healthy": s.x.Healthy(),
		"version": Version})
}

// GET /stats?reset=1 — трафик по клиентам (дельта, с обнулением если reset).
func (s *Server) stats(w http.ResponseWriter, r *http.Request) {
	reset := r.URL.Query().Get("reset") == "1"
	st, err := s.x.Stats(reset)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, map[string]any{"ok": true, "users": st})
}

// POST /config {"config":{...}} — обновить базовый xray-конфиг ноды (валидация +
// атомарно + рестарт). Панель после этого шлёт /apply для восстановления клиентов.
func (s *Server) setConfig(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Config json.RawMessage `json:"config"`
	}
	if json.NewDecoder(r.Body).Decode(&body) != nil || len(body.Config) == 0 {
		http.Error(w, "bad json", 400)
		return
	}
	if err := s.x.cfg.ApplyBase([]byte(body.Config), s.x.bin); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	s.x.Restart()
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/apply", s.guard(s.apply))
	mux.HandleFunc("/config", s.guard(s.setConfig))
	mux.HandleFunc("/state", s.guard(s.state))
	mux.HandleFunc("/stats", s.guard(s.stats))
	mux.HandleFunc("/health", s.health) // health без JWT, но за mTLS
	return mux
}

// tlsConfig — mTLS: агент принимает ТОЛЬКО клиента с сертификатом, подписанным
// нашим CA (панель). Плюс серверный серт агента.
func tlsConfig(certFile, keyFile, caFile string) (*tls.Config, error) {
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, err
	}
	caPEM, err := os.ReadFile(caFile)
	if err != nil {
		return nil, err
	}
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(caPEM)
	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    pool,
		MinVersion:   tls.VersionTLS13,
	}, nil
}
