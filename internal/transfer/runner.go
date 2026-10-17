package transfer

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/haierkeys/fast-note-sync-service/internal/config"
)

const maxRunnerOutput = 128 * 1024

type ProcessRunner struct {
	cfg  config.TransferConfig
	root string
}

func NewProcessRunner(cfg config.TransferConfig) *ProcessRunner {
	cfg.Normalize()
	root := cfg.BridgeRoot
	if root == "" {
		root = "."
	}
	return &ProcessRunner{cfg: cfg, root: root}
}

func (r *ProcessRunner) Run(ctx context.Context, input PublishInput) (PublishResult, error) {
	if input.Live && strings.TrimSpace(r.cfg.ProjectPath) == "" {
		return PublishResult{}, &RunnerError{Code: "rejected", Err: errors.New("live transfer project is not configured")}
	}
	manifestDir, err := os.MkdirTemp("", "fns-transfer-manifest-")
	if err != nil {
		return PublishResult{}, &RunnerError{Code: "runner", Err: errors.New("cannot create private manifest directory")}
	}
	defer os.RemoveAll(manifestDir)
	if err := os.Chmod(manifestDir, 0o700); err != nil {
		return PublishResult{}, &RunnerError{Code: "runner", Err: errors.New("cannot protect private manifest directory")}
	}

	contentHash := sha256.Sum256([]byte(input.Content))
	manifest := map[string]any{
		"version": 1,
		"source": map[string]any{
			"server": r.cfg.SourceURL,
			"uid":    input.UID,
		},
		"vault": input.Vault,
		"note": map[string]any{
			"path":           input.Path,
			"content":        input.Content,
			"content_sha256": hex.EncodeToString(contentHash[:]),
			"mtime":          input.Mtime,
		},
	}
	manifestBytes, err := json.Marshal(manifest)
	if err != nil {
		return PublishResult{}, &RunnerError{Code: "runner", Err: errors.New("cannot encode transfer manifest")}
	}
	manifestPath := filepath.Join(manifestDir, "manifest.json")
	manifestFile, err := os.OpenFile(manifestPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return PublishResult{}, &RunnerError{Code: "runner", Err: errors.New("cannot create private manifest")}
	}
	if _, err := manifestFile.Write(manifestBytes); err != nil {
		_ = manifestFile.Close()
		return PublishResult{}, &RunnerError{Code: "runner", Err: errors.New("cannot write private manifest")}
	}
	if err := manifestFile.Close(); err != nil {
		return PublishResult{}, &RunnerError{Code: "runner", Err: errors.New("cannot close private manifest")}
	}

	stateRoot := r.cfg.StateDir
	if !filepath.IsAbs(stateRoot) {
		stateRoot = filepath.Join(r.root, stateRoot)
	}
	stateDir := filepath.Join(stateRoot, input.Profile.ID)
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		return PublishResult{}, &RunnerError{Code: "runner", Err: errors.New("cannot create transfer state directory")}
	}
	if err := os.Chmod(stateRoot, 0o700); err != nil {
		return PublishResult{}, &RunnerError{Code: "runner", Err: errors.New("cannot protect transfer state directory")}
	}
	if err := os.Chmod(stateDir, 0o700); err != nil {
		return PublishResult{}, &RunnerError{Code: "runner", Err: errors.New("cannot protect profile state directory")}
	}

	args := []string{
		"-m", "integrations.transfer_bridge",
		"--db", filepath.Join(stateDir, "bridge.sqlite3"),
		"--profile", input.Profile.ID,
		"--json-errors",
		"publish", manifestPath,
		"--provider", input.Profile.Provider,
	}
	if input.Live {
		args = append(args, "--live")
	}
	if input.Force {
		args = append(args, "--force")
	}
	env, err := r.environment(input, filepath.Join(stateDir, "bridge.sqlite3"))
	if err != nil {
		return PublishResult{}, err
	}
	command := exec.CommandContext(ctx, r.cfg.Python, args...)
	command.Dir = r.root
	command.Env = env
	command.Stderr = io.Discard
	output := &limitedBuffer{limit: maxRunnerOutput}
	command.Stdout = output
	commandErr := command.Run()
	if output.exceeded {
		return PublishResult{}, &RunnerError{Code: "bridge", Uncertain: input.Live, Err: errors.New("transfer bridge output exceeded the limit")}
	}
	payload := struct {
		Provider      string `json:"provider"`
		Status        string `json:"status"`
		ExternalID    string `json:"external_id"`
		ExternalURL   string `json:"external_url"`
		ContentSHA256 string `json:"content_sha256"`
		Error         string `json:"error"`
	}{}
	if len(bytes.TrimSpace(output.Bytes())) > 0 {
		_ = json.Unmarshal(output.Bytes(), &payload)
	}
	if ctx.Err() != nil {
		return PublishResult{}, &RunnerError{Code: "timeout", Uncertain: input.Live, Err: ctx.Err()}
	}
	if commandErr != nil {
		code := payload.Status
		if code == "" {
			code = "bridge"
		}
		return PublishResult{}, &RunnerError{
			Code:       code,
			ExternalID: payload.ExternalID,
			Uncertain:  code == "uncertain" || input.Live && code == "bridge",
			Err:        errors.New("transfer bridge process failed"),
		}
	}
	if payload.Status == "" {
		return PublishResult{}, &RunnerError{Code: "bridge", Err: errors.New("transfer bridge returned an invalid response")}
	}
	return PublishResult{
		Status:        payload.Status,
		ExternalID:    payload.ExternalID,
		ExternalURL:   payload.ExternalURL,
		ContentSHA256: payload.ContentSHA256,
	}, nil
}

