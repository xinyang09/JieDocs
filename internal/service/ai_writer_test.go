package service

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/haierkeys/fast-note-sync-service/internal/ai"
	"github.com/haierkeys/fast-note-sync-service/internal/domain"
	"github.com/haierkeys/fast-note-sync-service/internal/dto"
	"github.com/haierkeys/fast-note-sync-service/pkg/util"
)

func TestApplyAIRangeUsesUTF16Offsets(t *testing.T) {
	content := "A😀B"
	got, err := applyAIRange(content, ai.PatchOperation{Op: "replace-range", Start: 1, End: 3, Text: "X"})
	if err != nil {
		t.Fatalf("applyAIRange() error = %v", err)
	}
	if got != "AXB" {
		t.Fatalf("applyAIRange() = %q, want %q", got, "AXB")
	}

	got, err = applyAIRange(content, ai.PatchOperation{Op: "insert", At: 3, Text: "X"})
	if err != nil {
		t.Fatalf("applyAIRange(insert) error = %v", err)
	}
	if got != "A😀XB" {
		t.Fatalf("applyAIRange(insert) = %q, want %q", got, "A😀XB")
	}

	if _, err = applyAIRange(content, ai.PatchOperation{Op: "replace-range", Start: 1, End: 2, Text: "X"}); !errors.Is(err, ai.ErrProposalConflict) {
		t.Fatalf("splitting a surrogate pair error = %v, want ErrProposalConflict", err)
	}
}

func TestApplyAIRangeNormalizesOffsetsAndPreservesCRLF(t *testing.T) {
	got, err := applyAIRange("a\r\nold\r\nkeep", ai.PatchOperation{Op: "replace-range", Start: 2, End: 5, Text: "new"})
	if err != nil {
		t.Fatalf("applyAIRange() error = %v", err)
	}
	if got != "a\r\nnew\r\nkeep" {
		t.Fatalf("applyAIRange() = %q, want CRLF-preserving replacement", got)
	}
}

func TestAIProposalWriterRejectsStaleHashOrVersion(t *testing.T) {
	for _, tc := range []struct {
		name        string
		contentHash string
		version     int
	}{
		{name: "hash", contentHash: "different", version: 3},
		{name: "version", contentHash: util.EncodeHash32("old"), version: 4},
	} {
		t.Run(tc.name, func(t *testing.T) {
			getCalls := 0
			notes := &noteServiceStub{getFn: func(context.Context, int64, *dto.NoteGetRequest) (*dto.NoteDTO, error) {
				getCalls++
				return &dto.NoteDTO{Path: "note.md", Content: "old", ContentHash: tc.contentHash, Version: int64(tc.version)}, nil
			}}

			writer := NewAIProposalWriter(notes)
			proposal := ai.Proposal{ID: "stale-" + tc.name, Operations: []ai.PatchOperation{{Op: "replace-range", Start: 0, End: 3, Text: "new"}}}
			target := []ai.ProposalBase{{Vault: "main", Path: "note.md", ContentHash: util.EncodeHash32("old"), Version: 3}}
			_, err := writer.CommitProposalTargets(context.Background(), 7, proposal, target)
			if !errors.Is(err, ai.ErrProposalConflict) {
				t.Fatalf("CommitProposalTargets() error = %v, want ErrProposalConflict", err)
			}
			if getCalls != 1 {
				t.Fatalf("Get calls = %d, want 1", getCalls)
			}
		})
	}
}

