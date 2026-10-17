package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"path"
	"strings"
	"sync"
	"time"
	"unicode/utf16"

	"github.com/google/uuid"
	"github.com/haierkeys/fast-note-sync-service/internal/ai"
	"github.com/haierkeys/fast-note-sync-service/internal/dto"
	"github.com/haierkeys/fast-note-sync-service/internal/model"
	"github.com/haierkeys/fast-note-sync-service/pkg/app"
	"github.com/haierkeys/fast-note-sync-service/pkg/util"
)

// AIProposalWriter is the only write capability accepted by AIService.
// Implementations must compare every target's hash/version in the same write
// transaction and use NoteService for the actual mutation, history and sync.
// A nil writer is intentionally a safe read-only configuration.
type AIProposalWriter interface {
	CommitProposalTargets(context.Context, int64, ai.Proposal, []ai.ProposalBase) (string, error)
	UndoProposal(context.Context, int64, ai.Proposal) (string, error)
}

type AIServiceConfig struct {
	Executor        ai.PiExecutor
	ProviderStore   *ai.ProviderStore
	Store           ai.AIStore
	Reader          ai.NoteReader
	Writer          AIProposalWriter
	DailyLimit      int
	ConcurrentLimit int
	RunTTL          time.Duration
	ProposalTTL     time.Duration
}

type AIService struct {
	executor        ai.PiExecutor
	providerStore   *ai.ProviderStore
	store           ai.AIStore
	reader          ai.NoteReader
	writer          AIProposalWriter
	dailyLimit      int
	concurrentLimit int
	runTTL          time.Duration
	proposalTTL     time.Duration
	now             func() time.Time
	mu              sync.Mutex
	proposalTokens  map[string]string
}

func NewAIService(config AIServiceConfig) *AIService {
	if config.DailyLimit == 0 {
		config.DailyLimit = 100
	}
	if config.ConcurrentLimit == 0 {
		config.ConcurrentLimit = 2
	}
	if config.RunTTL <= 0 {
		config.RunTTL = 24 * time.Hour
	}
	if config.ProposalTTL <= 0 {
		config.ProposalTTL = 15 * time.Minute
	}
	return &AIService{executor: config.Executor, providerStore: config.ProviderStore, store: config.Store, reader: config.Reader, writer: config.Writer, dailyLimit: config.DailyLimit, concurrentLimit: config.ConcurrentLimit, runTTL: config.RunTTL, proposalTTL: config.ProposalTTL, now: func() time.Time { return time.Now().UTC() }, proposalTokens: make(map[string]string)}
}

// resolveExecutor chooses a user-owned provider when the request asks for one,
// or when the user has an enabled custom provider and leaves the model unset.
// The legacy Pi executor remains the fallback so existing installations keep
// working without any provider configuration.
func (s *AIService) resolveExecutor(ctx context.Context, uid int64, request ai.ExecuteRequest) (ai.PiExecutor, ai.ExecuteRequest, error) {
	if s.providerStore == nil {
		if s.executor == nil {
			return nil, request, errors.New("AI service is not configured")
		}
		return s.executor, request, nil
	}
	var requested *ai.ChatModel
	if request.Options != nil {
		requested = request.Options.Model
	}
	providerID := ""
	if requested != nil && strings.HasPrefix(strings.TrimSpace(requested.Provider), "custom:") {
		providerID = strings.TrimPrefix(strings.TrimSpace(requested.Provider), "custom:")
		if providerID == "" {
			return nil, request, ai.ErrProviderInvalid
		}
	} else if requested != nil {
		// Explicit legacy/other providers are handled by Pi for compatibility.
		if s.executor == nil {
			return nil, request, errors.New("AI service is not configured")
		}
		return s.executor, request, nil
	} else {
		// Select the first enabled configured profile in the store's stable order.
		profiles, err := s.providerStore.List(ctx, uid)
		if err != nil {
			return nil, request, err
		}
		for _, profile := range profiles {
			if profile.Enabled && strings.TrimSpace(profile.DefaultModel) != "" {
				providerID = profile.ID
				break
			}
		}
		if providerID == "" {
			if s.executor == nil {
				return nil, request, errors.New("AI service is not configured")
			}
			return s.executor, request, nil
		}
	}
	config, err := s.providerStore.Resolve(ctx, uid, providerID)
	if err != nil {
		return nil, request, err
	}
	modelID := config.DefaultModel
	if requested != nil && strings.TrimSpace(requested.ID) != "" {
		modelID = strings.TrimSpace(requested.ID)
	}
	if modelID == "" {
		return nil, request, ai.ErrProviderInvalid
	}
	model := &ai.ChatModel{Provider: "custom:" + config.ID, ID: modelID, DisplayName: modelID, ProviderName: config.Name}
	if request.Options == nil {
		request.Options = &ai.AIOptions{Model: model}
	} else {
		options := *request.Options
		options.Model = model
		request.Options = &options
	}
	executor, err := ai.NewOpenAIExecutor(config)
	if err != nil {
		return nil, request, err
	}
	return executor, request, nil
}

