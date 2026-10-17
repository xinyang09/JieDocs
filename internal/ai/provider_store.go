package ai

// This file owns user-scoped model connection metadata and the encrypted API
// key envelope. The browser can manage a profile, but it never receives the
// decrypted key and the execute protocol never accepts a key from the client.

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/haierkeys/fast-note-sync-service/internal/model"
	"gorm.io/gorm"
)

const (
	ProviderTypeOpenAICompatible = "openai-compatible"
	ProviderTypeOllama           = "ollama"
	maxProviderName              = 128
	maxProviderURL               = 2048
	maxProviderModel             = 256
	maxProviderKey               = 8192
)

var providerIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

var (
	ErrProviderExists   = errors.New("AI provider already exists")
	ErrProviderNotFound = errors.New("AI provider not found")
	ErrProviderInvalid  = errors.New("invalid AI provider")
	ErrProviderConflict = errors.New("AI provider configuration changed")
	ErrProviderDisabled = errors.New("AI provider is disabled")
	ErrProviderKey      = errors.New("AI provider credential is unavailable")
)

// ProviderProfile is safe to return to a browser. Credential values are never
// included; HasAPIKey only reports whether one is present.
type ProviderProfile struct {
	ID           string    `json:"id"`
	UID          int64     `json:"uid"`
	Name         string    `json:"name"`
	Type         string    `json:"type"`
	BaseURL      string    `json:"baseUrl"`
	DefaultModel string    `json:"defaultModel"`
	Enabled      bool      `json:"enabled"`
	HasAPIKey    bool      `json:"hasApiKey"`
	Version      int       `json:"version"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// ProviderInput is accepted by create/update handlers. APIKey is write-only.
type ProviderInput struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Type         string `json:"type"`
	BaseURL      string `json:"baseUrl"`
	DefaultModel string `json:"defaultModel"`
	Enabled      *bool  `json:"enabled"`
	APIKey       string `json:"apiKey"`
	Version      int    `json:"version"`
}

// ProviderConfig is server-only and contains the decrypted credential for one
// request. Do not put this value in a result, audit record, or log field.
type ProviderConfig struct {
	ID           string
	UID          int64
	Name         string
	Type         string
	BaseURL      string
	DefaultModel string
	Enabled      bool
	APIKey       string `json:"-"`
}

type providerCredentialStore struct{ aead cipher.AEAD }

// ProviderStore persists profiles in the main database. It is lazily opened so
// a deployment that never uses custom AI does not need a key file, while a
// deployment with existing encrypted rows fails closed if its key is missing.
type ProviderStore struct {
	db      *gorm.DB
	keyPath string
	once    sync.Once
	store   *providerCredentialStore
	initErr error
}

func NewProviderStore(db *gorm.DB, keyPath string) *ProviderStore {
	return &ProviderStore{db: db, keyPath: strings.TrimSpace(keyPath)}
}

func (s *ProviderStore) initialize() error {
	if s == nil || s.db == nil {
		return errors.New("AI provider store is not configured")
	}
	s.once.Do(func() {
		if err := s.db.AutoMigrate(&model.AIProviderProfile{}); err != nil {
			s.initErr = err
			return
		}
		if s.keyPath == "" {
			s.keyPath = ".ai.key"
		}
		s.store, s.initErr = openProviderCredentialStore(s.db, s.keyPath)
	})
	return s.initErr
}

func (s *ProviderStore) List(ctx context.Context, uid int64) ([]ProviderProfile, error) {
	if uid <= 0 {
		return nil, ErrProviderInvalid
	}
	if err := s.initialize(); err != nil {
		return nil, err
	}
	var rows []model.AIProviderProfile
	if err := s.db.WithContext(ctx).Where("uid = ?", uid).Order("name ASC, id ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	result := make([]ProviderProfile, 0, len(rows))
	for i := range rows {
		result = append(result, publicProvider(rows[i]))
	}
	return result, nil
}

func (s *ProviderStore) Create(ctx context.Context, uid int64, input ProviderInput) (ProviderProfile, error) {
	if uid <= 0 {
		return ProviderProfile{}, ErrProviderInvalid
	}
	if err := s.initialize(); err != nil {
		return ProviderProfile{}, err
	}
	normalized, err := normalizeProviderInput(input)
	if err != nil {
		return ProviderProfile{}, err
	}
	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	ciphertext, err := s.store.encode(uid, normalized.ID, normalized.APIKey)
	if err != nil {
		return ProviderProfile{}, fmt.Errorf("encrypt AI provider credential: %w", err)
	}
	now := time.Now().UTC()
	row := &model.AIProviderProfile{
		Key: fmt.Sprintf("%d:%s", uid, normalized.ID), ID: normalized.ID, UID: uid,
		Name: normalized.Name, Type: normalized.Type, BaseURL: normalized.BaseURL,
		DefaultModel: normalized.DefaultModel, Enabled: enabled,
		CredentialsCiphertext: ciphertext, Version: 1, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.db.WithContext(ctx).Create(row).Error; err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) || strings.Contains(strings.ToLower(err.Error()), "unique") {
			return ProviderProfile{}, ErrProviderExists
		}
		return ProviderProfile{}, err
	}
	return publicProvider(*row), nil
}

func (s *ProviderStore) Update(ctx context.Context, uid int64, id string, input ProviderInput) (ProviderProfile, error) {
	if uid <= 0 || !providerIDPattern.MatchString(strings.TrimSpace(id)) {
		return ProviderProfile{}, ErrProviderInvalid
	}
	if err := s.initialize(); err != nil {
		return ProviderProfile{}, err
	}
	var row model.AIProviderProfile
	if err := s.db.WithContext(ctx).Where("uid = ? AND id = ?", uid, id).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ProviderProfile{}, ErrProviderNotFound
		}
		return ProviderProfile{}, err
	}
	if input.Version <= 0 || input.Version != row.Version {
		return ProviderProfile{}, ErrProviderConflict
	}
	if input.ID == "" {
		input.ID = id
	}
	if input.ID != id {
		return ProviderProfile{}, fmt.Errorf("%w: provider id cannot be changed", ErrProviderInvalid)
	}
	normalized, err := normalizeProviderInput(input)
	if err != nil {
		return ProviderProfile{}, err
	}
	if strings.TrimSpace(normalized.APIKey) == "" {
		if row.CredentialsCiphertext != "" && (normalized.BaseURL != row.BaseURL || normalized.Type != row.Type) {
			return ProviderProfile{}, fmt.Errorf("%w: enter a new API key when changing the provider endpoint", ErrProviderInvalid)
		}
		normalized.APIKey = ""
	} else {
		row.CredentialsCiphertext, err = s.store.encode(uid, id, normalized.APIKey)
		if err != nil {
			return ProviderProfile{}, fmt.Errorf("encrypt AI provider credential: %w", err)
		}
	}
	enabled := row.Enabled
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	row.Name, row.Type, row.BaseURL, row.DefaultModel, row.Enabled = normalized.Name, normalized.Type, normalized.BaseURL, normalized.DefaultModel, enabled
	row.UpdatedAt = time.Now().UTC()
	result := s.db.WithContext(ctx).Model(&model.AIProviderProfile{}).Where("uid = ? AND id = ? AND version = ?", uid, id, input.Version).Updates(map[string]any{
		"name": row.Name, "type": row.Type, "base_url": row.BaseURL, "default_model": row.DefaultModel,
		"enabled": row.Enabled, "credentials_ciphertext": row.CredentialsCiphertext, "updated_at": row.UpdatedAt, "version": input.Version + 1,
	})
	if result.Error != nil {
		return ProviderProfile{}, result.Error
	}
	if result.RowsAffected != 1 {
		return ProviderProfile{}, ErrProviderConflict
	}
	row.Version = input.Version + 1
	return publicProvider(row), nil
}

func (s *ProviderStore) Delete(ctx context.Context, uid int64, id string, expectedVersion int) error {
	if uid <= 0 || !providerIDPattern.MatchString(strings.TrimSpace(id)) {
		return ErrProviderInvalid
	}
	if err := s.initialize(); err != nil {
		return err
	}
	if expectedVersion <= 0 {
		return ErrProviderConflict
	}
	result := s.db.WithContext(ctx).Where("uid = ? AND id = ? AND version = ?", uid, id, expectedVersion).Delete(&model.AIProviderProfile{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrProviderConflict
	}
	return nil
}

func (s *ProviderStore) Resolve(ctx context.Context, uid int64, id string) (ProviderConfig, error) {
	if uid <= 0 || !providerIDPattern.MatchString(strings.TrimSpace(id)) {
		return ProviderConfig{}, ErrProviderInvalid
	}
	if err := s.initialize(); err != nil {
		return ProviderConfig{}, err
	}
	var row model.AIProviderProfile
	if err := s.db.WithContext(ctx).Where("uid = ? AND id = ?", uid, id).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ProviderConfig{}, ErrProviderNotFound
		}
		return ProviderConfig{}, err
	}
	if !row.Enabled {
		return ProviderConfig{}, ErrProviderDisabled
	}
	apiKey, err := s.store.decode(uid, row.ID, row.CredentialsCiphertext)
	if err != nil {
		return ProviderConfig{}, fmt.Errorf("%w: %v", ErrProviderKey, err)
	}
	return ProviderConfig{ID: row.ID, UID: uid, Name: row.Name, Type: row.Type, BaseURL: row.BaseURL, DefaultModel: row.DefaultModel, Enabled: row.Enabled, APIKey: apiKey}, nil
}

func normalizeProviderInput(input ProviderInput) (ProviderInput, error) {
	input.ID = strings.TrimSpace(input.ID)
	input.Name = strings.TrimSpace(input.Name)
	input.Type = strings.ToLower(strings.TrimSpace(input.Type))
	input.BaseURL = strings.TrimRight(strings.TrimSpace(input.BaseURL), "/")
	input.DefaultModel = strings.TrimSpace(input.DefaultModel)
	input.APIKey = strings.TrimSpace(input.APIKey)
	if !providerIDPattern.MatchString(input.ID) || input.Type != ProviderTypeOpenAICompatible && input.Type != ProviderTypeOllama {
		return ProviderInput{}, ErrProviderInvalid
	}
	if input.Name == "" {
		input.Name = input.ID
	}
	if len(input.Name) > maxProviderName || len(input.BaseURL) == 0 || len(input.BaseURL) > maxProviderURL || len(input.DefaultModel) == 0 || len(input.DefaultModel) > maxProviderModel || len(input.APIKey) > maxProviderKey {
		return ProviderInput{}, ErrProviderInvalid
	}
	if strings.ContainsAny(input.APIKey+input.DefaultModel, "\r\n\x00") {
		return ProviderInput{}, ErrProviderInvalid
	}
	parsed, err := url.Parse(input.BaseURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || strings.ContainsAny(input.BaseURL, "\r\n\x00") {
		return ProviderInput{}, ErrProviderInvalid
	}
	return input, nil
}

func publicProvider(row model.AIProviderProfile) ProviderProfile {
	return ProviderProfile{ID: row.ID, UID: row.UID, Name: row.Name, Type: row.Type, BaseURL: row.BaseURL, DefaultModel: row.DefaultModel, Enabled: row.Enabled, HasAPIKey: strings.TrimSpace(row.CredentialsCiphertext) != "", Version: row.Version, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt}
}

func openProviderCredentialStore(db *gorm.DB, keyPath string) (*providerCredentialStore, error) {
	keyPath = strings.TrimSpace(keyPath)
	if keyPath == "" {
		return nil, ErrProviderKey
	}
	key, err := os.ReadFile(keyPath)
	if errors.Is(err, os.ErrNotExist) {
		var encryptedCount int64
		if err := db.Model(&model.AIProviderProfile{}).Where("credentials_ciphertext <> ''").Count(&encryptedCount).Error; err != nil {
			return nil, err
		}
		if encryptedCount > 0 {
			return nil, errors.New("AI provider encryption key missing; restore the original key file")
		}
		if err := os.MkdirAll(filepath.Dir(keyPath), 0o700); err != nil {
			return nil, err
		}
		key = make([]byte, 32)
		if _, err := rand.Read(key); err != nil {
			return nil, err
		}
		file, createErr := os.OpenFile(keyPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if errors.Is(createErr, os.ErrExist) {
			key, err = os.ReadFile(keyPath)
		} else if createErr != nil {
			return nil, createErr
		} else {
			_, writeErr := file.Write(key)
			syncErr := file.Sync()
			closeErr := file.Close()
			if err := errors.Join(writeErr, syncErr, closeErr); err != nil {
				return nil, err
			}
			err = nil
		}
	}
	if err != nil {
		return nil, err
	}
	if len(key) != 32 {
		return nil, errors.New("AI provider encryption key must contain exactly 32 bytes")
	}
	if err := os.Chmod(keyPath, 0o600); err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &providerCredentialStore{aead: aead}, nil
}

func (s *providerCredentialStore) encode(uid int64, id, value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	payload := s.aead.Seal(nonce, nonce, []byte(value), providerCredentialAAD(uid, id))
	return base64.StdEncoding.EncodeToString(payload), nil
}

func (s *providerCredentialStore) decode(uid int64, id, encoded string) (string, error) {
	if strings.TrimSpace(encoded) == "" {
		return "", nil
	}
	payload, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(payload) < s.aead.NonceSize()+s.aead.Overhead() {
		return "", errors.New("invalid encrypted AI provider credential")
	}
	nonceSize := s.aead.NonceSize()
	plaintext, err := s.aead.Open(nil, payload[:nonceSize], payload[nonceSize:], providerCredentialAAD(uid, id))
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

func providerCredentialAAD(uid int64, id string) []byte {
	return []byte(fmt.Sprintf("ai-provider:v1:%d:%s", uid, id))
}
