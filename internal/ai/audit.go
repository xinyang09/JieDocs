package ai

import (
	"context"
	"errors"
	"strings"
	"time"
)

// AuditWriter is the minimal metadata-only sink used by AIService. Store
// implements it through SaveAudit.
type AuditWriter interface {
	SaveAudit(context.Context, RequestAudit) error
}

// NewRequestAudit normalizes fields before they reach durable storage. It is
// intentionally impossible to pass prompt or note content to this helper.
func NewRequestAudit(requestID string, uid int64, vault, action, status, errorCode, idempotencyKey string, duration time.Duration) RequestAudit {
	return RequestAudit{
		RequestID: strings.TrimSpace(requestID), UID: uid, Vault: strings.TrimSpace(vault), Action: strings.TrimSpace(action),
		Status: strings.TrimSpace(status), ErrorCode: safeErrorCode(errorCode), IdempotencyKey: strings.TrimSpace(idempotencyKey), DurationMs: duration.Milliseconds(), CreatedAt: time.Now().UTC(),
	}
}

func safeErrorCode(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	// Error strings can accidentally contain user-provided data. Audit only a
	// stable machine-style prefix; service callers should pass sentinel codes.
	for i, r := range value {
		if i >= 128 {
			value = value[:i]
			break
		}
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' || r == '.') {
			value = value[:i]
			break
		}
	}
	return value
}

func AuditErrorCode(err error) string {
	if err == nil {
		return ""
	}
	switch {
	case errors.Is(err, ErrIdempotencyConflict):
		return "idempotency_conflict"
	case errors.Is(err, ErrIdempotencyInFlight):
		return "idempotency_in_flight"
	case errors.Is(err, ErrAIConcurrentLimit):
		return "concurrent_limit"
	case errors.Is(err, ErrAIDailyLimit):
		return "daily_limit"
	case errors.Is(err, ErrProposalNotFound):
		return "proposal_not_found"
	case errors.Is(err, ErrProposalExpired):
		return "proposal_expired"
	case errors.Is(err, ErrProposalConflict):
		return "proposal_conflict"
	case errors.Is(err, ErrProposalState):
		return "proposal_state"
	case errors.Is(err, ErrAIRunState):
		return "run_state"
	case errors.Is(err, ErrInvalidContract):
		return "invalid_contract"
	case errors.Is(err, ErrInvalidContext):
		return "invalid_context"
	case errors.Is(err, ErrInvalidSkill):
		return "invalid_skill"
	case errors.Is(err, ErrPermissionDenied):
		return "permission_denied"
	case errors.Is(err, ErrPiUnavailable):
		return "pi_unavailable"
	case errors.Is(err, ErrPiTimeout):
		return "pi_timeout"
	case errors.Is(err, ErrPiOutputLimit):
		return "pi_output_limit"
	case errors.Is(err, ErrPiProtocol):
		return "pi_protocol"
	case errors.Is(err, ErrProviderExists):
		return "provider_exists"
	case errors.Is(err, ErrProviderNotFound):
		return "provider_not_found"
	case errors.Is(err, ErrProviderInvalid):
		return "provider_invalid"
	case errors.Is(err, ErrProviderConflict):
		return "provider_conflict"
	case errors.Is(err, ErrProviderDisabled):
		return "provider_disabled"
	case errors.Is(err, ErrProviderKey):
		return "provider_key_unavailable"
	case errors.Is(err, ErrOpenAIUnavailable):
		return "provider_unavailable"
	case errors.Is(err, ErrOpenAITimeout):
		return "provider_timeout"
	case errors.Is(err, ErrOpenAIResponseLimit):
		return "provider_response_limit"
	case errors.Is(err, ErrOpenAIProtocol):
		return "provider_protocol"
	case errors.Is(err, ErrOpenAIRequest):
		return "provider_request"
	case errors.Is(err, ErrOpenAIRedirect):
		return "provider_redirect"
	case errors.Is(err, ErrAIResultTooLarge):
		return "result_too_large"
	default:
		return "internal_error"
	}
}
