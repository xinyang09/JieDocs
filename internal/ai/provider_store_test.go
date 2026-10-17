package ai

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/haierkeys/fast-note-sync-service/internal/model"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newProviderStoreTest(t *testing.T) (*ProviderStore, *gorm.DB, string) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	keyPath := filepath.Join(t.TempDir(), ".ai.key")
	return NewProviderStore(db, keyPath), db, keyPath
}

func validProviderInput(apiKey string) ProviderInput {
	return ProviderInput{ID: "openai-main", Name: "我的模型", Type: ProviderTypeOpenAICompatible, BaseURL: "https://api.example.test/v1", DefaultModel: "gpt-test", APIKey: apiKey}
}

func TestProviderStoreEncryptsAndIsolatesCredentials(t *testing.T) {
	store, db, _ := newProviderStoreTest(t)
	created, err := store.Create(context.Background(), 7, validProviderInput("sk-secret-value"))
	require.NoError(t, err)
	require.True(t, created.HasAPIKey)
	require.Equal(t, 1, created.Version)

	var row model.AIProviderProfile
	require.NoError(t, db.First(&row).Error)
	require.NotContains(t, row.CredentialsCiphertext, "sk-secret-value")
	require.NotContains(t, row.CredentialsCiphertext, "secret")

	_, err = store.Resolve(context.Background(), 8, created.ID)
	require.ErrorIs(t, err, ErrProviderNotFound)
	resolved, err := store.Resolve(context.Background(), 7, created.ID)
	require.NoError(t, err)
	require.Equal(t, "sk-secret-value", resolved.APIKey)
	profiles, err := store.List(context.Background(), 7)
	require.NoError(t, err)
	require.Len(t, profiles, 1)
	// The public projection deliberately has only a boolean secret status.
	encoded, err := json.Marshal(profiles[0])
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "sk-secret-value")
}

func TestProviderStoreUpdateKeepsKeyAndUsesCAS(t *testing.T) {
	store, _, _ := newProviderStoreTest(t)
	created, err := store.Create(context.Background(), 7, validProviderInput("sk-old"))
	require.NoError(t, err)

	input := validProviderInput("")
	input.ID = created.ID
	input.Version = created.Version
	input.DefaultModel = "gpt-next"
	updated, err := store.Update(context.Background(), 7, created.ID, input)
	require.NoError(t, err)
	require.Equal(t, 2, updated.Version)
	resolved, err := store.Resolve(context.Background(), 7, created.ID)
	require.NoError(t, err)
	require.Equal(t, "sk-old", resolved.APIKey)

	input.Version = created.Version
	_, err = store.Update(context.Background(), 7, created.ID, input)
	require.ErrorIs(t, err, ErrProviderConflict)
	require.ErrorIs(t, store.Delete(context.Background(), 7, created.ID, created.Version), ErrProviderConflict)
	require.NoError(t, store.Delete(context.Background(), 7, created.ID, updated.Version))
}

func TestProviderStoreMissingKeyFailsClosed(t *testing.T) {
	store, db, keyPath := newProviderStoreTest(t)
	_, err := store.Create(context.Background(), 7, validProviderInput("sk-secret"))
	require.NoError(t, err)
	require.NoError(t, os.Remove(keyPath))

	// A fresh store must not silently generate a new key over encrypted data.
	missing := NewProviderStore(db, keyPath)
	_, err = missing.List(context.Background(), 7)
	require.Error(t, err)
	require.False(t, errors.Is(err, ErrProviderInvalid))
}
