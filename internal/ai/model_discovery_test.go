package ai

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestModelCatalogEndpointPreservesPrefix(t *testing.T) {
	for _, test := range []struct {
		providerType string
		base         string
		want         string
	}{
		{ProviderTypeOpenAICompatible, "https://example.test/proxy/v1", "https://example.test/proxy/v1/models"},
		{ProviderTypeOpenAICompatible, "https://example.test/proxy/v1/chat/completions/", "https://example.test/proxy/v1/models"},
		{ProviderTypeOpenAICompatible, "https://example.test/proxy/v1/models", "https://example.test/proxy/v1/models"},
		{ProviderTypeOllama, "https://example.test/proxy/v1", "https://example.test/proxy/api/tags"},
		{ProviderTypeOllama, "https://example.test/proxy/v1/chat/completions", "https://example.test/proxy/api/tags"},
		{ProviderTypeOllama, "https://example.test/proxy/api/tags", "https://example.test/proxy/api/tags"},
	} {
		t.Run(test.base, func(t *testing.T) {
			got, err := modelCatalogEndpoint(ProviderConfig{Type: test.providerType, BaseURL: test.base}, true)
			require.NoError(t, err)
			require.Equal(t, test.want, got)
		})
	}
}

func TestModelDiscoveryAuthenticatesGETAndReturnsOnlySortedIDs(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodGet, r.Method)
		require.Equal(t, "/proxy/v1/models", r.URL.Path)
		require.Equal(t, "Bearer sk-private", r.Header.Get("Authorization"))
		_, _ = w.Write([]byte(`{"data":[{"id":"zeta","owned_by":"private"},{"id":"alpha"},{"id":"zeta"},{"id":""},{"id":"\ninvalid"}],"private":"sk-private"}`))
	}))
	defer server.Close()
	executor, err := NewOpenAIExecutor(ProviderConfig{ID: "main", Name: "Main", Type: ProviderTypeOpenAICompatible, BaseURL: server.URL + "/proxy/v1/chat/completions", APIKey: "sk-private", DefaultModel: "not-in-catalog"}, WithOpenAIAllowPrivateEndpoints(true))
	require.NoError(t, err)
	models, err := executor.ListModels(context.Background())
	require.NoError(t, err)
	require.Equal(t, []ChatModel{{Provider: "custom:main", ID: "alpha", DisplayName: "alpha", ProviderName: "Main"}, {Provider: "custom:main", ID: "zeta", DisplayName: "zeta", ProviderName: "Main"}}, models)
}

func TestModelDiscoveryParsesOllamaNativeCatalog(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/proxy/api/tags", r.URL.Path)
		_, _ = w.Write([]byte(`{"models":[{"name":"llama:latest","model":"ignored"},{"model":"qwen:8b"},{"name":"llama:latest"}]}`))
	}))
	defer server.Close()
	executor, err := NewOpenAIExecutor(ProviderConfig{ID: "local", Type: ProviderTypeOllama, BaseURL: server.URL + "/proxy/v1", DefaultModel: "not-in-catalog"}, WithOpenAIAllowPrivateEndpoints(true))
	require.NoError(t, err)
	models, err := executor.ListModels(context.Background())
	require.NoError(t, err)
	require.Len(t, models, 2)
	require.Equal(t, "llama:latest", models[0].ID)
	require.Equal(t, "qwen:8b", models[1].ID)
}

func TestModelDiscoveryRejectsPrivateEndpointByDefault(t *testing.T) {
	executor, err := NewOpenAIExecutor(ProviderConfig{Type: ProviderTypeOpenAICompatible, BaseURL: "http://127.0.0.1:11434/v1", DefaultModel: "test"})
	require.NoError(t, err)
	_, err = executor.ListModels(context.Background())
	require.ErrorIs(t, err, ErrOpenAIRequest)
}

