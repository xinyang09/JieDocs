package transfer

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/haierkeys/fast-note-sync-service/internal/config"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type fakeRunner struct {
	started chan PublishInput
	release chan struct{}
	result  PublishResult
	err     error
	mu      sync.Mutex
	calls   int
}

func (r *fakeRunner) Run(ctx context.Context, input PublishInput) (PublishResult, error) {
	r.mu.Lock()
	r.calls++
	r.mu.Unlock()
	select {
	case r.started <- input:
	default:
	}
	if r.release != nil {
		select {
		case <-r.release:
		case <-ctx.Done():
			return PublishResult{}, ctx.Err()
		}
	}
	if r.err != nil {
		return PublishResult{}, r.err
	}
	return r.result, nil
}

func transferTestConfig(queue, timeout int) config.TransferConfig {
	return config.TransferConfig{
		Enabled:        true,
		SourceURL:      "https://fns.example.test",
		BridgeRoot:     ".",
		StateDir:       "storage/transfer",
		QueueCapacity:  queue,
		TimeoutSeconds: timeout,
		Profiles: []config.TransferProfile{{
			ID:       "demo",
			UID:      7,
			Vault:    "vault",
			Provider: "feishu",
		}},
	}
}

func newTransferTestService(t *testing.T, cfg config.TransferConfig, runner Runner) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:transfer-test-"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	service, err := NewServiceWithKeyPath(cfg, db, runner, filepath.Join(t.TempDir(), ".transfer.key"))
	require.NoError(t, err)
	t.Cleanup(func() {
		require.NoError(t, service.Shutdown(context.Background()))
	})
	return service, db
}

func TestServiceStoresCredentialsEncryptedAndKeepsThemOnBlankUpdate(t *testing.T) {
	runner := &fakeRunner{started: make(chan PublishInput, 1), result: PublishResult{Status: "dry-run"}}
	service, db := newTransferTestService(t, transferTestConfig(2, 2), runner)
	created, err := service.CreateProfile(context.Background(), config.TransferProfile{
		ID: "direct-feishu", UID: 7, Vault: "vault", Provider: "feishu",
		Credentials: map[string]string{
			"TRANSFER_FEISHU_APP_ID":     "cli_example",
			"TRANSFER_FEISHU_APP_SECRET": "app-secret",
		},
	})
	require.NoError(t, err)
	require.True(t, created.CredentialStatus["TRANSFER_FEISHU_APP_ID"])
	require.NotContains(t, created.Env, "app-secret")

	var record profileRecord
	require.NoError(t, db.Where("id = ?", "direct-feishu").First(&record).Error)
	require.NotContains(t, record.CredentialsJSON, "app-secret")
	require.NotContains(t, record.CredentialsJSON, "cli_example")

	updated, err := service.UpdateProfile(context.Background(), "direct-feishu", config.TransferProfile{
		ID: "direct-feishu", UID: 7, Vault: "renamed", Provider: "feishu",
	})
	require.NoError(t, err)
	require.True(t, updated.CredentialStatus["TRANSFER_FEISHU_APP_SECRET"])
	profile, ok := service.profileFor(7, "direct-feishu", "renamed")
	require.True(t, ok)
	require.Equal(t, "app-secret", profile.Credentials["TRANSFER_FEISHU_APP_SECRET"])
}

func TestDisabledServiceCanStoreProfilesButCannotSubmit(t *testing.T) {
	cfg := transferTestConfig(2, 2)
	cfg.Enabled = false
	service, _ := newTransferTestService(t, cfg, &fakeRunner{})
	_, err := service.CreateProfile(context.Background(), config.TransferProfile{
		ID: "disabled-profile", UID: 7, Vault: "vault", Provider: "notion",
		Credentials: map[string]string{"TRANSFER_NOTION_API_KEY": "notion-key"},
	})
	require.NoError(t, err)
	_, err = service.Submit(context.Background(), 7, Request{Profile: "disabled-profile", Vault: "vault", Path: "docs/hello.md"}, testNote())
	require.ErrorIs(t, err, ErrDisabled)
}

func testNote() Note {
	return Note{Path: "docs/hello.md", Content: "# hello", Mtime: 1700000000}
}

func waitForJob(t *testing.T, service *Service, uid int64, id string, want func(*Job) bool) *Job {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		job, err := service.Get(context.Background(), uid, id)
		if err == nil && want(job) {
			return job
		}
		time.Sleep(10 * time.Millisecond)
	}
	job, err := service.Get(context.Background(), uid, id)
	require.NoError(t, err)
	require.Fail(t, "job did not reach expected state", "job", job)
	return job
}

