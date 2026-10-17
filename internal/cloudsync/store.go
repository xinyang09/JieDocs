package cloudsync

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/haierkeys/fast-note-sync-service/pkg/keyedmutex"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrSession      = errors.New("sync_session_expired")
	ErrRevoked      = errors.New("sync_device_revoked")
	ErrCursor       = errors.New("cursor_expired")
	ErrConflict     = errors.New("sync_conflict")
	ErrRequestReuse = errors.New("request_id_reused")
	ErrUncertain    = errors.New("operation_outcome_unknown")
)

const SessionLifetime = 7 * 24 * time.Hour
const CursorLifetime = 24 * time.Hour
const MaxResources = 100000

type Device struct {
	ID            string    `gorm:"primaryKey;size:36" json:"id"`
	UID           int64     `gorm:"uniqueIndex:cloud_device_key" json:"-"`
	VaultID       int64     `gorm:"uniqueIndex:cloud_device_key" json:"-"`
	DeviceID      string    `gorm:"uniqueIndex:cloud_device_key;size:128" json:"deviceId"`
	TokenID       int64     `json:"-"`
	Name          string    `gorm:"size:200" json:"clientName"`
	ClientType    string    `gorm:"size:64" json:"clientType"`
	ClientVersion string    `gorm:"size:64" json:"clientVersion"`
	Version       int64     `json:"version"`
	LastSeen      time.Time `json:"lastSeen"`
	Revoked       bool      `json:"revoked"`
}

func (Device) TableName() string { return "cloud_sync_devices" }

type Session struct {
	ID          string    `gorm:"primaryKey;size:36" json:"sessionId"`
	UID         int64     `gorm:"index" json:"-"`
	TokenID     int64     `json:"-"`
	VaultID     int64     `json:"-"`
	DeviceKey   string    `gorm:"size:36;index" json:"-"`
	DeviceID    string    `gorm:"size:128" json:"deviceId"`
	Permissions string    `gorm:"size:64" json:"-"`
	ExpiresAt   time.Time `gorm:"index" json:"expiresAt"`
}

func (Session) TableName() string { return "cloud_sync_sessions" }

type Resource struct {
	Kind        string `json:"kind"`
	Action      string `json:"action"`
	Path        string `json:"path"`
	PathHash    string `json:"pathHash"`
	ContentHash string `json:"contentHash,omitempty"`
	Version     int64  `json:"version"`
	Size        int64  `json:"size"`
	Ctime       int64  `json:"ctime"`
	Mtime       int64  `json:"mtime"`
	LastTime    int64  `json:"lastTime"`
}

type batch struct {
	ID        string    `gorm:"primaryKey;size:36"`
	SessionID string    `gorm:"uniqueIndex:cloud_batch_parent;size:36;index"`
	ParentID  string    `gorm:"uniqueIndex:cloud_batch_parent;size:36"`
	State     string    `gorm:"type:text"`
	Changes   string    `gorm:"type:text"`
	CreatedAt time.Time `gorm:"index"`
}

func (batch) TableName() string { return "cloud_sync_batches" }

type receipt struct {
	SessionID string    `gorm:"primaryKey;size:36"`
	RequestID string    `gorm:"primaryKey;size:128"`
	Digest    string    `gorm:"size:64"`
	Result    string    `gorm:"type:text"`
	CreatedAt time.Time `gorm:"index"`
}

func (receipt) TableName() string { return "cloud_sync_receipts" }

type Store struct {
	db    *gorm.DB
	locks *keyedmutex.KeyedMutex
	now   func() time.Time
}

func NewStore(db *gorm.DB) (*Store, error) {
	if db == nil {
		return nil, errors.New("sync database unavailable")
	}
	if err := db.AutoMigrate(&Device{}, &Session{}, &batch{}, &receipt{}); err != nil {
		return nil, err
	}
	return &Store{db: db, locks: keyedmutex.New(), now: time.Now}, nil
}

