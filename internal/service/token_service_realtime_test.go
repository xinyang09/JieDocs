package service

import (
	"context"
	"testing"

	"github.com/haierkeys/fast-note-sync-service/internal/domain"
	"github.com/haierkeys/fast-note-sync-service/pkg/app"
	"github.com/stretchr/testify/require"
)

type realtimeTokenRepository struct {
	domain.AuthTokenRepository
	token *domain.AuthToken
}

func (repo *realtimeTokenRepository) Create(_ context.Context, token *domain.AuthToken) (*domain.AuthToken, error) {
	token.ID = 1
	repo.token = token
	return token, nil
}

func (repo *realtimeTokenRepository) GetByID(_ context.Context, _ int64) (*domain.AuthToken, error) {
	return repo.token, nil
}

func (repo *realtimeTokenRepository) Update(_ context.Context, token *domain.AuthToken) error {
	repo.token = token
	return nil
}

func (repo *realtimeTokenRepository) UpdateTokenString(_ context.Context, _ int64, nonce string) error {
	repo.token.TokenString = nonce
	return nil
}

func TestLoginTokenRealtimePermissions(t *testing.T) {
	for _, client := range []string{"webgui", "WebGUI", "obsidian"} {
		t.Run(client, func(t *testing.T) {
			repo := &realtimeTokenRepository{}
			service := &tokenService{tokenRepo: repo, tokenManager: &mockTokenManager{}}
			token, _, err := service.CreateForLogin(context.Background(), 1, client, "127.0.0.1", "browser")
			require.NoError(t, err)
			require.True(t, app.VerifyPermissions(token.Scope, "rest", client, "note_r"))
			require.Equal(t, client != "obsidian", app.VerifyPermissions(token.Scope, "ws", client, "note_r"))
			require.False(t, app.VerifyPermissions(token.Scope, "ws", "unrelated-client", "note_r"))
			require.False(t, app.VerifyPermissions(token.Scope, "mcp", client, "note_r"))
		})
	}
}

func TestRotateLoginTokenRealtimePermissions(t *testing.T) {
	for _, test := range []struct {
		name      string
		scope     string
		issueType int
		want      string
	}{
		{"legacy login", "p:rest c:webgui f:*", 1, "p:rest,ws c:webgui f:*"},
		{"current login", "p:rest,ws c:webgui f:*", 1, "p:rest,ws c:webgui f:*"},
		{"restricted login", "p:rest c:webgui f:note_r", 1, "p:rest c:webgui f:note_r"},
		{"manual token", "p:rest c:webgui f:*", 2, "p:rest c:webgui f:*"},
	} {
		t.Run(test.name, func(t *testing.T) {
			repo := &realtimeTokenRepository{token: &domain.AuthToken{
				ID: 1, UID: 1, ClientType: "webgui", Status: 1,
				Scope: test.scope, IssueType: test.issueType,
			}}
			service := &tokenService{tokenRepo: repo, tokenManager: &mockTokenManager{}}
			token, _, err := service.RotateForLogin(context.Background(), 1, 1, "127.0.0.1", "browser")
			require.NoError(t, err)
			require.Equal(t, test.want, token.Scope)
			require.Equal(t, test.want, repo.token.Scope)
		})
	}
}
