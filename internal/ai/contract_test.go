package ai

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func validRequest() ExecuteRequest {
	return ExecuteRequest{
		Action:         AIAction{Type: "answer", Instruction: "Explain this note"},
		IdempotencyKey: "k1",
	}
}

func TestValidateExecuteRequest(t *testing.T) {
	t.Run("accepts the minimal answer request", func(t *testing.T) {
		if err := ValidateExecuteRequest(validRequest()); err != nil {
			t.Fatalf("ValidateExecuteRequest() error = %v", err)
		}
	})

	t.Run("requires idempotency key", func(t *testing.T) {
		req := validRequest()
		req.IdempotencyKey = "  "
		if err := ValidateExecuteRequest(req); err == nil {
			t.Fatal("expected empty idempotency key to fail")
		}
	})

	t.Run("rejects empty and over-limit instructions", func(t *testing.T) {
		req := validRequest()
		req.Action.Instruction = ""
		if err := ValidateExecuteRequest(req); err == nil {
			t.Fatal("expected empty instruction to fail")
		}
		req.Action.Instruction = strings.Repeat("x", MaxInstruction+1)
		if err := ValidateExecuteRequest(req); err == nil {
			t.Fatal("expected over-limit instruction to fail")
		}
	})

	t.Run("rejects unknown action", func(t *testing.T) {
		req := validRequest()
		req.Action.Type = "shell"
		if err := ValidateExecuteRequest(req); err == nil {
			t.Fatal("expected unknown action to fail")
		} else if !errors.Is(err, ErrInvalidContract) {
			t.Fatalf("error = %v, want ErrInvalidContract", err)
		}
	})

	t.Run("enforces context and skill limits", func(t *testing.T) {
		req := validRequest()
		req.Context = &AIContext{RequestID: "r1", Vault: "main", QueryScope: "references", Locale: "en", References: make([]AIReference, MaxReferences+1)}
		if err := ValidateExecuteRequest(req); err == nil {
			t.Fatal("expected reference limit to fail")
		}
		req.Context.References = []AIReference{}
		req.Options = &AIOptions{SkillIDs: make([]string, MaxSkills+1)}
		if err := ValidateExecuteRequest(req); err == nil {
			t.Fatal("expected skill limit to fail")
		}
	})
}

func TestValidateProposalRejectsUnknownOperation(t *testing.T) {
	proposal := Proposal{
		ID: "p1", Action: "rewrite", Base: []AIProposalBase{},
		Operations: []AIPatchOperation{{Op: "shell"}},
		Summary:    "rewrite", ExpiresAt: "2026-10-07T00:00:00Z",
	}
	if err := ValidateProposal(proposal); err == nil {
		t.Fatal("expected unknown operation to fail")
	}
}

func TestValidateProposalCommit(t *testing.T) {
	base := AIProposalBase{Vault: "main", Path: "guide.md", ContentHash: "sha256:1", Version: 3}
	if err := ValidateProposalCommit(ProposalCommitRequest{Targets: []AIProposalBase{base}, ConfirmToken: "confirm", IdempotencyKey: "commit-1"}); err != nil {
		t.Fatalf("ValidateProposalCommit() error = %v", err)
	}
	if err := ValidateProposalCommit(ProposalCommitRequest{Targets: []AIProposalBase{base}, ConfirmToken: "", IdempotencyKey: "commit-1"}); err == nil {
		t.Fatal("expected missing confirm token to fail")
	}
}

func TestContractJSONFieldNames(t *testing.T) {
	req := validRequest()
	req.Options = &AIOptions{Model: &ChatModel{Provider: "openai", ID: "gpt"}, Thinking: "high", SkillIDs: []string{"summarize"}, Stream: true}
	b, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	encoded := string(b)
	for _, field := range []string{`"idempotencyKey"`, `"instruction"`, `"skillIds"`, `"provider"`, `"thinking"`} {
		if !strings.Contains(encoded, field) {
			t.Errorf("JSON missing %s: %s", field, encoded)
		}
	}
	var decoded ExecuteRequest
	if err := json.Unmarshal(b, &decoded); err != nil {
		t.Fatal(err)
	}
	if err := ValidateExecuteRequest(decoded); err != nil {
		t.Fatalf("round-tripped request invalid: %v", err)
	}
}

func TestStreamEventJSONRequiredVariantFields(t *testing.T) {
	tests := []struct {
		name  string
		event AIStreamEvent
		field string
		want  string
	}{
		{name: "non-retryable error", event: AIStreamEvent{Type: "error", Code: "provider_protocol", Retryable: false}, field: "retryable", want: "false"},
		{name: "retryable error", event: AIStreamEvent{Type: "error", Code: "provider_unavailable", Retryable: true}, field: "retryable", want: "true"},
		{name: "nil meta tools", event: AIStreamEvent{Type: "meta"}, field: "tools", want: "[]"},
		{name: "empty meta tools", event: AIStreamEvent{Type: "meta", Tools: []string{}}, field: "tools", want: "[]"},
		{name: "populated meta tools", event: AIStreamEvent{Type: "meta", Tools: []string{"文档读取"}}, field: "tools", want: `["文档读取"]`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			encoded, err := json.Marshal(test.event)
			if err != nil {
				t.Fatal(err)
			}
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(encoded, &fields); err != nil {
				t.Fatal(err)
			}
			if got := string(fields[test.field]); got != test.want {
				t.Fatalf("%s = %s, want %s; event=%s", test.field, got, test.want, encoded)
			}
		})
	}
	encoded, err := json.Marshal(AIStreamEvent{Type: "delta", Text: "answer"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), `"retryable"`) || strings.Contains(string(encoded), `"tools"`) {
		t.Fatalf("delta includes unrelated variant fields: %s", encoded)
	}
}
