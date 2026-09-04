package catalog

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"dynamic-report/internal/model"
)

type Cache struct {
	store *Store
	mu    sync.RWMutex
	items map[string]*cachedDef
	subs  map[int]func(string)
	next  int
	ttl   time.Duration
}

type cachedDef struct {
	version int
	payload string
}

func NewCache(store *Store) *Cache {
	return &Cache{store: store, items: map[string]*cachedDef{}, subs: map[int]func(string){}}
}

func (c *Cache) SetTTL(d time.Duration) { c.ttl = d }

// Subscribe 注册 id 变更通知；返回的取消函数移除订阅。
func (c *Cache) Subscribe(fn func(string)) (cancel func()) {
	c.mu.Lock()
	defer c.mu.Unlock()
	id := c.next
	c.next++
	c.subs[id] = fn
	return func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		delete(c.subs, id)
	}
}

// NotifyChanged 通知所有订阅者（本实例发布时调用；多实例靠 TTL 兜底）。
func (c *Cache) NotifyChanged(id string) {
	c.mu.RLock()
	fns := make([]func(string), 0, len(c.subs))
	for _, fn := range c.subs {
		fns = append(fns, fn)
	}
	c.mu.RUnlock()
	for _, fn := range fns {
		fn(id)
	}
}

// Invalidate 强制失效某定义的缓存。
func (c *Cache) Invalidate(id string) {
	c.mu.Lock()
	delete(c.items, id)
	c.mu.Unlock()
}

// GetPublished 返回最新已发布定义（内存缓存优先，miss 查库）。
func (c *Cache) GetPublished(ctx context.Context, id string) (*model.ReportDefinition, int, error) {
	c.mu.RLock()
	item, ok := c.items[id]
	c.mu.RUnlock()
	if ok {
		def, err := unmarshalDef(item.payload)
		return def, item.version, err
	}
	meta, err := c.store.GetPublished(id)
	if err != nil {
		return nil, 0, err
	}
	if meta == nil {
		return nil, 0, nil
	}
	c.mu.Lock()
	c.items[id] = &cachedDef{version: meta.Version, payload: meta.Payload}
	c.mu.Unlock()
	def, err := unmarshalDef(meta.Payload)
	return def, meta.Version, err
}

// StartTTLRefresh 周期性轮询指定 id 的最大已发布版本，变化即刷新缓存。
// 作为事件通知丢失时的兜底（事件 + 30s TTL 双保险）。
func (c *Cache) StartTTLRefresh(ctx context.Context, interval time.Duration, ids []string) {
	if interval <= 0 {
		interval = 30 * time.Second
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			for _, id := range ids {
				c.refreshOne(id)
			}
		}
	}
}

func (c *Cache) refreshOne(id string) {
	meta, err := c.store.GetPublished(id)
	if err != nil || meta == nil {
		return
	}
	c.mu.Lock()
	cur, ok := c.items[id]
	if !ok || cur.version < meta.Version {
		c.items[id] = &cachedDef{version: meta.Version, payload: meta.Payload}
	}
	c.mu.Unlock()
}

func unmarshalDef(payload string) (*model.ReportDefinition, error) {
	var def model.ReportDefinition
	if err := json.Unmarshal([]byte(payload), &def); err != nil {
		return nil, err
	}
	return &def, nil
}
