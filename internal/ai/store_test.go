package ai

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/haierkeys/fast-note-sync-service/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:ai-store-test?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.AIRun{}, &model.AIUsage{}, &model.AIProposal{}, &model.AIRequestAudit{}); err != nil {
		t.Fatal(err)
	}
	return NewStore(db)
}

func TestStoreIdempotencyOwnerAndHash(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	first, existing, err := s.ReserveIdempotency(ctx, 9, "execute", "k", "h", time.Hour)
	if err != nil || existing || first == nil {
		t.Fatalf("first reserve = %#v, %v, %v", first, existing, err)
	}
	second, existing, err := s.ReserveIdempotency(ctx, 9, "execute", "k", "h", time.Hour)
	if !errors.Is(err, ErrIdempotencyInFlight) || !existing || second.ID != first.ID {
		t.Fatalf("same key = %#v, %v, %v", second, existing, err)
	}
	if _, _, err := s.ReserveIdempotency(ctx, 9, "execute", "k", "different", time.Hour); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("hash mismatch = %v", err)
	}
	if _, _, err := s.ReserveIdempotency(ctx, 10, "execute", "k", "different", time.Hour); err != nil {
		t.Fatalf("different owner should reserve: %v", err)
	}
}

func TestStoreQuotaAndTerminalRun(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	run, _, err := s.ReserveIdempotency(ctx, 4, "execute", "k", "h", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.ReserveQuota(ctx, 4, now, 1, 2); err != nil {
		t.Fatal(err)
	}
	if err := s.ReserveQuota(ctx, 4, now, 1, 2); !errors.Is(err, ErrAIDailyLimit) {
		t.Fatalf("daily limit = %v", err)
	}
	if err := s.FinishRun(ctx, 4, run.ID, RunStatusCompleted, `{"status":"completed"}`, ""); err != nil {
		t.Fatal(err)
	}
	if err := s.FinishRun(ctx, 4, run.ID, RunStatusCompleted, "", ""); !errors.Is(err, ErrAIRunState) {
		t.Fatalf("terminal state = %v", err)
	}
}

func validTestProposal() Proposal {
	return Proposal{ID: "proposal-1", Action: "rewrite", Base: []ProposalBase{{Vault: "Vault", Path: "note.md", ContentHash: "hash", Version: 1}}, Operations: []PatchOperation{{Op: "replace-range", Start: 0, End: 1, Text: "new"}}, Summary: "summary", ExpiresAt: time.Now().Add(time.Hour).UTC().Format(time.RFC3339)}
}

func TestStoreProposalTokenSingleUse(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	p := validTestProposal()
	if err := s.SaveProposal(ctx, 8, p, "secret", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ClaimProposal(ctx, 8, p.ID, "wrong", time.Now()); !errors.Is(err, ErrProposalConflict) {
		t.Fatalf("wrong token = %v", err)
	}
	row, err := s.ClaimProposal(ctx, 8, p.ID, "secret", time.Now())
	if err != nil || row.Status != ProposalStatusCommitting {
		t.Fatalf("claim = %#v, %v", row, err)
	}
	if _, err := s.ClaimProposal(ctx, 8, p.ID, "secret", time.Now()); !errors.Is(err, ErrProposalState) {
		t.Fatalf("second claim = %v", err)
	}
	if err := s.FinalizeProposal(ctx, 8, p.ID, ProposalStatusCommitted, `{"ok":true}`); err != nil {
		t.Fatal(err)
	}
	if err := s.MarkProposalUndone(ctx, 8, p.ID, "undone"); err != nil {
		t.Fatal(err)
	}
	if row, err := s.GetProposal(ctx, 7, p.ID); !errors.Is(err, ErrProposalNotFound) || row != nil {
		t.Fatalf("cross-owner lookup = %#v, %v", row, err)
	}
}
