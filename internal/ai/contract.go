// Package ai contains the versioned protocol shared by the docs viewer and
// the authenticated AI service. Keep these structures free of service or
// database dependencies so they can be used by HTTP handlers and tests.
package ai

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const ContractVersion = 1

const (
	MaxInstruction      = 4000
	MaxContext          = 200000
	MaxReferences       = 20
	MaxReferenceContent = 40000
	MaxSkills           = 8
	MaxBlocks           = 200
	MaxOperations       = 100
	MaxProposalTargets  = 20
	MaxPath             = 1024
	MaxID               = 128
	MaxLocale           = 32
	MaxSummary          = 4000
	MaxStreamText       = 400000
	MaxIdempotencyKey   = 256
	MaxConfirmToken     = 256
)

var ErrInvalidContract = errors.New("invalid AI contract")

// ContractError points to the invalid JSON field while retaining a stable
// sentinel for callers that want to map all protocol errors to HTTP 400.
type ContractError struct {
	Path    string
	Message string
}

func (e *ContractError) Error() string {
	if e.Path == "" {
		return e.Message
	}
	return e.Path + ": " + e.Message
}

func (e *ContractError) Unwrap() error { return ErrInvalidContract }

func invalid(path, message string) error { return &ContractError{Path: path, Message: message} }

type ChatModel struct {
	Provider     string `json:"provider"`
	ID           string `json:"id"`
	DisplayName  string `json:"displayName,omitempty"`
	ProviderName string `json:"providerName,omitempty"`
}

type AINote struct {
	Path        string `json:"path"`
	Content     string `json:"content"`
	ContentHash string `json:"contentHash"`
	Version     int    `json:"version"`
}

type AISelection struct {
	Text    string `json:"text"`
	Start   int    `json:"start"`
	End     int    `json:"end"`
	BlockID string `json:"blockId,omitempty"`
}

type AIBlock struct {
	ID    string `json:"id"`
	Text  string `json:"text"`
	Start int    `json:"start"`
	End   int    `json:"end"`
}

type AIReference struct {
	Vault       string `json:"vault"`
	Path        string `json:"path"`
	Title       string `json:"title,omitempty"`
	Excerpt     string `json:"excerpt,omitempty"`
	ContentHash string `json:"contentHash,omitempty"`
}

type AIPermissions struct {
	NoteRead   bool `json:"noteRead"`
	NoteWrite  bool `json:"noteWrite"`
	NoteDelete bool `json:"noteDelete"`
}

type AIContext struct {
	RequestID      string        `json:"requestId"`
	Vault          string        `json:"vault"`
	Note           *AINote       `json:"note,omitempty"`
	Selection      *AISelection  `json:"selection,omitempty"`
	Blocks         []AIBlock     `json:"blocks,omitempty"`
	References     []AIReference `json:"references"`
	QueryScope     string        `json:"queryScope"`
	Locale         string        `json:"locale"`
	Permissions    AIPermissions `json:"permissions"`
	permissionsSet bool          `json:"-"`
}

// Context is the server-resolved form of AIContext. The wire contract remains
// AIContext (the browser cannot provide these fields); the extra metadata is
// populated only after the authenticated context builder has re-read notes.
type Context struct {
	AIContext
	// SystemBoundary is prepended to model input and marks every referenced
	// document as untrusted data. It is deliberately not part of the wire
	// request so a browser cannot weaken the boundary.
	SystemBoundary string `json:"-"`
	// AllowedActions is the action selected by the authenticated request. A
	// reference can never add actions, tools, skills, targets, or permissions.
	AllowedActions []string `json:"-"`
	// ReferenceText contains server-read reference bodies for the executor.
	// It is kept outside AIContext so citation metadata never accidentally
	// serializes full note bodies into chat history.
	ReferenceText string `json:"-"`
	// Citations is the exact source set sent to the model and shown to users.
	Citations []AICitation `json:"-"`
}

type AIAction struct {
	Type           string `json:"type"`
	Instruction    string `json:"instruction,omitempty"`
	Target         string `json:"target,omitempty"`
	Language       string `json:"language,omitempty"`
	Position       string `json:"position,omitempty"`
	Path           string `json:"path,omitempty"`
	instructionSet bool   `json:"-"`
}

type Action = AIAction