// Execute validates, resolves and runs one authenticated request. The route is
// stable so idempotency keys cannot be replayed across different operations.
func (s *AIService) Execute(ctx context.Context, uid int64, request ai.ExecuteRequest, emit func(ai.AIStreamEvent) error) (ai.AIResult, error) {
	started := s.now()
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ai.ValidateExecuteRequest(request); err != nil {
		return s.failResult(request, started, err), err
	}
	if s.store == nil || (s.executor == nil && s.providerStore == nil) || s.reader == nil {
		err := errors.New("AI service is not configured")
		return s.failResult(request, started, err), err
	}
	// Resolve the provider once per request. The selected profile and model are
	// copied into the request before idempotency hashing, so retries cannot
	// silently switch to another default after a settings change.
	executor, request, err := s.resolveExecutor(ctx, uid, request)
	if err != nil {
		return s.failResult(request, started, err), err
	}
	resolved, err := ai.BuildContext(ctx, uid, request, s.reader)
	if err != nil {
		return s.failResult(request, started, err), err
	}
	if isProposalAction(request.Action.Type) {
		resolved, err = s.ensureProposalTarget(ctx, uid, resolved, request)
		if err != nil {
			return s.failResult(request, started, err), err
		}
		if request.Action.Type == "delete-note" {
			if !resolved.Permissions.NoteDelete {
				err := ai.ErrPermissionDenied
				return s.failResult(request, started, err), err
			}
		} else if !resolved.Permissions.NoteWrite {
			err := ai.ErrPermissionDenied
			return s.failResult(request, started, err), err
		}
	}
	hash := requestHash(request, resolved)
	run, existing, err := s.store.ReserveIdempotency(ctx, uid, "execute", request.IdempotencyKey, hash, s.runTTL)
	if err != nil {
		if existing && run != nil && errors.Is(err, ai.ErrIdempotencyInFlight) {
			return ai.AIResult{RequestID: resolved.RequestID, Status: "running", Citations: resolved.Citations}, err
		}
		return s.failResult(request, started, err), err
	}
	if existing && run != nil && run.ResultJSON != "" {
		var prior ai.AIResult
		if json.Unmarshal([]byte(run.ResultJSON), &prior) == nil {
			if prior.Proposal != nil {
				s.mu.Lock()
				prior.Proposal.ConfirmToken = s.proposalTokens[prior.Proposal.ID]
				s.mu.Unlock()
			}
			if emit != nil {
				_ = emit(ai.AIStreamEvent{Type: "completed", ID: run.ID, RequestID: prior.RequestID, Result: &prior, Usage: prior.Usage})
			}
			return prior, nil
		}
	}
	if existing && run != nil {
		return s.failResult(request, started, ai.ErrIdempotencyConflict), ai.ErrIdempotencyConflict
	}
	if err := s.store.ReserveQuota(ctx, uid, started, s.dailyLimit, s.concurrentLimit); err != nil {
		failed := s.failResult(request, started, err)
		failed.RequestID = resolved.RequestID
		failed.Citations = resolved.Citations
		encoded, _ := json.Marshal(failed)
		_ = s.store.FinishRun(ctx, uid, run.ID, ai.RunStatusFailed, string(encoded), ai.AuditErrorCode(err))
		_ = s.audit(ctx, uid, resolved, request, started, "rejected", err)
		return failed, err
	}
	if emit != nil {
		_ = emit(ai.AIStreamEvent{Type: "started", ID: run.ID, RequestID: resolved.RequestID, Phase: "running"})
	}
	piReq := buildPiRequest(request, resolved)
	final, execErr := executor.Execute(ctx, piReq, func(event ai.PiEvent) error {
		if emit == nil {
			return nil
		}
		if event.Type == "delta" && event.Text != "" {
			return emit(ai.AIStreamEvent{Type: "delta", ID: run.ID, RequestID: resolved.RequestID, Text: event.Text})
		}
		return nil
	})
	if execErr != nil {
		result := s.failResult(request, started, execErr)
		result.RequestID = resolved.RequestID
		result.Citations = resolved.Citations
		encoded, _ := json.Marshal(result)
		_ = s.store.FinishRun(ctx, uid, run.ID, ai.RunStatusFailed, string(encoded), ai.AuditErrorCode(execErr))
		_ = s.audit(ctx, uid, resolved, request, started, "failed", execErr)
		if emit != nil {
			_ = emit(ai.AIStreamEvent{Type: "error", ID: run.ID, RequestID: resolved.RequestID, Code: ai.AuditErrorCode(execErr), Message: safeAIMessage(execErr), Retryable: retryableAIError(execErr)})
		}
		return result, execErr
	}
	result := ai.AIResult{RequestID: resolved.RequestID, Status: "answer", Citations: resolved.Citations, Usage: &ai.AIUsage{DurationMs: s.now().Sub(started).Milliseconds()}}
	if isProposalAction(request.Action.Type) {
		proposal, token, proposalErr := s.makeProposal(resolved, request, final.Text)
		if proposalErr != nil {
			execErr = proposalErr
		} else {
			if err := s.store.SaveProposal(ctx, uid, proposal, token, started.Add(s.proposalTTL)); err != nil {
				execErr = err
			} else {
				s.mu.Lock()
				s.proposalTokens[proposal.ID] = token
				s.mu.Unlock()
				result.Proposal = &proposal
				result.Status = "proposal"
				if emit != nil {
					_ = emit(ai.AIStreamEvent{Type: "proposal", ID: run.ID, RequestID: resolved.RequestID, Proposal: &proposal})
				}
			}
		}
	} else {
		result.Answer = limitAIText(final.Text)
	}
	if execErr != nil {
		result.Status = "error"
		result.Error = &ai.AIError{Code: ai.AuditErrorCode(execErr), Message: safeAIMessage(execErr), Retryable: retryableAIError(execErr)}
		encoded, _ := json.Marshal(result)
		_ = s.store.FinishRun(ctx, uid, run.ID, ai.RunStatusFailed, string(encoded), ai.AuditErrorCode(execErr))
		_ = s.audit(ctx, uid, resolved, request, started, "failed", execErr)
		return result, execErr
	}
	// Confirmation tokens are response-only secrets. The durable idempotency
	// result must never contain the raw token (the proposal table stores only a
	// hash as well).
	persisted := result
	if persisted.Proposal != nil {
		proposalCopy := *persisted.Proposal
		proposalCopy.ConfirmToken = ""
		persisted.Proposal = &proposalCopy
	}
	encoded, _ := json.Marshal(persisted)
	if err := s.store.FinishRun(ctx, uid, run.ID, ai.RunStatusCompleted, string(encoded), ""); err != nil {
		return result, err
	}
	_ = s.audit(ctx, uid, resolved, request, started, "completed", nil)
	if emit != nil {
		_ = emit(ai.AIStreamEvent{Type: "completed", ID: run.ID, RequestID: resolved.RequestID, Result: &result, Usage: result.Usage})
	}
	return result, nil
}

