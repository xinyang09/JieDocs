package transfer

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/haierkeys/fast-note-sync-service/internal/config"
	"gorm.io/gorm"
)

const MaxNoteBytes = 1024 * 1024

var (
	ErrDisabled        = errors.New("transfer is disabled")
	ErrClosed          = errors.New("transfer service is shutting down")
	ErrDuplicate       = errors.New("an equivalent transfer job is already running")
	ErrQueueFull       = errors.New("transfer queue is full")
	ErrProfileExists   = errors.New("transfer profile already exists")
	ErrProfileNotFound = errors.New("transfer profile not found")
)

type Request struct {
	Profile string
	Vault   string
	Path    string
	Live    bool
	Force   bool
}

type Note struct {
	Path    string
	Content string
	Mtime   int64
}

type PublishInput struct {
	JobID   string
	UID     int64
	Vault   string
	Path    string
	Content string
	Mtime   int64
	Live    bool
	Force   bool
	Profile config.TransferProfile
}

type PublishResult struct {
	Status        string
	ExternalID    string
	ExternalURL   string
	ContentSHA256 string
}

type Runner interface {
	Run(context.Context, PublishInput) (PublishResult, error)
}

type RunnerError struct {
	Code       string
	ExternalID string
	Uncertain  bool
	Err        error
}

func (e *RunnerError) Error() string {
	if e == nil || e.Err == nil {
		return "transfer runner failed"
	}
	return e.Err.Error()
}

