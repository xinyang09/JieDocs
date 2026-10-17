package config

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestTransferConfigNormalizeDefaults(t *testing.T) {
	cfg := TransferConfig{}
	cfg.Normalize()
	require.Equal(t, "python3", cfg.Python)
	require.Equal(t, ".", cfg.BridgeRoot)
	require.Equal(t, "storage/transfer", cfg.StateDir)
	require.Equal(t, 16, cfg.QueueCapacity)
	require.Equal(t, 120, cfg.TimeoutSeconds)
	require.NoError(t, cfg.Validate())
}

func TestTransferConfigRejectsInvalidEnabledProfiles(t *testing.T) {
	cfg := TransferConfig{Enabled: true, SourceURL: "https://fns.example.test", Profiles: []TransferProfile{{
		ID: "demo", UID: 7, Vault: "vault", Provider: "feishu", Env: map[string]string{"TRANSFER_NOTION_API_KEY": "SECRET"},
	}}}
	cfg.Normalize()
	require.Error(t, cfg.Validate())
}

func TestTransferConfigRequiresLiveEnvironmentReferences(t *testing.T) {
	cfg := TransferConfig{Enabled: true, SourceURL: "https://fns.example.test", ProjectPath: "/srv/transfer", Profiles: []TransferProfile{{
		ID: "demo", UID: 7, Vault: "vault", Provider: "notion", AllowLive: true,
	}}}
	cfg.Normalize()
	require.Error(t, cfg.Validate())
	cfg.Profiles[0].Env = map[string]string{
		"TRANSFER_NOTION_API_KEY":   "FNS_NOTION_KEY",
		"TRANSFER_NOTION_PARENT_ID": "FNS_NOTION_PARENT",
	}
	require.NoError(t, cfg.Validate())
}