func TestAIProposalWriterCreateAndUndo(t *testing.T) {
	created := &dto.NoteDTO{Path: "new.md", Content: "created", ContentHash: util.EncodeHash32("created"), Version: 1}
	var modifyCalls, deleteCalls int
	notes := &noteServiceStub{
		modifyFn: func(_ context.Context, _ int64, params *dto.NoteModifyOrCreateRequest, _ bool, _ ...*domain.Note) (bool, *dto.NoteDTO, error) {
			modifyCalls++
			if params.Vault != "main" || params.Path != "new.md" || params.Content != "created" || !params.CreateOnly || params.ContentHash != util.EncodeHash32("created") {
				t.Errorf("unexpected create params: %#v", params)
			}
			return true, created, nil
		},
		deleteFn: func(_ context.Context, _ int64, params *dto.NoteDeleteRequest) (*dto.NoteDTO, error) {
			deleteCalls++
			if params.Vault != "main" || params.Path != "new.md" || params.PathHash != util.EncodeHash32("new.md") {
				t.Errorf("unexpected delete params: %#v", params)
			}
			return created, nil
		},
	}

	writer := NewAIProposalWriter(notes)
	proposal := ai.Proposal{ID: "create-1", Action: "create-note", Operations: []ai.PatchOperation{{Op: "create-note", Path: "new.md", Text: "created"}}}
	target := []ai.ProposalBase{{Vault: "main", Path: "new.md", ContentHash: "new", Version: 0}}
	result, err := writer.CommitProposalTargets(context.Background(), 7, proposal, target)
	if err != nil || result != "new.md" {
		t.Fatalf("CommitProposalTargets() = %q, %v", result, err)
	}
	result, err = writer.UndoProposal(context.Background(), 7, proposal)
	if err != nil || result != "new.md" {
		t.Fatalf("UndoProposal() = %q, %v", result, err)
	}
	if modifyCalls != 1 || deleteCalls != 1 {
		t.Fatalf("modify calls = %d, delete calls = %d, want one each", modifyCalls, deleteCalls)
	}
}

func TestAIProposalWriterCommitAndUndo(t *testing.T) {
	old := &dto.NoteDTO{Path: "note.md", Content: "old", ContentHash: util.EncodeHash32("old"), Version: 3, Ctime: 10}
	updated := &dto.NoteDTO{Path: "note.md", Content: "new", ContentHash: util.EncodeHash32("new"), Version: 4, Ctime: 10}
	getCalls, modifyCalls := 0, 0
	notes := &noteServiceStub{
		getFn: func(context.Context, int64, *dto.NoteGetRequest) (*dto.NoteDTO, error) {
			getCalls++
			if getCalls == 1 {
				return old, nil
			}
			return updated, nil
		},
		modifyFn: func(_ context.Context, _ int64, params *dto.NoteModifyOrCreateRequest, _ bool, _ ...*domain.Note) (bool, *dto.NoteDTO, error) {
			modifyCalls++
			if modifyCalls == 1 {
				if params.Content != "new" || params.ContentHash != util.EncodeHash32("new") || params.Ctime != old.Ctime {
					t.Errorf("unexpected commit params: %#v", params)
				}
				return true, updated, nil
			}
			if params.Content != "old" || params.ContentHash != util.EncodeHash32("old") || params.Ctime != old.Ctime {
				t.Errorf("unexpected undo params: %#v", params)
			}
			return true, old, nil
		},
	}

	writer := NewAIProposalWriter(notes)
	proposal := ai.Proposal{ID: "rewrite-1", Action: "rewrite", Operations: []ai.PatchOperation{{Op: "replace-range", Start: 0, End: 3, Text: "new"}}}
	target := []ai.ProposalBase{{Vault: "main", Path: "note.md", ContentHash: old.ContentHash, Version: 3}}
	if _, err := writer.CommitProposalTargets(context.Background(), 7, proposal, target); err != nil {
		t.Fatalf("CommitProposalTargets() error = %v", err)
	}
	if _, err := writer.UndoProposal(context.Background(), 7, proposal); err != nil {
		t.Fatalf("UndoProposal() error = %v", err)
	}
	if getCalls != 2 || modifyCalls != 2 {
		t.Fatalf("get calls = %d, modify calls = %d, want two each", getCalls, modifyCalls)
	}
}