func PermissionDigest(scope, vaults, client string) string {
	sum := sha256.Sum256([]byte(scope + "\x00" + vaults + "\x00" + client))
	return hex.EncodeToString(sum[:])
}

func (store *Store) CreateSession(ctx context.Context, uid, tokenID, vaultID int64, deviceID, name, client, version, permissions string) (*Session, error) {
	unlock := store.locks.Lock(fmt.Sprintf("device:%d:%d:%s", uid, vaultID, deviceID))
	defer unlock()
	session := &Session{ID: uuid.NewString(), UID: uid, TokenID: tokenID, VaultID: vaultID, DeviceID: deviceID, Permissions: permissions, ExpiresAt: store.now().Add(SessionLifetime)}
	err := store.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		device := Device{ID: uuid.NewString(), UID: uid, TokenID: tokenID, VaultID: vaultID, DeviceID: deviceID, Name: name, ClientType: client, ClientVersion: version, Version: 1, LastSeen: store.now()}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&device).Error; err != nil {
			return err
		}
		if err := tx.Where("uid = ? AND vault_id = ? AND device_id = ?", uid, vaultID, deviceID).First(&device).Error; err != nil {
			return err
		}
		if device.Revoked {
			return ErrRevoked
		}
		updates := map[string]any{"last_seen": store.now()}
		if device.TokenID != tokenID {
			updates["token_id"] = tokenID
			updates["version"] = gorm.Expr("version + 1")
		}
		if err := tx.Model(&Device{}).Where("id = ? AND revoked = ?", device.ID, false).Updates(updates).Error; err != nil {
			return err
		}
		session.DeviceKey = device.ID
		return tx.Create(session).Error
	})
	return session, err
}

func (store *Store) Session(ctx context.Context, uid, tokenID int64, id, permissions string) (*Session, error) {
	var session Session
	err := store.db.WithContext(ctx).Where("id = ? AND uid = ? AND token_id = ? AND expires_at > ?", id, uid, tokenID, store.now()).First(&session).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrSession
	}
	if err != nil {
		return nil, err
	}
	if session.Permissions != permissions {
		return nil, ErrSession
	}
	var device Device
	err = store.db.WithContext(ctx).Where("id = ? AND uid = ? AND revoked = ?", session.DeviceKey, uid, false).First(&device).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrRevoked
	}
	if err != nil {
		return nil, err
	}
	return &session, nil
}

func (store *Store) CloseSession(ctx context.Context, session *Session) error {
	return store.db.WithContext(ctx).Model(&Session{}).Where("id = ? AND uid = ?", session.ID, session.UID).Update("expires_at", store.now()).Error
}

func (store *Store) Devices(ctx context.Context, uid, vaultID int64) ([]Device, error) {
	devices := []Device{}
	err := store.db.WithContext(ctx).Where("uid = ? AND vault_id = ?", uid, vaultID).Order("last_seen DESC, id ASC").Find(&devices).Error
	return devices, err
}

func (store *Store) UpdateDevice(ctx context.Context, uid, vaultID int64, id string, version int64, name *string, revoke bool) error {
	updates := map[string]any{"version": gorm.Expr("version + 1")}
	if revoke {
		updates["revoked"] = true
	}
	if name != nil {
		updates["name"] = *name
	}
	return store.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&Device{}).Where("uid = ? AND vault_id = ? AND device_id = ? AND version = ?", uid, vaultID, id, version).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrConflict
		}
		if revoke {
			return tx.Model(&Session{}).Where("uid = ? AND vault_id = ? AND device_id = ?", uid, vaultID, id).Update("expires_at", store.now()).Error
		}
		return nil
	})
}

type Page struct {
	ProtocolVersion int        `json:"protocolVersion"`
	Items           []Resource `json:"items"`
	NextCursor      string     `json:"nextCursor"`
	HasMore         bool       `json:"hasMore"`
}
type Scan func(context.Context) ([]Resource, error)