func (r *ProcessRunner) environment(input PublishInput, stateDB string) ([]string, error) {
	allowed := []string{"PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "SSL_CERT_FILE", "SSL_CERT_DIR"}
	env := make([]string, 0, len(allowed)+8)
	for _, name := range allowed {
		if value, ok := os.LookupEnv(name); ok {
			env = append(env, name+"="+value)
		}
	}
	env = append(env,
		"TRANSFER_PROJECT_PATH="+r.cfg.ProjectPath,
		"TRANSFER_STATE_DB="+stateDB,
		"TRANSFER_PROFILE="+input.Profile.ID,
		"PYTHONUNBUFFERED=1",
	)
	if !input.Live {
		return env, nil
	}
	for target, value := range input.Profile.Credentials {
		if strings.TrimSpace(value) == "" {
			continue
		}
		env = append(env, target+"="+value)
	}
	for target, source := range input.Profile.Env {
		if _, configured := input.Profile.Credentials[target]; configured {
			continue
		}
		if strings.TrimSpace(source) == "" {
			continue
		}
		value, ok := os.LookupEnv(source)
		if !ok || strings.TrimSpace(value) == "" {
			if target == "TRANSFER_FEISHU_FOLDER_TOKEN" || target == "TRANSFER_FEISHU_USER_ACCESS_TOKEN" {
				continue
			}
			return nil, &RunnerError{Code: "credentials", Err: errors.New("configured provider environment is unavailable")}
		}
		env = append(env, target+"="+value)
	}
	return env, nil
}

type limitedBuffer struct {
	bytes.Buffer
	limit    int
	exceeded bool
}

func (b *limitedBuffer) Write(value []byte) (int, error) {
	remaining := b.limit - b.Len()
	if remaining <= 0 {
		b.exceeded = true
		return len(value), nil
	}
	if len(value) > remaining {
		_, _ = b.Buffer.Write(value[:remaining])
		b.exceeded = true
		return len(value), nil
	}
	return b.Buffer.Write(value)
}

var _ Runner = (*ProcessRunner)(nil)