// UnmarshalJSON records whether optional instruction was present. This lets
// validation reject an explicitly empty optional instruction while preserving
// the ergonomic string field for Go callers constructing actions directly.
func (a *AIAction) UnmarshalJSON(data []byte) error {
	type plain AIAction
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*a = AIAction(decoded)
	_, a.instructionSet = fields["instruction"]
	return nil
}

// UnmarshalJSON records the required permissions object so a malformed
// request cannot silently receive all-zero permission defaults.
func (c *AIContext) UnmarshalJSON(data []byte) error {
	type plain AIContext
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*c = AIContext(decoded)
	_, c.permissionsSet = fields["permissions"]
	return nil
}

type AIPatchOperation struct {
	Op    string `json:"op"`
	Start int    `json:"start,omitempty"`
	End   int    `json:"end,omitempty"`
	At    int    `json:"at,omitempty"`
	Text  string `json:"text,omitempty"`
	Path  string `json:"path,omitempty"`
}

type PatchOperation = AIPatchOperation

type AIProposalBase struct {
	Vault       string `json:"vault"`
	Path        string `json:"path"`
	ContentHash string `json:"contentHash"`
	Version     int    `json:"version"`
}

type AIProposal struct {
	ID         string             `json:"id"`
	Action     string             `json:"action"`
	Base       []AIProposalBase   `json:"base"`
	Operations []AIPatchOperation `json:"operations"`
	Summary    string             `json:"summary"`
	ExpiresAt  string             `json:"expiresAt"`
	// ConfirmToken is returned only with a freshly generated proposal. It is
	// held in client memory and hashed before persistence; stored proposals
	// never repopulate this field.
	ConfirmToken string `json:"confirmToken,omitempty"`
}

type Proposal = AIProposal
type ProposalBase = AIProposalBase

type AICitation struct {
	Vault   string  `json:"vault"`
	Path    string  `json:"path"`
	Title   string  `json:"title,omitempty"`
	Excerpt string  `json:"excerpt,omitempty"`
	Score   float64 `json:"score,omitempty"`
}

type AIUsage struct {
	InputTokens  int   `json:"inputTokens,omitempty"`
	OutputTokens int   `json:"outputTokens,omitempty"`
	DurationMs   int64 `json:"durationMs"`
}

type AIError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

type AIResult struct {
	RequestID string       `json:"requestId"`
	Status    string       `json:"status"`
	Answer    string       `json:"answer,omitempty"`
	Proposal  *AIProposal  `json:"proposal,omitempty"`
	Citations []AICitation `json:"citations"`
	Usage     *AIUsage     `json:"usage,omitempty"`
	Error     *AIError     `json:"error,omitempty"`
}

type Result = AIResult

type AIOptions struct {
	Model    *ChatModel `json:"model,omitempty"`
	Thinking string     `json:"thinking,omitempty"`
	SkillIDs []string   `json:"skillIds,omitempty"`
	Stream   bool       `json:"stream,omitempty"`
}

type ExecuteRequest struct {
	Action         AIAction   `json:"action"`
	Context        *AIContext `json:"context,omitempty"`
	Options        *AIOptions `json:"options,omitempty"`
	IdempotencyKey string     `json:"idempotencyKey"`
}

type AIExecuteRequest = ExecuteRequest

type ProposalCommitRequest struct {
	Targets        []AIProposalBase `json:"targets"`
	ConfirmToken   string           `json:"confirmToken"`
	IdempotencyKey string           `json:"idempotencyKey"`
}

type CommitRequest = ProposalCommitRequest

// AIStreamEvent is a tagged union. Only the fields for Type are populated.
type AIStreamEvent struct {
	Type      string      `json:"type"`
	ID        string      `json:"id,omitempty"`
	Sequence  *int        `json:"sequence,omitempty"`
	RequestID string      `json:"requestId,omitempty"`
	Tools     []string    `json:"tools,omitempty"`
	Phase     string      `json:"phase,omitempty"`
	Count     *int        `json:"count,omitempty"`
	Text      string      `json:"text,omitempty"`
	Citation  *AICitation `json:"citation,omitempty"`
	Proposal  *AIProposal `json:"proposal,omitempty"`
	Usage     *AIUsage    `json:"usage,omitempty"`
	Result    *AIResult   `json:"result,omitempty"`
	Code      string      `json:"code,omitempty"`
	Message   string      `json:"message,omitempty"`
	Retryable bool        `json:"retryable,omitempty"`
}

