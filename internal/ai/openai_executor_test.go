package ai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestOpenAIExecutorPreservesHTTPStatusWithoutProviderResponseBody(t *testing.T) {
	for _, status := range []int{401, 403, 404, 429, 502} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(status)
				_, _ = w.Write([]byte(`{"error":"sensitive upstream detail sk-secret"}`))
			}))
			defer server.Close()
			executor, err := NewOpenAIExecutor(ProviderConfig{Type: ProviderTypeOpenAICompatible, BaseURL: server.URL, DefaultModel: "test-model"}, WithOpenAIAllowPrivateEndpoints(true))
			require.NoError(t, err)
			_, err = executor.Execute(context.Background(), PiRequest{Instruction: "回答"}, nil)
			require.ErrorIs(t, err, ErrOpenAIUnavailable)
			var httpError *OpenAIHTTPError
			require.True(t, errors.As(err, &httpError))
			require.Equal(t, status, httpError.StatusCode)
			require.Contains(t, httpError.SafeMessage(), "HTTP")
			require.NotContains(t, httpError.SafeMessage(), "sk-secret")
			require.NotContains(t, err.Error(), "sensitive upstream detail")
		})
	}
}

func TestOpenAIHTTPErrorReportsModelRejectionWithoutEchoingUpstreamMessage(t *testing.T) {
	for _, body := range []string{`{"error":{"code":"model_not_found","message":"private sk-secret"}}`, `{"error":"Unsupported model: private sk-secret"}`} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(body))
		}))
		executor, err := NewOpenAIExecutor(ProviderConfig{Type: ProviderTypeOpenAICompatible, BaseURL: server.URL, DefaultModel: "test-model"}, WithOpenAIAllowPrivateEndpoints(true))
		require.NoError(t, err)
		_, err = executor.Execute(context.Background(), PiRequest{Instruction: "回答"}, nil)
		var httpError *OpenAIHTTPError
		require.True(t, errors.As(err, &httpError))
		require.Contains(t, httpError.SafeMessage(), "不支持当前模型")
		require.NotContains(t, httpError.SafeMessage(), "sk-secret")
		server.Close()
	}
}

func TestOpenAIExecutorParsesChatCompletionAndEmitsDelta(t *testing.T) {
	var gotAuthorization string
	var got openAIChatRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuthorization = r.Header.Get("Authorization")
		require.NoError(t, json.NewDecoder(r.Body).Decode(&got))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"完成答案"}}]}`))
	}))
	defer server.Close()

	executor, err := NewOpenAIExecutor(ProviderConfig{ID: "custom", Type: ProviderTypeOpenAICompatible, BaseURL: server.URL + "/v1", DefaultModel: "gpt-test", APIKey: "sk-test"}, WithOpenAIAllowPrivateEndpoints(true))
	require.NoError(t, err)
	var events []PiEvent
	final, err := executor.Execute(context.Background(), PiRequest{Instruction: "总结", Content: "正文"}, func(event PiEvent) error {
		events = append(events, event)
		return nil
	})
	require.NoError(t, err)
	require.Equal(t, "完成答案", final.Text)
	require.Equal(t, "Bearer sk-test", gotAuthorization)
	require.Equal(t, "gpt-test", got.Model)
	require.False(t, strings.Contains(got.Messages[1].Content, "sk-test"))
	require.Equal(t, []PiEvent{{Type: "delta", Text: "完成答案"}}, events)
}

func TestOpenAIExecutorParsesSSE(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"一\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"二\"}}]}\n\ndata: [DONE]\n\n"))
	}))
	defer server.Close()
	executor, err := NewOpenAIExecutor(ProviderConfig{Type: ProviderTypeOpenAICompatible, BaseURL: server.URL, DefaultModel: "gpt-test"}, WithOpenAIAllowPrivateEndpoints(true))
	require.NoError(t, err)
	final, err := executor.Execute(context.Background(), PiRequest{Instruction: "回答"}, nil)
	require.NoError(t, err)
	require.Equal(t, "一二", final.Text)
}

func TestOpenAIExecutorMountsSelectedSkillContent(t *testing.T) {
	root := t.TempDir()
	skillDir := filepath.Join(root, "rewrite")
	require.NoError(t, os.MkdirAll(skillDir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte("---\nname: Rewrite\ndescription: Keep a concise style\n---\nAlways preserve headings."), 0o600))
	t.Setenv("PI_SKILL_ROOT", root)
	var got openAIChatRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.NoError(t, json.NewDecoder(r.Body).Decode(&got))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
	}))
	defer server.Close()
	executor, err := NewOpenAIExecutor(ProviderConfig{Type: ProviderTypeOpenAICompatible, BaseURL: server.URL, DefaultModel: "test-model"}, WithOpenAIAllowPrivateEndpoints(true))
	require.NoError(t, err)
	_, err = executor.Execute(context.Background(), PiRequest{Instruction: "rewrite", SkillIDs: []string{"rewrite"}}, nil)
	require.NoError(t, err)
	require.Contains(t, got.Messages[1].Content, "Always preserve headings.")
}

func TestOpenAIExecutorRejectsPrivateEndpointByDefault(t *testing.T) {
	executor, err := NewOpenAIExecutor(ProviderConfig{Type: ProviderTypeOpenAICompatible, BaseURL: "http://127.0.0.1:11434/v1", DefaultModel: "llama"})
	require.NoError(t, err)
	_, err = executor.Execute(context.Background(), PiRequest{Instruction: "回答"}, nil)
	require.ErrorIs(t, err, ErrOpenAIRequest)
}

func TestOpenAIExecutorRejectsMalformedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"unexpected":true}`))
	}))
	defer server.Close()
	executor, err := NewOpenAIExecutor(ProviderConfig{Type: ProviderTypeOpenAICompatible, BaseURL: server.URL, DefaultModel: "gpt-test"}, WithOpenAIAllowPrivateEndpoints(true))
	require.NoError(t, err)
	_, err = executor.Execute(context.Background(), PiRequest{Instruction: "回答"}, nil)
	require.ErrorIs(t, err, ErrOpenAIProtocol)
}

func TestOpenAIExecutorPropagatesCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer server.Close()
	executor, err := NewOpenAIExecutor(ProviderConfig{Type: ProviderTypeOpenAICompatible, BaseURL: server.URL, DefaultModel: "gpt-test"}, WithOpenAIAllowPrivateEndpoints(true))
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = executor.Execute(ctx, PiRequest{Instruction: "回答"}, nil)
	require.ErrorIs(t, err, context.Canceled)
}