func TestServiceSubmitRunsOnceAndScopesGet(t *testing.T) {
	runner := &fakeRunner{started: make(chan PublishInput, 1), result: PublishResult{Status: "dry-run"}}
	service, _ := newTransferTestService(t, transferTestConfig(2, 2), runner)
	job, err := service.Submit(context.Background(), 7, Request{Profile: "demo", Vault: "vault", Path: "docs/hello.md"}, testNote())
	require.NoError(t, err)
	require.NotEmpty(t, job.ID)
	require.Equal(t, "queued", job.Status)
	waitForJob(t, service, 7, job.ID, func(value *Job) bool { return value.Status == "dry-run" })
	_, err = service.Get(context.Background(), 8, job.ID)
	require.Error(t, err)
	_, err = service.Submit(context.Background(), 7, Request{Profile: "demo", Vault: "vault", Path: "docs/hello.md"}, testNote())
	require.NoError(t, err)
}

func TestServiceManagesProfilesInDatabase(t *testing.T) {
	runner := &fakeRunner{started: make(chan PublishInput, 1), result: PublishResult{Status: "dry-run"}}
	service, db := newTransferTestService(t, transferTestConfig(2, 2), runner)

	profiles := service.ManagedProfiles()
	require.Len(t, profiles, 1)
	require.Equal(t, "demo", profiles[0].ID)

	created, err := service.CreateProfile(context.Background(), config.TransferProfile{
		ID: "notion-team", UID: 8, Vault: "other", Provider: "notion",
		Env: map[string]string{"TRANSFER_NOTION_API_KEY": "FNS_NOTION_KEY"},
	})
	require.NoError(t, err)
	require.Equal(t, "notion-team", created.ID)

	updated, err := service.UpdateProfile(context.Background(), "notion-team", config.TransferProfile{
		ID: "notion-team", UID: 8, Vault: "updated", Provider: "notion",
		Env: map[string]string{"TRANSFER_NOTION_API_KEY": "FNS_NOTION_KEY"},
	})
	require.NoError(t, err)
	require.Equal(t, "updated", updated.Vault)
	require.NoError(t, service.DeleteProfile(context.Background(), "notion-team"))
	require.ErrorIs(t, service.DeleteProfile(context.Background(), "notion-team"), ErrProfileNotFound)

	var stored profileRecord
	require.ErrorIs(t, db.Where("id = ?", "notion-team").First(&stored).Error, gorm.ErrRecordNotFound)
}

