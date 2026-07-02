package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// Stat — трафик одного клиента (байты) с момента прошлого сброса.
type Stat struct {
	Up   int64 `json:"up"`
	Down int64 `json:"down"`
}

// Stats — трафик по всем клиентам через `xray api statsquery`. reset=true
// обнуляет счётчики (дельта-режим: панель суммирует дельты). Требует в xray-конфиге
// stats:{} + policy statsUserUplink/Downlink (их кладёт панель в buildXrayConfig).
func (x *Xray) Stats(reset bool) (map[string]*Stat, error) {
	args := []string{"api", "statsquery", "--server=" + x.apiAddr, "-pattern", "user>>>"}
	if reset {
		args = append(args, "-reset")
	}
	out, err := exec.Command(x.bin, args...).CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("statsquery: %v (%s)", err, strings.TrimSpace(string(out)))
	}
	var resp struct {
		Stat []struct {
			Name  string `json:"name"`
			Value string `json:"value"`
		} `json:"stat"`
	}
	if json.Unmarshal(out, &resp) != nil {
		return map[string]*Stat{}, nil // пусто/не JSON — считаем «трафика нет»
	}
	res := map[string]*Stat{}
	for _, s := range resp.Stat {
		// name = user>>>EMAIL>>>traffic>>>uplink|downlink
		p := strings.Split(s.Name, ">>>")
		if len(p) < 4 || p[0] != "user" {
			continue
		}
		v, _ := strconv.ParseInt(s.Value, 10, 64)
		st := res[p[1]]
		if st == nil {
			st = &Stat{}
			res[p[1]] = st
		}
		if p[3] == "uplink" {
			st.Up += v
		} else if p[3] == "downlink" {
			st.Down += v
		}
	}
	return res, nil
}

type User struct {
	UUID  string `json:"uuid"`
	Email string `json:"email"`
	Flow  string `json:"flow"`
}

type Xray struct {
	bin     string
	apiAddr string
	cfg     *ConfigManager
}

func NewXray(bin, apiAddr string, cfg *ConfigManager) *Xray {
	return &Xray{bin: bin, apiAddr: apiAddr, cfg: cfg}
}

// liveAdd — добавить юзера в живой xray БЕЗ рестарта (xray api adu). Требует
// структуру inbound из конфига (protocol/streamSettings). Возврат ok, adu-доступен.
func (x *Xray) liveAdd(tag string, u User) (bool, bool) {
	b, err := os.ReadFile(x.cfg.path)
	if err != nil {
		return false, true
	}
	var m map[string]any
	if json.Unmarshal(b, &m) != nil {
		return false, true
	}
	var inbound map[string]any
	arr, _ := m["inbounds"].([]any)
	for _, it := range arr {
		if im, ok := it.(map[string]any); ok && im["tag"] == tag {
			inbound = im
			break
		}
	}
	if inbound == nil {
		return false, true
	}
	cp := map[string]any{}
	for k, v := range inbound {
		cp[k] = v
	}
	client := map[string]any{"id": u.UUID, "email": u.Email}
	if u.Flow != "" {
		client["flow"] = u.Flow
	}
	cp["settings"] = map[string]any{"clients": []any{client}}
	payload, _ := json.Marshal(map[string]any{"inbounds": []any{cp}})
	tmp, _ := os.CreateTemp("", "adu-*.json")
	tmp.Write(payload)
	tmp.Close()
	defer os.Remove(tmp.Name())
	out, _ := exec.Command(x.bin, "api", "adu", "--server="+x.apiAddr, tmp.Name()).CombinedOutput()
	s := string(out)
	if strings.Contains(s, "Added 1") || strings.Contains(s, "Added 0") ||
		strings.Contains(strings.ToLower(s), "already") {
		return true, true
	}
	if strings.Contains(strings.ToLower(s), "unknown command") ||
		strings.Contains(s, "The commands are:") {
		return true, false // adu недоступен в этой версии — конфиг уже верен
	}
	return false, true
}

// liveRemove — удалить юзера из живого xray (xray api rmu).
func (x *Xray) liveRemove(tag, email string) bool {
	out, _ := exec.Command(x.bin, "api", "rmu", "--server="+x.apiAddr,
		"-tag="+tag, "-email="+email).CombinedOutput()
	_ = out
	return true
}

// Reconcile — привести живой xray + конфиг к desired-набору (источник правды =
// панель). Персист в конфиг (restart-safe) + live-применение (без рестарта).
func (x *Xray) Reconcile(desired []User) (added, removed int, aduUnavailable bool, err error) {
	want := map[string]User{}
	for _, u := range desired {
		want[u.Email] = u
	}
	have, err := x.cfg.ConfigEmails()
	if err != nil {
		return 0, 0, false, err
	}
	tags := x.userTags()
	// добавить недостающих
	for email, u := range want {
		if have[email] {
			continue
		}
		if ok, _ := x.cfg.AddClient(u.UUID, u.Email, u.Flow); ok {
			added++
		}
		for _, tag := range tags {
			if _, aduOk := x.liveAdd(tag, u); !aduOk {
				aduUnavailable = true
			}
		}
	}
	// удалить лишних
	for email := range have {
		if _, ok := want[email]; ok {
			continue
		}
		if ok, _ := x.cfg.RemoveClient(email); ok {
			removed++
		}
		for _, tag := range tags {
			x.liveRemove(tag, email)
		}
	}
	return added, removed, aduUnavailable, nil
}

func (x *Xray) userTags() []string {
	b, err := os.ReadFile(x.cfg.path)
	if err != nil {
		return nil
	}
	var m map[string]any
	if json.Unmarshal(b, &m) != nil {
		return nil
	}
	return userInboundTags(m)
}

// Healthy — процесс жив + api-порт слушает.
func (x *Xray) Healthy() bool {
	if !processAlive("xray") {
		return false
	}
	c, err := net.DialTimeout("tcp", x.apiAddr, 2*time.Second)
	if err != nil {
		return false
	}
	c.Close()
	return true
}

func (x *Xray) Restart() error {
	return exec.Command("systemctl", "restart", "xray").Run()
}

// Supervise — рестартит xray при падении с backoff.
func (x *Xray) Supervise() {
	backoff := 5 * time.Second
	for {
		time.Sleep(15 * time.Second)
		if x.Healthy() {
			backoff = 5 * time.Second
			continue
		}
		log.Printf("xray down → restart (backoff %v)", backoff)
		x.Restart()
		time.Sleep(backoff)
		if backoff < 2*time.Minute {
			backoff *= 2
		}
	}
}

func processAlive(name string) bool {
	return exec.Command("pgrep", "-x", name).Run() == nil
}
