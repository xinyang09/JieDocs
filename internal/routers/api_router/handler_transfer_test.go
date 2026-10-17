package api_router

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/haierkeys/fast-note-sync-service/internal/app"
	"github.com/haierkeys/fast-note-sync-service/internal/config"
	"github.com/haierkeys/fast-note-sync-service/internal/dto"
	"github.com/haierkeys/fast-note-sync-service/internal/service/mocks"
	"github.com/haierkeys/fast-note-sync-service/internal/transfer"
	pkgapp "github.com/haierkeys/fast-note-sync-service/pkg/app"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type immediateTransferRunner struct{}

func (immediateTransferRunner) Run(context.Context, transfer.PublishInput) (transfer.PublishResult, error) {
	return transfer.PublishResult{Status: "dry-run"}, nil
}

func newTransferHandlerTest(t *testing.T, noteService *mocks.MockNoteService) (*TransferHandler, *transfer.Service) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:handler-transfer-"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	cfg := config.TransferConfig{
		Enabled:        true,
		SourceURL:      "https://fns.example.test",
		QueueCapacity:  2,
		TimeoutSeconds: 5,
		Profiles:       []config.TransferProfile{{ID: "demo", UID: 7, Vault: "vault", Provider: "feishu"}},
	}
	service, err := transfer.NewServiceWithKeyPath(cfg, db, immediateTransferRunner{}, filepath.Join(t.TempDir(), ".transfer.key"))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, service.Shutdown(context.Background())) })
	if noteService != nil {
		noteService.On("WithClient", mock.Anything, mock.Anything, mock.Anything).Return(noteService)
	}
	testApp := app.NewTestApp(&app.Services{NoteService: noteService}, db)
	testApp.Transfer = service
	return NewTransferHandler(testApp), service
}

func transferHandlerContext(method, path, body string, uid int64) (*gin.Context, *httptest.ResponseRecorder) {
	writer := httptest.NewRecorder()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Client", "web")
	ctx, _ := gin.CreateTestContext(writer)
	ctx.Request = request
	ctx.Set("user_token", &pkgapp.UserEntity{UID: uid})
	ctx.Set("scope", "p:rest f:transfer_rw,note_r")
	ctx.Set("vaults", "vault")
	return ctx, writer
}

