package main

import (
	"log"
	"net/http"
	"os"
)

const Version = "0.1.0"

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	cfgPath := env("XRAY_CONFIG", "/usr/local/etc/xray/config.json")
	xbin := env("XRAY_BIN", "/usr/local/bin/xray")
	xapi := env("XRAY_API", "127.0.0.1:10085")
	listen := env("AGENT_LISTEN", ":8443")
	certF := env("AGENT_CERT", "/etc/vpanel/agent.crt")
	keyF := env("AGENT_KEY", "/etc/vpanel/agent.key")
	caF := env("AGENT_CA", "/etc/vpanel/ca.crt")
	jwtSecret := os.Getenv("AGENT_JWT_SECRET")
	if jwtSecret == "" {
		log.Fatal("AGENT_JWT_SECRET required")
	}

	cm := NewConfigManager(cfgPath)
	xray := NewXray(xbin, xapi, cm)
	go xray.Supervise() // авто-рестарт xray при падении

	srv := &Server{x: xray, jwtSecret: []byte(jwtSecret)}
	tlsc, err := tlsConfig(certF, keyF, caF)
	if err != nil {
		log.Fatalf("mTLS config: %v", err)
	}
	httpSrv := &http.Server{Addr: listen, Handler: srv.routes(), TLSConfig: tlsc}
	log.Printf("vpanel-agent %s listening %s (mTLS)", Version, listen)
	log.Fatal(httpSrv.ListenAndServeTLS("", ""))
}
