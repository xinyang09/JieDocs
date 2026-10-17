package api_router

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/haierkeys/fast-note-sync-service/internal/ai"
	"github.com/haierkeys/fast-note-sync-service/internal/app"
	"github.com/haierkeys/fast-note-sync-service/internal/model"
	"github.com/haierkeys/fast-note-sync-service/internal/service"
	pkgapp "github.com/haierkeys/fast-note-sync-service/pkg/app"
	"github.com/stretchr/testify/require"
)

// Use the real AI service and HTTP writer; only external model execution and
// persistence failures are controlled to exercise every stream exit path.
type aiStreamTestStore struct {
	ai.AIStore
	reserveErr  error
	proposalErr error
	finishErr   error
}

func (s aiStreamTestStore) ReserveIdempotency(context.Context, int64, string, string, string, time.Duration) (*model.AIRun, bool, error) {
	return &model.AIRun{ID: "run-stream-test"}, false, s.reserveErr
}
func (s aiStreamTestStore) ReserveQuota(context.Context, int64, time.Time, int, int) error {
	return nil
}
func (s aiStreamTestStore) FinishRun(context.Context, int64, string, string, string, string) error {
	return s.finishErr
}
func (s aiStreamTestStore) SaveProposal(context.Context, int64, ai.Proposal, string, time.Time) error {
	return s.proposalErr
}
func (s aiStreamTestStore) SaveAudit(context.Context, ai.RequestAudit) error { return nil }

type aiStreamTestReader struct{}

func (aiStreamTestReader) ReadNote(context.Context, int64, string, string) (ai.NoteSnapshot, error) {
	return ai.NoteSnapshot{Vault: "Vault", Path: "note.md", Content: "old", ContentHash: "hash", Version: 1}, nil
}
func (aiStreamTestReader) SearchNotes(context.Context, int64, string, string, int) ([]ai.NoteHit, error) {
	return nil, nil
}
func (aiStreamTestReader) CanWrite(context.Context, int64, string, string) bool { return true }

type aiStreamTestExecutor struct{ err error }

func (e aiStreamTestExecutor) Execute(_ context.Context, _ ai.PiRequest, emit func(ai.PiEvent) error) (ai.PiFinal, error) {
	if err := emit(ai.PiEvent{Type: "delta", Text: "partial answer"}); err != nil {
		return ai.PiFinal{}, err
	}
	return ai.PiFinal{Text: "answer"}, e.err
}

func TestAIExecuteHTTPStreamAlwaysTerminates(t *testing.T) {
	for _, test := range []struct {
		name      string
		store     aiStreamTestStore
		execErr   error
		proposal  bool
		terminal  string
		code      string
		retryable bool
		message   string
	}{
		{name: "success", terminal: "done"},
		{name: "failure before meta", store: aiStreamTestStore{reserveErr: ai.ErrAIConcurrentLimit}, terminal: "error", code: "concurrent_limit", retryable: true},
		{name: "executor retryable failure", execErr: ai.ErrOpenAIUnavailable, terminal: "error", code: "provider_unavailable", retryable: true},
		{name: "executor permanent failure", execErr: ai.ErrOpenAIProtocol, terminal: "error", code: "provider_protocol"},
		{name: "upstream HTTP failure guidance", execErr: &ai.OpenAIHTTPError{StatusCode: http.StatusUnauthorized}, terminal: "error", code: "provider_unavailable", retryable: true, message: (&ai.OpenAIHTTPError{StatusCode: http.StatusUnauthorized}).SafeMessage()},
		{name: "executor EOF is failure", execErr: io.EOF, terminal: "error", code: "internal_error"},
		{name: "proposal save failure after deltas", proposal: true, store: aiStreamTestStore{proposalErr: errors.New("database unavailable")}, terminal: "error", code: "internal_error"},
		{name: "run finish failure after deltas", store: aiStreamTestStore{finishErr: errors.New("database unavailable")}, terminal: "error", code: "internal_error"},
	} {
		t.Run(test.name, func(t *testing.T) {
			aiService := service.NewAIService(service.AIServiceConfig{Executor: aiStreamTestExecutor{err: test.execErr}, Store: test.store, Reader: aiStreamTestReader{}})
			handler := NewAIHandler(app.NewTestApp(&app.Services{AIService: aiService}))
			router := gin.New()
			router.Use(func(c *gin.Context) { c.Set("user_token", &pkgapp.UserEntity{UID: 7}) })
			router.POST("/api/ai/execute", handler.Execute)
			server := httptest.NewServer(router)
			defer server.Close()
			action := ai.AIAction{Type: "answer", Instruction: "answer"}
			if test.proposal {
				action = ai.AIAction{Type: "rewrite", Instruction: "rewrite", Target: "note"}
			}
			request := ai.ExecuteRequest{Action: action, Context: &ai.AIContext{RequestID: "request-stream-test", Vault: "Vault", Note: &ai.AINote{Path: "note.md", Content: "client context", ContentHash: "client-hash", Version: 1}, References: []ai.AIReference{}, QueryScope: "note", Locale: "en", Permissions: ai.AIPermissions{NoteRead: true}}, Options: &ai.AIOptions{Stream: true}, IdempotencyKey: "stream-test"}
			require.NoError(t, ai.ValidateExecuteRequest(request))
			encoded, err := json.Marshal(request)
			require.NoError(t, err)
			response, err := http.Post(server.URL+"/api/ai/execute", "application/json", bytes.NewReader(encoded))
			require.NoError(t, err)
			defer response.Body.Close()
			require.Equal(t, http.StatusOK, response.StatusCode)
			require.Contains(t, response.Header.Get("Content-Type"), "text/event-stream")
			var events []map[string]json.RawMessage
			scanner := bufio.NewScanner(response.Body)
			for scanner.Scan() {
				if !strings.HasPrefix(scanner.Text(), "data: ") {
					continue
				}
				var event map[string]json.RawMessage
				require.NoError(t, json.Unmarshal([]byte(strings.TrimPrefix(scanner.Text(), "data: ")), &event))
				events = append(events, event)
			}
			require.NoError(t, scanner.Err())
			require.NotEmpty(t, events)
			terminalCount := 0
			for sequence, event := range events {
				var gotSequence int
				require.NoError(t, json.Unmarshal(event["sequence"], &gotSequence))
				require.Equal(t, sequence, gotSequence)
				switch string(event["type"]) {
				case `"meta"`:
					require.Equal(t, "[]", string(event["tools"]))
				case `"error"`, `"done"`:
					terminalCount++
				}
			}
			require.Equal(t, 1, terminalCount, "events: %v", events)
			last := events[len(events)-1]
			require.Equal(t, `"`+test.terminal+`"`, string(last["type"]))
			if test.terminal == "error" {
				require.Equal(t, `"`+test.code+`"`, string(last["code"]))
				var retryable bool
				require.Contains(t, last, "retryable")
				require.NoError(t, json.Unmarshal(last["retryable"], &retryable))
				require.Equal(t, test.retryable, retryable)
				if test.message != "" {
					var message string
					require.NoError(t, json.Unmarshal(last["message"], &message))
					require.Equal(t, test.message, message)
				}
			} else {
				var result ai.AIResult
				require.NoError(t, json.Unmarshal(last["result"], &result))
				require.Equal(t, "answer", result.Status)
				require.Equal(t, "answer", result.Answer)
			}
		})
	}
}
