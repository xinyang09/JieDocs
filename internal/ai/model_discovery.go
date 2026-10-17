package ai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
	"unicode"
)

// ListModels reads a provider's catalog without executing a model or changing
// the saved default. Credentials remain in this server-side request only.
func (e *OpenAIExecutor) ListModels(parent context.Context) ([]ChatModel, error) {
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, min(e.timeout, 10*time.Second))
	defer cancel()
	endpoint, err := modelCatalogEndpoint(e.config, e.allowPrivate)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, ErrOpenAIRequest
	}
	req.Header.Set("Accept", "application/json")
	if e.config.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+e.config.APIKey)
	}
	client := *e.client
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return ErrOpenAIRedirect }
	response, err := client.Do(req)
	if err != nil {
		switch {
		case errors.Is(ctx.Err(), context.DeadlineExceeded), errors.Is(err, context.DeadlineExceeded):
			return nil, ErrOpenAITimeout
		case errors.Is(ctx.Err(), context.Canceled):
			return nil, context.Canceled
		case errors.Is(err, ErrOpenAIRedirect):
			return nil, ErrOpenAIRedirect
		default:
			return nil, ErrOpenAIUnavailable
		}
	}
	defer response.Body.Close()
	body, err := readOpenAIResponse(response.Body, e.maxResponse)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, &OpenAIHTTPError{StatusCode: response.StatusCode}
	}
	ids, err := parseModelCatalog(body, e.config.Type)
	if err != nil {
		return nil, err
	}
	models := make([]ChatModel, 0, len(ids))
	for _, id := range ids {
		models = append(models, ChatModel{Provider: "custom:" + e.config.ID, ID: id, DisplayName: id, ProviderName: e.config.Name})
	}
	return models, nil
}

func modelCatalogEndpoint(config ProviderConfig, allowPrivate bool) (string, error) {
	// Reuse the execution endpoint's URL and private-address validation before
	// deriving a sibling catalog URL, preserving any configured proxy prefix.
	endpoint, err := completionEndpoint(config.BaseURL, allowPrivate)
	if err != nil {
		return "", err
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return "", ErrOpenAIRequest
	}
	path := strings.TrimSuffix(parsed.Path, "/chat/completions")
	path = strings.TrimSuffix(path, "/models")
	if config.Type == ProviderTypeOllama {
		path = strings.TrimSuffix(path, "/api/tags")
		path = strings.TrimSuffix(path, "/v1")
		path += "/api/tags"
	} else {
		path += "/models"
	}
	parsed.Path, parsed.RawPath = path, ""
	return parsed.String(), nil
}

func parseModelCatalog(body []byte, providerType string) ([]string, error) {
	var envelope struct {
		Data   json.RawMessage `json:"data"`
		Models json.RawMessage `json:"models"`
	}
	if json.Unmarshal(body, &envelope) != nil {
		return nil, ErrOpenAIProtocol
	}
	var entries []struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Model string `json:"model"`
	}
	list := envelope.Data
	if providerType == ProviderTypeOllama {
		list = envelope.Models
	}
	if len(list) == 0 || string(list) == "null" || json.Unmarshal(list, &entries) != nil {
		return nil, ErrOpenAIProtocol
	}
	if len(entries) > 1024 {
		return nil, ErrOpenAIResponseLimit
	}
	seen := make(map[string]struct{}, len(entries))
	ids := make([]string, 0, len(entries))
	for _, entry := range entries {
		id := entry.ID
		if providerType == ProviderTypeOllama {
			id = entry.Name
			if strings.TrimSpace(id) == "" {
				id = entry.Model
			}
		}
		if strings.IndexFunc(id, unicode.IsControl) >= 0 {
			continue
		}
		id = strings.TrimSpace(id)
		if id == "" || len(id) > maxProviderModel {
			continue
		}
		if _, exists := seen[id]; !exists {
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids, nil
}
