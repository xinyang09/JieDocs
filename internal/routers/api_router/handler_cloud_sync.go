package api_router

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"path"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/haierkeys/fast-note-sync-service/internal/app"
	"github.com/haierkeys/fast-note-sync-service/internal/cloudsync"
	"github.com/haierkeys/fast-note-sync-service/internal/domain"
	"github.com/haierkeys/fast-note-sync-service/internal/dto"
	pkgapp "github.com/haierkeys/fast-note-sync-service/pkg/app"
	"github.com/haierkeys/fast-note-sync-service/pkg/code"
	"github.com/haierkeys/fast-note-sync-service/pkg/util"
)

type cloudSyncHandler struct {
	*Handler
	once     sync.Once
	store    *cloudsync.Store
	storeErr error
}

func NewCloudSyncHandler(a *app.App) *cloudSyncHandler {
	return &cloudSyncHandler{Handler: NewHandler(a)}
}

func (h *cloudSyncHandler) ready(c *gin.Context) bool {
	if !h.App.Config().App.CloudSyncEnabled {
		syncError(c, http.StatusNotFound, "cloud_sync_disabled", gin.H{"enabled": false})
		return false
	}
	if pkgapp.GetUID(c) <= 0 {
		syncError(c, http.StatusUnauthorized, "unauthorized", nil)
		return false
	}
	h.once.Do(func() { h.store, h.storeErr = cloudsync.NewStore(h.App.DB) })
	if h.storeErr != nil {
		syncError(c, http.StatusServiceUnavailable, "sync_unavailable", nil)
		return false
	}
	return true
}

// Status reports whether the remote docs/cloud-sync surface is enabled. It is
// intentionally unauthenticated so the Web client can gate itself before
// attempting any account or Vault API calls.
func (h *cloudSyncHandler) Status(c *gin.Context) {
	syncSuccess(c, gin.H{"enabled": h.App.Config().App.CloudSyncEnabled})
}

func syncError(c *gin.Context, status int, message string, data any) {
	c.JSON(status, gin.H{"code": status, "status": false, "message": message, "error": message, "data": data})
}
func syncSuccess(c *gin.Context, data any) {
	c.JSON(http.StatusOK, gin.H{"code": 1, "status": true, "message": "success", "data": data})
}

func (h *cloudSyncHandler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, cloudsync.ErrSession), errors.Is(err, cloudsync.ErrRevoked):
		syncError(c, http.StatusGone, err.Error(), nil)
	case errors.Is(err, cloudsync.ErrCursor):
		syncError(c, http.StatusGone, err.Error(), gin.H{"snapshotRequired": true})
	case errors.Is(err, cloudsync.ErrConflict), errors.Is(err, cloudsync.ErrRequestReuse), errors.Is(err, cloudsync.ErrUncertain):
		syncError(c, http.StatusConflict, err.Error(), nil)
	default:
		h.App.Logger().Error("cloud sync request failed")
		syncError(c, http.StatusInternalServerError, "sync_failed", nil)
	}
}

func syncClient(c *gin.Context) string {
	if v := c.GetHeader("x-client"); v != "" {
		return v
	}
	return c.Query("client")
}
func syncTokenID(c *gin.Context) int64 {
	value, ok := c.Get("user_token")
	if !ok {
		return 0
	}
	user, ok := value.(*pkgapp.UserEntity)
	if !ok {
		return 0
	}
	return user.TokenID
}
func syncPermission(c *gin.Context, function string) bool {
	return pkgapp.VerifyPermissions(c.GetString("scope"), "rest", syncClient(c), function)
}
func syncFingerprint(c *gin.Context) string {
	return cloudsync.PermissionDigest(c.GetString("scope"), c.GetString("vaults"), syncClient(c))
}
func syncAllowedVault(c *gin.Context, vault string) bool {
	return util.VerifyVaultAccess(c.GetString("vaults"), vault)
}
func syncReadKinds(c *gin.Context) map[string]bool {
	return map[string]bool{"note": syncPermission(c, "note_r"), "folder": syncPermission(c, "note_r"), "file": syncPermission(c, "file_r"), "setting": syncPermission(c, "config_r")}
}

