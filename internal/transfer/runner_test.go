package transfer

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/haierkeys/fast-note-sync-service/internal/config"
	"github.com/stretchr/testify/require"
)

func TestProcessRunnerDryRunUsesPrivateBridgeState(t *testing.T) {
	root, err := os.Getwd()
	require.NoError(t, err)
	root = filepath.Clean(filepath.Join(root, "../.."))
	stateDir := t.TempDir()
	runner := NewProcessRunner(config.TransferConfig{
		Enabled:        true,
		Python:         "python3",
		BridgeRoot:     root,
		StateDir:       stateDir,
		SourceURL:      "https://fns.example.test",
		QueueCapacity:  1,
		TimeoutSeconds: 5,
	})
	result, err := runner.Run(context.Background(), PublishInput{
		JobID:   "job-1",
		UID:     7,
		Vault:   "vault",
		Path:    "docs/hello.md",
		Content: "# hello",
		Profile: config.TransferProfile{ID: "demo", Provider: "feishu"},
	})
	require.NoError(t, err)
	require.Equal(t, "dry-run", result.Status)
	_, err = os.Stat(filepath.Join(stateDir, "demo", "bridge.sqlite3"))
	require.NoError(t, err)
}

func TestProcessRunnerRemovesTemporaryManifest(t *testing.T) {
	root, err := os.Getwd()
	require.NoError(t, err)
	root = filepath.Clean(filepath.Join(root, "../.."))
	directory := t.TempDir()
	scriptPath := filepath.Join(directory, "fake-python")
	script := "#!/bin/sh\n" +
		"for arg in \"$@\"; do\n" +
		"  case \"$arg\" in\n" +
		"    */fns-transfer-manifest-*/manifest.json) printf '%s' \"$arg\" > \"$(dirname \"$0\")/manifest-path\" ;;\n" +
		"  esac\n" +
		"done\n" +
		"printf '%s\\n' '{\"status\":\"dry-run\",\"external_id\":\"\",\"external_url\":\"\",\"content_sha256\":\"\"}'\n"
	require.NoError(t, os.WriteFile(scriptPath, []byte(script), 0o700))
	runner := NewProcessRunner(config.TransferConfig{
		Enabled:        true,
		Python:         scriptPath,
		BridgeRoot:     root,
		StateDir:       filepath.Join(directory, "state"),
		SourceURL:      "https://fns.example.test",
		QueueCapacity:  1,
		TimeoutSeconds: 5,
	})
	_, err = runner.Run(context.Background(), PublishInput{
		UID:     7,
		Vault:   "vault",
		Path:    "docs/hello.md",
		Content: "# hello",
		Profile: config.TransferProfile{ID: "demo", Provider: "feishu"},
	})
	require.NoError(t, err)
	manifestPath, err := os.ReadFile(filepath.Join(directory, "manifest-path"))
	require.NoError(t, err)
	_, err = os.Stat(string(manifestPath))
	require.ErrorIs(t, err, os.ErrNotExist)
}

func TestProcessRunnerInjectsDirectCredentials(t *testing.T) {
	root, err := os.Getwd()
	require.NoError(t, err)
	root = filepath.Clean(filepath.Join(root, "../.."))
	directory := t.TempDir()
	scriptPath := filepath.Join(directory, "fake-python")
	script := "#!/bin/sh\n" +
		"printf '%s\n' \"$TRANSFER_FEISHU_APP_ID\" \"$TRANSFER_FEISHU_APP_SECRET\" > \"$(dirname \"$0\")/provider-env\"\n" +
		"printf '%s\n' '{\"status\":\"created\"}'\n"
	require.NoError(t, os.WriteFile(scriptPath, []byte(script), 0o700))
	t.Setenv("TRANSFER_FEISHU_APP_ID", "host-value-should-not-win")
	runner := NewProcessRunner(config.TransferConfig{
		Enabled: true, Python: scriptPath, BridgeRoot: root, StateDir: filepath.Join(directory, "state"),
		SourceURL: "https://fns.example.test", ProjectPath: root, QueueCapacity: 1, TimeoutSeconds: 5,
	})
	_, err = runner.Run(context.Background(), PublishInput{
		UID: 7, Vault: "vault", Path: "docs/hello.md", Content: "# hello", Live: true,
		Profile: config.TransferProfile{
			ID: "demo", Provider: "feishu",
			Credentials: map[string]string{
				"TRANSFER_FEISHU_APP_ID":     "direct-app-id",
				"TRANSFER_FEISHU_APP_SECRET": "direct-app-secret",
			},
		},
	})
	require.NoError(t, err)
	providerEnv, err := os.ReadFile(filepath.Join(directory, "provider-env"))
	require.NoError(t, err)
	require.Equal(t, "direct-app-id\ndirect-app-secret\n", string(providerEnv))
}

func TestProcessRunnerRejectsMissingLiveEnvironment(t *testing.T) {
	root, err := os.Getwd()
	require.NoError(t, err)
	root = filepath.Clean(filepath.Join(root, "../.."))
	runner := NewProcessRunner(config.TransferConfig{
		Enabled:        true,
		Python:         "python3",
		BridgeRoot:     root,
		StateDir:       t.TempDir(),
		SourceURL:      "https://fns.example.test",
		ProjectPath:    root,
		QueueCapacity:  1,
		TimeoutSeconds: 5,
	})
	_, err = runner.Run(context.Background(), PublishInput{
		UID:   7,
		Vault: "vault",
		Path:  "docs/hello.md",
		Live:  true,
		Profile: config.TransferProfile{
			ID:       "demo",
			Provider: "feishu",
			Env: map[string]string{
				"TRANSFER_FEISHU_APP_ID":     "MISSING_TRANSFER_APP_ID",
				"TRANSFER_FEISHU_APP_SECRET": "MISSING_TRANSFER_APP_SECRET",
			},
		},
	})
	var runnerError *RunnerError
	require.ErrorAs(t, err, &runnerError)
	require.Equal(t, "credentials", runnerError.Code)
}
