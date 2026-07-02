package main

// AddClient добавляет клиента во ВСЕ user-inbound конфига (идемпотентно) и
// атомарно сохраняет. Возвращает true если конфиг менялся.
func (c *ConfigManager) AddClient(uuid, email, flow string) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	m, err := c.load()
	if err != nil {
		return false, err
	}
	changed := false
	arr, _ := m["inbounds"].([]any)
	for _, it := range arr {
		im, _ := it.(map[string]any)
		proto, _ := im["protocol"].(string)
		tag, _ := im["tag"].(string)
		if (proto != "vless" && proto != "vmess") || tag == "" || tag == "api" {
			continue
		}
		settings, _ := im["settings"].(map[string]any)
		if settings == nil {
			settings = map[string]any{}
			im["settings"] = settings
		}
		clients, _ := settings["clients"].([]any)
		exists := false
		for _, cl := range clients {
			if cm, ok := cl.(map[string]any); ok {
				if cm["email"] == email || cm["id"] == uuid {
					exists = true
					break
				}
			}
		}
		if exists {
			continue
		}
		nc := map[string]any{"id": uuid, "email": email}
		if flow != "" {
			nc["flow"] = flow
		}
		settings["clients"] = append(clients, nc)
		changed = true
	}
	if changed {
		if err := c.atomicWrite(m); err != nil {
			return false, err
		}
	}
	return changed, nil
}

// RemoveClient удаляет клиента (по email) из ВСЕХ user-inbound + persist.
func (c *ConfigManager) RemoveClient(email string) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	m, err := c.load()
	if err != nil {
		return false, err
	}
	changed := false
	arr, _ := m["inbounds"].([]any)
	for _, it := range arr {
		im, _ := it.(map[string]any)
		settings, _ := im["settings"].(map[string]any)
		if settings == nil {
			continue
		}
		clients, _ := settings["clients"].([]any)
		kept := make([]any, 0, len(clients))
		for _, cl := range clients {
			if cm, ok := cl.(map[string]any); ok && cm["email"] == email {
				changed = true
				continue
			}
			kept = append(kept, cl)
		}
		settings["clients"] = kept
	}
	if changed {
		if err := c.atomicWrite(m); err != nil {
			return false, err
		}
	}
	return changed, nil
}

// ConfigEmails — множество email во ВСЕХ user-inbound (для reconcile-диффа).
func (c *ConfigManager) ConfigEmails() (map[string]bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	m, err := c.load()
	if err != nil {
		return nil, err
	}
	out := map[string]bool{}
	arr, _ := m["inbounds"].([]any)
	for _, it := range arr {
		im, _ := it.(map[string]any)
		settings, _ := im["settings"].(map[string]any)
		if settings == nil {
			continue
		}
		clients, _ := settings["clients"].([]any)
		for _, cl := range clients {
			if cm, ok := cl.(map[string]any); ok {
				if e, ok := cm["email"].(string); ok && e != "" {
					out[e] = true
				}
			}
		}
	}
	return out, nil
}
