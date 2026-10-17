package upgrade

import (
	"context"
	"fmt"
	"strconv"

	"github.com/haierkeys/fast-note-sync-service/internal/model"
	"gorm.io/gorm"
)

// AISchemaMigrate creates the durable AI request, quota, proposal and audit
// tables. It is rerunnable because GORM's AutoMigrate only adds missing
// columns/indexes. User databases are migrated individually when the DAO is
// available; the supplied db is also migrated for single-database installs.
type AISchemaMigrate struct{}

func (m *AISchemaMigrate) Version() string { return "3.6.0" }
func (m *AISchemaMigrate) Description() string {
	return "Create durable AI runs, quotas, proposals and metadata-only audits"
}

// AIProviderSchemaMigrate adds the user-owned model connection table. Secrets
// remain encrypted by internal/ai and are never part of the migration payload.
type AIProviderSchemaMigrate struct{}

func (m *AIProviderSchemaMigrate) Version() string { return "3.6.1" }
func (m *AIProviderSchemaMigrate) Description() string {
	return "Create user-owned AI provider profiles"
}

func (m *AIProviderSchemaMigrate) Up(db *gorm.DB, ctx context.Context, mc *MigrationContext) error {
	if db == nil {
		return fmt.Errorf("database is nil")
	}
	if err := db.WithContext(ctx).AutoMigrate(&model.AIProviderProfile{}); err != nil {
		return fmt.Errorf("migrate AI provider table: %w", err)
	}
	if mc == nil || mc.Dao == nil {
		return nil
	}
	uids, err := mc.Dao.GetAllUserUIDs()
	if err != nil {
		return fmt.Errorf("list user IDs: %w", err)
	}
	for _, uid := range uids {
		userDB := mc.Dao.ResolveDB("user_" + strconv.FormatInt(uid, 10))
		if userDB == nil {
			continue
		}
		if err := userDB.WithContext(ctx).AutoMigrate(&model.AIProviderProfile{}); err != nil {
			return fmt.Errorf("migrate AI provider table for uid %d: %w", uid, err)
		}
	}
	return nil
}

func (m *AISchemaMigrate) Up(db *gorm.DB, ctx context.Context, mc *MigrationContext) error {
	if db == nil {
		return fmt.Errorf("database is nil")
	}
	models := []interface{}{&model.AIRun{}, &model.AIUsage{}, &model.AIProposal{}, &model.AIRequestAudit{}}
	if err := db.WithContext(ctx).AutoMigrate(models...); err != nil {
		return fmt.Errorf("migrate AI tables: %w", err)
	}
	if mc == nil || mc.Dao == nil {
		return nil
	}
	uids, err := mc.Dao.GetAllUserUIDs()
	if err != nil {
		return fmt.Errorf("list user IDs: %w", err)
	}
	for _, uid := range uids {
		userDB := mc.Dao.ResolveDB("user_" + strconv.FormatInt(uid, 10))
		if userDB == nil {
			continue
		}
		if err := userDB.WithContext(ctx).AutoMigrate(models...); err != nil {
			return fmt.Errorf("migrate AI tables for uid %d: %w", uid, err)
		}
	}
	return nil
}
