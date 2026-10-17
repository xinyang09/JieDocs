package api_router

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/haierkeys/fast-note-sync-service/internal/app"
	appconfig "github.com/haierkeys/fast-note-sync-service/internal/config"
	"github.com/haierkeys/fast-note-sync-service/internal/dto"
	"github.com/haierkeys/fast-note-sync-service/internal/transfer"
	pkgapp "github.com/haierkeys/fast-note-sync-service/pkg/app"
	"github.com/haierkeys/fast-note-sync-service/pkg/code"
	apperrors "github.com/haierkeys/fast-note-sync-service/pkg/errors"
	"github.com/haierkeys/fast-note-sync-service/pkg/util"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

type TransferHandler struct {
	*Handler
}

func NewTransferHandler(a *app.App) *TransferHandler {
	return &TransferHandler{Handler: NewHandler(a)}
}

func (h *TransferHandler) Profiles(c *gin.Context) {
	if !h.ensureService(c) || !h.ensurePermission(c, "transfer_r") {
		return
	}
	uid := pkgapp.GetUID(c)
	vault := strings.TrimSpace(c.Query("vault"))
	if vault == "" && c.GetString("vaults") != "" {
		h.respondError(c, code.ErrorInvalidParams.WithDetails("vault is required for a restricted token"))
		return
	}
	if vault != "" && !util.VerifyVaultAccess(c.GetString("vaults"), vault) {
		h.respondError(c, code.ErrorAuthTokenScopeRestricted)
		return
	}
	profiles := h.App.Transfer.Profiles(uid, vault)
	if c.GetString("vaults") != "" {
		filtered := profiles[:0]
		for _, profile := range profiles {
			if util.VerifyVaultAccess(c.GetString("vaults"), profile.Vault) {
				filtered = append(filtered, profile)
			}
		}
		profiles = filtered
	}
	pkgapp.NewResponse(c).ToResponse(code.Success.WithData(profiles))
}

func (h *TransferHandler) PluginInfo(c *gin.Context) {
	if pkgapp.GetUID(c) == 0 || !h.ensurePermission(c, "transfer_r") {
		return
	}
	info := gin.H{
		"id":                "fns.transfer",
		"name":              "Transfer Publisher",
		"version":           "0.1.0",
		"mode":              "platform-enhancement",
		"surface":           "docs-viewer",
		"slot":              "platform-enhancements",
		"providers":         []string{"feishu", "notion"},
		"enabled":           h.App.Config().Transfer.Enabled,
		"livePublishing":    false,
		"profileCount":      0,
		"runtimeConfigPath": "config.yaml",
	}
	if h.App.Transfer != nil {
		info["livePublishing"] = h.App.Config().Transfer.Enabled && h.App.Config().Transfer.ProjectPath != ""
		info["profileCount"] = len(h.App.Transfer.ManagedProfiles())
	}
	pkgapp.NewResponse(c).ToResponse(code.Success.WithData(info))
}

func (h *TransferHandler) AdminProfiles(c *gin.Context) {
	if !h.ensureService(c) || !h.ensureAdmin(c) {
		return
	}
	pkgapp.NewResponse(c).ToResponse(code.Success.WithData(h.App.Transfer.ManagedProfiles()))
}

func (h *TransferHandler) AdminCreateProfile(c *gin.Context) {
	if !h.ensureService(c) || !h.ensureAdmin(c) {
		return
	}
	request, err := decodeTransferProfileRequest(c)
	if err != nil {
		h.respondError(c, code.ErrorInvalidParams.WithDetails(err.Error()))
		return
	}
	profile, err := h.App.Transfer.CreateProfile(c.Request.Context(), appconfig.TransferProfile{
		ID: request.ID, UID: request.UID, Vault: request.Vault, Provider: request.Provider,
		AllowLive: request.AllowLive, Env: request.Env, Credentials: request.Credentials,
	})
	if err != nil {
		h.respondServiceError(c, err)
		return
	}
	pkgapp.NewResponse(c).ToResponse(code.Success.WithData(profile))
}

