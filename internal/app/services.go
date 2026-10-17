package app

import (
	"os"
	"path/filepath"

	"github.com/haierkeys/fast-note-sync-service/internal/ai"
	"github.com/haierkeys/fast-note-sync-service/internal/model"
	"github.com/haierkeys/fast-note-sync-service/internal/service"
	"go.uber.org/zap"
)

// Services encapsulates all business service instances
type Services struct {
	VaultService       service.VaultService
	NoteService        service.NoteService
	UserService        service.UserService
	TokenService       service.TokenService
	FileService        service.FileService
	SettingService     service.SettingService
	NoteHistoryService service.NoteHistoryService
	ConflictService    service.ConflictService
	ShareService       service.ShareService
	NoteLinkService    service.NoteLinkService
	FolderService      service.FolderService
	StorageService     service.StorageService
	BackupService      service.BackupService
	GitSyncService     service.GitSyncService
	CloudflareService  service.CloudflareService
	SyncLogService     service.SyncLogService
	OIDCService        service.OIDCService
	AIService          *service.AIService
	AIProviderStore    *ai.ProviderStore
}

// initServices initializes all services
func initServices(cfg *AppConfig, infra *Infra, repos *Repositories, logger *zap.Logger) *Services {
	// AI lifecycle state is kept in the application database and is required by
	// the authenticated service before the first request arrives. The versioned
	// upgrade also creates these tables for existing installations.
	if infra != nil && infra.DB != nil {
		_ = infra.DB.AutoMigrate(&model.AIRun{}, &model.AIUsage{}, &model.AIProposal{}, &model.AIRequestAudit{})
	}
	svcConfig := &service.ServiceConfig{
		User: service.UserServiceConfig{
			RegisterIsEnable: cfg.User.RegisterIsEnable,
			AdminUID:         cfg.User.AdminUID,
		},
		Token: service.TokenServiceConfig{
			WebGUILoginTokenExpiry: cfg.Security.WebGUILoginTokenExpiry,
			WebGUILoginTokenBindIP: *cfg.Security.WebGUILoginTokenBindIP,
		},
		App: service.AppServiceConfig{
			SoftDeleteRetentionTime: cfg.App.SoftDeleteRetentionTime,
			HistoryKeepVersions:     cfg.App.HistoryKeepVersions,
			HistorySaveDelay:        cfg.App.HistorySaveDelay,
			ShareTokenExpiry:        cfg.Security.ShareTokenExpiry,
			ShortLink: service.ShortLinkServiceConfig{
				BaseURL:  cfg.ShortLink.BaseURL,
				APIKey:   cfg.ShortLink.APIKey,
				Password: cfg.ShortLink.Password,
				Cloaking: cfg.ShortLink.Cloaking,
			},
		},
	}

	s := &Services{}
	s.VaultService = service.NewVaultService(
		repos.VaultRepo,
		repos.NoteRepo,
		repos.FileRepo,
		repos.FolderRepo,
		repos.SyncLogRepo,
		repos.NoteHistoryRepo,
		repos.NoteLinkRepo,
		repos.SettingRepo,
		repos.NoteFTSRepo,
		repos.ShareRepo,
		repos.GitSyncRepo,
		repos.BackupRepo,
		logger,
	)
	s.StorageService = service.NewStorageService(repos.StorageRepo, &cfg.Storage)
	s.BackupService = service.NewBackupService(repos.BackupRepo, repos.NoteRepo, repos.FolderRepo, repos.FileRepo, repos.VaultRepo, s.StorageService, &cfg.Storage, cfg.App.TempPath, logger)
	s.GitSyncService = service.NewGitSyncService(repos.GitSyncRepo, repos.NoteRepo, repos.FolderRepo, repos.FileRepo, repos.VaultRepo, repos.SettingRepo, &cfg.Git, logger)

	// Initialize SyncLogService first, as NoteService/FileService/SettingService depend on it
	// SyncLogService 必须最先初始化，因为其他服务依赖它
	s.SyncLogService = service.NewSyncLogService(repos.SyncLogRepo, logger)

	s.FolderService = service.NewFolderService(repos.FolderRepo, repos.NoteRepo, repos.FileRepo, s.VaultService, s.BackupService, s.GitSyncService, s.SyncLogService, infra.workerPool)
	s.NoteService = service.NewNoteService(repos.UserRepo, repos.NoteRepo, repos.NoteLinkRepo, repos.FileRepo, repos.ShareRepo, repos.NoteHistoryRepo, s.VaultService, s.FolderService, s.BackupService, s.GitSyncService, s.SyncLogService, svcConfig)
	// AI requests use the authenticated NoteService/VaultService for context
	// reads. Confirmed patches use the same NoteService write path so normal
	// history, link indexing and sync behavior remains consistent.
	piExecutor, _ := ai.NewPiExecutor(ai.PiConfig{})
	providerKeyPath := os.Getenv("FNS_AI_KEY_FILE")
	if providerKeyPath == "" {
		providerKeyPath = filepath.Join(filepath.Dir(cfg.File), ".ai.key")
	}
	s.AIProviderStore = ai.NewProviderStore(infra.DB, providerKeyPath)
	s.AIService = service.NewAIService(service.AIServiceConfig{
		Executor:      piExecutor,
		ProviderStore: s.AIProviderStore,
		Store:         ai.NewAIStore(infra.DB),
		Reader:        service.NoteReaderFromServices(s.NoteService, s.VaultService),
		Writer:        service.NewAIProposalWriter(s.NoteService),
	})
	s.TokenService = service.NewTokenService(repos.AuthTokenRepo, repos.AuthTokenLogRepo, infra.TokenManager, logger, svcConfig.Token)
	s.UserService = service.NewUserService(repos.UserRepo, infra.TokenManager, s.TokenService, logger, svcConfig)
	s.OIDCService = service.NewOIDCService(repos.UserRepo, repos.OIDCIdentityRepo, s.TokenService)
	s.FileService = service.NewFileService(repos.UserRepo, repos.FileRepo, repos.NoteRepo, s.VaultService, s.FolderService, s.BackupService, s.GitSyncService, s.SyncLogService, svcConfig)
	s.SettingService = service.NewSettingService(repos.SettingRepo, s.VaultService, s.SyncLogService, svcConfig)
	s.NoteHistoryService = service.NewNoteHistoryService(repos.NoteHistoryRepo, repos.NoteRepo, repos.UserRepo, s.VaultService, s.FolderService, s.NoteService, s.BackupService, s.GitSyncService, logger, &svcConfig.App)
	s.ConflictService = service.NewConflictService(repos.NoteRepo, s.VaultService, logger)
	s.ShareService = service.NewShareService(repos.ShareRepo, infra.TokenManager, repos.NoteRepo, repos.FileRepo, repos.VaultRepo, logger, svcConfig)
	s.NoteLinkService = service.NewNoteLinkService(repos.NoteLinkRepo, repos.NoteRepo, s.VaultService)
	s.CloudflareService = service.NewCloudflareService(logger)

	return s
}