func TestAIProposalWriterUsesConditionalWriteForCommitAndUndo(t *testing.T) {
	old := &dto.NoteDTO{Path: "note.md", Content: "old", ContentHash: util.EncodeHash32("old"), Version: 3, Ctime: 10}
	updated := &dto.NoteDTO{Path: "note.md", Content: "new", ContentHash: util.EncodeHash32("new"), Version: 4, Ctime: 10}
	getCalls, casCalls := 0, 0
	notes := &conditionalNoteService{
		noteServiceStub: &noteServiceStub{getFn: func(context.Context, int64, *dto.NoteGetRequest) (*dto.NoteDTO, error) {
			getCalls++
			if getCalls == 1 {
				return old, nil
			}
			return updated, nil
		}},
		casFn: func(_ context.Context, _ int64, params *dto.NoteModifyOrCreateRequest, expectedVersion int64, expectedHash string) (bool, *dto.NoteDTO, error) {
			casCalls++
			if casCalls == 1 {
				if expectedVersion != 3 || expectedHash != old.ContentHash || params.Content != "new" {
					t.Errorf("unexpected commit CAS: version=%d hash=%q params=%#v", expectedVersion, expectedHash, params)
				}
				return true, updated, nil
			}
			if expectedVersion != 4 || expectedHash != updated.ContentHash || params.Content != "old" {
				t.Errorf("unexpected undo CAS: version=%d hash=%q params=%#v", expectedVersion, expectedHash, params)
			}
			return true, old, nil
		},
	}

	writer := NewAIProposalWriter(notes)
	proposal := ai.Proposal{ID: "rewrite-cas", Action: "rewrite", Operations: []ai.PatchOperation{{Op: "replace-range", Start: 0, End: 3, Text: "new"}}}
	target := []ai.ProposalBase{{Vault: "main", Path: "note.md", ContentHash: old.ContentHash, Version: 3}}
	if _, err := writer.CommitProposalTargets(context.Background(), 7, proposal, target); err != nil {
		t.Fatalf("CommitProposalTargets() error = %v", err)
	}
	if _, err := writer.UndoProposal(context.Background(), 7, proposal); err != nil {
		t.Fatalf("UndoProposal() error = %v", err)
	}
	if getCalls != 2 || casCalls != 2 {
		t.Fatalf("get calls = %d, CAS calls = %d, want two each", getCalls, casCalls)
	}
}

func TestAIProposalWriterUsesConditionalDelete(t *testing.T) {
	var calls int
	old := &dto.NoteDTO{Path: "note.md", Content: "old", ContentHash: util.EncodeHash32("old"), Version: 3}
	notes := &conditionalDeleteNoteService{
		noteServiceStub: &noteServiceStub{getFn: func(context.Context, int64, *dto.NoteGetRequest) (*dto.NoteDTO, error) {
			return old, nil
		}, deleteFn: func(context.Context, int64, *dto.NoteDeleteRequest) (*dto.NoteDTO, error) {
			t.Fatal("writer used an unconditional delete")
			return nil, nil
		}},
		casDeleteFn: func(_ context.Context, _ int64, params *dto.NoteDeleteRequest, expectedVersion int64, expectedHash string) (*dto.NoteDTO, error) {
			calls++
			if params.Path != "note.md" || expectedVersion != 3 || expectedHash != old.ContentHash {
				t.Errorf("unexpected conditional delete: params=%#v version=%d hash=%q", params, expectedVersion, expectedHash)
			}
			return old, nil
		},
	}

	writer := NewAIProposalWriter(notes)
	proposal := ai.Proposal{ID: "delete-cas", Action: "delete-note", Operations: []ai.PatchOperation{{Op: "move-to-trash", Path: "note.md"}}}
	target := []ai.ProposalBase{{Vault: "main", Path: "note.md", ContentHash: old.ContentHash, Version: 3}}
	if _, err := writer.CommitProposalTargets(context.Background(), 7, proposal, target); err != nil {
		t.Fatalf("CommitProposalTargets() error = %v", err)
	}
	if calls != 1 {
		t.Fatalf("conditional delete calls = %d, want 1", calls)
	}
}

// noteServiceStub embeds the interface so tests only need to implement the
// methods used by aiProposalWriter.
type noteServiceStub struct {
	NoteService
	getFn    func(context.Context, int64, *dto.NoteGetRequest) (*dto.NoteDTO, error)
	modifyFn func(context.Context, int64, *dto.NoteModifyOrCreateRequest, bool, ...*domain.Note) (bool, *dto.NoteDTO, error)
	deleteFn func(context.Context, int64, *dto.NoteDeleteRequest) (*dto.NoteDTO, error)
}