func normalize(resources []Resource) ([]Resource, error) {
	if len(resources) > MaxResources {
		return nil, errors.New("sync resource limit exceeded")
	}
	result := make([]Resource, 0, len(resources))
	seen := map[string]bool{}
	for _, resource := range resources {
		if resource.Action == "delete" {
			continue
		}
		key := resource.Kind + "\x00" + resource.Path
		if seen[key] {
			return nil, errors.New("duplicate sync resource")
		}
		seen[key] = true
		resource.Action = "upsert"
		result = append(result, resource)
	}
	sort.Slice(result, func(left, right int) bool {
		if result[left].Kind != result[right].Kind {
			return result[left].Kind < result[right].Kind
		}
		return result[left].Path < result[right].Path
	})
	return result, nil
}

func delta(previous, current []Resource) []Resource {
	before := map[string]Resource{}
	for _, resource := range previous {
		before[resource.Kind+"\x00"+resource.Path] = resource
	}
	changes := []Resource{}
	for _, resource := range current {
		key := resource.Kind + "\x00" + resource.Path
		if old, ok := before[key]; !ok || old != resource {
			changes = append(changes, resource)
		}
		delete(before, key)
	}
	for _, resource := range before {
		resource.Action = "delete"
		changes = append(changes, resource)
	}
	sort.Slice(changes, func(left, right int) bool {
		if changes[left].Kind != changes[right].Kind {
			return changes[left].Kind < changes[right].Kind
		}
		return changes[left].Path < changes[right].Path
	})
	return changes
}

func (store *Store) readBatch(ctx context.Context, sessionID, cursor string) (*batch, int, error) {
	parts := strings.Split(cursor, ":")
	if len(parts) != 3 || parts[0] != "v2" {
		return nil, 0, ErrCursor
	}
	if _, err := uuid.Parse(parts[1]); err != nil {
		return nil, 0, ErrCursor
	}
	offset, err := strconv.Atoi(parts[2])
	if err != nil || offset < 0 {
		return nil, 0, ErrCursor
	}
	var value batch
	err = store.db.WithContext(ctx).Where("id = ? AND session_id = ? AND created_at > ?", parts[1], sessionID, store.now().Add(-CursorLifetime)).First(&value).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, 0, ErrCursor
	}
	return &value, offset, err
}

func page(value *batch, offset, limit int) (*Page, error) {
	var changes []Resource
	if err := json.Unmarshal([]byte(value.Changes), &changes); err != nil {
		return nil, err
	}
	if offset > len(changes) {
		return nil, ErrCursor
	}
	end := min(offset+limit, len(changes))
	return &Page{ProtocolVersion: 2, Items: changes[offset:end], NextCursor: fmt.Sprintf("v2:%s:%d", value.ID, end), HasMore: end < len(changes)}, nil
}

func (store *Store) Snapshot(ctx context.Context, session *Session, cursor string, limit int, scan Scan) (*Page, error) {
	if limit < 1 || limit > 500 {
		return nil, errors.New("invalid page limit")
	}
	if cursor != "" {
		value, offset, err := store.readBatch(ctx, session.ID, cursor)
		if err != nil {
			return nil, err
		}
		return page(value, offset, limit)
	}
	resources, err := scan(ctx)
	if err != nil {
		return nil, err
	}
	resources, err = normalize(resources)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(resources)
	if err != nil {
		return nil, err
	}
	value := &batch{ID: uuid.NewString(), SessionID: session.ID, ParentID: uuid.NewString(), State: string(encoded), Changes: string(encoded), CreatedAt: store.now()}
	if err = store.db.WithContext(ctx).Create(value).Error; err != nil {
		return nil, err
	}
	return page(value, 0, limit)
}

