package ai

// This file contains the durable state used by the authenticated AI service.
// The store deliberately accepts protocol values and persists only bounded,
// server-produced JSON. It does not persist prompts, note bodies, or tokens.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/haierkeys/fast-note-sync-service/internal/model"
	"gorm.io/gorm"
)

var (
	ErrAIConcurrentLimit   = errors.New("AI concurrent limit exceeded")
	ErrAIDailyLimit        = errors.New("AI daily limit exceeded")
	ErrIdempotencyConflict = errors.New("AI idempotency key was used with a different request")
	ErrIdempotencyInFlight = errors.New("AI request with this idempotency key is still running")
	ErrAIResultTooLarge    = errors.New("AI result is too large")
	ErrProposalNotFound    = errors.New("AI proposal not found")
	ErrProposalExpired     = errors.New("AI proposal expired")
	ErrProposalConflict    = errors.New("AI proposal has already changed")
	ErrProposalState       = errors.New("AI proposal is not in the required state")
	ErrAIRunState          = errors.New("AI run is not in the required state")
)

const (
	RunStatusRunning   = "running"
	RunStatusCompleted = "completed"
	RunStatusFailed    = "failed"
	RunStatusCanceled  = "canceled"

	ProposalStatusPending    = "pending"
	ProposalStatusCommitting = "committing"
	ProposalStatusCommitted  = "committed"
	ProposalStatusDiscarded  = "discarded"
	ProposalStatusUndone     = "undone"
)

// Store is safe for use by concurrent requests. Transaction boundaries are
// kept in this package so callers cannot accidentally persist a half-state.
type Store struct{ db *gorm.DB }

// AIStore is the service-facing subset. Keeping the interface here lets tests
// and application wiring substitute a durable implementation without exposing
// GORM to handlers.
type AIStore interface {
	ReserveIdempotency(context.Context, int64, string, string, string, time.Duration) (*model.AIRun, bool, error)
	GetRun(context.Context, int64, string) (*model.AIRun, error)
	FinishRun(context.Context, int64, string, string, string, string) error
	CancelRun(context.Context, int64, string, string) error
	ReserveQuota(context.Context, int64, time.Time, int, int) error
	SaveProposal(context.Context, int64, Proposal, string, time.Time) error
	GetProposal(context.Context, int64, string) (*model.AIProposal, error)
	ClaimProposal(context.Context, int64, string, string, time.Time) (*model.AIProposal, error)
	FinalizeProposal(context.Context, int64, string, string, string) error
	DiscardProposal(context.Context, int64, string) error
	MarkProposalUndone(context.Context, int64, string, string) error
	SaveAudit(context.Context, RequestAudit) error
	PruneExpired(context.Context, time.Time) error
}

func NewStore(db *gorm.DB) *Store { return &Store{db: db} }

// NewAIStore is an explicit alias useful to application composition code.
func NewAIStore(db *gorm.DB) *Store { return NewStore(db) }

func (s *Store) valid() error {
	if s == nil || s.db == nil {
		return errors.New("AI store database is nil")
	}
	return nil
}

// ReserveIdempotency creates a running row. If the key already exists, the
// existing row is returned with found=true. A hash mismatch is always a hard
// error; a running row is reported separately so handlers can return 409/202.
func (s *Store) ReserveIdempotency(ctx context.Context, uid int64, route, key, requestHash string, ttl time.Duration) (*model.AIRun, bool, error) {
	if err := s.valid(); err != nil {
		return nil, false, err
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}
	if strings.TrimSpace(route) == "" || strings.TrimSpace(key) == "" || strings.TrimSpace(requestHash) == "" {
		return nil, false, errors.New("AI idempotency fields are required")
	}
	now := time.Now().UTC()
	run := &model.AIRun{ID: uuid.NewString(), UID: uid, RequestID: uuid.NewString(), Route: route, IdempotencyKey: key, RequestHash: requestHash, Status: RunStatusRunning, CreatedAt: now, UpdatedAt: now, ExpiresAt: now.Add(ttl)}
	if err := s.db.WithContext(ctx).Create(run).Error; err == nil {
		return run, false, nil
	}
	var existing model.AIRun
	if err := s.db.WithContext(ctx).Where("uid = ? AND route = ? AND idempotency_key = ?", uid, route, key).First(&existing).Error; err != nil {
		return nil, false, err
	}
	if existing.RequestHash != requestHash {
		return nil, true, ErrIdempotencyConflict
	}
	if existing.Status == RunStatusRunning && existing.ExpiresAt.After(now) {
		return &existing, true, ErrIdempotencyInFlight
	}
	if existing.Status != RunStatusRunning {
		return &existing, true, nil
	}
	// An expired running row is kept as a terminal conflict rather than being
	// silently reused by a second request with the same key.
	return &existing, true, ErrIdempotencyConflict
}

