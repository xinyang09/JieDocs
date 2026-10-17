package model

import "time"

// AIRun records lifecycle and idempotency metadata without request content.
type AIRun struct {
	ID             string    `gorm:"primaryKey;size:128" json:"id"`
	UID            int64     `gorm:"not null;uniqueIndex:idx_ai_run_idempotency,priority:1;index" json:"uid"`
	RequestID      string    `gorm:"size:128;not null;index" json:"requestId"`
	Route          string    `gorm:"size:128;not null;uniqueIndex:idx_ai_run_idempotency,priority:2" json:"route"`
	IdempotencyKey string    `gorm:"size:256;not null;uniqueIndex:idx_ai_run_idempotency,priority:3" json:"-"`
	RequestHash    string    `gorm:"size:128;not null" json:"-"`
	Status         string    `gorm:"size:32;not null;index" json:"status"`
	ResultJSON     string    `gorm:"type:text;not null;default:''" json:"-"`
	ErrorCode      string    `gorm:"size:128;not null;default:''" json:"errorCode,omitempty"`
	CreatedAt      time.Time `gorm:"not null;index" json:"createdAt"`
	UpdatedAt      time.Time `gorm:"not null" json:"updatedAt"`
	ExpiresAt      time.Time `gorm:"not null;index" json:"expiresAt"`
}

func (AIRun) TableName() string { return "ai_run" }

// AIUsage is a per-user UTC-day counter used for an atomic daily quota.
type AIUsage struct {
	ID        uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	UID       int64     `gorm:"not null;uniqueIndex:idx_ai_usage_uid_day,priority:1;index" json:"uid"`
	Day       string    `gorm:"size:10;not null;uniqueIndex:idx_ai_usage_uid_day,priority:2" json:"day"`
	Count     int       `gorm:"not null;default:0" json:"count"`
	CreatedAt time.Time `gorm:"not null" json:"createdAt"`
	UpdatedAt time.Time `gorm:"not null" json:"updatedAt"`
}

func (AIUsage) TableName() string { return "ai_usage" }
