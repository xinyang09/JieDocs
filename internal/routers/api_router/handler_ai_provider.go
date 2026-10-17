package api_router

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/haierkeys/fast-note-sync-service/internal/ai"
	"github.com/haierkeys/fast-note-sync-service/internal/app"
	pkgapp "github.com/haierkeys/fast-note-sync-service/pkg/app"
)

type AIProviderHandler struct{ *Handler }

func NewAIProviderHandler(a *app.App) *AIProviderHandler {
	return &AIProviderHandler{Handler: NewHandler(a)}
}

func (h *AIProviderHandler) store(c *gin.Context) (*ai.ProviderStore, bool) {
	if h.App == nil || h.App.Services == nil || h.App.AIProviderStore == nil {
		h.aiProviderError(c, http.StatusServiceUnavailable, errors.New("AI provider service is not configured"))
		return nil, false
	}
	if pkgapp.GetUID(c) == 0 {
		h.aiProviderError(c, http.StatusUnauthorized, errors.New("authentication required"))
		return nil, false
	}
	return h.App.AIProviderStore, true
}

func (h *AIProviderHandler) List(c *gin.Context) {
	store, ok := h.store(c)
	if !ok {
		return
	}
	providers, err := store.List(c.Request.Context(), pkgapp.GetUID(c))
	if err != nil {
		h.aiProviderError(c, aiProviderHTTPStatus(err), err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"providers": providers})
}

func (h *AIProviderHandler) Create(c *gin.Context) {
	store, ok := h.store(c)
	if !ok {
		return
	}
	input, err := decodeAIProviderInput(c)
	if err != nil {
		h.aiProviderError(c, http.StatusBadRequest, err)
		return
	}
	if strings.TrimSpace(input.ID) == "" {
		input.ID = "provider-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:24]
	}
	provider, err := store.Create(c.Request.Context(), pkgapp.GetUID(c), input)
	if err != nil {
		h.aiProviderError(c, aiProviderHTTPStatus(err), err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"provider": provider})
}

func (h *AIProviderHandler) Update(c *gin.Context) {
	store, ok := h.store(c)
	if !ok {
		return
	}
	input, err := decodeAIProviderInput(c)
	if err != nil {
		h.aiProviderError(c, http.StatusBadRequest, err)
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	provider, err := store.Update(c.Request.Context(), pkgapp.GetUID(c), id, input)
	if err != nil {
		h.aiProviderError(c, aiProviderHTTPStatus(err), err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"provider": provider})
}

func (h *AIProviderHandler) Delete(c *gin.Context) {
	store, ok := h.store(c)
	if !ok {
		return
	}
	version, err := strconv.Atoi(strings.TrimSpace(c.Query("version")))
	if err != nil || version <= 0 {
		h.aiProviderError(c, http.StatusBadRequest, ai.ErrProviderConflict)
		return
	}
	if err := store.Delete(c.Request.Context(), pkgapp.GetUID(c), strings.TrimSpace(c.Param("id")), version); err != nil {
		h.aiProviderError(c, aiProviderHTTPStatus(err), err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (h *AIProviderHandler) Test(c *gin.Context) {
	store, ok := h.store(c)
	if !ok {
		return
	}
	config, err := store.Resolve(c.Request.Context(), pkgapp.GetUID(c), strings.TrimSpace(c.Param("id")))
	if err != nil {
		h.aiProviderError(c, aiProviderHTTPStatus(err), err)
		return
	}
	executor, err := ai.NewOpenAIExecutor(config)
	if err != nil {
		h.aiProviderError(c, aiProviderHTTPStatus(err), err)
		return
	}
	ctx, cancel := contextWithProviderTestTimeout(c)
	defer cancel()
	started := time.Now()
	_, err = executor.Execute(ctx, ai.PiRequest{Instruction: "Reply with exactly OK.", Model: &ai.ChatModel{Provider: "custom:" + config.ID, ID: config.DefaultModel}}, nil)
	if err != nil {
		h.aiProviderError(c, aiProviderHTTPStatus(err), err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"ok": true, "latencyMs": time.Since(started).Milliseconds(), "models": []ai.ChatModel{{Provider: "custom:" + config.ID, ID: config.DefaultModel, DisplayName: config.DefaultModel, ProviderName: config.Name}}})
}

func (h *AIProviderHandler) Models(c *gin.Context) {
	store, ok := h.store(c)
	if !ok {
		return
	}
	models, err := discoverProviderModels(c.Request.Context(), store, pkgapp.GetUID(c), strings.TrimSpace(c.Param("id")))
	if err != nil {
		h.aiProviderError(c, aiProviderHTTPStatus(err), err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"models": models})
}

func discoverProviderModels(ctx context.Context, store *ai.ProviderStore, uid int64, id string) ([]ai.ChatModel, error) {
	config, err := store.Resolve(ctx, uid, id)
	if err != nil {
		return nil, err
	}
	executor, err := ai.NewOpenAIExecutor(config)
	if err != nil {
		return nil, err
	}
	return executor.ListModels(ctx)
}

func decodeAIProviderInput(c *gin.Context) (ai.ProviderInput, error) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64*1024)
	var input ai.ProviderInput
	decoder := json.NewDecoder(c.Request.Body)
	if err := decoder.Decode(&input); err != nil && !errors.Is(err, io.EOF) {
		return ai.ProviderInput{}, err
	}
	return input, nil
}

func contextWithProviderTestTimeout(c *gin.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(c.Request.Context(), 30*time.Second)
}

func (h *AIProviderHandler) aiProviderError(c *gin.Context, status int, err error) {
	c.Header("Cache-Control", "no-store")
	c.JSON(status, gin.H{"error": gin.H{"code": ai.AuditErrorCode(err), "message": aiErrorMessage(err), "retryable": status >= 500}})
}

func aiProviderHTTPStatus(err error) int {
	switch {
	case errors.Is(err, ai.ErrProviderInvalid), errors.Is(err, ai.ErrProviderKey), errors.Is(err, ai.ErrOpenAIRequest):
		return http.StatusBadRequest
	case errors.Is(err, ai.ErrProviderNotFound):
		return http.StatusNotFound
	case errors.Is(err, ai.ErrProviderExists), errors.Is(err, ai.ErrProviderConflict):
		return http.StatusConflict
	case errors.Is(err, ai.ErrProviderDisabled):
		return http.StatusUnprocessableEntity
	case errors.Is(err, ai.ErrOpenAITimeout):
		return http.StatusGatewayTimeout
	case errors.Is(err, ai.ErrOpenAIUnavailable), errors.Is(err, ai.ErrOpenAIProtocol), errors.Is(err, ai.ErrOpenAIResponseLimit), errors.Is(err, ai.ErrOpenAIRedirect):
		return http.StatusBadGateway
	default:
		return http.StatusBadGateway
	}
}
