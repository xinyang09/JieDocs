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

func TestFileUpdateOrCreateRejectsStaleExpectedContentHash(t *testing.T) {
	repo := new(domainmocks.MockFileRepository)
	vault := new(servicemocks.MockVaultService)
	vault.On("MustGetID", mock.Anything, int64(7), "Vault").Return(int64(3), nil)
	repo.On("GetByPathHash", mock.Anything, "path-hash", int64(3), int64(7)).Return(&domain.File{
		ID:          9,
		VaultID:     3,
		Path:        "config.yaml",
		PathHash:    "path-hash",
		ContentHash: "remote-hash",
	}, nil)

	fileService := service.NewFileService(nil, repo, nil, vault, nil, nil, nil, nil, &service.ServiceConfig{})
	_, _, err := fileService.UpdateOrCreate(context.Background(), 7, &dto.FileUpdateRequest{
		Vault:               "Vault",
		Path:                "config.yaml",
		PathHash:            "path-hash",
		ContentHash:         "local-hash",
		ExpectedContentHash: "stale-hash",
	}, false)

	require.ErrorIs(t, err, domain.ErrFileContentConflict)
	repo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything, mock.Anything)
}
