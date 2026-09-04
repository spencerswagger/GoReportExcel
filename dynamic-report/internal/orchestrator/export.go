package orchestrator

import (
	"os"
	"path/filepath"

	"dynamic-report/internal/model"
	"dynamic-report/internal/pipeline"
	"dynamic-report/internal/render"
)

func (o *Orchestrator) execute(ent *taskEntry) error {
	def, err := model.ParseDefinition(ent.req.DefinitionJSON)
	if err != nil {
		return err
	}
	s, err := pipeline.BuildReport(def, ent.req.DataSource)
	if err != nil {
		return err
	}
	name := ent.req.ArtifactName
	if name == "" {
		name = ent.req.ID + ".xlsx"
	}
	path := filepath.Join(o.artDir, name)
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	if err := render.Render(def, s, f); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	o.mu.Lock()
	ent.status.ArtifactPath = path
	o.mu.Unlock()
	return nil
}
