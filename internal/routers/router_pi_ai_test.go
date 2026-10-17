package routers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/haierkeys/fast-note-sync-service/internal/ai"
)

type snapshotPiExecutor struct{}

func (snapshotPiExecutor) Execute(_ context.Context, _ ai.PiRequest, emit func(ai.PiEvent) error) (ai.PiFinal, error) {
	if err := emit(ai.PiEvent{Type: "delta", Text: "a"}); err != nil {
		return ai.PiFinal{}, err
	}
	if err := emit(ai.PiEvent{Type: "delta", Text: "b"}); err != nil {
		return ai.PiFinal{}, err
	}
	return ai.PiFinal{Text: "ab"}, nil
}

func TestLegacyPiStreamEmitsCumulativeSnapshots(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/", func(c *gin.Context) {
		streamPiAI(c, snapshotPiExecutor{}, ai.PiRequest{Instruction: "test"})
	})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", response.Code, response.Body.String())
	}
	var texts []string
	for _, frame := range strings.Split(response.Body.String(), "\n\n") {
		if !strings.HasPrefix(frame, "data: ") {
			continue
		}
		var event struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}
		if err := json.Unmarshal([]byte(strings.TrimPrefix(frame, "data: ")), &event); err != nil {
			t.Fatal(err)
		}
		if event.Type == "chunk" {
			texts = append(texts, event.Text)
		}
		if event.Type == "done" && event.Text != "ab" {
			t.Fatalf("done snapshot = %q", event.Text)
		}
	}
	if len(texts) != 2 || texts[0] != "a" || texts[1] != "ab" {
		t.Fatalf("legacy chunks = %#v", texts)
	}
}