func (store *Store) Changes(ctx context.Context, session *Session, cursor string, limit int, scan Scan) (*Page, error) {
	if limit < 1 || limit > 500 {
		return nil, errors.New("invalid page limit")
	}
	unlock := store.locks.Lock("feed:" + session.ID)
	defer unlock()
	previous, offset, err := store.readBatch(ctx, session.ID, cursor)
	if err != nil {
		return nil, err
	}
	remaining, err := page(previous, offset, limit)
	if err != nil {
		return nil, err
	}
	if len(remaining.Items) > 0 {
		return remaining, nil
	}
	var existing batch
	err = store.db.WithContext(ctx).Where("session_id = ? AND parent_id = ?", session.ID, previous.ID).First(&existing).Error
	if err == nil {
		if existing.CreatedAt.Before(store.now().Add(-CursorLifetime)) {
			return nil, ErrCursor
		}
		return page(&existing, 0, limit)
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	current, err := scan(ctx)
	if err != nil {
		return nil, err
	}
	current, err = normalize(current)
	if err != nil {
		return nil, err
	}
	var old []Resource
	if err = json.Unmarshal([]byte(previous.State), &old); err != nil {
		return nil, err
	}
	changes := delta(old, current)
	if len(changes) == 0 {
		return remaining, nil
	}
	stateJSON, _ := json.Marshal(current)
	changeJSON, _ := json.Marshal(changes)
	value := &batch{ID: uuid.NewString(), SessionID: session.ID, ParentID: previous.ID, State: string(stateJSON), Changes: string(changeJSON), CreatedAt: store.now()}
	result := store.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(value)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		if err = store.db.WithContext(ctx).Where("session_id = ? AND parent_id = ?", session.ID, previous.ID).First(value).Error; err != nil {
			return nil, err
		}
	}
	return page(value, 0, limit)
}

func (store *Store) Execute(ctx context.Context, session *Session, requestID string, payload any, write func() (any, error)) (json.RawMessage, error) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(encoded)
	digest := hex.EncodeToString(sum[:])
	unlock := store.locks.Lock("write:" + session.ID + ":" + requestID)
	defer unlock()
	entry := receipt{SessionID: session.ID, RequestID: requestID, Digest: digest, CreatedAt: store.now()}
	created := store.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&entry)
	if created.Error != nil {
		return nil, created.Error
	}
	if created.RowsAffected == 0 {
		if err = store.db.WithContext(ctx).Where("session_id = ? AND request_id = ?", session.ID, requestID).First(&entry).Error; err != nil {
			return nil, err
		}
		if entry.Digest != digest {
			return nil, ErrRequestReuse
		}
		if entry.Result == "" {
			return nil, ErrUncertain
		}
		return json.RawMessage(entry.Result), nil
	}
	result, err := write()
	if err != nil {
		// The operation callback returns before committing a resource conflict.
		// Remove the reservation so the client can retry the same request ID
		// after it rereads and merges the remote version.
		_ = store.db.WithContext(ctx).Where("session_id = ? AND request_id = ?", session.ID, requestID).Delete(&receipt{}).Error
		return nil, err
	}
	encoded, err = json.Marshal(result)
	if err != nil {
		return nil, err
	}
	if err = store.db.WithContext(ctx).Model(&receipt{}).Where("session_id = ? AND request_id = ?", session.ID, requestID).Update("result", string(encoded)).Error; err != nil {
		return nil, ErrUncertain
	}
	return encoded, nil
}

func (store *Store) Cleanup(ctx context.Context) error {
	return store.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("created_at < ?", store.now().Add(-CursorLifetime)).Delete(&batch{}).Error; err != nil {
			return err
		}
		if err := tx.Where("created_at < ?", store.now().Add(-SessionLifetime)).Delete(&receipt{}).Error; err != nil {
			return err
		}
		return tx.Where("expires_at < ?", store.now().Add(-SessionLifetime)).Delete(&Session{}).Error
	})
}
