package api_router

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/haierkeys/fast-note-sync-service/internal/ai"
	"github.com/stretchr/testify/require"
)

func createDiscoveryProvider(t *testing.T, handler *AIProviderHandler, uid int64, id, name, endpoint string, enabled bool) {
	t.Helper()
	_, err := handler.App.AIProviderStore.Create(context.Background(), uid, ai.ProviderInput{ID: id, Name: name, Type: ai.ProviderTypeOpenAICompatible, BaseURL: endpoint, DefaultModel: "saved-default-is-not-discovery", APIKey: "catalog-test-secret", Enabled: &enabled})
	require.NoError(t, err)
}

func TestAIProviderModelsIsolatesOwnerAndDisabledProfiles(t *testing.T) {
	t.Setenv("FNS_AI_ALLOW_PRIVATE_ENDPOINTS", "true")
	handler := newAIProviderHandlerTest(t)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		require.Equal(t, http.MethodGet, r.Method)
		require.Equal(t, "/v1/models", r.URL.Path)
		require.Equal(t, "Bearer catalog-test-secret", r.Header.Get("Authorization"))
		_, _ = w.Write([]byte(`{"data":[{"id":"discovered"}]}`))
	}))
	defer server.Close()
	createDiscoveryProvider(t, handler, 7, "main", "My model", server.URL+"/v1", true)
	createDiscoveryProvider(t, handler, 7, "disabled", "Disabled", server.URL+"/v1", false)
	for _, test := range []struct {
		uid    int64
		id     string
		status int
	}{
		{0, "main", http.StatusUnauthorized},
		{8, "main", http.StatusNotFound},
		{7, "disabled", http.StatusUnprocessableEntity},
		{7, "main", http.StatusOK},
	} {
		ctx, writer := aiProviderHandlerContext(http.MethodGet, "/api/ai/providers/"+test.id+"/models", "", test.uid)
		ctx.Params = gin.Params{{Key: "id", Value: test.id}}
		handler.Models(ctx)
		require.Equal(t, test.status, writer.Code)
		require.NotContains(t, writer.Body.String(), "catalog-test-secret")
		require.Equal(t, "no-store", writer.Header().Get("Cache-Control"))
		if test.status == http.StatusOK {
			var response struct {
				Models []ai.ChatModel `json:"models"`
			}
			require.NoError(t, json.Unmarshal(writer.Body.Bytes(), &response))
			require.Equal(t, []ai.ChatModel{{Provider: "custom:main", ID: "discovered", DisplayName: "discovered", ProviderName: "My model"}}, response.Models)
		}
	}
	require.EqualValues(t, 1, requests.Load())
	config, err := handler.App.AIProviderStore.Resolve(context.Background(), 7, "main")
	require.NoError(t, err)
	require.Equal(t, "saved-default-is-not-discovery", config.DefaultModel)
}

func TestAIModelsDiscoversCatalogsAndReportsPartialFailure(t *testing.T) {
	t.Setenv("FNS_AI_ALLOW_PRIVATE_ENDPOINTS", "true")
	handler := newAIProviderHandlerTest(t)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Path == "/failed/models" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"private catalog-test-secret"}`))
			return
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"z"},{"id":"a"},{"id":"z"}]}`))
	}))
	defer server.Close()
	createDiscoveryProvider(t, handler, 7, "main", "A Main", server.URL+"/good", true)
	createDiscoveryProvider(t, handler, 7, "failed", "B Failed", server.URL+"/failed", true)
	createDiscoveryProvider(t, handler, 7, "disabled", "C Disabled", server.URL+"/never", false)
	createDiscoveryProvider(t, handler, 8, "other", "Other user", server.URL+"/never", true)
	// An installed compatibility provider must not delay a custom catalog.
	piMarker := filepath.Join(t.TempDir(), "pi-started")
	piBinary := filepath.Join(t.TempDir(), "pi")
	require.NoError(t, os.WriteFile(piBinary, []byte("#!/bin/sh\ntouch '"+piMarker+"'\nexit 77\n"), 0o700))
	t.Setenv("PI_BIN", piBinary)
	ctx, writer := aiProviderHandlerContext(http.MethodGet, "/api/ai/models", "", 7)
	NewAIHandler(handler.App).Models(ctx)
	require.Equal(t, http.StatusOK, writer.Code)
	var response struct {
		Models   []ai.ChatModel `json:"models"`
		Warnings []struct {
			Provider string `json:"provider"`
			Message  string `json:"message"`
		} `json:"warnings"`
	}
	require.NoError(t, json.Unmarshal(writer.Body.Bytes(), &response))
	require.Equal(t, []ai.ChatModel{{Provider: "custom:main", ID: "a", DisplayName: "a", ProviderName: "A Main"}, {Provider: "custom:main", ID: "z", DisplayName: "z", ProviderName: "A Main"}}, response.Models)
	require.Len(t, response.Warnings, 1)
	require.Equal(t, "custom:failed", response.Warnings[0].Provider)
	require.Contains(t, response.Warnings[0].Message, "HTTP 401")
	require.NotContains(t, writer.Body.String(), "catalog-test-secret")
	require.NotContains(t, writer.Body.String(), server.URL)
	require.EqualValues(t, 2, requests.Load())
	_, err := os.Stat(piMarker)
	require.True(t, os.IsNotExist(err))
}

func TestAIModelsReturnsSafeFailureWhenAllCatalogsFail(t *testing.T) {
	t.Setenv("FNS_AI_ALLOW_PRIVATE_ENDPOINTS", "true")
	handler := newAIProviderHandlerTest(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":"private catalog-test-secret"}`))
	}))
	defer server.Close()
	createDiscoveryProvider(t, handler, 7, "failed", "Failed", server.URL, true)
	ctx, writer := aiProviderHandlerContext(http.MethodGet, "/api/ai/models", "", 7)
	NewAIHandler(handler.App).Models(ctx)
	require.Equal(t, http.StatusBadGateway, writer.Code)
	require.Contains(t, writer.Body.String(), "HTTP 502")
	require.NotContains(t, writer.Body.String(), "catalog-test-secret")
	require.NotContains(t, writer.Body.String(), "saved-default-is-not-discovery")
}

func TestAIModelsPreservesEmptyCatalogAndRequiresAuthentication(t *testing.T) {
	t.Setenv("FNS_AI_ALLOW_PRIVATE_ENDPOINTS", "true")
	handler := newAIProviderHandlerTest(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{"data":[]}`)) }))
	defer server.Close()
	createDiscoveryProvider(t, handler, 7, "empty", "Empty", server.URL, true)
	for _, test := range []struct {
		uid    int64
		status int
	}{{0, http.StatusUnauthorized}, {7, http.StatusOK}} {
		ctx, writer := aiProviderHandlerContext(http.MethodGet, "/api/ai/models", "", test.uid)
		NewAIHandler(handler.App).Models(ctx)
		require.Equal(t, test.status, writer.Code)
		if test.status == http.StatusOK {
			require.Contains(t, writer.Body.String(), `"models":[]`)
			require.NotContains(t, writer.Body.String(), "saved-default-is-not-discovery")
		}
	}
}
