package model

import "time"

// AIProposal stores only the generated patch and its optimistic-concurrency
// baseline. Input instructions and reference bodies are intentionally absent.
type AIProposal struct {
	ID               string    `gorm:"primaryKey;size:128" json:"id"`
	UID              int64     `gorm:"not null;index" json:"uid"`
	Vault            string    `gorm:"size:1024;not null;index" json:"vault"`
	Action           string    `gorm:"size:64;not null" json:"action"`
	BaseJSON         string    `gorm:"type:text;not null" json:"-"`
	OperationsJSON   string    `gorm:"type:text;not null" json:"-"`
	Summary          string    `gorm:"type:text;not null" json:"summary"`
	ConfirmTokenHash string    `gorm:"size:128;not null" json:"-"`
	Status           string    `gorm:"size:32;not null;index" json:"status"`
	ResultJSON       string    `gorm:"type:text;not null;default:''" json:"-"`
	ExpiresAt        time.Time `gorm:"not null;index" json:"expiresAt"`
	CreatedAt        time.Time `gorm:"not null;index" json:"createdAt"`
	UpdatedAt        time.Time `gorm:"not null" json:"updatedAt"`
}

func (AIProposal) TableName() string { return "ai_proposal" }
