package twofa

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type record struct {
	ID        string `gorm:"primaryKey;size:36"`
	UID       int64  `gorm:"not null;index"`
	Payload   string `gorm:"type:text;not null"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (record) TableName() string { return "twofa_accounts" }

type Account struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Account   string `json:"account"`
	Algorithm string `json:"algorithm"`
	Digits    int    `json:"digits"`
	Period    int    `json:"period"`
	Code      string `json:"code"`
	ExpiresAt int64  `json:"expiresAt"`
}

type Store struct {
	db      *gorm.DB
	keyPath string
	once    sync.Once
	aead    cipher.AEAD
	initErr error
}

func NewStore(db *gorm.DB, keyPath string) *Store {
	return &Store{db: db, keyPath: keyPath}
}

func (store *Store) initialize() error {
	store.once.Do(func() {
		store.initErr = store.open()
	})
	return store.initErr
}

func (store *Store) open() error {
	if err := store.db.AutoMigrate(&record{}); err != nil {
		return err
	}
	key, err := os.ReadFile(store.keyPath)
	if errors.Is(err, os.ErrNotExist) {
		var count int64
		if err := store.db.Model(&record{}).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return errors.New("2FA encryption key missing; restore the original key file")
		}
		if err := os.MkdirAll(filepath.Dir(store.keyPath), 0700); err != nil {
			return err
		}
		key = make([]byte, 32)
		if _, err := rand.Read(key); err != nil {
			return err
		}
		file, createErr := os.OpenFile(store.keyPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if errors.Is(createErr, os.ErrExist) {
			key, err = os.ReadFile(store.keyPath)
		} else if createErr != nil {
			return createErr
		} else {
			_, writeErr := file.Write(key)
			syncErr := file.Sync()
			closeErr := file.Close()
			if err := errors.Join(writeErr, syncErr, closeErr); err != nil {
				return err
			}
			err = nil
		}
	}
	if err != nil {
		return err
	}
	if len(key) != 32 {
		return errors.New("2FA encryption key must contain exactly 32 bytes")
	}
	if err := os.Chmod(store.keyPath, 0600); err != nil {
		return err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	store.aead, err = cipher.NewGCM(block)
	return err
}

func (store *Store) decode(entry record) (Input, error) {
	payload, err := base64.StdEncoding.DecodeString(entry.Payload)
	if err != nil || len(payload) < store.aead.NonceSize()+store.aead.Overhead() {
		return Input{}, errors.New("invalid encrypted 2FA account")
	}
	nonceSize := store.aead.NonceSize()
	plaintext, err := store.aead.Open(nil, payload[:nonceSize], payload[nonceSize:], []byte(fmt.Sprintf("twofa:v1:%d:%s", entry.UID, entry.ID)))
	if err != nil {
		return Input{}, err
	}
	var input Input
	err = json.Unmarshal(plaintext, &input)
	return input, err
}

func (store *Store) List(ctx context.Context, uid int64, now time.Time) ([]Account, error) {
	if uid <= 0 {
		return nil, ValidationError("请先登录。")
	}
	if err := store.initialize(); err != nil {
		return nil, err
	}
	var entries []record
	if err := store.db.WithContext(ctx).Where("uid = ?", uid).Order("created_at DESC, id ASC").Find(&entries).Error; err != nil {
		return nil, err
	}
	accounts := make([]Account, 0, len(entries))
	for _, entry := range entries {
		input, err := store.decode(entry)
		if err != nil {
			return nil, err
		}
		code, expiresAt, err := Generate(input, now)
		if err != nil {
			return nil, err
		}
		accounts = append(accounts, Account{ID: entry.ID, Name: input.Name, Account: input.Account, Algorithm: input.Algorithm, Digits: input.Digits, Period: input.Period, Code: code, ExpiresAt: expiresAt})
	}
	return accounts, nil
}

func (store *Store) Save(ctx context.Context, uid int64, id string, input Input) (string, error) {
	if uid <= 0 {
		return "", ValidationError("请先登录。")
	}
	if err := store.initialize(); err != nil {
		return "", err
	}
	entry := record{ID: uuid.NewString(), UID: uid}
	if id != "" {
		if err := store.db.WithContext(ctx).Where("id = ? AND uid = ?", id, uid).First(&entry).Error; err != nil {
			return "", err
		}
		if input.Secret == "" {
			previous, err := store.decode(entry)
			if err != nil {
				return "", err
			}
			input.Secret = previous.Secret
		}
	}
	input, err := Normalize(input)
	if err != nil {
		return "", err
	}
	plaintext, err := json.Marshal(input)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, store.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	payload := store.aead.Seal(nonce, nonce, plaintext, []byte(fmt.Sprintf("twofa:v1:%d:%s", uid, entry.ID)))
	entry.Payload = base64.StdEncoding.EncodeToString(payload)
	if id == "" {
		err = store.db.WithContext(ctx).Create(&entry).Error
	} else {
		result := store.db.WithContext(ctx).Model(&record{}).Where("id = ? AND uid = ?", id, uid).Updates(map[string]any{"payload": entry.Payload, "updated_at": time.Now()})
		err = result.Error
		if err == nil && result.RowsAffected == 0 {
			err = gorm.ErrRecordNotFound
		}
	}
	return entry.ID, err
}

func (store *Store) Delete(ctx context.Context, uid int64, id string) error {
	if uid <= 0 {
		return ValidationError("请先登录。")
	}
	if err := store.initialize(); err != nil {
		return err
	}
	result := store.db.WithContext(ctx).Where("id = ? AND uid = ?", id, uid).Delete(&record{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