func (s *AIService) CancelRun(ctx context.Context, uid int64, runID string) error {
	if s.store == nil {
		return errors.New("AI service is not configured")
	}
	return s.store.CancelRun(ctx, uid, runID, "canceled")
}

func (s *AIService) CommitProposal(ctx context.Context, uid int64, proposalID string, request ai.ProposalCommitRequest) (string, error) {
	if err := ai.ValidateProposalCommit(request); err != nil {
		return "", err
	}
	if s.store == nil || s.reader == nil || s.writer == nil {
		return "", ai.ErrProposalConflict
	}
	row, err := s.store.GetProposal(ctx, uid, proposalID)
	if err != nil {
		return "", err
	}
	proposal, err := decodeStoredProposal(row)
	if err != nil {
		return "", err
	}
	if !sameTargets(proposal.Base, request.Targets) {
		return "", ai.ErrProposalConflict
	}
	// The writer performs the final compare-and-swap. Re-reading here gives a
	// fast, permission-aware conflict response and prevents a stale proposal
	// from reaching any ordinary NoteService write path.
	for _, target := range request.Targets {
		if proposal.Action == "create-note" {
			if target.ContentHash != "new" || target.Version != 0 {
				return "", ai.ErrProposalConflict
			}
			continue
		}
		vault, vaultErr := ai.NormalizeVault(target.Vault)
		p, pathErr := ai.NormalizePath(target.Path)
		if vaultErr != nil || pathErr != nil {
			return "", ai.ErrProposalConflict
		}
		current, readErr := s.reader.ReadNote(ctx, uid, vault, p)
		if readErr != nil || current.ContentHash != target.ContentHash || current.Version != target.Version {
			return "", ai.ErrProposalConflict
		}
	}
	row, err = s.store.ClaimProposal(ctx, uid, proposalID, request.ConfirmToken, s.now())
	if err != nil {
		return "", err
	}
	proposal, err = decodeStoredProposal(row)
	if err != nil {
		_ = s.store.FinalizeProposal(ctx, uid, proposalID, ai.ProposalStatusPending, "")
		return "", err
	}
	if result, err := s.writer.CommitProposalTargets(ctx, uid, proposal, request.Targets); err != nil {
		_ = s.store.FinalizeProposal(ctx, uid, proposalID, ai.ProposalStatusPending, "")
		return "", err
	} else {
		if err := s.store.FinalizeProposal(ctx, uid, proposalID, ai.ProposalStatusCommitted, result); err != nil {
			return "", err
		}
		return result, nil
	}
}

