package api_router

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/haierkeys/fast-note-sync-service/internal/ai"
	"github.com/haierkeys/fast-note-sync-service/internal/app"
	pkgapp "github.com/haierkeys/fast-note-sync-service/pkg/app"
	"github.com/haierkeys/fast-note-sync-service/pkg/util"
)

type AIHandler struct{ *Handler }

func NewAIHandler(a *app.App) *AIHandler { return &AIHandler{Handler: NewHandler(a)} }

func (h *AIHandler) Models(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	uid := pkgapp.GetUID(c)
	if uid == 0 {
		h.aiError(c, http.StatusUnauthorized, errors.New("authentication required"))
		return
	}
	models := make([]ai.ChatModel, 0)
	if h.App != nil && h.App.Services != nil && h.App.AIProviderStore != nil {
		profiles, err := h.App.AIProviderStore.List(c.Request.Context(), uid)
		if err != nil {
			h.aiError(c, http.StatusServiceUnavailable, err)
			return
		}
		enabled := make([]ai.ProviderProfile, 0, len(profiles))
		for _, profile := range profiles {
			if profile.Enabled {
				enabled = append(enabled, profile)
			}
		}
		if len(enabled) > 0 {
			ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
			defer cancel()
			type catalogResult struct {
				models []ai.ChatModel
				err    error
			}
			results := make([]catalogResult, len(enabled))
			var pending sync.WaitGroup
			slots := make(chan struct{}, 4)
			for i, profile := range enabled {
				pending.Add(1)
				go func() {
					defer pending.Done()
					select {
					case slots <- struct{}{}:
						defer func() { <-slots }()
					case <-ctx.Done():
						results[i].err = ai.ErrOpenAITimeout
						return
					}
					results[i].models, results[i].err = discoverProviderModels(ctx, h.App.AIProviderStore, uid, profile.ID)
				}()
			}
			pending.Wait()
			warnings := make([]gin.H, 0)
			var firstError error
			succeeded := false
			for i, result := range results {
				if result.err == nil {
					succeeded = true
					models = append(models, result.models...)
					continue
				}
				if firstError == nil {
					firstError = result.err
				}
				warnings = append(warnings, gin.H{"provider": "custom:" + enabled[i].ID, "providerName": enabled[i].Name, "code": ai.AuditErrorCode(result.err), "message": aiErrorMessage(result.err), "retryable": aiErrorRetryable(result.err)})
			}
			if !succeeded {
				h.aiError(c, aiHTTPStatus(firstError), firstError)
				return
			}
			// A configured custom service owns its catalog. Pi is only the
			// compatibility fallback when no custom service is enabled.
			c.JSON(http.StatusOK, gin.H{"models": models, "warnings": warnings})
			return
		}
	}
	piExecutor, piErr := ai.NewPiExecutor(ai.PiConfig{})
	if piErr == nil {
		if piModels, err := piExecutor.ListModels(c.Request.Context()); err == nil {
			for _, model := range piModels {
				models = append(models, ai.ChatModel{Provider: model.Provider, ID: model.ID})
			}
		} else if len(models) == 0 {
			h.aiError(c, http.StatusServiceUnavailable, err)
			return
		}
	} else if len(models) == 0 {
		h.aiError(c, http.StatusServiceUnavailable, piErr)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"models": models})
}

func (h *AIHandler) Skills(c *gin.Context) {
	executor, err := ai.NewPiExecutor(ai.PiConfig{})
	if err != nil {
		h.aiError(c, http.StatusServiceUnavailable, err)
		return
	}
	registry, err := executor.Skills()
	if err != nil {
		h.aiError(c, http.StatusServiceUnavailable, err)
		return
	}
	skills, err := registry.List()
	if err != nil {
		h.aiError(c, http.StatusServiceUnavailable, err)
		return
	}
	// PiSkill deliberately omits Path and Content from JSON; only stable IDs
	// and human-readable metadata cross the API boundary.
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"skills": skills})
}