// MarshalJSON preserves required zero values for each event variant. Empty
// tools on meta and retryable:false on error still carry protocol meaning.
func (event AIStreamEvent) MarshalJSON() ([]byte, error) {
	type streamEvent AIStreamEvent
	switch event.Type {
	case "meta":
		tools := event.Tools
		if tools == nil {
			tools = []string{}
		}
		return json.Marshal(struct {
			streamEvent
			Tools []string `json:"tools"`
		}{streamEvent(event), tools})
	case "error":
		return json.Marshal(struct {
			streamEvent
			Retryable bool `json:"retryable"`
		}{streamEvent(event), event.Retryable})
	default:
		return json.Marshal(streamEvent(event))
	}
}

type StreamEvent = AIStreamEvent

var actionTypes = map[string]struct{}{
	"answer": {}, "summarize": {}, "rewrite": {}, "translate": {},
	"insert": {}, "create-note": {}, "delete-note": {}, "search": {},
}

func validateString(value, path string, max int, required bool) error {
	if required && strings.TrimSpace(value) == "" {
		return invalid(path, "must not be empty")
	}
	if len(value) > max {
		return invalid(path, fmt.Sprintf("must be at most %d characters", max))
	}
	return nil
}

func validateInt(value int, path string) error {
	if value < 0 {
		return invalid(path, "must be an integer >= 0")
	}
	return nil
}

func validateAction(action AIAction) error {
	if _, ok := actionTypes[action.Type]; !ok {
		return invalid("action.type", fmt.Sprintf("unknown action type %q", action.Type))
	}
	switch action.Type {
	case "answer", "search", "insert", "rewrite", "create-note":
		if err := validateString(action.Instruction, "action.instruction", MaxInstruction, true); err != nil {
			return err
		}
	case "summarize", "translate":
		if action.Instruction != "" || action.instructionSet {
			if err := validateString(action.Instruction, "action.instruction", MaxInstruction, true); err != nil {
				return err
			}
		}
	}
	switch action.Type {
	case "rewrite", "translate":
		if action.Target != "selection" && action.Target != "note" {
			return invalid("action.target", "must be selection or note")
		}
	case "insert":
		if action.Position != "cursor" && action.Position != "end" && action.Position != "after-block" {
			return invalid("action.position", "unknown insertion position")
		}
	}
	if action.Type == "translate" {
		if err := validateString(action.Language, "action.language", 64, true); err != nil {
			return err
		}
	}
	if action.Type == "create-note" || action.Type == "delete-note" {
		if err := validateString(action.Path, "action.path", MaxPath, true); err != nil {
			return err
		}
	}
	return nil
}

func validateReference(ref AIReference, path string) (int, error) {
	if err := validateString(ref.Vault, path+".vault", MaxPath, true); err != nil {
		return 0, err
	}
	if err := validateString(ref.Path, path+".path", MaxPath, true); err != nil {
		return 0, err
	}
	if err := validateString(ref.Title, path+".title", 512, false); err != nil {
		return 0, err
	}
	if err := validateString(ref.Excerpt, path+".excerpt", MaxReferenceContent, false); err != nil {
		return 0, err
	}
	if err := validateString(ref.ContentHash, path+".contentHash", 256, false); err != nil {
		return 0, err
	}
	return len(ref.Excerpt), nil
}

func validateCitation(citation AICitation, path string) error {
	if err := validateString(citation.Vault, path+".vault", MaxPath, true); err != nil {
		return err
	}
	if err := validateString(citation.Path, path+".path", MaxPath, true); err != nil {
		return err
	}
	if err := validateString(citation.Title, path+".title", 512, false); err != nil {
		return err
	}
	if err := validateString(citation.Excerpt, path+".excerpt", MaxReferenceContent, false); err != nil {
		return err
	}
	if citation.Score < 0 {
		return invalid(path+".score", "must be a finite number >= 0")
	}
	return nil
}

func validateUsage(usage AIUsage, path string) error {
	if usage.InputTokens < 0 {
		return invalid(path+".inputTokens", "must be an integer >= 0")
	}
	if usage.OutputTokens < 0 {
		return invalid(path+".outputTokens", "must be an integer >= 0")
	}
	if usage.DurationMs < 0 {
		return invalid(path+".durationMs", "must be an integer >= 0")
	}
	return nil
}