func (h *TransferHandler) AdminUpdateProfile(c *gin.Context) {
	if !h.ensureService(c) || !h.ensureAdmin(c) {
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	request, err := decodeTransferProfileRequest(c)
	if err != nil {
		h.respondError(c, code.ErrorInvalidParams.WithDetails(err.Error()))
		return
	}
	if request.ID == "" {
		request.ID = id
	}
	profile, err := h.App.Transfer.UpdateProfile(c.Request.Context(), id, appconfig.TransferProfile{
		ID: request.ID, UID: request.UID, Vault: request.Vault, Provider: request.Provider,
		AllowLive: request.AllowLive, Env: request.Env, Credentials: request.Credentials,
	})
	if err != nil {
		h.respondServiceError(c, err)
		return
	}
	pkgapp.NewResponse(c).ToResponse(code.Success.WithData(profile))
}

func (h *TransferHandler) AdminDeleteProfile(c *gin.Context) {
	if !h.ensureService(c) || !h.ensureAdmin(c) {
		return
	}
	if err := h.App.Transfer.DeleteProfile(c.Request.Context(), strings.TrimSpace(c.Param("id"))); err != nil {
		h.respondServiceError(c, err)
		return
	}
	pkgapp.NewResponse(c).ToResponse(code.Success)
}

func (h *TransferHandler) Submit(c *gin.Context) {
	if !h.ensureService(c) || !h.ensurePermission(c, "transfer_w") || !h.ensurePermission(c, "note_r") {
		return
	}
	uid := pkgapp.GetUID(c)
	request, err := decodeTransferRequest(c)
	if err != nil {
		h.respondError(c, code.ErrorInvalidParams.WithDetails(err.Error()))
		return
	}
	if !util.VerifyVaultAccess(c.GetString("vaults"), request.Vault) {
		h.respondError(c, code.ErrorAuthTokenScopeRestricted)
		return
	}
	profileFound := false
	for _, profile := range h.App.Transfer.Profiles(uid, request.Vault) {
		if profile.ID == request.Profile {
			profileFound = true
			if request.Live && !profile.AllowLive {
				h.respondError(c, code.ErrorInvalidParams.WithDetails("live publishing is disabled for this profile"))
				return
			}
			break
		}
	}
	if !profileFound {
		h.respondError(c, code.ErrorInvalidParams.WithDetails("transfer profile is not available"))
		return
	}

	clientType, clientName, clientVersion := h.getClientInfo(c)
	noteService := h.App.GetNoteService(clientType, clientName, clientVersion)
	note, err := noteService.Get(c.Request.Context(), uid, &dto.NoteGetRequest{
		Vault:    request.Vault,
		Path:     request.Path,
		PathHash: util.EncodeHash32(request.Path),
	})
	if err != nil {
		h.logError(c.Request.Context(), "TransferHandler.Submit.GetNote", err)
		apperrors.ErrorResponse(c, err)
		return
	}
	job, err := h.App.Transfer.Submit(c.Request.Context(), uid, transfer.Request{
		Profile: request.Profile,
		Vault:   request.Vault,
		Path:    request.Path,
		Live:    request.Live,
		Force:   request.Force,
	}, transfer.Note{Path: note.Path, Content: note.Content, Mtime: note.Mtime})
	if err != nil {
		h.respondServiceError(c, err)
		return
	}
	writeTransferAccepted(c, job)
}

func (h *TransferHandler) List(c *gin.Context) {
	if !h.ensureService(c) || !h.ensurePermission(c, "transfer_r") {
		return
	}
	uid := pkgapp.GetUID(c)
	vault := strings.TrimSpace(c.Query("vault"))
	if vault == "" && c.GetString("vaults") != "" {
		h.respondError(c, code.ErrorInvalidParams.WithDetails("vault is required for a restricted token"))
		return
	}
	if vault != "" && !util.VerifyVaultAccess(c.GetString("vaults"), vault) {
		h.respondError(c, code.ErrorAuthTokenScopeRestricted)
		return
	}
	page, pageSize, err := parsePagination(c)
	if err != nil {
		h.respondError(c, code.ErrorInvalidParams.WithDetails(err.Error()))
		return
	}
	jobs, total, err := h.App.Transfer.List(c.Request.Context(), uid, vault, page, pageSize)
	if err != nil {
		h.logError(c.Request.Context(), "TransferHandler.List", err)
		h.respondError(c, code.ErrorServerInternal)
		return
	}
	pkgapp.NewResponse(c).ToResponseList(code.Success, jobs, int(total))
}

func (h *TransferHandler) Get(c *gin.Context) {
	if !h.ensureService(c) || !h.ensurePermission(c, "transfer_r") {
		return
	}
	uid := pkgapp.GetUID(c)
	id := strings.TrimSpace(c.Param("id"))
	if id == "" || len(id) > 64 {
		h.respondError(c, code.ErrorInvalidParams.WithDetails("job id is invalid"))
		return
	}
	job, err := h.App.Transfer.Get(c.Request.Context(), uid, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		h.respondError(c, code.ErrorNotFoundAPI)
		return
	}
	if err != nil {
		h.logError(c.Request.Context(), "TransferHandler.Get", err)
		h.respondError(c, code.ErrorServerInternal)
		return
	}
	if !util.VerifyVaultAccess(c.GetString("vaults"), job.Vault) {
		h.respondError(c, code.ErrorAuthTokenScopeRestricted)
		return
	}
	pkgapp.NewResponse(c).ToResponse(code.Success.WithData(job))
}

func (h *TransferHandler) ensureService(c *gin.Context) bool {
	if pkgapp.GetUID(c) == 0 {
		h.respondError(c, code.ErrorNotUserAuthToken)
		return false
	}
	if h.App.Transfer == nil {
		h.respondError(c, code.ErrorNotFoundAPI)
		return false
	}
	return true
}

func (h *TransferHandler) ensurePermission(c *gin.Context, function string) bool {
	if pkgapp.VerifyPermissions(c.GetString("scope"), "rest", pkgapp.GetClientType(c), function) {
		return true
	}
	h.respondError(c, code.ErrorAuthTokenScopeRestricted)
	return false
}

func (h *TransferHandler) ensureAdmin(c *gin.Context) bool {
	uid := pkgapp.GetUID(c)
	if uid == 0 {
		h.respondError(c, code.ErrorNotUserAuthToken)
		return false
	}
	adminUID := h.App.Config().User.AdminUID
	if adminUID != 0 && uid != int64(adminUID) {
		h.respondError(c, code.ErrorUserIsNotAdmin)
		return false
	}
	return true
}

func (h *TransferHandler) respondError(c *gin.Context, codeErr *code.Code) {
	pkgapp.NewResponse(c).ToResponse(codeErr)
}

func (h *TransferHandler) respondServiceError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, transfer.ErrQueueFull), errors.Is(err, transfer.ErrDuplicate), errors.Is(err, transfer.ErrClosed):
		h.respondError(c, code.ErrorServerBusy)
	case errors.Is(err, transfer.ErrProfileExists), strings.Contains(err.Error(), "required"), strings.Contains(err.Error(), "requires"), strings.Contains(err.Error(), "credential"), strings.Contains(err.Error(), "invalid"), strings.Contains(err.Error(), "exceeds"), strings.Contains(err.Error(), "available"), strings.Contains(err.Error(), "disabled"), strings.Contains(err.Error(), "match"), strings.Contains(err.Error(), "cannot be changed"):
		h.respondError(c, code.ErrorInvalidParams.WithDetails(err.Error()))
	case errors.Is(err, transfer.ErrProfileNotFound):
		h.respondError(c, code.ErrorNotFoundAPI)
	default:
		h.logError(c.Request.Context(), "TransferHandler.Submit", err)
		h.respondError(c, code.ErrorServerInternal)
	}
}