func (s *AIService) DiscardProposal(ctx context.Context, uid int64, proposalID string) error {
	if s.store == nil {
		return errors.New("AI service is not configured")
	}
	return s.store.DiscardProposal(ctx, uid, proposalID)
}

func (s *AIService) UndoProposal(ctx context.Context, uid int64, proposalID string) (string, error) {
	if s.store == nil || s.writer == nil {
		return "", ai.ErrProposalConflict
	}
	row, err := s.store.GetProposal(ctx, uid, proposalID)
	if err != nil {
		return "", err
	}
	if row.Status != ai.ProposalStatusCommitted {
		return "", ai.ErrProposalState
	}
	proposal, err := decodeStoredProposal(row)
	if err != nil {
		return "", err
	}
	result, err := s.writer.UndoProposal(ctx, uid, proposal)
	if err != nil {
		return "", err
	}
	if err := s.store.MarkProposalUndone(ctx, uid, proposalID, result); err != nil {
		return "", err
	}
	return result, nil
}

func (s *AIService) audit(ctx context.Context, uid int64, resolved ai.Context, request ai.ExecuteRequest, started time.Time, status string, err error) error {
	return s.store.SaveAudit(ctx, ai.NewRequestAudit(resolved.RequestID, uid, resolved.Vault, request.Action.Type, status, ai.AuditErrorCode(err), request.IdempotencyKey, s.now().Sub(started)))
}

