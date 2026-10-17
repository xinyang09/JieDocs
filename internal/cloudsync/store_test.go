package cloudsync

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func newStoreTest(t *testing.T) *Store {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:cloud-sync-"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	store, err := NewStore(db)
	require.NoError(t, err)
	t.Cleanup(func() { sqlDB, _ := db.DB(); _ = sqlDB.Close() })
	return store
}

func TestStoreSessionRevocationAndPermissionBinding(t *testing.T) {
	store := newStoreTest(t)
	ctx := context.Background()
	session, err := store.CreateSession(ctx, 7, 11, 3, "laptop", "Docs", "desktop", "1.0.0", "permissions-a")
	require.NoError(t, err)
	require.NotEmpty(t, session.ID)
	_, err = store.Session(ctx, 7, 11, session.ID, "permissions-b")
	require.ErrorIs(t, err, ErrSession)
	active, err := store.Session(ctx, 7, 11, session.ID, "permissions-a")
	require.NoError(t, err)
	require.Equal(t, session.ID, active.ID)
	require.NoError(t, store.UpdateDevice(ctx, 7, 3, "laptop", 1, nil, true))
	_, err = store.Session(ctx, 7, 11, session.ID, "permissions-a")
	require.Error(t, err)
	require.True(t, errors.Is(err, ErrRevoked) || errors.Is(err, ErrSession))
}

func TestStoreExecuteCachesOnlyMatchingRequestPayload(t *testing.T) {
	store := newStoreTest(t)
	session, err := store.CreateSession(context.Background(), 7, 11, 3, "laptop", "Docs", "desktop", "1.0.0", "permissions")
	require.NoError(t, err)
	var writes atomic.Int32
	payload := map[string]any{"path": "a.md", "content": "one"}
	write := func() (any, error) { writes.Add(1); return map[string]any{"version": 2}, nil }
	first, err := store.Execute(context.Background(), session, "request-1", payload, write)
	require.NoError(t, err)
	second, err := store.Execute(context.Background(), session, "request-1", payload, write)
	require.NoError(t, err)
	require.Equal(t, string(first), string(second))
	require.Equal(t, int32(1), writes.Load())
	_, err = store.Execute(context.Background(), session, "request-1", map[string]any{"path": "a.md", "content": "two"}, write)
	require.ErrorIs(t, err, ErrRequestReuse)
}

func TestStoreExecuteAllowsRetryAfterRejectedWrite(t *testing.T) {
	store := newStoreTest(t)
	session, err := store.CreateSession(context.Background(), 7, 11, 3, "laptop", "Docs", "desktop", "1.0.0", "permissions")
	require.NoError(t, err)
	var attempts atomic.Int32
	write := func() (any, error) {
		if attempts.Add(1) == 1 {
			return nil, ErrConflict
		}
		return map[string]any{"ok": true}, nil
	}
	_, err = store.Execute(context.Background(), session, "retry-me", map[string]any{"path": "a.md"}, write)
	require.ErrorIs(t, err, ErrConflict)
	result, err := store.Execute(context.Background(), session, "retry-me", map[string]any{"path": "a.md"}, write)
	require.NoError(t, err)
	require.JSONEq(t, `{"ok":true}`, string(result))
}

func TestStoreSnapshotCursorAndChanges(t *testing.T) {
	store := newStoreTest(t)
	session, err := store.CreateSession(context.Background(), 7, 11, 3, "laptop", "Docs", "desktop", "1.0.0", "permissions")
	require.NoError(t, err)
	resources := []Resource{{Kind: "note", Action: "upsert", Path: "a.md", PathHash: "a", ContentHash: "1", Version: 1}}
	scan := func(context.Context) ([]Resource, error) { return append([]Resource(nil), resources...), nil }
	snapshot, err := store.Snapshot(context.Background(), session, "", 10, scan)
	require.NoError(t, err)
	require.Len(t, snapshot.Items, 1)
	resources[0].ContentHash = "2"
	changes, err := store.Changes(context.Background(), session, snapshot.NextCursor, 10, scan)
	require.NoError(t, err)
	require.Len(t, changes.Items, 1)
	require.Equal(t, "2", changes.Items[0].ContentHash)
	_, err = store.Changes(context.Background(), session, "v2:not-a-uuid:0", 10, scan)
	require.ErrorIs(t, err, ErrCursor)
	store.now = func() time.Time { return time.Now().Add(CursorLifetime + time.Hour) }
	_, err = store.Changes(context.Background(), session, snapshot.NextCursor, 10, scan)
	require.ErrorIs(t, err, ErrCursor)
}

func TestNormalizeRejectsDuplicatePaths(t *testing.T) {
	_, err := normalize([]Resource{{Kind: "note", Path: "a.md"}, {Kind: "note", Path: "a.md"}})
	require.Error(t, err)
	require.False(t, errors.Is(err, ErrCursor))
}
