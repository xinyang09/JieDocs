package model

import "time"

// AIProviderProfile stores the non-secret part of a user-owned model
// connection. Credentials are encrypted by internal/ai and are deliberately
// kept out of this model's JSON representation.
type AIProviderProfile struct {
	Key                   string    `gorm:"primaryKey;size:128" json:"-"`
	ID                    string    `gorm:"size:64;not null;uniqueIndex:idx_ai_provider_uid_id,priority:2" json:"id"`
	UID                   int64     `gorm:"not null;index;uniqueIndex:idx_ai_provider_uid_id,priority:1" json:"uid"`
	Name                  string    `gorm:"size:128;not null" json:"name"`
	Type                  string    `gorm:"size:32;not null;index" json:"type"`
	BaseURL               string    `gorm:"size:2048;not null" json:"baseUrl"`
	DefaultModel          string    `gorm:"size:256;not null" json:"defaultModel"`
	Enabled               bool      `gorm:"not null" json:"enabled"`
	Version               int       `gorm:"not null;default:1" json:"version"`
	CredentialsCiphertext string    `gorm:"type:text;not null;default:''" json:"-"`
	CreatedAt             time.Time `gorm:"not null;index" json:"createdAt"`
	UpdatedAt             time.Time `gorm:"not null" json:"updatedAt"`
}

func (AIProviderProfile) TableName() string { return "ai_provider_profile" }
