package routers

import (
	"context"
	"errors"
	"net/http"
	"os"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/haierkeys/fast-note-sync-service/internal/ai"
)

type piModel struct {
	Provider string `json:"provider"`
	ID       string `json:"id"`
}

var piANSI = regexp.MustCompile(`\x1b\[[0-9;]*m`)

func piExecutable() string {
	if binary := os.Getenv("PI_BIN"); binary != "" {
		return binary
	}
	return "pi"
}

func parsePiModels(output string) []piModel {
	models := make([]piModel, 0)
	seen := make(map[piModel]bool)
	for _, line := range strings.Split(piANSI.ReplaceAllString(output, ""), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 6 || (fields[4] != "yes" && fields[4] != "no") || (fields[5] != "yes" && fields[5] != "no") {
			continue
		}
		model := piModel{Provider: fields[0], ID: fields[1]}
		if !seen[model] {
			models = append(models, model)
			seen[model] = true
		}
	}
	return models
}

func availablePiModels(parent context.Context) ([]piModel, error) {
	executor, err := ai.NewPiExecutor(ai.PiConfig{Binary: piExecutable()})
	if err != nil {
		return nil, errors.New("无法读取 Pi 模型列表，请检查 PI_BIN 和 Pi 的模型提供商配置。")
	}
	models, err := executor.ListModels(parent)
	if err != nil {
		return nil, errors.New("无法读取 Pi 模型列表，请检查 PI_BIN 和 Pi 的模型提供商配置。")
	}
	result := make([]piModel, 0, len(models))
	for _, model := range models {
		result = append(result, piModel{Provider: model.Provider, ID: model.ID})
	}
	return result, nil
}

func piSelectionArgs(ctx context.Context, provider, modelID string) ([]string, error) {
	if provider == "" && modelID == "" {
		return nil, nil
	}
	if provider == "" || modelID == "" || len(provider) > 200 || len(modelID) > 300 || strings.HasPrefix(provider, "-") || strings.HasPrefix(modelID, "-") {
		return nil, errors.New("请选择完整的模型提供商和模型。")
	}
	models, err := availablePiModels(ctx)
	if err != nil {
		return nil, err
	}
	for _, model := range models {
		if model.Provider == provider && model.ID == modelID {
			return []string{"--provider", provider, "--model", modelID}, nil
		}
	}
	return nil, errors.New("所选模型不可用，请刷新模型列表后重新选择。")
}

func handlePiModels(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	models, err := availablePiModels(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"models": models})
}