func TestModelDiscoveryNeverFollowsCredentialRedirect(t *testing.T) {
	forwarded := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { forwarded = true }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	executor, err := NewOpenAIExecutor(ProviderConfig{Type: ProviderTypeOpenAICompatible, BaseURL: server.URL, DefaultModel: "test", APIKey: "secret"}, WithOpenAIAllowPrivateEndpoints(true), WithOpenAIHTTPClient(&http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return nil }}))
	require.NoError(t, err)
	_, err = executor.ListModels(context.Background())
	require.ErrorIs(t, err, ErrOpenAIRedirect)
	require.False(t, forwarded)
}

func TestModelDiscoveryReturnsSafeHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"private sk-secret"}`))
	}))
	defer server.Close()
	executor, err := NewOpenAIExecutor(ProviderConfig{Type: ProviderTypeOpenAICompatible, BaseURL: server.URL, DefaultModel: "test"}, WithOpenAIAllowPrivateEndpoints(true))
	require.NoError(t, err)
	_, err = executor.ListModels(context.Background())
	var upstream *OpenAIHTTPError
	require.True(t, errors.As(err, &upstream))
	require.Equal(t, http.StatusUnauthorized, upstream.StatusCode)
	require.NotContains(t, err.Error(), "sk-secret")
	require.NotContains(t, upstream.SafeMessage(), "private")
}

func TestModelDiscoveryProtocolAndResponseLimit(t *testing.T) {
	for _, test := range []struct {
		body string
		max  int64
		want error
	}{
		{`{"unexpected":true}`, 4096, ErrOpenAIProtocol},
		{`{"data":null}`, 4096, ErrOpenAIProtocol},
		{`{"data":{}}`, 4096, ErrOpenAIProtocol},
		{`not json`, 4096, ErrOpenAIProtocol},
		{strings.Repeat("a", 65), 64, ErrOpenAIResponseLimit},
	} {
		t.Run(test.body[:min(len(test.body), 20)], func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(test.body)) }))
			defer server.Close()
			executor, err := NewOpenAIExecutor(ProviderConfig{Type: ProviderTypeOpenAICompatible, BaseURL: server.URL, DefaultModel: "test"}, WithOpenAIAllowPrivateEndpoints(true))
			require.NoError(t, err)
			executor.maxResponse = test.max
			_, err = executor.ListModels(context.Background())
			require.ErrorIs(t, err, test.want)
		})
	}
}

func TestModelDiscoveryEmptyCatalogDoesNotInventDefault(t *testing.T) {
	ids, err := parseModelCatalog([]byte(`{"data":[]}`), ProviderTypeOpenAICompatible)
	require.NoError(t, err)
	require.Empty(t, ids)
}

func TestModelDiscoveryLimitsCatalogEntriesAndRejectsControlCharacters(t *testing.T) {
	_, err := parseModelCatalog([]byte(`{"data":[`+strings.Repeat(`{"id":"model"},`, 1024)+`{"id":"extra"}]}`), ProviderTypeOpenAICompatible)
	require.ErrorIs(t, err, ErrOpenAIResponseLimit)
	ids, err := parseModelCatalog([]byte(`{"data":[{"id":"a\tb"},{"id":"valid"},{"id":"\u007fhidden"}]}`), ProviderTypeOpenAICompatible)
	require.NoError(t, err)
	require.Equal(t, []string{"valid"}, ids)
}

func TestModelDiscoveryTimeoutAndCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer server.Close()
	executor, err := NewOpenAIExecutor(ProviderConfig{Type: ProviderTypeOpenAICompatible, BaseURL: server.URL, DefaultModel: "test"}, WithOpenAIAllowPrivateEndpoints(true))
	require.NoError(t, err)
	executor.timeout = 20 * time.Millisecond
	_, err = executor.ListModels(context.Background())
	require.ErrorIs(t, err, ErrOpenAITimeout)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = executor.ListModels(ctx)
	require.ErrorIs(t, err, context.Canceled)
}
