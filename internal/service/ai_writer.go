package service

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"
	"unicode/utf16"

	"github.com/haierkeys/fast-note-sync-service/internal/ai"
	"github.com/haierkeys/fast-note-sync-service/internal/domain"
	"github.com/haierkeys/fast-note-sync-service/internal/dto"
	"github.com/haierkeys/fast-note-sync-service/pkg/util"
)

// NewAIProposalWriter adapts the authenticated note service to the AI
// proposal protocol. It intentionally accepts NoteService rather than a raw
// repository so normal history, link indexing and sync-log behavior is kept
// in one place.
func NewAIProposalWriter(notes NoteService) AIProposalWriter {
	return &aiProposalWriter{notes: notes, locks: make(map[string]*sync.Mutex), undo: make(map[string]aiUndoSnapshot)}
}

type aiProposalWriter struct {
	notes NoteService
	mu    sync.Mutex
	locks map[string]*sync.Mutex
	undo  map[string]aiUndoSnapshot
}

type aiUndoSnapshot struct {
	target       ai.ProposalBase
	before       string
	afterHash    string
	afterVersion int
	action       string
}

func (w *aiProposalWriter) lockFor(uid int64, target ai.ProposalBase) func() {
	key := strings.Join([]string{fmtInt(uid), target.Vault, target.Path}, "\x00")
	w.mu.Lock()
	lock := w.locks[key]
	if lock == nil {
		lock = &sync.Mutex{}
		w.locks[key] = lock
	}
	w.mu.Unlock()
	lock.Lock()
	return lock.Unlock
}

func fmtInt(v int64) string {
	// Avoid fmt in this small hot path while keeping the key unambiguous.
	if v == 0 {
		return "0"
	}
	var b [32]byte
	return string(appendInt(b[:0], v))
}

func appendInt(dst []byte, v int64) []byte {
	if v < 0 {
		dst = append(dst, '-')
		v = -v
	}
	var tmp [20]byte
	i := len(tmp)
	for v > 0 {
		i--
		tmp[i] = byte('0' + v%10)
		v /= 10
	}
	return append(dst, tmp[i:]...)
}

func (w *aiProposalWriter) CommitProposalTargets(ctx context.Context, uid int64, proposal ai.Proposal, targets []ai.ProposalBase) (string, error) {
	if w == nil || w.notes == nil || len(targets) == 0 {
		return "", ai.ErrProposalConflict
	}
	if len(proposal.Operations) == 0 {
		return "", ai.ErrProposalConflict
	}
	// The current NoteService CAS primitive is per note. Reject a compound
	// proposal until the repository can commit several notes in one database
	// transaction; otherwise a later conflict could leave earlier operations
	// partially applied.
	if len(proposal.Operations) != 1 || len(targets) != 1 {
		return "", ai.ErrProposalConflict
	}
	// A proposal currently contains one operation per target. Apply them in
	// order under per-note locks; the service itself serializes each write.
	for i, operation := range proposal.Operations {
		if i >= len(targets) && operation.Op != "create-note" {
			return "", ai.ErrProposalConflict
		}
		target := ai.ProposalBase{}
		if i < len(targets) {
			target = targets[i]
		}
		unlock := w.lockFor(uid, target)
		result, err := w.applyOperation(ctx, uid, proposal.ID, operation, target)
		unlock()
		if err != nil {
			return "", err
		}
		if result != "" {
			return result, nil
		}
	}
	return "committed", nil
}

func (w *aiProposalWriter) applyOperation(ctx context.Context, uid int64, proposalID string, op ai.PatchOperation, target ai.ProposalBase) (string, error) {
	path := target.Path
	vault := target.Vault
	if op.Op == "create-note" {
		vault, path = target.Vault, op.Path
		if vault == "" || path == "" {
			return "", ai.ErrProposalConflict
		}
		content := op.Text
		_, created, err := w.notes.ModifyOrCreate(ctx, uid, &dto.NoteModifyOrCreateRequest{
			Vault: vault, Path: path, PathHash: util.EncodeHash32(path), Content: content,
			ContentHash: util.EncodeHash32(content), Ctime: time.Now().UnixMilli(), Mtime: time.Now().UnixMilli(), CreateOnly: true,
		}, false)
		if err == nil && created != nil {
			w.mu.Lock()
			w.undo[proposalID] = aiUndoSnapshot{target: ai.ProposalBase{Vault: vault, Path: path}, action: "create-note", afterHash: created.ContentHash, afterVersion: int(created.Version)}
			w.mu.Unlock()
		}
		return path, normalizeWriterError(err)
	}
	if path == "" || vault == "" {
		return "", ai.ErrProposalConflict
	}
	note, err := w.notes.Get(ctx, uid, &dto.NoteGetRequest{Vault: vault, Path: path, PathHash: util.EncodeHash32(path)})
	if err != nil {
		return "", normalizeWriterError(err)
	}
	if note.ContentHash != target.ContentHash || int(note.Version) != target.Version {
		return "", ai.ErrProposalConflict
	}
	if op.Op == "move-to-trash" {
		deleteParams := &dto.NoteDeleteRequest{Vault: vault, Path: path, PathHash: util.EncodeHash32(path)}
		if cas, ok := w.notes.(aiCASDeleteService); ok {
			_, err = cas.DeleteIfVersion(ctx, uid, deleteParams, int64(target.Version), target.ContentHash)
		} else {
			_, err = w.notes.Delete(ctx, uid, deleteParams)
		}
		return path, normalizeWriterError(err)
	}
	content, err := applyAIRange(note.Content, op)
	if err != nil {
		return "", err
	}
	if content == note.Content {
		return path, nil
	}
	params := &dto.NoteModifyOrCreateRequest{
		Vault: vault, Path: path, PathHash: util.EncodeHash32(path), Content: content,
		ContentHash: util.EncodeHash32(content), Ctime: note.Ctime, Mtime: time.Now().UnixMilli(),
	}
	var updated *dto.NoteDTO
	if cas, ok := w.notes.(aiCASNoteService); ok {
		_, updated, err = cas.ModifyOrCreateIfVersion(ctx, uid, params, int64(target.Version), target.ContentHash)
	} else {
		_, updated, err = w.notes.ModifyOrCreate(ctx, uid, params, false)
	}
	if err == nil && updated != nil {
		w.mu.Lock()
		w.undo[proposalID] = aiUndoSnapshot{target: target, before: note.Content, afterHash: updated.ContentHash, afterVersion: int(updated.Version), action: op.Op}
		w.mu.Unlock()
	}
	return path, normalizeWriterError(err)
}