func (h *AIHandler) Execute(c *gin.Context) {
	if h.App == nil || h.App.Services == nil || h.App.AIService == nil {
		h.aiError(c, http.StatusServiceUnavailable, errors.New("AI service is not configured"))
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2*1024*1024)
	var request ai.ExecuteRequest
	decoder := json.NewDecoder(c.Request.Body)
	if err := decoder.Decode(&request); err != nil && !errors.Is(err, io.EOF) {
		h.aiError(c, http.StatusBadRequest, err)
		return
	}
	if err := ai.ValidateExecuteRequest(request); err != nil {
		h.aiError(c, http.StatusBadRequest, err)
		return
	}
	uid := pkgapp.GetUID(c)
	if uid == 0 {
		h.aiError(c, http.StatusUnauthorized, errors.New("authentication required"))
		return
	}
	if request.Context != nil && c.GetString("vaults") != "" && !util.VerifyVaultAccess(c.GetString("vaults"), request.Context.Vault) {
		h.aiError(c, http.StatusForbidden, ai.ErrPermissionDenied)
		return
	}
	wantsStream := request.Options != nil && request.Options.Stream || strings.Contains(strings.ToLower(c.GetHeader("Accept")), "text/event-stream")
	if !wantsStream {
		result, err := h.App.AIService.Execute(c.Request.Context(), uid, request, nil)
		if err != nil {
			h.aiErrorResult(c, err, result)
			return
		}
		c.JSON(http.StatusOK, result)
		return
	}
	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-cache, no-transform")
	c.Header("X-Accel-Buffering", "no")
	sequence := 0
	terminalEmitted := false
	emit := func(event ai.AIStreamEvent) error {
		mapped := mapAIEvent(event)
		eventSequence := sequence
		mapped.Sequence = &eventSequence
		if err := writeAIEvent(c, mapped); err != nil {
			return err
		}
		sequence++
		if mapped.Type == "error" || mapped.Type == "done" {
			terminalEmitted = true
		}
		return nil
	}
	result, err := h.App.AIService.Execute(c.Request.Context(), uid, request, emit)
	if err != nil {
		// Store/proposal failures may happen after meta and deltas. They must
		// still terminate with an error instead of an unexplained stream EOF.
		if !terminalEmitted {
			_ = emit(ai.AIStreamEvent{Type: "error", RequestID: result.RequestID, Code: ai.AuditErrorCode(err), Message: aiErrorMessage(err), Retryable: aiErrorRetryable(err)})
		}
		return
	}
	if !terminalEmitted {
		_ = emit(ai.AIStreamEvent{Type: "done", RequestID: result.RequestID, Result: &result, Usage: result.Usage})
	}
}

func (h *AIHandler) CancelRun(c *gin.Context) {
	if h.App == nil || h.App.Services == nil || h.App.AIService == nil {
		h.aiError(c, http.StatusServiceUnavailable, errors.New("AI service is not configured"))
		return
	}
	if uid := pkgapp.GetUID(c); uid == 0 {
		h.aiError(c, http.StatusUnauthorized, errors.New("authentication required"))
		return
	} else if err := h.App.AIService.CancelRun(c.Request.Context(), uid, strings.TrimSpace(c.Param("id"))); err != nil {
		h.aiErrorResult(c, err, ai.AIResult{})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "cancelled"})
}

func (h *AIHandler) CommitProposal(c *gin.Context) {
	if h.App == nil || h.App.Services == nil || h.App.AIService == nil {
		h.aiError(c, http.StatusServiceUnavailable, errors.New("AI service is not configured"))
		return
	}
	uid := pkgapp.GetUID(c)
	if uid == 0 {
		h.aiError(c, http.StatusUnauthorized, errors.New("authentication required"))
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512*1024)
	var request ai.ProposalCommitRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		h.aiError(c, http.StatusBadRequest, err)
		return
	}
	if request.IdempotencyKey == "" {
		request.IdempotencyKey = strings.TrimSpace(c.GetHeader("Idempotency-Key"))
	}
	if err := ai.ValidateProposalCommit(request); err != nil {
		h.aiError(c, http.StatusBadRequest, err)
		return
	}
	for _, target := range request.Targets {
		if c.GetString("vaults") != "" && !util.VerifyVaultAccess(c.GetString("vaults"), target.Vault) {
			h.aiError(c, http.StatusForbidden, ai.ErrPermissionDenied)
			return
		}
	}
	result, err := h.App.AIService.CommitProposal(c.Request.Context(), uid, c.Param("id"), request)
	if err != nil {
		h.aiErrorResult(c, err, ai.AIResult{})
		return
	}
	c.JSON(http.StatusOK, gin.H{"proposalId": c.Param("id"), "status": "committed", "result": result})
}

func (h *AIHandler) DiscardProposal(c *gin.Context) {
	if h.App == nil || h.App.Services == nil || h.App.AIService == nil {
		h.aiError(c, http.StatusServiceUnavailable, errors.New("AI service is not configured"))
		return
	}
	uid := pkgapp.GetUID(c)
	if uid == 0 {
		h.aiError(c, http.StatusUnauthorized, errors.New("authentication required"))
		return
	}
	if err := h.App.AIService.DiscardProposal(c.Request.Context(), uid, c.Param("id")); err != nil {
		h.aiErrorResult(c, err, ai.AIResult{})
		return
	}
	c.JSON(http.StatusOK, gin.H{"proposalId": c.Param("id"), "status": "discarded"})
}

