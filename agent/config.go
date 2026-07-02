package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
)

// ConfigManager — потокобезопасное управление xray-конфигом: атомарная запись,
// хеш структуры (рестарт только при её изменении), last-good бэкап + rollback,
// add/remove юзера по ВСЕМ user-inbound (фикс «воскрешения»).
type ConfigManager struct {
	path string
	mu   sync.Mutex
}

func NewConfigManager(path string) *ConfigManager { return &ConfigManager{path: path} }

func (c *ConfigManager) load() (map[string]any, error) {
	b, err := os.ReadFile(c.path)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	return m, nil
}

// atomicWrite: temp → fsync → rename (нельзя получить битый конфиг).
func (c *ConfigManager) atomicWrite(m map[string]any) error {
	b, err := json.MarshalIndent(m, "", " ")
	if err != nil {
		return err
	}
	tmp := c.path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	if _, err := f.Write(b); err != nil {
		f.Close()
		return err
	}
	f.Sync()
	f.Close()
	return os.Rename(tmp, c.path)
}

// structuralHash — хеш inbounds/outbounds/routing БЕЗ clients (чтобы рестартить
// xray только при смене структуры, а не при каждом юзере).
func structuralHash(m map[string]any) string {
	clone := map[string]any{
		"inbounds":  stripClients(m["inbounds"]),
		"outbounds": m["outbounds"],
		"routing":   m["routing"],
	}
	b, _ := json.Marshal(clone)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func stripClients(inb any) any {
	arr, ok := inb.([]any)
	if !ok {
		return inb
	}
	out := make([]any, 0, len(arr))
	for _, it := range arr {
		im, ok := it.(map[string]any)
		if !ok {
			out = append(out, it)
			continue
		}
		cp := map[string]any{}
		for k, v := range im {
			if k == "settings" {
				if sm, ok := v.(map[string]any); ok {
					scp := map[string]any{}
					for sk, sv := range sm {
						if sk != "clients" {
							scp[sk] = sv
						}
					}
					cp[k] = scp
					continue
				}
			}
			cp[k] = v
		}
		out = append(out, cp)
	}
	return out
}

// userInboundTags — теги ВСЕХ vless/vmess-inbound (кроме api).
func userInboundTags(m map[string]any) []string {
	var tags []string
	arr, _ := m["inbounds"].([]any)
	for _, it := range arr {
		im, _ := it.(map[string]any)
		proto, _ := im["protocol"].(string)
		tag, _ := im["tag"].(string)
		if (proto == "vless" || proto == "vmess") && tag != "" && tag != "api" {
			tags = append(tags, tag)
		}
	}
	return tags
}

// validate — xray -test на ВРЕМЕННОМ файле (не трогая живой).
func validate(bin, cfgJSON string) error {
	tmp, err := os.CreateTemp("", "xtest-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	tmp.WriteString(cfgJSON)
	tmp.Close()
	out, err := exec.Command(bin, "-test", "-config", tmp.Name()).CombinedOutput()
	if err != nil {
		return fmt.Errorf("xray -test: %s", string(out))
	}
	return nil
}

func (c *ConfigManager) backupPath() string {
	return filepath.Join(filepath.Dir(c.path), "config.lastgood.json")
}