func validateContext(ctx *AIContext) error {
	if ctx == nil {
		return nil
	}
	if !ctx.permissionsSet && ctx.Permissions == (AIPermissions{}) {
		return invalid("context.permissions", "is required")
	}
	if err := validateString(ctx.RequestID, "context.requestId", MaxID, true); err != nil {
		return err
	}
	if err := validateString(ctx.Vault, "context.vault", MaxPath, true); err != nil {
		return err
	}
	if ctx.QueryScope != "selection" && ctx.QueryScope != "note" && ctx.QueryScope != "references" && ctx.QueryScope != "vault" {
		return invalid("context.queryScope", "unknown query scope")
	}
	if err := validateString(ctx.Locale, "context.locale", MaxLocale, true); err != nil {
		return err
	}
	if ctx.References == nil {
		return invalid("context.references", "is required")
	}
	if len(ctx.References) > MaxReferences {
		return invalid("context.references", fmt.Sprintf("must contain at most %d items", MaxReferences))
	}
	contextSize := 0
	if ctx.Note != nil {
		if err := validateString(ctx.Note.Path, "context.note.path", MaxPath, true); err != nil {
			return err
		}
		if err := validateString(ctx.Note.Content, "context.note.content", MaxContext, true); err != nil {
			return err
		}
		if err := validateString(ctx.Note.ContentHash, "context.note.contentHash", 256, true); err != nil {
			return err
		}
		if err := validateInt(ctx.Note.Version, "context.note.version"); err != nil {
			return err
		}
		contextSize += len(ctx.Note.Content)
	}
	if ctx.Selection != nil {
		if err := validateString(ctx.Selection.Text, "context.selection.text", MaxContext, true); err != nil {
			return err
		}
		if err := validateInt(ctx.Selection.Start, "context.selection.start"); err != nil {
			return err
		}
		if err := validateInt(ctx.Selection.End, "context.selection.end"); err != nil {
			return err
		}
		if ctx.Selection.End < ctx.Selection.Start {
			return invalid("context.selection.end", "must be >= start")
		}
		if err := validateString(ctx.Selection.BlockID, "context.selection.blockId", MaxID, false); err != nil {
			return err
		}
		contextSize += len(ctx.Selection.Text)
	}
	if len(ctx.Blocks) > MaxBlocks {
		return invalid("context.blocks", fmt.Sprintf("must contain at most %d items", MaxBlocks))
	}
	for i, block := range ctx.Blocks {
		path := fmt.Sprintf("context.blocks[%d]", i)
		if err := validateString(block.ID, path+".id", MaxID, true); err != nil {
			return err
		}
		if err := validateString(block.Text, path+".text", MaxContext, false); err != nil {
			return err
		}
		if err := validateInt(block.Start, path+".start"); err != nil {
			return err
		}
		if err := validateInt(block.End, path+".end"); err != nil {
			return err
		}
		if block.End < block.Start {
			return invalid(path+".end", "must be >= start")
		}
		contextSize += len(block.Text)
	}
	for i, ref := range ctx.References {
		n, err := validateReference(ref, fmt.Sprintf("context.references[%d]", i))
		if err != nil {
			return err
		}
		contextSize += n
	}
	if contextSize > MaxContext {
		return invalid("context", fmt.Sprintf("must be at most %d characters", MaxContext))
	}
	return nil
}

func validatePatch(op AIPatchOperation, path string) error {
	switch op.Op {
	case "replace-range":
		if err := validateInt(op.Start, path+".start"); err != nil {
			return err
		}
		if err := validateInt(op.End, path+".end"); err != nil {
			return err
		}
		if op.End < op.Start {
			return invalid(path+".end", "must be >= start")
		}
		return validateString(op.Text, path+".text", MaxContext, false)
	case "insert":
		if err := validateInt(op.At, path+".at"); err != nil {
			return err
		}
		return validateString(op.Text, path+".text", MaxContext, true)
	case "create-note":
		if err := validateString(op.Path, path+".path", MaxPath, true); err != nil {
			return err
		}
		return validateString(op.Text, path+".text", MaxContext, false)
	case "move-to-trash":
		return validateString(op.Path, path+".path", MaxPath, true)
	default:
		return invalid(path+".op", fmt.Sprintf("unknown operation %q", op.Op))
	}
}

