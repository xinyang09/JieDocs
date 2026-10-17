package websocket_router

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"

	"github.com/haierkeys/fast-note-sync-service/internal/app"
	"github.com/haierkeys/fast-note-sync-service/internal/cloudsync"
	"github.com/haierkeys/fast-note-sync-service/internal/dto"
	pkgapp "github.com/haierkeys/fast-note-sync-service/pkg/app"
	"github.com/haierkeys/fast-note-sync-service/pkg/code"
	"github.com/haierkeys/fast-note-sync-service/pkg/util"
)

type CloudSyncWSHandler struct {
	*WSHandler
	once     sync.Once
	store    *cloudsync.Store
	storeErr error
}

func NewCloudSyncWSHandler(a *app.App) *CloudSyncWSHandler {
	return &CloudSyncWSHandler{WSHandler: NewWSHandler(a)}
}

type cloudSyncPullRequest struct {
	SessionID string `json:"sessionId"`
	Cursor    string `json:"cursor"`
	Limit     int    `json:"limit"`
	Snapshot  bool   `json:"snapshot"`
}

func (h *CloudSyncWSHandler) Pull(c *pkgapp.WebsocketClient, msg *pkgapp.WebSocketMessage) {
	if !h.App.Config().App.CloudSyncEnabled {
		c.ToResponse(code.ErrorNotFoundAPI.WithDetails("cloud_sync_disabled"), CloudSyncPage)
		return
	}
	if c.User == nil {
		c.ToResponse(code.ErrorNotUserAuthToken, CloudSyncPage)
		return
	}
	if !pkgapp.VerifyPermissions(c.Scope, "ws", c.ClientType(), "note_r") && !pkgapp.VerifyPermissions(c.Scope, "ws", c.ClientType(), "file_r") && !pkgapp.VerifyPermissions(c.Scope, "ws", c.ClientType(), "config_r") {
		c.ToResponse(code.ErrorAuthTokenScopeRestricted.WithDetails("Permission denied: cloud sync read"), CloudSyncPage)
		return
	}
	var request cloudSyncPullRequest
	decoder := json.NewDecoder(strings.NewReader(string(msg.Data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil || request.SessionID == "" {
		c.ToResponse(code.ErrorInvalidParams.WithDetails("sessionId is required"), CloudSyncPage)
		return
	}
	if request.Limit < 1 {
		request.Limit = 100
	}
	if request.Limit > 500 {
		request.Limit = 500
	}
	h.once.Do(func() { h.store, h.storeErr = cloudsync.NewStore(h.App.DB) })
	if h.storeErr != nil {
		h.respondError(c, code.ErrorServerInternal, h.storeErr, "cloud_sync.store", msg)
		return
	}
	permission := cloudsync.PermissionDigest(c.Scope, c.Vaults, c.ClientType())
	session, err := h.store.Session(c.Context(), c.User.UID, c.TokenID, request.SessionID, permission)
	if err != nil {
		h.respondSyncError(c, err, msg)
		return
	}
	vault, err := h.App.VaultService.Get(c.Context(), session.UID, session.VaultID)
	if err != nil || vault == nil || !util.VerifyVaultAccess(c.Vaults, vault.Name) {
		h.respondSyncError(c, cloudsync.ErrRevoked, msg)
		return
	}
	scan := h.scanResources(session.UID, vault.Name)
	var page *cloudsync.Page
	if request.Snapshot {
		page, err = h.store.Snapshot(c.Context(), session, request.Cursor, request.Limit, scan)
	} else {
		page, err = h.store.Changes(c.Context(), session, request.Cursor, request.Limit, scan)
	}
	if err != nil {
		h.respondSyncError(c, err, msg)
		return
	}
	c.ToResponse(code.Success.WithData(page), CloudSyncPage)
}

func (h *CloudSyncWSHandler) respondSyncError(c *pkgapp.WebsocketClient, err error, msg *pkgapp.WebSocketMessage) {
	if errors.Is(err, cloudsync.ErrCursor) {
		c.ToResponse(code.ErrorInvalidParams.WithDetails("cursor_expired"), CloudSyncPage)
		return
	}
	if errors.Is(err, cloudsync.ErrRevoked) || errors.Is(err, cloudsync.ErrSession) {
		c.ToResponse(code.ErrorInvalidUserAuthToken, CloudSyncPage)
		return
	}
	h.respondError(c, code.ErrorServerInternal, err, "cloud_sync.pull", msg)
}

func (h *CloudSyncWSHandler) scanResources(uid int64, vault string) cloudsync.Scan {
	return func(ctx context.Context) ([]cloudsync.Resource, error) {
		items := []cloudsync.Resource{}
		notes, err := h.App.NoteService.ListByLastTime(ctx, uid, &dto.NoteSyncRequest{Vault: vault, Context: "cloud-sync-ws"})
		if err != nil {
			return nil, err
		}
		for _, n := range notes {
			items = append(items, cloudsync.Resource{Kind: "note", Action: n.Action, Path: n.Path, PathHash: n.PathHash, ContentHash: n.ContentHash, Version: n.Version, Size: n.Size, Ctime: n.Ctime, Mtime: n.Mtime, LastTime: n.UpdatedTimestamp})
		}
		files, err := h.App.FileService.ListByLastTime(ctx, uid, &dto.FileSyncRequest{Vault: vault, Context: "cloud-sync-ws"})
		if err != nil {
			return nil, err
		}
		for _, f := range files {
			items = append(items, cloudsync.Resource{Kind: "file", Action: f.Action, Path: f.Path, PathHash: f.PathHash, ContentHash: f.ContentHash, Size: f.Size, Ctime: f.Ctime, Mtime: f.Mtime, LastTime: f.UpdatedTimestamp})
		}
		settings, err := h.App.SettingService.ListByLastTime(ctx, uid, &dto.SettingSyncRequest{Vault: vault, Context: "cloud-sync-ws"})
		if err != nil {
			return nil, err
		}
		for _, s := range settings {
			items = append(items, cloudsync.Resource{Kind: "setting", Action: s.Action, Path: s.Path, PathHash: s.PathHash, ContentHash: s.ContentHash, Size: int64(len(s.Content)), Ctime: s.Ctime, Mtime: s.Mtime, LastTime: s.UpdatedTimestamp})
		}
		folders, err := h.App.FolderService.ListByUpdatedTimestamp(ctx, uid, vault, 0)
		if err != nil {
			return nil, err
		}
		for _, f := range folders {
			items = append(items, cloudsync.Resource{Kind: "folder", Action: f.Action, Path: f.Path, PathHash: f.PathHash, Ctime: f.Ctime, Mtime: f.Mtime, LastTime: f.UpdatedTimestamp})
		}
		return items, nil
	}
}
