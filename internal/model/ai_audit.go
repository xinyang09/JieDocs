package model

import "time"

// AIRequestAudit is deliberately metadata-only. Prompt text, note bodies,
// skills and model credentials must never be persisted here.
type AIRequestAudit struct {
	ID             uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	RequestID      string    `gorm:"size:128;not null;index" json:"requestId"`
	UID            int64     `gorm:"not null;index" json:"uid"`
	Vault          string    `gorm:"size:1024;not null;index" json:"vault"`
	Action         string    `gorm:"size:64;not null" json:"action"`
	Status         string    `gorm:"size:32;not null" json:"status"`
	DurationMs     int64     `gorm:"not null;default:0" json:"durationMs"`
	ErrorCode      string    `gorm:"size:128;not null;default:''" json:"errorCode,omitempty"`
	IdempotencyKey string    `gorm:"size:256;not null;index" json:"-"`
	CreatedAt      time.Time `gorm:"not null;index" json:"createdAt"`
}

func (AIRequestAudit) TableName() string { return "ai_request_audit" }