func (s *AIService) failResult(request ai.ExecuteRequest, started time.Time, err error) ai.AIResult {
	return ai.AIResult{RequestID: requestRequestID(request), Status: "error", Citations: []ai.AICitation{}, Usage: &ai.AIUsage{DurationMs: s.now().Sub(started).Milliseconds()}, Error: &ai.AIError{Code: ai.AuditErrorCode(err), Message: safeAIMessage(err), Retryable: retryableAIError(err)}}
}

func buildPiRequest(request ai.ExecuteRequest, resolved ai.Context) ai.PiRequest {
	instruction := request.Action.Instruction
	if instruction == "" {
		instruction = request.Action.Type
	}
	instruction = "Requested action: " + request.Action.Type + "\n" + instruction
	if request.Action.Target != "" {
		instruction += "\nTarget: " + request.Action.Target
	}
	if request.Action.Language != "" {
		instruction += "\nLanguage: " + request.Action.Language
	}
	if request.Action.Position != "" {
		instruction += "\nPosition: " + request.Action.Position
	}
	content := ""
	title := ""
	if resolved.Note != nil && request.Action.Type != "create-note" {
		content = resolved.Note.Content
		title = path.Base(resolved.Note.Path)
	}
	if resolved.ReferenceText != "" {
		if content != "" {
			content += "\n\n"
		}
		content += resolved.ReferenceText
	}
	var model *ai.ChatModel
	var thinking string
	var skills []string
	if request.Options != nil {
		model, thinking, skills = request.Options.Model, request.Options.Thinking, append([]string(nil), request.Options.SkillIDs...)
	}
	return ai.PiRequest{Instruction: instruction, Content: content, Title: title, Model: model, Thinking: thinking, SkillIDs: skills}
}

func (s *AIService) makeProposal(resolved ai.Context, request ai.ExecuteRequest, text string) (ai.Proposal, string, error) {
	text = limitAIText(text)
	if text == "" {
		return ai.Proposal{}, "", errors.New("AI returned an empty proposal")
	}
	id := uuid.NewString()
	now := s.now()
	expires := now.Add(s.proposalTTL)
	proposal := ai.Proposal{ID: id, Action: request.Action.Type, Base: []ai.ProposalBase{}, Operations: []ai.PatchOperation{}, Summary: limitAISummary(text), ExpiresAt: expires.Format(time.RFC3339)}
	if resolved.Note != nil && request.Action.Type != "create-note" {
		proposal.Base = append(proposal.Base, ai.ProposalBase{Vault: resolved.Vault, Path: resolved.Note.Path, ContentHash: resolved.Note.ContentHash, Version: resolved.Note.Version})
	}
	switch request.Action.Type {
	case "rewrite", "translate":
		start, end := 0, utf16Len(contextNoteContent(resolved))
		if request.Action.Target == "selection" && resolved.Selection != nil {
			start, end = resolved.Selection.Start, resolved.Selection.End
		}
		proposal.Operations = append(proposal.Operations, ai.PatchOperation{Op: "replace-range", Start: start, End: end, Text: text})
	case "insert":
		at := utf16Len(contextNoteContent(resolved))
		if resolved.Selection != nil {
			at = resolved.Selection.End
		}
		proposal.Operations = append(proposal.Operations, ai.PatchOperation{Op: "insert", At: at, Text: text})
	case "create-note":
		p, err := ai.NormalizePath(request.Action.Path)
		if err != nil {
			return ai.Proposal{}, "", err
		}
		// A create target has no existing body to hash. The sentinel baseline
		// still binds confirmation to the requested vault/path and lets the
		// writer reject a note that appeared between proposal and commit.
		proposal.Base = append(proposal.Base, ai.ProposalBase{Vault: resolved.Vault, Path: p, ContentHash: "new", Version: 0})
		proposal.Operations = append(proposal.Operations, ai.PatchOperation{Op: "create-note", Path: p, Text: text})
	case "delete-note":
		p, err := ai.NormalizePath(request.Action.Path)
		if err != nil {
			return ai.Proposal{}, "", err
		}
		proposal.Operations = append(proposal.Operations, ai.PatchOperation{Op: "move-to-trash", Path: p})
	}
	if len(proposal.Base) == 0 && request.Action.Type != "create-note" {
		return ai.Proposal{}, "", ai.ErrProposalConflict
	}
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return ai.Proposal{}, "", err
	}
	token := hex.EncodeToString(tokenBytes)
	proposal.ConfirmToken = token
	return proposal, token, nil
}

