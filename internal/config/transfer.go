package config

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

type TransferConfig struct {
	Enabled        bool              `yaml:"enabled"`
	Python         string            `yaml:"python" default:"python3"`
	BridgeRoot     string            `yaml:"bridge-root" default:"."`
	ProjectPath    string            `yaml:"project-path"`
	StateDir       string            `yaml:"state-dir" default:"storage/transfer"`
	SourceURL      string            `yaml:"source-url"`
	QueueCapacity  int               `yaml:"queue-capacity" default:"16"`
	TimeoutSeconds int               `yaml:"timeout-seconds" default:"120"`
	Profiles       []TransferProfile `yaml:"profiles"`
}

type TransferProfile struct {
	ID          string            `yaml:"id" json:"id"`
	UID         int64             `yaml:"uid" json:"-"`
	Vault       string            `yaml:"vault" json:"vault"`
	Provider    string            `yaml:"provider" json:"provider"`
	AllowLive   bool              `yaml:"allow-live" json:"allowLive"`
	Env         map[string]string `yaml:"env" json:"-"`
	Credentials map[string]string `yaml:"-" json:"-"`
}

func (cfg *TransferConfig) Normalize() {
	if cfg.Python == "" {
		cfg.Python = "python3"
	}
	if cfg.BridgeRoot == "" {
		cfg.BridgeRoot = "."
	}
	if cfg.StateDir == "" {
		cfg.StateDir = "storage/transfer"
	}
	if cfg.QueueCapacity == 0 {
		cfg.QueueCapacity = 16
	}
	if cfg.TimeoutSeconds == 0 {
		cfg.TimeoutSeconds = 120
	}
}

func (cfg TransferConfig) Validate() error {
	if !cfg.Enabled {
		return nil
	}
	if cfg.QueueCapacity < 1 || cfg.QueueCapacity > 256 || cfg.TimeoutSeconds < 1 || cfg.TimeoutSeconds > 600 {
		return fmt.Errorf("transfer queue-capacity must be 1..256 and timeout-seconds must be 1..600")
	}
	parsed, err := url.Parse(cfg.SourceURL)
	if err != nil || parsed.Hostname() == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("transfer source-url must be a stable HTTP(S) URL without credentials, query or fragment")
	}
	validID := regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
	validEnv := regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)
	seen := make(map[string]bool)
	for _, profile := range cfg.Profiles {
		if !validID.MatchString(profile.ID) || seen[profile.ID] || profile.UID <= 0 || strings.TrimSpace(profile.Vault) == "" || len(profile.Vault) > 255 {
			return fmt.Errorf("transfer profiles require unique IDs, a positive UID and a Vault")
		}
		seen[profile.ID] = true
		if profile.Provider != "notion" && profile.Provider != "feishu" {
			return fmt.Errorf("transfer provider must be notion or feishu")
		}
		allowed := map[string]bool{"TRANSFER_NOTION_API_KEY": true, "TRANSFER_NOTION_PARENT_ID": true}
		required := []string{"TRANSFER_NOTION_API_KEY", "TRANSFER_NOTION_PARENT_ID"}
		if profile.Provider == "feishu" {
			allowed = map[string]bool{"TRANSFER_FEISHU_APP_ID": true, "TRANSFER_FEISHU_APP_SECRET": true, "TRANSFER_FEISHU_FOLDER_TOKEN": true, "TRANSFER_FEISHU_USER_ACCESS_TOKEN": true}
			required = []string{"TRANSFER_FEISHU_APP_ID", "TRANSFER_FEISHU_APP_SECRET"}
		}
		for target, source := range profile.Env {
			if !allowed[target] || !validEnv.MatchString(source) {
				return fmt.Errorf("transfer profile environment must use provider-specific targets and environment variable names")
			}
		}
		for target, value := range profile.Credentials {
			if !allowed[target] || strings.TrimSpace(value) == "" || len(value) > 8192 {
				return fmt.Errorf("transfer profile credentials must use provider-specific fields")
			}
		}
		if profile.AllowLive {
			if cfg.ProjectPath == "" {
				return fmt.Errorf("transfer project-path is required by live profiles")
			}
			for _, target := range required {
				if strings.TrimSpace(profile.Env[target]) == "" && strings.TrimSpace(profile.Credentials[target]) == "" {
					return fmt.Errorf("transfer live profile %s requires a credential for %s", profile.ID, target)
				}
			}
		}
	}
	return nil
}