func TestServiceRejectsLiveProfileWithoutRuntimeReferences(t *testing.T) {
	runner := &fakeRunner{started: make(chan PublishInput, 1), result: PublishResult{Status: "dry-run"}}
	service, _ := newTransferTestService(t, transferTestConfig(2, 2), runner)
	_, err := service.CreateProfile(context.Background(), config.TransferProfile{
		ID: "live-feishu", UID: 8, Vault: "other", Provider: "feishu", AllowLive: true,
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "project-path")
}

func TestServiceRejectsDuplicateWhileRunnerBlocked(t *testing.T) {
	runner := &fakeRunner{started: make(chan PublishInput, 1), release: make(chan struct{}), result: PublishResult{Status: "dry-run"}}
	service, _ := newTransferTestService(t, transferTestConfig(2, 2), runner)
	job, err := service.Submit(context.Background(), 7, Request{Profile: "demo", Vault: "vault", Path: "docs/hello.md"}, testNote())
	require.NoError(t, err)
	<-runner.started
	_, err = service.Submit(context.Background(), 7, Request{Profile: "demo", Vault: "vault", Path: "docs/hello.md"}, testNote())
	require.ErrorIs(t, err, ErrDuplicate)
	close(runner.release)
	waitForJob(t, service, 7, job.ID, func(value *Job) bool { return value.Status == "dry-run" })
}

func TestServiceRejectsFullQueue(t *testing.T) {
	runner := &fakeRunner{started: make(chan PublishInput, 2), release: make(chan struct{}), result: PublishResult{Status: "dry-run"}}
	service, _ := newTransferTestService(t, transferTestConfig(1, 2), runner)
	first, err := service.Submit(context.Background(), 7, Request{Profile: "demo", Vault: "vault", Path: "docs/one.md"}, Note{Path: "docs/one.md", Content: "one"})
	require.NoError(t, err)
	<-runner.started
	_, err = service.Submit(context.Background(), 7, Request{Profile: "demo", Vault: "vault", Path: "docs/two.md"}, Note{Path: "docs/two.md", Content: "two"})
	require.NoError(t, err)
	_, err = service.Submit(context.Background(), 7, Request{Profile: "demo", Vault: "vault", Path: "docs/three.md"}, Note{Path: "docs/three.md", Content: "three"})
	require.ErrorIs(t, err, ErrQueueFull)
	close(runner.release)
	waitForJob(t, service, 7, first.ID, func(value *Job) bool { return value.Status == "dry-run" })
}

func TestServiceMarksTimeout(t *testing.T) {
	runner := &fakeRunner{started: make(chan PublishInput, 1), release: make(chan struct{})}
	service, _ := newTransferTestService(t, transferTestConfig(1, 1), runner)
	job, err := service.Submit(context.Background(), 7, Request{Profile: "demo", Vault: "vault", Path: "docs/timeout.md"}, Note{Path: "docs/timeout.md", Content: "timeout"})
	require.NoError(t, err)
	<-runner.started
	value := waitForJob(t, service, 7, job.ID, func(value *Job) bool { return value.Status == "failed" })
	require.Equal(t, "timeout", value.FailureCode)
}

func TestServiceStopsRunnerOnShutdown(t *testing.T) {
	runner := &fakeRunner{started: make(chan PublishInput, 1), release: make(chan struct{})}
	service, _ := newTransferTestService(t, transferTestConfig(1, 5), runner)
	job, err := service.Submit(context.Background(), 7, Request{Profile: "demo", Vault: "vault", Path: "docs/shutdown.md"}, Note{Path: "docs/shutdown.md", Content: "shutdown"})
	require.NoError(t, err)
	<-runner.started
	shutdownContext, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	require.NoError(t, service.Shutdown(shutdownContext))
	cancel()
	value, err := service.Get(context.Background(), 7, job.ID)
	require.NoError(t, err)
	require.Equal(t, "interrupted", value.Status)
	require.Equal(t, "shutdown", value.FailureCode)
}

func TestServiceMarksLiveRunnerFailureUncertain(t *testing.T) {
	runner := &fakeRunner{started: make(chan PublishInput, 1), err: &RunnerError{Code: "bridge", Uncertain: true, Err: errors.New("provider failed")}}
	cfg := transferTestConfig(1, 2)
	cfg.Profiles[0].AllowLive = true
	cfg.Profiles[0].Env = map[string]string{
		"TRANSFER_FEISHU_APP_ID":     "TEST_TRANSFER_APP_ID",
		"TRANSFER_FEISHU_APP_SECRET": "TEST_TRANSFER_APP_SECRET",
	}
	cfg.ProjectPath = "."
	service, _ := newTransferTestService(t, cfg, runner)
	job, err := service.Submit(context.Background(), 7, Request{Profile: "demo", Vault: "vault", Path: "docs/hello.md", Live: true}, testNote())
	require.NoError(t, err)
	value := waitForJob(t, service, 7, job.ID, func(value *Job) bool { return value.Status == "uncertain" })
	require.Equal(t, "bridge", value.FailureCode)
}

func TestServiceMarksStaleJobsOnRestart(t *testing.T) {
	cfg := transferTestConfig(1, 2)
	db, err := gorm.Open(sqlite.Open("file:transfer-restart-"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	runner := &fakeRunner{started: make(chan PublishInput, 1), result: PublishResult{Status: "dry-run"}}
	keyPath := filepath.Join(t.TempDir(), ".transfer.key")
	initialService, err := NewServiceWithKeyPath(cfg, db, runner, keyPath)
	require.NoError(t, err)
	require.NoError(t, initialService.Shutdown(context.Background()))
	stale := &jobRecord{ID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", UID: 7, Vault: "vault", Path: "docs/stale.md", Profile: "demo", Provider: "feishu", ContentSHA256: "hash", Status: "queued", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}
	require.NoError(t, db.Create(stale).Error)
	second, err := NewServiceWithKeyPath(cfg, db, runner, keyPath)
	require.NoError(t, err)
	t.Cleanup(func() { _ = second.Shutdown(context.Background()) })
	job, err := second.Get(context.Background(), 7, stale.ID)
	require.NoError(t, err)
	require.Equal(t, "interrupted", job.Status)
	require.Equal(t, "restarted", job.FailureCode)
}