// ValidateProposal validates a proposal independently of an execute request.
func ValidateProposal(proposal Proposal) error {
	if err := validateString(proposal.ID, "proposal.id", MaxID, true); err != nil {
		return err
	}
	if err := validateString(proposal.ConfirmToken, "proposal.confirmToken", MaxConfirmToken, false); err != nil {
		return err
	}
	if _, ok := actionTypes[proposal.Action]; !ok {
		return invalid("proposal.action", "unknown action type")
	}
	if proposal.Base == nil {
		return invalid("proposal.base", "is required")
	}
	if len(proposal.Base) > MaxProposalTargets {
		return invalid("proposal.base", fmt.Sprintf("must contain at most %d items", MaxProposalTargets))
	}
	for i, target := range proposal.Base {
		path := fmt.Sprintf("proposal.base[%d]", i)
		if err := validateString(target.Vault, path+".vault", MaxPath, true); err != nil {
			return err
		}
		if err := validateString(target.Path, path+".path", MaxPath, true); err != nil {
			return err
		}
		if err := validateString(target.ContentHash, path+".contentHash", 256, true); err != nil {
			return err
		}
		if err := validateInt(target.Version, path+".version"); err != nil {
			return err
		}
	}
	if proposal.Operations == nil {
		return invalid("proposal.operations", "is required")
	}
	if len(proposal.Operations) > MaxOperations {
		return invalid("proposal.operations", fmt.Sprintf("must contain at most %d items", MaxOperations))
	}
	for i, op := range proposal.Operations {
		if err := validatePatch(op, fmt.Sprintf("proposal.operations[%d]", i)); err != nil {
			return err
		}
	}
	if err := validateString(proposal.Summary, "proposal.summary", MaxSummary, true); err != nil {
		return err
	}
	if err := validateString(proposal.ExpiresAt, "proposal.expiresAt", 64, true); err != nil {
		return err
	}
	if _, err := time.Parse(time.RFC3339, proposal.ExpiresAt); err != nil {
		return invalid("proposal.expiresAt", "must be an ISO timestamp")
	}
	return nil
}

// ValidateExecuteRequest enforces the protocol bounds before any context or
// model work is started. It intentionally does not trust permission booleans;
// those are rechecked by the authenticated context builder.
func ValidateExecuteRequest(request ExecuteRequest) error {
	if err := validateAction(request.Action); err != nil {
		return err
	}
	if err := validateContext(request.Context); err != nil {
		return err
	}
	if request.Options != nil {
		if request.Options.Model != nil {
			if err := validateString(request.Options.Model.Provider, "options.model.provider", 128, true); err != nil {
				return err
			}
			if err := validateString(request.Options.Model.ID, "options.model.id", 256, true); err != nil {
				return err
			}
		}
		if request.Options.Thinking != "" && request.Options.Thinking != "off" && request.Options.Thinking != "high" {
			return invalid("options.thinking", "must be off or high")
		}
		if len(request.Options.SkillIDs) > MaxSkills {
			return invalid("options.skillIds", fmt.Sprintf("must contain at most %d items", MaxSkills))
		}
		for i, id := range request.Options.SkillIDs {
			if err := validateString(id, fmt.Sprintf("options.skillIds[%d]", i), 80, true); err != nil {
				return err
			}
		}
	}
	return validateString(request.IdempotencyKey, "idempotencyKey", MaxIdempotencyKey, true)
}

// ValidateProposalCommit validates the optimistic-concurrency payload sent
// when the user confirms a proposal.
func ValidateProposalCommit(request ProposalCommitRequest) error {
	if request.Targets == nil {
		return invalid("targets", "is required")
	}
	if len(request.Targets) > MaxProposalTargets {
		return invalid("targets", fmt.Sprintf("must contain at most %d items", MaxProposalTargets))
	}
	for i, target := range request.Targets {
		path := fmt.Sprintf("targets[%d]", i)
		if err := validateString(target.Vault, path+".vault", MaxPath, true); err != nil {
			return err
		}
		if err := validateString(target.Path, path+".path", MaxPath, true); err != nil {
			return err
		}
		if err := validateString(target.ContentHash, path+".contentHash", 256, true); err != nil {
			return err
		}
		if err := validateInt(target.Version, path+".version"); err != nil {
			return err
		}
	}
	if err := validateString(request.ConfirmToken, "confirmToken", MaxConfirmToken, true); err != nil {
		return err
	}
	return validateString(request.IdempotencyKey, "idempotencyKey", MaxIdempotencyKey, true)
}
