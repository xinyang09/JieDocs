package ai

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writePiFixture(t *testing.T, body string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "pi")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+body+"\n"), 0700); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLocalPiExecutorRejectsPathSkill(t *testing.T) {
	executor, err := NewPiExecutor(PiConfig{Binary: writePiFixture(t, `printf '{"type":"message_end","message":{"role":"assistant","content":"ok"}}\n'`)})
	if err != nil {
		t.Fatal(err)
	}
	_, err = executor.Execute(context.Background(), PiRequest{Instruction: "test", SkillIDs: []string{"../../secret"}}, nil)
	if !errors.Is(err, ErrInvalidSkill) {
		t.Fatalf("expected ErrInvalidSkill, got %v", err)
	}
}

func TestLocalPiExecutorReadsLargeJSONLine(t *testing.T) {
	dir := t.TempDir()
	textPath := filepath.Join(dir, "text")
	const size = 128 * 1024
	if err := os.WriteFile(textPath, []byte(strings.Repeat("x", size)), 0600); err != nil {
		t.Fatal(err)
	}
	binary := writePiFixture(t, `printf '{"type":"message_end","message":{"role":"assistant","content":"'; cat "$PI_TEST_TEXT"; printf '"}}\n'`)
	t.Setenv("PI_TEST_TEXT", textPath)
	executor, err := NewPiExecutor(PiConfig{Binary: binary, MaxOutputBytes: 2 * size})
	if err != nil {
		t.Fatal(err)
	}
	final, err := executor.Execute(context.Background(), PiRequest{Instruction: "test"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(final.Text) != size {
		t.Fatalf("large assistant text length = %d, want %d", len(final.Text), size)
	}
}

func TestLocalPiExecutorRejectsUnterminatedOutputOverLimit(t *testing.T) {
	const limit = 32 * 1024
	binary := writePiFixture(t, `head -c 65536 /dev/zero | tr '\\0' x`)
	executor, err := NewPiExecutor(PiConfig{Binary: binary, MaxOutputBytes: limit})
	if err != nil {
		t.Fatal(err)
	}
	_, err = executor.Execute(context.Background(), PiRequest{Instruction: "test"}, nil)
	if !errors.Is(err, ErrPiOutputLimit) {
		t.Fatalf("expected ErrPiOutputLimit, got %v", err)
	}
}

func TestLocalPiExecutorRejectsMalformedOutput(t *testing.T) {
	binary := writePiFixture(t, `printf 'not-json\\n'`)
	executor, err := NewPiExecutor(PiConfig{Binary: binary})
	if err != nil {
		t.Fatal(err)
	}
	_, err = executor.Execute(context.Background(), PiRequest{Instruction: "test"}, nil)
	if !errors.Is(err, ErrPiProtocol) {
		t.Fatalf("expected ErrPiProtocol, got %v", err)
	}
}

func TestLocalPiExecutorCapsStderr(t *testing.T) {
	binary := writePiFixture(t, `head -c 65536 /dev/zero >&2; sleep 2`)
	executor, err := NewPiExecutor(PiConfig{Binary: binary, MaxStderrBytes: 1024, Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	_, err = executor.Execute(context.Background(), PiRequest{Instruction: "test"}, nil)
	if !errors.Is(err, ErrPiOutputLimit) {
		t.Fatalf("expected stderr ErrPiOutputLimit, got %v", err)
	}
}

func TestLocalPiExecutorCapsModelList(t *testing.T) {
	binary := writePiFixture(t, `head -c 4096 /dev/zero`)
	executor, err := NewPiExecutor(PiConfig{Binary: binary, MaxModelBytes: 1024})
	if err != nil {
		t.Fatal(err)
	}
	_, err = executor.ListModels(context.Background())
	if !errors.Is(err, ErrPiOutputLimit) {
		t.Fatalf("expected model-list ErrPiOutputLimit, got %v", err)
	}
}

func TestLocalPiExecutorDoesNotAcceptPartialFailure(t *testing.T) {
	binary := writePiFixture(t, `printf '{"type":"message_end","message":{"role":"assistant","content":"partial"}}\n'; exit 7`)
	executor, err := NewPiExecutor(PiConfig{Binary: binary})
	if err != nil {
		t.Fatal(err)
	}
	_, err = executor.Execute(context.Background(), PiRequest{Instruction: "test"}, nil)
	if !errors.Is(err, ErrPiProtocol) {
		t.Fatalf("expected ErrPiProtocol, got %v", err)
	}
}

func TestLocalPiExecutorTimeoutKillsProcess(t *testing.T) {
	binary := writePiFixture(t, `sleep 2 & wait`)
	executor, err := NewPiExecutor(PiConfig{Binary: binary, Timeout: 20 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	_, err = executor.Execute(context.Background(), PiRequest{Instruction: "test"}, nil)
	if !errors.Is(err, ErrPiTimeout) {
		t.Fatalf("expected ErrPiTimeout, got %v", err)
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("cancellation left a child process running for %s", elapsed)
	}
}

func TestSkillRegistryKeepsStableIDsAndRejectsSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	skillDir := filepath.Join(root, "summarize")
	if err := os.MkdirAll(skillDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte("---\nname: summarize\ndescription: Summarize notes\n---\n"), 0600); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "SKILL.md")
	if err := os.WriteFile(outside, []byte("---\nname: escape\n---\n"), 0600); err != nil {
		t.Fatal(err)
	}
	escapeDir := filepath.Join(root, "escape")
	if err := os.MkdirAll(escapeDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(escapeDir, "SKILL.md")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	registry, err := NewSkillRegistry(root)
	if err != nil {
		t.Fatal(err)
	}
	skills, err := registry.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(skills) != 1 || skills[0].ID != "summarize" {
		t.Fatalf("unexpected skills: %#v", skills)
	}
	encoded, err := json.Marshal(skills[0])
	if err != nil || strings.Contains(string(encoded), skills[0].Path) || strings.Contains(string(encoded), skills[0].Content) {
		t.Fatalf("skill metadata leaked server fields: %s", encoded)
	}
	if _, err := registry.Resolve([]string{"../summarize"}); !errors.Is(err, ErrInvalidSkill) {
		t.Fatalf("path skill was accepted: %v", err)
	}
	if _, err := registry.Resolve([]string{"workspace:summarize"}); !errors.Is(err, ErrInvalidSkill) {
		t.Fatalf("prefixed skill ID was accepted: %v", err)
	}
}
