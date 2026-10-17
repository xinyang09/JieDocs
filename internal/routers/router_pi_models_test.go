package routers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestParsePiModels(t *testing.T) {
	output := "provider model context max-out thinking images\nwarning: diagnostic\n\x1b[32mfirst shared-model 128K 8K yes no\x1b[0m\nfirst shared-model 128K 8K yes no\nsecond shared-model 128K 8K no yes\n"
	want := []piModel{{Provider: "first", ID: "shared-model"}, {Provider: "second", ID: "shared-model"}}
	if got := parsePiModels(output); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
	if got := parsePiModels("No models available"); got == nil || len(got) != 0 {
		t.Fatalf("empty list should serialize as an array: %#v", got)
	}
}

func fakePiModels(t *testing.T) string {
	t.Helper()
	directory := t.TempDir()
	binary := filepath.Join(directory, "pi")
	argsPath := filepath.Join(directory, "args")
	script := `#!/bin/sh
	if [ "$1" = "--offline" ]; then
  printf 'provider model context max-out thinking images\nfirst shared-model 128K 8K yes no\nsecond shared-model 128K 8K no yes\n'
  exit 0
fi
printf '%s\n' "$@" > "$PI_TEST_ARGS"
printf '{"type":"message_end","message":{"role":"assistant","content":"test reply"}}\n'
`
	if err := os.WriteFile(binary, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PI_BIN", binary)
	t.Setenv("PI_TEST_ARGS", argsPath)
	return argsPath
}

func TestPiModelRoutes(t *testing.T) {
	argsPath := fakePiModels(t)
	router := gin.New()
	registerPiAIRoute(router)
	list := httptest.NewRecorder()
	router.ServeHTTP(list, httptest.NewRequest(http.MethodGet, "/pi-models", nil))
	if list.Code != http.StatusOK || list.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("list failed: %d %s", list.Code, list.Body.String())
	}
	if list.Header().Get("Deprecation") != "true" || list.Header().Get("X-AI-Endpoint") != "/api/ai/execute" {
		t.Fatalf("legacy endpoint headers missing: %#v", list.Header())
	}
	var payload struct {
		Models []piModel `json:"models"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &payload); err != nil || len(payload.Models) != 2 {
		t.Fatalf("invalid model response: %s", list.Body.String())
	}
	for _, stream := range []bool{false, true} {
		body, _ := json.Marshal(gin.H{"instruction": "test", "provider": "second", "model": "shared-model", "stream": stream})
		request := httptest.NewRequest(http.MethodPost, "/pi-ai", strings.NewReader(string(body)))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "test reply") {
			t.Fatalf("generation failed: %d %s", response.Code, response.Body.String())
		}
		arguments, err := os.ReadFile(argsPath)
		if err != nil || !strings.Contains(string(arguments), "--provider\nsecond\n--model\nshared-model\n") {
			t.Fatalf("selection not passed to CLI: %s (%v)", arguments, err)
		}
	}
}

func TestPiSelectionRejectsUnavailableModels(t *testing.T) {
	argsPath := fakePiModels(t)
	for _, selection := range []piModel{{Provider: "first"}, {ID: "shared-model"}, {Provider: "missing", ID: "shared-model"}, {Provider: "first", ID: "--help"}} {
		if _, err := piSelectionArgs(context.Background(), selection.Provider, selection.ID); err == nil {
			t.Fatalf("accepted invalid selection: %#v", selection)
		}
	}
	if _, err := os.Stat(argsPath); !os.IsNotExist(err) {
		t.Fatal("invalid selection started generation")
	}
	t.Setenv("PI_BIN", "/nonexistent/pi")
	args, err := piSelectionArgs(context.Background(), "", "")
	if err != nil || len(args) != 0 {
		t.Fatal("default model must retain existing CLI behavior")
	}
	router := gin.New()
	registerPiAIRoute(router)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/pi-models", nil))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("missing Pi should report unavailable: %d", response.Code)
	}
}
