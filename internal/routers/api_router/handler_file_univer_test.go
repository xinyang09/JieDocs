package api_router

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestUniverFileSpecForPath(t *testing.T) {
	tests := []struct {
		path       string
		kind       string
		importForm string
		exportForm string
		outputPath string
	}{
		{path: "报告.doc", kind: "doc", importForm: "doc", exportForm: "docx", outputPath: "报告.docx"},
		{path: "报告.docx", kind: "doc", importForm: "docx", exportForm: "docx", outputPath: "报告.docx"},
		{path: "数据.xls", kind: "sheet", importForm: "xls", exportForm: "xlsx", outputPath: "数据.xlsx"},
		{path: "数据.xlsx", kind: "sheet", importForm: "xlsx", exportForm: "xlsx", outputPath: "数据.xlsx"},
		{path: "演示.ppt", kind: "slide", importForm: "ppt", exportForm: "pptx", outputPath: "演示.pptx"},
		{path: "演示.pptx", kind: "slide", importForm: "pptx", exportForm: "pptx", outputPath: "演示.pptx"},
		{path: "数据.csv", kind: "sheet", importForm: "csv", exportForm: "csv", outputPath: "数据.csv"},
	}
	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			spec, ok := univerFileSpecForPath(test.path)
			if !ok {
				t.Fatal("expected Univer support")
			}
			if spec.Kind != test.kind || spec.Import != test.importForm || spec.Export != test.exportForm || spec.OutputPath != test.outputPath {
				t.Fatalf("unexpected spec: %#v", spec)
			}
		})
	}
}

func TestUniverFileSpecForPathRejectsUnsupportedFiles(t *testing.T) {
	for _, path := range []string{"manual.pdf", "archive.zip", "sheet.ods"} {
		if _, ok := univerFileSpecForPath(path); ok {
			t.Fatalf("expected %s to remain outside Univer", path)
		}
	}
}

func TestUniverNodeBinaryUsesConfiguredPath(t *testing.T) {
	nodePath := filepath.Join(t.TempDir(), "node")
	if err := os.WriteFile(nodePath, []byte("#!/bin/sh\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FNS_NODE_BIN", nodePath)

	got, err := univerNodeBinary()
	if err != nil {
		t.Fatal(err)
	}
	if got != nodePath {
		t.Fatalf("expected configured Node path %q, got %q", nodePath, got)
	}
}

func TestUniverNodeBinaryReportsMissingConfiguredPath(t *testing.T) {
	t.Setenv("FNS_NODE_BIN", filepath.Join(t.TempDir(), "missing-node"))

	_, err := univerNodeBinary()
	if err == nil || !strings.Contains(err.Error(), "FNS_NODE_BIN") {
		t.Fatalf("expected configured Node error, got %v", err)
	}
}

func TestUniverNodeBinaryFindsCommonInstallWhenPathOmitsNode(t *testing.T) {
	t.Setenv("FNS_NODE_BIN", "")
	t.Setenv("PATH", t.TempDir())

	expected := ""
	for _, candidate := range []string{"/opt/homebrew/bin/node", "/usr/local/bin/node"} {
		if info, err := os.Stat(candidate); err == nil && info.Mode()&0111 != 0 {
			expected = candidate
			break
		}
	}
	if expected == "" {
		t.Skip("no common system Node installation available")
	}

	got, err := univerNodeBinary()
	if err != nil {
		t.Fatal(err)
	}
	if got != expected {
		t.Fatalf("expected fallback Node path %q, got %q", expected, got)
	}
}