func (s *AIService) ensureProposalTarget(ctx context.Context, uid int64, resolved ai.Context, request ai.ExecuteRequest) (ai.Context, error) {
	if request.Action.Type == "create-note" {
		return resolved, nil
	}
	targetPath := ""
	if request.Action.Type == "delete-note" {
		targetPath = request.Action.Path
	} else if resolved.Note != nil {
		targetPath = resolved.Note.Path
	}
	if targetPath == "" {
		return ai.Context{}, ai.ErrProposalConflict
	}
	targetPath, err := ai.NormalizePath(targetPath)
	if err != nil {
		return ai.Context{}, ai.ErrProposalConflict
	}
	if resolved.Note != nil && resolved.Note.Path == targetPath && (request.Action.Type != "delete-note" || request.Action.Path == targetPath) {
		return resolved, nil
	}
	snapshot, err := s.reader.ReadNote(ctx, uid, resolved.Vault, targetPath)
	if err != nil {
		return ai.Context{}, ai.ErrProposalConflict
	}
	snapshot.Path = targetPath
	if snapshot.ContentHash == "" {
		return ai.Context{}, ai.ErrProposalConflict
	}
	resolved.Note = &ai.AINote{Path: targetPath, Content: snapshot.Content, ContentHash: snapshot.ContentHash, Version: snapshot.Version}
	return resolved, nil
}