type conditionalNoteService struct {
	*noteServiceStub
	casFn func(context.Context, int64, *dto.NoteModifyOrCreateRequest, int64, string) (bool, *dto.NoteDTO, error)
}

func (s *conditionalNoteService) ModifyOrCreateIfVersion(ctx context.Context, uid int64, params *dto.NoteModifyOrCreateRequest, expectedVersion int64, expectedHash string) (bool, *dto.NoteDTO, error) {
	return s.casFn(ctx, uid, params, expectedVersion, expectedHash)
}

type conditionalDeleteNoteService struct {
	*noteServiceStub
	casDeleteFn func(context.Context, int64, *dto.NoteDeleteRequest, int64, string) (*dto.NoteDTO, error)
}

func (s *conditionalDeleteNoteService) DeleteIfVersion(ctx context.Context, uid int64, params *dto.NoteDeleteRequest, expectedVersion int64, expectedHash string) (*dto.NoteDTO, error) {
	return s.casDeleteFn(ctx, uid, params, expectedVersion, expectedHash)
}

func (s *noteServiceStub) Get(ctx context.Context, uid int64, params *dto.NoteGetRequest) (*dto.NoteDTO, error) {
	return s.getFn(ctx, uid, params)
}

func (s *noteServiceStub) ModifyOrCreate(ctx context.Context, uid int64, params *dto.NoteModifyOrCreateRequest, mtimeCheck bool, existing ...*domain.Note) (bool, *dto.NoteDTO, error) {
	return s.modifyFn(ctx, uid, params, mtimeCheck, existing...)
}

func (s *noteServiceStub) Delete(ctx context.Context, uid int64, params *dto.NoteDeleteRequest) (*dto.NoteDTO, error) {
	return s.deleteFn(ctx, uid, params)
}

// concurrentNoteService keeps the current note in memory and lets the test
// verify that the writer's per-target lock causes one of two stale commits to
// win while the other observes the new hash/version.
type concurrentNoteService struct {
	NoteService
	mu     sync.Mutex
	note   dto.NoteDTO
	writes int
}

func (s *concurrentNoteService) Get(context.Context, int64, *dto.NoteGetRequest) (*dto.NoteDTO, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	note := s.note
	return &note, nil
}

func (s *concurrentNoteService) ModifyOrCreate(_ context.Context, _ int64, params *dto.NoteModifyOrCreateRequest, _ bool, _ ...*domain.Note) (bool, *dto.NoteDTO, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.writes++
	s.note.Content = params.Content
	s.note.ContentHash = params.ContentHash
	s.note.Version++
	note := s.note
	return true, &note, nil
}

func TestAIProposalWriterSerializesConcurrentStaleCommits(t *testing.T) {
	notes := &concurrentNoteService{note: dto.NoteDTO{Path: "note.md", Content: "old", ContentHash: util.EncodeHash32("old"), Version: 1}}
	writer := NewAIProposalWriter(notes)
	target := []ai.ProposalBase{{Vault: "main", Path: "note.md", ContentHash: util.EncodeHash32("old"), Version: 1}}
	proposal := func(id, text string) ai.Proposal {
		return ai.Proposal{ID: id, Action: "rewrite", Operations: []ai.PatchOperation{{Op: "replace-range", Start: 0, End: 3, Text: text}}}
	}

	results := make(chan error, 2)
	var wg sync.WaitGroup
	for _, p := range []ai.Proposal{proposal("p1", "one"), proposal("p2", "two")} {
		wg.Add(1)
		go func(p ai.Proposal) {
			defer wg.Done()
			_, err := writer.CommitProposalTargets(context.Background(), 7, p, target)
			results <- err
		}(p)
	}
	wg.Wait()
	close(results)

	var successes, conflicts int
	for err := range results {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, ai.ErrProposalConflict):
			conflicts++
		default:
			t.Fatalf("unexpected concurrent commit error = %v", err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent commits: successes=%d conflicts=%d, want one each", successes, conflicts)
	}
	if notes.writes != 1 {
		t.Fatalf("writes = %d, want 1", notes.writes)
	}
}