func (h *cloudSyncHandler) session(c *gin.Context) (*cloudsync.Session, string, bool) {
	if !h.ready(c) {
		return nil, "", false
	}
	s, err := h.store.Session(c, pkgapp.GetUID(c), syncTokenID(c), c.Param("sessionId"), syncFingerprint(c))
	if err != nil {
		h.fail(c, err)
		return nil, "", false
	}
	vault, err := h.App.VaultService.Get(c, s.UID, s.VaultID)
	if err != nil || vault == nil {
		syncError(c, http.StatusNotFound, "vault_not_found", nil)
		return nil, "", false
	}
	if !syncAllowedVault(c, vault.Name) {
		syncError(c, http.StatusForbidden, "vault_forbidden", nil)
		return nil, "", false
	}
	return s, vault.Name, true
}

func syncJSON(c *gin.Context, value any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2*1024*1024)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		syncError(c, http.StatusBadRequest, "invalid_request", nil)
		return false
	}
	return true
}

func (h *cloudSyncHandler) CreateSession(c *gin.Context) {
	if !h.ready(c) {
		return
	}
	var input struct {
		Vault         string `json:"vault"`
		DeviceID      string `json:"deviceId"`
		ClientName    string `json:"clientName"`
		ClientType    string `json:"clientType"`
		ClientVersion string `json:"clientVersion"`
	}
	if !syncJSON(c, &input) || strings.TrimSpace(input.Vault) == "" || len(input.Vault) > 1024 || strings.TrimSpace(input.DeviceID) == "" || len(input.DeviceID) > 128 || len(input.ClientName) > 200 || len(input.ClientVersion) > 64 {
		syncError(c, http.StatusBadRequest, "invalid_device", nil)
		return
	}
	if syncTokenID(c) <= 0 || !syncAllowedVault(c, input.Vault) {
		syncError(c, http.StatusForbidden, "vault_forbidden", nil)
		return
	}
	if !syncPermission(c, "note_r") && !syncPermission(c, "file_r") && !syncPermission(c, "config_r") {
		syncError(c, http.StatusForbidden, "sync_forbidden", nil)
		return
	}
	vaultID, err := h.App.VaultService.MustGetID(c, pkgapp.GetUID(c), input.Vault)
	if err != nil {
		syncError(c, http.StatusNotFound, "vault_not_found", nil)
		return
	}
	if err := h.store.Cleanup(c); err != nil {
		h.fail(c, err)
		return
	}
	s, err := h.store.CreateSession(c, pkgapp.GetUID(c), syncTokenID(c), vaultID, input.DeviceID, input.ClientName, syncClient(c), input.ClientVersion, syncFingerprint(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	syncSuccess(c, gin.H{"protocolVersion": 2, "sessionId": s.ID, "deviceId": s.DeviceID, "vault": input.Vault, "snapshotRequired": true, "expiresAt": s.ExpiresAt, "readableKinds": syncReadKinds(c), "writableKinds": []string{"note"}, "maxPageSize": 500})
}

func (h *cloudSyncHandler) DeleteSession(c *gin.Context) {
	s, _, ok := h.session(c)
	if !ok {
		return
	}
	if err := h.store.CloseSession(c, s); err != nil {
		h.fail(c, err)
		return
	}
	syncSuccess(c, gin.H{"closed": true})
}

func (h *cloudSyncHandler) scan(uid int64, vault string, kinds map[string]bool) cloudsync.Scan {
	return func(ctx context.Context) ([]cloudsync.Resource, error) {
		items := []cloudsync.Resource{}
		if kinds["note"] {
			notes, err := h.App.NoteService.ListByLastTime(ctx, uid, &dto.NoteSyncRequest{Vault: vault, Context: "cloud-sync"})
			if err != nil {
				return nil, err
			}
			for _, note := range notes {
				items = append(items, cloudsync.Resource{Kind: "note", Action: note.Action, Path: note.Path, PathHash: note.PathHash, ContentHash: note.ContentHash, Version: note.Version, Size: note.Size, Ctime: note.Ctime, Mtime: note.Mtime, LastTime: note.UpdatedTimestamp})
			}
		}
		if kinds["file"] {
			files, err := h.App.FileService.ListByLastTime(ctx, uid, &dto.FileSyncRequest{Vault: vault, Context: "cloud-sync"})
			if err != nil {
				return nil, err
			}
			for _, file := range files {
				items = append(items, cloudsync.Resource{Kind: "file", Action: file.Action, Path: file.Path, PathHash: file.PathHash, ContentHash: file.ContentHash, Size: file.Size, Ctime: file.Ctime, Mtime: file.Mtime, LastTime: file.UpdatedTimestamp})
			}
		}
		if kinds["setting"] {
			settings, err := h.App.SettingService.ListByLastTime(ctx, uid, &dto.SettingSyncRequest{Vault: vault, Context: "cloud-sync"})
			if err != nil {
				return nil, err
			}
			for _, setting := range settings {
				items = append(items, cloudsync.Resource{Kind: "setting", Action: setting.Action, Path: setting.Path, PathHash: setting.PathHash, ContentHash: setting.ContentHash, Size: int64(len(setting.Content)), Ctime: setting.Ctime, Mtime: setting.Mtime, LastTime: setting.UpdatedTimestamp})
			}
		}
		if kinds["folder"] {
			folders, err := h.App.FolderService.ListByUpdatedTimestamp(ctx, uid, vault, 0)
			if err != nil {
				return nil, err
			}
			for _, folder := range folders {
				items = append(items, cloudsync.Resource{Kind: "folder", Action: folder.Action, Path: folder.Path, PathHash: folder.PathHash, Ctime: folder.Ctime, Mtime: folder.Mtime, LastTime: folder.UpdatedTimestamp})
			}
		}
		return items, nil
	}
}

func (h *cloudSyncHandler) readPage(c *gin.Context, snapshot bool) {
	s, vault, ok := h.session(c)
	if !ok {
		return
	}
	limit := 100
	if raw := c.Query("limit"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 500 {
			syncError(c, 400, "invalid_limit", nil)
			return
		}
		limit = value
	}
	var result *cloudsync.Page
	var err error
	scan := h.scan(s.UID, vault, syncReadKinds(c))
	if snapshot {
		result, err = h.store.Snapshot(c, s, c.Query("cursor"), limit, scan)
	} else {
		result, err = h.store.Changes(c, s, c.Query("cursor"), limit, scan)
	}
	if err != nil {
		h.fail(c, err)
		return
	}
	syncSuccess(c, result)
}
func (h *cloudSyncHandler) Snapshot(c *gin.Context) { h.readPage(c, true) }
func (h *cloudSyncHandler) Changes(c *gin.Context)  { h.readPage(c, false) }

type cloudSyncOperation struct {
	RequestID       string  `json:"requestId"`
	Kind            string  `json:"kind"`
	Action          string  `json:"action"`
	Path            string  `json:"path"`
	OldPath         string  `json:"oldPath"`
	PathHash        string  `json:"pathHash"`
	OldPathHash     string  `json:"oldPathHash"`
	Content         *string `json:"content"`
	ContentHash     string  `json:"contentHash"`
	BaseContentHash string  `json:"baseContentHash"`
	Version         *int64  `json:"version"`
	BaseMtime       int64   `json:"baseMtime"`
	Ctime           int64   `json:"ctime"`
	Mtime           int64   `json:"mtime"`
}

func validSyncPath(value string) bool {
	if !utf8.ValidString(value) || value == "" || len(value) > 1024 || path.IsAbs(value) || path.Clean(value) != value || strings.ContainsAny(value, "\\\x00") || strings.Contains(value, ":") {
		return false
	}
	for _, part := range strings.Split(value, "/") {
		if part == "." || part == ".." || part == "" {
			return false
		}
	}
	return true
}
func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (h *cloudSyncHandler) Operation(c *gin.Context) {
	s, vault, ok := h.session(c)
	if !ok {
		return
	}
	var op cloudSyncOperation
	if !syncJSON(c, &op) {
		return
	}
	if strings.TrimSpace(op.RequestID) == "" || len(op.RequestID) > 128 || !validSyncPath(op.Path) {
		syncError(c, 400, "invalid_operation", nil)
		return
	}
	if op.Action != "create" && op.Action != "update" {
		syncError(c, 400, "invalid_action", nil)
		return
	}
	if op.Kind == "note" {
		if !syncPermission(c, "note_w") || op.Content == nil || !strings.HasSuffix(strings.ToLower(op.Path), ".md") || !utf8.ValidString(*op.Content) || op.Ctime < 0 || op.Mtime < 0 {
			syncError(c, http.StatusForbidden, "sync_forbidden", nil)
			return
		}
	} else if op.Kind == "setting" {
		if !syncPermission(c, "config_w") || op.Content == nil || !utf8.ValidString(*op.Content) || op.Ctime < 0 || op.Mtime < 0 {
			syncError(c, http.StatusForbidden, "sync_forbidden", nil)
			return
		}
	} else if op.Kind == "folder" {
		if !syncPermission(c, "note_w") || op.Action != "create" {
			syncError(c, http.StatusForbidden, "sync_forbidden", nil)
			return
		}
	} else {
		syncError(c, http.StatusNotImplemented, "sync_operation_unsupported", nil)
		return
	}
	pathHash := util.EncodeHash32(op.Path)
	if op.PathHash != "" && op.PathHash != pathHash {
		syncError(c, 400, "hash_mismatch", nil)
		return
	}
	if op.Kind == "note" || op.Kind == "setting" {
		hash := util.EncodeHash32(*op.Content)
		if op.ContentHash != "" && op.ContentHash != hash {
			syncError(c, 400, "hash_mismatch", nil)
			return
		}
		if op.Action == "update" && op.BaseContentHash == "" {
			syncError(c, http.StatusPreconditionRequired, "precondition_required", nil)
			return
		}
	}
	params := &dto.NoteModifyOrCreateRequest{Vault: vault, Path: op.Path, PathHash: pathHash, Content: valueOrEmpty(op.Content), ContentHash: op.ContentHash, Ctime: op.Ctime, Mtime: op.Mtime, CreateOnly: op.Action == "create"}
	if op.Kind == "note" {
		params.ContentHash = util.EncodeHash32(*op.Content)
		if op.Action == "update" {
			params.ExpectedVersion = op.Version
			params.ExpectedContentHash = op.BaseContentHash
		}
	}
	result, err := h.store.Execute(c, s, op.RequestID, op, func() (any, error) {
		switch op.Kind {
		case "note":
			_, note, writeErr := h.App.NoteService.WithClient(syncClient(c), "Cloud Sync", "2").ModifyOrCreate(c, s.UID, params, false)
			if writeErr != nil {
				return nil, writeErr
			}
			return gin.H{"status": "applied", "kind": "note", "resource": note}, nil
		case "setting":
			settingParams := &dto.SettingModifyOrCreateRequest{Vault: vault, Path: op.Path, PathHash: pathHash, Content: valueOrEmpty(op.Content), ContentHash: util.EncodeHash32(valueOrEmpty(op.Content)), Ctime: op.Ctime, Mtime: op.Mtime}
			if op.Action == "update" {
				_, setting, writeErr := h.App.SettingService.ModifyOrCreateCAS(c, s.UID, settingParams, op.BaseContentHash)
				if writeErr != nil {
					return nil, writeErr
				}
				return gin.H{"status": "applied", "kind": "setting", "resource": setting}, nil
			}
			_, setting, writeErr := h.App.SettingService.ModifyOrCreate(c, s.UID, settingParams, false)
			if writeErr != nil {
				return nil, writeErr
			}
			return gin.H{"status": "applied", "kind": "setting", "resource": setting}, nil
		case "folder":
			folder, writeErr := h.App.FolderService.WithClient(syncClient(c), "Cloud Sync", "2").UpdateOrCreate(c, s.UID, &dto.FolderCreateRequest{Vault: vault, Path: op.Path, PathHash: pathHash})
			if writeErr != nil {
				return nil, writeErr
			}
			return gin.H{"status": "applied", "kind": "folder", "resource": folder}, nil
		}
		return nil, errors.New("unsupported sync operation")
	})
	if err != nil {
		var coded *code.Code
		if errors.Is(err, domain.ErrNoteVersionConflict) || errors.Is(err, domain.ErrSettingContentConflict) || (errors.As(err, &coded) && coded.Code() == code.ErrorNoteExist.Code()) {
			current, readErr := h.App.NoteService.Get(c, s.UID, &dto.NoteGetRequest{Vault: vault, Path: op.Path})
			data := gin.H{"kind": op.Kind, "path": op.Path}
			if op.Kind == "setting" {
				setting, settingErr := h.App.SettingService.Get(c, s.UID, &dto.SettingGetRequest{Vault: vault, Path: op.Path, PathHash: util.EncodeHash32(op.Path)})
				if settingErr == nil && setting != nil {
					data["currentContentHash"] = setting.ContentHash
				}
			} else if readErr == nil && current != nil {
				data["currentVersion"] = current.Version
				data["currentContentHash"] = current.ContentHash
			}
			syncError(c, 409, "sync_conflict", data)
			return
		}
		h.fail(c, err)
		return
	}
	syncSuccess(c, result)
}

func (h *cloudSyncHandler) deviceVault(c *gin.Context, write bool) (int64, bool) {
	if !h.ready(c) {
		return 0, false
	}
	allowed := syncPermission(c, "note_r") || syncPermission(c, "file_r") || syncPermission(c, "config_r")
	if write {
		allowed = syncPermission(c, "note_w") || syncPermission(c, "file_w") || syncPermission(c, "config_w")
	}
	if !allowed {
		syncError(c, 403, "sync_forbidden", nil)
		return 0, false
	}
	vault := c.Query("vault")
	if vault == "" {
		syncError(c, 400, "vault_required", nil)
		return 0, false
	}
	if !syncAllowedVault(c, vault) {
		syncError(c, 403, "vault_forbidden", nil)
		return 0, false
	}
	id, err := h.App.VaultService.MustGetID(c, pkgapp.GetUID(c), vault)
	if err != nil {
		syncError(c, 404, "vault_not_found", nil)
		return 0, false
	}
	return id, true
}
func (h *cloudSyncHandler) Devices(c *gin.Context) {
	id, ok := h.deviceVault(c, false)
	if !ok {
		return
	}
	devices, err := h.store.Devices(c, pkgapp.GetUID(c), id)
	if err != nil {
		h.fail(c, err)
		return
	}
	syncSuccess(c, devices)
}
func (h *cloudSyncHandler) mutateDevice(c *gin.Context, revoke bool) {
	id, ok := h.deviceVault(c, true)
	if !ok {
		return
	}
	var input struct {
		Version int64   `json:"version"`
		Name    *string `json:"name"`
	}
	if !syncJSON(c, &input) {
		return
	}
	if input.Version < 1 || (!revoke && (input.Name == nil || strings.TrimSpace(*input.Name) == "" || len(*input.Name) > 200)) {
		syncError(c, 400, "invalid_device_update", nil)
		return
	}
	if err := h.store.UpdateDevice(c, pkgapp.GetUID(c), id, c.Param("deviceId"), input.Version, input.Name, revoke); err != nil {
		h.fail(c, err)
		return
	}
	syncSuccess(c, gin.H{"updated": true, "version": input.Version + 1})
}
func (h *cloudSyncHandler) RevokeDevice(c *gin.Context) { h.mutateDevice(c, true) }
func (h *cloudSyncHandler) RenameDevice(c *gin.Context) { h.mutateDevice(c, false) }