type transferSubmitRequest struct {
	Profile string `json:"profile"`
	Vault   string `json:"vault"`
	Path    string `json:"path"`
	Live    bool   `json:"live"`
	Force   bool   `json:"force"`
}

type transferProfileRequest struct {
	ID          string            `json:"id"`
	UID         int64             `json:"uid"`
	Vault       string            `json:"vault"`
	Provider    string            `json:"provider"`
	AllowLive   bool              `json:"allowLive"`
	Env         map[string]string `json:"env"`
	Credentials map[string]string `json:"credentials"`
}

func decodeTransferProfileRequest(c *gin.Context) (transferProfileRequest, error) {
	var request transferProfileRequest
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16*1024)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return request, fmt.Errorf("invalid JSON request: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return request, errors.New("request body must contain one JSON object")
		}
		return request, fmt.Errorf("invalid JSON request: %w", err)
	}
	if request.Env == nil {
		request.Env = map[string]string{}
	}
	if request.Credentials == nil {
		request.Credentials = map[string]string{}
	}
	return request, nil
}

func decodeTransferRequest(c *gin.Context) (transferSubmitRequest, error) {
	var request transferSubmitRequest
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16*1024)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return request, fmt.Errorf("invalid JSON request: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return request, errors.New("request body must contain one JSON object")
		}
		return request, fmt.Errorf("invalid JSON request: %w", err)
	}
	if strings.TrimSpace(request.Profile) == "" || strings.TrimSpace(request.Vault) == "" || strings.TrimSpace(request.Path) == "" {
		return request, errors.New("profile, vault and path are required")
	}
	return request, nil
}

func parsePagination(c *gin.Context) (int, int, error) {
	page, pageSize := 1, 20
	var err error
	if value := c.Query("page"); value != "" {
		page, err = strconv.Atoi(value)
		if err != nil || page < 1 {
			return 0, 0, errors.New("page must be a positive integer")
		}
	}
	if value := c.Query("pageSize"); value != "" {
		pageSize, err = strconv.Atoi(value)
		if err != nil || pageSize < 1 || pageSize > 100 {
			return 0, 0, errors.New("pageSize must be between 1 and 100")
		}
	}
	return page, pageSize, nil
}

func writeTransferAccepted(c *gin.Context, job *transfer.Job) {
	c.JSON(http.StatusAccepted, pkgapp.Res{
		Code:    code.Success.Code(),
		Status:  true,
		Message: code.Success.MsgIn(c.GetString("lang")),
		Data:    job,
	})
}

func (h *TransferHandler) logError(ctx context.Context, method string, err error) {
	h.App.Logger().Error(method, zap.Error(err))
}
