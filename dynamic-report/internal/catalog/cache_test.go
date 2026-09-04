package catalog

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestCacheGetAndInvalidate(t *testing.T) {
	s := openTest(t)
	_ = s.SaveDraft("r1", validPayload("r1", 1), "a")
	_ = s.Publish("r1", "a")
	c := NewCache(s)

	def, version, err := c.GetPublished(context.Background(), "r1")
	if err != nil || def == nil {
		t.Fatalf("cached def = %v err = %v", def, err)
	}
	if version != 2 || def.ID != "r1" {
		t.Fatalf("version=%d id=%s", version, def.ID)
	}
	// 直接改库模拟外部发布，缓存未失效前仍返回旧值
	_ = s.SaveDraft("r1", validPayload("r1", 9), "b")
	_ = s.Publish("r1", "b") // 新 published v3
	def2, v2, _ := c.GetPublished(context.Background(), "r1")
	if v2 != 2 {
		t.Fatalf("cache should still serve v2, got v%d", v2)
	}
	// 失效后重新加载
	c.Invalidate("r1")
	def3, v3, _ := c.GetPublished(context.Background(), "r1")
	if v3 != 3 || def3 == def2 {
		t.Fatalf("after invalidate: v%d", v3)
	}
}

func TestCacheNotifySubscribers(t *testing.T) {
	s := openTest(t)
	c := NewCache(s)
	got := make(chan string, 2)
	c.Subscribe(func(id string) { got <- id })

	c.NotifyChanged("r1")
	select {
	case id := <-got:
		if id != "r1" {
			t.Fatalf("notify id = %s", id)
		}
	case <-time.After(time.Second):
		t.Fatal("subscriber not notified")
	}
}

func TestCacheTTLRefresh(t *testing.T) {
	s := openTest(t)
	_ = s.SaveDraft("r1", validPayload("r1", 1), "a")
	_ = s.Publish("r1", "a")
	c := NewCache(s)
	c.SetTTL(30 * time.Millisecond)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go c.StartTTLRefresh(ctx, 10*time.Millisecond, []string{"r1"})

	// 外部发布 v3
	_ = s.SaveDraft("r1", validPayload("r1", 9), "b")
	_ = s.Publish("r1", "b")

	// TTL 轮询应最终刷新到 v3（多实例兜底）
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		_, v, _ := c.GetPublished(context.Background(), "r1")
		if v == 3 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("TTL refresh did not pick up v3 within 2s")
}

func TestCacheConcurrentSafe(t *testing.T) {
	s := openTest(t)
	_ = s.SaveDraft("r1", validPayload("r1", 1), "a")
	_ = s.Publish("r1", "a")
	c := NewCache(s)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, _, err := c.GetPublished(context.Background(), "r1"); err != nil {
				t.Error(err)
			}
			c.Invalidate("r1")
		}()
	}
	wg.Wait()
}