func (s *Store) GetRun(ctx context.Context, uid int64, id string) (*model.AIRun, error) {
	if err := s.valid(); err != nil {
		return nil, err
	}
	var run model.AIRun
	err := s.db.WithContext(ctx).Where("uid = ? AND id = ?", uid, id).First(&run).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, gorm.ErrRecordNotFound
	}
	return &run, err
}

func (s *Store) FinishRun(ctx context.Context, uid int64, id, status, resultJSON, errorCode string) error {
	if err := s.valid(); err != nil {
		return err
	}
	if status == "" {
		status = RunStatusCompleted
	}
	if len(resultJSON) > 2<<20 {
		return ErrAIResultTooLarge
	}
	result := s.db.WithContext(ctx).Model(&model.AIRun{}).Where("uid = ? AND id = ? AND status = ?", uid, id, RunStatusRunning).Updates(map[string]interface{}{"status": status, "result_json": resultJSON, "error_code": errorCode, "updated_at": time.Now().UTC()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrAIRunState
	}
	return nil
}

func (s *Store) CancelRun(ctx context.Context, uid int64, id, errorCode string) error {
	return s.FinishRun(ctx, uid, id, RunStatusCanceled, "", errorCode)
}

// ReserveQuota atomically accounts one request for the UTC day and checks the
// number of running rows for the user. A non-positive limit disables that
// particular guard, which is useful for deployments without a configured cap.
func (s *Store) ReserveQuota(ctx context.Context, uid int64, at time.Time, dailyLimit, concurrentLimit int) error {
	if err := s.valid(); err != nil {
		return err
	}
	if ctx == nil {
		ctx = context.Background()
	}
	day := at.UTC().Format("2006-01-02")
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if concurrentLimit > 0 {
			var running int64
			if err := tx.Model(&model.AIRun{}).Where("uid = ? AND status = ? AND expires_at > ?", uid, RunStatusRunning, time.Now().UTC()).Count(&running).Error; err != nil {
				return err
			}
			// The idempotency row for the request is created immediately before
			// this reservation, so the count includes the current request.
			if running > int64(concurrentLimit) {
				return ErrAIConcurrentLimit
			}
		}
		var usage model.AIUsage
		err := tx.Where("uid = ? AND day = ?", uid, day).First(&usage).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			usage = model.AIUsage{UID: uid, Day: day, Count: 0, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}
			if err = tx.Create(&usage).Error; err != nil {
				// Another transaction may have inserted the unique row. Read it
				// back and let the conditional update below decide the limit.
				if err2 := tx.Where("uid = ? AND day = ?", uid, day).First(&usage).Error; err2 != nil {
					return err
				}
			}
		} else if err != nil {
			return err
		}
		if dailyLimit > 0 && usage.Count >= dailyLimit {
			return ErrAIDailyLimit
		}
		result := tx.Model(&model.AIUsage{}).Where("uid = ? AND day = ?", uid, day).Updates(map[string]interface{}{"count": gorm.Expr("count + ?", 1), "updated_at": time.Now().UTC()})
		return result.Error
	})
}

// SaveProposal stores a generated proposal and only a hash of its confirmation
// token. Existing IDs are rejected so a retry cannot replace an already shown
// proposal.
func (s *Store) SaveProposal(ctx context.Context, uid int64, proposal Proposal, confirmToken string, expiresAt time.Time) error {
	if err := s.valid(); err != nil {
		return err
	}
	if err := ValidateProposal(proposal); err != nil {
		return err
	}
	if strings.TrimSpace(confirmToken) == "" {
		return errors.New("confirm token is required")
	}
	base, err := json.Marshal(proposal.Base)
	if err != nil {
		return err
	}
	ops, err := json.Marshal(proposal.Operations)
	if err != nil {
		return err
	}
	vault := ""
	if len(proposal.Base) > 0 {
		vault = proposal.Base[0].Vault
	}
	if expiresAt.IsZero() {
		expiresAt, _ = time.Parse(time.RFC3339, proposal.ExpiresAt)
	}
	now := time.Now().UTC()
	record := &model.AIProposal{ID: proposal.ID, UID: uid, Vault: vault, Action: proposal.Action, BaseJSON: string(base), OperationsJSON: string(ops), Summary: proposal.Summary, ConfirmTokenHash: hashToken(confirmToken), Status: ProposalStatusPending, ExpiresAt: expiresAt, CreatedAt: now, UpdatedAt: now}
	return s.db.WithContext(ctx).Create(record).Error
}