func (e *RunnerError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

type Profile struct {
	ID        string `json:"id"`
	Vault     string `json:"vault"`
	Provider  string `json:"provider"`
	AllowLive bool   `json:"allowLive"`
}

type ManagedProfile struct {
	ID               string            `json:"id"`
	UID              int64             `json:"uid"`
	Vault            string            `json:"vault"`
	Provider         string            `json:"provider"`
	AllowLive        bool              `json:"allowLive"`
	Env              map[string]string `json:"env,omitempty"`
	CredentialStatus map[string]bool   `json:"credentialStatus"`
}

type Job struct {
	ID             string     `json:"id"`
	UID            int64      `json:"uid"`
	Vault          string     `json:"vault"`
	Path           string     `json:"path"`
	Profile        string     `json:"profile"`
	Provider       string     `json:"provider"`
	Live           bool       `json:"live"`
	Force          bool       `json:"force"`
	ContentSHA256  string     `json:"contentSha256"`
	Status         string     `json:"status"`
	ExternalID     string     `json:"externalId,omitempty"`
	ExternalURL    string     `json:"externalUrl,omitempty"`
	FailureCode    string     `json:"failureCode,omitempty"`
	FailureMessage string     `json:"failureMessage,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	StartedAt      *time.Time `json:"startedAt,omitempty"`
	FinishedAt     *time.Time `json:"finishedAt,omitempty"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

type jobRecord struct {
	ID             string `gorm:"primaryKey;size:32"`
	UID            int64  `gorm:"index;not null"`
	Vault          string `gorm:"index;not null"`
	Path           string `gorm:"index;not null"`
	Profile        string `gorm:"index;not null"`
	Provider       string `gorm:"not null"`
	Live           bool   `gorm:"not null"`
	Force          bool   `gorm:"not null"`
	ContentSHA256  string `gorm:"index;size:64;not null"`
	Status         string `gorm:"index;not null"`
	ExternalID     string `gorm:"size:255"`
	ExternalURL    string `gorm:"size:2048"`
	FailureCode    string `gorm:"size:64"`
	FailureMessage string `gorm:"size:255"`
	CreatedAt      time.Time
	StartedAt      *time.Time
	FinishedAt     *time.Time
	UpdatedAt      time.Time
}

func (jobRecord) TableName() string {
	return "transfer_jobs"
}

type profileRecord struct {
	ID              string `gorm:"primaryKey;size:64"`
	UID             int64  `gorm:"index;not null"`
	Vault           string `gorm:"index;not null"`
	Provider        string `gorm:"not null"`
	AllowLive       bool   `gorm:"not null"`
	EnvJSON         string `gorm:"type:text;not null"`
	CredentialsJSON string `gorm:"type:text;not null;default:''"`
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func (profileRecord) TableName() string {
	return "transfer_profiles"
}

type task struct {
	jobID string
	input PublishInput
}

type Service struct {
	cfg         config.TransferConfig
	db          *gorm.DB
	runner      Runner
	queue       chan task
	ctx         context.Context
	cancel      context.CancelFunc
	workerDone  chan struct{}
	closeOnce   sync.Once
	mu          sync.Mutex
	closed      bool
	inFlight    map[string]struct{}
	profileMu   sync.RWMutex
	profiles    map[string]config.TransferProfile
	credentials *credentialStore
}

func NewService(cfg config.TransferConfig, db *gorm.DB, runner Runner) (*Service, error) {
	keyPath := os.Getenv("FNS_TRANSFER_KEY_FILE")
	if keyPath == "" {
		keyPath = ".transfer.key"
	}
	return NewServiceWithKeyPath(cfg, db, runner, keyPath)
}

func NewServiceWithKeyPath(cfg config.TransferConfig, db *gorm.DB, runner Runner, keyPath string) (*Service, error) {
	cfg.Normalize()
	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("validate transfer config: %w", err)
	}
	if db == nil {
		return nil, errors.New("transfer database is required")
	}
	if runner == nil {
		return nil, errors.New("transfer runner is required")
	}
	if err := db.AutoMigrate(&jobRecord{}, &profileRecord{}); err != nil {
		return nil, fmt.Errorf("migrate transfer tables: %w", err)
	}
	credentials, err := newCredentialStore(db, keyPath)
	if err != nil {
		return nil, fmt.Errorf("initialize transfer credential store: %w", err)
	}
	if err := seedProfiles(db, cfg.Profiles, credentials); err != nil {
		return nil, fmt.Errorf("seed transfer profiles: %w", err)
	}
	profiles, err := loadProfiles(db, credentials)
	if err != nil {
		return nil, fmt.Errorf("load transfer profiles: %w", err)
	}
	now := time.Now().UTC()
	if err := db.Model(&jobRecord{}).Where("status = ?", "queued").Updates(map[string]any{
		"status":          "interrupted",
		"failure_code":    "restarted",
		"failure_message": "job was interrupted by service restart",
		"finished_at":     now,
		"updated_at":      now,
	}).Error; err != nil {
		return nil, fmt.Errorf("mark queued transfer jobs: %w", err)
	}
	if err := db.Model(&jobRecord{}).Where("status = ?", "running").Updates(map[string]any{
		"status":          "uncertain",
		"failure_code":    "restart_uncertain",
		"failure_message": "remote result is unknown after service restart",
		"finished_at":     now,
		"updated_at":      now,
	}).Error; err != nil {
		return nil, fmt.Errorf("mark running transfer jobs: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	service := &Service{
		cfg:         cfg,
		db:          db,
		runner:      runner,
		queue:       make(chan task, cfg.QueueCapacity),
		ctx:         ctx,
		cancel:      cancel,
		workerDone:  make(chan struct{}),
		inFlight:    make(map[string]struct{}),
		profiles:    profiles,
		credentials: credentials,
	}
	if cfg.Enabled {
		go service.worker()
	} else {
		close(service.workerDone)
	}
	return service, nil
}

func (s *Service) Submit(ctx context.Context, uid int64, request Request, note Note) (*Job, error) {
	if !s.cfg.Enabled {
		return nil, ErrDisabled
	}
	if uid <= 0 {
		return nil, errors.New("user id is required")
	}
	if err := validateRequest(request, note); err != nil {
		return nil, err
	}
	profile, ok := s.profileFor(uid, request.Profile, request.Vault)
	if !ok {
		return nil, errors.New("transfer profile is not available for this user and Vault")
	}
	if request.Live && !profile.AllowLive {
		return nil, errors.New("live publishing is not enabled for this profile")
	}

	contentHash := sha256.Sum256([]byte(note.Content))
	key := flightKey(uid, request.Profile, request.Vault, request.Path)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, ErrClosed
	}
	if _, exists := s.inFlight[key]; exists {
		return nil, ErrDuplicate
	}
	var count int64
	if err := s.db.WithContext(ctx).Model(&jobRecord{}).
		Where("uid = ? AND profile = ? AND vault = ? AND path = ? AND status IN ?", uid, request.Profile, request.Vault, request.Path, []string{"queued", "running"}).Count(&count).Error; err != nil {
		return nil, fmt.Errorf("check transfer jobs: %w", err)
	}
	if count > 0 {
		return nil, ErrDuplicate
	}

	job := &jobRecord{
		ID:            newID(),
		UID:           uid,
		Vault:         request.Vault,
		Path:          request.Path,
		Profile:       request.Profile,
		Provider:      profile.Provider,
		Live:          request.Live,
		Force:         request.Force,
		ContentSHA256: hex.EncodeToString(contentHash[:]),
		Status:        "queued",
		CreatedAt:     time.Now().UTC(),
		UpdatedAt:     time.Now().UTC(),
	}
	if err := s.db.WithContext(ctx).Create(job).Error; err != nil {
		return nil, fmt.Errorf("create transfer job: %w", err)
	}
	s.inFlight[key] = struct{}{}
	input := PublishInput{
		JobID:   job.ID,
		UID:     uid,
		Vault:   request.Vault,
		Path:    request.Path,
		Content: note.Content,
		Mtime:   note.Mtime,
		Live:    request.Live,
		Force:   request.Force,
		Profile: profile,
	}
	select {
	case s.queue <- task{jobID: job.ID, input: input}:
		return toJob(job), nil
	default:
		failureCode, failureMessage := failureDetails("queue_full")
		if err := s.db.Model(&jobRecord{}).Where("id = ?", job.ID).Updates(map[string]any{
			"status":          "failed",
			"failure_code":    failureCode,
			"failure_message": failureMessage,
			"finished_at":     time.Now().UTC(),
			"updated_at":      time.Now().UTC(),
		}).Error; err != nil {
			return nil, fmt.Errorf("record full transfer queue: %w", err)
		}
		delete(s.inFlight, key)
		return nil, ErrQueueFull
	}
}

func (s *Service) Get(ctx context.Context, uid int64, id string) (*Job, error) {
	var record jobRecord
	if err := s.db.WithContext(ctx).Where("uid = ? AND id = ?", uid, id).First(&record).Error; err != nil {
		return nil, err
	}
	return toJob(&record), nil
}

func (s *Service) List(ctx context.Context, uid int64, vault string, page, pageSize int) ([]*Job, int64, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	query := s.db.WithContext(ctx).Model(&jobRecord{}).Where("uid = ?", uid)
	if vault != "" {
		query = query.Where("vault = ?", vault)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var records []jobRecord
	if err := query.Order("created_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&records).Error; err != nil {
		return nil, 0, err
	}
	jobs := make([]*Job, 0, len(records))
	for index := range records {
		jobs = append(jobs, toJob(&records[index]))
	}
	return jobs, total, nil
}

func (s *Service) Profiles(uid int64, vault string) []Profile {
	profiles := make([]Profile, 0)
	for _, profile := range s.profileSnapshot() {
		if profile.UID == uid && (vault == "" || profile.Vault == vault) {
			profiles = append(profiles, Profile{ID: profile.ID, Vault: profile.Vault, Provider: profile.Provider, AllowLive: profile.AllowLive})
		}
	}
	sort.Slice(profiles, func(left, right int) bool { return profiles[left].ID < profiles[right].ID })
	return profiles
}

func (s *Service) ManagedProfiles() []ManagedProfile {
	profiles := s.profileSnapshot()
	result := make([]ManagedProfile, 0, len(profiles))
	for _, profile := range profiles {
		result = append(result, toManagedProfile(profile))
	}
	sortManagedProfiles(result)
	return result
}

func (s *Service) CreateProfile(ctx context.Context, profile config.TransferProfile) (*ManagedProfile, error) {
	if err := s.validateManagedProfile(profile); err != nil {
		return nil, err
	}
	profile.Credentials = normalizeCredentials(profile.Credentials)
	envJSON, err := json.Marshal(profile.Env)
	if err != nil {
		return nil, fmt.Errorf("encode transfer profile environment: %w", err)
	}
	credentialsJSON, err := s.credentials.encode(profile.UID, profile.ID, profile.Credentials)
	if err != nil {
		return nil, fmt.Errorf("encrypt transfer profile credentials: %w", err)
	}
	now := time.Now().UTC()
	record := &profileRecord{
		ID: profile.ID, UID: profile.UID, Vault: profile.Vault, Provider: profile.Provider,
		AllowLive: profile.AllowLive, EnvJSON: string(envJSON), CredentialsJSON: credentialsJSON, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.db.WithContext(ctx).Create(record).Error; err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) || strings.Contains(strings.ToLower(err.Error()), "unique") {
			return nil, ErrProfileExists
		}
		return nil, fmt.Errorf("create transfer profile: %w", err)
	}
	s.profileMu.Lock()
	s.profiles[profile.ID] = cloneTransferProfile(profile)
	s.profileMu.Unlock()
	managed := toManagedProfile(profile)
	return &managed, nil
}

func (s *Service) UpdateProfile(ctx context.Context, id string, profile config.TransferProfile) (*ManagedProfile, error) {
	if strings.TrimSpace(id) == "" || id != profile.ID {
		return nil, errors.New("profile id cannot be changed")
	}
	var existingRecord profileRecord
	if err := s.db.WithContext(ctx).Where("id = ?", id).First(&existingRecord).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrProfileNotFound
		}
		return nil, fmt.Errorf("load transfer profile: %w", err)
	}
	existing, err := s.profileFromRecord(existingRecord)
	if err != nil {
		return nil, err
	}
	if profile.Provider == existing.Provider {
		if len(profile.Env) == 0 {
			profile.Env = cloneStringMap(existing.Env)
		}
		profile.Credentials = mergeCredentials(existing.Credentials, profile.Credentials)
	}
	profile.Credentials = normalizeCredentials(profile.Credentials)
	if err := s.validateManagedProfile(profile); err != nil {
		return nil, err
	}
	envJSON, err := json.Marshal(profile.Env)
	if err != nil {
		return nil, fmt.Errorf("encode transfer profile environment: %w", err)
	}
	credentialsJSON, err := s.credentials.encode(profile.UID, profile.ID, profile.Credentials)
	if err != nil {
		return nil, fmt.Errorf("encrypt transfer profile credentials: %w", err)
	}
	result := s.db.WithContext(ctx).Model(&profileRecord{}).Where("id = ?", id).Updates(map[string]any{
		"uid": profile.UID, "vault": profile.Vault, "provider": profile.Provider,
		"allow_live": profile.AllowLive, "env_json": string(envJSON), "credentials_json": credentialsJSON, "updated_at": time.Now().UTC(),
	})
	if result.Error != nil {
		return nil, fmt.Errorf("update transfer profile: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return nil, ErrProfileNotFound
	}
	s.profileMu.Lock()
	s.profiles[id] = cloneTransferProfile(profile)
	s.profileMu.Unlock()
	managed := toManagedProfile(profile)
	return &managed, nil
}

func (s *Service) DeleteProfile(ctx context.Context, id string) error {
	if strings.TrimSpace(id) == "" {
		return ErrProfileNotFound
	}
	result := s.db.WithContext(ctx).Where("id = ?", id).Delete(&profileRecord{})
	if result.Error != nil {
		return fmt.Errorf("delete transfer profile: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return ErrProfileNotFound
	}
	s.profileMu.Lock()
	delete(s.profiles, id)
	s.profileMu.Unlock()
	return nil
}

func (s *Service) Shutdown(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	s.closeOnce.Do(func() {
		s.mu.Lock()
		s.closed = true
		s.mu.Unlock()
		s.cancel()
		_ = s.db.Model(&jobRecord{}).Where("status = ?", "queued").Updates(map[string]any{
			"status":          "interrupted",
			"failure_code":    "shutdown",
			"failure_message": "job was interrupted during service shutdown",
			"finished_at":     time.Now().UTC(),
			"updated_at":      time.Now().UTC(),
		})
	})
	select {
	case <-s.workerDone:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Service) worker() {
	defer close(s.workerDone)
	for {
		select {
		case <-s.ctx.Done():
			return
		default:
		}
		select {
		case <-s.ctx.Done():
			return
		case work := <-s.queue:
			s.process(work)
		}
	}
}

func (s *Service) process(work task) {
	if s.ctx.Err() != nil {
		s.finish(work, "interrupted", "shutdown", "", "")
		return
	}
	now := time.Now().UTC()
	if err := s.db.Model(&jobRecord{}).Where("id = ? AND status = ?", work.jobID, "queued").Updates(map[string]any{
		"status":     "running",
		"started_at": now,
		"updated_at": now,
	}).Error; err != nil {
		s.finish(work, "failed", "database", "", "")
		return
	}
	jobContext, cancel := context.WithTimeout(s.ctx, time.Duration(s.cfg.TimeoutSeconds)*time.Second)
	result, err := s.runner.Run(jobContext, work.input)
	cancel()
	if err == nil {
		if result.Status == "" {
			s.finish(work, "failed", "runner", "", "")
			return
		}
		s.finish(work, result.Status, "", result.ExternalID, result.ExternalURL)
		return
	}
	var runnerError *RunnerError
	if errors.As(err, &runnerError) {
		status := "failed"
		if runnerError.Uncertain || runnerError.Code == "uncertain" || runnerError.Code == "timeout" && work.input.Live {
			status = "uncertain"
		}
		s.finish(work, status, runnerError.Code, runnerError.ExternalID, "")
		return
	}
	if errors.Is(err, context.DeadlineExceeded) {
		status := "failed"
		if work.input.Live {
			status = "uncertain"
		}
		s.finish(work, status, "timeout", "", "")
		return
	}
	status := "failed"
	failureCode := "runner"
	if errors.Is(err, context.Canceled) {
		status = "interrupted"
		failureCode = "shutdown"
		if work.input.Live {
			status = "uncertain"
		}
	}
	s.finish(work, status, failureCode, "", "")
}

func (s *Service) finish(work task, status, failureCode, externalID, externalURL string) {
	updates := map[string]any{
		"status":       status,
		"external_id":  externalID,
		"external_url": externalURL,
		"updated_at":   time.Now().UTC(),
		"finished_at":  time.Now().UTC(),
	}
	if failureCode != "" {
		_, message := failureDetails(failureCode)
		updates["failure_code"] = failureCode
		updates["failure_message"] = message
	} else {
		updates["failure_code"] = ""
		updates["failure_message"] = ""
	}
	_ = s.db.Model(&jobRecord{}).Where("id = ?", work.jobID).Updates(updates)
	key := flightKey(work.input.UID, work.input.Profile.ID, work.input.Vault, work.input.Path)
	s.mu.Lock()
	delete(s.inFlight, key)
	s.mu.Unlock()
}

func (s *Service) profileFor(uid int64, id, vault string) (config.TransferProfile, bool) {
	for _, profile := range s.profileSnapshot() {
		if profile.UID == uid && profile.ID == id && profile.Vault == vault {
			return profile, true
		}
	}
	return config.TransferProfile{}, false
}

func (s *Service) profileSnapshot() []config.TransferProfile {
	s.profileMu.RLock()
	defer s.profileMu.RUnlock()
	profiles := make([]config.TransferProfile, 0, len(s.profiles))
	for _, profile := range s.profiles {
		profiles = append(profiles, cloneTransferProfile(profile))
	}
	return profiles
}

func (s *Service) validateManagedProfile(profile config.TransferProfile) error {
	if err := validateProfileShape(profile); err != nil {
		return err
	}
	if profile.AllowLive {
		if s.cfg.ProjectPath == "" {
			return errors.New("transfer project-path is required by live profiles")
		}
		required := []string{"TRANSFER_NOTION_API_KEY", "TRANSFER_NOTION_PARENT_ID"}
		if profile.Provider == "feishu" {
			required = []string{"TRANSFER_FEISHU_APP_ID", "TRANSFER_FEISHU_APP_SECRET"}
		}
		for _, target := range required {
			if strings.TrimSpace(profile.Env[target]) == "" && strings.TrimSpace(profile.Credentials[target]) == "" {
				return fmt.Errorf("transfer live profile %s requires a credential for %s", profile.ID, target)
			}
		}
	}
	return nil
}

func seedProfiles(db *gorm.DB, profiles []config.TransferProfile, credentials *credentialStore) error {
	if len(profiles) == 0 {
		return nil
	}
	var count int64
	if err := db.Model(&profileRecord{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	for _, profile := range profiles {
		if err := validateProfileShape(profile); err != nil {
			return err
		}
		envJSON, err := json.Marshal(profile.Env)
		if err != nil {
			return err
		}
		profile.Credentials = normalizeCredentials(profile.Credentials)
		credentialsJSON, err := credentials.encode(profile.UID, profile.ID, profile.Credentials)
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		if err := db.Create(&profileRecord{ID: profile.ID, UID: profile.UID, Vault: profile.Vault, Provider: profile.Provider, AllowLive: profile.AllowLive, EnvJSON: string(envJSON), CredentialsJSON: credentialsJSON, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
			return err
		}
	}
	return nil
}

func loadProfiles(db *gorm.DB, credentials *credentialStore) (map[string]config.TransferProfile, error) {
	var records []profileRecord
	if err := db.Find(&records).Error; err != nil {
		return nil, err
	}
	profiles := make(map[string]config.TransferProfile, len(records))
	for _, record := range records {
		profile, err := decodeProfileRecord(record, credentials)
		if err != nil {
			return nil, fmt.Errorf("decode profile %s credentials: %w", record.ID, err)
		}
		profiles[record.ID] = profile
	}
	return profiles, nil
}

func decodeProfileRecord(record profileRecord, credentials *credentialStore) (config.TransferProfile, error) {
	var env map[string]string
	if strings.TrimSpace(record.EnvJSON) != "" {
		if err := json.Unmarshal([]byte(record.EnvJSON), &env); err != nil {
			return config.TransferProfile{}, fmt.Errorf("decode environment: %w", err)
		}
	}
	if env == nil {
		env = map[string]string{}
	}
	values, err := credentials.decode(record.UID, record.ID, record.CredentialsJSON)
	if err != nil {
		return config.TransferProfile{}, err
	}
	return config.TransferProfile{ID: record.ID, UID: record.UID, Vault: record.Vault, Provider: record.Provider, AllowLive: record.AllowLive, Env: env, Credentials: values}, nil
}

func validateProfileShape(profile config.TransferProfile) error {
	validID := regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
	validEnv := regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)
	if !validID.MatchString(profile.ID) || profile.UID <= 0 || strings.TrimSpace(profile.Vault) == "" || len(profile.Vault) > 255 {
		return errors.New("transfer profiles require a valid id, positive UID and Vault")
	}
	if profile.Provider != "notion" && profile.Provider != "feishu" {
		return errors.New("transfer provider must be notion or feishu")
	}
	allowed := map[string]bool{"TRANSFER_NOTION_API_KEY": true, "TRANSFER_NOTION_PARENT_ID": true}
	if profile.Provider == "feishu" {
		allowed = map[string]bool{"TRANSFER_FEISHU_APP_ID": true, "TRANSFER_FEISHU_APP_SECRET": true, "TRANSFER_FEISHU_FOLDER_TOKEN": true, "TRANSFER_FEISHU_USER_ACCESS_TOKEN": true}
	}
	for target, source := range profile.Env {
		if !allowed[target] || !validEnv.MatchString(source) {
			return errors.New("transfer profile environment must use provider-specific targets and environment variable names")
		}
	}
	for target, value := range profile.Credentials {
		if !allowed[target] || strings.TrimSpace(value) == "" || len(value) > 8192 {
			return errors.New("transfer profile credentials must use provider-specific fields")
		}
	}
	return nil
}

func cloneTransferProfile(profile config.TransferProfile) config.TransferProfile {
	clone := profile
	clone.Env = make(map[string]string, len(profile.Env))
	for key, value := range profile.Env {
		clone.Env[key] = value
	}
	clone.Credentials = make(map[string]string, len(profile.Credentials))
	for key, value := range profile.Credentials {
		clone.Credentials[key] = value
	}
	return clone
}

func toManagedProfile(profile config.TransferProfile) ManagedProfile {
	status := make(map[string]bool)
	for _, target := range credentialTargets(profile.Provider) {
		status[target] = strings.TrimSpace(profile.Credentials[target]) != "" || strings.TrimSpace(profile.Env[target]) != ""
	}
	return ManagedProfile{ID: profile.ID, UID: profile.UID, Vault: profile.Vault, Provider: profile.Provider, AllowLive: profile.AllowLive, Env: cloneStringMap(profile.Env), CredentialStatus: status}
}

func cloneStringMap(values map[string]string) map[string]string {
	clone := make(map[string]string, len(values))
	for key, value := range values {
		clone[key] = value
	}
	return clone
}

func normalizeCredentials(values map[string]string) map[string]string {
	normalized := make(map[string]string, len(values))
	for key, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			normalized[key] = trimmed
		}
	}
	return normalized
}

func mergeCredentials(previous, incoming map[string]string) map[string]string {
	merged := normalizeCredentials(previous)
	for key, value := range normalizeCredentials(incoming) {
		merged[key] = value
	}
	return merged
}

func credentialTargets(provider string) []string {
	if provider == "feishu" {
		return []string{"TRANSFER_FEISHU_APP_ID", "TRANSFER_FEISHU_APP_SECRET", "TRANSFER_FEISHU_USER_ACCESS_TOKEN", "TRANSFER_FEISHU_FOLDER_TOKEN"}
	}
	return []string{"TRANSFER_NOTION_API_KEY", "TRANSFER_NOTION_PARENT_ID"}
}

func (s *Service) profileFromRecord(record profileRecord) (config.TransferProfile, error) {
	profile, err := decodeProfileRecord(record, s.credentials)
	if err != nil {
		return config.TransferProfile{}, fmt.Errorf("decode profile %s: %w", record.ID, err)
	}
	return profile, nil
}

func sortManagedProfiles(profiles []ManagedProfile) {
	sort.Slice(profiles, func(left, right int) bool {
		if profiles[left].UID != profiles[right].UID {
			return profiles[left].UID < profiles[right].UID
		}
		if profiles[left].Vault != profiles[right].Vault {
			return profiles[left].Vault < profiles[right].Vault
		}
		return profiles[left].ID < profiles[right].ID
	})
}

func validateRequest(request Request, note Note) error {
	if strings.TrimSpace(request.Profile) == "" || strings.TrimSpace(request.Vault) == "" || strings.TrimSpace(request.Path) == "" {
		return errors.New("profile, Vault and path are required")
	}
	if request.Path != note.Path {
		return errors.New("note snapshot does not match requested path")
	}
	if filepath.IsAbs(note.Path) || strings.Contains(note.Path, "\\") || filepath.Clean(note.Path) != note.Path || strings.HasPrefix(note.Path, "../") || note.Path == ".." || !strings.EqualFold(filepath.Ext(note.Path), ".md") {
		return errors.New("path must be a clean relative Markdown path")
	}
	if len([]byte(note.Content)) > MaxNoteBytes {
		return errors.New("note content exceeds the 1 MiB limit")
	}
	return nil
}

func flightKey(uid int64, profile, vault, path string) string {
	return fmt.Sprintf("%d\x00%s\x00%s\x00%s", uid, profile, vault, path)
}

func newID() string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return fmt.Sprintf("%x", sha256.Sum256([]byte(time.Now().String())))[:32]
	}
	return hex.EncodeToString(bytes)
}

func toJob(record *jobRecord) *Job {
	return &Job{
		ID:             record.ID,
		UID:            record.UID,
		Vault:          record.Vault,
		Path:           record.Path,
		Profile:        record.Profile,
		Provider:       record.Provider,
		Live:           record.Live,
		Force:          record.Force,
		ContentSHA256:  record.ContentSHA256,
		Status:         record.Status,
		ExternalID:     record.ExternalID,
		ExternalURL:    record.ExternalURL,
		FailureCode:    record.FailureCode,
		FailureMessage: record.FailureMessage,
		CreatedAt:      record.CreatedAt,
		StartedAt:      record.StartedAt,
		FinishedAt:     record.FinishedAt,
		UpdatedAt:      record.UpdatedAt,
	}
}

func failureDetails(code string) (string, string) {
	switch code {
	case "queue_full":
		return code, "transfer queue is full"
	case "database":
		return code, "transfer job storage failed"
	case "timeout":
		return code, "transfer runner timed out"
	case "shutdown":
		return code, "job was interrupted during service shutdown"
	case "restarted":
		return code, "job was interrupted by service restart"
	case "restart_uncertain":
		return code, "remote result is unknown after service restart"
	case "conflict":
		return code, "publication conflict requires explicit force"
	case "blocked":
		return code, "a previous publication requires attention"
	case "uncertain":
		return code, "remote result is uncertain; automatic retry is disabled"
	case "rejected":
		return code, "publication was rejected by the bridge"
	case "credentials":
		return code, "provider credentials are unavailable"
	case "bridge":
		return code, "transfer bridge failed"
	case "runner":
		return code, "transfer runner failed"
	default:
		return "runner", "transfer runner failed"
	}
}