func (h *AIHandler) UndoProposal(c *gin.Context) {
	if h.App == nil || h.App.Services == nil || h.App.AIService == nil {
		h.aiError(c, http.StatusServiceUnavailable, errors.New("AI service is not configured"))
		return
	}
	uid := pkgapp.GetUID(c)
	if uid == 0 {
		h.aiError(c, http.StatusUnauthorized, errors.New("authentication required"))
		return
	}
	result, err := h.App.AIService.UndoProposal(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		h.aiErrorResult(c, err, ai.AIResult{})
		return
	}
	c.JSON(http.StatusOK, gin.H{"proposalId": c.Param("id"), "status": "undone", "result": result})
}

func writeAIEvent(c *gin.Context, event ai.AIStreamEvent) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}
	if _, err := c.Writer.Write([]byte("data: " + string(payload) + "\n\n")); err != nil {
		return err
	}
	c.Writer.Flush()
	return nil
}

func mapAIEvent(event ai.AIStreamEvent) ai.AIStreamEvent {
	switch event.Type {
	case "started":
		return ai.AIStreamEvent{Type: "meta", ID: event.ID, RequestID: event.RequestID, Tools: []string{}}
	case "completed":
		result := event.Result
		if result != nil {
			if result.Status == "completed" {
				if result.Proposal != nil {
					result.Status = "proposal"
				} else {
					result.Status = "answer"
				}
			}
		}
		return ai.AIStreamEvent{Type: "done", ID: event.ID, RequestID: event.RequestID, Result: result, Usage: event.Usage}
	case "error":
		return ai.AIStreamEvent{Type: "error", ID: event.ID, RequestID: event.RequestID, Code: event.Code, Message: event.Message, Retryable: event.Retryable}
	default:
		return event
	}
}

func (h *AIHandler) aiError(c *gin.Context, status int, err error) {
	c.JSON(status, gin.H{"error": gin.H{"code": ai.AuditErrorCode(err), "message": aiErrorMessage(err), "retryable": aiErrorRetryable(err)}})
}
func (h *AIHandler) aiErrorResult(c *gin.Context, err error, result ai.AIResult) {
	h.aiError(c, aiHTTPStatus(err), err)
}
func aiHTTPStatus(err error) int {
	switch {
	case errors.Is(err, ai.ErrInvalidContract), errors.Is(err, ai.ErrInvalidContext), errors.Is(err, ai.ErrInvalidSkill), errors.Is(err, ai.ErrProviderInvalid), errors.Is(err, ai.ErrOpenAIRequest):
		return http.StatusBadRequest
	case errors.Is(err, ai.ErrProviderNotFound):
		return http.StatusNotFound
	case errors.Is(err, ai.ErrProviderExists), errors.Is(err, ai.ErrProviderConflict):
		return http.StatusConflict
	case errors.Is(err, ai.ErrProviderDisabled):
		return http.StatusUnprocessableEntity
	case errors.Is(err, ai.ErrProviderKey):
		return http.StatusBadRequest
	case errors.Is(err, ai.ErrOpenAITimeout), errors.Is(err, ai.ErrPiTimeout):
		return http.StatusGatewayTimeout
	case errors.Is(err, ai.ErrOpenAIUnavailable), errors.Is(err, ai.ErrOpenAIProtocol), errors.Is(err, ai.ErrOpenAIResponseLimit), errors.Is(err, ai.ErrOpenAIRedirect):
		return http.StatusBadGateway
	case errors.Is(err, ai.ErrPermissionDenied):
		return http.StatusForbidden
	case errors.Is(err, ai.ErrIdempotencyConflict), errors.Is(err, ai.ErrProposalConflict), errors.Is(err, ai.ErrProposalState), errors.Is(err, ai.ErrAIRunState):
		return http.StatusConflict
	case errors.Is(err, ai.ErrIdempotencyInFlight), errors.Is(err, ai.ErrAIConcurrentLimit):
		return http.StatusTooManyRequests
	case errors.Is(err, ai.ErrProposalNotFound):
		return http.StatusNotFound
	case errors.Is(err, ai.ErrProposalExpired):
		return http.StatusGone
	default:
		return http.StatusBadGateway
	}
}
func aiErrorMessage(err error) string {
	if err == nil {
		return ""
	}
	var upstreamError *ai.OpenAIHTTPError
	if errors.As(err, &upstreamError) {
		return upstreamError.SafeMessage()
	}
	return ai.AuditErrorCode(err)
}
func aiErrorRetryable(err error) bool {
	return errors.Is(err, ai.ErrAIConcurrentLimit) || errors.Is(err, ai.ErrIdempotencyInFlight) || errors.Is(err, ai.ErrPiUnavailable) || errors.Is(err, ai.ErrPiTimeout) || errors.Is(err, ai.ErrOpenAIUnavailable) || errors.Is(err, ai.ErrOpenAITimeout)
}
