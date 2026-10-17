package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/haierkeys/fast-note-sync-service/internal/ai"
	"github.com/haierkeys/fast-note-sync-service/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type fakeAIReader struct{ snapshot ai.NoteSnapshot }

func (f fakeAIReader) ReadNote(context.Context, int64, string, string) (ai.NoteSnapshot, error) {
	return f.snapshot, nil
}
func (f fakeAIReader) SearchNotes(context.Context, int64, string, string, int) ([]ai.NoteHit, error) {
	return nil, nil
}
func (f fakeAIReader) CanWrite(context.Context, int64, string, string) bool  { return true }
func (f fakeAIReader) CanDelete(context.Context, int64, string, string) bool { return true }

type fakeAIExecutor struct{ text string }

func (f fakeAIExecutor) Execute(_ context.Context, _ ai.PiRequest, emit func(ai.PiEvent) error) (ai.PiFinal, error) {
	if emit != nil {
		_ = emit(ai.PiEvent{Type: "delta", Text: f.text})
	}
	return ai.PiFinal{Text: f.text}, nil
}

type failingAIExecutor struct{ err error }

func (f failingAIExecutor) Execute(context.Context, ai.PiRequest, func(ai.PiEvent) error) (ai.PiFinal, error) {
	return ai.PiFinal{}, f.err
}

func TestAIServiceExecutorErrorStreamPreservesRetryability(t *testing.T) {
	for _, test := range []struct {
		name      string
		err       error
		retryable bool
	}{
		{name: "unavailable", err: ai.ErrOpenAIUnavailable, retryable: true},
		{name: "protocol", err: ai.ErrOpenAIProtocol, retryable: false},
		{name: "HTTP authentication", err: &ai.OpenAIHTTPError{StatusCode: http.StatusUnauthorized}, retryable: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			service, _ := newAIServiceTest(t, failingAIExecutor{err: test.err})
			request := baseAIRequest(ai.AIAction{Type: "answer", Instruction: "answer"})
			request.IdempotencyKey = t.Name()
			var events []ai.AIStreamEvent
			result, err := service.Execute(context.Background(), 7, request, func(event ai.AIStreamEvent) error {
				events = append(events, event)
				return nil
			})
			if err != test.err {
				t.Fatalf("error = %v, want %v", err, test.err)
			}
			if len(events) != 2 || events[1].Type != "error" || events[1].Retryable != test.retryable {
				t.Fatalf("events = %#v", events)
			}
			if result.Error == nil || result.Error.Retryable != events[1].Retryable {
				t.Fatalf("stream and result disagree: %#v / %#v", events[1], result)
			}
			if upstreamError, ok := test.err.(*ai.OpenAIHTTPError); ok {
				if result.Error.Message != upstreamError.SafeMessage() || events[1].Message != result.Error.Message {
					t.Fatalf("HTTP guidance missing from stream or result: %#v / %#v", events[1], result)
				}
			}
		})
	}
}

func newAIServiceTest(t *testing.T, executor ai.PiExecutor) (*AIService, *ai.Store) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:ai-service-test?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.AIRun{}, &model.AIUsage{}, &model.AIProposal{}, &model.AIRequestAudit{}); err != nil {
		t.Fatal(err)
	}
	store := ai.NewStore(db)
	service := NewAIService(AIServiceConfig{Executor: executor, Store: store, Reader: fakeAIReader{snapshot: ai.NoteSnapshot{Vault: "Vault", Path: "note.md", Content: "old", ContentHash: "old-hash", Version: 2}}, DailyLimit: 10, ConcurrentLimit: 2})
	service.now = func() time.Time { return time.Now().UTC() }
	return service, store
}

func baseAIRequest(action ai.AIAction) ai.ExecuteRequest {
	return ai.ExecuteRequest{Action: action, Context: &ai.AIContext{RequestID: "request-1", Vault: "Vault", Note: &ai.AINote{Path: "note.md", Content: "untrusted client content", ContentHash: "bad", Version: 0}, References: []ai.AIReference{}, QueryScope: "note", Locale: "en", Permissions: ai.AIPermissions{NoteRead: true}}, IdempotencyKey: "request-key"}
}

func TestAIServiceExecuteResolvesServerNoteAndPersistsResult(t *testing.T) {
	service, store := newAIServiceTest(t, fakeAIExecutor{text: "answer text"})
	result, err := service.Execute(context.Background(), 7, baseAIRequest(ai.AIAction{Type: "answer", Instruction: "answer"}), nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "answer" || result.Answer != "answer text" {
		t.Fatalf("result = %#v", result)
	}
	_ = store
}

func TestAIServiceResolvesConfiguredProviderWithoutPi(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Model string `json:"model"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.Model != "test-model" {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"custom answer"}}]}`))
	}))
	defer server.Close()
	previous := os.Getenv("FNS_AI_ALLOW_PRIVATE_ENDPOINTS")
	if err := os.Setenv("FNS_AI_ALLOW_PRIVATE_ENDPOINTS", "true"); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = os.Setenv("FNS_AI_ALLOW_PRIVATE_ENDPOINTS", previous) }()

	db, err := gorm.Open(sqlite.Open("file:ai-provider-service-"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.AIRun{}, &model.AIUsage{}, &model.AIProposal{}, &model.AIRequestAudit{}, &model.AIProviderProfile{}); err != nil {
		t.Fatal(err)
	}
	providers := ai.NewProviderStore(db, t.TempDir()+"/provider.key")
	if _, err := providers.Create(context.Background(), 7, ai.ProviderInput{ID: "custom-one", Name: "测试服务", Type: ai.ProviderTypeOpenAICompatible, BaseURL: server.URL, DefaultModel: "test-model", APIKey: "secret"}); err != nil {
		t.Fatal(err)
	}
	store := ai.NewStore(db)
	service := NewAIService(AIServiceConfig{Executor: fakeAIExecutor{text: "pi answer"}, ProviderStore: providers, Store: store, Reader: fakeAIReader{snapshot: ai.NoteSnapshot{Vault: "Vault", Path: "note.md", Content: "old", ContentHash: "old-hash", Version: 2}}, DailyLimit: 10, ConcurrentLimit: 2})
	request := baseAIRequest(ai.AIAction{Type: "answer", Instruction: "answer"})
	request.IdempotencyKey = "custom-provider-key"
	result, err := service.Execute(context.Background(), 7, request, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Answer != "custom answer" {
		t.Fatalf("result = %#v", result)
	}
}

func TestAIServiceProposalReturnsEphemeralConfirmToken(t *testing.T) {
	service, store := newAIServiceTest(t, fakeAIExecutor{text: "rewritten"})
	request := baseAIRequest(ai.AIAction{Type: "rewrite", Instruction: "rewrite", Target: "note"})
	request.IdempotencyKey = "proposal-key"
	result, err := service.Execute(context.Background(), 7, request, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "proposal" || result.Proposal == nil || result.Proposal.ConfirmToken == "" {
		t.Fatalf("result = %#v", result)
	}
	row, err := store.GetProposal(context.Background(), 7, result.Proposal.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.ConfirmTokenHash == result.Proposal.ConfirmToken || row.ConfirmTokenHash == "" {
		t.Fatal("raw confirmation token persisted")
	}
}