func (w *aiProposalWriter) UndoProposal(ctx context.Context, uid int64, proposal ai.Proposal) (string, error) {
	if w == nil || w.notes == nil {
		return "", ai.ErrProposalConflict
	}
	w.mu.Lock()
	snapshot, ok := w.undo[proposal.ID]
	w.mu.Unlock()
	if !ok || snapshot.action == "move-to-trash" {
		return "", ai.ErrProposalConflict
	}
	unlock := w.lockFor(uid, snapshot.target)
	defer unlock()
	if snapshot.action == "create-note" {
		deleteParams := &dto.NoteDeleteRequest{Vault: snapshot.target.Vault, Path: snapshot.target.Path, PathHash: util.EncodeHash32(snapshot.target.Path)}
		var err error
		if cas, ok := w.notes.(aiCASDeleteService); ok {
			_, err = cas.DeleteIfVersion(ctx, uid, deleteParams, int64(snapshot.afterVersion), snapshot.afterHash)
		} else {
			_, err = w.notes.Delete(ctx, uid, deleteParams)
		}
		return snapshot.target.Path, normalizeWriterError(err)
	}
	note, err := w.notes.Get(ctx, uid, &dto.NoteGetRequest{Vault: snapshot.target.Vault, Path: snapshot.target.Path, PathHash: util.EncodeHash32(snapshot.target.Path)})
	if err != nil || note.ContentHash != snapshot.afterHash || int(note.Version) != snapshot.afterVersion {
		return "", ai.ErrProposalConflict
	}
	params := &dto.NoteModifyOrCreateRequest{Vault: snapshot.target.Vault, Path: snapshot.target.Path, PathHash: util.EncodeHash32(snapshot.target.Path), Content: snapshot.before, ContentHash: util.EncodeHash32(snapshot.before), Ctime: note.Ctime, Mtime: time.Now().UnixMilli()}
	if cas, ok := w.notes.(aiCASNoteService); ok {
		_, _, err = cas.ModifyOrCreateIfVersion(ctx, uid, params, int64(snapshot.afterVersion), snapshot.afterHash)
	} else {
		_, _, err = w.notes.ModifyOrCreate(ctx, uid, params, false)
	}
	return snapshot.target.Path, normalizeWriterError(err)
}

// aiCASNoteService is implemented by the concrete NoteService. Keeping this
// capability optional preserves compatibility with lightweight test doubles
// and third-party NoteService implementations while production writes use a
// repository-level compare-and-swap.
type aiCASNoteService interface {
	ModifyOrCreateIfVersion(context.Context, int64, *dto.NoteModifyOrCreateRequest, int64, string) (bool, *dto.NoteDTO, error)
}

type aiCASDeleteService interface {
	DeleteIfVersion(context.Context, int64, *dto.NoteDeleteRequest, int64, string) (*dto.NoteDTO, error)
}

func applyAIRange(content string, op ai.PatchOperation) (string, error) {
	if op.Op != "replace-range" && op.Op != "insert" {
		return "", ai.ErrProposalConflict
	}
	original := content
	content = strings.ReplaceAll(content, "\r\n", "\n")
	runes := []rune(content)
	units := utf16.Encode(runes)
	start, end := op.Start, op.End
	if op.Op == "insert" {
		start, end = op.At, op.At
	}
	if start < 0 || end < start || end > len(units) {
		return "", ai.ErrProposalConflict
	}
	runeStart, runeEnd := utf16OffsetsToRunes(units, start, end)
	if runeStart < 0 || runeEnd < runeStart {
		return "", ai.ErrProposalConflict
	}
	updated := string(runes[:runeStart]) + op.Text + string(runes[runeEnd:])
	if strings.Contains(original, "\r\n") {
		updated = strings.ReplaceAll(updated, "\r\n", "\n")
		updated = strings.ReplaceAll(updated, "\n", "\r\n")
	}
	return updated, nil
}

func utf16OffsetsToRunes(units []uint16, start, end int) (int, int) {
	if start > len(units) || end > len(units) {
		return -1, -1
	}
	toRune := func(offset int) int {
		count, i := 0, 0
		for i < len(units) && i < offset {
			if i+1 < len(units) && utf16.IsSurrogate(rune(units[i])) && utf16.IsSurrogate(rune(units[i+1])) {
				if i+1 >= offset {
					return -1
				}
				i += 2
			} else {
				i++
			}
			count++
		}
		if i != offset {
			return -1
		}
		return count
	}
	return toRune(start), toRune(end)
}

func normalizeWriterError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, ai.ErrProposalConflict) {
		return err
	}
	if errors.Is(err, domain.ErrNoteVersionConflict) {
		return ai.ErrProposalConflict
	}
	return err
}

var _ AIProposalWriter = (*aiProposalWriter)(nil)