func isProposalAction(action string) bool {
	switch action {
	case "rewrite", "translate", "insert", "create-note", "delete-note":
		return true
	}
	return false
}
func requestHash(request ai.ExecuteRequest, resolved ai.Context) string {
	payload := struct {
		Request     ai.ExecuteRequest
		Vault       string
		NoteHash    string
		NoteVersion int
	}{request, resolved.Vault, func() string {
		if resolved.Note == nil {
			return ""
		}
		return resolved.Note.ContentHash
	}(), func() int {
		if resolved.Note == nil {
			return 0
		}
		return resolved.Note.Version
	}()}
	b, _ := json.Marshal(payload)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
func decodeStoredProposal(row *model.AIProposal) (ai.Proposal, error) {
	if row == nil {
		return ai.Proposal{}, ai.ErrProposalNotFound
	}
	var proposal ai.Proposal
	if err := json.Unmarshal([]byte(row.BaseJSON), &proposal.Base); err != nil {
		return ai.Proposal{}, err
	}
	if err := json.Unmarshal([]byte(row.OperationsJSON), &proposal.Operations); err != nil {
		return ai.Proposal{}, err
	}
	proposal.ID, proposal.Action, proposal.Summary = row.ID, row.Action, row.Summary
	proposal.ExpiresAt = row.ExpiresAt.Format(time.RFC3339)
	return proposal, ai.ValidateProposal(proposal)
}
func sameTargets(a, b []ai.ProposalBase) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
func limitAIText(value string) string {
	if len(value) <= ai.MaxStreamText {
		return value
	}
	return clipAIBytes(value, ai.MaxStreamText)
}
func limitAISummary(value string) string {
	if len(value) <= ai.MaxSummary {
		return value
	}
	return clipAIBytes(value, ai.MaxSummary)
}

func clipAIBytes(value string, max int) string {
	if max <= 0 {
		return ""
	}
	end := 0
	for index := range value {
		if index > max {
			break
		}
		end = index
	}
	return value[:end]
}
func utf16Len(value string) int {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	return len(utf16.Encode([]rune(value)))
}
func contextNoteContent(value ai.Context) string {
	if value.Note == nil {
		return ""
	}
	return value.Note.Content
}
func safeAIMessage(err error) string {
	if err == nil {
		return ""
	}
	var upstreamError *ai.OpenAIHTTPError
	if errors.As(err, &upstreamError) {
		return upstreamError.SafeMessage()
	}
	if ai.AuditErrorCode(err) == "internal_error" {
		return "AI request failed"
	}
	return ai.AuditErrorCode(err)
}
func retryableAIError(err error) bool {
	return errors.Is(err, ai.ErrPiUnavailable) || errors.Is(err, ai.ErrPiTimeout) || errors.Is(err, ai.ErrAIConcurrentLimit) || errors.Is(err, ai.ErrOpenAIUnavailable) || errors.Is(err, ai.ErrOpenAITimeout)
}

func requestRequestID(r ai.ExecuteRequest) string {
	if r.Context == nil {
		return ""
	}
	return r.Context.RequestID
}

// NoteReaderFromServices adapts the existing authenticated services. It uses
// the same path hash algorithm as the regular note API and never accepts note
// content from the browser.
func NoteReaderFromServices(notes NoteService, vaults VaultService) ai.NoteReader {
	return &noteReaderAdapter{notes: notes, vaults: vaults}
}

type noteReaderAdapter struct {
	notes  NoteService
	vaults VaultService
}

func (a *noteReaderAdapter) ReadNote(ctx context.Context, uid int64, vault, p string) (ai.NoteSnapshot, error) {
	if a == nil || a.notes == nil || a.vaults == nil {
		return ai.NoteSnapshot{}, errors.New("note reader is not configured")
	}
	if _, err := a.vaults.MustGetID(ctx, uid, vault); err != nil {
		return ai.NoteSnapshot{}, err
	}
	note, err := a.notes.Get(ctx, uid, &dto.NoteGetRequest{Vault: vault, Path: p, PathHash: util.EncodeHash32(p)})
	if err != nil {
		return ai.NoteSnapshot{}, err
	}
	return ai.NoteSnapshot{Vault: vault, Path: note.Path, Title: path.Base(note.Path), Content: note.Content, ContentHash: note.ContentHash, Version: int(note.Version)}, nil
}
func (a *noteReaderAdapter) SearchNotes(ctx context.Context, uid int64, vault, query string, limit int) ([]ai.NoteHit, error) {
	if a == nil || a.notes == nil || a.vaults == nil {
		return nil, errors.New("note reader is not configured")
	}
	if limit <= 0 {
		limit = ai.MaxReferences
	}
	if limit > ai.MaxReferences {
		limit = ai.MaxReferences
	}
	if _, err := a.vaults.MustGetID(ctx, uid, vault); err != nil {
		return nil, err
	}
	rows, _, err := a.notes.List(ctx, uid, &dto.NoteListRequest{Vault: vault, Keyword: query, SearchMode: "content", SearchContent: true, SortBy: "mtime", SortOrder: "desc"}, &app.Pager{Page: 1, PageSize: limit})
	if err != nil {
		return nil, err
	}
	hits := make([]ai.NoteHit, 0, len(rows))
	for _, row := range rows {
		hits = append(hits, ai.NoteHit{Vault: vault, Path: row.Path, Title: path.Base(row.Path), ContentHash: "", Version: int(row.Version)})
	}
	return hits, nil
}

// CanWrite and CanDelete are the authenticated capability checks used by the
// context resolver. Vault ownership is the write boundary for the current
// note service; the handler has already applied the same vault scope check.
func (a *noteReaderAdapter) CanWrite(ctx context.Context, uid int64, vault, _ string) bool {
	if a == nil || a.vaults == nil {
		return false
	}
	_, err := a.vaults.MustGetID(ctx, uid, vault)
	return err == nil
}

func (a *noteReaderAdapter) CanDelete(ctx context.Context, uid int64, vault, _ string) bool {
	if a == nil || a.vaults == nil {
		return false
	}
	_, err := a.vaults.MustGetID(ctx, uid, vault)
	return err == nil
}
