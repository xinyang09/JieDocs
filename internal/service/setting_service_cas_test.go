package service_test

import (
	"context"
	"testing"

	"github.com/haierkeys/fast-note-sync-service/internal/domain"
	domainmocks "github.com/haierkeys/fast-note-sync-service/internal/domain/mocks"
	"github.com/haierkeys/fast-note-sync-service/internal/dto"
	"github.com/haierkeys/fast-note-sync-service/internal/service"
	servicemocks "github.com/haierkeys/fast-note-sync-service/internal/service/mocks"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestSettingModifyOrCreateCASRejectsStaleContent(t *testing.T) {
	repo := new(domainmocks.MockSettingRepository)
	vault := new(servicemocks.MockVaultService)
	vault.On("MustGetID", mock.Anything, int64(7), "Vault").Return(int64(3), nil)
	repo.On("GetByPathHash", mock.Anything, "path-hash", int64(3), int64(7)).Return(&domain.Setting{ID: 9, VaultID: 3, Path: "a", PathHash: "path-hash", ContentHash: "remote"}, nil)
	settingService := service.NewSettingService(repo, vault, nil, &service.ServiceConfig{})
	_, _, err := settingService.ModifyOrCreateCAS(context.Background(), 7, &dto.SettingModifyOrCreateRequest{Vault: "Vault", Path: "a", PathHash: "path-hash", Content: "local", ContentHash: "local-hash"}, "stale")
	require.ErrorIs(t, err, domain.ErrSettingContentConflict)
	repo.AssertNotCalled(t, "UpdateIfContentHash", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}
