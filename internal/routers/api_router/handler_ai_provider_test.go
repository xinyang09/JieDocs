package api_router

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/haierkeys/fast-note-sync-service/internal/ai"
	"github.com/haierkeys/fast-note-sync-service/internal/app"
	pkgapp "github.com/haierkeys/fast-note-sync-service/pkg/app"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func newAIProviderHandlerTest(t *testing.T) *AIProviderHandler {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:ai-provider-handler-"+strings.ReplaceAll(t.Name(), "/", "-")+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	store := ai.NewProviderStore(db, t.TempDir()+"/.ai.key")
	testApp := app.NewTestApp(&app.Services{AIProviderStore: store}, db)
	t.Cleanup(func() {
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})
	return NewAIProviderHandler(testApp)
}

func aiProviderHandlerContext(method, path, body string, uid int64) (*gin.Context, *httptest.ResponseRecorder) {
	writer := httptest.NewRecorder()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	ctx, _ := gin.CreateTestContext(writer)
	ctx.Request = request
	if uid > 0 {
		ctx.Set("user_token", &pkgapp.UserEntity{UID: uid})
	}
	return ctx, writer
}

func TestAIProviderHandlerRequiresAuthentication(t *testing.T) {
	handler := newAIProviderHandlerTest(t)
	ctx, writer := aiProviderHandlerContext(http.MethodGet, "/api/ai/providers", "", 0)
	handler.List(ctx)
	require.Equal(t, http.StatusUnauthorized, writer.Code)
	require.NotContains(t, writer.Body.String(), "apiKey")
}

func TestAIProviderHandlerIsolatesUsersAndDoesNotReturnAPIKey(t *testing.T) {
	handler := newAIProviderHandlerTest(t)
	createCtx, createWriter := aiProviderHandlerContext(http.MethodPost, "/api/ai/providers", `{"id":"main","name":"My model","type":"openai-compatible","baseUrl":"https://api.example.test/v1","defaultModel":"gpt-test","apiKey":"super-secret"}`, 7)
	handler.Create(createCtx)
	require.Equal(t, http.StatusOK, createWriter.Code)
	require.NotContains(t, createWriter.Body.String(), "super-secret")
	require.Contains(t, createWriter.Body.String(), `"hasApiKey":true`)

	otherCtx, otherWriter := aiProviderHandlerContext(http.MethodGet, "/api/ai/providers", "", 8)
	handler.List(otherCtx)
	require.Equal(t, http.StatusOK, otherWriter.Code)
	var otherResponse struct {
		Providers []ai.ProviderProfile `json:"providers"`
	}
	require.NoError(t, json.Unmarshal(otherWriter.Body.Bytes(), &otherResponse))
	require.Empty(t, otherResponse.Providers)

	ownerCtx, ownerWriter := aiProviderHandlerContext(http.MethodGet, "/api/ai/providers", "", 7)
	handler.List(ownerCtx)
	require.Equal(t, http.StatusOK, ownerWriter.Code)
	require.Contains(t, ownerWriter.Body.String(), `"id":"main"`)
	require.NotContains(t, ownerWriter.Body.String(), "super-secret")
}

func TestAIProviderHandlerRejectsStaleVersion(t *testing.T) {
	handler := newAIProviderHandlerTest(t)
	createCtx, createWriter := aiProviderHandlerContext(http.MethodPost, "/api/ai/providers", `{"id":"main","name":"My model","type":"openai-compatible","baseUrl":"https://api.example.test/v1","defaultModel":"gpt-test","apiKey":"secret"}`, 7)
	handler.Create(createCtx)
	require.Equal(t, http.StatusOK, createWriter.Code)

	updateCtx, updateWriter := aiProviderHandlerContext(http.MethodPut, "/api/ai/providers/main", `{"name":"Changed","type":"openai-compatible","baseUrl":"https://api.example.test/v1","defaultModel":"gpt-test","version":99}`, 7)
	updateCtx.Params = gin.Params{{Key: "id", Value: "main"}}
	handler.Update(updateCtx)
	require.Equal(t, http.StatusConflict, updateWriter.Code)
	require.Contains(t, updateWriter.Body.String(), `"code":"provider_conflict"`)
}

func TestAIProviderHandlerStoreCanResolveEncryptedCredential(t *testing.T) {
	handler := newAIProviderHandlerTest(t)
	createCtx, createWriter := aiProviderHandlerContext(http.MethodPost, "/api/ai/providers", `{"id":"main","name":"My model","type":"openai-compatible","baseUrl":"https://api.example.test/v1","defaultModel":"gpt-test","apiKey":"secret"}`, 7)
	handler.Create(createCtx)
	require.Equal(t, http.StatusOK, createWriter.Code)

	store := handler.App.AIProviderStore
	config, err := store.Resolve(context.Background(), 7, "main")
	require.NoError(t, err)
	require.Equal(t, "secret", config.APIKey)
	require.Equal(t, int64(7), config.UID)
}

func TestAIHTTPStatusMapsProviderFailures(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want int
	}{
		{name: "timeout", err: ai.ErrOpenAITimeout, want: http.StatusGatewayTimeout},
		{name: "unavailable", err: ai.ErrOpenAIUnavailable, want: http.StatusBadGateway},
		{name: "protocol", err: ai.ErrOpenAIProtocol, want: http.StatusBadGateway},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.Equal(t, test.want, aiHTTPStatus(test.err))
		})
	}
}

func TestAIProviderErrorShowsSafeUpstreamHTTPGuidance(t *testing.T) {
	handler := newAIProviderHandlerTest(t)
	ctx, writer := aiProviderHandlerContext(http.MethodPost, "/api/ai/providers/main/test", "", 7)
	err := &ai.OpenAIHTTPError{StatusCode: http.StatusUnauthorized}
	handler.aiProviderError(ctx, aiProviderHTTPStatus(err), err)
	var response struct {
		Error ai.AIError `json:"error"`
	}
	require.NoError(t, json.Unmarshal(writer.Body.Bytes(), &response))
	require.Equal(t, ai.AuditErrorCode(err), response.Error.Code)
	require.Equal(t, err.SafeMessage(), response.Error.Message)
	require.Contains(t, response.Error.Message, "HTTP 401")
}
