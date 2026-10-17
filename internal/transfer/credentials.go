package transfer

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gorm.io/gorm"
)

type credentialStore struct {
	aead cipher.AEAD
}

func newCredentialStore(db *gorm.DB, keyPath string) (*credentialStore, error) {
	keyPath = strings.TrimSpace(keyPath)
	if keyPath == "" {
		return nil, errors.New("transfer credential key path is required")
	}
	key, err := os.ReadFile(keyPath)
	if errors.Is(err, os.ErrNotExist) {
		var encryptedCount int64
		if err := db.Model(&profileRecord{}).Where("credentials_json <> ''").Count(&encryptedCount).Error; err != nil {
			return nil, err
		}
		if encryptedCount > 0 {
			return nil, errors.New("transfer encryption key missing; restore the original key file")
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
		return nil, errors.New("transfer encryption key must contain exactly 32 bytes")
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
	return &credentialStore{aead: aead}, nil
}

func (store *credentialStore) encode(uid int64, id string, values map[string]string) (string, error) {
	if len(values) == 0 {
		return "", nil
	}
	plaintext, err := json.Marshal(values)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, store.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	payload := store.aead.Seal(nonce, nonce, plaintext, credentialAAD(uid, id))
	return base64.StdEncoding.EncodeToString(payload), nil
}

func (store *credentialStore) decode(uid int64, id, encoded string) (map[string]string, error) {
	if strings.TrimSpace(encoded) == "" {
		return map[string]string{}, nil
	}
	payload, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(payload) < store.aead.NonceSize()+store.aead.Overhead() {
		return nil, errors.New("invalid encrypted transfer credentials")
	}
	nonceSize := store.aead.NonceSize()
	plaintext, err := store.aead.Open(nil, payload[:nonceSize], payload[nonceSize:], credentialAAD(uid, id))
	if err != nil {
		return nil, err
	}
	var values map[string]string
	if err := json.Unmarshal(plaintext, &values); err != nil {
		return nil, err
	}
	return normalizeCredentials(values), nil
}

func credentialAAD(uid int64, id string) []byte {
	return []byte(fmt.Sprintf("transfer:v1:%d:%s", uid, id))
}
