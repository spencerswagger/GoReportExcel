package orchestrator

import (
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"dynamic-report/internal/datahub"
)

type State string

const (
	StateQueued  State = "queued"
	StateRunning State = "running"
	StateDone    State = "done"
	StateFailed  State = "failed"
)

type TaskStatus struct {
	ID           string    `json:"id"`
	State        State     `json:"state"`
	Progress     float64   `json:"progress"` // 0..1
	Error        string    `json:"error,omitempty"`
	ArtifactPath string    `json:"artifact_path,omitempty"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// ArtifactPathName 返回产物文件名（下载时 Content-Disposition 用）。
func (t TaskStatus) ArtifactPathName() string { return filepath.Base(t.ArtifactPath) }

type ExportRequest struct {
	ID             string // 任务 ID（空则自动生成 task-N）
	IdempotencyKey string // 幂等键：重复提交返回已存在任务
	DefinitionJSON string // 定义 JSON（catalog 版本场景由调用方解析定义后传入）
	DataSource     datahub.Source
	ArtifactName   string // 产物文件名（默认 <id>.xlsx）
}

// ProgressSink 接收任务进度事件（可接入日志/SSE）。
type ProgressSink interface {
	OnProgress(taskID string, state State, progress float64)
}

type taskEntry struct {
	req    ExportRequest
	status TaskStatus
	acked  chan struct{}
}

type Orchestrator struct {
	mu          sync.Mutex
	tasks       map[string]*taskEntry
	queue       chan *taskEntry
	concurrency int
	artDir      string
	sink        ProgressSink
	nextID      atomic.Int64
	probe       func() // 测试钩子：worker 开始执行时调用
	probeEnd    func() // 测试钩子：worker 结束执行时调用
	started     bool
}

func NewOrchestrator(sink ProgressSink) *Orchestrator {
	o := &Orchestrator{
		tasks:       map[string]*taskEntry{},
		queue:       make(chan *taskEntry, 64),
		concurrency: 2,
		sink:        sink,
	}
	return o
}

func (o *Orchestrator) SetConcurrency(n int) {
	if n > 0 {
		o.concurrency = n
	}
}

func (o *Orchestrator) SetArtifactDir(dir string) { o.artDir = dir }

func (o *Orchestrator) SetProbe(fn func()) { o.probe = fn }

// SetProbeEnd 注册任务结束钩子（与 SetProbe 配对，用于测量并发活跃数）。
func (o *Orchestrator) SetProbeEnd(fn func()) { o.probeEnd = fn }

// Start 启动 workers（幂等）。
func (o *Orchestrator) Start() {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.started {
		return
	}
	o.started = true
	for i := 0; i < o.concurrency; i++ {
		go o.worker()
	}
}

// ErrDuplicate 幂等键重复时返回。
var ErrDuplicate = errors.New("duplicate idempotency key")

// Submit 入队任务；IdempotencyKey 重复时返回 ErrDuplicate。
func (o *Orchestrator) Submit(req ExportRequest) (string, error) {
	if req.IdempotencyKey != "" {
		o.mu.Lock()
		for _, t := range o.tasks {
			if t.req.IdempotencyKey == req.IdempotencyKey {
				o.mu.Unlock()
				return t.req.ID, ErrDuplicate
			}
		}
		o.mu.Unlock()
	}
	if req.ID == "" {
		req.ID = fmt.Sprintf("task-%d", o.nextID.Add(1))
	}
	ent := &taskEntry{
		req:    req,
		status: TaskStatus{ID: req.ID, State: StateQueued, UpdatedAt: time.Now()},
		acked:  make(chan struct{}),
	}
	o.mu.Lock()
	o.tasks[req.ID] = ent
	o.mu.Unlock()
	o.queue <- ent
	o.Start()
	return req.ID, nil
}

// Status 查询任务状态。
func (o *Orchestrator) Status(id string) (TaskStatus, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	t, ok := o.tasks[id]
	if !ok {
		return TaskStatus{}, fmt.Errorf("task %s not found", id)
	}
	return t.status, nil
}

// Wait 阻塞直到任务完成或失败（供测试与同步路径）。
func (o *Orchestrator) Wait(id string) TaskStatus {
	o.mu.Lock()
	ent := o.tasks[id]
	o.mu.Unlock()
	if ent == nil {
		t, _ := o.Status(id)
		return t
	}
	<-ent.acked
	o.mu.Lock()
	defer o.mu.Unlock()
	return ent.status
}

func (o *Orchestrator) worker() {
	for ent := range o.queue {
		o.setStatus(ent.req.ID, StateRunning, 0.1)
		if o.probe != nil {
			o.probe()
		}
		err := o.execute(ent)
		if err != nil {
			o.setStatus(ent.req.ID, StateFailed, 1.0)
			o.mu.Lock()
			ent.status.Error = err.Error()
			o.mu.Unlock()
		} else {
			o.setStatus(ent.req.ID, StateDone, 1.0)
		}
		if o.probeEnd != nil {
			o.probeEnd()
		}
		close(ent.acked)
	}
}

func (o *Orchestrator) setStatus(id string, s State, p float64) {
	o.mu.Lock()
	if t, ok := o.tasks[id]; ok {
		t.status.State = s
		t.status.Progress = p
		t.status.UpdatedAt = time.Now()
	}
	o.mu.Unlock()
	if o.sink != nil {
		o.sink.OnProgress(id, s, p)
	}
}