func TestTransferHandlerSubmitFetchesNoteAndAcceptsJob(t *testing.T) {
	noteService := new(mocks.MockNoteService)
	noteService.On("Get", mock.Anything, int64(7), mock.AnythingOfType("*dto.NoteGetRequest")).Return(&dto.NoteDTO{
		Path:    "docs/hello.md",
		Content: "# hello",
		Mtime:   time.Now().UnixMilli(),
	}, nil)
	handler, service := newTransferHandlerTest(t, noteService)
	ctx, writer := transferHandlerContext(http.MethodPost, "/api/transfer/jobs", `{"profile":"demo","vault":"vault","path":"docs/hello.md"}`, 7)
	handler.Submit(ctx)
	require.Equal(t, http.StatusAccepted, writer.Code)
	var response pkgapp.Res
	require.NoError(t, json.Unmarshal(writer.Body.Bytes(), &response))
	require.Equal(t, 1, response.Code)
	job := response.Data.(map[string]any)
	jobID := job["id"].(string)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		value, err := service.Get(context.Background(), 7, jobID)
		if err == nil && value.Status == "dry-run" {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("accepted transfer job did not complete")
}

func TestTransferHandlerAdminProfileCRUD(t *testing.T) {
	handler, service := newTransferHandlerTest(t, new(mocks.MockNoteService))
	createCtx, createWriter := transferHandlerContext(http.MethodPost, "/api/transfer/admin/profiles", `{"id":"notion-team","uid":8,"vault":"other","provider":"notion","env":{"TRANSFER_NOTION_API_KEY":"FNS_NOTION_KEY"}}`, 7)
	handler.AdminCreateProfile(createCtx)
	require.Equal(t, http.StatusOK, createWriter.Code)
	var createResponse pkgapp.Res
	require.NoError(t, json.Unmarshal(createWriter.Body.Bytes(), &createResponse))
	require.Equal(t, 1, createResponse.Code)

	profiles := service.ManagedProfiles()
	require.Len(t, profiles, 2)
	require.Equal(t, "FNS_NOTION_KEY", profiles[1].Env["TRANSFER_NOTION_API_KEY"])

	updateCtx, updateWriter := transferHandlerContext(http.MethodPut, "/api/transfer/admin/profiles/notion-team", `{"id":"notion-team","uid":8,"vault":"renamed","provider":"notion","env":{"TRANSFER_NOTION_API_KEY":"FNS_NOTION_KEY"}}`, 7)
	updateCtx.Params = gin.Params{{Key: "id", Value: "notion-team"}}
	handler.AdminUpdateProfile(updateCtx)
	require.Equal(t, http.StatusOK, updateWriter.Code)

	deleteCtx, deleteWriter := transferHandlerContext(http.MethodDelete, "/api/transfer/admin/profiles/notion-team", "", 7)
	deleteCtx.Params = gin.Params{{Key: "id", Value: "notion-team"}}
	handler.AdminDeleteProfile(deleteCtx)
	require.Equal(t, http.StatusOK, deleteWriter.Code)
	require.Len(t, service.ManagedProfiles(), 1)
}

func TestTransferHandlerDoesNotReturnDirectCredentials(t *testing.T) {
	handler, service := newTransferHandlerTest(t, new(mocks.MockNoteService))
	createCtx, createWriter := transferHandlerContext(http.MethodPost, "/api/transfer/admin/profiles", `{"id":"direct-team","uid":8,"vault":"other","provider":"notion","credentials":{"TRANSFER_NOTION_API_KEY":"notion-secret"}}`, 7)
	handler.AdminCreateProfile(createCtx)
	require.Equal(t, http.StatusOK, createWriter.Code)
	require.NotContains(t, createWriter.Body.String(), "notion-secret")
	profiles := service.ManagedProfiles()
	require.Len(t, profiles, 2)
	require.True(t, profiles[0].CredentialStatus["TRANSFER_NOTION_API_KEY"] || profiles[1].CredentialStatus["TRANSFER_NOTION_API_KEY"])
}

func TestTransferHandlerEnforcesScopeAndVault(t *testing.T) {
	handler, _ := newTransferHandlerTest(t, new(mocks.MockNoteService))
	scopeCtx, scopeWriter := transferHandlerContext(http.MethodGet, "/api/transfer/profiles?vault=vault", "", 7)
	scopeCtx.Set("scope", "p:rest f:note_r")
	handler.Profiles(scopeCtx)
	var scopeResponse pkgapp.Res
	require.NoError(t, json.Unmarshal(scopeWriter.Body.Bytes(), &scopeResponse))
	require.Equal(t, 315, scopeResponse.Code)

	vaultCtx, vaultWriter := transferHandlerContext(http.MethodGet, "/api/transfer/profiles?vault=other", "", 7)
	handler.Profiles(vaultCtx)
	var vaultResponse pkgapp.Res
	require.NoError(t, json.Unmarshal(vaultWriter.Body.Bytes(), &vaultResponse))
	require.Equal(t, 315, vaultResponse.Code)
}

func TestTransferHandlerRequiresLiveProfileOptIn(t *testing.T) {
	noteService := new(mocks.MockNoteService)
	handler, _ := newTransferHandlerTest(t, noteService)
	ctx, writer := transferHandlerContext(http.MethodPost, "/api/transfer/jobs", `{"profile":"demo","vault":"vault","path":"docs/hello.md","live":true}`, 7)
	handler.Submit(ctx)
	var response pkgapp.Res
	require.NoError(t, json.Unmarshal(writer.Body.Bytes(), &response))
	require.Equal(t, 305, response.Code)
	noteService.AssertNotCalled(t, "Get", mock.Anything, mock.Anything, mock.Anything)
}

func TestTransferHandlerRejectsUnknownSubmitField(t *testing.T) {
	noteService := new(mocks.MockNoteService)
	handler, _ := newTransferHandlerTest(t, noteService)
	ctx, writer := transferHandlerContext(http.MethodPost, "/api/transfer/jobs", `{"profile":"demo","vault":"vault","path":"docs/hello.md","content":"secret"}`, 7)
	handler.Submit(ctx)
	require.Equal(t, http.StatusOK, writer.Code)
	var response pkgapp.Res
	require.NoError(t, json.Unmarshal(writer.Body.Bytes(), &response))
	require.Equal(t, 305, response.Code)
	noteService.AssertNotCalled(t, "Get", mock.Anything, mock.Anything, mock.Anything)
}

func TestTransferHandlerCannotReadAnotherUserJob(t *testing.T) {
	noteService := new(mocks.MockNoteService)
	noteService.On("Get", mock.Anything, int64(7), mock.AnythingOfType("*dto.NoteGetRequest")).Return(&dto.NoteDTO{
		Path:    "docs/hello.md",
		Content: "# hello",
	}, nil)
	handler, service := newTransferHandlerTest(t, noteService)
	submitCtx, submitWriter := transferHandlerContext(http.MethodPost, "/api/transfer/jobs", `{"profile":"demo","vault":"vault","path":"docs/hello.md"}`, 7)
	handler.Submit(submitCtx)
	require.Equal(t, http.StatusAccepted, submitWriter.Code)
	var submitResponse pkgapp.Res
	require.NoError(t, json.Unmarshal(submitWriter.Body.Bytes(), &submitResponse))
	jobID := submitResponse.Data.(map[string]any)["id"].(string)
	getCtx, getWriter := transferHandlerContext(http.MethodGet, "/api/transfer/jobs/"+jobID, "", 8)
	getCtx.Params = gin.Params{{Key: "id", Value: jobID}}
	handler.Get(getCtx)
	require.Equal(t, http.StatusOK, getWriter.Code)
	var getResponse pkgapp.Res
	require.NoError(t, json.Unmarshal(getWriter.Body.Bytes(), &getResponse))
	require.Equal(t, 304, getResponse.Code)
	_ = service
}