func (s *Store) GetProposal(ctx context.Context, uid int64, id string) (*model.AIProposal, error) {
	if err := s.valid(); err != nil {
		return nil, err
	}
	var row model.AIProposal
	err := s.db.WithContext(ctx).Where("uid = ? AND id = ?", uid, id).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrProposalNotFound
	}
	return &row, err
}

// ClaimProposal verifies the token and changes pending -> committing in one
// transaction. This is the single-use barrier for commit requests.
func (s *Store) ClaimProposal(ctx context.Context, uid int64, id, confirmToken string, now time.Time) (*model.AIProposal, error) {
	if err := s.valid(); err != nil {
		return nil, err
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	var row model.AIProposal
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("uid = ? AND id = ?", uid, id).First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrProposalNotFound
			}
			return err
		}
		if !now.Before(row.ExpiresAt) {
			return ErrProposalExpired
		}
		if row.Status != ProposalStatusPending {
			return ErrProposalState
		}
		if !equalToken(row.ConfirmTokenHash, confirmToken) {
			return ErrProposalConflict
		}
		result := tx.Model(&model.AIProposal{}).Where("uid = ? AND id = ? AND status = ?", uid, id, ProposalStatusPending).Updates(map[string]interface{}{"status": ProposalStatusCommitting, "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrProposalConflict
		}
		row.Status = ProposalStatusCommitting
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func (s *Store) FinalizeProposal(ctx context.Context, uid int64, id, status, resultJSON string) error {
	if err := s.valid(); err != nil {
		return err
	}
	if status == "" {
		status = ProposalStatusCommitted
	}
	if status != ProposalStatusPending && status != ProposalStatusCommitted && status != ProposalStatusDiscarded && status != ProposalStatusUndone {
		return ErrProposalState
	}
	if len(resultJSON) > 2<<20 {
		return ErrAIResultTooLarge
	}
	result := s.db.WithContext(ctx).Model(&model.AIProposal{}).Where("uid = ? AND id = ? AND status = ?", uid, id, ProposalStatusCommitting).Updates(map[string]interface{}{"status": status, "result_json": resultJSON, "updated_at": time.Now().UTC()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrProposalState
	}
	return nil
}

func (s *Store) DiscardProposal(ctx context.Context, uid int64, id string) error {
	if err := s.valid(); err != nil {
		return err
	}
	result := s.db.WithContext(ctx).Model(&model.AIProposal{}).Where("uid = ? AND id = ? AND status = ?", uid, id, ProposalStatusPending).Updates(map[string]interface{}{"status": ProposalStatusDiscarded, "updated_at": time.Now().UTC()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrProposalState
	}
	return nil
}

func (s *Store) MarkProposalUndone(ctx context.Context, uid int64, id, resultJSON string) error {
	if err := s.valid(); err != nil {
		return err
	}
	if len(resultJSON) > 2<<20 {
		return ErrAIResultTooLarge
	}
	result := s.db.WithContext(ctx).Model(&model.AIProposal{}).Where("uid = ? AND id = ? AND status = ?", uid, id, ProposalStatusCommitted).Updates(map[string]interface{}{"status": ProposalStatusUndone, "result_json": resultJSON, "updated_at": time.Now().UTC()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrProposalState
	}
	return nil
}

// RequestAudit is metadata only. It intentionally has no fields for input or
// output text.
type RequestAudit struct {
	RequestID      string
	UID            int64
	Vault          string
	Action         string
	Status         string
	DurationMs     int64
	ErrorCode      string
	IdempotencyKey string
	CreatedAt      time.Time
}

func (s *Store) SaveAudit(ctx context.Context, audit RequestAudit) error {
	if err := s.valid(); err != nil {
		return err
	}
	if audit.CreatedAt.IsZero() {
		audit.CreatedAt = time.Now().UTC()
	}
	return s.db.WithContext(ctx).Create(&model.AIRequestAudit{RequestID: audit.RequestID, UID: audit.UID, Vault: audit.Vault, Action: audit.Action, Status: audit.Status, DurationMs: audit.DurationMs, ErrorCode: audit.ErrorCode, IdempotencyKey: audit.IdempotencyKey, CreatedAt: audit.CreatedAt}).Error
}

func (s *Store) PruneExpired(ctx context.Context, now time.Time) error {
	if err := s.valid(); err != nil {
		return err
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if err := s.db.WithContext(ctx).Where("expires_at < ?", now).Delete(&model.AIRun{}).Error; err != nil {
		return err
	}
	return s.db.WithContext(ctx).Where("expires_at < ? AND status = ?", now, ProposalStatusPending).Delete(&model.AIProposal{}).Error
}

func hashToken(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func equalToken(hash, value string) bool { return hash != "" && hash == hashToken(value) }

// Ensure compile-time coverage when a future refactor changes the interface.
var _ AIStore = (*Store)(nil)
