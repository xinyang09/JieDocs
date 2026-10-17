package routers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/haierkeys/fast-note-sync-service/internal/ai"
)

type piAIRequest struct {
	Instruction string   `json:"instruction"`
	Content     string   `json:"content"`
	Title       string   `json:"title"`
	Stream      bool     `json:"stream"`
	Thinking    string   `json:"thinking"`
	Skills      []string `json:"skills"`
	Provider    string   `json:"provider"`
	Model       string   `json:"model"`
}

func registerPiAIRoute(r *gin.Engine, guards ...gin.HandlerFunc) {
	group := r.Group("", append(guards, piCompatibilityHeaders())...)
	group.POST("/pi-ai", handlePiAI)
	group.GET("/pi-models", handlePiModels)
	group.GET("/pi-skills", handlePiSkills)
	group.POST("/pi-skills/install", handlePiSkillInstall)
}

func piCompatibilityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Deprecation", "true")
		c.Header("X-AI-Endpoint", "/api/ai/execute")
		c.Next()
	}
}

func handlePiAI(c *gin.Context) {
	// Compatibility endpoints still receive a hard body limit before JSON
	// decoding. The authenticated /api/ai endpoint uses the same bound.
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024*1024)
	var input piAIRequest
	if err := c.ShouldBindJSON(&input); err != nil || strings.TrimSpace(input.Instruction) == "" || len(input.Instruction) > ai.MaxInstruction || len(input.Content) > ai.MaxContext || len(input.Skills) > ai.MaxSkills {
		c.JSON(http.StatusBadRequest, gin.H{"message": "AI 请求无效。"})
		return
	}
	request := ai.PiRequest{
		Instruction: strings.TrimSpace(input.Instruction),
		Content:     input.Content,
		Title:       strings.TrimSpace(input.Title),
		Thinking:    normalizePiThinking(input.Thinking),
		SkillIDs:    append([]string(nil), input.Skills...),
	}
	if input.Provider != "" || input.Model != "" {
		if input.Provider == "" || input.Model == "" {
			c.JSON(http.StatusBadRequest, gin.H{"message": "请选择完整的模型提供商和模型。"})
			return
		}
		request.Model = &ai.ChatModel{Provider: input.Provider, ID: input.Model}
	}
	executor, err := ai.NewPiExecutor(ai.PiConfig{Binary: piExecutable()})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"message": "无法启动 Pi。"})
		return
	}
	wantsStream := input.Stream || strings.Contains(c.GetHeader("Accept"), "text/event-stream")
	if wantsStream {
		streamPiAI(c, executor, request)
		return
	}
	final, err := executor.Execute(c.Request.Context(), request, nil)
	if err != nil {
		writePiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"text": final.Text})
}

func normalizePiThinking(value string) string {
	if value == "high" || value == "on" || value == "true" {
		return "high"
	}
	return ""
}

func streamPiAI(c *gin.Context, executor ai.PiExecutor, request ai.PiRequest) {
	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-cache, no-transform")
	c.Header("X-Accel-Buffering", "no")
	writeEvent := func(payload gin.H) error {
		data, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		if _, err := c.Writer.Write([]byte("data: " + string(data) + "\n\n")); err != nil {
			return err
		}
		c.Writer.Flush()
		return nil
	}
	snapshot := ""
	final, err := executor.Execute(c.Request.Context(), request, func(event ai.PiEvent) error {
		if event.Type == "delta" && event.Text != "" {
			// The legacy client replaces its draft on each `chunk`; translate the
			// executor's deltas back into the old cumulative snapshot contract.
			snapshot += event.Text
			return writeEvent(gin.H{"type": "chunk", "text": snapshot})
		}
		return nil
	})
	if err != nil {
		_ = writeEvent(gin.H{"type": "error", "message": piErrorMessage(err)})
		return
	}
	_ = writeEvent(gin.H{"type": "done", "text": final.Text})
}

func writePiError(c *gin.Context, err error) {
	status := http.StatusBadGateway
	if errors.Is(err, ai.ErrInvalidSkill) || errors.Is(err, ai.ErrInvalidModel) || errors.Is(err, ai.ErrPiRequest) {
		status = http.StatusBadRequest
	} else if errors.Is(err, ai.ErrPiUnavailable) {
		status = http.StatusNotFound
	} else if errors.Is(err, ai.ErrPiTimeout) {
		status = http.StatusGatewayTimeout
	}
	c.JSON(status, gin.H{"message": piErrorMessage(err)})
}

func piErrorMessage(err error) string {
	switch {
	case errors.Is(err, ai.ErrPiUnavailable):
		return "未检测到 Pi。请先安装 Pi 并确保 pi 命令在 PATH 中。"
	case errors.Is(err, ai.ErrInvalidSkill):
		return "所选技能不可用，请刷新技能列表后重试。"
	case errors.Is(err, ai.ErrInvalidModel):
		return "所选模型不可用，请刷新模型列表后重试。"
	case errors.Is(err, ai.ErrPiTimeout):
		return "Pi 请求超时。"
	case errors.Is(err, ai.ErrPiOutputLimit):
		return "Pi 输出超过大小限制。"
	case errors.Is(err, ai.ErrPiRequest):
		return "AI 请求无效。"
	default:
		return "Pi 请求失败。"
	}
}

// piAIText is retained for package-level compatibility with older tests and
// integrations; all process parsing now lives in internal/ai.
func piAIText(raw []byte) string { return ai.ExtractPiText(raw) }
